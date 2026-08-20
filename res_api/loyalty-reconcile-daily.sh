#!/usr/bin/env bash
# HOT CRUSH See You Often rolling-loyalty maintenance.
# Intended for the single production writer after the nightly POS refresh.
set -u

export PATH="/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")" || exit 1

LOG_DIR="$(pwd)/output/logs"
mkdir -p "$LOG_DIR"
AS_OF_DATE="${LOYALTY_AS_OF_DATE:-$(TZ=Asia/Kuala_Lumpur date +%F)}"
LOG="$LOG_DIR/loyalty-$AS_OF_DATE.log"
LOCK_FILE="${LOYALTY_LOCK_FILE:-/var/lock/hotcrush-loyalty.lock}"
CONFIRMATION="SEE_YOU_OFTEN_LEVELS_V1"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date '+%F %T') another loyalty reconciliation is running; skipped" >> "$LOG"
  exit 0
fi

run_action() {
  action="$1"
  echo "========== $(date '+%F %T') action=$action as-of=$AS_OF_DATE START ==========" >> "$LOG"
  node scripts/preview-loyalty-levels.mjs \
    "--as-of=$AS_OF_DATE" \
    --apply \
    "--action=$action" \
    "--confirm=$CONFIRMATION" >> "$LOG" 2>&1
  code=$?
  echo "========== $(date '+%F %T') action=$action exit=$code ==========" >> "$LOG"
  return "$code"
}

CODE=0
ACTIONS="aligned-growth held-downgrade-growth upgrade"
if [ "${LOYALTY_DOWNGRADE_ENABLED:-0}" = "1" ]; then
  ACTIONS="$ACTIONS downgrade"
fi
for action in $ACTIONS; do
  run_action "$action"
  CODE=$?
  [ "$CODE" -eq 0 ] || break
done

if [ "$CODE" -ne 0 ]; then
  echo "$(date '+%F %T') FAILED exit=$CODE log=$LOG" > "$LOG_DIR/LOYALTY_LAST_FAILURE"
else
  rm -f "$LOG_DIR/LOYALTY_LAST_FAILURE"
fi

exit "$CODE"
