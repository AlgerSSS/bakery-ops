/**
 * 专门调试 JobStreet manage 页面
 * 从已有的 draft 继续
 *
 * 用法: npx tsx src/__tests__/test-jobstreet-manage-debug.ts
 */
import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";
import {
  getCookieFile,
  getStorageFile,
  hasValidSession,
} from "../modules/domain/recruitment/connectors/jobstreet-login";

async function main() {
  if (!hasValidSession()) {
    console.log("未找到 Cookie");
    return;
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

  // 拦截 GraphQL
  page.on("request", (req) => {
    if (req.url().includes("graphql") && req.method() === "POST") {
      try {
        const data = JSON.parse(req.postData() || "{}");
        console.log(`[GraphQL REQ] ${data.operationName || "unknown"}`);
        if (data.operationName?.includes("Draft") || data.operationName?.includes("Update") || data.operationName?.includes("Post") || data.operationName?.includes("Submit") || data.operationName?.includes("Publish")) {
          console.log(`  Variables: ${JSON.stringify(data.variables || {}).slice(0, 500)}`);
        }
      } catch {}
    }
  });

  page.on("response", async (res) => {
    if (res.url().includes("graphql")) {
      try {
        const body = await res.text();
        if (body.includes("error") || body.includes("Error")) {
          console.log(`[GraphQL ERR] ${res.url()}: ${body.slice(0, 500)}`);
        }
      } catch {}
    }
  });

  // 直接导航到 manage 页面（使用最近的 draft）
  console.log("1. 导航到 manage 页面...");
  // 先去 classify 创建一个新的 draft
  await page.goto("https://my.employer.seek.com/job/managejob/express/create?referrer=createJob", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(8000);

  // 快速填写 Step 1
  const titleInput = page.locator("#JobTitleTextField");
  await titleInput.click();
  await titleInput.fill("Duty Manager");
  await page.waitForTimeout(1000);

  const locationInput = page.locator("#JobLocation");
  await locationInput.click();
  await locationInput.pressSequentially("Kuala Lumpur", { delay: 100 });
  await page.waitForTimeout(3000);
  const locOption = page.locator('[role="option"]').first();
  if (await locOption.isVisible().catch(() => false)) {
    await locOption.click();
    await page.waitForTimeout(1000);
  }

  // Full-time
  await page.locator('button:has-text("Full-time")').click().catch(() => {});
  await page.waitForTimeout(500);
  // Monthly
  await page.locator('button:has-text("Monthly")').click().catch(() => {});
  await page.waitForTimeout(500);
  // Salary
  await page.locator("#minSalary").fill("4000").catch(() => {});
  await page.locator("#maxSalary").fill("4800").catch(() => {});

  // Continue to select-ad-type
  await page.evaluate(() => {
    (document.querySelector("#next-page-button") as HTMLButtonElement)?.click();
  });
  await page.waitForTimeout(8000);
  console.log(`   Step 2: ${page.url()}`);

  // Post for free
  const freeBtn = page.locator('button:has-text("Post for free"), a:has-text("Post for free")').first();
  if (await freeBtn.isVisible().catch(() => false)) {
    await freeBtn.click();
    await page.waitForTimeout(2000);
  }

  // Continue to write
  await page.evaluate(() => {
    (document.querySelector("#next-page-button") as HTMLButtonElement)?.click();
  });
  await page.waitForTimeout(8000);
  console.log(`   Step 3: ${page.url()}`);

  // Fill write step
  const descEditor = page.locator('[contenteditable="true"]').first();
  if (await descEditor.isVisible().catch(() => false)) {
    await descEditor.click();
    await descEditor.fill("Looking for a Duty Manager for our bakery in KL. Must be trilingual.");
    await page.waitForTimeout(1000);
  }
  await page.locator("#JobSummaryTextarea").fill("Trilingual Duty Manager needed.").catch(() => {});
  await page.locator("#keySellingPoint1").fill("Competitive salary").catch(() => {});
  await page.locator("#keySellingPoint2").fill("Career growth").catch(() => {});
  await page.locator("#keySellingPoint3").fill("Great team").catch(() => {});

  // Continue to manage
  await page.evaluate(() => {
    (document.querySelector("#next-page-button") as HTMLButtonElement)?.click();
  });
  await page.waitForTimeout(8000);
  console.log(`\n2. Manage 页面: ${page.url()}`);

  // 详细分析 manage 页面
  await page.screenshot({ path: "./jobstreet-manage-full.png", fullPage: true });
  console.log("   截图: ./jobstreet-manage-full.png");

  // 获取完整 HTML
  const html = await page.evaluate(() => {
    const main = document.querySelector("main, [role='main'], #start-of-content");
    if (main) return main.innerHTML.slice(0, 10000);
    return document.body.innerHTML.slice(0, 10000);
  });
  fs.writeFileSync("./jobstreet-manage-html.txt", html);
  console.log("   HTML 已保存: ./jobstreet-manage-html.txt");

  // 所有表单元素
  console.log("\n3. 表单元素:");
  const formEls = await page.evaluate(() => {
    const els: string[] = [];
    document.querySelectorAll("input, textarea, select, [contenteditable], [role='textbox'], [role='combobox'], [role='checkbox'], [role='radio'], [role='switch']").forEach((el) => {
      const h = el as HTMLInputElement;
      els.push(`[${el.tagName} type="${h.type}" id="${h.id}" name="${h.name}" checked=${h.checked} value="${(h.value || "").slice(0, 50)}"]`);
    });
    return els;
  });
  for (const el of formEls) console.log(`   ${el}`);

  // 所有按钮
  console.log("\n4. 按钮:");
  const btns = await page.evaluate(() => {
    const result: { text: string; disabled: boolean; type: string; id: string }[] = [];
    document.querySelectorAll("button, [role='button']").forEach((el) => {
      const btn = el as HTMLButtonElement;
      result.push({
        text: (btn.textContent || "").replace(/[\u200B-\u200D\uFEFF\u2060]/g, "").trim().slice(0, 80),
        disabled: btn.disabled,
        type: btn.type,
        id: btn.id,
      });
    });
    return result;
  });
  for (const b of btns) {
    console.log(`   [${b.type}] id="${b.id}" disabled=${b.disabled} "${b.text}"`);
  }

  console.log("\n等待 60 秒（手动检查页面）...");
  await page.waitForTimeout(60000);

  await context.close();
  await browser.close();
}

main().catch(console.error);
