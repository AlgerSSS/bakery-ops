/**
 * JobStreet 发布职位 API 探测脚本
 *
 * 用法: npx tsx src/__tests__/test-jobstreet-job-posting-discovery.ts
 *
 * 导航到发布职位页面，拦截 GraphQL mutation（createJobAd 或类似）
 */
import { chromium } from "playwright";
import * as fs from "fs";
import {
  getCookieFile,
  getStorageFile,
  hasValidSession,
} from "../modules/domain/recruitment/connectors/jobstreet-login";

interface CapturedRequest {
  url: string;
  method: string;
  postData?: string;
}

interface CapturedResponse {
  url: string;
  status: number;
  body: string;
}

async function main() {
  if (!hasValidSession()) {
    console.log("未找到 JobStreet Cookie，请先运行 jobstreet-login.ts");
    return;
  }

  console.log("=== JobStreet 发布职位 API 探测 ===\n");

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
  const requests: CapturedRequest[] = [];
  const responses: CapturedResponse[] = [];

  // 拦截 GraphQL 和 API 请求
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("graphql") || url.includes("/api/") || url.includes("job")) {
      const entry: CapturedRequest = { url, method: req.method() };
      if (req.postData()) entry.postData = req.postData()!;
      requests.push(entry);
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("graphql") || url.includes("/api/") || url.includes("job")) {
      try {
        const body = await res.text();
        responses.push({ url, status: res.status(), body: body.slice(0, 3000) });
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
    console.log("Cookie 已过期，请重新登录");
    await browser.close();
    return;
  }
  console.log("   Cookie 有效 ✓\n");

  // Step 2: 导航到发布职位页面
  console.log("2. 导航到发布职位页面...");
  const postJobUrls = [
    "https://my.employer.seek.com/jobs/new",
    "https://my.employer.seek.com/jobs/create",
    "https://my.employer.seek.com/post-job",
    "https://my.employer.seek.com/job-ad/create",
  ];

  for (const url of postJobUrls) {
    console.log(`   尝试: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    console.log(`   → ${currentUrl}`);
    if (!currentUrl.includes("login") && !currentUrl.includes("oauth") && !currentUrl.includes("404")) {
      console.log("   找到发布页面 ✓\n");
      break;
    }
  }

  // Step 3: 检查表单结构
  console.log("3. 检查表单结构...");
  const formFields = await page.evaluate(() => {
    const fields: { tag: string; name: string; type: string; placeholder: string; label: string }[] = [];
    document.querySelectorAll("input, textarea, select").forEach((el) => {
      const input = el as HTMLInputElement;
      const label = el.closest("label")?.textContent?.trim().slice(0, 50) || "";
      fields.push({
        tag: el.tagName.toLowerCase(),
        name: input.name || "",
        type: input.type || "",
        placeholder: input.placeholder || "",
        label,
      });
    });
    return fields;
  });

  for (const f of formFields) {
    console.log(`   <${f.tag}> name="${f.name}" type="${f.type}" placeholder="${f.placeholder}" label="${f.label}"`);
  }
  console.log();

  // Step 4: 截图
  await page.screenshot({ path: "./jobstreet-job-posting-page.png", fullPage: true });
  console.log("4. 截图已保存: ./jobstreet-job-posting-page.png\n");

  // Step 5: 打印 GraphQL 请求
  console.log("━━━ 捕获的 GraphQL/API 请求 ━━━\n");
  for (const req of requests) {
    console.log(`${req.method} ${req.url}`);
    if (req.postData) {
      // 尝试解析 GraphQL query 名称
      try {
        const parsed = JSON.parse(req.postData);
        if (parsed.query) {
          const match = parsed.query.match(/(query|mutation)\s+(\w+)/);
          if (match) console.log(`  Operation: ${match[1]} ${match[2]}`);
        }
        console.log(`  Body: ${req.postData.slice(0, 500)}`);
      } catch {
        console.log(`  Body: ${req.postData.slice(0, 500)}`);
      }
    }
    console.log();
  }

  console.log("━━━ 捕获的 GraphQL/API 响应 ━━━\n");
  for (const res of responses) {
    console.log(`[${res.status}] ${res.url}`);
    console.log(`  Body: ${res.body.slice(0, 500)}`);
    console.log();
  }

  await context.close();
  await browser.close();
}

main().catch(console.error);
