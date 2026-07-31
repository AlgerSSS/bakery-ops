import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { resetGeneratedDirectory } from './lib/generated-output.js';
import { businessDateToLocalMidnight, refreshBusinessDate } from './lib/business-date.js';
import {
  isReplayable,
  matchCapture,
  PAGE_CAPTURES,
  pageCaptureSatisfied,
  waitForRequiredCaptures,
} from './lib/capture-wait.js';

// 本次运行的硬失败清单。非空 => 进程以 1 退出，daily-refresh.sh 的三次重试才会真的触发。
// 现状是脚本只要不抛未捕获异常就 exit 0，于是「捕获归零」完全无声。
const failures = [];
const fail = (msg) => { console.error(`  [FAIL] ${msg}`); failures.push(msg); };
const warn = (msg) => { console.warn(`  [warn] ${msg}`); };

if (!fs.existsSync('storageState.json')) {
  console.error('storageState.json not found. Run `npm run login` first.');
  process.exit(1);
}

const BASE = 'https://bo.sea.restosuite.ai';

// Last 30 days ending today, in the shop's local timezone (Asia/Kuala_Lumpur).
// Using local-time wall clock matches the back office's notion of "business date".
// 业务日锁定在本轮刷新起跑那一刻（REFRESH_BUSINESS_DATE），跨午夜重试也不会把窗口推到 D+1。
const BUSINESS_DATE = refreshBusinessDate();
const today = businessDateToLocalMidnight(BUSINESS_DATE);
const from = new Date(today);
from.setDate(from.getDate() - 29);
const pad = (n) => String(n).padStart(2, '0');
const fmtSlash = (d) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
const fmtDash = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const RANGE_SLASH = [fmtSlash(from), fmtSlash(today)];
const RANGE_DASH = [fmtDash(from), fmtDash(today)];
console.log(`[scrape] business date: ${BUSINESS_DATE}; date range: ${RANGE_DASH.join(' .. ')}`);

// required=true 的页面，其必需捕获缺失会让整个进程非 0 退出。
// 注意：非 0 退出不再中断 npm run refresh 的后续步骤（见 lib/step-runner.js），
// 只是让这一步被记为失败并触发 daily-refresh.sh 的重试与告警 ——
// 与本页无关的 scrape-daily / sync-to-db 那 5 张表照常写。
// 判定依据是「下游有没有数据库表只靠它」：
//   sales-summary  -> sales_by_business_date.csv -> daily_revenue(精确源) + daily_payment_breakdown(唯一源)
//   sales-overview -> orders_by_dining_option.csv -> daily_dining_breakdown(唯一源)
//   items-breakdown-> 只喂 server.js 的 /v1/items/* 只读接口，没有任何入库表依赖它，
//                     所以缺失只告警：不该因为它一页坏掉就让当晚 item_hourly_sales 等全部不写。
const TARGETS = [
  { slug: 'sales-overview', url: `${BASE}/report/report-overview`, label: 'Sales Overview', required: true },
  { slug: 'sales-summary', url: `${BASE}/report/report-sales-breakdown`, label: 'Sales Summary', required: true },
  { slug: 'items-breakdown', url: `${BASE}/report/report-items-breakdowm`, label: 'Items Breakdown', required: false },
];

const outRoot = 'output/sales';
fs.mkdirSync(outRoot, { recursive: true });

function rewriteDateFilter(reqBody) {
  if (!reqBody || typeof reqBody !== 'object') return reqBody;
  const body = JSON.parse(JSON.stringify(reqBody));
  if (Array.isArray(body.filters)) {
    body.filters = body.filters.filter((f) => f.fieldName !== 'D_compare_businessDate');
    for (const f of body.filters) {
      if (f.fieldName === 'D_businessDate' && f.filterType === 'RANGE') {
        const orig = Array.isArray(f.filterValue) && f.filterValue[0];
        const usesSlash = typeof orig === 'string' && orig.includes('/');
        f.filterValue = usesSlash ? [...RANGE_SLASH] : [...RANGE_DASH];
      }
    }
  }
  if (body.page && typeof body.page === 'object') {
    body.page.pageSize = Math.max(body.page.pageSize || 0, 500);
    body.page.pageNo = 1;
  }
  return body;
}

function toCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const keys = Array.from(
    rows.reduce((acc, row) => {
      Object.keys(row || {}).forEach((k) => acc.add(k));
      return acc;
    }, new Set())
  );
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
    return s;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r?.[k])).join(','))].join('\n');
}

function extractRows(body) {
  const d = body?.data ?? body;
  if (!d) return null;
  if (Array.isArray(d) && d.length && typeof d[0] === 'object') return d;
  for (const k of ['rows', 'list', 'records', 'items']) {
    if (Array.isArray(d?.[k]) && d[k].length && typeof d[k][0] === 'object') return d[k];
  }
  return null;
}

// Report APIs wrap each metric cell as { value, displayValue, abbrDisplayValue }.
// Flatten to scalars for CSV convenience.
function flattenCell(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('value' in v && ('displayValue' in v || 'abbrDisplayValue' in v)) return v.value;
  }
  return v;
}
function flattenRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = flattenCell(v);
  return out;
}

// 所有页面的 replay-30d 一次性清空，而不是「跑到哪页清哪页」。
// 否则本脚本中途硬崩（页面崩溃 / 浏览器被杀）会留下「一半今天、一半昨天」的产物树，
// 而 apply-translations 分不出新旧，会把昨天的 replay 当成今天的结果生成 headline CSV。
for (const target of TARGETS) {
  fs.mkdirSync(path.join(outRoot, target.slug, 'raw'), { recursive: true });
  resetGeneratedDirectory(path.join(outRoot, target.slug, 'replay-30d'));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: 'storageState.json' });

