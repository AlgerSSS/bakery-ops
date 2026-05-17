/**
 * AJobThing Chat API 测试 — 使用真实 API 发送消息
 *
 * 用法: npx tsx src/__tests__/test-ajobthing-chat-send.ts
 */
import "dotenv/config";
import { chromium } from "playwright";
import * as fs from "fs";
import { createClient } from "@supabase/supabase-js";
import {
  getCookieFile,
  getStorageFile,
  hasValidSession,
} from "../modules/domain/recruitment/connectors/ajobthing-login";

const EMPLOYER_COMPANY_ID = "196036";
const EMPLOYER_USER_ID = "5630750";
const EMPLOYER_NAME = "Yuns & Hot Crush Sdn. Bhd.";
const EMPLOYER_LOGO = "https://files.ajobthing.com/employers/196036-1764931811.png";

async function main() {
  // Step 1: 从 DB 找一个 AJobThing 候选人
  console.log("1. 查找 AJobThing 候选人...\n");

  const supabase = createClient(
    process.env.SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_KEY || "",
  );

  const { data: employees } = await supabase
    .from("employees")
    .select("id, name, source, source_url, metadata")
    .eq("source", "AJobThing")
    .limit(5);

  if (!employees || employees.length === 0) {
    console.log("没有找到 AJobThing 候选人");
    return;
  }

  for (const row of employees) {
    const meta = (row.metadata || {}) as Record<string, unknown>;
    const rawData = (meta.rawData || {}) as Record<string, unknown>;
    let encodedId = rawData.encoded_id as string | undefined;
    let numericId = rawData.id as string | undefined;

    // Fallback: extract from URL
    if (!encodedId && row.source_url) {
      const match = row.source_url.match(/[?&]profile=([^&]+)/);
      if (match) encodedId = match[1];
    }

    console.log(`  ${row.name}`);
    console.log(`    source_url: ${row.source_url}`);
    console.log(`    encoded_id: ${encodedId || "N/A"}`);
    console.log(`    numeric_id: ${numericId || "N/A"}`);
    console.log();
  }

  // 用第一个有 encoded_id 的候选人测试
  let testCandidate: { name: string; id: string } | null = null;
  for (const row of employees) {
    const meta = (row.metadata || {}) as Record<string, unknown>;
    const rawData = (meta.rawData || {}) as Record<string, unknown>;
    let candidateId = rawData.encoded_id as string || rawData.id as string;
    if (!candidateId && row.source_url) {
      const match = row.source_url.match(/[?&]profile=([^&]+)/);
      if (match) candidateId = match[1];
    }
    if (candidateId) {
      testCandidate = { name: row.name, id: candidateId };
      break;
    }
  }

  if (!testCandidate) {
    console.log("没有找到有 ID 的候选人");
    return;
  }

  console.log(`选择测试候选人: ${testCandidate.name} (id: ${testCandidate.id})\n`);

  // Step 2: 启动浏览器
  if (!hasValidSession()) {
    console.log("未找到 AJobThing Cookie");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
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

  // 导航到 /chat 页面
  console.log("2. 导航到 /chat 页面...");
  await page.goto("https://www.ajobthing.com/chat", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForTimeout(3000);

  const url = page.url();
  if (url.includes("login") || url.includes("auth")) {
    console.log("Cookie 已过期");
    await browser.close();
    return;
  }
  console.log("   Cookie 有效 ✓\n");

  // Step 3: 创建频道 + 发送消息
  const channelId = `chat-comp-${EMPLOYER_COMPANY_ID}-js-${testCandidate.id}`;
  const messageText = `Hi ${testCandidate.name}, we are currently hiring for a Cashier position in Kuala Lumpur and think your background is a great fit. If you're interested, feel free to reply or WhatsApp us at +60175437858.`;

  console.log(`3. 创建频道并发送消息...`);
  console.log(`   channel_id: ${channelId}`);
  console.log(`   message: ${messageText.slice(0, 80)}...\n`);

  const result = await page.evaluate(
    async ({ channelId, companyId, companyName, companyLogo, userId, jsId, candidateName, messageText }) => {
      const res = await fetch("/api/stream-chat/chat/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          channel_id: channelId,
          members: [
            {
              id: companyId,
              name: companyName,
              role: "employer",
              image: companyLogo,
            },
            {
              id: `js_${jsId}`,
              name: candidateName,
              role: "jobseeker",
              image: `https://getstream.io/random_png/?name=${candidateName}`,
            },
          ],
          meta: { employer_user_id: userId },
          source: { name: "candidate_search", meta: {} },
          message: {
            channel_id: channelId,
            user_id: companyId,
            text: messageText,
          },
        }),
      });
      return { status: res.status, body: await res.text() };
    },
    {
      channelId,
      companyId: EMPLOYER_COMPANY_ID,
      companyName: EMPLOYER_NAME,
      companyLogo: EMPLOYER_LOGO,
      userId: EMPLOYER_USER_ID,
      jsId: testCandidate.id,
      candidateName: testCandidate.name,
      messageText,
    },
  );

  console.log(`HTTP Status: ${result.status}`);
  try {
    const parsed = JSON.parse(result.body);
    console.log(`Response: ${JSON.stringify(parsed, null, 2)}`);
  } catch {
    console.log(`Response: ${result.body.slice(0, 500)}`);
  }

  if (result.status === 200 || result.status === 201) {
    console.log("\n✓ 消息发送成功！");
  } else {
    console.log("\n✗ 消息发送失败");
  }

  await context.close();
  await browser.close();
}

main().catch(console.error);
