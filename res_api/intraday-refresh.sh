#!/usr/bin/env bash
# Hot Crush — 日内「今日单品逐时销量」轻量刷新（加减货建议用，14:20 由 Contabo cron 触发）。
# 只拉今天、只写 item_hourly_sales(今天)；秒级、复用已登录会话。会话过期(exit 2)则登录一次再试。
# 便携：cd 到脚本自身目录，兼容 Contabo(Linux)/Mac。
export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"
cd "$(dirname "$0")" || exit 1

LOG_DIR="$(pwd)/output/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/intraday-$(date +%Y-%m-%d).log"

echo "========== $(date '+%F %T') intraday refresh START ==========" >> "$LOG"
node scrape-intraday.mjs >> "$LOG" 2>&1
CODE=$?
# 任何失败(会话失效/瞬时错误)都重登一次再试——复用会话优先，失效才登录。
if [ "$CODE" != "0" ]; then
  echo "$(date '+%F %T') attempt failed (exit $CODE), re-login then retry" >> "$LOG"
  node login.js >> "$LOG" 2>&1 && node scrape-intraday.mjs >> "$LOG" 2>&1
  CODE=$?
fi
echo "$(date '+%F %T') intraday final exit=$CODE" >> "$LOG_DIR/intraday-status.log"
exit $CODE
