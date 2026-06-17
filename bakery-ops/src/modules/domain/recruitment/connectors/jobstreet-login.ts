/**
 * JobStreet 雇主端自动登录（使用 stealth 插件绕过 Turnstile）
 *
 * 用法:
 *   npx tsx src/modules/domain/recruitment/connectors/jobstreet-login.ts
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";

// 懒加载 stealth 插件：放在模块顶层会在 Next.js/Turbopack 的 instrumentation 导入阶段
// 触发依赖崩溃（utils.typeOf is not a function）。改为首次启动浏览器前再 use，行为不变。
let _stealthApplied = false;
function ensureStealth() {
  if (_stealthApplied) return;
  chromium.use(StealthPlugin());
  _stealthApplied = true;
}

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

async function saveSession(context: any, page: any) {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  const cookies = await context.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));

  try {
    const storage = await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) data[key] = localStorage.getItem(key) || "";
      }
      return data;
    });
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(storage, null, 2));
  } catch {}
}

export async function refreshLogin(): Promise<boolean> {
  const email = process.env.JOBSTREET_EMAIL;
  const password = process.env.JOBSTREET_PASSWORD;
  if (!email || !password) {
    console.log("JOBSTREET_EMAIL 或 JOBSTREET_PASSWORD 未配置");
    return false;
  }

  let browser: any = null;
  try {
    ensureStealth();
    browser = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
      ],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    // 填写邮箱
    const emailField = await page.$('input[type="email"], input[name="emailAddress"], input[name="email"]');
    if (!emailField) {
      console.log("未找到邮箱输入框");
      return false;
    }
    await emailField.click();
    await page.waitForTimeout(300);
    await emailField.type(email, { delay: 50 });
    await page.waitForTimeout(500);

    // 填写密码
    const passwordField = await page.$('input[type="password"], input[name="password"]');
    if (!passwordField) {
      console.log("未找到密码输入框");
      return false;
    }
    await passwordField.click();
    await page.waitForTimeout(300);
    await passwordField.type(password, { delay: 50 });
    await page.waitForTimeout(1000);

    // 等待 Turnstile 自动通过（stealth 模式下通常能自动完成）
    await page.waitForTimeout(5000);

    // 提交
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click();

    // 等待登录完成（最多 15 秒）
    try {
      await page.waitForURL((url: URL) => {
        const s = url.toString();
        return !s.includes("login") && !s.includes("authenticate") && !s.includes("oauth");
      }, { timeout: 15000 });
    } catch {
      const currentUrl = page.url();
      console.log(`登录超时，当前 URL: ${currentUrl.slice(0, 100)}`);
      return false;
    }

    await page.waitForTimeout(2000);
    // 等待页面稳定后再保存 session
    try {
      await page.waitForLoadState("networkidle", { timeout: 10000 });
    } catch {}
    await saveSession(context, page);
    return true;
  } catch (err) {
    console.log(`自动登录异常: ${String(err).slice(0, 150)}`);
    return false;
  } finally {
    if (browser) await browser.close();
  }
}
