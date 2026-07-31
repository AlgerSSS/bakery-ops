#!/usr/bin/env node
// `npm run refresh` 的入口。取代原来的 `node a.js && node b.js && ...` 串联。
//
// 关键差别：一步失败不再中断后面的步骤（login 除外）。因为这条链上的步骤彼此并不
// 都有依赖关系 —— 详见 lib/step-runner.js 顶部注释。最后聚合退出码，
// 让 daily-refresh.sh 的重试与告警继续按「今晚有没有该写没写的东西」触发。
//
// 用法：
//   node run-refresh.mjs                 跑全部步骤
//   node run-refresh.mjs --only=a,b      只跑指定步骤（排障 / 失败重跑）
//   node run-refresh.mjs --skip=a,b      跳过指定步骤（例如 --skip=sync-to-db 演练不写库）
//   步骤名拼错会直接报错退出，不再静默跳过 0 个步骤（上一轮的失败注入演练就是用这两个开关做的）。
//
// 时长预算（M3）：每步有单独超时，整轮有总 deadline，超时按进程组 SIGTERM->SIGKILL 收走
//（连 chromium 一起），避免坏会话之夜把 23:00 的 cron 拖到一个小时、堆出十几个 chromium。
//   REFRESH_DEADLINE_MIN             整轮总预算，默认 20 分钟
//   REFRESH_STEP_TIMEOUT_<STEP>_SEC  单步覆盖（步骤名大写、连字符换下划线）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSpawnRunner,
  formatSummary,
  retrySelection,
  runSteps,
  selectSteps,
  summarizeSteps,
} from './lib/step-runner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// critical 的判定标准：这一步失败会不会让某张数据库表当晚少数据 / 明显变陈旧。
// optional 的唯一成员是 item-last-sale —— 原 && 链里它就写成 `(... || true)`，
// 它只补 item_last_sale 一张辅助表（精确断货时刻），缺一晚不影响主链路。
const STEPS = [
  // gate：会话拿不到，后面每一步都会在「捕获不到 auth header」上失败，继续跑纯属浪费。
  { name: 'login', script: 'login.js', critical: true, gate: true, timeoutMs: 3 * 60_000 },
  { name: 'scrape', script: 'scrape.js', critical: true, timeoutMs: 8 * 60_000 },
  { name: 'scrape-items-by-hour', script: 'scrape-items-by-hour.js', critical: true, timeoutMs: 5 * 60_000 },
  { name: 'scrape-daily', script: 'scrape-daily.js', critical: true, timeoutMs: 6 * 60_000 },
  { name: 'fetch-translations', script: 'fetch-translations.js', critical: true, timeoutMs: 4 * 60_000 },
  { name: 'apply-translations', script: 'apply-translations.js', critical: true, timeoutMs: 2 * 60_000 },
  { name: 'apply-items-by-hour', script: 'apply-items-by-hour.js', critical: true, timeoutMs: 2 * 60_000 },
  { name: 'item-last-sale', script: 'scrape-item-last-sale.mjs', critical: false, timeoutMs: 5 * 60_000 },
  // ---- 会员链路（2026-07-27 接入）----
  // 全部 critical:false 是刻意的：会员是新增能力，它整条坏掉**不应该**让 9 张营收表
  // 当晚不写，也不该把整轮判成失败去触发重试。失败会在汇总表里以 WARN 出现
  // （summarizeSteps 对 only-optional 失败打 WARN 但 exit 0），
  // 真出问题靠 sync-member 里的 card_payment_net 哨兵与 pos_member_daily.is_partial 暴露。
  // 实测各 14~19s，预算给宽。
  { name: 'member-snapshot', script: 'scrape-member-snapshot.mjs', critical: false, timeoutMs: 4 * 60_000 },
  { name: 'member-flows', script: 'scrape-member-flows.mjs', critical: false, timeoutMs: 5 * 60_000 },
  { name: 'member-trends', script: 'scrape-member-trends.mjs', critical: false, timeoutMs: 3 * 60_000 },
  // sync-to-db 放在最后，且它内部也做了同样的「跑完所有表再聚合失败」处理：
  // 上游哪怕缺了 sales_by_business_date.csv，daily.json 那 5 张表照样写。
  { name: 'sync-to-db', script: 'sync-to-db.js', critical: true, timeoutMs: 10 * 60_000 },
  // 会员入库独立成步、排在 sync-to-db 之后：营收表先落库，会员再写，任一方失败不连累另一方。
  // 实测 45 天滚动 74s。
  { name: 'sync-member', script: 'sync-member.mjs', critical: false, timeoutMs: 6 * 60_000 },
];

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);
// 忘了写等号（`--only` 而不是 `--only=scrape`）不能被当成「不过滤」——那会把整条链
// 连同 sync-to-db 一起跑掉，而使用者以为只跑了一步。
for (const key of ['only', 'skip']) {
  if (args[key] === 'true') {
    console.error(`[refresh] --${key} 需要值，例如 --${key}=scrape,sync-to-db`);
    process.exit(1);
  }
}
const csv = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);
const only = csv(args.only);
const skip = csv(args.skip) || [];

const { selected, error } = selectSteps(STEPS, { only, skip });
if (error) {
  console.error(`[refresh] ${error}`);
  process.exit(1);
}

// 单步超时可用环境变量覆盖（排障时把某一步放宽）。
const timeouts = {};
for (const s of STEPS) {
  const key = `REFRESH_STEP_TIMEOUT_${s.name.replace(/-/g, '_').toUpperCase()}_SEC`;
  const override = Number(process.env[key]);
  timeouts[s.name] = override > 0 ? override * 1000 : s.timeoutMs;
}
const deadlineMin = Number(process.env.REFRESH_DEADLINE_MIN || 20);
const deadlineAt = deadlineMin > 0 ? Date.now() + deadlineMin * 60_000 : null;

const RETRY_FILE = path.join(HERE, 'output', 'logs', 'refresh-retry-steps.txt');
fs.mkdirSync(path.dirname(RETRY_FILE), { recursive: true });
// 本轮一开始就清掉上一轮的重跑清单，避免 shell 读到过期内容。
fs.rmSync(RETRY_FILE, { force: true });

console.log(
  `[refresh] business date=${process.env.REFRESH_BUSINESS_DATE || '(未锁定，按当前 KL 日期)'}` +
    ` 步骤=${selected.map((s) => s.name).join(',')} 总预算=${deadlineMin}min`
);

const runStep = createSpawnRunner({ cwd: HERE, timeouts, deadlineAt });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.error(`[refresh] 收到 ${sig}，正在结束当前步骤`);
    runStep.killCurrent(sig);
    process.exit(130);
  });
}

const results = await runSteps(selected, runStep);
for (const line of formatSummary(results)) console.log(line);

// 失败步骤名回传给 daily-refresh.sh：下一次尝试只重跑它们（+ login + sync-to-db），
// 而不是把整条链（含 7 个浏览器步骤）从头再跑一遍。
const retry = retrySelection(results, STEPS);
if (retry.length) {
  fs.writeFileSync(RETRY_FILE, retry.join(','));
  console.log(`[refresh] 建议重跑步骤: ${retry.join(',')}（已写入 ${RETRY_FILE}）`);
}

process.exit(summarizeSteps(results).exitCode);
