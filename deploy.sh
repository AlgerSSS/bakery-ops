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
  # 关于 --exclude '/_*'：前导斜杠把模式锚定在传输根目录，只排掉 res_api/ 顶层那批
  # 一次性调查脚本（_audit-*.mjs、_drink*.mjs、截图、xlsx 等）。
  # 2026-08-01 之前这里写的是无锚点的 '_*'，会匹配任意层级，把
  # bakery-ops/src/app/api/import/_auth.ts 也一并吃掉 —— Next.js 正是用 `_` 前缀
  # 表示 app 目录下的非路由文件。后果是 /api/import/{products,sales,strategy}
  # 三个接口在服务器上一直缺依赖；dev 模式按需编译、启动不报错，所以长期没被发现，
  # 直到改用生产构建才暴露出来。
  echo "==> rsync bakery-ops → Contabo（排除 .env / node_modules / 各类会话态）"
  # whatsapp-session / jobstreet-session / lightrag_data 都是「服务器那份才是权威」的运行态目录，
  # 绝不能被本地覆盖。2026-07-26 之前它们没被排除，每次 deploy 都在用 Mac 的 Chrome profile
  # 盖掉服务器的（服务器那份 347MB、时间戳停在 07-02，就是这么来的）。
  # whatsapp 角色迁到服务器之后，覆盖 = 顶掉已配对的登录态 = 要重新扫码。
  rsync -az -e "$SSHC" \
    --exclude node_modules --exclude .next --exclude .git --exclude logs \
    --exclude output --exclude .env --exclude 'storageState*.json' \
    --exclude '*.log' --exclude '.DS_Store' --exclude '/_*' \
    --exclude 'whatsapp-session' --exclude 'jobstreet-session' \
    --exclude 'services/lightrag' \
    "$BK/" "$CONTABO:/opt/hotcrush/bakery-ops/"
  echo "==> rsync res_api → Contabo"
  rsync -az -e "$SSHC" \
    --exclude node_modules --exclude output --exclude .env \
    --exclude 'storageState*.json' --exclude '*.log' --exclude '/_*' \
    "$ROOT/res_api/" "$CONTABO:/opt/hotcrush/res_api/"
  echo "==> rsync scripts → Contabo（四个招聘脚本 + lark_budget）"
  # 这批 Python 脚本 2026-08-01 之前只存在于服务器、不受版本控制也没有异地备份，
  # 而它们承担招聘对账、漏斗同步、晨报和次日预览。现已纳入 git 并在此同步。
  #
  # 排除项和 bakery-ops 的 .env / *-session 是同一个道理 ——「服务器那份才是权威」：
  #   lark_app.json     含 app_secret，本地不该有，更不该推上去覆盖
  #   .lark_*           token 缓存 / 配额熔断状态 / 月度调用计数
  #   *_state.json      recruit_demand_sync_state.json 等对账游标（failure_streak 在里面）
  # 覆盖它们 = 顶掉真实凭据、清零用量计数、丢失对账进度。
  # 注意这些脚本由系统 cron 直接调度（/etc/cron.d/recruit-*），不经过 hotcrush-core，
  # 所以同步完不需要重启任何服务，下一个整点自然生效。
  rsync -az -e "$SSHC" \
    --exclude '__pycache__' --exclude '*.pyc' \
    --exclude 'lark_app.json' --exclude 'lark_app.json.bak-*' \
    --exclude '.lark_*' --exclude '*_state.json' \
    --exclude '*.log' --exclude '*.log.*' \
    --exclude '*.bak-*' --exclude '*.new-*' --exclude 'backup-*' \
    "$ROOT/scripts/" "$CONTABO:/opt/hotcrush/scripts/"
  echo "==> Contabo: npm install + Playwright 浏览器对齐 + next build + 重启 core"
  # ── 这一步合并了 2026-08-01 的两处独立修复，改动时三条都别丢 ──
  #
  # (1) Playwright 浏览器对齐
  # playwright 的 npm 包【没有 postinstall】（1.59.1 的 package.json 连 scripts 字段都没有），
  # 所以 npm install 永远不会下载浏览器 —— 跟 PUPPETEER_SKIP_DOWNLOAD 无关，那个只管 puppeteer。
  # 浏览器版本跟着 playwright 版本走（1.59.1 → chromium rev 1217），换版本就必须重下，
  # 否则 launch 报 "Executable doesn't exist at .../chromium_headless_shell-<rev>"。
  # 2026-07-04 建服务器时装的是 rev 1223，于是 JobStreet 爬虫从 07-28 接上 cron 起连崩 5 天。
  # ⚠️ 必须用 ./node_modules/.bin/playwright，不能用 `npx playwright`：npx 可能去 registry
  #    拉最新版，装出跟本地 node_modules 对不上的 rev —— 1223 极可能就是这么来的。
  # 已装好时是秒级 no-op；失败只告警不挡部署，但会打眼地喊出来。
  #
  # (2) 服务器端 next build
  # rsync 排除了 .next（见上面的 --exclude .next），而服务从 2026-08-01 起跑在
  # NODE_ENV=production 下 —— 生产模式只读 .next 里的产物，不像 dev 那样按需编译。
  # 少了这一步，代码 rsync 上去了但线上仍跑旧构建，而且不会报错。
  #
  # (3) 先 stop 再 build
  # next build 会重写 .next，而运行中的进程正从同一目录读取。
  # 因此每次部署有约 1-3 分钟停机，这是切生产模式换来性能的代价。
  $SSHC "$CONTABO" 'set -e
    cd /opt/hotcrush/bakery-ops
    PUPPETEER_SKIP_DOWNLOAD=true npm install --no-audit --no-fund >/dev/null 2>&1
    ./node_modules/.bin/playwright install chromium \
      || echo "⚠️ playwright install chromium 失败 —— JobStreet 爬虫会在下次 12:00 崩" >&2
    systemctl stop hotcrush-core
    if ! npx next build; then
      echo "❌ 服务器端构建失败，保持服务停止以免跑上半成品；修复后重跑 deploy" >&2
      exit 1
    fi
    systemctl start hotcrush-core'
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
