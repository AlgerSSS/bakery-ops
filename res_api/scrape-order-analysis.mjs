import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';

const SHOP_ID = process.env.SHOP_ID || '406994127';
const stateFile = 'storageState.json';

if (!fs.existsSync(stateFile)) {
  console.error(`${stateFile} not found. Run login first.`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: stateFile });
const page = await ctx.newPage();

let authHeaders = null;
page.on('request', (r) => {
  const h = r.headers();
  if (!authHeaders && h['vulcan-token']) authHeaders = h;
});

await page.goto('https://bo.sea.restosuite.ai/report/report-sales-breakdown', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(4000);

if (!authHeaders) {
  console.error('Failed to capture auth headers. Run npm run login.');
  await browser.close();
  process.exit(1);
}
if (!authHeaders['shop-id']) authHeaders['shop-id'] = SHOP_ID;
console.log('[order-analysis] auth captured');

async function callApi(apiPath, payload) {
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
  }, { url: 'https://bo.sea.restosuite.ai' + apiPath, body: payload, origHeaders: authHeaders });
}

function flattenCell(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) return v.value;
  return v;
}

const tz = 'Asia/Kuala_Lumpur';
const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

const today = new Date(now); today.setHours(0,0,0,0);
const from = new Date(today); from.setDate(from.getDate() - 29);

console.log(`[order-analysis] fetching per-order data: ${fmtDate(from)} .. ${fmtDate(today)}`);

// Fetch day by day to avoid hitting row limits
const allOrders = [];
const current = new Date(from);

