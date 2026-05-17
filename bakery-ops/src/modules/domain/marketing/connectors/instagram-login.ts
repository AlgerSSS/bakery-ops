/**
 * Instagram 登录 — Phase 1 stub，仅支持手动登录
 *
 * 用法:
 *   npx tsx src/modules/domain/marketing/connectors/instagram-login.ts manual
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const SESSION_DIR = process.env.INSTAGRAM_SESSION_DIR || "./instagram-session";
const COOKIE_FILE = path.join(SESSION_DIR, "cookies.json");
const STORAGE_FILE = path.join(SESSION_DIR, "storage.json");
const LOGIN_URL = "https://www.instagram.com/accounts/login/";

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

async function manualLogin(): Promise<void> {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  console.log("  Opening browser for manual Instagram login...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  await waitForEnter("\n  After logging in, press Enter to save session...");

  await saveSession(context, page);
  await browser.close();
}

export async function refreshLogin(_forceManual?: boolean): Promise<boolean> {
  if (process.env.INSTAGRAM_LOGIN_DISABLED === "true") {
    console.log("=== Instagram Login: DISABLED via env ===");
    return false;
  }
  console.log("=== Instagram Login (manual only - Phase 1) ===");
  await manualLogin();
  console.log("  ✓ Manual login complete\n");
  return true;
}

if (require.main === module && !process.env.BUNDLED) {
  refreshLogin().catch(console.error);
}
