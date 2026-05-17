/**
 * WMS 系统页面探索脚本
 * 用法: node --import tsx src/__tests__/test-wms-explore.ts
 *
 * 会打开浏览器让你手动登录，登录后自动截图并保存页面信息
 */
import { chromium } from "playwright";
import * as fs from "fs";

const WMS_URL = "https://wms.dex-i.net/";
const SESSION_DIR = "./wms-session";
const SCREENSHOT_DIR = "./wms-screenshots";

async function run() {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log("启动浏览器（非 headless 模式）...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  console.log("打开 WMS:", WMS_URL);
  await page.goto(WMS_URL, { waitUntil: "networkidle" });

  console.log("");
  console.log("=== 请在浏览器中登录 WMS 系统 ===");
  console.log("账号: hotcrushbakery@gmail.com");
  console.log("密码: ddexpress");
  console.log("");
  console.log("登录成功后，按 Enter 继续...");

  // 等待用户按 Enter
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  // 保存登录后的 session
  const cookies = await context.cookies();
  fs.writeFileSync(`${SESSION_DIR}/cookies.json`, JSON.stringify(cookies, null, 2));
  const storage = await context.storageState();
  fs.writeFileSync(`${SESSION_DIR}/storage.json`, JSON.stringify(storage, null, 2));
  console.log("Session 已保存到", SESSION_DIR);

  // 截图当前页面（登录后首页）
  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-dashboard.png`, fullPage: true });
  console.log("截图: 01-dashboard.png");

  // 获取页面信息
  const url = page.url();
  const title = await page.title();
  console.log("当前 URL:", url);
  console.log("页面标题:", title);

  // 获取导航菜单
  const navLinks = await page.evaluate(() => {
    const links: Array<{ text: string; href: string }> = [];
    document.querySelectorAll("a, button, [role='menuitem'], nav a, .sidebar a, .menu a").forEach((el) => {
      const text = (el as HTMLElement).innerText?.trim();
      const href = (el as HTMLAnchorElement).href || "";
      if (text && text.length < 50) links.push({ text, href });
    });
    return links;
  });
  console.log("\n=== 页面导航/菜单 ===");
  navLinks.forEach((l) => console.log(`  ${l.text} → ${l.href}`));

  // 尝试找到"下单"/"订单"/"采购"相关入口
  console.log("\n=== 寻找订单相关入口 ===");
  const orderLinks = navLinks.filter((l) =>
    /order|订单|采购|purchase|下单|cart|库存|inventory|stock/i.test(l.text + l.href)
  );
  if (orderLinks.length > 0) {
    console.log("找到订单相关链接:");
    orderLinks.forEach((l) => console.log(`  ${l.text} → ${l.href}`));

    // 点击第一个订单链接
    const target = orderLinks[0];
    console.log(`\n点击: ${target.text}`);
    await page.click(`text="${target.text}"`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-order-page.png`, fullPage: true });
    console.log("截图: 02-order-page.png");
    console.log("URL:", page.url());

    // 获取这个页面的表单元素
    const formElements = await page.evaluate(() => {
      const elements: Array<{ tag: string; type?: string; name?: string; placeholder?: string; text?: string }> = [];
      document.querySelectorAll("input, select, textarea, button").forEach((el) => {
        const e = el as HTMLInputElement;
        elements.push({
          tag: e.tagName.toLowerCase(),
          type: e.type,
          name: e.name || e.id,
          placeholder: e.placeholder,
          text: e.innerText?.trim().slice(0, 30),
        });
      });
      return elements;
    });
    console.log("\n=== 页面表单元素 ===");
    formElements.forEach((e) => console.log(`  <${e.tag}> type=${e.type} name=${e.name} placeholder="${e.placeholder}" text="${e.text}"`));
  } else {
    console.log("未找到明显的订单入口，请手动导航到下单页面，然后按 Enter...");
    await new Promise<void>((resolve) => {
      process.stdin.once("data", () => resolve());
    });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-manual-page.png`, fullPage: true });
    console.log("截图: 02-manual-page.png");
    console.log("URL:", page.url());

    const formElements = await page.evaluate(() => {
      const elements: Array<{ tag: string; type?: string; name?: string; placeholder?: string; text?: string }> = [];
      document.querySelectorAll("input, select, textarea, button").forEach((el) => {
        const e = el as HTMLInputElement;
        elements.push({
          tag: e.tagName.toLowerCase(),
          type: e.type,
          name: e.name || e.id,
          placeholder: e.placeholder,
          text: e.innerText?.trim().slice(0, 30),
        });
      });
      return elements;
    });
    console.log("\n=== 页面表单元素 ===");
    formElements.forEach((e) => console.log(`  <${e.tag}> type=${e.type} name=${e.name} placeholder="${e.placeholder}" text="${e.text}"`));
  }

  // 获取完整 HTML 结构概览
  const htmlOverview = await page.evaluate(() => {
    const body = document.body;
    function summarize(el: Element, depth: number): string {
      if (depth > 3) return "";
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className && typeof el.className === "string" ? `.${el.className.split(" ").slice(0, 2).join(".")}` : "";
      const text = el.children.length === 0 ? (el as HTMLElement).innerText?.trim().slice(0, 30) : "";
      let result = "  ".repeat(depth) + `<${tag}${id}${cls}>${text ? " " + text : ""}\n`;
      if (depth < 3) {
        Array.from(el.children).slice(0, 10).forEach((child) => {
          result += summarize(child, depth + 1);
        });
      }
      return result;
    }
    return summarize(body, 0).slice(0, 3000);
  });
  fs.writeFileSync(`${SCREENSHOT_DIR}/page-structure.txt`, htmlOverview);
  console.log("\n页面结构已保存到 wms-screenshots/page-structure.txt");

  console.log("\n=== 探索完成 ===");
  console.log("截图保存在:", SCREENSHOT_DIR);
  console.log("按 Enter 关闭浏览器...");
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  await browser.close();
}

run().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
