/**
 * 测试 JobStreet Express Create — headless: false 可视化调试
 *
 * 用法: npx tsx src/__tests__/test-jobstreet-posting-debug.ts
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
        console.log(`[GraphQL] ${data.operationName || "unknown"}`);
      } catch {}
    }
  });

  console.log("1. 导航到 Express Create...");
  await page.goto("https://my.employer.seek.com/job/managejob/express/create?referrer=createJob", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(8000);
  console.log(`   URL: ${page.url()}`);

  // 等待表单
  await page.waitForSelector("#JobTitleTextField", { timeout: 15000 }).catch(() => {
    console.log("   ⚠ #JobTitleTextField 未找到");
  });

  console.log("\n2. 填写 Job Title...");
  const titleInput = page.locator("#JobTitleTextField");
  if (await titleInput.isVisible()) {
    await titleInput.click();
    await titleInput.fill("Duty Manager");
    await page.waitForTimeout(2000);
    // 检查下拉
    const suggestions = await page.locator('[role="option"]').count();
    console.log(`   下拉建议数: ${suggestions}`);
    if (suggestions > 0) {
      const firstText = await page.locator('[role="option"]').first().textContent();
      console.log(`   第一个建议: ${firstText}`);
      await page.locator('[role="option"]').first().click();
      await page.waitForTimeout(500);
    }
  } else {
    console.log("   ⚠ 标题输入框不可见");
  }

  console.log("\n3. 填写 Location...");
  const locationInput = page.locator("#JobLocation");
  if (await locationInput.isVisible()) {
    await locationInput.click();
    await locationInput.fill("Kuala Lumpur");
    await page.waitForTimeout(2000);
    const locSuggestions = await page.locator('[role="option"]').count();
    console.log(`   下拉建议数: ${locSuggestions}`);
    if (locSuggestions > 0) {
      const firstLoc = await page.locator('[role="option"]').first().textContent();
      console.log(`   第一个建议: ${firstLoc}`);
      await page.locator('[role="option"]').first().click();
      await page.waitForTimeout(500);
    }
  }

  console.log("\n4. 选择 Full-time...");
  const ftBtn = page.locator('button:has-text("Full-time")');
  if (await ftBtn.isVisible().catch(() => false)) {
    await ftBtn.click();
    await page.waitForTimeout(500);
    console.log("   ✓ 已选择");
  }

  console.log("\n5. 选择 Monthly...");
  const monthlyBtn = page.locator('button:has-text("Monthly")');
  if (await monthlyBtn.isVisible().catch(() => false)) {
    await monthlyBtn.click();
    await page.waitForTimeout(500);
    console.log("   ✓ 已选择");
  }

  console.log("\n6. 填写薪资...");
  const minSalary = page.locator("#minSalary");
  const maxSalary = page.locator("#maxSalary");
  if (await minSalary.isVisible()) {
    await minSalary.fill("4000");
    console.log("   min: 4000");
  }
  if (await maxSalary.isVisible()) {
    await maxSalary.fill("4800");
    console.log("   max: 4800");
  }

  await page.screenshot({ path: "./jobstreet-debug-step1.png", fullPage: true });
  console.log("\n   截图: ./jobstreet-debug-step1.png");

  console.log("\n7. 点击 Continue...");
  const continueBtn = page.locator("#next-page-button");
  if (await continueBtn.isVisible()) {
    await continueBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await continueBtn.click({ force: true });
    console.log("   已点击");
    await page.waitForTimeout(8000);
    console.log(`   新 URL: ${page.url()}`);
  }

  // 检查是否有验证错误
  const errors = await page.locator('[role="alert"], .error, [class*="error"]').allTextContents();
  if (errors.length > 0) {
    console.log("\n   验证错误:");
    for (const e of errors) {
      console.log(`   - ${e.trim().slice(0, 100)}`);
    }
  }

  await page.screenshot({ path: "./jobstreet-debug-step2.png", fullPage: true });
  console.log("   截图: ./jobstreet-debug-step2.png");

  console.log("\n8. 当前页面分析...");
  console.log(`   URL: ${page.url()}`);

  // 如果在 select-ad-type 页面，找 "Post for free"
  if (page.url().includes("select-ad-type")) {
    console.log("\n   在 Select Ad Type 页面，查找 'Post for free'...");

    // 列出所有按钮
    const allBtns = await page.locator("button, a").allTextContents();
    console.log("   所有按钮/链接文本:");
    for (const btn of allBtns) {
      const trimmed = btn.trim().slice(0, 80);
      if (trimmed) console.log(`     - "${trimmed}"`);
    }

    // 尝试点击 Post for free
    const freeBtn = page.locator('button:has-text("Post for free"), a:has-text("Post for free"), button:has-text("Free")').first();
    if (await freeBtn.isVisible().catch(() => false)) {
      console.log("\n   找到 'Post for free' 按钮，点击...");
      await freeBtn.click();
      await page.waitForTimeout(5000);
      console.log(`   新 URL: ${page.url()}`);
    } else {
      console.log("\n   ⚠ 未找到 'Post for free' 按钮");
      // 截图看看页面长什么样
    }

    await page.screenshot({ path: "./jobstreet-debug-after-free.png", fullPage: true });
    console.log("   截图: ./jobstreet-debug-after-free.png");

    // 点击 Continue 进入下一步
    console.log("\n   点击 Continue...");

    // 检查 Continue 按钮状态
    const step2Continue = page.locator("#next-page-button");
    if (await step2Continue.isVisible().catch(() => false)) {
      const isDisabled = await step2Continue.isDisabled().catch(() => false);
      const btnText = await step2Continue.textContent();
      console.log(`   按钮文本: "${btnText}", disabled: ${isDisabled}`);

      await step2Continue.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);

      // 尝试用 JavaScript 直接点击
      await page.evaluate(() => {
        const btn = document.querySelector("#next-page-button") as HTMLButtonElement;
        if (btn) btn.click();
      });
      console.log("   已通过 JS 点击");

      await page.waitForTimeout(10000);
      console.log(`   新 URL: ${page.url()}`);
    } else {
      console.log("   ⚠ Continue 按钮不可见");
    }

    // 检查验证错误
    const errors2 = await page.locator('[role="alert"], [class*="error"], [class*="Error"]').allTextContents();
    if (errors2.length > 0) {
      console.log("   验证错误:");
      for (const e of errors2) {
        const t = e.trim().slice(0, 100);
        if (t) console.log(`     - ${t}`);
      }
    }

    await page.screenshot({ path: "./jobstreet-debug-step3.png", fullPage: true });
    console.log("   截图: ./jobstreet-debug-step3.png");

    // 如果还在 select-ad-type，列出所有可点击元素
    if (page.url().includes("select-ad-type")) {
      console.log("\n   仍在 select-ad-type，检查页面状态...");
      const pageText = await page.evaluate(() => {
        const main = document.querySelector("main, [role='main'], #root");
        return main ? (main.textContent || "").replace(/\s+/g, " ").trim().slice(0, 2000) : "";
      });
      console.log(`   页面文本: ${pageText.slice(0, 1000)}`);
    }
  }

  // Step 2 表单元素
  console.log("\n9. 当前页面表单元素...");
  const formElements = await page.evaluate(() => {
    const elements: string[] = [];
    document.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='textbox']").forEach((el) => {
      const htmlEl = el as HTMLInputElement;
      elements.push(`[${el.tagName} type="${htmlEl.type}" id="${htmlEl.id}" name="${htmlEl.name}" placeholder="${htmlEl.placeholder}"]`);
    });
    return elements;
  });
  for (const el of formElements) {
    console.log(`   ${el}`);
  }

  console.log("\n等待 5 秒...");
  await page.waitForTimeout(5000);

  // 如果到了 manage 页面，分析它
  if (page.url().includes("manage") || page.url().includes("write")) {
    console.log("\n10. 分析当前页面...");
    console.log(`    URL: ${page.url()}`);

    // 点击 Continue (JS)
    console.log("    点击 Continue (JS)...");
    await page.evaluate(() => {
      const btn = document.querySelector("#next-page-button") as HTMLButtonElement;
      if (btn) btn.click();
    });
    await page.waitForTimeout(8000);
    console.log(`    新 URL: ${page.url()}`);

    // 如果还在 manage，检查页面内容
    if (page.url().includes("manage")) {
      console.log("\n    仍在 manage 页面，检查内容...");

      const allBtns2 = await page.locator("button, a, [role='button']").allTextContents();
      console.log("    按钮/链接:");
      for (const btn of allBtns2) {
        const t = btn.trim().slice(0, 80);
        if (t) console.log(`      - "${t}"`);
      }

      // 检查是否有必填字段
      const requiredFields = await page.locator("[required], [aria-required='true']").count();
      console.log(`    必填字段数: ${requiredFields}`);

      // 检查验证错误
      const errs = await page.locator('[role="alert"], [class*="error"], [class*="Error"]').allTextContents();
      if (errs.length > 0) {
        console.log("    验证错误:");
        for (const e of errs) {
          const t = e.trim().slice(0, 100);
          if (t) console.log(`      - ${t}`);
        }
      }

      // 获取页面文本
      const pageText = await page.evaluate(() => {
        const main = document.querySelector("main, [role='main'], #root");
        return main ? (main.textContent || "").replace(/\s+/g, " ").trim().slice(0, 3000) : "";
      });
      console.log(`    页面文本: ${pageText.slice(0, 1500)}`);

      await page.screenshot({ path: "./jobstreet-debug-manage.png", fullPage: true });
      console.log("    截图: ./jobstreet-debug-manage.png");
    }
  }

  console.log("\n等待 20 秒后关闭...");
  await page.waitForTimeout(20000);

  await context.close();
  await browser.close();
}

main().catch(console.error);
