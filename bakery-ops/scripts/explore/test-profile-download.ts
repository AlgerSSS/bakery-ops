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

  // Step 1: 搜索获取候选人列表
  console.log("=== Searching candidates ===");
  const searchUrl =
    "https://my.employer.seek.com/talentsearch?searchQuery=bakery+staff+in+Kuala+Lumpur&market=MY";
  await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);

  // 提取第一个候选人 profile 链接
  const profileLinks = await page.$$eval("a[href]", (els) =>
    els
      .map((el) => ({ href: el.getAttribute("href") || "", text: el.textContent?.trim().slice(0, 80) || "" }))
      .filter((l) => l.href.includes("/talentsearch/profiles/")),
  );
  console.log(`Found ${profileLinks.length} profile links`);

  if (profileLinks.length === 0) {
    console.log("No profiles found!");
    await browser.close();
    return;
  }

  // Step 2: 打开第一个候选人 profile
  const firstProfile = profileLinks[0];
  const profileUrl = firstProfile.href.startsWith("http")
    ? firstProfile.href
    : `https://my.employer.seek.com${firstProfile.href}`;
  console.log(`\n=== Opening profile: ${firstProfile.text.slice(0, 50)} ===`);
  console.log(`URL: ${profileUrl.slice(0, 150)}`);

  await page.goto(profileUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);
  console.log("Profile URL:", page.url().slice(0, 150));
  console.log("Profile Title:", await page.title());
  await page.screenshot({ path: "/tmp/seek-profile-page.png", fullPage: true });

  // Step 3: 分析 profile 页面结构
  const pageText = await page.evaluate(() => document.body?.innerText || "");
  console.log("\nProfile page text (first 3000 chars):");
  console.log(pageText.slice(0, 3000));

  // 查找所有按钮
  console.log("\n=== Buttons on page ===");
  const buttons = await page.$$eval("button, a[role='button']", (els) =>
    els.map((el) => ({
      tag: el.tagName,
      text: el.textContent?.trim().slice(0, 80) || "",
      href: el.getAttribute("href") || "",
      testId: el.getAttribute("data-testid") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
    })),
  );
  buttons.forEach((b) =>
    console.log(`  <${b.tag}> "${b.text}" href="${b.href}" testId="${b.testId}" aria="${b.ariaLabel}"`),
  );

  // 查找下载相关链接
  console.log("\n=== Download-related elements ===");
  const downloadEls = await page.$$eval(
    'a[href*="download"], a[href*="resume"], a[href*=".pdf"], a[href*="cv"], ' +
    'button:has-text("Download"), button:has-text("PDF"), button:has-text("CV"), button:has-text("Resume"), ' +
    'a:has-text("Download"), a:has-text("PDF"), a:has-text("CV")',
    (els) =>
      els.map((el) => ({
        tag: el.tagName,
        text: el.textContent?.trim().slice(0, 80) || "",
        href: el.getAttribute("href") || "",
        testId: el.getAttribute("data-testid") || "",
      })),
  );
  console.log(`Found ${downloadEls.length} download-related elements`);
  downloadEls.forEach((d) =>
    console.log(`  <${d.tag}> "${d.text}" href="${d.href}" testId="${d.testId}"`),
  );

  // 查找所有链接
  console.log("\n=== All links on profile page ===");
  const allLinks = await page.$$eval("a[href]", (els) =>
    els
      .map((el) => ({ href: el.getAttribute("href") || "", text: el.textContent?.trim().slice(0, 60) || "" }))
      .filter((l) => l.text.length > 0 && !l.href.startsWith("#")),
  );
  allLinks.forEach((l) => console.log(`  ${l.href.slice(0, 120)} — ${l.text}`));

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
