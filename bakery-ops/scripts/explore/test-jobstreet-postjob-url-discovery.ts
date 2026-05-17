/**
 * JobStreet 发布职位 URL 探测脚本
 *
 * 从 dashboard 出发，枚举所有导航链接，找到真正的 post-job 页面
 *
 * 用法: npx tsx src/__tests__/test-jobstreet-postjob-url-discovery.ts
 */
import "dotenv/config";
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

  console.log("=== JobStreet Post-Job URL 探测 ===\n");

  const browser = await chromium.launch({ headless: false });
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

  // 拦截所有导航请求
  const navigations: string[] = [];
  page.on("request", (req) => {
    if (req.resourceType() === "document") {
      navigations.push(req.url());
    }
  });

  // Step 1: 去 dashboard
  console.log("1. 导航到 Dashboard...");
  await page.goto("https://my.employer.seek.com/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(5000);
  console.log(`   当前 URL: ${page.url()}\n`);

  // Step 2: 收集所有链接
  console.log("2. 收集页面上所有链接...\n");
  const allLinks = await page.evaluate(() => {
    const links: { text: string; href: string }[] = [];
    document.querySelectorAll("a[href]").forEach((a) => {
      const el = a as HTMLAnchorElement;
      links.push({
        text: (el.textContent || "").trim().slice(0, 80),
        href: el.href,
      });
    });
    return links;
  });

  // 过滤出可能与 post/create/job/ad 相关的链接
  const jobKeywords = ["post", "create", "new", "job", "ad", "draft", "write", "publish", "listing"];
  const relevantLinks = allLinks.filter((l) => {
    const lower = (l.href + " " + l.text).toLowerCase();
    return jobKeywords.some((kw) => lower.includes(kw));
  });

  console.log(`   总链接数: ${allLinks.length}`);
  console.log(`   职位相关链接: ${relevantLinks.length}\n`);

  console.log("━━━ 所有链接 ━━━\n");
  for (const l of allLinks) {
    console.log(`  [${l.text}] → ${l.href}`);
  }

  console.log("\n━━━ 职位相关链接 ━━━\n");
  for (const l of relevantLinks) {
    console.log(`  [${l.text}] → ${l.href}`);
  }

  // Step 3: 查找导航栏中的按钮（可能不是 <a> 标签）
  console.log("\n3. 查找所有按钮...\n");
  const allButtons = await page.evaluate(() => {
    const buttons: { text: string; tag: string; onclick: string }[] = [];
    document.querySelectorAll("button, [role='button'], [role='link']").forEach((el) => {
      buttons.push({
        text: (el.textContent || "").trim().slice(0, 80),
        tag: el.tagName,
        onclick: el.getAttribute("onclick") || el.getAttribute("data-href") || "",
      });
    });
    return buttons;
  });

  const relevantButtons = allButtons.filter((b) => {
    const lower = b.text.toLowerCase();
    return jobKeywords.some((kw) => lower.includes(kw));
  });

  console.log(`   总按钮数: ${allButtons.length}`);
  console.log(`   职位相关按钮: ${relevantButtons.length}\n`);

  for (const b of relevantButtons) {
    console.log(`  [${b.tag}] "${b.text}" onclick="${b.onclick}"`);
  }

  // Step 4: 尝试一系列可能的 URL
  console.log("\n4. 尝试可能的 Post-Job URL...\n");
  const candidateUrls = [
    "https://my.employer.seek.com/job-ad/create",
    "https://my.employer.seek.com/job-ad/new",
    "https://my.employer.seek.com/job-ads/create",
    "https://my.employer.seek.com/job-ads/new",
    "https://my.employer.seek.com/post-job",
    "https://my.employer.seek.com/create-job",
    "https://my.employer.seek.com/job/create",
    "https://my.employer.seek.com/job/new",
    "https://my.employer.seek.com/job/post",
    "https://my.employer.seek.com/jobs/create",
    "https://my.employer.seek.com/jobs/post",
    "https://my.employer.seek.com/advertise",
    "https://my.employer.seek.com/advertise/job",
    "https://my.employer.seek.com/listing/create",
    "https://my.employer.seek.com/listing/new",
    "https://my.employer.seek.com/ad/create",
    "https://my.employer.seek.com/ad/new",
    "https://talent.seek.com.au/partners/jobstreet-my/post-job",
    "https://employer.jobstreet.com.my/post-job",
    "https://employer.jobstreet.com.my/jobs/new",
  ];

  for (const url of candidateUrls) {
    try {
      const res = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      const status = res?.status() || 0;
      const finalUrl = page.url();
      const title = await page.title();
      const is404 = title.includes("404") || finalUrl.includes("404");
      const marker = is404 ? "✗" : status === 200 ? "✓" : "?";
      console.log(`  ${marker} [${status}] ${url}`);
      if (finalUrl !== url) console.log(`       → ${finalUrl}`);
      if (!is404 && status === 200) {
        console.log(`       Title: ${title}`);
        // 截图
        const safeName = url.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60);
        await page.screenshot({ path: `./jobstreet-${safeName}.png`, fullPage: true });
        console.log(`       截图已保存`);
      }
    } catch (err) {
      console.log(`  ✗ ${url} — ${String(err).slice(0, 80)}`);
    }
  }

  // Step 5: 检查 GraphQL 中是否有 createJobAd 相关 mutation
  console.log("\n5. 测试 GraphQL mutation...\n");
  const mutations = [
    { name: "createJobAd", query: `mutation createJobAd($input: CreateJobAdInput!) { createJobAd(input: $input) { id } }` },
    { name: "createDraftJobAd", query: `mutation createDraftJobAd($input: CreateDraftJobAdInput!) { createDraftJobAd(input: $input) { id } }` },
    { name: "createJob", query: `mutation createJob($input: CreateJobInput!) { createJob(input: $input) { id } }` },
    { name: "postJob", query: `mutation postJob($input: PostJobInput!) { postJob(input: $input) { id } }` },
  ];

  // Navigate back to dashboard first for valid context
  await page.goto("https://my.employer.seek.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(2000);

  for (const m of mutations) {
    const result = await page.evaluate(
      async ({ query }) => {
        try {
          const res = await fetch("/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
          });
          return { status: res.status, body: (await res.text()).slice(0, 500) };
        } catch (err) {
          return { status: 0, body: String(err) };
        }
      },
      { query: m.query },
    );
    console.log(`  ${m.name}: [${result.status}] ${result.body.slice(0, 300)}`);
    console.log();
  }

  await page.screenshot({ path: "./jobstreet-dashboard-links.png", fullPage: true });
  console.log("\n截图已保存: ./jobstreet-dashboard-links.png");

  await context.close();
  await browser.close();
}

main().catch(console.error);
