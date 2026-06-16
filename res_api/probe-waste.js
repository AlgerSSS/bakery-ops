import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://bo.sea.restosuite.ai';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ storageState: 'storageState.json' });
const page = await ctx.newPage();

const captured = [];
page.on('response', async (response) => {
  const url = response.url();
  const ct = response.headers()['content-type'] || '';
  if (!ct.includes('application/json')) return;
  if (!url.includes('restosuite.ai')) return;
  try {
    const body = await response.text();
    let parsed;
    try { parsed = JSON.parse(body); } catch { return; }
    let reqBody = null;
    try { reqBody = response.request().postDataJSON(); } catch {}
    captured.push({ url, method: response.request().method(), reqBody, bodyPreview: JSON.stringify(parsed).slice(0, 500) });
  } catch {}
});

// Try various possible URLs for waste/loss/damage reports
const candidates = [
  '/data-insight/abnormal',
  '/data-insight/dish-loss',
  '/data-insight/waste',
  '/report/report-dish-activity',
  '/insight/abnormal',
  '/insight/dish-loss',
  '/loss/report',
  '/waste/report',
];

// First, let's navigate to the main page and look for menu items
console.log('Navigating to home to find menu structure...');
await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(3000);

// Try to find navigation links related to waste/loss
const links = await page.evaluate(() => {
  const allLinks = Array.from(document.querySelectorAll('a[href], [data-path], .menu-item, .nav-item'));
  return allLinks.map(el => ({
    text: el.textContent?.trim().slice(0, 50),
    href: el.getAttribute('href') || el.getAttribute('data-path') || '',
  })).filter(l => l.href || l.text);
});

console.log('\nAll navigation links found:');
const relevant = links.filter(l =>
  /报损|报废|损耗|waste|loss|damage|异常|洞察|insight/i.test(l.text + l.href)
);
if (relevant.length) {
  console.log('Relevant links:');
  relevant.forEach(l => console.log(`  ${l.text} -> ${l.href}`));
} else {
  console.log('No direct waste/loss links found. Showing all menu items:');
  const menuItems = links.filter(l => l.href && l.href.startsWith('/'));
  menuItems.slice(0, 30).forEach(l => console.log(`  ${l.text} -> ${l.href}`));
}

// Try the candidates
for (const path of candidates) {
  console.log(`\nTrying: ${BASE}${path}`);
  try {
    const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const status = resp?.status();
    const finalUrl = page.url();
    console.log(`  status: ${status}, landed: ${finalUrl}`);
    if (status === 200 && !finalUrl.includes('/404') && !finalUrl.includes('/login')) {
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3000);
      console.log(`  ✓ Page loaded! Captured ${captured.length} API calls`);
      break;
    }
  } catch (e) {
    console.log(`  ✗ ${e.message.slice(0, 80)}`);
  }
}

// Save captured API calls
if (captured.length) {
  fs.mkdirSync('output/waste-probe', { recursive: true });
  fs.writeFileSync('output/waste-probe/captured.json', JSON.stringify(captured, null, 2));
  console.log(`\nSaved ${captured.length} captured API calls to output/waste-probe/captured.json`);
  // Show report-related calls
  const reportCalls = captured.filter(c => /report|waste|loss|damage|item/i.test(c.url));
  console.log('\nReport-related API calls:');
  reportCalls.forEach(c => console.log(`  ${c.method} ${c.url.replace(BASE, '')}`));
}

await browser.close();
