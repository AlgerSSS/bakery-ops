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

  // 监听 GraphQL 响应
  const graphqlResponses: Array<{ op: string; status: number; data: string }> = [];
  page.on("response", async (res) => {
    if (res.url().includes("/graphql")) {
      try {
        const body = await res.text();
        const parsed = JSON.parse(body);
        const op = parsed?.data ? Object.keys(parsed.data)[0] : "unknown";
        graphqlResponses.push({
          op,
          status: res.status(),
          data: body.slice(0, 1000),
        });
      } catch {}
    }
  });

  // 用 URL 参数直接搜索
  const searchUrl =
    "https://my.employer.seek.com/talentsearch?searchQuery=bakery+staff+in+Kuala+Lumpur&market=MY";
  console.log("=== Direct URL search ===");
  console.log("URL:", searchUrl);
  await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);

  console.log("Final URL:", page.url().slice(0, 200));
  console.log("Title:", await page.title());
  await page.screenshot({ path: "/tmp/seek-direct-search.png", fullPage: true });

  // 页面文本
  const text = await page.evaluate(() => document.body?.innerText || "");
  console.log("\nPage text (first 3000 chars):");
  console.log(text.slice(0, 3000));

  // 所有链接
  const links = await page.$$eval("a[href]", (els) =>
    els
      .map((el) => ({
        href: el.getAttribute("href") || "",
        text: el.textContent?.trim().slice(0, 80) || "",
      }))
      .filter(
        (l) =>
          l.text.length > 0 &&
          !l.href.startsWith("#") &&
          !l.href.includes("/dashboard") &&
          !l.href.includes("/jobs?") &&
          !l.href.includes("/products") &&
          !l.href.includes("/hiring-advice") &&
          !l.href.includes("/market-insights") &&
          !l.href.includes("/account") &&
          !l.href.includes("/invoicing") &&
          !l.href.includes("/contactus") &&
          !l.href.includes("/oauth") &&
          !l.href.includes("/privacy") &&
          !l.href.includes("/support") &&
          !l.href.includes("/security"),
      ),
  );
  console.log(`\nContent links: ${links.length}`);
  links.forEach((l) => console.log(`  ${l.href.slice(0, 120)} — ${l.text}`));

  // GraphQL 响应
  console.log("\n=== GraphQL responses ===");
  graphqlResponses.forEach((r) => {
    console.log(`  ${r.op} (${r.status})`);
    console.log(`    ${r.data.slice(0, 300)}`);
  });

  // 也检查候选人卡片的 DOM 结构
  console.log("\n=== DOM structure check ===");
  const cards = await page.$$eval("[data-testid], [data-automation], [class*='candidate'], [class*='profile'], [class*='result'], [class*='card']", (els) =>
    els.slice(0, 10).map((el) => ({
      tag: el.tagName,
      testId: el.getAttribute("data-testid") || "",
      automation: el.getAttribute("data-automation") || "",
      className: el.className?.toString().slice(0, 100) || "",
      text: el.textContent?.trim().slice(0, 100) || "",
    })),
  );
  console.log("Cards/results found:", cards.length);
  cards.forEach((c) => console.log(`  <${c.tag}> testId="${c.testId}" auto="${c.automation}" class="${c.className}" text="${c.text}"`));

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
