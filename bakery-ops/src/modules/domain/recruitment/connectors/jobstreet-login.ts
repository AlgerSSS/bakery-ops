/**
 * JobStreet 雇主端登录 — 先自动尝试，失败则打开浏览器手动登录
 *
 * 用法:
 *   npx tsx src/modules/domain/recruitment/connectors/jobstreet-login.ts          # 自动
 *   npx tsx src/modules/domain/recruitment/connectors/jobstreet-login.ts manual   # 强制手动
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const SESSION_DIR = process.env.JOBSTREET_SESSION_DIR || "./jobstreet-session";
const COOKIE_FILE = path.join(SESSION_DIR, "cookies.json");
const STORAGE_FILE = path.join(SESSION_DIR, "storage.json");
const LOGIN_URL = "https://my.employer.seek.com/oauth/login/";

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
  console.log(`  Cookie 已保存 (${cookies.length} cookies)`);

  const storage = await page.evaluate(() => {
    const data: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) data[key] = localStorage.getItem(key) || "";
    }
    return data;
  });
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(storage, null, 2));
  console.log(`  Storage 已保存`);
}

async function tryAutoLogin(): Promise<boolean> {
  const email = process.env.JOBSTREET_EMAIL;
  const password = process.env.JOBSTREET_PASSWORD;
  if (!email || !password) {
    console.log("  JOBSTREET_EMAIL 或 JOBSTREET_PASSWORD 未配置，跳过自动登录");
    return false;
  }

  console.log("  尝试自动登录...");

  let browser: any = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 填写邮箱和密码
    const emailField = await page.$('input[type="email"], input[name="emailAddress"]');
    const passwordField = await page.$('input[type="password"], input[name="password"]');
    if (!emailField || !passwordField) {
      console.log("  未找到登录表单，可能被 Turnstile 拦截");
      return false;
    }

    await emailField.fill(email);
    await passwordField.fill(password);
    await page.waitForTimeout(1000);

    // 等待 Turnstile（如果存在的话会自动验证）
    await page.waitForTimeout(3000);

    // 提交
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click();
    await page.waitForTimeout(8000);

    const currentUrl = page.url();
    const isLoggedIn = !currentUrl.includes("login") && !currentUrl.includes("authenticate");

    if (isLoggedIn) {
      await saveSession(context, page);
      return true;
    }
    console.log(`  登录失败，重定向到: ${currentUrl.slice(0, 80)}`);
    return false;
  } catch (err) {
    console.log(`  自动登录异常: ${String(err).slice(0, 100)}`);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

async function manualLogin(): Promise<void> {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  console.log("  打开浏览器，请手动完成登录...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  await waitForEnter("\n  登录完成后按 Enter 保存 Cookie...");

  await saveSession(context, page);
  await browser.close();
}

// ========== 主入口 ==========

export async function refreshLogin(forceManual = false): Promise<boolean> {
  console.log("=== JobStreet 登录 ===");

  if (!forceManual) {
    const autoOk = await tryAutoLogin();
    if (autoOk) {
      console.log("  ✓ 自动登录成功\n");
      return true;
    }
    console.log("  自动登录失败（JobStreet 有 reCAPTCHA 保护）\n");

    // bundled 模式下不弹手动浏览器
    if (process.env.BUNDLED) {
      console.log("  跳过手动登录（后台模式）。请手动运行: npx tsx src/modules/domain/recruitment/connectors/jobstreet-login.ts manual\n");
      return false;
    }
  }

  await manualLogin();
  console.log("  ✓ 手动登录完成\n");
  return true;
}

if (require.main === module && !process.env.BUNDLED) {
  const forceManual = process.argv.includes("manual");
  refreshLogin(forceManual).catch(console.error);
}
