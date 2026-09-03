#!/bin/bash
# 幂等地安装保温任务，并移除旧的固定轮换任务。
set -o pipefail
set -u

KEEPALIVE_ENTRY='7,37 * * * * /opt/hotcrush/hbti-token/keepalive.sh'

install_entry() {
  local needle="$1"
  local label="$2"
  local comment="$3"
  local entry="$4"
  local current

  current=$(crontab -l 2>/dev/null || true)

  if [[ "$current" == *"$needle"* ]]; then
    echo "$label 已存在,跳过"
    return
  fi

  {
    printf '%s\n' "$current"
    echo ''
    printf '# %s\n' "$comment"
    printf '%s\n' "$entry"
  } | crontab -
  echo "$label 已安装"
}

current=$(crontab -l 2>/dev/null || true)
filtered=$(printf '%s\n' "$current" | grep -vF 'hbti-token/run.sh' || true)
if [ "$filtered" != "$current" ]; then
  printf '%s\n' "$filtered" | crontab -
  echo '旧固定轮换任务已移除'
fi

install_entry \
  'hbti-token/keepalive.sh' \
  '保温任务' \
  'HBTI RES 令牌保温。7/37 分运行；连续两次 res=fail 时触发一次轮换。' \
  "$KEEPALIVE_ENTRY"

echo "=== 安装后的 crontab ==="
crontab -l 2>/dev/null | grep -vE '^$'
echo "=== 校验 ==="
echo "  hbti-token 固定轮换条目数: $(crontab -l 2>/dev/null | grep -cF 'hbti-token/run.sh') (应为 0)"
echo "  hbti-token 保温条目数: $(crontab -l 2>/dev/null | grep -cF 'hbti-token/keepalive.sh') (应为 1)"
echo "  原有 res_api 条目数: $(crontab -l 2>/dev/null | grep -cF 'res_api/') (应为 2)"
