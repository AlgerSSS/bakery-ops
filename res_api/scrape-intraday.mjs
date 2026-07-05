// scrape-intraday.mjs — 日内「今日单品逐时销量」轻量拉取（加减货建议用，用户 2026-07-05）。
//
// 复用已登录会话(storageState.json)，只打 1 个报表查询(reportId=211, itemsByDateHour, 仅 today)，
// 把结果 upsert 进 item_hourly_sales(今天)。故意只碰这一张表——不跑整条 30 天链、不重建 timeslot 基线、
// 不写 daily_revenue，避免用当天「半天」数据污染派生统计。23:00 全量刷新会用完整数据覆盖今天。
import 'dotenv/config';
import { chromium } from 'playwright';
import postgres from 'postgres';
import fs from 'node:fs';

const BASE = 'https://bo.sea.restosuite.ai';
const SHOP_ID = process.env.SHOP_ID || '406994127';
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('[intraday] ERROR: DATABASE_URL required'); process.exit(1); }
if (!fs.existsSync('storageState.json')) { console.error('[intraday] storageState.json not found; run `npm run login`'); process.exit(1); }

const tz = 'Asia/Kuala_Lumpur';
const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
const pad = (n) => String(n).padStart(2, '0');
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
console.log(`[intraday] date=${today} (KL ${pad(now.getHours())}:${pad(now.getMinutes())})`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: 'storageState.json' });
const page = await ctx.newPage();
let authHeaders = null, shopHdr = null;
page.on('request', (r) => {
  const h = r.headers();
  if (!authHeaders && h['vulcan-token']) authHeaders = h;
  if (!shopHdr && h['shop-id']) shopHdr = h['shop-id'];
});
await page.goto(`${BASE}/report/report-items-breakdowm`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(4000);
if (!authHeaders) { console.error('[intraday] no auth headers; session likely expired — run npm run login'); await browser.close(); process.exit(2); }
if (!authHeaders['shop-id']) authHeaders['shop-id'] = shopHdr || SHOP_ID;

const body = {
  reportId: '211',
  selectFields: ['D_businessDate', 'D_itemName', 'D_hours', 'M_Item_SUM_netQty', 'M_Item_SUM_netSales', 'M_Item_SUM_grossSales'],
  metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
  filters: [
    { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: [today, today] },
    { fieldName: 'D_itemType', filterType: 'IN', filterValue: ['0', '2'] },
    { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
    { fieldName: 'D_shopId', filterType: 'IN', filterValue: [authHeaders['shop-id']] },
  ],
  page: { pageNo: 1, pageSize: 5000 }, orderBy: [{ D_hours: 'ASC' }],
};

async function callApi(payload) {
  return page.evaluate(async ({ url, b, hdr }) => {
    const forbidden = new Set(['host', 'connection', 'content-length', 'cookie']);
    const headers = {};
    for (const [k, v] of Object.entries(hdr || {})) if (!forbidden.has(k.toLowerCase())) headers[k] = v;
    headers['content-type'] = 'application/json';
    headers['accept'] = 'application/json, text/plain, */*';
    const r = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(b) });
    const text = await r.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    return { status: r.status, body: parsed };
  }, { url: BASE + '/api/report/data/queryData', b: payload, hdr: authHeaders });
}

const flat = (row) => {
  const o = {};
  for (const [k, v] of Object.entries(row)) o[k] = (v && typeof v === 'object' && 'value' in v && ('displayValue' in v || 'abbrDisplayValue' in v)) ? v.value : v;
  return o;
};

const allRows = [];
let pageNo = 1;
while (true) {
  body.page.pageNo = pageNo;
  const r = await callApi(body);
  if (r.status !== 200 || r.body?.code !== '000') {
    console.error(`[intraday] page ${pageNo} failed:`, r.status, r.body?.code, r.body?.msg);
    await browser.close();
    // 401/未授权 = 会话已失效 → 退 2，让 wrapper 重新登录再试；其余退 3。
    process.exit(r.status === 401 || r.body?.code === '401' ? 2 : 3);
  }
  const rows = (r.body?.data?.rows || r.body?.data?.list || []).map(flat);
  allRows.push(...rows);
  if (rows.length < body.page.pageSize) break;
  if (++pageNo > 20) { console.warn('[intraday] safety stop at 20 pages'); break; }
}
await browser.close();
console.log(`[intraday] fetched ${allRows.length} item×hour rows`);
if (!allRows.length) { console.warn('[intraday] no rows for today — nothing to write (store may be pre-open)'); process.exit(0); }

// id→可读名（与全量链同一套 translations.json）
let itemNames = {};
const transFile = 'output/sales/translations.json';
if (fs.existsSync(transFile)) itemNames = JSON.parse(fs.readFileSync(transFile, 'utf8')).dimOptions?.D_itemName || {};

const seen = new Set();
const batch = [];
for (const r of allRows) {
  const date = r.D_businessDate, id = r.D_itemName;
  if (!date || id == null) continue;
  const name = itemNames[id] || id;
  const hour = Number(r.D_hours);
  const uid = `${date}|${hour}|${name}`;
  if (seen.has(uid)) continue;
  seen.add(uid);
  batch.push({ date, hour, item_name: name, qty: Number(r.M_Item_SUM_netQty) || 0, net_sales: Number(r.M_Item_SUM_netSales) || 0, gross_sales: Number(r.M_Item_SUM_grossSales) || 0 });
}

const sql = postgres(DB_URL, { max: 3, idle_timeout: 20 });
try {
  await sql.begin(async (sql) => {
    await sql`DELETE FROM item_hourly_sales WHERE date = ${today}`;
    for (let i = 0; i < batch.length; i += 500) {
      await sql`INSERT INTO item_hourly_sales ${sql(batch.slice(i, i + 500), 'date', 'hour', 'item_name', 'qty', 'net_sales', 'gross_sales')}`;
    }
  });
  console.log(`[intraday] upserted ${batch.length} rows into item_hourly_sales for ${today}`);
} finally {
  await sql.end();
}
