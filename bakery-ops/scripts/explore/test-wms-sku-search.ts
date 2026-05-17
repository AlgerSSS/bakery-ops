/**
 * WMS - 获取完整 Select2 AJAX 配置 + 测试SKU搜索
 */
import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";

const WMS_URL = "https://wms.dex-i.net/";
const WMS_EMAIL = process.env.WMS_EMAIL || "hotcrushbakery@gmail.com";
const WMS_PASSWORD = process.env.WMS_PASSWORD || "ddexpress";
const SESSION_DIR = process.env.WMS_SESSION_DIR || "./wms-session";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("=== WMS SKU 完整探索 ===\n");

  const browser = await chromium.launch({ headless: true });
  const contextOpts: any = { viewport: { width: 1400, height: 900 } };

  const storageFile = `${SESSION_DIR}/storage.json`;
  if (fs.existsSync(storageFile)) {
    const ageH = (Date.now() - fs.statSync(storageFile).mtimeMs) / 3600000;
    if (ageH < 24) contextOpts.storageState = storageFile;
  }

  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();

  // Login
  await page.goto(`${WMS_URL}index.php?route=account/login/getForm&type=1&merchant=1`, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);
  if (page.url().includes("login")) {
    await page.fill('input[name="email"]', WMS_EMAIL);
    await page.fill('input[name="password"]', WMS_PASSWORD);
    await page.click('input[type="submit"]');
    await page.waitForLoadState("networkidle");
    await sleep(3000);
    fs.writeFileSync(storageFile, JSON.stringify(await context.storageState(), null, 2));
  }

  await page.goto(`${WMS_URL}index.php?route=account/send_order`, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(3000);

  // 1. Get the full click handler script
  console.log("1. 完整 btn-add 脚本:");
  const fullScript = await page.evaluate(() => {
    const scripts = document.querySelectorAll("script");
    for (const s of scripts) {
      const text = (s.textContent || "").trim();
      if (text.includes("get_customer_product_place_order")) {
        return text;
      }
    }
    return "NOT FOUND";
  });
  // Find the relevant section
  const idx = fullScript.indexOf("get_customer_product_place_order");
  console.log(fullScript.slice(Math.max(0, idx - 300), idx + 500));

  // 2. Now add a product row AND search
  console.log("\n2. 添加产品行 + 搜索 SKU...");
  // Click using both methods to ensure Select2 initializes
  await page.evaluate(() => {
    if (typeof (window as any).addImage === "function") {
      (window as any).addImage();
    }
  });
  await sleep(1000);

  // Now trigger the click handler for Select2 initialization
  await page.evaluate(() => {
    // Manually initialize Select2 on the new row
    if ((window as any).$) {
      (window as any).$(".selected_sku_add").select2({
        placeholder: "Please choose your Seller SKU",
        ajax: {
          type: "GET",
          url: "index.php?route=account/send_order/get_customer_product_place_order",
          dataType: "json",
          delay: 250,
          data: function(params: any) { return { search: params.term, page: params.page || 1 }; },
          processResults: function(data: any) { return { results: data }; },
          cache: true,
        },
        minimumInputLength: 1,
      });
    }
  });
  await sleep(1000);

  // 3. Try searching with network capture
  console.log("   监控网络...");
  const skuData: string[] = [];
  page.on("response", async (res: any) => {
    if (res.url().includes("get_customer_product_place_order")) {
      try {
        const body = await res.text();
        skuData.push(`STATUS=${res.status()} DATA=${body.slice(0, 500)}`);
      } catch {}
    }
  });

  // Click Select2 to open
  const select2 = page.locator(".select2-selection").first();
  await select2.click();
  await sleep(500);

  const searchField = page.locator(".select2-search__field");
  if (await searchField.count() > 0) {
    await searchField.fill("sugar");
    await sleep(3000);
  }

  console.log(`   AJAX 响应: ${skuData.join(" | ") || "无响应"}`);

  // Check dropdown results
  const results = await page.locator(".select2-results__option").evaluateAll((els: any[]) =>
    els.map((e: any) => e.textContent?.trim())
  );
  console.log(`   搜索结果: ${results.join(" | ") || "(空)"}`);

  // 4. If no results with English, try empty search (show all)
  console.log("\n3. 空搜索(全部SKU)...");
  if (await searchField.count() > 0) {
    await searchField.fill("");
    await sleep(2000);
  }

  // Try the AJAX directly
  console.log("\n4. 直接调用 SKU API:");
  const directResult = await page.evaluate(async () => {
    try {
      const resp = await fetch("index.php?route=account/send_order/get_customer_product_place_order&search=&page=1");
      const text = await resp.text();
      return text.slice(0, 1000);
    } catch (e: any) {
      return "Error: " + e.message;
    }
  });
  console.log(directResult);

  await browser.close();
  console.log("\n=== 完成 ===");
}

main().catch(e => { console.error(e); process.exit(1); });
