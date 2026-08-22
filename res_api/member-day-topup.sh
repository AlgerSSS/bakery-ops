#!/usr/bin/env bash
# HOT CRUSH 会员日 1.5 倍积分补差。周四凌晨跑，处理前一天（周三）的会员订单。
# 装上去时 MODE=preview——只算不发。确认预演数字无误后再由人改成 live。
set -u

export PATH="/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")" || exit 1

LOG_DIR="$(pwd)/output/logs"
mkdir -p "$LOG_DIR"
RUN_DATE="$(TZ=Asia/Kuala_Lumpur date +%F)"
LOG="$LOG_DIR/member-day-$RUN_DATE.log"
LOCK_FILE="${MEMBER_DAY_LOCK_FILE:-/var/lock/hotcrush-member-day.lock}"
MODE="${MEMBER_DAY_MODE:-preview}"
# 指定业务日重跑：周四那次失败后，运维需要能补跑某个具体的周三。
DATE_ARG=""
if [ -n "${MEMBER_DAY_BUSINESS_DATE:-}" ]; then
  DATE_ARG="--business-date=$MEMBER_DAY_BUSINESS_DATE"
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date '+%F %T') another member-day job is running; skipped" >> "$LOG"
  exit 0
fi

echo "========== $(date '+%F %T') mode=$MODE START ==========" >> "$LOG"
# 会话先刷新：登录失败就停，不要拿一个过期会话去发分。
node login.js >> "$LOG" 2>&1
CODE=$?
if [ "$CODE" -ne 0 ]; then
  echo "login failed; refusing to continue" >> "$LOG"
elif [ "$MODE" = "preview" ]; then
  node scripts/member-day-topup.mjs $DATE_ARG >> "$LOG" 2>&1
  CODE=$?
elif [ "$MODE" = "live" ]; then
  MEMBER_DAY_LIVE_ENABLED=1 \
  MEMBER_DAY_CONFIRM='GRANT MEMBER DAY BONUS POINTS' \
  node scripts/member-day-topup.mjs --apply $DATE_ARG >> "$LOG" 2>&1
  CODE=$?
else
  echo "invalid MEMBER_DAY_MODE=$MODE" >> "$LOG"
  CODE=1
fi
echo "========== $(date '+%F %T') mode=$MODE exit=$CODE ==========" >> "$LOG"

if [ "$CODE" -ne 0 ]; then
  echo "$(date '+%F %T') FAILED exit=$CODE log=$LOG" > "$LOG_DIR/MEMBER_DAY_LAST_FAILURE"
else
  rm -f "$LOG_DIR/MEMBER_DAY_LAST_FAILURE"
fi

exit "$CODE"
