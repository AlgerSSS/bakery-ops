#!/bin/bash
# 幂等地把轮换任务加进 root crontab,保留现有条目。
set -o pipefail
set -u

ENTRY='0 5,17 * * * /opt/hotcrush/hbti-token/run.sh'
CUR=$(crontab -l 2>/dev/null || true)

if printf '%s\n' "$CUR" | grep -qF 'hbti-token/run.sh'; then
  echo "已存在,跳过安装"
else
  {
    printf '%s\n' "$CUR"
    echo ''
    echo '# HBTI 发券令牌轮换。RES BO 令牌约 24 小时失效,失效后发券全挂。'
    echo '# 排期避开 intraday-refresh(14:20) 与 daily-refresh(23:00)。'
    printf '%s\n' "$ENTRY"
  } | crontab -
  echo "已安装"
fi

echo "=== 安装后的 crontab ==="
crontab -l 2>/dev/null | grep -vE '^$'
echo "=== 校验 ==="
echo "  hbti-token 条目数: $(crontab -l 2>/dev/null | grep -cF 'hbti-token/run.sh') (应为 1)"
echo "  原有 res_api 条目数: $(crontab -l 2>/dev/null | grep -cF 'res_api/') (应为 2)"
