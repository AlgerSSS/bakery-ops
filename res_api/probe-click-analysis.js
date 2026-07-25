import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: 'storageState.json' });
const page = await ctx.newPage();

const captured = [];
page.on('response', async (r) => {
  const ct = r.headers()['content-type'] || '';
  if (!ct.includes('application/json')) return;
  if (!r.url().includes('restosuite.ai')) return;
  try {
    const body = await r.text();
    let parsed; try { parsed = JSON.parse(body); } catch { return; }
    let reqBody = null; try { reqBody = r.request().postDataJSON(); } catch {}
    captured.push({ url: r.url(), method: r.request().method(), reqBody, body: parsed });
  } catch {}
});

await page.goto('https://bo.sea.restosuite.ai/report/report-click-analysis', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(8000);

fs.mkdirSync('output/probe-click', { recursive: true });
await page.screenshot({ path: 'output/probe-click/page.png', fullPage: true });

// Summarize report/data calls
const reportCalls = captured.filter(c => c.url.includes('/api/report/data/') || c.url.includes('/api/report/metadata/'));
console.log('report calls:', reportCalls.length);
for (const c of reportCalls) {
  const p = c.url.split('restosuite.ai')[1];
  const rid = c.reqBody?.reportId;
  const sel = c.reqBody?.selectFields?.slice(0, 8);
  const dims = (c.reqBody?.metricsByDimQryV2 || []).map(m => (m.dims || []).map(d => d.dim).join(',') + '->' + m.metrics);
  const dateFilter = (c.reqBody?.filters || []).find(f => f.fieldName === 'D_businessDate');
  console.log(' ', p, 'reportId=' + rid, 'date=' + JSON.stringify(dateFilter?.filterValue), 'sel=', sel, 'byDim=', dims);
}

// Also look for period-style dims in headings/dom
const h = await page.$$eval('h1, h2, h3, .ant-page-header-heading-title', hs => hs.map(x=>x.textContent.trim()).filter(Boolean).slice(0,10));
console.log('headings:', h);

// Dump metadata reportIds so we know available dims
const meta = captured.filter(c => c.url.endsWith('/api/report/metadata/get') && c.reqBody);
for (const m of meta) {
  const d = m.body?.data;
  if (!d) continue;
  const hourish = [...(d.dimList||[]), ...(d.metricsList||[])].filter(x => /hour|period|time|slot|\\u65f6\\u6bb5|\\u5206\\u65f6/i.test((x.reportFieldName||'') + (x.displayText||'')));
  console.log('reportId', m.reqBody.reportId, 'title=', d.reportTitle, 'hour-ish fields:', hourish.map(x=>x.reportFieldName + '('+x.displayText+')'));
}

await browser.close();
