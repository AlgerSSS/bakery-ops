import "dotenv/config";
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 雇主端登录
  await page.goto("https://my.employer.seek.com/oauth/login/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // 填写邮箱和密码
  await page.fill("#emailAddress", process.env.JOBSTREET_EMAIL || "");
  await page.fill("#password", process.env.JOBSTREET_PASSWORD || "");

  // 等待 Turnstile 验证
  console.log("Waiting for Turnstile...");
  await page.waitForTimeout(5000);

  // 提交
  await page.click('button[type="submit"]');
  await page.waitForTimeout(8000);

  const afterUrl = page.url();
  console.log("After login URL:", afterUrl.slice(0, 150));
  console.log("Title:", await page.title());

  await page.screenshot({ path: "/tmp/seek-after-login.png", fullPage: true });

  const isLoggedIn =
    !afterUrl.includes("login") && !afterUrl.includes("authenticate");
  console.log("Logged in:", isLoggedIn);

  if (isLoggedIn) {
    // 尝试 Talent Search
    await page.goto("https://my.employer.seek.com/talent/search?q=bakery+staff&l=Kuala+Lumpur", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);
    console.log("\nTalent Search URL:", page.url().slice(0, 150));
    console.log("Talent Search Title:", await page.title());
    await page.screenshot({ path: "/tmp/seek-talent-search.png", fullPage: true });

    // 查看候选人卡片
    const cards = await page.$$eval("a[href]", (els) =>
      els
        .map((el) => ({
          href: el.getAttribute("href") || "",
          text: el.textContent?.trim().slice(0, 80) || "",
        }))
        .filter(
          (l) =>
            l.href.includes("/talent/") ||
            l.href.includes("/profile/") ||
            l.href.includes("/candidate/"),
        ),
    );
    console.log(`Candidate links: ${cards.length}`);
    cards.slice(0, 10).forEach((c) => console.log(`  ${c.href.slice(0, 80)} — ${c.text}`));
  }

  await browser.close();
}

main().catch(console.error);
