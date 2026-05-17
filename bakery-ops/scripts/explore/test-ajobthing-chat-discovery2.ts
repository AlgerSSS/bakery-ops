/**
 * AJobThing Chat API 探测 — Phase 2
 *
 * 用法: npx tsx src/__tests__/test-ajobthing-chat-discovery2.ts
 *
 * 已知:
 * - token endpoint: POST /api/stream-chat/chat/token  body: {"user_id":"196036"}
 * - 使用 GetStream.io SDK
 * - JWT payload: {"user_id":"196036"}
 *
 * 目标: 找到创建频道和发送消息的 API
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

  console.log("=== AJobThing Chat API 探测 Phase 2 ===\n");

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

  // Step 1: 获取 token（已确认可用）
  console.log("1. 获取 Stream Chat token...");
  await page.goto("https://www.ajobthing.com/chat", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(3000);

  const csrfToken = await page.$eval(
    'meta[name="csrf-token"]',
    (el) => el.getAttribute("content") || "",
  ).catch(() => "");
  console.log(`   CSRF token: ${csrfToken ? "found" : "not found"}`);

  // 用 company_id 获取 token
  const tokenResult = await page.evaluate(async () => {
    const res = await fetch("/api/stream-chat/chat/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ user_id: "196036" }),
    });
    return { status: res.status, body: await res.text() };
  });
  console.log(`   Token response [${tokenResult.status}]: ${tokenResult.body}`);

  const chatToken = JSON.parse(tokenResult.body).token;
  if (!chatToken) {
    console.log("   获取 token 失败");
    await browser.close();
    return;
  }
  console.log(`   Token: ${chatToken}\n`);

  // Step 2: 查找 GetStream API key（从 JS bundle 或页面中）
  console.log("2. 查找 GetStream API key...");
  const streamInfo = await page.evaluate(() => {
    const result: Record<string, string> = {};

    // 查找所有 script 标签中的 getstream 相关内容
    const scripts = document.querySelectorAll("script[src]");
    scripts.forEach((s) => {
      const src = s.getAttribute("src") || "";
      if (src.includes("stream") || src.includes("chat")) {
        result[`script_src`] = src;
      }
    });

    // 查找 window 上的 stream 相关对象
    const w = window as Record<string, unknown>;
    for (const key of Object.keys(w)) {
      const kl = key.toLowerCase();
      if (kl.includes("stream") || kl === "streamchat" || kl === "chatclient") {
        try {
          result[key] = JSON.stringify(w[key]).slice(0, 500);
        } catch {
          result[key] = String(w[key]).slice(0, 200);
        }
      }
    }

    // 查找 __NUXT__ 数据
    if (w.__NUXT__) {
      try {
        const nuxtStr = JSON.stringify(w.__NUXT__);
        // 查找 stream 相关的 key
        const streamMatch = nuxtStr.match(/stream[^"]*api[^"]*key[^"]*"[^"]*"([^"]+)"/i);
        if (streamMatch) result["nuxt_stream_key"] = streamMatch[1];
        // 查找任何看起来像 API key 的东西
        const keyMatch = nuxtStr.match(/"([\w]{20,})"/g);
        if (keyMatch) result["nuxt_potential_keys"] = keyMatch.slice(0, 5).join(", ");
      } catch {}
    }

    return result;
  });

  for (const [k, v] of Object.entries(streamInfo)) {
    console.log(`   ${k}: ${v}`);
  }
  console.log();

  // Step 3: 拦截所有到 getstream.io 的请求
  console.log("3. 监听 GetStream.io API 调用...");
  const getstreamRequests: Array<{ url: string; method: string; body?: string }> = [];

  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("getstream") || url.includes("stream-io")) {
      getstreamRequests.push({
        url,
        method: req.method(),
        body: req.postData() || undefined,
      });
      console.log(`   → ${req.method()} ${url}`);
      if (req.postData()) console.log(`     Body: ${req.postData()!.slice(0, 500)}`);
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("getstream") || url.includes("stream-io")) {
      try {
        const body = await res.text();
        console.log(`   ← [${res.status()}] ${url}`);
        console.log(`     Body: ${body.slice(0, 500)}`);
      } catch {}
    }
  });

  // Step 4: 查找 JS bundle 中的 GetStream API key 和 channel 创建逻辑
  console.log("\n4. 搜索 JS bundle 中的 GetStream 配置...");

  // 获取所有 JS bundle URLs
  const jsUrls = await page.evaluate(() => {
    const scripts = document.querySelectorAll("script[src]");
    return Array.from(scripts)
      .map((s) => s.getAttribute("src") || "")
      .filter((src) => src.includes("/_nuxt/") || src.includes("/js/"));
  });

  console.log(`   找到 ${jsUrls.length} 个 JS bundle`);

  // 下载并搜索每个 bundle
  for (const jsUrl of jsUrls.slice(0, 20)) {
    try {
      const fullUrl = jsUrl.startsWith("http") ? jsUrl : `https://www.ajobthing.com${jsUrl}`;
      const content = await page.evaluate(async (url) => {
        const res = await fetch(url);
        return res.text();
      }, fullUrl);

      // 搜索 getstream 相关内容
      if (
        content.includes("getstream") ||
        content.includes("StreamChat") ||
        content.includes("stream-chat") ||
        content.includes("chat/channel") ||
        content.includes("chat/create") ||
        content.includes("chat/send") ||
        content.includes("sendMessage")
      ) {
        console.log(`\n   ★ 找到 Stream Chat 相关代码: ${jsUrl}`);

        // 提取 API key
        const apiKeyMatch = content.match(/(?:api_?key|apiKey|key)\s*[:=]\s*["']([a-z0-9]{20,})["']/i);
        if (apiKeyMatch) {
          console.log(`   API Key: ${apiKeyMatch[1]}`);
        }

        // 提取 getstream 相关的代码片段
        const patterns = [
          /StreamChat\([^)]*\)/g,
          /new\s+StreamChat\([^)]*\)/g,
          /\.channel\([^)]*\)/g,
          /\.sendMessage\([^)]*\)/g,
          /chat\/create[^"']*/g,
          /chat\/send[^"']*/g,
          /chat\/channel[^"']*/g,
          /stream-chat[^"']*/g,
          /getstream\.io[^"']*/g,
          /api\/stream-chat[^"']*/g,
        ];

        for (const pattern of patterns) {
          const matches = content.match(pattern);
          if (matches) {
            console.log(`   Pattern ${pattern.source}:`);
            for (const m of matches.slice(0, 3)) {
              console.log(`     ${m.slice(0, 200)}`);
            }
          }
        }

        // 提取包含 "stream" 或 "chat" 的函数上下文
        const streamIdx = content.indexOf("stream-chat");
        if (streamIdx > -1) {
          console.log(`\n   Context around "stream-chat":`);
          console.log(`   ${content.slice(Math.max(0, streamIdx - 200), streamIdx + 300)}`);
        }

        const sendMsgIdx = content.indexOf("sendMessage");
        if (sendMsgIdx > -1) {
          console.log(`\n   Context around "sendMessage":`);
          console.log(`   ${content.slice(Math.max(0, sendMsgIdx - 200), sendMsgIdx + 300)}`);
        }

        const channelIdx = content.indexOf(".channel(");
        if (channelIdx > -1) {
          console.log(`\n   Context around ".channel(":`);
          console.log(`   ${content.slice(Math.max(0, channelIdx - 200), channelIdx + 300)}`);
        }
      }
    } catch {}
  }

  // Step 5: 尝试直接用 GetStream REST API
  console.log("\n\n5. 尝试 GetStream REST API...");

  // 解码 JWT 获取信息
  const jwtParts = chatToken.split(".");
  const jwtPayload = JSON.parse(Buffer.from(jwtParts[1], "base64").toString());
  console.log(`   JWT payload: ${JSON.stringify(jwtPayload)}`);

  // Step 6: 查看 /api/stream-chat/ 下还有哪些端点
  console.log("\n6. 探测 /api/stream-chat/ 端点...");
  const endpoints = [
    { path: "/api/stream-chat/chat/channels", method: "POST", body: { user_id: "196036" } },
    { path: "/api/stream-chat/chat/channel/create", method: "POST", body: { user_id: "196036", candidate_id: "test" } },
    { path: "/api/stream-chat/chat/send", method: "POST", body: { user_id: "196036", message: "test" } },
    { path: "/api/stream-chat/chat/messages", method: "POST", body: { user_id: "196036" } },
    { path: "/api/stream-chat/chat/list", method: "POST", body: { user_id: "196036" } },
    { path: "/api/stream-chat/chat/list", method: "GET", body: null },
    { path: "/api/employer/chat/send", method: "POST", body: { user_id: "196036" } },
    { path: "/api/employer/chat/create", method: "POST", body: { user_id: "196036" } },
    { path: "/api/v5/employer/chat/send", method: "POST", body: { user_id: "196036" } },
    { path: "/api/v5/employer/chat/channels", method: "GET", body: null },
  ];

  for (const ep of endpoints) {
    try {
      const result = await page.evaluate(
        async ({ path, method, body }) => {
          const opts: RequestInit = {
            method,
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
          };
          if (body && method === "POST") {
            opts.body = JSON.stringify(body);
          }
          const res = await fetch(path, opts);
          return { status: res.status, body: await res.text().then((t) => t.slice(0, 300)) };
        },
        ep,
      );
      const icon = result.status === 200 || result.status === 201 ? "✓" : "✗";
      console.log(`   ${icon} [${result.status}] ${ep.method} ${ep.path}`);
      if (result.status !== 404 && result.status !== 405) {
        console.log(`     ${result.body}`);
      }
    } catch (err) {
      console.log(`   ✗ ${ep.method} ${ep.path}: ${String(err).slice(0, 100)}`);
    }
  }

  await page.waitForTimeout(2000);

  if (getstreamRequests.length > 0) {
    console.log(`\n━━━ GetStream.io 请求汇总 ━━━`);
    for (const r of getstreamRequests) {
      console.log(`${r.method} ${r.url}`);
      if (r.body) console.log(`  Body: ${r.body.slice(0, 500)}`);
    }
  }

  await context.close();
  await browser.close();
}

main().catch(console.error);
