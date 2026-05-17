/**
 * JobStreet 在招岗位 Discovery 脚本
 *
 * 用法: npx tsx src/__tests__/test-jobstreet-active-jobs-discovery.ts
 *
 * 导航到 /job/managejob，拦截所有 GraphQL 调用，打印 query 名称和响应结构。
 * 然后导航到某个岗位的申请者页面，继续拦截。
 */
import { chromium } from "playwright";
import * as fs from "fs";
import {
  getCookieFile,
  getStorageFile,
  hasValidSession,
} from "../modules/domain/recruitment/connectors/jobstreet-login";

const SITE_URL = "https://my.employer.seek.com";

async function main() {
  if (!hasValidSession()) {
    console.error("No valid JobStreet session. Run jobstreet-login.ts first.");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    acceptDownloads: true,
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

  // 拦截所有网络请求
  const intercepted: { url: string; method: string; body?: unknown }[] = [];

  page.on("response", async (response) => {
    const url = response.url();
    const request = response.request();

    if (url.includes("graphql") || url.includes("/api/")) {
      try {
        const json = await response.json();
        const postData = request.postData();
        let parsedPost: unknown;
        try {
          parsedPost = postData ? JSON.parse(postData) : null;
        } catch {
          parsedPost = postData;
        }

        const entry = {
          url,
          method: request.method(),
          requestBody: parsedPost,
          responseKeys: typeof json === "object" && json ? Object.keys(json) : [],
          responsePreview: JSON.stringify(json).slice(0, 500),
        };

        intercepted.push(entry);
        console.log("\n=== Intercepted ===");
        console.log(`URL: ${url}`);
        console.log(`Method: ${request.method()}`);
        if (parsedPost && typeof parsedPost === "object" && "operationName" in (parsedPost as Record<string, unknown>)) {
          console.log(`Operation: ${(parsedPost as Record<string, unknown>).operationName}`);
        }
        console.log(`Response preview: ${JSON.stringify(json).slice(0, 300)}`);
        console.log("===\n");
      } catch { /* not JSON */ }
    }
  });

  console.log("\n=== Step 1: Navigate to /job/managejob ===\n");
  await page.goto(`${SITE_URL}/job/managejob`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(8000);

  console.log(`\nCurrent URL: ${page.url()}`);
  console.log(`Total intercepted: ${intercepted.length}`);

  // 打印页面上的岗位信息
  const pageContent = await page.content();
  console.log(`\nPage title: ${await page.title()}`);
  console.log(`Page content length: ${pageContent.length}`);

  // 尝试找到岗位卡片
  const cards = await page.$$("[data-testid], .job-card, [class*='Job'], [class*='job']");
  console.log(`\nFound ${cards.length} potential job elements`);
  for (const card of cards.slice(0, 5)) {
    const text = await card.textContent();
    const testId = await card.getAttribute("data-testid");
    console.log(`  - [${testId || "no-testid"}] ${(text || "").slice(0, 100)}`);
  }

  // 保存完整的拦截数据
  fs.writeFileSync(
    "./jobstreet-discovery-output.json",
    JSON.stringify(intercepted, null, 2),
  );
  console.log("\nFull intercepted data saved to jobstreet-discovery-output.json");

  // 等待用户查看
  console.log("\nBrowser is open. Inspect the page manually.");
  console.log("Press Ctrl+C to exit.\n");

  // 保持浏览器打开
  await new Promise(() => {});
}

main().catch(console.error);
