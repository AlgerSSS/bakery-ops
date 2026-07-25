// One-off fix: 2026-01 ~ 2026-04 期间部分 daily_revenue.revenue 误存为 gross（折扣前流水），
// 导致"实收"虚高（当期折扣率 ~20-25%）。从 Restosuite 拉每日 net（净收）修正。
//
// 判定条件（三条同时满足才改，宁可漏改不可错改）：
//   1. |db.revenue - resto.gross| < 0.01   （revenue 与折扣前流水完全一致 → 错存）
//   2. resto.discount > 0                  （当天确实有折扣，gross≠net）
//   3. |resto.gross - resto.discount - resto.net| < 1  （Restosuite 自身口径自洽）
// 修正内容：revenue = net；avg_transaction_value = net / transaction_count（若有单数）
// 备份：沿用 daily_revenue_backup_gross（回填前快照，含原始 revenue）
//
// Run: node fix-revenue-net.mjs 2026-01 2026-04
import 'dotenv/config';
import { chromium } from 'playwright';
import postgres from 'postgres';
import fs from 'node:fs';

if (!fs.existsSync('storageState.json')) { console.error('need storageState.json'); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, idle_timeout: 5 });

const fromMonth = process.argv[2] || '2026-01';
const toMonth = process.argv[3] || '2026-04';

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
const fc = v => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) ? v.value : v;
const num = v => { const n = Number(v); return isNaN(n) ? null : n; };

async function main() {
  /* 1. 捕获请求模板 */
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'storageState.json' });
  const page = await context.newPage();
  const captured = [];
  page.on('response', async (r) => {
    if (!/\/api\/report\/data\/queryData/.test(r.url())) return;
    let b = null; try { b = r.request().postDataJSON(); } catch {}
    if (b && String(b.reportId) === '888001' && b.selectFields?.includes('D_businessDate'))
      captured.push({ url: r.url(), reqHeaders: r.request().headers(), reqBody: b });
  });
  await page.goto('https://bo.sea.restosuite.ai/report/report-sales-breakdown', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(6000);
  if (!captured.length) { console.error('未捕获查询请求，请先 npm run login'); process.exit(1); }
  const t = captured[captured.length - 1];

  /* 2. 按月拉 gross/net/discount */
  const days = new Map();
  for (const [d1, d2] of monthRanges(fromMonth, toMonth)) {
    const body = JSON.parse(JSON.stringify(t.reqBody));
    body.filters = (body.filters || []).filter(f => f.fieldName !== 'D_compare_businessDate');
    for (const f of body.filters) {
      if (f.fieldName === 'D_businessDate' && f.filterType === 'RANGE') {
        const slash = f.filterValue?.[0]?.includes('/');
        f.filterValue = slash ? [d1.replaceAll('-', '/'), d2.replaceAll('-', '/')] : [d1, d2];
      }
    }
    if (body.page) { body.page.pageSize = 500; body.page.pageNo = 1; }
    const res = await page.evaluate(async ({ url, body, h }) => {
      const headers = {}; const forbidden = new Set(['host', 'connection', 'content-length', 'cookie']);
      for (const [k, v] of Object.entries(h)) if (!forbidden.has(k.toLowerCase())) headers[k] = v;
      headers['content-type'] = 'application/json';
      const r = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
      return r.json();
    }, { url: t.url, body, h: t.reqHeaders });
    const rows = res?.data?.rows || res?.data || [];
    for (const raw of rows) {
      const r = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, fc(v)]));
      const date = String(r.D_businessDate || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      days.set(date, {
        gross: num(r.M_Order_SUM_grossSales_MultiTaxSys),
        net: num(r.M_Order_SUM_netSales_MultiTaxSys),
        discount: num(r.M_Order_SUM_totalPromotionAmount) ?? 0,
      });
    }
    console.log(`[fix] ${d1}~${d2}: 取到 ${rows.length} 天`);
  }
  await browser.close();

  /* 3. 判定 + 修正 */
  const dbRows = await sql`
    SELECT date, revenue, transaction_count FROM daily_revenue
    WHERE date >= ${fromMonth + '-01'} AND date <= ${toMonth + '-31'} ORDER BY date`;
  let fixed = 0, ok = 0, noData = 0;
  const fixedMonths = {};
  for (const row of dbRows) {
    const d = days.get(row.date);
    if (!d || d.net == null || d.gross == null) { noData++; continue; }
    const misstored = Math.abs(Number(row.revenue) - d.gross) < 0.01
      && d.discount > 0
      && Math.abs(d.gross - d.discount - d.net) < 1;
    if (!misstored) { ok++; continue; }
    const count = Number(row.transaction_count) || null;
    const avg = count ? +(d.net / count).toFixed(2) : null;
    await sql`
      UPDATE daily_revenue
      SET revenue = ${d.net},
          avg_transaction_value = COALESCE(${avg}, avg_transaction_value)
      WHERE date = ${row.date}`;
    fixed++;
    const m = row.date.slice(0, 7);
    fixedMonths[m] = (fixedMonths[m] || 0) + 1;
  }
  console.log(`[fix] 修正 ${fixed} 天（口径正确跳过 ${ok} 天，Restosuite 无数据 ${noData} 天）`);
  console.log('[fix] 按月分布:', JSON.stringify(fixedMonths));

  const check = await sql`
    SELECT substring(date,1,7) AS month,
           ROUND(SUM(gross_sales)::numeric) AS gross,
           ROUND(SUM(revenue)::numeric) AS revenue,
           ROUND(SUM(total_discount)::numeric) AS discount
    FROM daily_revenue WHERE date >= ${fromMonth + '-01'} AND date <= ${toMonth + '-31'}
    GROUP BY 1 ORDER BY 1`;
  console.log('月份     流水      实收      折扣    自洽差(流水-折扣-实收)');
  check.forEach(r => console.log(`${r.month}  ${String(r.gross).padStart(8)}  ${String(r.revenue).padStart(8)}  ${String(r.discount).padStart(7)}  ${r.gross - r.discount - r.revenue}`));
  await sql.end();
}

main().catch(async e => { console.error('[fix] ERROR:', e.message); await sql.end({ timeout: 3 }).catch(() => {}); process.exit(1); });
