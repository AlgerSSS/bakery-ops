/**
 * One-off interactive JobStreet/SEEK employer re-login (headed) to refresh jobstreet-session/.
 * Reads JOBSTREET_EMAIL / JOBSTREET_PASSWORD from .env. Never prints credentials.
 *   npx tsx scripts/explore/jobstreet-relogin.ts
 */
import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";

chromium.use(StealthPlugin());

const SESSION_DIR = process.env.JOBSTREET_SESSION_DIR || "./jobstreet-session";
const COOKIE_FILE = path.join(SESSION_DIR, "cookies.json");
const STORAGE_FILE = path.join(SESSION_DIR, "storage.json");
const LOGIN_URL = "https://my.employer.seek.com/oauth/login/";
const HOME_URL = "https://my.employer.seek.com/";
const shot = (n: string) => `/tmp/js_${n}.png`;
const log = (...a: unknown[]) => console.log("[relogin]", ...a);

function onAuthPage(u: string) {
  return u.includes("/login") || u.includes("authenticate.seek.com") || u.includes("/oauth/");
}

async function saveSession(context: any, page: any) {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  try {
    const storage = await page.evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) data[k] = localStorage.getItem(k) || "";
      }
      return data;
    });
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(storage, null, 2));
  } catch {}
  log(`saved ${cookies.length} cookies -> ${COOKIE_FILE}`);
}

async function main() {
  const email = process.env.JOBSTREET_EMAIL;
  const password = process.env.JOBSTREET_PASSWORD;
  if (!email || !password) { log("MISSING_CREDS"); return; }
  log("login as (masked):", email.replace(/(.).*(@.*)/, "$1***$2"));

  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1300, height: 900 },
    locale: "en-MY",
  });
  const page = await context.newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#emailAddress", { timeout: 30000 });
    await page.waitForTimeout(1500);

    await page.fill("#emailAddress", email);
    await page.waitForTimeout(400);
    await page.fill("#password", password);
    await page.waitForTimeout(700);
    await page.screenshot({ path: shot("2_filled") }).catch(() => {});

    // Submit
    await Promise.all([
      page.click('button:has-text("Sign in"), button[type="submit"]'),
      page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}),
    ]);

    // Wait up to 40s for the auth flow to complete (Turnstile may run invisibly + redirect chain)
    let success = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(2000);
      const u = page.url();
      if (!onAuthPage(u)) { success = true; break; }
    }
    await page.waitForTimeout(2000).catch(() => {});
    await page.screenshot({ path: shot("3_after_submit"), fullPage: true }).catch(() => {});
    log("post-submit url=", page.url());

    if (!success) {
      // Surface what's blocking: error text / OTP / captcha
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 600) || "").catch(() => "");
      log("STILL_ON_AUTH. visible text snippet:\n", bodyText.replace(/\s+\n/g, "\n"));
      const hasOtp = /code|verif|otp|one[-\s]?time|check your email/i.test(bodyText);
      const hasErr = /incorrect|wrong|invalid|not match|try again/i.test(bodyText);
      log("signals:", JSON.stringify({ hasOtp, hasErr }));
      log("RESULT=BLOCKED");
      await browser.close();
      return;
    }

    // Land on the employer home + confirm a protected page loads (not bounced to login)
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.goto("https://my.employer.seek.com/job/managejob", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const finalUrl = page.url();
    await page.screenshot({ path: shot("4_managejob"), fullPage: true }).catch(() => {});
    log("managejob url=", finalUrl);

    if (onAuthPage(finalUrl)) {
      log("RESULT=BOUNCED_TO_LOGIN (session not durable)");
      await browser.close();
      return;
    }

    await saveSession(context, page);
    log("RESULT=SUCCESS");
  } catch (e) {
    log("ERROR:", String(e).slice(0, 300));
    await page.screenshot({ path: shot("9_error"), fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.log("[relogin] FATAL", String(e).slice(0, 300)); process.exit(1); });
