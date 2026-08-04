#!/usr/bin/env bash
# Hot Crush — 每晚自动刷新 POS 数据。
# 部署现状(2026-07-04)：只在 Contabo 由 cron 23:00 触发一次(Mac 端 res_api launchd 已停用)。
# 便携：cd 到脚本自身目录(不写死路径)，兼容 Contabo(Linux)/Mac。有了「数据新鲜度检查」兜底，
# 一天一抓即可，故去掉了原白天补跑守卫(现 crontab 仅 23:00)。
export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"
cd "$(dirname "$0")" || exit 1

LOG_DIR="$(pwd)/output/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/daily-$(date +%Y-%m-%d).log"

# 业务日在这里算一次，整条链（含所有重试）都用它 —— 见 lib/business-date.js。
# 不这么做的话：23:00 起跑，重试一旦跨过 KL 00:00，sync-to-db 的 EXPECTED_DATE 翻成 D+1，
# 而当晚抓的全是 D 的数据，最后一次重试注定失败（而且失败得毫无意义）。
export REFRESH_BUSINESS_DATE="${REFRESH_BUSINESS_DATE:-$(TZ=Asia/Kuala_Lumpur date +%F)}"
echo "$(date '+%F %T') business date locked to $REFRESH_BUSINESS_DATE" >> "$LOG"

# 1) 等网络/站点就绪（最多 ~2.5 分钟）——从睡眠唤醒/重启后网络可能还没起
for i in $(seq 1 10); do
  if curl -s -m 8 -o /dev/null "https://bo.sea.restosuite.ai/" 2>/dev/null; then break; fi
  echo "$(date '+%F %T') waiting for network/site ($i/10)..." >> "$LOG"
  sleep 15
done

# 2) 跑 refresh，失败自动重试（瞬时网络/登录超时 → 等 60s 再来）。
#
# 时长预算（M3）：整链重试 3 次是在 && 链时代定的 —— 那时 scrape 一失败后面就不跑了，
# 一次尝试很快结束。现在链条不再在 scrape 处停下，每次重试都会跑完 7 个浏览器步骤，
# 3 次重试足以把 23:00 的 cron 拖到接近 1 小时。所以：
#   - 次数 3 -> 2；
#   - 第 2 次只重跑上一次失败的步骤（run-refresh.mjs 把清单写进 refresh-retry-steps.txt，
#     里面已经带上 login 与 sync-to-db）；
#   - run-refresh.mjs 内部还有单步超时 + 整轮 REFRESH_DEADLINE_MIN 兜底。
RETRY_FILE="$LOG_DIR/refresh-retry-steps.txt"
rm -f "$RETRY_FILE"
CODE=1
for attempt in 1 2; do
  ONLY=""
  if [ "$attempt" -gt 1 ] && [ -s "$RETRY_FILE" ]; then
    ONLY="--only=$(cat "$RETRY_FILE")"
    echo "$(date '+%F %T') retrying failed steps only: $ONLY" >> "$LOG"
  fi
  echo "========== $(date '+%F %T') daily refresh START (attempt $attempt) ==========" >> "$LOG"
  if [ -n "$ONLY" ]; then
    npm run refresh -- "$ONLY" >> "$LOG" 2>&1
  else
    npm run refresh >> "$LOG" 2>&1
  fi
  CODE=$?
  echo "========== $(date '+%F %T') attempt $attempt exit=$CODE ==========" >> "$LOG"
  [ "$CODE" = "0" ] && break
  [ "$attempt" = "2" ] && break
  echo "$(date '+%F %T') attempt $attempt failed, retrying in 60s..." >> "$LOG"
  sleep 60
done

echo "$(date '+%F %T') final exit=$CODE (business date $REFRESH_BUSINESS_DATE, attempts up to 2)" >> "$LOG_DIR/daily-status.log"

# 3) 告警出口。退出码修好之后必须有人收到 ——「三次重试 + 日志」这套兜底里，
#    日志没人看、重试因为上游永远返回 0 从未触发。
#    ALERT_WEBHOOK 只从环境/.env 读，不写死任何 URL 或凭据；未设置时只留哨兵文件。
if [ "$CODE" != "0" ]; then
  echo "$(date '+%F %T') FAILED code=$CODE log=$LOG" > "$LOG_DIR/LAST_FAILURE"
  # 只取 ALERT_WEBHOOK 这一个键，不 source 整个 .env（避免把数据库口令等灌进 shell 环境）。
  if [ -z "${ALERT_WEBHOOK:-}" ] && [ -f .env ]; then
    ALERT_WEBHOOK=$(grep -E '^ALERT_WEBHOOK=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'")
  fi
  if [ -n "${ALERT_WEBHOOK:-}" ]; then
    # 飞书/Lark 群机器人不吃 {"text":…}：形状不对它照样回 200，只在包体里给非零 code，
    # 于是「发过了」和「没送到」长得一模一样。按目的地选形状。
    # ${CODE} 必须带花括号：紧跟中文逗号时，UTF-8 locale 下 bash 会把逗号的首字节
    # 吃进变量名，配上 set -u 就是在告警这一步直接崩掉。
    ALERT_TEXT="[HOT CRUSH] POS 每晚刷新失败 exit=${CODE}，日志 ${LOG}"
    case "$ALERT_WEBHOOK" in
      */open-apis/bot/v2/hook/*)
        ALERT_BODY="{\"msg_type\":\"text\",\"content\":{\"text\":\"$ALERT_TEXT\"}}" ;;
      *)
        ALERT_BODY="{\"text\":\"$ALERT_TEXT\"}" ;;
    esac
    # 判「送到了」要两条都过：HTTP 2xx（任何目的地，含告警中转的 502），
    # 以及 Lark 的包体 code:0（它用 200 + 非零 code 表示拒收）。
    ALERT_RAW=$(curl -s -m 10 -X POST -H 'Content-Type: application/json' \
      -d "$ALERT_BODY" -w '\n%{http_code}' "$ALERT_WEBHOOK" 2>/dev/null || true)
    ALERT_HTTP=${ALERT_RAW##*$'\n'}
    ALERT_RECEIPT=$(printf '%s' "${ALERT_RAW%$'\n'*}" | tr -d ' \n')
    ALERT_FAILED=""
    case "$ALERT_HTTP" in
      2??) ;;
      *) ALERT_FAILED="http=${ALERT_HTTP:-ERR}" ;;
    esac
    case "$ALERT_WEBHOOK" in
      */open-apis/bot/v2/hook/*)
        case "$ALERT_RECEIPT" in
          *'"code":0'*) ;;
          *) ALERT_FAILED="${ALERT_FAILED:+$ALERT_FAILED }lark_code" ;;
        esac ;;
    esac
    if [ -n "$ALERT_FAILED" ]; then
      echo "$(date '+%F %T') ALERT UNDELIVERED $ALERT_FAILED receipt=${ALERT_RECEIPT:-<empty>}" \
        >> "$LOG_DIR/LAST_FAILURE"
    fi
  fi
else
  rm -f "$LOG_DIR/LAST_FAILURE"
fi

exit $CODE
