// 服务端 bundle 构建（IMPROVEMENT-PLAN.md C3）
// external 列表只在这里定义一次；dev / dev:bot 共用。
// 用法：node scripts/build-server.mjs <entry.ts> <outfile.js>
import { build } from "esbuild";

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error("usage: node scripts/build-server.mjs <entry.ts> <outfile.js>");
  process.exit(1);
}

// 原生依赖/自带打包的库不进 bundle。对未引用的模块 external 是 no-op，
// 所以 server 与 bot 两个入口共用同一超集是安全的。
const EXTERNALS = [
  "playwright",
  "playwright-core",
  "playwright-extra",
  "puppeteer-extra-plugin-stealth",
  "whatsapp-web.js",
  "puppeteer",
  "qrcode-terminal",
  "pdf-parse",
  "next",
];

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile,
  external: EXTERNALS,
});
console.log(`[build-server] ${entry} -> ${outfile}`);
