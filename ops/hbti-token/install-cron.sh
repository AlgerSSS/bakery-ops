#!/bin/bash
# 幂等地把轮换与保温任务加进 root crontab,保留现有条目。
set -o pipefail
set -u

ROTATE_ENTRY='0 3,9,15,21 * * * /opt/hotcrush/hbti-token/run.sh'
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

install_entry \
  'hbti-token/run.sh' \
  '轮换任务' \
  'HBTI 发券令牌轮换。每 6 小时换新,作为令牌异常失效时的兜底。' \
  "$ROTATE_ENTRY"

install_entry \
  'hbti-token/keepalive.sh' \
  '保温任务' \
  'HBTI RES 令牌保温。7/37 分运行,避开整点轮换;实测空闲 2~4 小时会 401。' \
  "$KEEPALIVE_ENTRY"

echo "=== 安装后的 crontab ==="
crontab -l 2>/dev/null | grep -vE '^$'
echo "=== 校验 ==="
echo "  hbti-token 轮换条目数: $(crontab -l 2>/dev/null | grep -cF 'hbti-token/run.sh') (应为 1)"
echo "  hbti-token 保温条目数: $(crontab -l 2>/dev/null | grep -cF 'hbti-token/keepalive.sh') (应为 1)"
echo "  原有 res_api 条目数: $(crontab -l 2>/dev/null | grep -cF 'res_api/') (应为 2)"
