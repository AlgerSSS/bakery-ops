import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";
import { getCookieFile, getStorageFile, hasValidSession } from "../modules/domain/recruitment/connectors/ajobthing-login";

async function main() {
  if (!hasValidSession()) return;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" });
  const cookieFile = getCookieFile();
  if (fs.existsSync(cookieFile)) await context.addCookies(JSON.parse(fs.readFileSync(cookieFile, "utf-8")));
  const storageFile = getStorageFile();
  if (fs.existsSync(storageFile)) {
    const storage = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
    await context.addInitScript((data: Record<string, string>) => { for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v); }, storage);
  }
  const page = await context.newPage();

  // 捕获所有请求
  const apiCalls: { method: string; url: string; body?: string }[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (req.resourceType() === "xhr" || req.resourceType() === "fetch" || url.includes("/api/")) {
      apiCalls.push({ method: req.method(), url, body: req.postData()?.slice(0, 800) });
    }
  });

  // 1. 导航到 /v4/post-job（从 dashboard 发现的真实链接）
  console.log("1. 导航到 /v4/post-job ...");
  await page.goto("https://www.ajobthing.com/v4/post-job", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log("   URL:", page.url());
  await page.screenshot({ path: "./ajt-v4-postjob.png", fullPage: true });

  // 2. 也试试 /create
  console.log("\n2. 导航到 /create ...");
  await page.goto("https://www.ajobthing.com/create", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log("   URL:", page.url());
  await page.screenshot({ path: "./ajt-create.png", fullPage: true });

  // 3. 检查表单结构
  console.log("\n3. 检查表单...");
  const formFields = await page.evaluate(() => {
    const fields: { tag: string; name: string; type: string; placeholder: string; id: string; label: string }[] = [];
    document.querySelectorAll("input, textarea, select").forEach((el) => {
      const input = el as HTMLInputElement;
      const label = el.closest("label")?.textContent?.trim().slice(0, 50) || 
                    document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim().slice(0, 50) || "";
      fields.push({ tag: el.tagName.toLowerCase(), name: input.name || "", type: input.type || "", placeholder: input.placeholder || "", id: input.id || "", label });
    });
    return fields;
  });
  for (const f of formFields) {
    console.log(`   <${f.tag}> name="${f.name}" type="${f.type}" id="${f.id}" placeholder="${f.placeholder}" label="${f.label}"`);
  }

  // 4. 打印捕获的 API
  console.log("\n4. 捕获的 API 调用:");
  for (const c of apiCalls) {
    if (c.url.includes("ajobthing") || c.url.includes("/api/")) {
      console.log(`   ${c.method} ${c.url}`);
      if (c.body) console.log(`     Body: ${c.body.slice(0, 300)}`);
    }
  }

  // 5. 测试 whats-new/latest GET 的完整响应
  console.log("\n5. whats-new/latest 完整响应:");
  const whatsNew = await page.evaluate(async () => {
    const res = await fetch("/api/employer/whats-new/latest", { headers: { Accept: "application/json" } });
    return (await res.text()).slice(0, 3000);
  });
  console.log(whatsNew);

  await context.close();
  await browser.close();
}
main().catch(console.error);
