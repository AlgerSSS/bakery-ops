/**
 * WMS - 完整调试：监控所有网络请求 + 页面状态
 */
import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";

const WMS_URL = "https://wms.dex-i.net/";
const WMS_EMAIL = process.env.WMS_EMAIL || "hotcrushbakery@gmail.com";
const WMS_PASSWORD = process.env.WMS_PASSWORD || "ddexpress";
const SESSION_DIR = process.env.WMS_SESSION_DIR || "./wms-session";
const STORE_ADDRESS_ID = process.env.WMS_STORE_ADDRESS_ID || "649";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("=== WMS 提交调试 ===\n");

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

  // Fill form
  const today = new Date().toISOString().split("T")[0];
  await page.click("#shipping_address_exist");
  await sleep(500);
  await page.evaluate((addressId: string) => {
    const select = document.querySelector("#shipping") as HTMLSelectElement;
    if (select) {
      select.value = addressId;
      if ((window as any).$ && (window as any).$("#shipping").data("select2")) {
        (window as any).$("#shipping").trigger("change");
      } else {
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }, STORE_ADDRESS_ID);
  await sleep(500);

  await page.click("#payment_address_same_as_shipping");
  await sleep(500);

  const deliveryRadios = page.locator('input[name="delivery_method_required"]');
  if (await deliveryRadios.count() >= 2) {
    await deliveryRadios.nth(1).click();
    await sleep(500);
  }

  await page.fill("#input-reference_no", `HC-${today}-DBG`);
  await sleep(500);

  // Add 2 products
  for (let i = 0; i < 2; i++) {
    const names = ["韩国幼砂糖", "安德鲁草莓颗粒果酱"];
    console.log(`\n添加产品 ${i+1}: ${names[i]}`);

    await page.click("button.btn-add");
    await sleep(1500);

    const allContainers = page.locator(".select2-container");
    const cnt = await allContainers.count();
    console.log(`  Select2容器数: ${cnt}`);

    // Click the last container's selection area
    const lastContainer = allContainers.nth(cnt - 1);
    await lastContainer.locator(".select2-selection").click();
    await sleep(500);

    const searchField = page.locator(".select2-search__field");
    console.log(`  搜索框数: ${await searchField.count()}`);

    if (await searchField.count() > 0) {
      await searchField.last().fill(names[i]);
      await sleep(3000);

      const results = page.locator(".select2-results__option");
      const rc = await results.count();
      console.log(`  搜索结果数: ${rc}`);

      if (rc > 0) {
        const firstText = await results.first().textContent();
        console.log(`  第一个: ${firstText?.slice(0, 60)}`);
        await results.first().click();
        await sleep(500);
        console.log("  ✓ 已选择");
      } else {
        console.log("  ✗ 无结果");
        // Show what's in the dropdown
        const dropdown = await page.locator(".select2-results").textContent();
        console.log(`  Dropdown: ${dropdown?.slice(0, 100)}`);
      }
    }

    // Fill quantity
    const qtyInput = page.locator(`#input-quantity-order-product_${i + 1}`);
    if (await qtyInput.count() > 0) {
      await qtyInput.fill(String(i === 0 ? 1 : 2));
      console.log("  ✓ 数量已填");
    }
  }

  // Comment
  await page.evaluate((text: string) => {
    const ta = document.querySelector('textarea[name="comment"]') as HTMLTextAreaElement;
    if (ta) { ta.value = text; ta.dispatchEvent(new Event("input", { bubbles: true })); }
  }, `测试订单 ${today}`);

  // Check form values before submit
  console.log("\n表单值检查:");
  const formValues = await page.evaluate(() => {
    const form = document.querySelector("#submits") as HTMLFormElement;
    const fd = new FormData(form);
    const entries: Record<string, any> = {};
    fd.forEach((v: any, k: string) => {
      if (!entries[k]) entries[k] = v;
      else if (Array.isArray(entries[k])) entries[k].push(v);
      else entries[k] = [entries[k], v];
    });
    return entries;
  });
  console.log(JSON.stringify(formValues, null, 2));

  // Monitor network during submit
  console.log("\n提交网络监控:");
  const responses: string[] = [];
  page.on("response", (res: any) => {
    if (res.url().includes("add_order")) {
      responses.push(`RESP ${res.status()} ${res.url().slice(0, 100)}`);
    }
  });
  page.on("request", (req: any) => {
    if (req.url().includes("add_order")) {
      responses.push(`REQ ${req.method()} ${req.url().slice(0, 100)}`);
    }
  });

  // Submit
  console.log("提交中...");
  await page.evaluate(() => {
    const form = document.querySelector("#submits") as HTMLFormElement;
    if (form) form.submit();
  });

  await sleep(5000);
  await page.waitForLoadState("networkidle");

  console.log(`提交后 URL: ${page.url()}`);
  console.log(`网络: ${responses.join(" | ")}`);

  // Show page message
  const pageMsg = await page.evaluate(() => {
    const alerts = document.querySelectorAll(".alert, .alert-danger, .alert-success, .warning");
    return Array.from(alerts).map((e: any) => e.innerText?.trim()).filter(Boolean);
  });
  console.log(`页面消息: ${pageMsg.join(" | ") || "(无)"}`);

  await page.screenshot({ path: "wms-screenshots/debug-submit-result.png", fullPage: true });

  await browser.close();
  console.log("\n=== 完成 ===");
}

main().catch(e => { console.error(e); process.exit(1); });
