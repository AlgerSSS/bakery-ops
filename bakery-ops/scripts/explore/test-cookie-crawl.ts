import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";
import { getCookieFile, getStorageFile } from "../modules/domain/recruitment/connectors/jobstreet-login";

async function main() {
  const cookieFile = getCookieFile();
  if (!fs.existsSync(cookieFile)) {
    console.error("No cookies found. Run jobstreet-login.ts first.");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });

  // 加载 Cookie
  const cookies = JSON.parse(fs.readFileSync(cookieFile, "utf-8"));
  await context.addCookies(cookies);
  console.log(`Loaded ${cookies.length} cookies`);

  // 加载 localStorage
  const storageFile = getStorageFile();
  if (fs.existsSync(storageFile)) {
    const storage = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
    await context.addInitScript((data: Record<string, string>) => {
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, storage);
    console.log("Loaded localStorage");
  }

  const page = await context.newPage();

  // Step 1: 验证登录状态
  console.log("\n=== Step 1: Verify login ===");
  await page.goto("https://my.employer.seek.com/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);
  const homeUrl = page.url();
  console.log("Home URL:", homeUrl.slice(0, 120));
  console.log("Title:", await page.title());
  const isLoggedIn =
    !homeUrl.includes("login") &&
    !homeUrl.includes("oauth") &&
    !homeUrl.includes("authenticate");
  console.log("Logged in:", isLoggedIn);
  await page.screenshot({ path: "/tmp/seek-cookie-home.png", fullPage: true });

  if (!isLoggedIn) {
    console.error("Cookie session invalid or expired!");
    await browser.close();
    process.exit(1);
  }

  // Step 2: Talent Search
  console.log("\n=== Step 2: Talent Search ===");
  // 先试 /talentsearch 页面
  await page.goto("https://my.employer.seek.com/talentsearch", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);
  console.log("Talent Search URL:", page.url().slice(0, 150));
  console.log("Talent Search Title:", await page.title());
  await page.screenshot({ path: "/tmp/seek-cookie-talentsearch.png", fullPage: true });

  // 查看页面上是否有搜索框
  const searchInputs = await page.$$eval("input", (els) =>
    els.map((el) => ({
      type: el.getAttribute("type") || "",
      name: el.getAttribute("name") || "",
      placeholder: el.getAttribute("placeholder") || "",
      id: el.getAttribute("id") || "",
      "aria-label": el.getAttribute("aria-label") || "",
    })),
  );
  console.log("Search inputs:", JSON.stringify(searchInputs, null, 2));

  // 尝试搜索
  const searchBox = await page.$('#searchInput');
  if (searchBox) {
    console.log("\nFound search box, typing query...");
    await searchBox.fill("bakery staff");
    await page.waitForTimeout(1000);
    // 用 Enter 键提交搜索
    await searchBox.press("Enter");
    await page.waitForTimeout(8000);
    console.log("After search URL:", page.url().slice(0, 200));
    console.log("After search Title:", await page.title());
    await page.screenshot({ path: "/tmp/seek-cookie-search-results.png", fullPage: true });
  } else {
    console.log("No search box found on talent search page");
  }

  // 也试试 Candidate Matches
  console.log("\n=== Step 2b: Candidate Matches ===");
  await page.goto("https://my.employer.seek.com/talentsearch/search/job", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);
  console.log("Candidate Matches URL:", page.url().slice(0, 150));
  console.log("Candidate Matches Title:", await page.title());
  await page.screenshot({ path: "/tmp/seek-cookie-candidate-matches.png", fullPage: true });

  // Step 3: 提取候选人链接
  console.log("\n=== Step 3: Extract candidate links ===");
  const allLinks = await page.$$eval("a[href]", (els) =>
    els.map((el) => ({
      href: el.getAttribute("href") || "",
      text: el.textContent?.trim().slice(0, 80) || "",
    })),
  );
  console.log(`Total links on page: ${allLinks.length}`);

  // 查找候选人相关链接
  const candidateLinks = allLinks.filter(
    (l) =>
      l.href.includes("/talent/") ||
      l.href.includes("/profile/") ||
      l.href.includes("/candidate/") ||
      l.href.includes("/resume/"),
  );
  console.log(`Candidate-related links: ${candidateLinks.length}`);
  candidateLinks.slice(0, 15).forEach((c) =>
    console.log(`  ${c.href.slice(0, 100)} — ${c.text}`),
  );

  // 也打印所有链接的 href 模式，帮助调试
  if (candidateLinks.length === 0) {
    console.log("\nAll link hrefs (for debugging):");
    const uniquePatterns = new Set<string>();
    for (const l of allLinks) {
      const pattern = l.href.replace(/[a-f0-9-]{8,}/g, "{id}").slice(0, 100);
      if (!uniquePatterns.has(pattern)) {
        uniquePatterns.add(pattern);
        console.log(`  ${l.href.slice(0, 120)} — ${l.text.slice(0, 50)}`);
      }
    }
  }

  // Step 4: 页面 HTML 结构分析
  console.log("\n=== Step 4: Page structure ===");
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "");
  console.log("Page text preview:\n", bodyText.slice(0, 1500));

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