while (current <= today) {
  const dateStr = fmtDate(current);
  const query = {
    reportId: '888001',
    selectFields: [
      'D_businessDate', 'D_openedTime',
      'M_Order_COUNT_Orders',
      'M_Order_SUM_netSales_MultiTaxSys',
      'M_Order_SUM_grossSales_MultiTaxSys',
      'M_Order_SUM_totalPromotionAmount',
      'M_Order_SUM_guests',
    ],
    metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
    filters: [
      { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: [dateStr, dateStr] },
      { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
      { fieldName: 'D_shopId', filterType: 'IN', filterValue: ['0', SHOP_ID] },
    ],
    page: { pageNo: 1, pageSize: 5000 }, orderBy: [{ D_openedTime: 'ASC' }],
  };

  const r = await callApi('/api/report/data/queryData', query);
  if (r.status !== 200 || r.body?.code !== '000') {
    console.error(`  ${dateStr}: FAILED (${r.body?.code} ${r.body?.msg})`);
    current.setDate(current.getDate() + 1);
    continue;
  }

  const rows = (r.body?.data?.rows || []).map(row => {
    const flat = {};
    for (const [k, v] of Object.entries(row)) flat[k] = flattenCell(v);
    return flat;
  });

  // Filter to actual orders (bill_count >= 1, net_sales > 0)
  const orders = rows.filter(r => Number(r.M_Order_COUNT_Orders) >= 1 && Number(r.M_Order_SUM_netSales_MultiTaxSys) > 0);

  for (const o of orders) {
    allOrders.push({
      date: dateStr,
      openedTime: o.D_openedTime,
      netSales: Number(o.M_Order_SUM_netSales_MultiTaxSys),
      grossSales: Number(o.M_Order_SUM_grossSales_MultiTaxSys),
      discount: Number(o.M_Order_SUM_totalPromotionAmount) || 0,
      guests: Number(o.M_Order_SUM_guests) || 1,
      billCount: Number(o.M_Order_COUNT_Orders),
    });
  }

  process.stdout.write(`  ${dateStr}: ${orders.length} orders\n`);
  current.setDate(current.getDate() + 1);
}

console.log(`\n[order-analysis] Total orders fetched: ${allOrders.length}`);

// === Analysis ===
console.log('\n' + '='.repeat(60));
console.log('客单价分析 (基于 Net Sales per order)');
console.log('='.repeat(60));

// Per-day analysis
const byDate = {};
for (const o of allOrders) {
  if (!byDate[o.date]) byDate[o.date] = [];
  byDate[o.date].push(o);
}

console.log('\n日期       | 总单数 | >=50单数 | >=50占比 | >=69单数 | >=69占比 | 日均客单价');
console.log('-'.repeat(85));

const dates = Object.keys(byDate).sort();
let totalAll = 0, totalAbove50 = 0, totalAbove69 = 0;

for (const date of dates) {
  const orders = byDate[date];
  const total = orders.length;
  const above50 = orders.filter(o => o.netSales >= 50).length;
  const above69 = orders.filter(o => o.netSales >= 69).length;
  const avgTicket = (orders.reduce((s, o) => s + o.netSales, 0) / total).toFixed(1);

  totalAll += total;
  totalAbove50 += above50;
  totalAbove69 += above69;

  console.log(
    `${date} | ${String(total).padStart(5)} | ${String(above50).padStart(7)} | ${(above50/total*100).toFixed(1).padStart(5)}% | ${String(above69).padStart(7)} | ${(above69/total*100).toFixed(1).padStart(5)}% | RM ${avgTicket}`
  );
}

console.log('-'.repeat(85));
console.log(
  `${'汇总'.padEnd(8)} | ${String(totalAll).padStart(5)} | ${String(totalAbove50).padStart(7)} | ${(totalAbove50/totalAll*100).toFixed(1).padStart(5)}% | ${String(totalAbove69).padStart(7)} | ${(totalAbove69/totalAll*100).toFixed(1).padStart(5)}% |`
);

console.log('\n=== 最近30天汇总 ===');
console.log(`总有效订单数: ${totalAll}`);
console.log(`客单价 >= RM50 的订单: ${totalAbove50} (${(totalAbove50/totalAll*100).toFixed(1)}%)`);
console.log(`客单价 >= RM69 的订单: ${totalAbove69} (${(totalAbove69/totalAll*100).toFixed(1)}%)`);
console.log(`平均客单价: RM ${(allOrders.reduce((s, o) => s + o.netSales, 0) / totalAll).toFixed(2)}`);

// Distribution
console.log('\n=== 客单价分布 ===');
const brackets = [
  [0, 20], [20, 30], [30, 40], [40, 50], [50, 60], [60, 69], [69, 80], [80, 100], [100, 150], [150, Infinity]
];
for (const [lo, hi] of brackets) {
  const count = allOrders.filter(o => o.netSales >= lo && o.netSales < hi).length;
  const pct = (count / totalAll * 100).toFixed(1);
  const bar = '#'.repeat(Math.round(count / totalAll * 50));
  const label = hi === Infinity ? `RM${lo}+` : `RM${lo}-${hi}`;
  console.log(`${label.padEnd(12)} | ${String(count).padStart(5)} | ${pct.padStart(5)}% | ${bar}`);
}

// Save raw data
fs.mkdirSync('output/orders', { recursive: true });
fs.writeFileSync('output/orders/order_analysis.json', JSON.stringify({
  dateRange: [fmtDate(from), fmtDate(today)],
  analyzedAt: new Date().toISOString(),
  totalOrders: totalAll,
  above50: { count: totalAbove50, pct: +(totalAbove50/totalAll*100).toFixed(1) },
  above69: { count: totalAbove69, pct: +(totalAbove69/totalAll*100).toFixed(1) },
  avgTicket: +(allOrders.reduce((s, o) => s + o.netSales, 0) / totalAll).toFixed(2),
  dailyBreakdown: dates.map(date => {
    const orders = byDate[date];
    const total = orders.length;
    return {
      date,
      totalOrders: total,
      above50: orders.filter(o => o.netSales >= 50).length,
      above50Pct: +(orders.filter(o => o.netSales >= 50).length / total * 100).toFixed(1),
      above69: orders.filter(o => o.netSales >= 69).length,
      above69Pct: +(orders.filter(o => o.netSales >= 69).length / total * 100).toFixed(1),
      avgTicket: +(orders.reduce((s, o) => s + o.netSales, 0) / total).toFixed(2),
    };
  }),
  orders: allOrders,
}, null, 2));

console.log('\n[order-analysis] saved output/orders/order_analysis.json');

await browser.close();
console.log('[order-analysis] done');
