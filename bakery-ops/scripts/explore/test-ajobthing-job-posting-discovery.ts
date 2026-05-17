/**
 * AJobThing 发布职位 API 探测脚本
 *
 * 用法: npx tsx src/__tests__/test-ajobthing-job-posting-discovery.ts
 *
 * 导航到发布职位页面，拦截所有 POST 端点，发现真实的发布 API 和字段结构
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

  console.log("=== AJobThing 发布职位 API 探测 ===\n");

  const browser = await chromium.launch({ headless: false });
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
  const requests: CapturedRequest[] = [];
  const responses: CapturedResponse[] = [];

  // 拦截所有 API 请求
  page.on("request", (req) => {
    const url = req.url();
    const type = req.resourceType();
    if (
      type === "xhr" ||
      type === "fetch" ||
      url.includes("/api/") ||
      url.includes("job") ||
      url.includes("post")
    ) {
      const entry: CapturedRequest = {
        url,
        method: req.method(),
        headers: req.headers(),
        resourceType: type,
      };
      if (req.postData()) entry.postData = req.postData()!;
      requests.push(entry);
    }
  });

  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/") || url.includes("job") || url.includes("post")) {
      try {
        const body = await res.text();
        responses.push({ url, status: res.status(), body: body.slice(0, 2000) });
      } catch {}
    }
  });

  // Step 1: 验证 cookie
  console.log("1. 验证 Cookie...");
  await page.goto("https://www.ajobthing.com/dashboard", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  if (page.url().includes("login")) {
    console.log("Cookie 已过期，请重新登录");
    await browser.close();
    return;
  }
  console.log("   Cookie 有效 ✓\n");

  // Step 2: 导航到发布职位页面
  console.log("2. 导航到发布职位页面...");
  // 尝试多个可能的 URL
  const postJobUrls = [
    "https://www.ajobthing.com/employer/jobs/create",
    "https://www.ajobthing.com/employer/post-job",
    "https://www.ajobthing.com/post-job",
    "https://www.ajobthing.com/employer/jobs/new",
  ];

  for (const url of postJobUrls) {
    console.log(`   尝试: ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    console.log(`   → ${currentUrl}`);
    if (!currentUrl.includes("login") && !currentUrl.includes("404")) {
      console.log("   找到发布页面 ✓\n");
      break;
    }
  }

  // Step 3: 检查页面表单结构
  console.log("3. 检查表单结构...");
  const formFields = await page.evaluate(() => {
    const fields: { tag: string; name: string; type: string; placeholder: string; id: string }[] = [];
    document.querySelectorAll("input, textarea, select").forEach((el) => {
      const input = el as HTMLInputElement;
      fields.push({
        tag: el.tagName.toLowerCase(),
        name: input.name || "",
        type: input.type || "",
        placeholder: input.placeholder || "",
        id: input.id || "",
      });
    });
    return fields;
  });

  for (const f of formFields) {
    console.log(`   <${f.tag}> name="${f.name}" type="${f.type}" placeholder="${f.placeholder}" id="${f.id}"`);
  }
  console.log();

  // Step 4: 检查页面上的按钮
  console.log("4. 检查按钮...");
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button, [role='button'], a.btn")).map((el) => ({
      text: (el.textContent || "").trim().slice(0, 50),
      type: (el as HTMLButtonElement).type || "",
      href: (el as HTMLAnchorElement).href || "",
    }));
  });
  for (const b of buttons) {
    console.log(`   [${b.type}] "${b.text}" ${b.href}`);
  }
  console.log();

  // Step 5: 截图
  await page.screenshot({ path: "./ajobthing-job-posting-page.png", fullPage: true });
  console.log("5. 截图已保存: ./ajobthing-job-posting-page.png\n");

  // Step 6: 打印捕获的 API 请求
  console.log("━━━ 捕获的 API 请求 ━━━\n");
  for (const req of requests) {
    console.log(`${req.method} ${req.url}`);
    if (req.postData) console.log(`  Body: ${req.postData.slice(0, 500)}`);
    console.log();
  }

  console.log("━━━ 捕获的 API 响应 ━━━\n");
  for (const res of responses) {
    console.log(`[${res.status}] ${res.url}`);
    console.log(`  Body: ${res.body.slice(0, 500)}`);
    console.log();
  }

  await context.close();
  await browser.close();
}

main().catch(console.error);
