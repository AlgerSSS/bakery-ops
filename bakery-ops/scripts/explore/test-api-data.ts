import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";
import { getCookieFile, getStorageFile } from "../modules/domain/recruitment/connectors/jobstreet-login";

async function main() {
  const cookies = JSON.parse(fs.readFileSync(getCookieFile(), "utf-8"));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    acceptDownloads: true,
  });
  await context.addCookies(cookies);

  const storageFile = getStorageFile();
  if (fs.existsSync(storageFile)) {
    const storage = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
    await context.addInitScript((data: Record<string, string>) => {
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, storage);
  }

  const page = await context.newPage();

  // 拦截 GraphQL 响应
  let applicationsData = "";
  let jobsData = "";
  page.on("response", async (res) => {
    if (res.url().includes("/graphql")) {
      try {
        const body = await res.text();
        if (body.includes('"applications"') && body.includes("adcentreProspectId")) {
          applicationsData = body;
        }
        if (body.includes('"jobs"') || body.includes('"jobList"') || body.includes('"listingDate"')) {
          if (body.length > jobsData.length) jobsData = body;
        }
      } catch {}
    }
  });

  // Step 1: 获取候选人列表的完整 GraphQL 数据
  console.log("=== Getting full applications data ===");
  await page.goto("https://my.employer.seek.com/candidates?jobid=90524208", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  if (applicationsData) {
    const parsed = JSON.parse(applicationsData);
    const apps = parsed?.data?.applications?.result || [];
    console.log(`Total applications: ${apps.length}`);
    // 打印第一个候选人的完整结构
    if (apps.length > 0) {
      console.log("\nFirst candidate full structure:");
      console.log(JSON.stringify(apps[0], null, 2));
      console.log("\nAll candidates summary:");
      for (const app of apps.slice(0, 30)) {
        console.log(`  ${app.adcentreProspectId} — ${app.firstName} ${app.lastName} — ${app.email} — ${app.phone}`);
      }
    }
    // 也打印 pagination 信息
    const pagination = parsed?.data?.applications?.pagination;
    if (pagination) {
      console.log("\nPagination:", JSON.stringify(pagination));
    }
  } else {
    console.log("No applications data captured!");
  }

  // Step 2: 获取 jobs 列表
  console.log("\n\n=== Getting jobs list ===");
  // 先试 open jobs
  await page.goto("https://my.employer.seek.com/jobs", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  const pageText = await page.evaluate(() => document.body?.innerText || "");
  console.log("Jobs page text (first 1000 chars):");
  console.log(pageText.slice(0, 1000));

  // 试 expired jobs
  console.log("\n--- Expired jobs ---");
  jobsData = "";
  await page.goto("https://my.employer.seek.com/jobs?type=expired", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  const expiredText = await page.evaluate(() => document.body?.innerText || "");
  console.log("Expired jobs text (first 1000 chars):");
  console.log(expiredText.slice(0, 1000));

  // 查找 job 链接
  const jobLinks = await page.$$eval("a[href]", (els) =>
    els
      .map((el) => ({
        href: el.getAttribute("href") || "",
        text: el.textContent?.trim().slice(0, 100) || "",
      }))
      .filter(
        (l) =>
          l.href.includes("jobid=") ||
          l.href.includes("/job/") ||
          l.href.includes("/candidates"),
      )
      .filter(
        (l) =>
          !l.href.includes("create") &&
          !l.href.includes("express") &&
          l.text.length > 0,
      ),
  );
  console.log(`\nJob-related links: ${jobLinks.length}`);
  jobLinks.forEach((j) => console.log(`  ${j.href.slice(0, 150)} — ${j.text.slice(0, 60)}`));

  if (jobsData) {
    console.log("\nJobs GraphQL data (first 2000 chars):");
    console.log(jobsData.slice(0, 2000));
  }

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
