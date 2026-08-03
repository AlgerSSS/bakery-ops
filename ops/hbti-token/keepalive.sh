#!/bin/bash
# 让生产上的 RES 令牌保持活跃,防止它闲死。
#
# ── 根因(2026-08-02 两轮实验实测)────────────────────────────────
# RES 的会话是**空闲超时**,不是固定寿命:
#
#   实验一(同批 6 个令牌,只在各自时点查一次)
#     空闲 1h -> OK    空闲 2h -> OK
#     空闲 4h -> 401   空闲 6h -> 401   空闲 8h -> 401
#     每 15 分钟调用一次的那个:8 小时全程 OK
#
#   实验二(交叉对照,把「活跃/空闲」与「新/旧」解耦,+4.5h 判读)
#                 ACTIVE        IDLE
#       OLD       OK            401(确认)
#       NEW       OK            401(确认)
#     最旧的令牌只要在用就活着,最新的闲着也死 ->
#     排除「并发会话上限按创建顺序驱逐」,确证是空闲超时。
#     致死窗口:2~4 小时。
#
# ── 为什么会打到生产 ──────────────────────────────────────────
# HBTI 流量低,两次顾客完成之间常常几小时没有任何 RES 调用,令牌就闲死了,
# 于是发券中断、/api/health 报 503。08-01/08-02 两次故障距轮换 2h32m 和
# 7h19m —— 间隔对不上任何固定周期,因为它取决于最后一次调用的时间(即流量),
# 不取决于时钟。这也是为什么「把轮换调更频繁」只是掩盖:轮换只是恰好
# 塞了一个新令牌进去。
#
# ── 修法 ──────────────────────────────────────────────────────
# /api/health 会用生产令牌打一次 RES,所以 curl 它就等于替令牌续命。
# 无需部署、无需在本机持有凭证、一次 HTTP 请求。每 30 分钟一次,
# 相对 2 小时的下限有 4 倍余量。
#
# 注:诊断期间**不能**这么做 —— 保温会让令牌永不过期,把要观测的故障
# 一起按住(观察者效应)。现在结论已经拿到,保温才从干扰变成修复。
#
# 轮换(0 3,9,15,21)保留作兜底:万一令牌因别的原因作废,还有它换新。
set -o pipefail
set -u

URL="https://hbti-test.hotcrush.net/api/health"
LOG_DIR="/opt/hotcrush/hbti-token/logs"
LOG="$LOG_DIR/keepalive-$(date '+%Y-%m').log"
mkdir -p "$LOG_DIR"

# 一次 curl 同时取响应体与状态码 —— 分两次请求会让「503 的响应体」和
# 「200 的状态码」凑到同一行,记录本身就说不清了。
out=$(curl -s -m 25 -w $'\n%{http_code}' "$URL?cb=$(date +%s)" 2>/dev/null)
code=${out##*$'\n'}
body=${out%$'\n'*}

printf '%s HTTP %s %s\n' "$(date -u '+%FT%TZ')" "${code:-ERR}" "${body:-<empty>}" >> "$LOG"

# 非 200 不在这里盲目补救:health 的 503 可能来自 DB,自动轮换 RES 令牌会治错病。
# 与 run.sh 一样留下哨兵并走可选 webhook。只在首次失败时通知,避免每 30 分钟刷屏;
# 恢复 200 后清哨兵,下一次故障才能再次通知。
SENTINEL="$LOG_DIR/KEEPALIVE_LAST_BAD"
if [ "${code:-}" != "200" ]; then
  first_failure=0
  [ ! -f "$SENTINEL" ] && first_failure=1
  printf '%s 保温请求非 200(%s):%s\n' "$(date -u '+%FT%TZ')" "${code:-ERR}" "${body:-<empty>}" \
    > "$SENTINEL"

  if [ "$first_failure" = "1" ]; then
    # 只取这一个键,不 source 整个 .env(避免把 Vercel 令牌灌进 shell 环境)。
    if [ -z "${ALERT_WEBHOOK:-}" ] && [ -f "/opt/hotcrush/hbti-token/.env" ]; then
      ALERT_WEBHOOK=$(grep -E '^ALERT_WEBHOOK=' "/opt/hotcrush/hbti-token/.env" |
        tail -1 | cut -d= -f2- | tr -d '"')
    fi
    if [ -n "${ALERT_WEBHOOK:-}" ]; then
      curl -s -m 10 -X POST -H 'Content-Type: application/json' \
        -d "{\"text\":\"[HOT CRUSH] HBTI RES 令牌保温失败 HTTP ${code:-ERR}，日志 $LOG\"}" \
        "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
    fi
  fi
  exit 1
fi
rm -f "$SENTINEL"
