#!/bin/zsh
# bakery-ops 常驻进程入口（由 launchd KeepAlive 托管）— IMPROVEMENT-PLAN.md A2
# npm run dev 每次启动都会用 esbuild 重新打包 server.ts，自动部署当前工作区代码。
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd /Users/weiliangshao/hot/bakery-ops || exit 1
exec npm run dev