async function scrapeTarget(target, page) {
  const dir = path.join(outRoot, target.slug);
  const rawDir = path.join(dir, 'raw');
  const replayDir = path.join(dir, 'replay-30d');
  console.log(`\n=== ${target.label} ===`);

  const captured = [];
  let pending = 0; // 正在 await response.text() 的响应数，避免快照取早

  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    const method = response.request().method();
    if (!ct.includes('application/json')) return;
    if (!url.includes('restosuite.ai')) return;
    pending++;
    try {
      const body = await response.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch { return; }
      let reqBody = null;
      try { reqBody = response.request().postDataJSON(); } catch {}
      const reqHeaders = response.request().headers();
      captured.push({ url, method, status: response.status(), reqHeaders, reqBody, body: parsed });
    } catch (e) {
      // 原来是 catch {} 全吞。读 body 失败会让某一条报表请求凭空消失，
      // 表现为「同一页有时 11 条有时 10 条」。
      warn(`body read failed for ${url}: ${e.message}`);
    } finally {
      pending--;
    }
  });

  const specs = PAGE_CAPTURES[target.slug] || [];
  let waitResult = null;

  // goto 最多 3 次：历史日志里有 Timeout 30000ms / ERR_NAME_NOT_RESOLVED / ERR_NETWORK_CHANGED。
  // 默认 30s 对冷启动/DNS 抖动偏短，提到 60s。networkidle 也显式限时，避免默认 30s 白等。
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // 每次都用 goto 而不是 reload：首次 goto 若因 DNS/网络直接抛错，页面还停在 about:blank，
      // reload 只会重载空白页、永远到不了目标 URL。Playwright 的 goto 即使 URL 相同也会真的重新导航。
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (e) {
      // goto 失败后必须 continue：页面可能已经崩了（Target closed），
      // 继续往下走会让 waitForRequiredCaptures 里的 page.waitForTimeout 抛错。
      // 那个错原来会顶层未捕获、browser.close() 永不执行，在 Contabo 上泄漏 chromium 进程。
      warn(`goto attempt ${attempt} failed: ${e.message}`);
      if (attempt < 3) await page.waitForTimeout(5000).catch(() => {});
      continue;
    }
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    waitResult = await waitForRequiredCaptures(page, {
      getCaptured: () => captured,
      getPending: () => pending,
      required: specs,
      timeoutMs: 45000,
      minWaitMs: 6000, // 保留原 waitForTimeout(6000) 的下限，非必需查询不会因为提前收网而漏抓
    });
    console.log(
      `  attempt ${attempt}: captured=${waitResult.capturedCount} waited=${waitResult.waitedMs}ms` +
        ` settled=${waitResult.settled} missing=[${waitResult.missing.join(', ')}]` +
        ` missingRequired=[${waitResult.missingRequired.join(', ')}]`
    );
    // 重试条件（为什么是 missingRequired 而不是 missing）见 lib/capture-wait.js 的
    // pageCaptureSatisfied —— 判定放在那里才能被行为测试覆盖。
    const capturedReplayable = captured.filter(isReplayable).length;
    if (pageCaptureSatisfied(waitResult, capturedReplayable)) break;
    if (attempt < 3) await page.waitForTimeout(3000).catch(() => {});
  }

  // 只有 required 谓词缺失才判死。kpi_overview_core / kpi_summary_totals 等仍然「等」，
  // 但它们只喂 server.js 的只读接口，缺了不该让当晚整条链作废
  // —— 与 apply-translations.js 的 REQUIRED_HEADLINES 严格一致。
  const missingRequired = waitResult ? waitResult.missingRequired : specs.filter((s) => s.required).map((s) => s.name);
  const missingAll = waitResult ? waitResult.missing : ['<page never loaded>'];
  if (missingRequired.length) {
    const msg = `${target.slug}: 必需报表请求未捕获 -> [${missingRequired.join(', ')}]`;
    if (target.required) fail(msg); else warn(`${msg}（该页非必需，继续）`);
  } else if (missingAll.length) {
    warn(`${target.slug}: 期望但非必需的报表请求未捕获 -> [${missingAll.join(', ')}]`);
  }

  await page.screenshot({ path: path.join(dir, 'page.png'), fullPage: true }).catch(() => {});

  // Save raw captures including request headers so we can inspect later.
  captured.forEach((c, i) => {
    const safe = c.url.replace(/https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 120);
    fs.writeFileSync(
      path.join(rawDir, `${String(i).padStart(3, '0')}_${safe}.json`),
      JSON.stringify(
        { url: c.url, method: c.method, status: c.status, reqHeaders: c.reqHeaders, reqBody: c.reqBody, body: c.body },
        null,
        2
      )
    );
  });

  const replayable = captured.filter(isReplayable); // 判定逻辑与 lib/capture-wait.js 单一来源
  console.log(`  ${replayable.length} report queries eligible for 30-day replay`);
  if (!replayable.length) {
    // replay-30d 目录在本次运行开头已被 resetGeneratedDirectory 清空，
    // 0 条 = 该页今天彻底没有产物，且旧产物也没了。
    const msg = `${target.slug}: 0 report queries eligible —— replay-30d 为空，该页所有下游 CSV 将缺失`;
    if (target.required) fail(msg); else warn(`${msg}（该页非必需，继续）`);
    return;
  }

  const replaySummary = [];
  let idx = 0;
  for (const c of replayable) {
    const newBody = rewriteDateFilter(c.reqBody);

    // Replay inside the page context so the request is same-origin and carries cookies/auth.
    const result = await page.evaluate(
      async ({ url, body, origHeaders }) => {
        // Copy all headers from the real XHR except the ones the browser manages itself
        // (host, origin, referer, content-length, cookie, ua-... are fine to leave or override).
        const forbidden = new Set([
          'host', 'connection', 'content-length', 'cookie',
          ':authority', ':method', ':path', ':scheme',
        ]);
        const headers = {};
        for (const [k, v] of Object.entries(origHeaders || {})) {
          if (forbidden.has(k.toLowerCase())) continue;
          headers[k] = v;
        }
        headers['content-type'] = 'application/json';
        headers['accept'] = 'application/json, text/plain, */*';
        try {
          const r = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify(body),
          });
          const text = await r.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
          return { status: r.status, body: parsed, sentHeaders: headers };
        } catch (e) {
          return { status: 0, error: String(e) };
        }
      },
      { url: c.url, body: newBody, origHeaders: c.reqHeaders }
    );

    const safe = c.url.replace(/https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 120);
    const base = `${String(idx).padStart(3, '0')}_${safe}`;
    fs.writeFileSync(
      path.join(replayDir, `${base}.json`),
      JSON.stringify({ url: c.url, reqBody: newBody, result }, null, 2)
    );

    // 重放结果必须自证成功。原来 status / code 从不校验：非 200、code!=='000'、401 会话失效
    // 一律静默，「捕获成功但重放失败」与「捕获失败」产生完全相同的后果。
    // 只对「必需捕获」升级为硬失败 —— 页面上还有若干附带查询（如 100330 预付款、100280 报损），
    // 它们偶发报错不该让整晚入库全部作废。
    const replayCode = result.body?.code;
    if (result.status !== 200 || (replayCode != null && replayCode !== '000')) {
      const hit = matchCapture(newBody, specs);
      const msg = `${target.slug}: replay reportId=${newBody.reportId} status=${result.status} code=${replayCode} msg=${result.body?.msg || result.error || ''}`;
      if (hit?.required && target.required) fail(`${msg} (必需项 ${hit.name})`);
      else warn(hit ? `${msg} (${hit.name}，非必需)` : msg);
    }

    const rows = extractRows(result.body);
    if (rows && rows.length) {
      const flat = rows.map(flattenRow);
      fs.writeFileSync(path.join(replayDir, `${base}.csv`), toCsv(flat));
    }

    const d = result.body?.data ?? result.body;
    let valuePreview = null;
    if (d && !rows && typeof d === 'object' && !Array.isArray(d)) {
      valuePreview = Object.fromEntries(Object.entries(d).slice(0, 12));
    }

    replaySummary.push({
      file: `${base}.json`,
      endpoint: c.url.replace(BASE, ''),
      reportId: newBody.reportId,
      selectFields: newBody.selectFields,
      metricsByDim: (newBody.metricsByDimQryV2 || []).map((m) => ({ dims: m.dims?.map((x) => x.dim), metric: m.metrics })),
      status: result.status,
      code: result.body?.code,
      msg: result.body?.msg,
      rowCount: rows ? rows.length : null,
      valuePreview,
    });
    idx++;
  }

  fs.writeFileSync(path.join(dir, 'replay-summary.json'), JSON.stringify(replaySummary, null, 2));
  console.log(`  saved ${idx} replayed responses -> ${replayDir}`);
}

// 每个页面单独兜底，且 browser.close() 放在 finally：一页崩了不能带走其余页面，
// 更不能让 chromium 进程留在 Contabo 上（cron 每晚一次，泄漏会累积到把内存吃光）。
try {
  for (const target of TARGETS) {
    let page = null;
    try {
      page = await context.newPage();
      await scrapeTarget(target, page);
    } catch (e) {
      const msg = `${target.slug}: 抓取过程异常 -> ${e.message}`;
      if (target.required) fail(msg); else warn(`${msg}（该页非必需，继续）`);
    } finally {
      await page?.close().catch(() => {});
    }
  }
} finally {
  await browser.close().catch(() => {});
}

if (failures.length) {
  console.error(`\n[scrape] FAILED with ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  // 非 0 退出让 run-refresh.mjs 把这一步记为失败、整体 exit 1，
  // 从而触发 daily-refresh.sh 的三次重试与告警。
  // 注意它不再中断后续步骤：scrape-daily / sync-to-db 喂的那 5 张表与本脚本无关，
  // 「sales-overview 一页坏掉」不该等于「7 张表当晚一行不写」。
  process.exit(1);
}
console.log('\n[scrape] done');
