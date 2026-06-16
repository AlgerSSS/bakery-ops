// Scan many report pages, open them, capture reportId + metadata, look for reports
// whose dimList includes both an item dim (D_menuItemId/D_itemName) and an hour/period dim.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: 'storageState.json' });

const candidates = [
  '/report/report-overview',
  '/report/report-sales-breakdown',
  '/report/report-sales-orders',
  '/report/report-items-breakdowm',
  '/report/report-items-breakdowm-detail',
  '/report/report-click-analysis',
  '/report/report-dish-specifications',
  '/report/report-package-summary',
  '/report/report-dish-activity',
  '/report/report-gift-statistics',
  '/report/report-kbs-dish',
  '/report/report-taste-method',
  '/report/report-sales-taxes',
  '/report/report-sales-surcharges',
  '/report/report-regional-table',
];

const BASE = 'https://bo.sea.restosuite.ai';

for (const route of candidates) {
  const page = await ctx.newPage();
  const seen = new Set();
  const metas = [];
  page.on('response', async (r) => {
    const ct = r.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!/\/api\/report\/metadata\/get$/.test(r.url())) return;
    try {
      const body = JSON.parse(await r.text());
      const d = body?.data;
      if (!d) return;
      const rid = d.reportId;
      if (seen.has(rid)) return;
      seen.add(rid);
      metas.push({ rid, title: d.reportTitle, dims: (d.dimList || []).map(x => x.reportFieldName) });
    } catch {}
  });
  try {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
  } catch {}
  for (const m of metas) {
    const hasItem = m.dims.some(d => /menuItem|itemName|item_id/i.test(d));
    const hasHour = m.dims.some(d => /hour|period|timeSlot|meal|time$/i.test(d));
    const star = hasItem && hasHour ? ' *** ITEM×HOUR ***' : hasHour ? ' (has hour)' : hasItem ? ' (has item)' : '';
    console.log(route.padEnd(44), 'rid=' + m.rid.padEnd(8), m.title, star);
  }
  await page.close();
}
await browser.close();
