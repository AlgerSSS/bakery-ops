/**
 * JobStreet 通知 API 探测脚本
 *
 * 用法: npx tsx src/__tests__/test-jobstreet-notifications-discovery.ts
 *
 * 拦截 applications/inbox 相关 GraphQL query
 */
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

  console.log("=== JobStreet 通知 API 探测 ===\n");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    acceptDownloads: true,
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

  const graphqlOps: { operation: string; query: string; variables: string; response?: string }[] = [];

  // 拦截所有 GraphQL 请求
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("graphql") && req.method() === "POST") {
      try {
        const data = JSON.parse(req.postData() || "{}");
        const match = (data.query || "").match(/(query|mutation)\s+(\w+)/);
        graphqlOps.push({
          operation: match ? `${match[1]} ${match[2]}` : "unknown",
          query: (data.query || "").slice(0, 500),
          variables: JSON.stringify(data.variables || {}).slice(0, 300),
        });
      } catch {}
    }
  });

  page.on("response", async (res) => {
    if (res.url().includes("graphql")) {
      try {
        const body = await res.text();
        // 匹配到最近的 graphqlOps 条目
        const lastOp = graphqlOps[graphqlOps.length - 1];
        if (lastOp && !lastOp.response) {
          lastOp.response = body.slice(0, 1000);
        }
      } catch {}
    }
  });

  // Step 1: 验证 cookie
  console.log("1. 验证 Cookie...");
  await page.goto("https://my.employer.seek.com/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);

  if (page.url().includes("login") || page.url().includes("oauth")) {
    console.log("Cookie 已过期");
    await browser.close();
    return;
  }
  console.log("   Cookie 有效 ✓\n");

  // Step 2: 导航到 Applications 页面
  console.log("2. 导航到 Applications 页面...");
  const appUrls = [
    "https://my.employer.seek.com/candidates",
    "https://my.employer.seek.com/applications",
    "https://my.employer.seek.com/manage-applications",
  ];

  for (const url of appUrls) {
    console.log(`   尝试: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    console.log(`   → ${page.url()}`);
    if (!page.url().includes("login") && !page.url().includes("404")) {
      console.log("   找到 Applications 页面 ✓\n");
      break;
    }
  }

  // Step 3: 导航到 Messages/Inbox 页面
  console.log("3. 导航到 Messages 页面...");
  const msgUrls = [
    "https://my.employer.seek.com/messages",
    "https://my.employer.seek.com/inbox",
    "https://my.employer.seek.com/talentsearch/messages",
  ];

  for (const url of msgUrls) {
    console.log(`   尝试: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    console.log(`   → ${page.url()}`);
    if (!page.url().includes("login") && !page.url().includes("404")) {
      console.log("   找到 Messages 页面 ✓\n");
      break;
    }
  }

  // Step 4: 打印所有捕获的 GraphQL 操作
  console.log("━━━ 捕获的 GraphQL 操作 ━━━\n");
  for (const op of graphqlOps) {
    console.log(`Operation: ${op.operation}`);
    console.log(`  Query: ${op.query}`);
    console.log(`  Variables: ${op.variables}`);
    if (op.response) console.log(`  Response: ${op.response.slice(0, 500)}`);
    console.log();
  }

  // Step 5: 尝试直接调用一些可能的 query
  console.log("━━━ 直接测试 GraphQL Query ━━━\n");
  const testQueries = [
    {
      name: "GetApplications",
      query: `query GetApplications { applications(first: 5) { edges { node { id candidateName jobTitle appliedAt } } } }`,
    },
    {
      name: "GetNotifications",
      query: `query GetNotifications { notifications(first: 5) { edges { node { id type message createdAt } } } }`,
    },
    {
      name: "GetMessages",
      query: `query GetMessages { messages(first: 5) { edges { node { id senderName body sentAt } } } }`,
    },
  ];

  for (const tq of testQueries) {
    const result = await page.evaluate(
      async ({ query }) => {
        try {
          const res = await fetch("/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
          });
          return { status: res.status, body: (await res.text()).slice(0, 1000) };
        } catch (err) {
          return { status: 0, body: String(err) };
        }
      },
      { query: tq.query },
    );
    console.log(`${tq.name}: [${result.status}]`);
    console.log(`  ${result.body.slice(0, 500)}`);
    console.log();
  }

  // Step 6: 截图
  await page.screenshot({ path: "./jobstreet-notifications-page.png", fullPage: true });
  console.log("截图已保存: ./jobstreet-notifications-page.png");

  await context.close();
  await browser.close();
}

main().catch(console.error);
