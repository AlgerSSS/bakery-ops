import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";
import { getCookieFile, getStorageFile } from "../modules/domain/recruitment/connectors/jobstreet-login";

async function main() {
  const cookies = JSON.parse(fs.readFileSync(getCookieFile(), "utf-8"));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
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
  await page.goto("https://my.employer.seek.com/talentsearch?searchQuery=cashier+in+Kuala+Lumpur&market=MY", {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.waitForTimeout(12000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);

  // 获取第一个 profile 链接
  const links = await page.$$eval("a[href]", (els) =>
    els.map((el) => el.getAttribute("href") || "").filter((h) => h.includes("/talentsearch/profiles/") && h.includes("market=MY")),
  );

  if (links.length === 0) { console.log("No profiles"); await browser.close(); return; }

  // 打开 profile 并捕获完整 GraphQL
  let fullProfile = "";
  page.on("response", async (res) => {
    if (!res.url().includes("/graphql")) return;
    try {
      const body = await res.text();
      if (body.includes("talentSearchProfileV3") && body.length > fullProfile.length) {
        fullProfile = body;
      }
    } catch {}
  });

  await page.goto(`https://my.employer.seek.com${links[1]}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  if (fullProfile) {
    const parsed = JSON.parse(fullProfile);
    const result = parsed?.data?.talentSearchProfileV3?.result;
    if (result) {
      console.log("=== Resume field ===");
      console.log(JSON.stringify(result.resume, null, 2)?.slice(0, 3000));
      console.log("\n=== Skills ===");
      console.log(JSON.stringify(result.skills, null, 2));
      console.log("\n=== Languages ===");
      console.log(JSON.stringify(result.languages, null, 2));
      console.log("\n=== Education ===");
      console.log(JSON.stringify(result.profileEducation, null, 2));
      console.log("\n=== Right to work ===");
      console.log(JSON.stringify(result.rightToWork, null, 2));
      console.log("\n=== Personal Summary ===");
      console.log(result.personalSummary);
      console.log("\n=== Work Histories (full) ===");
      console.log(JSON.stringify(result.workHistories, null, 2)?.slice(0, 3000));
      console.log("\n=== All keys ===");
      console.log(Object.keys(result).join(", "));
    }
  }

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
