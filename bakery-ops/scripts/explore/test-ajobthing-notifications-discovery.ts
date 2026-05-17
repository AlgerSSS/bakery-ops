/**
 * AJobThing 通知 API 探测脚本
 *
 * 用法: npx tsx src/__tests__/test-ajobthing-notifications-discovery.ts
 *
 * 探测 /api/employer/whats-new/latest 和 Stream Chat 消息轮询端点
 */
import { chromium } from "playwright";
import * as fs from "fs";
import {
  getCookieFile,
  getStorageFile,
  hasValidSession,
} from "../modules/domain/recruitment/connectors/ajobthing-login";

async function main() {
  if (!hasValidSession()) {
    console.log("未找到 AJobThing Cookie，请先运行 ajobthing-login.ts");
    return;
  }

  console.log("=== AJobThing 通知 API 探测 ===\n");

  const browser = await chromium.launch({ headless: true });
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

  // 验证 cookie
  console.log("1. 验证 Cookie...");
  await page.goto("https://www.ajobthing.com/dashboard", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  if (page.url().includes("login")) {
    console.log("Cookie 已过期");
    await browser.close();
    return;
  }
  console.log("   Cookie 有效 ✓\n");

  // Step 2: 测试 whats-new API
  console.log("2. 测试 /api/employer/whats-new/latest ...");
  const whatsNewResult = await page.evaluate(async () => {
    const endpoints = [
      { url: "/api/employer/whats-new/latest", method: "POST", body: "{}" },
      { url: "/api/employer/whats-new/latest", method: "GET", body: undefined },
      { url: "/api/employer/notifications", method: "GET", body: undefined },
      { url: "/api/employer/notifications/latest", method: "GET", body: undefined },
    ];

    const results: { url: string; method: string; status: number; body: string }[] = [];
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep.url, {
          method: ep.method,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: ep.body,
        });
        results.push({
          url: ep.url,
          method: ep.method,
          status: res.status,
          body: (await res.text()).slice(0, 2000),
        });
      } catch (err) {
        results.push({ url: ep.url, method: ep.method, status: 0, body: String(err) });
      }
    }
    return results;
  });

  for (const r of whatsNewResult) {
    console.log(`   ${r.method} ${r.url} → [${r.status}]`);
    console.log(`   Body: ${r.body.slice(0, 500)}`);
    console.log();
  }

  // Step 3: 测试 Stream Chat channels API
  console.log("3. 测试 Stream Chat channels API...");
  const chatResult = await page.evaluate(async () => {
    const endpoints = [
      { url: "/api/stream-chat/channels", method: "POST", body: JSON.stringify({ filter: {}, sort: [{ field: "last_message_at", direction: -1 }], limit: 5 }) },
      { url: "/api/stream-chat/channels", method: "GET", body: undefined },
      { url: "/api/stream-chat/token", method: "GET", body: undefined },
    ];

    const results: { url: string; method: string; status: number; body: string }[] = [];
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep.url, {
          method: ep.method,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: ep.body,
        });
        results.push({
          url: ep.url,
          method: ep.method,
          status: res.status,
          body: (await res.text()).slice(0, 2000),
        });
      } catch (err) {
        results.push({ url: ep.url, method: ep.method, status: 0, body: String(err) });
      }
    }
    return results;
  });

  for (const r of chatResult) {
    console.log(`   ${r.method} ${r.url} → [${r.status}]`);
    console.log(`   Body: ${r.body.slice(0, 500)}`);
    console.log();
  }

  // Step 4: 导航到 /chat 并捕获 WebSocket
  console.log("4. 检查 /chat 页面的 WebSocket 和 API...");
  const apiCalls: { method: string; url: string; body?: string }[] = [];

  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("stream") || url.includes("chat") || url.includes("getstream") || url.includes("notification")) {
      apiCalls.push({ method: req.method(), url, body: req.postData()?.slice(0, 500) });
    }
  });

  page.on("websocket", (ws) => {
    console.log(`   WebSocket: ${ws.url()}`);
    ws.on("framereceived", (frame) => {
      const data = typeof frame.payload === "string" ? frame.payload : frame.payload.toString();
      if (data.length < 500) console.log(`   WS 收到: ${data.slice(0, 300)}`);
    });
  });

  await page.goto("https://www.ajobthing.com/chat", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  console.log("\n   捕获的 API 调用:");
  for (const call of apiCalls) {
    console.log(`   ${call.method} ${call.url}`);
    if (call.body) console.log(`     Body: ${call.body}`);
  }

  await context.close();
  await browser.close();
}

main().catch(console.error);
