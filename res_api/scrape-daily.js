import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v]; }));

const SHOP_ID = args['shop-id'] || process.env.SHOP_ID || '406994127';
const stateFile = args['state-file'] || (SHOP_ID !== '406994127' ? `storageState-${SHOP_ID}.json` : 'storageState.json');
const outDir = args['out-dir'] || 'output/daily';

if (!fs.existsSync(stateFile)) {
  console.error(`${stateFile} not found. Run login first.`);
  process.exit(1);
}

const BASE = 'https://bo.sea.restosuite.ai';

const tz = 'Asia/Kuala_Lumpur';
const today = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
today.setHours(0, 0, 0, 0);
const from = new Date(today);
from.setDate(from.getDate() - 29);
const pad = (n) => String(n).padStart(2, '0');
const fmtDash = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtSlash = (d) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
const RANGE_DASH = [fmtDash(from), fmtDash(today)];
const RANGE_SLASH = [fmtSlash(from), fmtSlash(today)];
console.log(`[scrape-daily] date range: ${RANGE_DASH.join(' .. ')}`);

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: stateFile });
const page = await ctx.newPage();

let authHeaders = null;
page.on('request', (r) => {
  const h = r.headers();
  if (!authHeaders && h['vulcan-token']) authHeaders = h;
});
await page.goto(`${BASE}/report/report-sales-breakdown`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(4000);

if (!authHeaders) {
  console.error('[scrape-daily] failed to capture auth headers. Run npm run login.');
  await browser.close();
  process.exit(2);
}
if (!authHeaders['shop-id']) authHeaders['shop-id'] = SHOP_ID;
console.log('[scrape-daily] auth headers captured');

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
  }, { url: BASE + apiPath, body: payload, origHeaders: authHeaders });
}

function flattenCell(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && ('displayValue' in v || 'abbrDisplayValue' in v)) return v.value;
  return v;
}
function flattenRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = flattenCell(v);
  return out;
}

