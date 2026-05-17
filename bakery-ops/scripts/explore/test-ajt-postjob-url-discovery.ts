/**
 * AJobThing 发布职位页面 URL 探测
 *
 * 从 dashboard 找到"Post Job"按钮的真实链接
 */
import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";
import {
  getCookieFile,
  getStorageFile,
  hasValidSession,
} from "../modules/domain/recruitment/connectors/ajobthing-login";

async function main() {
  if (!hasValidSession()) {
    console.log("未找到 AJobThing Cookie");
    return;
  }

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

  // 捕获所有导航和 API
  const apiCalls: { method: string; url: string; body?: string }[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/") || url.includes("job") || req.resourceType() === "xhr" || req.resourceType() === "fetch") {
      apiCalls.push({ method: req.method(), url, body: req.postData()?.slice(0, 500) });
    }
  });

  // Step 1: 去 dashboard 找 Post Job 链接
  console.log("1. 加载 Dashboard...");
  await page.goto("https://www.ajobthing.com/dashboard", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // 找所有包含 "post" "job" "create" "new" 的链接
  console.log("\n2. 查找 Post Job 相关链接...");
  const links = await page.evaluate(() => {
    const results: { text: string; href: string }[] = [];
    document.querySelectorAll("a").forEach((a) => {
      const text = (a.textContent || "").trim().toLowerCase();
      const href = a.href || "";
      if (
        text.includes("post") ||
        text.includes("job") ||
        text.includes("create") ||
        text.includes("new") ||
        text.includes("iklan") ||
        href.includes("post") ||
        href.includes("create") ||
        href.includes("new-job") ||
        href.includes("job-ad")
      ) {
        results.push({ text: (a.textContent || "").trim().slice(0, 80), href });
      }
    });
    return results;
  });

  for (const l of links) {
    console.log(`   "${l.text}" → ${l.href}`);
  }

  // 找所有按钮
  console.log("\n3. 查找 Post Job 相关按钮...");
  const buttons = await page.evaluate(() => {
    const results: { text: string; onclick: string; classes: string }[] = [];
    document.querySelectorAll("button, [role='button']").forEach((el) => {
      const text = (el.textContent || "").trim().toLowerCase();
      if (text.includes("post") || text.includes("job") || text.includes("create") || text.includes("new")) {
        results.push({
          text: (el.textContent || "").trim().slice(0, 80),
          onclick: (el as HTMLElement).getAttribute("onclick") || "",
          classes: el.className.slice(0, 100),
        });
      }
    });
    return results;
  });

  for (const b of buttons) {
    console.log(`   "${b.text}" onclick="${b.onclick}" class="${b.classes}"`);
  }

  // Step 2: 尝试导航到各种可能的 URL
  console.log("\n4. 尝试各种 URL...");
  const urls = [
    "https://www.ajobthing.com/employer/post-job",
    "https://www.ajobthing.com/post-job",
    "https://www.ajobthing.com/employer/job-ad/create",
    "https://www.ajobthing.com/employer/job-ads/create",
    "https://www.ajobthing.com/employer/new-job",
    "https://www.ajobthing.com/employer/jobs/new",
    "https://www.ajobthing.com/employer/jobs/post",
    "https://www.ajobthing.com/employer/job/create",
    "https://www.ajobthing.com/employer/job/post",
    "https://www.ajobthing.com/employer/job-posting",
    "https://www.ajobthing.com/employer/job-posting/create",
    "https://www.ajobthing.com/job/post",
    "https://www.ajobthing.com/job/create",
  ];

  for (const url of urls) {
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
      const status = resp?.status() || 0;
      const finalUrl = page.url();
      const is404 = (await page.content()).includes("404") || (await page.content()).includes("not found");
      console.log(`   ${url} → [${status}] ${finalUrl}${is404 ? " (404 page)" : ""}`);
      if (status === 200 && !is404 && finalUrl !== "https://www.ajobthing.com/dashboard") {
        console.log("   ✓ 可能是发布页面!");
        await page.screenshot({ path: `./ajt-postjob-${urls.indexOf(url)}.png`, fullPage: true });
      }
    } catch {
      console.log(`   ${url} → timeout/error`);
    }
  }

  // Step 3: 检查 packages API 了解发布方式
  console.log("\n5. 检查 packages 和 job posting API...");
  const apiTests = await page.evaluate(async () => {
    const endpoints = [
      { url: "/api/v4/employer/packages-group/active", method: "GET" },
      { url: "/api/v4/employer/jobs", method: "GET" },
      { url: "/api/v4/employer/job-ads", method: "GET" },
      { url: "/api/v4/job/list", method: "GET" },
      { url: "/api/employer/jobs", method: "GET" },
      { url: "/api/employer/job-ads", method: "GET" },
      { url: "/api/v4/employer/job/list", method: "GET" },
      { url: "/api/v4/employer/job/active", method: "GET" },
      { url: "/api/v4/employer/job-ad/list", method: "GET" },
    ];

    const results: { url: string; status: number; body: string }[] = [];
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep.url, {
          method: ep.method,
          headers: { Accept: "application/json" },
        });
        results.push({ url: ep.url, status: res.status, body: (await res.text()).slice(0, 500) });
      } catch (err) {
        results.push({ url: ep.url, status: 0, body: String(err) });
      }
    }
    return results;
  });

  for (const r of apiTests) {
    console.log(`   [${r.status}] ${r.url}`);
    if (r.status === 200) console.log(`     ${r.body.slice(0, 300)}`);
  }

  // Step 4: 检查 whats-new 通知 API
  console.log("\n6. 检查通知 API...");
  const notifTests = await page.evaluate(async () => {
    const endpoints = [
      { url: "/api/employer/whats-new/counter", method: "GET" },
      { url: "/api/employer/whats-new/latest", method: "GET" },
      { url: "/api/employer/whats-new/latest", method: "POST", body: "{}" },
      { url: "/api/employer/whats-new/list", method: "GET" },
      { url: "/api/employer/whats-new", method: "GET" },
      { url: "/api/employer/notifications", method: "GET" },
      { url: "/api/v4/employer/notifications", method: "GET" },
      { url: "/api/employer/stream-chat/unread-count", method: "GET" },
    ];

    const results: { url: string; method: string; status: number; body: string }[] = [];
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep.url, {
          method: ep.method,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: ep.method === "POST" ? ep.body : undefined,
        });
        results.push({ url: ep.url, method: ep.method, status: res.status, body: (await res.text()).slice(0, 1000) });
      } catch (err) {
        results.push({ url: ep.url, method: ep.method, status: 0, body: String(err) });
      }
    }
    return results;
  });

  for (const r of notifTests) {
    console.log(`   [${r.status}] ${r.method} ${r.url}`);
    if (r.status === 200) console.log(`     ${r.body.slice(0, 500)}`);
  }

  await context.close();
  await browser.close();
}

main().catch(console.error);
