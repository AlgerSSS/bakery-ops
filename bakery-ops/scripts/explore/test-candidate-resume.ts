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

  // 测试两个 URL：候选人 + 搜索新人
  const urls = [
    {
      label: "Candidate (applicant)",
      url: "https://my.employer.seek.com/candidates?jobid=90524208&selected=2079282185&tab=resume",
    },
    {
      label: "Search (new person)",
      url: "https://my.employer.seek.com/candidates?jobid=90524208&search=sales&selected=2044802715&tab=resume",
    },
  ];

  for (const { label, url } of urls) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`=== ${label} ===`);
    console.log(`URL: ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(5000);

    console.log("Final URL:", page.url().slice(0, 250));
    console.log("Title:", await page.title());
    await page.screenshot({
      path: `/tmp/seek-resume-${label.replace(/\s+/g, "-").toLowerCase()}.png`,
      fullPage: true,
    });

    // 查找下载按钮 — 广泛搜索
    console.log("\n--- Download buttons/links ---");
    const downloadEls = await page.$$eval(
      'a[href*="download"], a[href*="resume"], a[href*=".pdf"], ' +
      'button:has-text("Download"), button:has-text("download"), ' +
      'a:has-text("Download"), a:has-text("download"), ' +
      '[data-testid*="download"], [data-testid*="Download"], ' +
      '[aria-label*="download"], [aria-label*="Download"], ' +
      'svg[title*="download"], svg[title*="Download"]',
      (els) =>
        els.map((el) => ({
          tag: el.tagName,
          text: el.textContent?.trim().slice(0, 100) || "",
          href: el.getAttribute("href") || "",
          testId: el.getAttribute("data-testid") || "",
          ariaLabel: el.getAttribute("aria-label") || "",
          className: el.className?.toString().slice(0, 120) || "",
          outerHTML: el.outerHTML.slice(0, 300),
        })),
    );
    console.log(`Found ${downloadEls.length} download elements`);
    downloadEls.forEach((d) => {
      console.log(`  <${d.tag}> "${d.text}" href="${d.href}" testId="${d.testId}" aria="${d.ariaLabel}"`);
      console.log(`    HTML: ${d.outerHTML}`);
    });

    // 所有按钮
    console.log("\n--- All buttons ---");
    const buttons = await page.$$eval("button, a[role='button']", (els) =>
      els.map((el) => ({
        tag: el.tagName,
        text: el.textContent?.trim().slice(0, 100) || "",
        testId: el.getAttribute("data-testid") || "",
        ariaLabel: el.getAttribute("aria-label") || "",
        outerHTML: el.outerHTML.slice(0, 300),
      })),
    );
    buttons.forEach((b) =>
      console.log(`  <${b.tag}> "${b.text}" testId="${b.testId}" aria="${b.ariaLabel}"`),
    );

    // iframe（简历可能在 iframe 里）
    console.log("\n--- Iframes ---");
    const iframes = await page.$$eval("iframe", (els) =>
      els.map((el) => ({
        src: el.getAttribute("src") || "",
        title: el.getAttribute("title") || "",
        id: el.getAttribute("id") || "",
      })),
    );
    console.log(`Found ${iframes.length} iframes`);
    iframes.forEach((f) => console.log(`  src="${f.src.slice(0, 250)}" title="${f.title}" id="${f.id}"`));

    // 所有 a[href] 中包含 pdf/resume/download/document/attachment
    console.log("\n--- Resume/PDF related links ---");
    const resumeLinks = await page.$$eval("a[href]", (els) =>
      els
        .map((el) => ({
          href: el.getAttribute("href") || "",
          text: el.textContent?.trim().slice(0, 80) || "",
          outerHTML: el.outerHTML.slice(0, 300),
        }))
        .filter(
          (l) =>
            l.href.toLowerCase().includes("pdf") ||
            l.href.toLowerCase().includes("resume") ||
            l.href.toLowerCase().includes("download") ||
            l.href.toLowerCase().includes("document") ||
            l.href.toLowerCase().includes("attachment"),
        ),
    );
    console.log(`Found ${resumeLinks.length} resume-related links`);
    resumeLinks.forEach((l) => {
      console.log(`  ${l.href.slice(0, 250)} — ${l.text}`);
      console.log(`    HTML: ${l.outerHTML}`);
    });

    // 候选人列表
    console.log("\n--- Candidate list entries ---");
    const candidateLinks = await page.$$eval("a[href]", (els) =>
      els
        .map((el) => ({
          href: el.getAttribute("href") || "",
          text: el.textContent?.trim().slice(0, 100) || "",
        }))
        .filter((l) => l.href.includes("/candidates") && l.href.includes("selected=")),
    );
    console.log(`Found ${candidateLinks.length} candidate entries`);
    candidateLinks.slice(0, 20).forEach((c) =>
      console.log(`  ${c.href.slice(0, 180)} — ${c.text.slice(0, 60)}`),
    );

    // 页面文本
    console.log("\n--- Page text (first 2000 chars) ---");
    const pageText = await page.evaluate(() => document.body?.innerText || "");
    console.log(pageText.slice(0, 2000));
  }

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
