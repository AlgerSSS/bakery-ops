/**
 * TikTok 登录 — 先自动尝试，失败则打开浏览器手动登录
 *
 * 用法:
 *   npx tsx src/modules/domain/marketing/connectors/tiktok-login.ts          # 自动
 *   npx tsx src/modules/domain/marketing/connectors/tiktok-login.ts manual   # 强制手动
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// 懒加载 stealth 插件：放在模块顶层会在 Next.js/Turbopack 的 instrumentation 导入阶段
// 触发依赖崩溃（utils.typeOf is not a function）。改为首次启动浏览器前再 use，行为不变。
let _stealthApplied = false;
function ensureStealth() {
  if (_stealthApplied) return;
  chromium.use(StealthPlugin());
  _stealthApplied = true;
}

const SESSION_DIR = process.env.TIKTOK_SESSION_DIR || "./tiktok-session";
const COOKIE_FILE = path.join(SESSION_DIR, "cookies.json");
const STORAGE_FILE = path.join(SESSION_DIR, "storage.json");
const LOGIN_URL = "https://www.tiktok.com/login/phone-or-email/email";

export function hasValidSession(): boolean {
  return fs.existsSync(COOKIE_FILE);
}

export function getSessionDir(): string {
  return SESSION_DIR;
}

export function getCookieFile(): string {
  return COOKIE_FILE;
}

export function getStorageFile(): string {
  return STORAGE_FILE;
}

async function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

async function saveSession(context: any, page: any) {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  const cookies = await context.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.log(`  Cookie saved (${cookies.length} cookies)`);

  const storage = await page.evaluate(() => {
    const data: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) data[key] = localStorage.getItem(key) || "";
    }
    return data;
  });
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(storage, null, 2));
  console.log("  Storage saved");
}

async function tryAutoLogin(): Promise<boolean> {
  const email = process.env.TIKTOK_EMAIL;
  const password = process.env.TIKTOK_PASSWORD;
  if (!email || !password) {
    console.log("  TIKTOK_EMAIL or TIKTOK_PASSWORD not configured, skipping auto-login");
    return false;
  }

  console.log("  Attempting auto-login...");

  let browser: any = null;
  try {
    ensureStealth();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // TikTok login flow: email → password → submit
    const emailField = await page.$('input[name="email"], input[type="email"]');
    if (!emailField) {
      console.log("  Login form not found, may be blocked by captcha");
      return false;
    }
    await emailField.fill(email);
    await page.waitForTimeout(1000);

    const passwordLink = await page.$('a:has-text("Log in with password")');
    if (passwordLink) {
      await passwordLink.click();
      await page.waitForTimeout(1500);
    }

    const passwordField = await page.$('input[type="password"]');
    if (passwordField) {
      await passwordField.fill(password);
      await page.waitForTimeout(1000);
    }

    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click();
    await page.waitForTimeout(8000);

    const currentUrl = page.url();
    const isLoggedIn = !currentUrl.includes("login") && currentUrl.includes("tiktok.com");

    if (isLoggedIn) {
      await saveSession(context, page);
      return true;
    }
    console.log(`  Login failed, redirected to: ${currentUrl.slice(0, 80)}`);
    return false;
  } catch (err) {
    console.log(`  Auto-login error: ${String(err).slice(0, 120)}`);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

async function manualLogin(): Promise<void> {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  console.log("  Opening browser for manual login...");
  ensureStealth();
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  await waitForEnter("\n  After logging in, press Enter to save session...");

  await saveSession(context, page);
  await browser.close();
}

// ========== Main ==========

export async function refreshLogin(forceManual = false): Promise<boolean> {
  console.log("=== TikTok Login ===");

  if (!forceManual) {
    const ok = await tryAutoLogin();
    if (ok) {
      console.log("  ✓ Auto-login successful\n");
      return true;
    }
    console.log("  Auto-login failed, switching to manual mode...\n");
  }

  await manualLogin();
  console.log("  ✓ Manual login complete\n");
  return true;
}

if (require.main === module && !process.env.BUNDLED) {
  const forceManual = process.argv.includes("manual");
  refreshLogin(forceManual).catch(console.error);
}
