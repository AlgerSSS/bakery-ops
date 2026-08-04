#!/bin/bash
# RES_VULCAN_TOKEN 定时轮换。由 cron 调用,也可手动跑。
#
# 为什么需要它:该令牌不是服务凭证,是从 RES 后台(BO)浏览器会话借来的。
# 2026-08-02 两轮实验证实它空闲 2~4 小时后会 401,持续使用则至少 8 小时有效。
# 失效后顾客仍能登录答题(H5 走每请求现取的访客令牌),但**发券会失败**,
# /api/health 也会因券模板只读探测 401 而 503。keepalive.sh 每 30 分钟保温;
# 本轮换保留作令牌异常失效时的兜底。根治仍是向 RES 申请受限服务凭证。
#
# 锁的实际作用范围(别高估它):
#   /var/lock/hotcrush-bo-session.lock 目前**只有本脚本获取**,所以它防的是本任务
#   自重入 —— 上一班卡住时,下一班不会叠上来一起写 storageState.json。
#   它**不能**防 intraday-refresh.sh(14:20) / daily-refresh.sh(23:00) 并发,因为
#   那两个脚本没取这把锁。与它们的隔离目前只靠错峰(本任务 03/09/15/21 点)。
#   要真正闭合,得让那两个 wrapper 也取同一把锁。
#
# 超时是必需的,不是保险:没有外层 timeout,挂死的进程会永久占锁,之后每班都只打印
# 「拿不到锁」然后跳过 —— 静默停摆比失败更糟。
set -o pipefail
set -u

ROOT="/opt/hotcrush/hbti-token"
LOG_DIR="$ROOT/logs"
LOG="$LOG_DIR/rotate-$(date '+%Y-%m').log"
LOCK="/var/lock/hotcrush-bo-session.lock"

mkdir -p "$LOG_DIR"

main() {
  exec 9>"$LOCK"
  # 200 秒拿不到锁就放弃:多半是别的会话任务在跑,下一班再来。
  if ! flock -w 200 9; then
    echo "$(date '+%F %T') 拿不到会话锁,本次跳过"
    return 75   # EX_TEMPFAIL:与真正的失败区分开,不触发告警
  fi

  # 先刷 BO 会话再借令牌 —— storageState 过期时 openAuthedPage 借不到 token。
  # timeout 180:正常 ~10s,超过即 Playwright 卡死,杀掉以释放锁。
  echo "$(date '+%F %T') 刷新 BO 会话"
  if ! (cd /opt/hotcrush/res_api && timeout -k 20 180 node login.js); then
    echo "$(date '+%F %T') login.js 失败或超时,中止"
    return 1
  fi

  echo "$(date '+%F %T') 执行轮换"
  # 凭证走 --env-file:不进 cron 命令行,也不进 argv
  # (rotate.mjs 用 VERCEL_TOKEN 环境变量传给 CLI,不用 --token,否则 ps 上人人可见)。
  # timeout 900:借令牌 ~20s + redeploy ~60s + health 轮询最多 60s,留足余量。
  if ! timeout -k 30 900 node --env-file="$ROOT/.env" "$ROOT/rotate.mjs"; then
    echo "$(date '+%F %T') 轮换失败或超时"
    return 1
  fi

  echo "$(date '+%F %T') 完成"
  return 0
}

# 主体的输出进月日志;退出码留到外面处理 —— 若把 exit 写在这个块里,
# 下面的告警收尾就永远不会执行(这正是 daily-refresh.sh 早年踩过的坑)。
{
  echo "===== $(date '+%F %T %Z') 开始轮换 ====="
  main
  CODE=$?
  echo "===== $(date '+%F %T') 结束 exit=$CODE ====="
} >> "$LOG" 2>&1

# 告警出口,沿用 daily-refresh.sh 的哨兵 + webhook 惯例。
# 现状:本机(含 res_api)**没有任何地方配过 ALERT_WEBHOOK**,所以失败时只会留下
# logs/LAST_FAILURE 哨兵文件,不会有人被主动通知 —— 想要通知就往 .env 填一个
# webhook 地址(已实测:填了就会 POST)。ALERT_WEBHOOK 只从环境/.env 读,不写死 URL。
if [ "$CODE" != "0" ] && [ "$CODE" != "75" ]; then
  echo "$(date '+%F %T') FAILED code=$CODE log=$LOG" > "$LOG_DIR/LAST_FAILURE"
  # 只取这一个键,不 source 整个 .env(避免把 Vercel 令牌灌进 shell 环境)。
  if [ -z "${ALERT_WEBHOOK:-}" ] && [ -f "$ROOT/.env" ]; then
    ALERT_WEBHOOK=$(grep -E '^ALERT_WEBHOOK=' "$ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"')
  fi
  if [ -n "${ALERT_WEBHOOK:-}" ]; then
    # 飞书/Lark 群机器人不吃 {"text":…}:形状不对照样 200,错误号只在包体里。
    # ${CODE} 必须带花括号:紧跟中文逗号时,UTF-8 locale 下 bash 会把逗号的首字节
    # 吃进变量名,配上 set -u 就是在告警这一步直接崩掉。
    ALERT_TEXT="[HOT CRUSH] HBTI 发券令牌轮换失败 exit=${CODE}，日志 ${LOG}"
    case "$ALERT_WEBHOOK" in
      */open-apis/bot/v2/hook/*)
        ALERT_BODY="{\"msg_type\":\"text\",\"content\":{\"text\":\"$ALERT_TEXT\"}}" ;;
      *)
        ALERT_BODY="{\"text\":\"$ALERT_TEXT\"}" ;;
    esac
    # 判「送到了」要两条都过:HTTP 2xx(任何目的地,含告警中转的 502),
    # 以及 Lark 的包体 code:0(它用 200 + 非零 code 表示拒收)。
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
elif [ "$CODE" = "0" ]; then
  rm -f "$LOG_DIR/LAST_FAILURE"
fi
# 注意 75 既不建哨兵也不删:一次跳过无害,但不该掩盖上一次真实失败。

exit "$CODE"
