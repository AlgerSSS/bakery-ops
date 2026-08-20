#!/bin/bash
# 一键部署：门禁(tsc+vitest+build) → 同步到 tokyo-01(core) → 重启两端。
# 用法：
#   ./deploy.sh          两端都部署(默认)
#   ./deploy.sh core     只部署 tokyo-01(核心:复盘/预测/Lark/res_api)
#   ./deploy.sh mac      只重启 Mac(WhatsApp/招聘)
#   ./deploy.sh --skip-gate [target]   跳过门禁(快速迭代,慎用)
#
# 沿革：2026-08-05 之前生产机在 Contabo 62.72.46.80；当日失联后切到
# tokyo-01（Vultr 东京，45.77.12.118），过渡期曾用 deploy-tokyo.sh。
# 2026-08-15 两脚本合并回唯一入口 deploy.sh，Contabo 不再接收部署。
# 与 Contabo 时代的差别（保留记录，勿回改）：
#   1) 目标 tokyo-01，密钥 ~/.ssh/xray_tokyo
#   2) bakery-ops 不装 Playwright 浏览器 —— 云上跑 INSTANCE_ROLE=core，
#      唯一用浏览器的 jobstreet_pull 是 onWa 门控，留在 Mac。装了纯属浪费 350MB。
#      （res_api 仍需浏览器抓 POS，在服务器侧按其 node_modules 对齐安装。）
#   3) 多重启一个 hotcrush-res-api（旧机上 res_api 没有独立 unit）
set -e
ROOT="/Users/weiliangshao/hot"
BK="$ROOT/bakery-ops"
KEY="$HOME/.ssh/xray_tokyo"
TOKYO="root@45.77.12.118"
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
  # 关于 --exclude '/_*'：前导斜杠把模式锚定在传输根目录，只排掉 res_api/ 顶层那批
  # 一次性调查脚本。无锚点的 '_*' 会匹配任意层级，把 bakery-ops/src/app/api/import/_auth.ts
  # 也一并吃掉 —— Next.js 正是用 `_` 前缀表示 app 目录下的非路由文件，后果是三个 import
  # 接口静默失效。这个坑 2026-08-01 才查出来，别改回去。
  echo "==> rsync bakery-ops → tokyo-01（排除 .env / node_modules / 各类会话态）"
  rsync -az -e "$SSHC" \
    --exclude node_modules --exclude .next --exclude .git --exclude logs \
    --exclude '.venv' --exclude '.pytest_cache' --exclude '__pycache__' \
    --exclude output --exclude .env --exclude 'storageState*.json' \
    --exclude '*.log' --exclude '.DS_Store' --exclude '/_*' \
    --exclude 'whatsapp-session' --exclude 'jobstreet-session' \
    --exclude 'services/lightrag' \
    "$BK/" "$TOKYO:/opt/hotcrush/bakery-ops/"

  echo "==> rsync res_api → tokyo-01"
  # storageState.json 不同步：服务器那份是它自己 login.js 生成的活会话，
  # 覆盖 = 顶掉已登录状态。丢了也不致命，daily-refresh.sh 第一步会自动重登。
  rsync -az -e "$SSHC" \
    --exclude node_modules --exclude output --exclude .env \
    --exclude 'storageState*.json' --exclude '*.log' --exclude '/_*' \
    "$ROOT/res_api/" "$TOKYO:/opt/hotcrush/res_api/"

  echo "==> rsync scripts → tokyo-01"
  # 凭据与运行态刻意不同步（「服务器那份才是权威」）：lark_app.json 含 app_secret，
  # .lark_* 是 token 缓存/配额熔断/月度计数，*_state.json 是对账游标（含 failure_streak）。
  # ⚠️ lark_app.json 在 git 里没有，随 Contabo 一起丢了 —— 招聘 Python 脚本要跑就得先重建它。
  rsync -az -e "$SSHC" \
    --exclude '__pycache__' --exclude '*.pyc' \
    --exclude 'lark_app.json' --exclude 'lark_app.json.bak-*' \
    --exclude '.lark_*' --exclude '*_state.json' \
    --exclude '*.log' --exclude '*.log.*' \
    --exclude '*.bak-*' --exclude '*.new-*' --exclude 'backup-*' \
    "$ROOT/scripts/" "$TOKYO:/opt/hotcrush/scripts/"

  echo "==> tokyo-01: npm install + next build + 重启"
  # 服务器端 next build 的理由同旧机：rsync 排除了 .next，而服务跑在 NODE_ENV=production 下，
  # 生产模式只读 .next 里的产物、不按需编译。少了这一步代码上去了但线上仍跑旧构建，且不报错。
  # 先 stop 再 build：next build 会重写 .next，而运行中的进程正从同一目录读取。
  # ⚠️ 这台是 1 vCPU / 954MB，build 约需 2.5 分钟（旧机 4 vCPU 时更快），停机窗口相应变长。
  $SSHC "$TOKYO" 'set -e
    cd /opt/hotcrush/bakery-ops
    PUPPETEER_SKIP_DOWNLOAD=true PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
      npm install --no-audit --no-fund >/dev/null 2>&1
    systemctl stop hotcrush-core
    export NODE_OPTIONS="--max-old-space-size=1400"
    if ! npx next build; then
      echo "❌ 服务器端构建失败，保持服务停止以免跑上半成品；修复后重跑 deploy" >&2
      exit 1
    fi
    systemctl start hotcrush-core
    cd /opt/hotcrush/res_api
    npm install --no-audit --no-fund >/dev/null 2>&1
    # res_api 要浏览器（daily/intraday 抓 POS）。必须用 ./node_modules/.bin，
    # 不能用 npx —— npx 可能去 registry 拉最新版，装出跟 node_modules 对不上的 rev。
    ./node_modules/.bin/playwright install chromium \
      || echo "⚠️ playwright install chromium 失败 —— 今晚 23:00 的 POS 刷新会崩" >&2
    systemctl restart hotcrush-res-api'
  sleep 8
  echo "   tokyo core:    $($SSHC "$TOKYO" 'systemctl is-active hotcrush-core')"
  echo "   tokyo res_api: $($SSHC "$TOKYO" 'systemctl is-active hotcrush-res-api')"
  echo "   角色确认:      $($SSHC "$TOKYO" 'journalctl -u hotcrush-core --no-pager -o cat | grep -o "\"role\":\"[a-z]*\"" | tail -1')"
fi

if [ "$TARGET" = "mac" ] || [ "$TARGET" = "both" ]; then
  echo "==> 重启 Mac (whatsapp)"
  launchctl kickstart -k "gui/$(id -u)/com.hotcrush.bakery-ops"
  echo "   Mac: $(launchctl print gui/$(id -u)/com.hotcrush.bakery-ops 2>/dev/null | grep -i 'state =' | head -1 | xargs)"
fi

echo "✅ 部署完成 (target=$TARGET)"
