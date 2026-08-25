#!/usr/bin/env bash
# HOT CRUSH member email scheduler. The installed cron keeps MODE=preview until
# the Lark Base content, test recipient, consent policy and unsubscribe route are
# approved. Preview mode reads configuration only and cannot send email.
set -u

export PATH="/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")" || exit 1

LOG_DIR="$(pwd)/output/logs"
mkdir -p "$LOG_DIR"
RUN_DATE="$(TZ=Asia/Kuala_Lumpur date +%F)"
LOG="$LOG_DIR/member-email-$RUN_DATE.log"
LOCK_FILE="${MEMBER_EMAIL_LOCK_FILE:-/var/lock/hotcrush-member-email.lock}"
MODE="${MEMBER_EMAIL_MODE:-preview}"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date '+%F %T') another member email job is running; skipped" >> "$LOG"
  exit 0
fi

echo "========== $(date '+%F %T') mode=$MODE START ==========" >> "$LOG"
if [ "$MODE" = "preview" ]; then
  node scripts/member-email-dispatch.mjs >> "$LOG" 2>&1
  CODE=$?
elif [ "$MODE" = "live" ]; then
  node login.js >> "$LOG" 2>&1
  CODE=$?
  if [ "$CODE" -eq 0 ]; then
    node scripts/member-email-dispatch.mjs \
      --send-live \
      --limit=20 \
      --confirm=HOT_CRUSH_LARK_EMAIL_LIVE_V1 >> "$LOG" 2>&1
    CODE=$?
  fi
else
  echo "invalid MEMBER_EMAIL_MODE=$MODE" >> "$LOG"
  CODE=1
fi
echo "========== $(date '+%F %T') mode=$MODE exit=$CODE ==========" >> "$LOG"

if [ "$CODE" -ne 0 ]; then
  echo "$(date '+%F %T') FAILED exit=$CODE log=$LOG" > "$LOG_DIR/MEMBER_EMAIL_LAST_FAILURE"
else
  rm -f "$LOG_DIR/MEMBER_EMAIL_LAST_FAILURE"
fi

exit "$CODE"
