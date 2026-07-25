// 单品 → 菜单分类映射（reportId=211，D_itemName + D_category 维度）。
// 用途：财务分析网站的品类口径改用菜单管理的官方分类（7.7 财务反馈）。
// 输出 output/sales/item-menu-category.json：[{ en, category, qty }]
// 一单品挂多分类时，优先真实品类（排除 TOP榜/会员价/套餐/其他 等营销分类），再按销量取大。
import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://bo.sea.restosuite.ai';
const SHOP_ID = process.env.SHOP_ID || '406994127';

if (!fs.existsSync('storageState.json')) {
  console.error('storageState.json not found. Run `npm run login` first.');
  process.exit(1);
}

const tz = 'Asia/Kuala_Lumpur';
const today = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const FROM = '2025-12-01';                    // 覆盖全部历史在售单品
const TO = fmt(today);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: 'storageState.json' });
const page = await ctx.newPage();

let authHeaders = null, shopIdFromHeaders = null;
let template = null;   // 捕获真实 211 queryData 请求作为重放模板
page.on('request', (r) => {
  const h = r.headers();
  if (!authHeaders && h['vulcan-token']) authHeaders = h;
  if (!shopIdFromHeaders && h['shop-id']) shopIdFromHeaders = h['shop-id'];
  if (!template && /\/api\/report\/data\/queryData/.test(r.url())) {
    try {
      const b = r.postDataJSON();
      if (b && b.selectFields) template = { url: r.url(), body: b, headers: h };
    } catch {}
  }
});
await page.goto(`${BASE}/report/report-items-breakdowm`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(9000);
if (!authHeaders || !template) { console.error('未捕获鉴权头或211请求模板，请先 npm run login'); await browser.close(); process.exit(1); }
if (!authHeaders['shop-id']) authHeaders['shop-id'] = shopIdFromHeaders || SHOP_ID;
const shopId = authHeaders['shop-id'];
console.log('[item-category] auth ok, range', FROM, '~', TO);

async function callApi(apiPath, payload) {
  return page.evaluate(async ({ url, body, origHeaders }) => {
    const forbidden = new Set(['host', 'connection', 'content-length', 'cookie']);
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/plain, */*' };
    for (const [k, v] of Object.entries(origHeaders || {})) if (!forbidden.has(k.toLowerCase())) headers[k] = v;
    const r = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
    const text = await r.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    return { status: r.status, body: parsed };
  }, { url: BASE + apiPath, body: payload, origHeaders: template.headers });
}
const cell = (v) => (v && typeof v === 'object' && 'value' in v) ? v.value : v;

const body = JSON.parse(JSON.stringify(template.body));
body.reportId = '211';
body.selectFields = ['D_itemName', 'D_category', 'M_Item_SUM_netQty'];
body.filters = (body.filters || []).filter(f => !['D_businessDate', 'D_compare_businessDate'].includes(f.fieldName));
body.filters.push({ fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: [FROM, TO] });
body.page = { pageNo: 1, pageSize: 5000 };
if (body.orderBy) body.orderBy = [];

const pairs = [];   // {itemId, catId, qty}
let pageNo = 1;
while (true) {
  body.page.pageNo = pageNo;
  const r = await callApi('/api/report/data/queryData', body);
  if (r.status !== 200 || r.body?.code !== '000') {
    console.error(`page ${pageNo} FAILED: ${r.status} ${r.body?.code} ${r.body?.msg || ''}`);
    break;
  }
  const rows = r.body?.data?.rows || [];
  for (const row of rows) {
    pairs.push({
      itemId: cell(row.D_itemName),
      catId: cell(row.D_category),
      qty: Number(cell(row.M_Item_SUM_netQty)) || 0,
    });
  }
  if (rows.length < 5000) break;
  pageNo++;
}
await browser.close();
console.log('原始 单品×分类 行:', pairs.length);

/* 翻译 id → 名称 */
const t = JSON.parse(fs.readFileSync('output/sales/translations.json', 'utf8'));
const nameMap = t.dimOptions?.D_itemName || {};
const catMap = t.dimOptions?.D_category || {};
const MARKETING = /TOP list|Membership|套餐|其他/i;   // 营销/聚合分类，仅在无真实品类时兜底

const byItem = new Map();
for (const p of pairs) {
  const en = (nameMap[p.itemId] || '').trim();
  const cat = (catMap[p.catId] || '').trim();
  if (!en || !cat) continue;
  const o = byItem.get(en) || [];
  o.push({ cat, qty: p.qty });
  byItem.set(en, o);
}
const result = [];
for (const [en, list] of byItem) {
  const real = list.filter(x => !MARKETING.test(x.cat));
  const pool = real.length ? real : list;
  pool.sort((a, b) => b.qty - a.qty);
  result.push({ en, category: pool[0].cat, qty: pool[0].qty });
}
fs.writeFileSync('output/sales/item-menu-category.json', JSON.stringify(result, null, 1));
console.log('单品菜单分类映射:', result.length, '个单品');
const dist = {};
result.forEach(r => dist[r.category] = (dist[r.category] || 0) + 1);
console.log('分类分布:', JSON.stringify(dist, null, 1));