// One-off backfill: daily_revenue 早期行缺 gross_sales/total_discount（2026-01-01 ~ 2026-04 中旬），
// 从 Restosuite 后台按月重放 reportId 888001（按营业日销售明细）拉历史数据回填。
//
// 安全边界：
//   - 只 UPDATE gross_sales IS NULL OR gross_sales = 0 的行，绝不碰 revenue 等既有字段
//   - 执行前自动备份 daily_revenue -> daily_revenue_backup_gross（若不存在）
//   - 回滚：UPDATE daily_revenue d SET gross_sales=b.gross_sales, total_discount=b.total_discount,
//           discount_rate=b.discount_rate FROM daily_revenue_backup_gross b WHERE d.date=b.date;
//
// Run: node backfill-gross-sales.mjs            （默认回填 2026-01-01 ~ 2026-04-30）
//      node backfill-gross-sales.mjs 2026-01 2026-04
import 'dotenv/config';
import { chromium } from 'playwright';
import postgres from 'postgres';
import fs from 'node:fs';

if (!fs.existsSync('storageState.json')) {
  console.error('storageState.json not found. Run `npm run login` first.');
  process.exit(1);
}
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const BASE = 'https://bo.sea.restosuite.ai';
const PAGE_URL = `${BASE}/report/report-sales-breakdown`;

const fromMonth = process.argv[2] || '2026-01';
const toMonth = process.argv[3] || '2026-04';

/* 生成按月的日期区间列表 [[起, 止], ...]（后台报表对长区间可能有上限，按月重放最稳） */
function monthRanges(fromM, toM) {
  const out = [];
  let [y, m] = fromM.split('-').map(Number);
  const [ey, em] = toM.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const last = new Date(y, m, 0).getDate();
    const mm = String(m).padStart(2, '0');
    out.push([`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, '0')}`]);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

const flattenCell = v =>
  (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) ? v.value : v;

function extractRows(body) {
  const d = body?.data ?? body;
  if (!d) return null;
  if (Array.isArray(d) && d.length) return d;
  for (const k of ['rows', 'list', 'records', 'items']) {
    if (Array.isArray(d?.[k]) && d[k].length) return d[k];
  }
  return null;
}

const num = v => { const n = Number(v); return isNaN(n) ? null : n; };

async function main() {
  /* ---------- 1. 捕获 888001 请求模板 ---------- */
  console.log('[backfill] 打开销售明细报表页，捕获查询请求…');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'storageState.json' });
  const page = await context.newPage();

  const captured = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (!/\/api\/report\/data\/(queryData|dataBlock)/.test(url)) return;
    let reqBody = null;
    try { reqBody = response.request().postDataJSON(); } catch {}
    if (!reqBody || String(reqBody.reportId) !== '888001') return;
    if (!reqBody.selectFields?.includes('D_businessDate')) return;
    captured.push({ url, reqHeaders: response.request().headers(), reqBody });
  });

  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(6000);

  if (!captured.length) {
    console.error('[backfill] 未捕获到 888001 查询请求——登录态可能过期，请先 npm run login');
    await browser.close();
    process.exit(1);
  }
  const template = captured[captured.length - 1];
  console.log(`[backfill] 已捕获请求模板（${template.url.split('/').pop()}）`);

  /* ---------- 2. 按月重放拉历史数据 ---------- */
  const byDate = new Map();   // date -> {gross, discount}
  for (const [d1, d2] of monthRanges(fromMonth, toMonth)) {
    const body = JSON.parse(JSON.stringify(template.reqBody));
    body.filters = (body.filters || []).filter(f => f.fieldName !== 'D_compare_businessDate');
    for (const f of body.filters) {
      if (f.fieldName === 'D_businessDate' && f.filterType === 'RANGE') {
        const usesSlash = typeof f.filterValue?.[0] === 'string' && f.filterValue[0].includes('/');
        f.filterValue = usesSlash ? [d1.replaceAll('-', '/'), d2.replaceAll('-', '/')] : [d1, d2];
      }
    }
    if (body.page) { body.page.pageSize = 500; body.page.pageNo = 1; }

    const result = await page.evaluate(async ({ url, body, origHeaders }) => {
      const forbidden = new Set(['host', 'connection', 'content-length', 'cookie',
        ':authority', ':method', ':path', ':scheme']);
      const headers = {};
      for (const [k, v] of Object.entries(origHeaders || {})) {
        if (!forbidden.has(k.toLowerCase())) headers[k] = v;
      }
      headers['content-type'] = 'application/json';
      headers['accept'] = 'application/json, text/plain, */*';
      const r = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
      const text = await r.text();
      try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: null }; }
    }, { url: template.url, body, origHeaders: template.reqHeaders });

    const rows = extractRows(result.body) || [];
    let got = 0;
    for (const raw of rows) {
      const row = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, flattenCell(v)]));
      const date = String(row.D_businessDate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const gross = num(row.M_Order_SUM_grossSales_MultiTaxSys);
      const discount = num(row.M_Order_SUM_totalPromotionAmount);
      if (gross == null) continue;
      byDate.set(date, { gross, discount: discount ?? 0 });
      got++;
    }
    console.log(`[backfill] ${d1} ~ ${d2}: HTTP ${result.status}，取到 ${got} 天`);
  }
  await browser.close();

  if (!byDate.size) { console.error('[backfill] 未取到任何数据，中止'); process.exit(1); }
  console.log(`[backfill] 合计取到 ${byDate.size} 天的历史流水/折扣`);

  /* ---------- 3. 回填数据库（只填空值行） ---------- */
  const sql = postgres(DB_URL, { max: 1, prepare: false, idle_timeout: 5 });
  const ex = await sql`SELECT to_regclass('daily_revenue_backup_gross') AS t`;
  if (!ex[0].t) {
    await sql`CREATE TABLE daily_revenue_backup_gross AS SELECT * FROM daily_revenue`;
    console.log('[backfill] 备份已创建: daily_revenue_backup_gross');
  } else {
    console.log('[backfill] 备份表已存在，沿用');
  }

  const before = await sql`
    SELECT COUNT(*) c FROM daily_revenue WHERE gross_sales IS NULL OR gross_sales = 0`;
  let updated = 0, skipped = 0;
  for (const [date, v] of [...byDate.entries()].sort()) {
    const rate = v.gross > 0 ? +(v.discount / v.gross).toFixed(4) : null;
    const r = await sql`
      UPDATE daily_revenue
      SET gross_sales = ${v.gross}, total_discount = ${v.discount}, discount_rate = ${rate}
      WHERE date = ${date} AND (gross_sales IS NULL OR gross_sales = 0)`;
    if (r.count > 0) updated += r.count; else skipped++;
  }
  const after = await sql`
    SELECT COUNT(*) c FROM daily_revenue WHERE gross_sales IS NULL OR gross_sales = 0`;
  console.log(`[backfill] 更新 ${updated} 行（已有真实值跳过 ${skipped} 行）`);
  console.log(`[backfill] 缺流水行数: ${before[0].c} -> ${after[0].c}`);

  /* 抽样核对 */
  const sample = await sql`
    SELECT date, gross_sales, revenue, total_discount FROM daily_revenue
    WHERE date >= ${fromMonth + '-01'} ORDER BY date ASC LIMIT 5`;
  sample.forEach(r => console.log(`  ${r.date}  流水:${r.gross_sales}  实收:${r.revenue}  折扣:${r.total_discount}`));
  await sql.end();
}

main().catch(e => { console.error('[backfill] ERROR:', e.message); process.exit(1); });
