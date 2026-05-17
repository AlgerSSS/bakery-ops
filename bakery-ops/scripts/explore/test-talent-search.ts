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

  // 1. 搜索并捕获 GraphQL 数据
  let searchData: any = null;
  page.on("response", async (res) => {
    if (!res.url().includes("/graphql")) return;
    try {
      const body = await res.text();
      if (body.includes("talentSearchProfilesNaturalLanguageSearch")) {
        searchData = JSON.parse(body);
      }
    } catch {}
  });

  const searchUrl =
    "https://my.employer.seek.com/talentsearch?searchQuery=cashier+in+Kuala+Lumpur&market=MY";
  console.log("=== Searching: cashier in Kuala Lumpur ===");
  await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  // 2. 解析搜索结果
  if (searchData) {
    const result = searchData.data?.talentSearchProfilesNaturalLanguageSearch?.result;
    console.log(`Total count: ${result?.totalCount}`);
    console.log(`Service token: ${result?.serviceToken}`);
    const edges = result?.edges || [];
    console.log(`Profiles in page: ${edges.length}`);

    // 打印第一个 profile 的完整数据结构
    if (edges[0]) {
      console.log("\n=== First profile data ===");
      console.log(JSON.stringify(edges[0].node, null, 2).slice(0, 3000));
    }
  }

  // 3. 获取 profile 链接（只要包含 UUID 的真实 profile 链接）
  const profileLinks = await page.$$eval("a[href]", (els) =>
    els
      .map((el) => ({ href: el.getAttribute("href") || "", text: el.textContent?.trim().slice(0, 80) || "" }))
      .filter((l) => l.href.includes("/talentsearch/profiles/") && l.href.includes("market=MY")),
  );
  console.log(`\nProfile links: ${profileLinks.length}`);

  if (profileLinks.length === 0) {
    console.log("No profiles found!");
    await browser.close();
    return;
  }

  // 4. 打开第一个 profile 页面
  const firstLink = profileLinks[0];
  const profileUrl = firstLink.href.startsWith("http")
    ? firstLink.href
    : `https://my.employer.seek.com${firstLink.href}`;
  console.log(`\n=== Opening profile: ${firstLink.text.slice(0, 60)} ===`);
  console.log(`URL: ${profileUrl.slice(0, 200)}`);

  // 捕获 profile 页面的 GraphQL
  let profileData: any = null;
  page.on("response", async (res) => {
    if (!res.url().includes("/graphql")) return;
    try {
      const body = await res.text();
      if (body.includes("talentSearchProfile") && body.includes("resumeSnippet")) {
        profileData = JSON.parse(body);
      }
    } catch {}
  });

  await page.goto(profileUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(5000);

  console.log("Profile page URL:", page.url().slice(0, 200));
  await page.screenshot({ path: "/tmp/seek-talent-profile.png", fullPage: true });

  // 5. 检查 profile 页面的按钮和下载元素
  console.log("\n=== Buttons on profile page ===");
  const buttons = await page.$$eval("button, a[role='button'], [id*='download']", (els) =>
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

  // 6. 检查是否有 #download-document-viewer
  const downloadBtn = await page.$("#download-document-viewer");
  console.log(`\n#download-document-viewer found: ${!!downloadBtn}`);

  // 7. 检查页面文本
  const pageText = await page.evaluate(() => document.body?.innerText || "");
  console.log("\nProfile page text (first 2000 chars):");
  console.log(pageText.slice(0, 2000));

  // 8. 打印 profile GraphQL 数据
  if (profileData) {
    console.log("\n=== Profile GraphQL data ===");
    console.log(JSON.stringify(profileData, null, 2).slice(0, 3000));
  }

  // 9. 检查所有 iframe（简历可能在 iframe 里）
  const iframes = await page.$$eval("iframe", (els) =>
    els.map((el) => ({
      src: el.getAttribute("src") || "",
      id: el.id || "",
      name: el.getAttribute("name") || "",
    })),
  );
  console.log("\n=== Iframes ===");
  iframes.forEach((f) => console.log(`  id="${f.id}" name="${f.name}" src="${f.src.slice(0, 150)}"`));

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
