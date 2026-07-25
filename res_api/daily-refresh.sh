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

# 1) 等网络/站点就绪（最多 ~2.5 分钟）——从睡眠唤醒/重启后网络可能还没起
for i in $(seq 1 10); do
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

echo "$(date '+%F %T') final exit=$CODE (attempts up to 3)" >> "$LOG_DIR/daily-status.log"
exit $CODE
