import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v]; }));

const email = args.email || process.env.HC_EMAIL || process.env.RESTOSUITE_EMAIL;
const password = args.password || process.env.HC_PASSWORD || process.env.RESTOSUITE_PASSWORD;
const shopId = args['shop-id'] || process.env.SHOP_ID || '';
const stateFile = shopId ? `storageState-${shopId}.json` : 'storageState.json';

if (!email || !password) {
  console.error('Missing credentials. Pass --email=x --password=x or set RESTOSUITE_EMAIL/RESTOSUITE_PASSWORD in .env');
  process.exit(1);
}

const targetUrl = process.env.RESTOSUITE_URL || 'https://bo.sea.restosuite.ai/member-overview';
const HEADLESS = process.env.HEADLESS !== 'false';

const browser = await chromium.launch({ headless: HEADLESS });
const context = await browser.newContext();
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[page error]', msg.text());
});

console.log(`[login] opening ${targetUrl}`);
// 60s 超时(默认 30s 在网络慢/从睡眠唤醒时易超时);失败再重试一次。
try {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (e) {
  console.log(`[login] goto retry after: ${e.message}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
}
await page.waitForLoadState('networkidle').catch(() => {});
console.log(`[login] landed on ${page.url()}`);

fs.mkdirSync('output', { recursive: true });

const onLoginPage = /login|signin|auth/i.test(page.url());
if (!onLoginPage) {
  console.log('[login] already authenticated, skipping form fill');
} else {
  // Step 1: username + Next
  console.log('[login] step 1: filling username');
  const usernameInput = page.locator('#username, input[name="username"]').first();
  await usernameInput.waitFor({ timeout: 15000 });
  await usernameInput.fill(email);

  const nextBtn = page.locator('button[type="submit"]:has-text("Next"), button:has-text("Next")').first();
  await nextBtn.click();
  console.log('[login] Next clicked');

  // Step 2: wait for password field to appear
  console.log('[login] step 2: waiting for password field');
  const passwordInput = page.locator('input[type="password"]').first();
  try {
    await passwordInput.waitFor({ timeout: 15000, state: 'visible' });
  } catch (e) {
    await page.screenshot({ path: 'output/login-step2-missing-password.png', fullPage: true });
    const errorTexts = await page
      .locator('[role="alert"], .ant-message, .ant-form-item-explain-error, .error, [class*="error" i]')
      .allTextContents()
      .catch(() => []);
    console.error('[login] password field did not appear. Errors:', errorTexts);
    await browser.close();
    process.exit(2);
  }

  await passwordInput.fill(password);
  console.log('[login] password filled');

  const loginBtn = page
    .locator('button[type="submit"], button:has-text("Log in"), button:has-text("Login"), button:has-text("Sign in"), button:has-text("登录")')
    .first();
  await loginBtn.click();
  console.log('[login] submit clicked');

  try {
    await page.waitForURL((url) => !/\/login/i.test(url.toString()), { timeout: 20000 });
  } catch {
    console.log('[login] URL did not change away from /login within 20s');
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
}

await page.screenshot({ path: 'output/after-login.png', fullPage: true });
const finalUrl = page.url();
console.log(`[login] final URL: ${finalUrl}`);
console.log(`[login] final title: ${await page.title()}`);

const stillOnLogin =
  /\/login/i.test(finalUrl) ||
  (await page.locator('input[type="password"]').count()) > 0;

if (stillOnLogin) {
  const errorTexts = await page
    .locator('[role="alert"], .ant-message, .ant-form-item-explain-error, .error, [class*="error" i]')
    .allTextContents()
    .catch(() => []);
  console.error('[login] login appears to have FAILED. Errors on page:', errorTexts);
  console.error('[login] See output/after-login.png for the rendered state.');
  await browser.close();
  process.exit(2);
}

await context.storageState({ path: stateFile });
console.log(`[login] saved ${stateFile}`);

await browser.close();
console.log('[login] done');
