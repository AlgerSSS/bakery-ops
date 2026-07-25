import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';

const targetUrl = process.env.RESTOSUITE_URL || 'https://bo.sea.restosuite.ai/member-overview';

if (!fs.existsSync('storageState.json')) {
  console.error('storageState.json not found. Run `npm run login` first.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ storageState: 'storageState.json' });
const page = await context.newPage();

fs.mkdirSync('output', { recursive: true });
const apiLog = fs.createWriteStream('output/network.log', { flags: 'w' });
const capturedResponses = [];

page.on('response', async (response) => {
  const url = response.url();
  const ct = response.headers()['content-type'] || '';
  const method = response.request().method();
  const status = response.status();

  if (!/json|javascript|text/.test(ct)) return;
  if (/\.(js|css|png|jpg|svg|woff2?)(\?|$)/i.test(url)) return;

  apiLog.write(`${status} ${method} ${url} [${ct}]\n`);

  if (ct.includes('application/json')) {
    try {
      const body = await response.text();
      capturedResponses.push({ url, method, status, body });
    } catch {}
  }
});

console.log(`Opening ${targetUrl} ...`);
await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(3000);

console.log(`Current URL: ${page.url()}`);
console.log(`Title: ${await page.title()}`);

// Dump all tables found.
const tables = await page.$$eval('table', (ts) =>
  ts.map((t, i) => ({
    index: i,
    headers: Array.from(t.querySelectorAll('thead th, thead td')).map((c) => c.textContent.trim()),
    rowCount: t.querySelectorAll('tbody tr').length,
  }))
);

// Dump role=table / grid / list structures (antd, mui, etc.).
const grids = await page.$$eval('[role="table"], [role="grid"]', (els) =>
  els.map((el, i) => ({
    index: i,
    role: el.getAttribute('role'),
    className: el.className,
    rowCount: el.querySelectorAll('[role="row"]').length,
  }))
);

// Dump headings to help identify the section.
const headings = await page.$$eval('h1, h2, h3', (hs) => hs.map((h) => h.textContent.trim()).filter(Boolean));

const summary = {
  url: page.url(),
  title: await page.title(),
  headings,
  tables,
  grids,
  capturedJsonResponses: capturedResponses.map((r) => ({
    url: r.url,
    method: r.method,
    status: r.status,
    bodyPreview: r.body.slice(0, 400),
  })),
};

fs.writeFileSync('output/inspect-summary.json', JSON.stringify(summary, null, 2));
fs.writeFileSync('output/page.html', await page.content());
await page.screenshot({ path: 'output/page.png', fullPage: true });

// Save full JSON bodies separately for inspection.
fs.mkdirSync('output/api-responses', { recursive: true });
capturedResponses.forEach((r, i) => {
  const safe = r.url.replace(/[^a-z0-9]+/gi, '_').slice(-80);
  fs.writeFileSync(`output/api-responses/${i}_${safe}.json`, r.body);
});

console.log(`\nSaved:`);
console.log(`  output/inspect-summary.json  ${tables.length} tables, ${grids.length} grids, ${capturedResponses.length} JSON responses`);
console.log(`  output/page.html`);
console.log(`  output/page.png`);
console.log(`  output/network.log`);
console.log(`  output/api-responses/*.json`);

apiLog.end();
await browser.close();
