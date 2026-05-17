import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";
import { getCookieFile, getStorageFile } from "../modules/domain/recruitment/connectors/jobstreet-login";

async function main() {
  const cookies = JSON.parse(fs.readFileSync(getCookieFile(), "utf-8"));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    acceptDownloads: true,
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

  // 搜索
  await page.goto("https://my.employer.seek.com/talentsearch?searchQuery=bakery+staff+in+Kuala+Lumpur&market=MY", {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.waitForTimeout(12000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);

  // 获取 profile 链接
  const links = await page.$$eval("a[href]", (els) =>
    els.map((el) => el.getAttribute("href") || "").filter((h) => h.includes("/talentsearch/profiles/") && h.includes("market=MY")),
  );
  if (links.length === 0) { console.log("No profiles"); await browser.close(); return; }

  // 打开 profile
  const profileUrl = `https://my.employer.seek.com${links[0]}`;
  console.log("Opening:", profileUrl.slice(0, 120));

  // 捕获所有 GraphQL 请求和响应
  const allGql: Array<{ op: string; reqBody: string; resBody: string }> = [];
  page.on("request", (req) => {
    if (req.url().includes("/graphql") && req.method() === "POST") {
      const body = req.postData() || "";
      try {
        const parsed = JSON.parse(body);
        allGql.push({ op: parsed.operationName || "unknown", reqBody: body.slice(0, 500), resBody: "" });
      } catch {}
    }
  });
  page.on("response", async (res) => {
    if (!res.url().includes("/graphql")) return;
    try {
      const body = await res.text();
      // 找到对应的请求
      for (const g of allGql) {
        if (!g.resBody && body.includes(g.op)) {
          g.resBody = body.slice(0, 2000);
          break;
        }
      }
    } catch {}
  });

  await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);

  console.log("\n=== Before CV tab click ===");
  console.log(`GraphQL calls: ${allGql.length}`);
  allGql.forEach((g) => console.log(`  ${g.op}`));

  // 点击 CV preview tab
  const cvTab = page.locator("button:has-text('CV preview')").first();
  if (await cvTab.count() > 0) {
    // 清空记录
    const beforeCount = allGql.length;
    await cvTab.click();
    await page.waitForTimeout(8000);

    console.log("\n=== After CV tab click ===");
    const newCalls = allGql.slice(beforeCount);
    console.log(`New GraphQL calls: ${newCalls.length}`);
    newCalls.forEach((g) => {
      console.log(`\n--- ${g.op} ---`);
      console.log(`Request: ${g.reqBody.slice(0, 300)}`);
      console.log(`Response: ${g.resBody.slice(0, 1500)}`);
    });

    // 也检查是否有非 GraphQL 的 API 调用（可能是 REST API 获取 CV）
    console.log("\n=== Checking for download/CV URLs ===");
    const allRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("resume") || url.includes("cv") || url.includes("download") || url.includes("document")) {
        allRequests.push(`${req.method()} ${url.slice(0, 200)}`);
      }
    });

    // 点击 CV tab 再次触发
    const profileTab = page.locator("button:has-text('Profile')").first();
    if (await profileTab.count() > 0) {
      await profileTab.click();
      await page.waitForTimeout(2000);
      await cvTab.click();
      await page.waitForTimeout(5000);
    }

    console.log(`CV-related requests: ${allRequests.length}`);
    allRequests.forEach((r) => console.log(`  ${r}`));
  }

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