// Report 888001 uses dash format; report 123/198 use slash format
const filtersDash = [
  { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: RANGE_DASH },
  { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
  { fieldName: 'D_shopId', filterType: 'IN', filterValue: ['0', SHOP_ID] },
];
const filtersSlash = [
  { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: RANGE_SLASH },
  { fieldName: 'D_shopId', filterType: 'IN', filterValue: ['0', SHOP_ID] },
  { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
];

const queries = {
  // 30-day summary with payment channel breakdown
  summary: {
    reportId: '888001',
    selectFields: [
      'M_Order_COUNT_Orders', 'M_Order_SUM_guests',
      'M_Item_SUM_taxableAmount', 'M_Order_SUM_totalPromotionAmount',
      'M_Order_SUM_paymentPromotionAmount', 'M_Order_SUM_RoundingAmount',
      'M_Order_SUM_totalTax', 'M_Order_SUM_taxIncl',
      'M_Order_AVG_netSalesByOrder', 'M_Order_AVG_netSalesByGuest',
      'M_Order_SUM_grossSales_MultiTaxSys',
      'M_Order_SUM_grossSalesAfterDiscount_MultiTaxSys',
      'M_Order_SUM_netSales_MultiTaxSys',
      'M_Order_SUM_totalPaymentReceived_MultiTaxSys',
      'M_Order_SUM_totalSales_MultiTaxSys',
    ],
    metricsByDimQryV2: [
      { dims: [{ dim: 'D_payerType', displaySubTotal: true, enableSubtotalProportion: false }], metrics: 'M_OrderPayment_SUM_netPaymentAmount', fieldIndex: 16 },
      { dims: [{ dim: 'D_promotionSubType', displaySubTotal: true, enableSubtotalProportion: false }], metrics: 'M_DiscountPromotion_SUM_Amount', fieldIndex: 17 },
    ],
    aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
    filters: filtersDash,
    page: { pageNo: 1, pageSize: 500 }, orderBy: [],
  },

  // Hourly order breakdown (30 days aggregated by hour)
  hourly: {
    reportId: '888001',
    selectFields: [
      'D_hours', 'M_Order_COUNT_Orders', 'M_Order_SUM_guests',
      'M_Order_AVG_netSalesByOrder', 'M_Order_AVG_netSalesByGuest',
      'M_Order_SUM_grossSales_MultiTaxSys', 'M_Order_SUM_netSales_MultiTaxSys',
      'M_Order_SUM_totalPromotionAmount',
    ],
    metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
    filters: filtersDash,
    page: { pageNo: 1, pageSize: 500 }, orderBy: [{ D_hours: 'ASC' }],
  },

  // Per-day per-hour order breakdown (date × hour)
  hourlyByDate: {
    reportId: '888001',
    selectFields: [
      'D_businessDate', 'D_hours',
      'M_Order_COUNT_Orders', 'M_Order_SUM_guests',
      'M_Order_AVG_netSalesByOrder',
      'M_Order_SUM_grossSales_MultiTaxSys', 'M_Order_SUM_netSales_MultiTaxSys',
      'M_Order_SUM_totalPromotionAmount',
    ],
    metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
    filters: filtersDash,
    page: { pageNo: 1, pageSize: 5000 }, orderBy: [{ D_businessDate: 'DESC' }, { D_hours: 'ASC' }],
  },

  // Payment channel breakdown (report 198 uses slash)
  payment: {
    reportId: '198',
    selectFields: ['M_OrderPayment_SUM_merchantReceiveAmount', 'D_payerType'],
    metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
    filters: filtersSlash,
    page: { pageNo: 1, pageSize: 500 }, orderBy: [],
  },

  // Top items (report 211 uses dash)
  items: {
    reportId: '211',
    selectFields: ['D_menuItemId', 'D_itemName', 'D_unit', 'M_Item_SUM_netQty', 'M_Item_SUM_netSales', 'M_Item_SUM_grossSales', 'M_Item_SUM_discountProm'],
    metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
    filters: [
      { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: RANGE_DASH },
      { fieldName: 'D_itemType', filterType: 'IN', filterValue: ['0', '2'] },
      { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
      { fieldName: 'D_shopId', filterType: 'IN', filterValue: [SHOP_ID] },
    ],
    page: { pageNo: 1, pageSize: 500 }, orderBy: [{ M_Item_SUM_netSales: 'DESC' }],
  },

  // Items by hour (report 211 uses dash)
  itemsByHour: {
    reportId: '211',
    selectFields: ['D_itemName', 'D_unit', 'D_hours', 'M_Item_SUM_netQty', 'M_Item_SUM_netSales', 'M_Item_SUM_grossSales', 'M_Item_SUM_discountProm'],
    metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
    filters: [
      { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: RANGE_DASH },
      { fieldName: 'D_itemType', filterType: 'IN', filterValue: ['0', '2'] },
      { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
      { fieldName: 'D_shopId', filterType: 'IN', filterValue: [SHOP_ID] },
    ],
    page: { pageNo: 1, pageSize: 5000 }, orderBy: [{ D_hours: 'ASC' }, { M_Item_SUM_netSales: 'DESC' }],
  },

  // Per-day per-hour per-item (date × hour × item) — the full granularity
  itemsByDateHour: {
    reportId: '211',
    selectFields: ['D_businessDate', 'D_itemName', 'D_hours', 'M_Item_SUM_netQty', 'M_Item_SUM_netSales', 'M_Item_SUM_grossSales'],
    metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
    filters: [
      { fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: RANGE_DASH },
      { fieldName: 'D_itemType', filterType: 'IN', filterValue: ['0', '2'] },
      { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
      { fieldName: 'D_shopId', filterType: 'IN', filterValue: [SHOP_ID] },
    ],
    page: { pageNo: 1, pageSize: 50000 }, orderBy: [{ D_businessDate: 'DESC' }, { D_hours: 'ASC' }],
  },

  // Dining option (report 123 uses slash)
  diningOption: {
    reportId: '123',
    selectFields: ['M_Order_COUNT_Orders', 'M_Order_SUM_netSales', 'D_diningOption'],
    metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
    filters: filtersSlash,
    page: { pageNo: 1, pageSize: 500 }, orderBy: [],
  },

  // Item waste/loss (report 100280, uses dash format for D_date)
  itemWaste: {
    reportId: '100280',
    selectFields: ['D_date', 'D_itemName', 'D_damageReason', 'M_LossItem_SUM_damageQty', 'M_LossItem_SUM_damageAmount'],
    metricsByDimQryV2: [], aggFilters: [], proportionProperty: { enable: false }, dimAdditionalStrategy: [],
    filters: [
      { fieldName: 'D_date', filterType: 'RANGE', filterValue: RANGE_DASH },
      { fieldName: 'D_currency', filterType: 'EQ', filterValue: ['MYR'] },
      { fieldName: 'D_shopId', filterType: 'IN', filterValue: [SHOP_ID] },
    ],
    page: { pageNo: 1, pageSize: 5000 }, orderBy: [{ D_date: 'DESC' }],
  },
};

// PLACEHOLDER_RESULTS

// 核心销售数据：任一失败都不能让 pipeline 继续 sync（否则脏/缺数据入库）。
// itemWaste(100280) 等增强报表可缺失，不计入必需。
const REQUIRED_QUERIES = ['summary', 'hourly', 'items'];
const failedRequired = [];

const results = {};

for (const [name, body] of Object.entries(queries)) {
  console.log(`  querying: ${name}`);
  const r = await callApi('/api/report/data/queryData', body);
  if (r.status !== 200 || r.body?.code !== '000') {
    console.error(`  ${name} failed: status=${r.status} code=${r.body?.code} msg=${r.body?.msg}`);
    results[name] = { error: true, status: r.status, code: r.body?.code, msg: r.body?.msg };
    if (REQUIRED_QUERIES.includes(name)) failedRequired.push(name);
    continue;
  }
  const data = r.body?.data;
  const rows = data?.rows || data?.list || (Array.isArray(data) ? data : null);
  if (rows) {
    results[name] = rows.map(flattenRow);
  } else if (data && typeof data === 'object') {
    results[name] = [flattenRow(data)];
  } else {
    results[name] = [];
  }
  console.log(`  ${name}: ${results[name].length} rows`);
}

const PAYER_TYPE_MAP = {
  externalBankCard: 'Bank Card',
  cash: 'Cash',
  msBalance: 'Membership Card',
  grabVoucher30: 'Grab Voucher',
  customVoucher200RM: 'TikTok Voucher 200RM',
  customVoucher50RM: 'TikTok Voucher 50RM',
  customVoucher100RM: 'TikTok Voucher 100RM',
};

function translatePayerType(code) {
  if (PAYER_TYPE_MAP[code]) return PAYER_TYPE_MAP[code];
  if (/touch.*go|tng/i.test(code)) return "Touch 'n Go";
  if (/grab/i.test(code)) return 'Grab';
  return code;
}

const DINING_MAP = { '10': 'Dine-in', '20': 'Takeaway', '30': 'Delivery', '40': 'Pickup' };

const output = { dateRange: RANGE_DASH, scrapedAt: new Date().toISOString() };

// Summary
if (Array.isArray(results.summary) && results.summary.length) {
  const s = results.summary[0];
  const grossSales = Number(s.M_Order_SUM_grossSales_MultiTaxSys) || 0;
  const netSales = Number(s.M_Order_SUM_netSales_MultiTaxSys) || 0;
  const discount = Number(s.M_Order_SUM_totalPromotionAmount) || 0;
  const payDiscount = Number(s.M_Order_SUM_paymentPromotionAmount) || 0;
  const totalDiscount = discount + payDiscount;

  output.summary = {
    billCount: Number(s.M_Order_COUNT_Orders) || 0,
    guestCount: Number(s.M_Order_SUM_guests) || 0,
    avgTicket: Number(s.M_Order_AVG_netSalesByOrder) || 0,
    avgPerGuest: Number(s.M_Order_AVG_netSalesByGuest) || 0,
    grossSales,
    netSales,
    totalDiscount,
    discountRate: grossSales > 0 ? +(totalDiscount / grossSales * 100).toFixed(2) : 0,
    tax: Number(s.M_Order_SUM_totalTax) || 0,
    totalPaymentReceived: Number(s.M_Order_SUM_totalPaymentReceived_MultiTaxSys) || 0,
  };

  const paymentChannels = {};
  let memberPayment = 0;
  for (const [k, v] of Object.entries(s)) {
    const m = k.match(/^M_OrderPayment_SUM_netPaymentAmount_BY_D_payerType_(.+)$/);
    if (m) {
      const amount = Number(v) || 0;
      const channel = translatePayerType(m[1]);
      paymentChannels[channel] = (paymentChannels[channel] || 0) + amount;
      if (/membership|member/i.test(channel)) memberPayment += amount;
    }
  }
  const totalChannelPayment = Object.values(paymentChannels).reduce((a, b) => a + b, 0);
  output.summary.paymentChannels = Object.entries(paymentChannels)
    .map(([channel, amount]) => ({ channel, amount: +amount.toFixed(2), pct: totalChannelPayment > 0 ? +((amount / totalChannelPayment) * 100).toFixed(2) : 0 }))
    .sort((a, b) => b.amount - a.amount);
  output.summary.memberSalesRatio = totalChannelPayment > 0 ? +((memberPayment / totalChannelPayment) * 100).toFixed(2) : 0;
}

// Hourly
if (Array.isArray(results.hourly)) {
  output.hourly = results.hourly.map((r) => ({
    hour: r.D_hours,
    billCount: Number(r.M_Order_COUNT_Orders) || 0,
    guests: Number(r.M_Order_SUM_guests) || 0,
    avgTicket: Number(r.M_Order_AVG_netSalesByOrder) || 0,
    grossSales: Number(r.M_Order_SUM_grossSales_MultiTaxSys) || 0,
    netSales: Number(r.M_Order_SUM_netSales_MultiTaxSys) || 0,
    discount: Number(r.M_Order_SUM_totalPromotionAmount) || 0,
  }));
}

// Payment breakdown (report 198)
if (Array.isArray(results.payment)) {
  const total = results.payment.reduce((a, r) => a + (Number(r.M_OrderPayment_SUM_merchantReceiveAmount) || 0), 0);
  output.paymentBreakdown = results.payment.map((r) => {
    const amount = Number(r.M_OrderPayment_SUM_merchantReceiveAmount) || 0;
    return { channel: translatePayerType(r.D_payerType || ''), amount: +amount.toFixed(2), pct: total > 0 ? +((amount / total) * 100).toFixed(2) : 0 };
  }).sort((a, b) => b.amount - a.amount);
}

// Top items
if (Array.isArray(results.items)) {
  output.topItems = results.items.slice(0, 50).map((r) => ({
    name: r.D_itemName, unit: r.D_unit,
    qty: Number(r.M_Item_SUM_netQty) || 0,
    netSales: Number(r.M_Item_SUM_netSales) || 0,
    grossSales: Number(r.M_Item_SUM_grossSales) || 0,
    discount: Number(r.M_Item_SUM_discountProm) || 0,
  }));
}

// Items by hour
if (Array.isArray(results.itemsByHour)) {
  output.itemsByHour = results.itemsByHour.map((r) => ({
    name: r.D_itemName, unit: r.D_unit, hour: r.D_hours,
    qty: Number(r.M_Item_SUM_netQty) || 0,
    netSales: Number(r.M_Item_SUM_netSales) || 0,
  }));
}

// Dining option
if (Array.isArray(results.diningOption)) {
  output.diningOption = results.diningOption.map((r) => ({
    type: DINING_MAP[r.D_diningOption] || r.D_diningOption,
    billCount: Number(r.M_Order_COUNT_Orders) || 0,
    netSales: Number(r.M_Order_SUM_netSales) || 0,
  }));
}

// Hourly by date (date × hour order data)
if (Array.isArray(results.hourlyByDate)) {
  output.hourlyByDate = results.hourlyByDate.map((r) => ({
    date: r.D_businessDate,
    hour: r.D_hours,
    billCount: Number(r.M_Order_COUNT_Orders) || 0,
    guests: Number(r.M_Order_SUM_guests) || 0,
    avgTicket: Number(r.M_Order_AVG_netSalesByOrder) || 0,
    grossSales: Number(r.M_Order_SUM_grossSales_MultiTaxSys) || 0,
    netSales: Number(r.M_Order_SUM_netSales_MultiTaxSys) || 0,
    discount: Number(r.M_Order_SUM_totalPromotionAmount) || 0,
  }));
}

// Items by date × hour (per-day per-hour per-item)
if (Array.isArray(results.itemsByDateHour)) {
  output.itemsByDateHour = results.itemsByDateHour.map((r) => ({
    date: r.D_businessDate,
    name: r.D_itemName,
    hour: r.D_hours,
    qty: Number(r.M_Item_SUM_netQty) || 0,
    netSales: Number(r.M_Item_SUM_netSales) || 0,
    grossSales: Number(r.M_Item_SUM_grossSales) || 0,
  }));
}

// Item waste (per-day per-item with reason)
if (Array.isArray(results.itemWaste)) {
  output.itemWaste = results.itemWaste.map((r) => ({
    date: r.D_date,
    name: r.D_itemName,
    reason: r.D_damageReason,
    qty: Number(r.M_LossItem_SUM_damageQty) || 0,
    amount: Number(r.M_LossItem_SUM_damageAmount) || 0,
  }));
}

fs.writeFileSync(path.join(outDir, 'daily.json'), JSON.stringify(output, null, 2));
console.log(`[scrape-daily] saved output/daily/daily.json`);

await browser.close();
console.log('[scrape-daily] done');

// 必需查询失败时以非零退出，使 scheduler / refresh 链在 sync-to-db 之前中止，
// 避免把残缺数据同步入库（daily.json 仍已写出，供排查）。
if (failedRequired.length) {
  console.error(`[scrape-daily] ABORT: required quer${failedRequired.length > 1 ? 'ies' : 'y'} failed: ${failedRequired.join(', ')}. Halting before sync.`);
  process.exit(1);
}
