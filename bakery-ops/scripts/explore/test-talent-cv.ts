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
  const searchUrl =
    "https://my.employer.seek.com/talentsearch?searchQuery=cashier+in+Kuala+Lumpur&market=MY";
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(10000);

  // 获取第一个真实 profile 链接
  const profileLinks = await page.$$eval("a[href]", (els) =>
    els
      .map((el) => el.getAttribute("href") || "")
      .filter((h) => h.includes("/talentsearch/profiles/") && h.includes("market=MY")),
  );

  if (profileLinks.length === 0) {
    console.log("No profiles found!");
    await browser.close();
    return;
  }

  const profileUrl = `https://my.employer.seek.com${profileLinks[0]}`;
  console.log("Opening profile:", profileUrl.slice(0, 150));

  // 捕获所有 GraphQL
  const gqlResponses: Array<{ key: string; data: string }> = [];
  page.on("response", async (res) => {
    if (!res.url().includes("/graphql")) return;
    try {
      const body = await res.text();
      const parsed = JSON.parse(body);
      const key = parsed?.data ? Object.keys(parsed.data)[0] : "unknown";
      gqlResponses.push({ key, data: body.slice(0, 2000) });
    } catch {}
  });

  await page.goto(profileUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  // 点击 "CV preview" tab — 先关闭可能存在的 modal
  console.log("\n=== Clicking CV preview tab ===");
  // 关闭 modal overlay
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  // 再试一次关闭
  const closeBtn = page.locator("button[aria-label='Close']").first();
  if (await closeBtn.count() > 0) {
    try { await closeBtn.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(1000);
  }

  const cvTab = page.locator("button:has-text('CV preview')").first();
  if (await cvTab.count() > 0) {
    await cvTab.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "/tmp/seek-cv-preview.png", fullPage: true });

    // 检查 CV preview 区域的内容
    const cvText = await page.evaluate(() => document.body?.innerText || "");
    console.log("Page text after CV tab click (first 2000):");
    console.log(cvText.slice(0, 2000));

    // 检查是否有下载按钮
    const downloadBtn = await page.$("#download-document-viewer");
    console.log(`\n#download-document-viewer found: ${!!downloadBtn}`);

    // 检查所有按钮
    console.log("\n=== Buttons after CV tab ===");
    const buttons = await page.$$eval("button, [id*='download'], [data-testid*='download']", (els) =>
      els.map((el) => ({
        tag: el.tagName,
        id: el.id || "",
        text: el.textContent?.trim().slice(0, 80) || "",
        testId: el.getAttribute("data-testid") || "",
        ariaLabel: el.getAttribute("aria-label") || "",
      })),
    );
    buttons.forEach((b) =>
      console.log(`  <${b.tag}> id="${b.id}" text="${b.text}" testId="${b.testId}" aria="${b.ariaLabel}"`),
    );

    // 检查 iframe（CV 可能在 iframe 里渲染）
    const iframes = await page.$$eval("iframe", (els) =>
      els.map((el) => ({
        src: el.getAttribute("src") || "",
        id: el.id || "",
      })),
    );
    console.log("\nIframes:", iframes.length);
    iframes.forEach((f) => console.log(`  id="${f.id}" src="${f.src.slice(0, 200)}"`));

    // 检查 embed/object 元素（PDF 查看器）
    const embeds = await page.$$eval("embed, object, [type='application/pdf']", (els) =>
      els.map((el) => ({
        tag: el.tagName,
        src: el.getAttribute("src") || el.getAttribute("data") || "",
        type: el.getAttribute("type") || "",
      })),
    );
    console.log("\nEmbeds:", embeds.length);
    embeds.forEach((e) => console.log(`  <${e.tag}> type="${e.type}" src="${e.src.slice(0, 200)}"`));
  } else {
    console.log("CV preview tab not found!");
  }

  // 打印所有 GraphQL 响应
  console.log("\n=== GraphQL responses ===");
  gqlResponses.forEach((r) => {
    console.log(`\n--- ${r.key} ---`);
    console.log(r.data.slice(0, 1500));
  });

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
