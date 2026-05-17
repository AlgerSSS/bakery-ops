/**
 * AJobThing 在招岗位 Discovery 脚本
 *
 * 用法: npx tsx src/__tests__/test-ajobthing-active-jobs-discovery.ts
 *
 * 尝试 /api/employer/jobs 等端点，拦截 /v4/manage-jobs 页面的 XHR 调用。
 */
import { chromium } from "playwright";
import * as fs from "fs";
import {
  getCookieFile,
  getStorageFile,
  hasValidSession,
} from "../modules/domain/recruitment/connectors/ajobthing-login";

const SITE_URL = "https://www.ajobthing.com";

async function main() {
  if (!hasValidSession()) {
    console.error("No valid AJobThing session. Run ajobthing-login.ts first.");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });

  const cookieFile = getCookieFile();
  if (fs.existsSync(cookieFile)) {
    await context.addCookies(JSON.parse(fs.readFileSync(cookieFile, "utf-8")));
  }

  const storageFile = getStorageFile();
  if (fs.existsSync(storageFile)) {
    const storage = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
    await context.addInitScript((data: Record<string, string>) => {
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, storage);
  }

  const page = await context.newPage();

  const intercepted: { url: string; method: string; status: number; preview: string }[] = [];

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/api/") || url.includes("/v4/") || url.includes("employer")) {
      try {
        const json = await response.json();
        const entry = {
          url,
          method: response.request().method(),
          status: response.status(),
          preview: JSON.stringify(json).slice(0, 500),
        };
        intercepted.push(entry);
        console.log("\n=== Intercepted ===");
        console.log(`URL: ${url}`);
        console.log(`Status: ${response.status()}`);
        console.log(`Preview: ${JSON.stringify(json).slice(0, 300)}`);
        console.log("===\n");
      } catch { /* not JSON */ }
    }
  });

  // Step 1: 尝试直接 API
  console.log("\n=== Step 1: Try API endpoints ===\n");

  const apiEndpoints = [
    "/api/employer/jobs",
    "/api/v1/employer/jobs",
    "/api/v2/employer/jobs",
    "/api/employer/dashboard",
  ];

  for (const endpoint of apiEndpoints) {
    try {
      const resp = await page.goto(`${SITE_URL}${endpoint}`, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });
      console.log(`${endpoint}: ${resp?.status()} ${resp?.statusText()}`);
      if (resp && resp.ok()) {
        try {
          const body = await resp.json();
          console.log(`  Response: ${JSON.stringify(body).slice(0, 200)}`);
        } catch {
          console.log("  (not JSON)");
        }
      }
    } catch (err) {
      console.log(`${endpoint}: ERROR - ${err}`);
    }
  }

  // Step 2: 导航到管理页面
  console.log("\n=== Step 2: Navigate to /v4/manage-jobs ===\n");
  await page.goto(`${SITE_URL}/v4/manage-jobs`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);

  console.log(`Current URL: ${page.url()}`);
  console.log(`Total intercepted: ${intercepted.length}`);

  // 打印页面上的岗位信息
  const cards = await page.$$("[class*='job'], [class*='Job'], .card, tr");
  console.log(`\nFound ${cards.length} potential elements`);
  for (const card of cards.slice(0, 10)) {
    const text = await card.textContent();
    const className = await card.getAttribute("class");
    console.log(`  - [${(className || "").slice(0, 50)}] ${(text || "").slice(0, 100)}`);
  }

  // 保存拦截数据
  fs.writeFileSync(
    "./ajobthing-discovery-output.json",
    JSON.stringify(intercepted, null, 2),
  );
  console.log("\nFull intercepted data saved to ajobthing-discovery-output.json");

  console.log("\nBrowser is open. Inspect the page manually.");
  console.log("Press Ctrl+C to exit.\n");

  await new Promise(() => {});
}

main().catch(console.error);
