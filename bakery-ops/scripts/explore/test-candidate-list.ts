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

  // 拦截 API 响应，找到候选人列表数据
  const apiResponses: Array<{ url: string; status: number; body: string }> = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (
      url.includes("graphql") ||
      url.includes("candidates") ||
      url.includes("applications") ||
      url.includes("applicant")
    ) {
      try {
        const body = await res.text();
        apiResponses.push({ url: url.slice(0, 200), status: res.status(), body: body.slice(0, 3000) });
      } catch {}
    }
  });

  // Step 1: 打开候选人页面
  console.log("=== Opening candidates page ===");
  await page.goto("https://my.employer.seek.com/candidates?jobid=90524208", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(5000);
  console.log("URL:", page.url().slice(0, 200));

  // Step 2: 打印 API 响应
  console.log(`\n=== API responses: ${apiResponses.length} ===`);
  for (const r of apiResponses) {
    console.log(`\n--- ${r.url} (${r.status}) ---`);
    // 尝试解析 JSON 找到候选人 ID
    try {
      const json = JSON.parse(r.body);
      // 查找包含候选人数据的字段
      const str = JSON.stringify(json, null, 2);
      if (
        str.includes("candidateId") ||
        str.includes("applicationId") ||
        str.includes("prospectId") ||
        str.includes("seekerId") ||
        str.includes("selected")
      ) {
        console.log("*** Contains candidate IDs ***");
        console.log(str.slice(0, 2000));
      } else {
        console.log(r.body.slice(0, 300));
      }
    } catch {
      console.log(r.body.slice(0, 300));
    }
  }

  // Step 3: 检查 DOM 中的候选人卡片
  console.log("\n=== Candidate cards in DOM ===");
  // 查找候选人卡片 — 通过 aria-label 中包含 "Shortlist" 或 "Not Suitable" 的按钮来定位
  const candidateNames = await page.$$eval(
    'button[aria-label^="Shortlist "]',
    (els) => els.map((el) => el.getAttribute("aria-label")?.replace("Shortlist ", "") || ""),
  );
  console.log(`Found ${candidateNames.length} candidates by Shortlist buttons:`);
  candidateNames.forEach((n) => console.log(`  ${n}`));

  // 查找所有 data-candidate-id 或类似属性
  console.log("\n=== Elements with candidate-related data attributes ===");
  const dataEls = await page.$$eval(
    "[data-candidate-id], [data-application-id], [data-prospect-id], [data-seeker-id], [data-id]",
    (els) =>
      els.slice(0, 20).map((el) => ({
        tag: el.tagName,
        candidateId: el.getAttribute("data-candidate-id") || "",
        applicationId: el.getAttribute("data-application-id") || "",
        prospectId: el.getAttribute("data-prospect-id") || "",
        seekerId: el.getAttribute("data-seeker-id") || "",
        dataId: el.getAttribute("data-id") || "",
      })),
  );
  console.log(`Found ${dataEls.length} elements with data attributes`);
  dataEls.forEach((d) => console.log(`  <${d.tag}> candidate=${d.candidateId} app=${d.applicationId} prospect=${d.prospectId} seeker=${d.seekerId} id=${d.dataId}`));

  // 查找所有包含 "selected=" 的链接
  console.log("\n=== Links with selected= ===");
  const selectedLinks = await page.$$eval("a[href*='selected=']", (els) =>
    els.map((el) => ({
      href: el.getAttribute("href") || "",
      text: el.textContent?.trim().slice(0, 60) || "",
    })),
  );
  console.log(`Found ${selectedLinks.length} links with selected=`);
  selectedLinks.slice(0, 20).forEach((l) => console.log(`  ${l.href.slice(0, 180)} — ${l.text}`));

  // 也查找候选人卡片的父容器
  console.log("\n=== Candidate card containers ===");
  const cards = await page.$$eval(
    '[class*="candidate"], [class*="applicant"], [class*="card"], [role="listitem"], [role="option"]',
    (els) =>
      els.slice(0, 10).map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role") || "",
        className: el.className?.toString().slice(0, 80) || "",
        text: el.textContent?.trim().slice(0, 100) || "",
        outerHTML: el.outerHTML.slice(0, 200),
      })),
  );
  console.log(`Found ${cards.length} card containers`);
  cards.forEach((c) => console.log(`  <${c.tag}> role="${c.role}" text="${c.text.slice(0, 60)}"`));

  // Step 4: 也检查 /jobs 页面获取 job 列表
  console.log("\n\n=== Jobs page ===");
  await page.goto("https://my.employer.seek.com/jobs", {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  const jobLinks = await page.$$eval("a[href*='/candidates?jobid=']", (els) =>
    els.map((el) => ({
      href: el.getAttribute("href") || "",
      text: el.textContent?.trim().slice(0, 100) || "",
    })),
  );
  console.log(`Found ${jobLinks.length} job links with candidates`);
  jobLinks.forEach((j) => console.log(`  ${j.href.slice(0, 150)} — ${j.text.slice(0, 60)}`));

  // 也看所有 job 相关链接
  const allJobLinks = await page.$$eval("a[href]", (els) =>
    els
      .map((el) => ({
        href: el.getAttribute("href") || "",
        text: el.textContent?.trim().slice(0, 100) || "",
      }))
      .filter(
        (l) =>
          (l.href.includes("/job/") || l.href.includes("/candidates")) &&
          l.text.length > 0 &&
          !l.href.includes("/products") &&
          !l.href.includes("/hiring-advice"),
      ),
  );
  console.log(`\nAll job-related links: ${allJobLinks.length}`);
  allJobLinks.forEach((j) => console.log(`  ${j.href.slice(0, 150)} — ${j.text.slice(0, 60)}`));

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
