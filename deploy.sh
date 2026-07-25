#!/bin/bash
# 一键部署：门禁(tsc+vitest+build) → 同步到 Contabo(core) → 重启两端。
# 用法：
#   ./deploy.sh          两端都部署(默认)
#   ./deploy.sh core     只部署 Contabo(核心:复盘/预测/Lark/res_api)
#   ./deploy.sh mac      只重启 Mac(WhatsApp/招聘)
#   ./deploy.sh --skip-gate [target]   跳过门禁(快速迭代,慎用)
set -e
ROOT="/Users/weiliangshao/hot"
BK="$ROOT/bakery-ops"
KEY="$HOME/.ssh/contabo_hotcrush"
CONTABO="root@62.72.46.80"
SSHC="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=15"

SKIP_GATE=0
if [ "$1" = "--skip-gate" ]; then SKIP_GATE=1; shift; fi
TARGET="${1:-both}"

if [ "$SKIP_GATE" = "0" ]; then
  echo "==> 门禁 (tsc + vitest + build)"
  cd "$BK"
  ./node_modules/.bin/tsc --noEmit
  npx vitest run >/dev/null
  npx next build >/dev/null 2>&1
  echo "✅ 门禁通过"
fi

if [ "$TARGET" = "core" ] || [ "$TARGET" = "both" ]; then
  echo "==> rsync bakery-ops → Contabo（排除 .env / node_modules，保住 core 角色）"
  rsync -az -e "$SSHC" \
    --exclude node_modules --exclude .next --exclude .git --exclude logs \
    --exclude output --exclude .env --exclude 'storageState*.json' \
    --exclude '*.log' --exclude '.DS_Store' --exclude '_*' \
    "$BK/" "$CONTABO:/opt/hotcrush/bakery-ops/"
  echo "==> rsync res_api → Contabo"
  rsync -az -e "$SSHC" \
    --exclude node_modules --exclude output --exclude .env \
    --exclude 'storageState*.json' --exclude '*.log' --exclude '_*' \
    "$ROOT/res_api/" "$CONTABO:/opt/hotcrush/res_api/"
  echo "==> Contabo: npm install(新依赖) + 重启 core"
  $SSHC "$CONTABO" 'cd /opt/hotcrush/bakery-ops && PUPPETEER_SKIP_DOWNLOAD=true npm install --no-audit --no-fund >/dev/null 2>&1; systemctl restart hotcrush-core'
  sleep 8
  echo "   Contabo core: $($SSHC "$CONTABO" 'systemctl is-active hotcrush-core')"
  echo "   角色确认: $($SSHC "$CONTABO" 'grep -h "Instance role" /opt/hotcrush/bakery-ops/logs/daemon.*.log 2>/dev/null | tail -1 | grep -o "role.:.[a-z]*" | head -1')"
fi

if [ "$TARGET" = "mac" ] || [ "$TARGET" = "both" ]; then
  echo "==> 重启 Mac (whatsapp)"
  launchctl kickstart -k "gui/$(id -u)/com.hotcrush.bakery-ops"
  echo "   Mac: $(launchctl print gui/$(id -u)/com.hotcrush.bakery-ops 2>/dev/null | grep -i 'state =' | head -1 | xargs)"
fi

echo "✅ 部署完成 (target=$TARGET)"
