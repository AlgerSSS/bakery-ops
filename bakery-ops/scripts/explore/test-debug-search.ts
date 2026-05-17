import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";
import { getCookieFile, getStorageFile } from "../modules/domain/recruitment/connectors/jobstreet-login";

async function main() {
  const cookies = JSON.parse(fs.readFileSync(getCookieFile(), "utf-8"));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  await context.addCookies(cookies);

  const storageFile = getStorageFile();
  if (fs.existsSync(storageFile)) {
    const storage = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
    await context.addInitScript((data: Record<string, string>) => {
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, storage);
  }

  const page = await context.newPage();

  // 监听所有网络请求，捕获 API 调用
  const apiCalls: Array<{ url: string; method: string; status?: number; body?: string }> = [];
  page.on("request", (req) => {
    const url = req.url();
    if (
      url.includes("api") ||
      url.includes("graphql") ||
      url.includes("talent") ||
      url.includes("search")
    ) {
      apiCalls.push({ url: url.slice(0, 200), method: req.method(), body: req.postData()?.slice(0, 500) });
    }
  });
  page.on("response", (res) => {
    const url = res.url();
    if (
      url.includes("api") ||
      url.includes("graphql") ||
      url.includes("talent") ||
      url.includes("search")
    ) {
      const existing = apiCalls.find((c) => url.startsWith(c.url.slice(0, 50)));
      if (existing) existing.status = res.status();
    }
  });

  // Step 1: 打开 Talent Search
  console.log("=== Opening Talent Search ===");
  await page.goto("https://my.employer.seek.com/talentsearch", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  console.log("URL:", page.url());
  console.log("Title:", await page.title());

  // 检查页面是否有错误或权限提示
  const pageText = await page.evaluate(() => document.body?.innerText || "");
  if (pageText.includes("not authorised") || pageText.includes("error") || pageText.includes("upgrade")) {
    console.log("\n!!! Page contains error/auth message:");
    console.log(pageText.slice(0, 500));
  }

  // Step 2: 搜索
  console.log("\n=== Searching ===");
  const searchInput = await page.$("#searchInput");
  if (searchInput) {
    await searchInput.fill("bakery staff");
    await page.waitForTimeout(500);
    await searchInput.press("Enter");
    console.log("Search submitted, waiting for results...");

    // 等待网络请求完成
    await page.waitForTimeout(10000);

    console.log("URL after search:", page.url().slice(0, 200));
    console.log("Title after search:", await page.title());
    await page.screenshot({ path: "/tmp/seek-debug-after-search.png", fullPage: true });

    // 检查搜索结果区域
    const resultText = await page.evaluate(() => document.body?.innerText || "");
    console.log("\nPage text after search (first 2000 chars):");
    console.log(resultText.slice(0, 2000));

    // 查找所有链接
    const links = await page.$$eval("a[href]", (els) =>
      els.map((el) => ({
        href: el.getAttribute("href") || "",
        text: el.textContent?.trim().slice(0, 60) || "",
      })),
    );
    console.log(`\nTotal links: ${links.length}`);

    // 打印所有非导航链接
    const contentLinks = links.filter(
      (l) =>
        !l.href.startsWith("#") &&
        !l.href.includes("/dashboard") &&
        !l.href.includes("/jobs") &&
        !l.href.includes("/products") &&
        !l.href.includes("/hiring-advice") &&
        !l.href.includes("/market-insights") &&
        !l.href.includes("/account") &&
        !l.href.includes("/invoicing") &&
        !l.href.includes("/contactus") &&
        !l.href.includes("/oauth") &&
        !l.href.includes("/privacy") &&
        !l.href.includes("/support") &&
        !l.href.includes("/security") &&
        l.text.length > 0,
    );
    console.log(`Content links: ${contentLinks.length}`);
    contentLinks.forEach((l) => console.log(`  ${l.href.slice(0, 120)} — ${l.text}`));
  } else {
    console.log("No search input found!");
    await page.screenshot({ path: "/tmp/seek-debug-no-input.png", fullPage: true });
  }

  // Step 3: 打印捕获的 API 调用
  console.log("\n=== API calls captured ===");
  apiCalls.forEach((c) => {
    console.log(`  ${c.method} ${c.url} → ${c.status || "pending"}`);
    if (c.body) console.log(`    body: ${c.body.slice(0, 200)}`);
  });

  // Step 4: 也试试直接访问 /talentsearch/search/profiles 或类似路径
  console.log("\n=== Trying alternative paths ===");
  const altPaths = [
    "/talentsearch/search",
    "/talentsearch/search/profiles",
    "/talentsearch/profiles",
  ];
  for (const p of altPaths) {
    await page.goto(`https://my.employer.seek.com${p}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    }).catch(() => {});
    await page.waitForTimeout(2000);
    const url = page.url();
    const title = await page.title();
    console.log(`  ${p} → ${url.slice(0, 100)} (${title})`);
  }

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
