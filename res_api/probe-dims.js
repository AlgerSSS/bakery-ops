import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: 'storageState.json' });
const page = await ctx.newPage();
let h = null;
page.on('request', (r) => { const x = r.headers(); if (!h && x['vulcan-token']) h = x; });
await page.goto('https://bo.sea.restosuite.ai/report/report-overview', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(3000);

const tests = [
  ['D_payerType', '198'],
  ['D_payerType', '123'],
  ['D_payerType', '888001'],
  ['D_shopName', '123'],
  ['D_shopId', '123'],
  ['D_diningOption', '123'],
  ['D_parentCategory', '211'],
  ['D_promotionSubType', '888001'],
  ['D_surchargeType', '888001'],
  ['D_taxName', '888001'],
  ['D_foodCategory', '211'],
  ['D_unit', '211'],
];

for (const [dim, rid] of tests) {
  const r = await page.evaluate(async ({ dim, rid, origHeaders }) => {
    const forbidden = new Set(['host','connection','content-length','cookie']);
    const headers = { 'content-type':'application/json', accept:'application/json, text/plain, */*' };
    for (const [k,v] of Object.entries(origHeaders||{})) if (!forbidden.has(k.toLowerCase())) headers[k]=v;
    const body = { corporationId: origHeaders['corporation-id'], dimCode: [dim], shopIds: [origHeaders['shop-id']], reportId: rid };
    const res = await fetch('https://bo.sea.restosuite.ai/api/report/dim/getDimOptions', { method:'POST', credentials:'include', headers, body: JSON.stringify(body) });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
  }, { dim, rid, origHeaders: h });
  const list = r.body?.data?.list?.[0];
  console.log(dim.padEnd(30), 'reportId='+rid, '=>', r.status, 'body=', JSON.stringify(r.body).slice(0, 400));
}
await browser.close();
