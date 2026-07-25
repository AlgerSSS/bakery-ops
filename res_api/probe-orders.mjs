import { chromium } from 'playwright';
import fs from 'node:fs';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: 'storageState.json' });
const page = await ctx.newPage();

const SHOP_ID = '406994127';
let authHeaders = null;
page.on('request', (r) => {
  const h = r.headers();
  if (!authHeaders && h['vulcan-token']) authHeaders = h;
});

await page.goto('https://bo.sea.restosuite.ai/report/report-sales-breakdown', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(4000);

if (!authHeaders) { console.error('No auth headers'); await browser.close(); process.exit(1); }
if (!authHeaders['shop-id']) authHeaders['shop-id'] = SHOP_ID;
console.log('Auth captured');

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

const tz = 'Asia/Kuala_Lumpur';
const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
const pad = (n) => String(n).padStart(2, '0');
const yStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth()+1)}-${pad(yesterday.getDate())}`;

console.log('Testing date:', yStr);

// Strategy: use D_tableName as a proxy for individual orders
// Each table in each hour is likely one order
const query = {
  reportId: '888001',
  selectFields: [
    'D_businessDate', 'D_hours', 'D_tableName',
    'M_Order_COUNT_Orders',
    'M_Order_SUM_netSales_MultiTaxSys',
    'M_Order_SUM_grossSales_MultiTaxSys',
    'M_Order_SUM_totalPromotionAmount',
    'M_Order_SUM_guests',
  ],
  metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
  filters: [
    { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: [yStr, yStr] },
    { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
    { fieldName: 'D_shopId', filterType: 'IN', filterValue: ['0', SHOP_ID] },
  ],
  page: { pageNo: 1, pageSize: 5000 }, orderBy: [{ D_hours: 'ASC' }],
};

console.log('\n1. Query by D_businessDate + D_hours + D_tableName:');
const r1 = await callApi('/api/report/data/queryData', query);
console.log('status:', r1.status, 'code:', r1.body?.code);
const rows1 = r1.body?.data?.rows || [];
console.log('rows:', rows1.length);
if (rows1.length > 0) {
  console.log('sample rows:');
  for (const row of rows1.slice(0, 5)) {
    const flat = {};
    for (const [k, v] of Object.entries(row)) {
      flat[k] = v && typeof v === 'object' && 'value' in v ? v.value : v;
    }
    console.log(' ', JSON.stringify(flat));
  }
  // Check if bill_count is mostly 1 (meaning each row = 1 order)
  let singleBill = 0, multiBill = 0;
  for (const row of rows1) {
    const bc = row.M_Order_COUNT_Orders?.value ?? row.M_Order_COUNT_Orders ?? 0;
    if (Number(bc) === 1) singleBill++;
    else multiBill++;
  }
  console.log(`\nSingle-bill rows: ${singleBill}, Multi-bill rows: ${multiBill}`);
  console.log(`${(singleBill/(singleBill+multiBill)*100).toFixed(1)}% of rows are single orders`);
}

// Also try with D_time_hms for even finer granularity
const query2 = {
  reportId: '888001',
  selectFields: [
    'D_businessDate', 'D_time_hms', 'D_tableName',
    'M_Order_COUNT_Orders',
    'M_Order_SUM_netSales_MultiTaxSys',
    'M_Order_SUM_grossSales_MultiTaxSys',
    'M_Order_AVG_netSalesByOrder',
    'M_Order_SUM_guests',
  ],
  metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
  filters: [
    { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: [yStr, yStr] },
    { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
    { fieldName: 'D_shopId', filterType: 'IN', filterValue: ['0', SHOP_ID] },
  ],
  page: { pageNo: 1, pageSize: 5000 }, orderBy: [{ D_time_hms: 'ASC' }],
};

console.log('\n2. Query by D_businessDate + D_time_hms + D_tableName:');
const r2 = await callApi('/api/report/data/queryData', query2);
console.log('status:', r2.status, 'code:', r2.body?.code);
const rows2 = r2.body?.data?.rows || [];
console.log('rows:', rows2.length);
if (rows2.length > 0) {
  console.log('sample rows:');
  for (const row of rows2.slice(0, 5)) {
    const flat = {};
    for (const [k, v] of Object.entries(row)) {
      flat[k] = v && typeof v === 'object' && 'value' in v ? v.value : v;
    }
    console.log(' ', JSON.stringify(flat));
  }
  let singleBill = 0, multiBill = 0;
  for (const row of rows2) {
    const bc = row.M_Order_COUNT_Orders?.value ?? row.M_Order_COUNT_Orders ?? 0;
    if (Number(bc) === 1) singleBill++;
    else multiBill++;
  }
  console.log(`\nSingle-bill rows: ${singleBill}, Multi-bill rows: ${multiBill}`);
}

// Try with D_openedTime (exact open time per order)
const query3 = {
  reportId: '888001',
  selectFields: [
    'D_businessDate', 'D_openedTime',
    'M_Order_COUNT_Orders',
    'M_Order_SUM_netSales_MultiTaxSys',
    'M_Order_SUM_grossSales_MultiTaxSys',
    'M_Order_AVG_netSalesByOrder',
    'M_Order_SUM_guests',
  ],
  metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
  filters: [
    { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: [yStr, yStr] },
    { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
    { fieldName: 'D_shopId', filterType: 'IN', filterValue: ['0', SHOP_ID] },
  ],
  page: { pageNo: 1, pageSize: 5000 }, orderBy: [{ D_openedTime: 'ASC' }],
};

console.log('\n3. Query by D_businessDate + D_openedTime:');
const r3 = await callApi('/api/report/data/queryData', query3);
console.log('status:', r3.status, 'code:', r3.body?.code);
const rows3 = r3.body?.data?.rows || [];
console.log('rows:', rows3.length);
if (rows3.length > 0) {
  console.log('sample rows:');
  for (const row of rows3.slice(0, 8)) {
    const flat = {};
    for (const [k, v] of Object.entries(row)) {
      flat[k] = v && typeof v === 'object' && 'value' in v ? v.value : v;
    }
    console.log(' ', JSON.stringify(flat));
  }
  let singleBill = 0, multiBill = 0;
  for (const row of rows3) {
    const bc = row.M_Order_COUNT_Orders?.value ?? row.M_Order_COUNT_Orders ?? 0;
    if (Number(bc) === 1) singleBill++;
    else multiBill++;
  }
  console.log(`\nSingle-bill rows: ${singleBill}, Multi-bill rows: ${multiBill}`);
}

await browser.close();
console.log('\ndone');
