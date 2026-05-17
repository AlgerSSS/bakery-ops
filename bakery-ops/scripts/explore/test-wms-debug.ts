/**
 * WMS 下单页面调试 - headless 模式
 * 用法: npx tsx src/__tests__/test-wms-debug.ts
 */
import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";

const WMS_URL = process.env.WMS_URL || "https://wms.dex-i.net/";
const WMS_EMAIL = process.env.WMS_EMAIL || "hotcrushbakery@gmail.com";
const WMS_PASSWORD = process.env.WMS_PASSWORD || "ddexpress";
const SESSION_DIR = process.env.WMS_SESSION_DIR || "./wms-session";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  if (!fs.existsSync("wms-screenshots")) fs.mkdirSync("wms-screenshots");

  console.log("=== WMS 下单页面调试 ===\n");

  const browser = await chromium.launch({ headless: true });
  const contextOpts: any = {
    viewport: { width: 1400, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  };

  const storageFile = `${SESSION_DIR}/storage.json`;
  if (fs.existsSync(storageFile)) {
    const ageH = (Date.now() - fs.statSync(storageFile).mtimeMs) / 3600000;
    if (ageH < 24) {
      contextOpts.storageState = storageFile;
      console.log(`加载 session (${ageH.toFixed(1)}h 前)`);
    } else {
      console.log(`Session 过期 (${ageH.toFixed(1)}h)，重新登录`);
    }
  }

  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();

  // Step 1: Homepage
  console.log("\n1. 访问首页...");
  await page.goto(WMS_URL, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);

  // Step 2: Login if needed
  if (page.url().includes("login")) {
    console.log("   需要登录...");
    await page.screenshot({ path: "wms-screenshots/debug-01-login.png" });

    await page.fill('input[name="email"]', WMS_EMAIL);
    await sleep(500);
    await page.fill('input[name="password"]', WMS_PASSWORD);
    await sleep(500);
    await page.click('input[type="submit"]');
    await page.waitForLoadState("networkidle");
    await sleep(3000);

    if (page.url().includes("login")) {
      console.log("   ✗ 登录失败");
      const errEl = page.locator(".alert-danger, .alert");
      if (await errEl.count() > 0) {
        console.log("   错误:", await errEl.first().textContent());
      }
      await browser.close();
      return;
    }

    // Save session
    const storage = await context.storageState();
    fs.writeFileSync(storageFile, JSON.stringify(storage, null, 2));
    console.log("   ✓ 登录成功，session 已保存");
  } else {
    console.log("   ✓ 已登录");
  }

  // Step 3: Navigate to send_order page
  console.log("\n2. 访问下单页面...");
  await page.goto(`${WMS_URL}index.php?route=account/send_order`, {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await sleep(3000);

  const sendOrderUrl = page.url();
  console.log(`   URL: ${sendOrderUrl}`);
  await page.screenshot({ path: "wms-screenshots/debug-02-send-order.png", fullPage: true });

  // Step 4: Dump ALL inputs, selects, buttons, radios
  console.log("\n3. 页面所有表单元素:");
  const allElements = await page.locator("input, select, textarea, button, label, .radio, .checkbox, [role='radio']").evaluateAll((els) =>
    els.map((el: any) => {
      const tag = el.tagName.toLowerCase();
      return {
        tag,
        type: el.type || "",
        id: el.id || "",
        name: el.name || "",
        className: (typeof el.className === "string" ? el.className : "").slice(0, 60),
        for: el.htmlFor || "",
        value: (el.value || "").slice(0, 40),
        placeholder: (el.placeholder || "").slice(0, 40),
        text: (el.innerText || "").slice(0, 60).replace(/\s+/g, " "),
        visible: el.offsetParent !== null,
      };
    }).filter((e: any) => e.id || e.name || e.text || e.type === "radio" || e.type === "checkbox")
  );

  for (const el of allElements) {
    console.log(`   <${el.tag}> type="${el.type}" id="${el.id}" name="${el.name}" class="${el.className}" for="${el.for}" text="${el.text}" visible=${el.visible}`);
  }

  // Step 5: Look for address selection specifically
  console.log("\n4. 地址相关元素 (详细):");
  const bodyHtml = await page.evaluate(() => {
    // Get all elements with address/shipping related text
    const elements = document.querySelectorAll("*");
    const results: string[] = [];
    for (const el of elements) {
      const text = (el as HTMLElement).innerText?.trim() || "";
      if (/address|地址|shipping|收货/i.test(text) && text.length < 100) {
        results.push(`<${el.tagName.toLowerCase()} id="${(el as HTMLElement).id}" class="${(el as HTMLElement).className}"> ${text.slice(0, 80)}`);
      }
    }
    return results.slice(0, 30);
  });

  for (const line of bodyHtml) {
    console.log(`   ${line}`);
  }

  // Step 6: Page body text (first 2000 chars)
  console.log("\n5. 页面文本:");
  const bodyText = (await page.textContent("body"))?.slice(0, 2000) || "";
  console.log(bodyText);

  // Step 7: Get page HTML snippet around form area
  console.log("\n6. 页面 HTML (form/content 区域):");
  const htmlSnippet = await page.evaluate(() => {
    const main = document.querySelector("#content, .container, main, form, [role='main']");
    return main ? main.outerHTML.slice(0, 3000) : document.body.outerHTML.slice(0, 3000);
  });
  fs.writeFileSync("wms-screenshots/debug-page-html.txt", htmlSnippet);
  console.log("   HTML 已保存到 wms-screenshots/debug-page-html.txt");

  await browser.close();
  console.log("\n=== 调试完成 ===");
}

main().catch(e => { console.error(e); process.exit(1); });
