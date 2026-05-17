/**
 * WMS Product Order 页面探索
 * 用法: node --import tsx src/__tests__/test-wms-product-order.ts
 */
import { chromium } from "playwright";
import * as fs from "fs";

const SESSION_DIR = "./wms-session";
const SCREENSHOT_DIR = "./wms-screenshots";

async function run() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log("用已保存的 session 启动浏览器...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    storageState: `${SESSION_DIR}/storage.json`,
  });
  const page = await context.newPage();

  // 1. 先看 Product Order 页面
  console.log("打开 Product Order 页面...");
  await page.goto("https://wms.dex-i.net/index.php?route=account/order_product", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(2000);
  console.log("URL:", page.url());

  // 如果被重定向到登录页
  if (page.url().includes("login")) {
    console.log("需要重新登录，请在浏览器中登录后按 Enter...");
    await new Promise<void>((resolve) => { process.stdin.once("data", () => resolve()); });
    await page.goto("https://wms.dex-i.net/index.php?route=account/order_product", {
      waitUntil: "networkidle",
    });
  }

  await page.screenshot({ path: `${SCREENSHOT_DIR}/03-product-order.png`, fullPage: true });
  console.log("截图: 03-product-order.png");

  // 获取页面内容
  const pageContent = await page.evaluate(() => {
    const info: Record<string, unknown> = {};
    info.url = window.location.href;
    info.title = document.title;
    info.bodyText = document.body.innerText?.slice(0, 3000);

    // 表格内容
    const tables: string[][] = [];
    document.querySelectorAll("table").forEach((table) => {
      const rows: string[] = [];
      table.querySelectorAll("tr").forEach((tr) => {
        const cells: string[] = [];
        tr.querySelectorAll("td, th").forEach((td) => {
          cells.push((td as HTMLElement).innerText?.trim().slice(0, 50) || "");
        });
        rows.push(cells.join(" | "));
      });
      tables.push(rows);
    });
    info.tables = tables;

    // 按钮和链接
    const actions: string[] = [];
    document.querySelectorAll("a, button").forEach((el) => {
      const text = (el as HTMLElement).innerText?.trim();
      const href = (el as HTMLAnchorElement).href || "";
      if (text && text.length < 60) actions.push(`${text} → ${href}`);
    });
    info.actions = [...new Set(actions)];

    // 表单
    const forms: Array<{ tag: string; name: string; placeholder: string; value: string }> = [];
    document.querySelectorAll("input, select, textarea, button[type='submit']").forEach((el) => {
      const e = el as HTMLInputElement;
      forms.push({
        tag: e.tagName.toLowerCase(),
        name: e.name || e.id || "",
        placeholder: e.placeholder || "",
        value: e.value?.slice(0, 30) || "",
      });
    });
    info.forms = forms;

    return info;
  });

  console.log("\n=== Product Order 页面内容 ===");
  console.log("Body text (前500字):", (pageContent.bodyText as string)?.slice(0, 500));
  console.log("\n=== 表格 ===");
  (pageContent.tables as string[][])?.forEach((table, i) => {
    console.log(`Table ${i}:`);
    table.slice(0, 10).forEach((row) => console.log("  " + row));
  });
  console.log("\n=== 操作按钮 ===");
  (pageContent.actions as string[])?.slice(0, 20).forEach((a) => console.log("  " + a));

  fs.writeFileSync(`${SCREENSHOT_DIR}/product-order-info.json`, JSON.stringify(pageContent, null, 2));

  // 2. 看看有没有"添加产品"或"下单"的入口
  console.log("\n\n=== 请浏览一下页面，如果有'添加产品'或'下单'按钮请点击 ===");
  console.log("导航到实际下单的页面后按 Enter...");
  await new Promise<void>((resolve) => { process.stdin.once("data", () => resolve()); });

  await page.screenshot({ path: `${SCREENSHOT_DIR}/04-actual-order.png`, fullPage: true });
  console.log("截图: 04-actual-order.png");
  console.log("URL:", page.url());

  const orderFormInfo = await page.evaluate(() => {
    const forms: Array<{ tag: string; type: string; name: string; id: string; placeholder: string; label: string; options?: string[] }> = [];
    document.querySelectorAll("input, select, textarea, button").forEach((el) => {
      const e = el as HTMLInputElement;
      let label = "";
      const parent = e.closest("label, .form-group, .form-item, tr, [class*='field']");
      if (parent) label = (parent as HTMLElement).innerText?.trim().split("\n")[0]?.slice(0, 40) || "";

      const item: any = {
        tag: e.tagName.toLowerCase(),
        type: e.type || "",
        name: e.name || "",
        id: e.id || "",
        placeholder: e.placeholder || "",
        label,
      };

      // 如果是 select，获取选项
      if (e.tagName === "SELECT") {
        const options: string[] = [];
        (e as HTMLSelectElement).querySelectorAll("option").forEach((opt) => {
          if (opt.value) options.push(`${opt.value}=${opt.text?.trim().slice(0, 30)}`);
        });
        item.options = options.slice(0, 20);
      }
      forms.push(item);
    });
    return forms;
  });

  console.log("\n=== 当前页面表单 ===");
  orderFormInfo.forEach((e: any) => {
    let line = `  <${e.tag}> type=${e.type} name="${e.name}" id="${e.id}" label="${e.label}"`;
    if (e.options) line += ` options=[${e.options.slice(0, 5).join(", ")}...]`;
    console.log(line);
  });

  fs.writeFileSync(`${SCREENSHOT_DIR}/order-form-detail.json`, JSON.stringify(orderFormInfo, null, 2));
  console.log("\n详细信息已保存到 wms-screenshots/order-form-detail.json");

  console.log("\n按 Enter 关闭浏览器...");
  await new Promise<void>((resolve) => { process.stdin.once("data", () => resolve()); });
  await browser.close();
}

run().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
