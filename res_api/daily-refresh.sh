#!/bin/zsh
# Hot Crush — 每晚自动刷新 POS 数据（由 launchd 在 23:00 触发）
# 加固：先等网络就绪（应对从睡眠唤醒），再跑完整 refresh；失败自动重试，避免漏整天。
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd /Users/weiliangshao/hot/res_api || exit 1

LOG_DIR="/Users/weiliangshao/hot/res_api/output/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/daily-$(date +%Y-%m-%d).log"
MARKER="$LOG_DIR/.last-success"

# 0) 补跑守卫：只对白天(09:30/14:30)时段生效——20h 内已成功则跳过，避免重复抓。
#    但 23 点这档是"当天完整数据"的主抓取，永不跳过；否则它会被白天那次成功挡掉，
#    当天数据要拖到次日早上才入库，今日复盘(23:30)永远拿不到当天数据（2026-07-03 就是这么丢的）。
HOUR=$(date +%H)
if [ "$HOUR" != "23" ] && [ -f "$MARKER" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$MARKER") ))
  if [ "$AGE" -lt 72000 ]; then
    echo "$(date '+%F %T') skip: daytime catch-up, last success ${AGE}s ago (<20h)" >> "$LOG_DIR/daily-status.log"
    exit 0
  fi
fi

# 1) 等网络/站点就绪（最多 ~2.5 分钟），从睡眠唤醒时网络可能还没起
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -m 8 -o /dev/null "https://bo.sea.restosuite.ai/" 2>/dev/null; then break; fi
  echo "$(date '+%F %T') waiting for network/site ($i/10)..." >> "$LOG"
  sleep 15
done

# 2) 跑 refresh，失败自动重试（瞬时网络/登录超时 → 等 60s 再来）
CODE=1
for attempt in 1 2 3; do
  echo "========== $(date '+%F %T') daily refresh START (attempt $attempt) ==========" >> "$LOG"
  npm run refresh >> "$LOG" 2>&1
  CODE=$?
  echo "========== $(date '+%F %T') attempt $attempt exit=$CODE ==========" >> "$LOG"
  [ "$CODE" = "0" ] && break
  echo "$(date '+%F %T') attempt $attempt failed, retrying in 60s..." >> "$LOG"
  sleep 60
done

[ "$CODE" = "0" ] && touch "$MARKER"
echo "$(date '+%F %T') final exit=$CODE (attempts up to 3)" >> "$LOG_DIR/daily-status.log"
exit $CODE
