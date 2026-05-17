/**
 * WMS 页面探索 v2 — 用已保存的 session 登录
 * 用法: node --import tsx src/__tests__/test-wms-explore2.ts
 */
import { chromium } from "playwright";
import * as fs from "fs";

const WMS_URL = "https://wms.dex-i.net/";
const SESSION_DIR = "./wms-session";
const SCREENSHOT_DIR = "./wms-screenshots";

async function run() {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const storageFile = `${SESSION_DIR}/storage.json`;
  if (!fs.existsSync(storageFile)) {
    console.log("没有找到 session 文件，请先运行 test-wms-explore.ts 登录");
    return;
  }

  console.log("用已保存的 session 启动浏览器...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    storageState: storageFile,
  });
  const page = await context.newPage();

  // 禁止页面自动关闭
  page.on("close", () => console.log("WARNING: page closed"));

  console.log("打开 WMS...");
  await page.goto(WMS_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  const url = page.url();
  console.log("当前 URL:", url);

  // 如果跳转到登录页，说明 session 过期
  if (url.includes("login") || url.includes("signin") || url.includes("auth")) {
    console.log("Session 已过期，需要重新登录。");
    console.log("请在浏览器中登录，完成后按 Enter...");
    await new Promise<void>((resolve) => { process.stdin.once("data", () => resolve()); });

    // 重新保存 session
    const storage = await context.storageState();
    fs.writeFileSync(storageFile, JSON.stringify(storage, null, 2));
    const cookies = await context.cookies();
    fs.writeFileSync(`${SESSION_DIR}/cookies.json`, JSON.stringify(cookies, null, 2));
    console.log("Session 已更新");
  }

  // 截图首页
  console.log("\n截图首页...");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-dashboard.png`, fullPage: true });
  console.log("保存: 01-dashboard.png");
  console.log("URL:", page.url());
  console.log("Title:", await page.title());

  // 获取所有导航链接
  const navInfo = await page.evaluate(() => {
    const result: string[] = [];
    // 获取所有可点击元素
    document.querySelectorAll("a, button, [role='menuitem'], [role='tab'], li[class*='menu'], li[class*='nav']").forEach((el) => {
      const text = (el as HTMLElement).innerText?.trim().replace(/\n/g, " ");
      const href = (el as HTMLAnchorElement).href || "";
      if (text && text.length > 0 && text.length < 60) {
        result.push(`${text} → ${href}`);
      }
    });
    return [...new Set(result)]; // 去重
  });

  console.log("\n=== 导航菜单 ===");
  navInfo.forEach((l) => console.log("  " + l));

  // 保存完整信息到文件
  const pageInfo = await page.evaluate(() => {
    const info: Record<string, unknown> = {};
    info.url = window.location.href;
    info.title = document.title;

    // 所有链接
    const links: Array<{ text: string; href: string }> = [];
    document.querySelectorAll("a").forEach((a) => {
      const text = a.innerText?.trim();
      if (text) links.push({ text: text.slice(0, 50), href: a.href });
    });
    info.links = links;

    // 侧边栏/导航结构
    const sidebar = document.querySelector("nav, .sidebar, .menu, [class*='sidebar'], [class*='nav']");
    if (sidebar) {
      info.sidebarHTML = (sidebar as HTMLElement).innerHTML.slice(0, 5000);
    }

    // body 的直接子元素结构
    const bodyChildren: string[] = [];
    document.body.children && Array.from(document.body.children).forEach((child) => {
      const el = child as HTMLElement;
      bodyChildren.push(`<${el.tagName.toLowerCase()} id="${el.id}" class="${el.className?.toString().slice(0, 50)}">`);
    });
    info.bodyStructure = bodyChildren;

    return info;
  });

  fs.writeFileSync(`${SCREENSHOT_DIR}/page-info.json`, JSON.stringify(pageInfo, null, 2));
  console.log("\n页面信息已保存到 wms-screenshots/page-info.json");

  // 等待用户手动导航到下单页面
  console.log("\n=== 请在浏览器中导航到下单/采购页面 ===");
  console.log("找到后按 Enter，我会截图并分析...");
  await new Promise<void>((resolve) => { process.stdin.once("data", () => resolve()); });

  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-order-page.png`, fullPage: true });
  console.log("保存: 02-order-page.png");
  console.log("URL:", page.url());

  // 分析下单页面的表单
  const formInfo = await page.evaluate(() => {
    const elements: Array<{ tag: string; type?: string; name?: string; id?: string; placeholder?: string; label?: string; classes?: string }> = [];
    document.querySelectorAll("input, select, textarea, button, [role='combobox'], [role='listbox']").forEach((el) => {
      const e = el as HTMLInputElement;
      // 找关联的 label
      let label = "";
      if (e.id) {
        const labelEl = document.querySelector(`label[for="${e.id}"]`);
        if (labelEl) label = (labelEl as HTMLElement).innerText?.trim() || "";
      }
      if (!label) {
        const parent = e.closest("label, .form-group, .form-item, [class*='field']");
        if (parent) label = (parent as HTMLElement).innerText?.trim().split("\n")[0] || "";
      }
      elements.push({
        tag: e.tagName.toLowerCase(),
        type: e.type,
        name: e.name,
        id: e.id,
        placeholder: e.placeholder,
        label: label.slice(0, 40),
        classes: e.className?.toString().slice(0, 50),
      });
    });
    return elements;
  });

  console.log("\n=== 下单页面表单元素 ===");
  formInfo.forEach((e) => {
    console.log(`  <${e.tag}> type=${e.type || "-"} name="${e.name || ""}" id="${e.id || ""}" placeholder="${e.placeholder || ""}" label="${e.label || ""}"`);
  });

  fs.writeFileSync(`${SCREENSHOT_DIR}/form-elements.json`, JSON.stringify(formInfo, null, 2));
  console.log("\n表单信息已保存到 wms-screenshots/form-elements.json");

  console.log("\n按 Enter 关闭浏览器...");
  await new Promise<void>((resolve) => { process.stdin.once("data", () => resolve()); });
  await browser.close();
}

run().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
