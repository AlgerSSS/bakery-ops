// Item × Hour sales for the last 30 days, using reportId=211 with D_itemName + D_hours dims.
import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://bo.sea.restosuite.ai';

if (!fs.existsSync('storageState.json')) {
  console.error('storageState.json not found. Run `npm run login` first.');
  process.exit(1);
}

const outDir = 'output/sales/items-by-hour';
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, 'raw'), { recursive: true });

// last 30 days relative to today, in the shop's timezone (Asia/Kuala_Lumpur).
const tz = 'Asia/Kuala_Lumpur';
const today = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
today.setHours(0, 0, 0, 0);
const from = new Date(today); from.setDate(from.getDate() - 29);
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const RANGE = [fmt(from), fmt(today)];
console.log('[items-by-hour] date range:', RANGE.join(' .. '));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: 'storageState.json' });
const page = await ctx.newPage();

// Capture real headers (vulcan-token etc.) by loading the Items report page first.
let authHeaders = null;
let shopIdFromHeaders = null;
page.on('request', (r) => {
  const h = r.headers();
  if (!authHeaders && h['vulcan-token']) authHeaders = h;
  if (!shopIdFromHeaders && h['shop-id']) shopIdFromHeaders = h['shop-id'];
});
await page.goto(`${BASE}/report/report-items-breakdowm`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(4000);
if (!authHeaders) {
  console.error('[items-by-hour] failed to capture auth headers; session may be expired. Run npm run login.');
  await browser.close();
  process.exit(2);
}
// Make sure shop-id is present on every subsequent fetch. If the initial XHR didn't carry it, inject it.
if (!authHeaders['shop-id']) {
  if (!shopIdFromHeaders) {
    // Hardcoded fallback — we only have one shop on this account.
    shopIdFromHeaders = '406994127';
  }
  authHeaders['shop-id'] = shopIdFromHeaders;
}
console.log('[items-by-hour] auth headers captured (shop-id=' + authHeaders['shop-id'] + ')');

const shopId = authHeaders['shop-id'];

// Two bodies:
//  a) totals: aggregate per dish+hour across 30 days (dim=D_itemName+D_unit+D_hours)
//  b) hour-only breakdown for context (dim=D_hours)
const body = {
  reportId: '211',
  selectFields: [
    'D_menuItemId',
    'D_itemName',
    'D_unit',
    'D_hours',
    'M_Item_SUM_netQty',
    'M_Item_SUM_netSales',
    'M_Item_SUM_grossSales',
    'M_Item_SUM_refundQty',
    'M_Item_SUM_refundAmount',
    'M_Item_SUM_discountProm',
  ],
  aggFilters: [],
  proportionProperty: { enable: false },
  dimAdditionalStrategy: [],
  metricsByDimQryV2: [],
  filters: [
    { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: RANGE },
    { fieldName: 'D_itemType', filterType: 'IN', filterValue: ['0', '2'] },
    { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
    { fieldName: 'D_shopId', filterType: 'IN', filterValue: [shopId] },
  ],
  page: { pageNo: 1, pageSize: 5000 },
  orderBy: [{ D_itemName: 'ASC' }, { D_hours: 'ASC' }],
};

async function callApi(path, payload) {
  return page.evaluate(async ({ url, body, origHeaders }) => {
    const forbidden = new Set(['host', 'connection', 'content-length', 'cookie']);
    const headers = {};
    for (const [k, v] of Object.entries(origHeaders || {})) if (!forbidden.has(k.toLowerCase())) headers[k] = v;
    headers['content-type'] = 'application/json';
    headers['accept'] = 'application/json, text/plain, */*';
    const r = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
    const text = await r.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    return { status: r.status, body: parsed };
  }, { url: BASE + path, body: payload, origHeaders: authHeaders });
}

// Pull page 1, then keep paging while we have a full page.
const allRows = [];
let pageNo = 1;
while (true) {
  body.page.pageNo = pageNo;
  const r = await callApi('/api/report/data/queryData', body);
  if (r.status !== 200 || r.body?.code !== '000') {
    console.error(`  page ${pageNo} failed:`, r.status, r.body?.code, r.body?.msg);
    break;
  }
  const rows = r.body?.data?.rows || r.body?.data?.list || [];
  console.log(`  page ${pageNo}: ${rows.length} rows`);
  fs.writeFileSync(path.join(outDir, 'raw', `page${String(pageNo).padStart(2, '0')}.json`), JSON.stringify({ reqBody: body, result: r }, null, 2));
  allRows.push(...rows);
  if (rows.length < body.page.pageSize) break;
  pageNo++;
  if (pageNo > 50) { console.warn('  safety stop at 50 pages'); break; }
}

console.log(`[items-by-hour] total rows: ${allRows.length}`);

// Flatten cells.
function flat(row) {
  const o = {};
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === 'object' && 'value' in v && ('displayValue' in v || 'abbrDisplayValue' in v)) o[k] = v.value;
    else o[k] = v;
  }
  return o;
}
const flatRows = allRows.map(flat);
fs.writeFileSync(path.join(outDir, 'rows.json'), JSON.stringify(flatRows, null, 2));

// Write untranslated CSV for now; apply-translations will produce the readable version.
function toCsv(rows) {
  if (!rows.length) return '';
  const keys = Array.from(rows.reduce((a, r) => { Object.keys(r).forEach(k => a.add(k)); return a; }, new Set()));
  const esc = (v) => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replaceAll('"', '""') + '"' : String(v);
  return [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n');
}
fs.writeFileSync(path.join(outDir, 'raw.csv'), toCsv(flatRows));
console.log('[items-by-hour] wrote output/sales/items-by-hour/raw.csv and rows.json');

await browser.close();
