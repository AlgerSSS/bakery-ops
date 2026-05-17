/**
 * JobStreet Express Post-Job 页面探测
 *
 * 真实 URL: /job/managejob/express/create?referrer=createJob
 * 拦截所有 API 调用和 GraphQL mutation，记录表单字段
 *
 * 用法: npx tsx src/__tests__/test-jobstreet-express-postjob-discovery.ts
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
    console.log("未找到 JobStreet Cookie，请先运行 jobstreet-login.ts");
    return;
  }

  console.log("=== JobStreet Express Post-Job 探测 ===\n");

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

  // 拦截所有 API 请求
  const apiCalls: { method: string; url: string; postData?: string; status?: number; response?: string }[] = [];

  page.on("request", (req) => {
    const url = req.url();
    if (
      (url.includes("graphql") || url.includes("/api/") || url.includes("managejob")) &&
      !url.includes(".js") &&
      !url.includes(".css") &&
      !url.includes(".png")
    ) {
      apiCalls.push({
        method: req.method(),
        url,
        postData: req.postData()?.slice(0, 1000),
      });
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("graphql") || url.includes("/api/") || url.includes("managejob")) {
      try {
        const body = await res.text();
        const entry = apiCalls.find((c) => c.url === url && !c.response);
        if (entry) {
          entry.status = res.status();
          entry.response = body.slice(0, 2000);
        }
      } catch {}
    }
  });

  // Step 1: 导航到 express create 页面
  console.log("1. 导航到 Express Post-Job 页面...");
  await page.goto("https://my.employer.seek.com/job/managejob/express/create?referrer=createJob", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(8000);
  console.log(`   当前 URL: ${page.url()}`);
  console.log(`   Title: ${await page.title()}\n`);

  // Step 2: 截图
  await page.screenshot({ path: "./jobstreet-express-create.png", fullPage: true });
  console.log("   截图已保存: ./jobstreet-express-create.png\n");

  // Step 3: 收集所有表单元素
  console.log("2. 收集表单元素...\n");
  const formElements = await page.evaluate(() => {
    const elements: { tag: string; type?: string; name?: string; id?: string; placeholder?: string; label?: string; ariaLabel?: string; role?: string; text?: string }[] = [];

    // inputs, textareas, selects
    document.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox'], [role='listbox']").forEach((el) => {
      const htmlEl = el as HTMLInputElement;
      // 找关联的 label
      let label = "";
      if (htmlEl.id) {
        const labelEl = document.querySelector(`label[for="${htmlEl.id}"]`);
        if (labelEl) label = (labelEl.textContent || "").trim().slice(0, 80);
      }
      // 向上找最近的 label
      if (!label) {
        const parent = el.closest("label, [class*='field'], [class*='form-group']");
        if (parent) {
          const labelEl = parent.querySelector("label, [class*='label']");
          if (labelEl) label = (labelEl.textContent || "").trim().slice(0, 80);
        }
      }

      elements.push({
        tag: el.tagName.toLowerCase(),
        type: htmlEl.type,
        name: htmlEl.name,
        id: htmlEl.id,
        placeholder: htmlEl.placeholder,
        label,
        ariaLabel: el.getAttribute("aria-label") || undefined,
        role: el.getAttribute("role") || undefined,
      });
    });

    // buttons
    document.querySelectorAll("button, [role='button']").forEach((el) => {
      elements.push({
        tag: el.tagName.toLowerCase(),
        type: (el as HTMLButtonElement).type,
        name: (el as HTMLButtonElement).name,
        id: el.id,
        role: el.getAttribute("role") || undefined,
        text: (el.textContent || "").trim().slice(0, 80),
      });
    });

    return elements;
  });

  console.log(`   找到 ${formElements.length} 个表单元素:\n`);
  for (const el of formElements) {
    const parts = [`[${el.tag}${el.type ? ` type="${el.type}"` : ""}]`];
    if (el.name) parts.push(`name="${el.name}"`);
    if (el.id) parts.push(`id="${el.id}"`);
    if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
    if (el.label) parts.push(`label="${el.label}"`);
    if (el.ariaLabel) parts.push(`aria-label="${el.ariaLabel}"`);
    if (el.role) parts.push(`role="${el.role}"`);
    if (el.text) parts.push(`text="${el.text}"`);
    console.log(`   ${parts.join(" ")}`);
  }

  // Step 4: 收集所有链接和导航
  console.log("\n3. 页面上的所有链接...\n");
  const links = await page.evaluate(() => {
    const result: { text: string; href: string }[] = [];
    document.querySelectorAll("a[href]").forEach((a) => {
      const el = a as HTMLAnchorElement;
      result.push({
        text: (el.textContent || "").trim().slice(0, 80),
        href: el.href,
      });
    });
    return result;
  });
  for (const l of links) {
    console.log(`   [${l.text}] → ${l.href}`);
  }

  // Step 5: 打印所有捕获的 API 调用
  console.log("\n━━━ 捕获的 API 调用 ━━━\n");
  for (const call of apiCalls) {
    console.log(`  ${call.method} ${call.url}`);
    if (call.postData) console.log(`    Body: ${call.postData.slice(0, 500)}`);
    if (call.status) console.log(`    Status: ${call.status}`);
    if (call.response) console.log(`    Response: ${call.response.slice(0, 500)}`);
    console.log();
  }

  // Step 6: 获取页面完整 HTML 结构（简化版）
  console.log("━━━ 页面主要内容区域 HTML ━━━\n");
  const mainHtml = await page.evaluate(() => {
    const main = document.querySelector("main, [role='main'], #root, #app, .app-content");
    if (main) return main.innerHTML.slice(0, 5000);
    return document.body.innerHTML.slice(0, 5000);
  });
  console.log(mainHtml.slice(0, 3000));

  await context.close();
  await browser.close();
}

main().catch(console.error);
