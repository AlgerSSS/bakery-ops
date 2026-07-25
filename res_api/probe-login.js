import { chromium } from 'playwright';
import fs from 'node:fs';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto('https://bo.sea.restosuite.ai/member-overview', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(2000);

console.log('URL:', page.url());
console.log('Title:', await page.title());

fs.mkdirSync('output', { recursive: true });
fs.writeFileSync('output/login-page.html', await page.content());
await page.screenshot({ path: 'output/login-page.png', fullPage: true });

const inputs = await page.$$eval('input', (els) =>
  els.map((el) => ({
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
    autocomplete: el.autocomplete,
    ariaLabel: el.getAttribute('aria-label'),
    visible: el.offsetParent !== null,
  }))
);
const buttons = await page.$$eval('button', (els) =>
  els.map((el) => ({
    type: el.type,
    text: el.textContent.trim().slice(0, 80),
    ariaLabel: el.getAttribute('aria-label'),
    visible: el.offsetParent !== null,
  }))
);
const forms = await page.$$eval('form', (els) =>
  els.map((el) => ({ action: el.action, id: el.id, className: el.className }))
);

console.log('\n=== inputs ===');
console.log(JSON.stringify(inputs, null, 2));
console.log('\n=== buttons ===');
console.log(JSON.stringify(buttons, null, 2));
console.log('\n=== forms ===');
console.log(JSON.stringify(forms, null, 2));

await browser.close();
