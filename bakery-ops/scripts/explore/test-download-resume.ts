import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
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

  // 测试下载：候选人简历
  const testUrl =
    "https://my.employer.seek.com/candidates?jobid=90524208&selected=2079282185&tab=resume";
  console.log("=== Opening candidate resume page ===");
  await page.goto(testUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);
  console.log("Page loaded:", page.url().slice(0, 200));

  // 找到下载按钮
  const downloadBtn = page.locator("#download-document-viewer");
  const btnExists = await downloadBtn.count();
  console.log(`Download button found: ${btnExists > 0}`);

  if (btnExists > 0) {
    console.log("\n=== Clicking download button ===");
    try {
      // 等待下载事件
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        downloadBtn.click(),
      ]);

      console.log("Download triggered!");
      console.log("Suggested filename:", download.suggestedFilename());
      console.log("URL:", download.url().slice(0, 300));

      // 保存文件
      const savePath = path.join("/tmp", download.suggestedFilename() || "resume.pdf");
      await download.saveAs(savePath);
      const stat = fs.statSync(savePath);
      console.log(`Saved to: ${savePath} (${stat.size} bytes)`);
    } catch (err) {
      console.log("Download event not triggered, trying alternative approach...");
      console.log("Error:", String(err).slice(0, 200));

      // 可能不是通过 download 事件，而是通过新窗口/标签打开
      // 监听新页面
      const [newPage] = await Promise.all([
        context.waitForEvent("page", { timeout: 10000 }).catch(() => null),
        downloadBtn.click(),
      ]);

      if (newPage) {
        console.log("New page opened:", newPage.url().slice(0, 300));
        await newPage.waitForTimeout(3000);
      } else {
        console.log("No new page opened either.");

        // 也许是通过 fetch/XHR 下载的，检查网络请求
        console.log("\nTrying to intercept network request...");
        let downloadUrl = "";
        page.on("response", async (res) => {
          const url = res.url();
          const contentType = res.headers()["content-type"] || "";
          if (
            contentType.includes("pdf") ||
            contentType.includes("octet-stream") ||
            url.includes("download") ||
            url.includes(".pdf")
          ) {
            console.log(`  PDF response: ${url.slice(0, 300)} (${contentType})`);
            downloadUrl = url;
          }
        });

        await downloadBtn.click();
        await page.waitForTimeout(5000);

        if (downloadUrl) {
          console.log(`Found download URL: ${downloadUrl.slice(0, 300)}`);
        }
      }
    }
  } else {
    console.log("No download button found!");
    await page.screenshot({ path: "/tmp/seek-no-download-btn.png", fullPage: true });
  }

  // 也测试第二个 URL（搜索新人）
  console.log("\n\n=== Testing search candidate download ===");
  const searchUrl =
    "https://my.employer.seek.com/candidates?jobid=90524208&search=sales&selected=2044802715&tab=resume";
  await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);

  const downloadBtn2 = page.locator("#download-document-viewer");
  const btn2Exists = await downloadBtn2.count();
  console.log(`Download button found: ${btn2Exists > 0}`);

  if (btn2Exists > 0) {
    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        downloadBtn2.click(),
      ]);
      console.log("Download triggered!");
      console.log("Suggested filename:", download.suggestedFilename());
      const savePath = path.join("/tmp", `search_${download.suggestedFilename() || "resume.pdf"}`);
      await download.saveAs(savePath);
      const stat = fs.statSync(savePath);
      console.log(`Saved to: ${savePath} (${stat.size} bytes)`);
    } catch (err) {
      console.log("Download failed:", String(err).slice(0, 200));
    }
  }

  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
