import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: 'storageState.json' });
const page = await ctx.newPage();
let h = null;
page.on('request', (r) => { const x = r.headers(); if (!h && x['vulcan-token']) h = x; });
await page.goto('https://bo.sea.restosuite.ai/report/report-overview', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(3000);

const codes = [
  'PayerType', 'Payer', 'PaymentMethod', 'PayerTypeEnum', 'D_payerType',
  'DiningOption', 'DiningMethod', 'DiningType', 'OrderType', 'D_diningOption',
  'PromotionSubType', 'DiscountSubType', 'PromotionType', 'Promotion',
  'SurchargeType', 'ItemType', 'MenuItemType',
  'TaxName', 'Tax',
  'ParentCategory', 'FoodCategory', 'Category',
  'OrderSource', 'SourceType',
];
for (const code of codes) {
  const r = await page.evaluate(async ({ code, origHeaders }) => {
    const forbidden = new Set(['host','connection','content-length','cookie']);
    const headers = { 'content-type':'application/json', accept:'application/json, text/plain, */*' };
    for (const [k,v] of Object.entries(origHeaders||{})) if (!forbidden.has(k.toLowerCase())) headers[k]=v;
    const res = await fetch('https://bo.sea.restosuite.ai/operation-manager/object/field/enum/metadata/listFieldEnumValue', { method:'POST', credentials:'include', headers, body: JSON.stringify({ code }) });
    const t = await res.text();
    try { return { status: res.status, body: JSON.parse(t) }; } catch { return { status: res.status, body: t }; }
  }, { code, origHeaders: h });
  const data = r.body?.data;
  const sample = Array.isArray(data) ? data.slice(0,5).map(x => x.enumKeyName + '=' + x.enumValueName).join(' | ') : '';
  console.log(code.padEnd(22), r.status, 'code=', r.body?.code, 'count=', Array.isArray(data)?data.length:0, sample ? '| ' + sample : r.body?.msg || '');
}
await browser.close();
