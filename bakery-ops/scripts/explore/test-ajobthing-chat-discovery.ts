/**
 * AJobThing Chat API 探测脚本
 *
 * 用法: npx tsx src/__tests__/test-ajobthing-chat-discovery.ts
 *
 * 导航到 /chat 页面，拦截所有网络请求，找出真实的 Stream Chat API 端点
 */
import { chromium } from "playwright";
import * as fs from "fs";
import {
  getCookieFile,
  getStorageFile,
  hasValidSession,
} from "../modules/domain/recruitment/connectors/ajobthing-login";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType: string;
}

interface CapturedResponse {
  url: string;
  status: number;
  body: string;
}

async function main() {
  if (!hasValidSession()) {
    console.log("未找到 AJobThing Cookie，请先运行 ajobthing-login.ts");
    return;
  }

  console.log("=== AJobThing Chat API 探测 ===\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });

  // 加载 cookies
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

  // 收集所有请求和响应
  const requests: CapturedRequest[] = [];
  const responses: CapturedResponse[] = [];

  // 拦截所有 XHR/Fetch 请求
  page.on("request", (req) => {
    const url = req.url();
    const type = req.resourceType();
    // 只关注 API 调用，忽略静态资源
    if (
      type === "xhr" ||
      type === "fetch" ||
      url.includes("/api/") ||
      url.includes("chat") ||
      url.includes("stream") ||
      url.includes("message") ||
      url.includes("getstream")
    ) {
      const entry: CapturedRequest = {
        url,
        method: req.method(),
        headers: req.headers(),
        resourceType: type,
      };
      if (req.postData()) {
        entry.postData = req.postData()!;
      }
      requests.push(entry);
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    if (
      url.includes("/api/") ||
      url.includes("chat") ||
      url.includes("stream") ||
      url.includes("message") ||
      url.includes("getstream")
    ) {
      try {
        const body = await res.text();
        responses.push({ url, status: res.status(), body: body.slice(0, 2000) });
      } catch {}
    }
  });

  // Step 1: 先验证 cookie
  console.log("1. 验证 Cookie...");
  await page.goto("https://www.ajobthing.com/dashboard", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  const url = page.url();
  if (url.includes("login") || url.includes("auth")) {
    console.log("Cookie 已过期，请重新登录");
    await browser.close();
    return;
  }
  console.log("   Cookie 有效 ✓\n");

  // Step 2: 导航到 /chat 页面
  console.log("2. 导航到 /chat 页面...");
  await page.goto("https://www.ajobthing.com/chat", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(5000);
  console.log(`   当前 URL: ${page.url()}\n`);

  // Step 3: 尝试点击一个聊天对话（如果有的话）
  console.log("3. 查找聊天列表...");
  const chatItems = await page.locator('[class*="chat"], [class*="conversation"], [class*="channel"], [data-testid*="chat"]').all();
  console.log(`   找到 ${chatItems.length} 个聊天相关元素`);

  // 尝试点击第一个聊天项
  if (chatItems.length > 0) {
    try {
      await chatItems[0].click();
      await page.waitForTimeout(3000);
      console.log("   已点击第一个聊天项\n");
    } catch {
      console.log("   点击聊天项失败\n");
    }
  }

  // Step 4: 检查页面上的 JS 变量
  console.log("4. 检查页面 JS 变量...");
  const jsVars = await page.evaluate(() => {
    const result: Record<string, unknown> = {};
    // 检查常见的全局变量
    const w = window as Record<string, unknown>;
    for (const key of Object.keys(w)) {
      if (
        key.toLowerCase().includes("chat") ||
        key.toLowerCase().includes("stream") ||
        key.toLowerCase().includes("pusher") ||
        key.toLowerCase().includes("echo") ||
        key.toLowerCase().includes("socket") ||
        key.toLowerCase().includes("config") ||
        key.toLowerCase().includes("app")
      ) {
        try {
          const val = w[key];
          if (val && typeof val === "object") {
            result[key] = JSON.stringify(val).slice(0, 500);
          } else if (typeof val === "string" || typeof val === "number") {
            result[key] = val;
          }
        } catch {}
      }
    }
    return result;
  });

  if (Object.keys(jsVars).length > 0) {
    console.log("   找到的全局变量:");
    for (const [k, v] of Object.entries(jsVars)) {
      console.log(`   ${k}: ${String(v).slice(0, 200)}`);
    }
  } else {
    console.log("   未找到相关全局变量");
  }
  console.log();

  // Step 5: 检查 meta 标签和 script 标签中的配置
  console.log("5. 检查页面配置...");
  const pageConfig = await page.evaluate(() => {
    const result: Record<string, string> = {};
    // meta 标签
    document.querySelectorAll("meta").forEach((m) => {
      const name = m.getAttribute("name") || m.getAttribute("property") || "";
      const content = m.getAttribute("content") || "";
      if (name && content) result[`meta:${name}`] = content;
    });
    // 查找内联 script 中的配置
    document.querySelectorAll("script:not([src])").forEach((s, i) => {
      const text = s.textContent || "";
      if (
        text.includes("chat") ||
        text.includes("stream") ||
        text.includes("pusher") ||
        text.includes("socket") ||
        text.includes("getstream")
      ) {
        result[`script:${i}`] = text.slice(0, 1000);
      }
    });
    return result;
  });

  for (const [k, v] of Object.entries(pageConfig)) {
    console.log(`   ${k}: ${v.slice(0, 200)}`);
  }
  console.log();

  // Step 6: 检查 WebSocket 连接
  console.log("6. 检查 WebSocket...");
  const wsUrls: string[] = [];
  context.on("weberror", () => {}); // suppress
  page.on("websocket", (ws) => {
    wsUrls.push(ws.url());
    console.log(`   WebSocket 连接: ${ws.url()}`);
    ws.on("framereceived", (frame) => {
      const data = typeof frame.payload === "string" ? frame.payload : frame.payload.toString();
      if (data.length < 500) {
        console.log(`   WS 收到: ${data.slice(0, 300)}`);
      }
    });
    ws.on("framesent", (frame) => {
      const data = typeof frame.payload === "string" ? frame.payload : frame.payload.toString();
      if (data.length < 500) {
        console.log(`   WS 发送: ${data.slice(0, 300)}`);
      }
    });
  });

  // 重新加载页面以捕获 WebSocket
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);

  if (wsUrls.length === 0) {
    console.log("   未检测到 WebSocket 连接");
  }
  console.log();

  // Step 7: 打印所有捕获的 API 请求
  console.log("━━━ 捕获的 API 请求 ━━━\n");
  for (const req of requests) {
    console.log(`${req.method} ${req.url}`);
    if (req.postData) {
      console.log(`  Body: ${req.postData.slice(0, 500)}`);
    }
    console.log();
  }

  console.log("━━━ 捕获的 API 响应 ━━━\n");
  for (const res of responses) {
    console.log(`[${res.status}] ${res.url}`);
    console.log(`  Body: ${res.body.slice(0, 500)}`);
    console.log();
  }

  // Step 8: 截图保存
  const screenshotPath = "./ajobthing-chat-page.png";
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`\n截图已保存: ${screenshotPath}`);

  // Step 9: 打印页面 HTML 结构（聊天区域）
  console.log("\n━━━ 页面结构 ━━━\n");
  const bodyHtml = await page.evaluate(() => {
    return document.body.innerHTML.slice(0, 5000);
  });
  console.log(bodyHtml.slice(0, 3000));

  await context.close();
  await browser.close();
}

main().catch(console.error);
