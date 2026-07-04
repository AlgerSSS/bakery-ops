// Item last-sale MINUTE per day, using reportId=211 with D_itemName + D_time (minute) dims.
// Feeds precise stockout detection: 每个产品当天最后一个顾客的购买(分钟) = 断货时间。
// Emits menuItemId keys; sync-to-db.js applies translations.json (D_itemName map) → readable
// item_name, matching item_hourly_sales / item_waste exactly.
import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://bo.sea.restosuite.ai';
const SHOP_ID = process.env.SHOP_ID || '406994127';
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v]; }));
// 增量窗口：当天数据过了当天就基本定型；默认抓最近 3 天(今日/昨日/前日)覆盖复盘+断货+回填。
const DAYS = Number(args.days || 3);

if (!fs.existsSync('storageState.json')) {
  console.error('[item-last-sale] storageState.json not found. Run `npm run login` first.');
  process.exit(1);
}

const tz = 'Asia/Kuala_Lumpur';
const today = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
today.setHours(0, 0, 0, 0);
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dates = [];
for (let i = DAYS - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); dates.push(fmt(d)); }
console.log('[item-last-sale] dates:', dates.join(', '));

const outDir = 'output/sales';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: 'storageState.json' });
const page = await ctx.newPage();

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
  // 尽力而为的增强步骤：抓不到鉴权就跳过，绝不拖垮整条 refresh 链（断货检测有小时级回落）。
  console.error('[item-last-sale] 未能捕获鉴权头，跳过(best-effort)。断货检测将回落小时级。');
  await browser.close();
  process.exit(0);
}
if (!authHeaders['shop-id']) authHeaders['shop-id'] = shopIdFromHeaders || SHOP_ID;
const shopId = authHeaders['shop-id'];
console.log('[item-last-sale] auth ok (shop-id=' + shopId + ')');

async function callApi(apiPath, payload) {
  return page.evaluate(async ({ url, body, origHeaders }) => {
    const forbidden = new Set(['host', 'connection', 'content-length', 'cookie']);
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/plain, */*' };
    for (const [k, v] of Object.entries(origHeaders || {})) if (!forbidden.has(k.toLowerCase())) headers[k] = v;
    const r = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
    const text = await r.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    return { status: r.status, body: parsed };
  }, { url: BASE + apiPath, body: payload, origHeaders: authHeaders });
}
const cell = (v) => (v && typeof v === 'object' && 'value' in v) ? v.value : v;
// "H:MM" / "HH:MM" → 分钟数；解析失败返回 -1。
const toMinute = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
const fromMinute = (mm) => `${pad(Math.floor(mm / 60))}:${pad(mm % 60)}`;

// per (date, id): 最后成交分钟 + 当天数量合计
const acc = new Map(); // key `${date}|${id}` -> { date, id, lastMinute, dayQty }

for (const date of dates) {
  const body = {
    reportId: '211',
    selectFields: ['D_itemName', 'D_time', 'M_Item_SUM_netQty'],
    aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [], metricsByDimQryV2: [],
    filters: [
      { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: [date, date] },
      { fieldName: 'D_itemType', filterType: 'IN', filterValue: ['0', '2'] },
      { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
      { fieldName: 'D_shopId', filterType: 'IN', filterValue: [shopId] },
    ],
    page: { pageNo: 1, pageSize: 5000 }, orderBy: [{ D_time: 'ASC' }],
  };
  let pageNo = 1, dayRows = 0;
  while (true) {
    body.page.pageNo = pageNo;
    const r = await callApi('/api/report/data/queryData', body);
    if (r.status !== 200 || r.body?.code !== '000') {
      console.error(`  ${date} page ${pageNo} FAILED: ${r.status} ${r.body?.code} ${r.body?.msg || ''}`);
      break;
    }
    const rows = r.body?.data?.rows || [];
    for (const row of rows) {
      const id = cell(row.D_itemName);
      const qty = Number(cell(row.M_Item_SUM_netQty)) || 0;
      const min = toMinute(cell(row.D_time));
      if (!id || qty <= 0 || min < 0) continue; // 只认真实成交(netQty>0)
      const key = `${date}|${id}`;
      const cur = acc.get(key) || { date, id, lastMinute: -1, dayQty: 0 };
      if (min > cur.lastMinute) cur.lastMinute = min;
      cur.dayQty += qty;
      acc.set(key, cur);
      dayRows++;
    }
    if (rows.length < body.page.pageSize) break;
    pageNo++;
    if (pageNo > 50) { console.warn(`  ${date} safety stop at 50 pages`); break; }
  }
  console.log(`  ${date}: aggregated ${dayRows} (item,minute) rows`);
}

const out = [...acc.values()]
  .filter(r => r.lastMinute >= 0)
  .map(r => ({ date: r.date, id: r.id, lastTime: fromMinute(r.lastMinute), lastMinute: r.lastMinute, dayQty: r.dayQty }));

const outFile = path.join(outDir, 'item-last-sale.json');
fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), dates, rows: out }, null, 2));
console.log(`[item-last-sale] wrote ${outFile} (${out.length} item-days)`);

await browser.close();
console.log('[item-last-sale] done');
