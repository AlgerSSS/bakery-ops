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

  // 拦截 GraphQL 请求和响应
  const gqlRequests: Array<{ op: string; variables: string; body: string }> = [];
  page.on("request", (req) => {
    if (req.url().includes("/graphql") && req.method() === "POST") {
      const body = req.postData() || "";
      try {
        const parsed = JSON.parse(body);
        const op = parsed.operationName || "unknown";
        gqlRequests.push({
          op,
          variables: JSON.stringify(parsed.variables || {}).slice(0, 500),
          body: body.slice(0, 1000),
        });
      } catch {}
    }
  });

  let applicationsResponse = "";
  page.on("response", async (res) => {
    if (res.url().includes("/graphql")) {
      try {
        const body = await res.text();
        if (body.includes('"applications"') && body.includes("adcentreProspectId")) {
          applicationsResponse = body;
        }
      } catch {}
    }
  });

  // 打开候选人页面
  await page.goto("https://my.employer.seek.com/candidates?jobid=90524208", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  // 打印所有 GraphQL 请求
  console.log(`=== GraphQL requests: ${gqlRequests.length} ===`);
  for (const r of gqlRequests) {
    console.log(`\n--- ${r.op} ---`);
    console.log(`Variables: ${r.variables}`);
    if (r.op.toLowerCase().includes("application") || r.op.toLowerCase().includes("candidate")) {
      console.log(`Full body: ${r.body}`);
    }
  }

  // 检查 applications 响应中的分页信息
  if (applicationsResponse) {
    const parsed = JSON.parse(applicationsResponse);
    const apps = parsed?.data?.applications;
    console.log(`\n=== Applications response ===`);
    console.log(`Result count: ${apps?.result?.length}`);
    // 查找分页相关字段
    const keys = Object.keys(apps || {});
    console.log(`Top-level keys: ${keys.join(", ")}`);
    if (apps?.pageInfo) console.log(`PageInfo: ${JSON.stringify(apps.pageInfo)}`);
    if (apps?.totalCount) console.log(`TotalCount: ${apps.totalCount}`);
    if (apps?.pagination) console.log(`Pagination: ${JSON.stringify(apps.pagination)}`);
  }

  // 也试试 expired jobs 页面（用 domcontentloaded 而不是 networkidle）
  console.log("\n\n=== Expired jobs ===");
  gqlRequests.length = 0;
  let jobsResponse = "";
  page.on("response", async (res) => {
    if (res.url().includes("/graphql")) {
      try {
        const body = await res.text();
        if (body.includes('"jobs"') || body.includes('"jobList"') || body.includes("90524208")) {
          if (body.length > jobsResponse.length) jobsResponse = body;
        }
      } catch {}
    }
  });

  await page.goto("https://my.employer.seek.com/jobs?type=expired", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(8000);

  console.log("URL:", page.url().slice(0, 200));
  const pageText = await page.evaluate(() => document.body?.innerText || "");
  console.log("Page text (first 500):", pageText.slice(0, 500));

  // 查找 job 链接
  const jobLinks = await page.$$eval("a[href]", (els) =>
    els
      .map((el) => ({
        href: el.getAttribute("href") || "",
        text: el.textContent?.trim().slice(0, 100) || "",
      }))
      .filter((l) => l.href.includes("jobid") || l.href.includes("/candidates")),
  );
  console.log(`Job links: ${jobLinks.length}`);
  jobLinks.forEach((j) => console.log(`  ${j.href.slice(0, 150)} — ${j.text.slice(0, 60)}`));

  console.log(`\nGraphQL requests on jobs page: ${gqlRequests.length}`);
  for (const r of gqlRequests) {
    if (r.op.toLowerCase().includes("job") || r.op.toLowerCase().includes("list")) {
      console.log(`  ${r.op}: ${r.variables}`);
    }
  }

  if (jobsResponse) {
    console.log(`\nJobs response (first 1500):`);
    console.log(jobsResponse.slice(0, 1500));
  }

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
