/**
 * JobStreet GraphQL Outreach 测试
 *
 * 用法: npx tsx src/__tests__/test-jobstreet-graphql.ts
 *
 * 测试直接通过 GraphQL mutation 发送消息
 * 注意: 会消耗 1 个 connection
 */
import { chromium } from "playwright";
import * as fs from "fs";
import { getCookieFile, getStorageFile, hasValidSession } from "../modules/domain/recruitment/connectors/jobstreet-login";

const SEND_MESSAGE_MUTATION = `
  mutation InitiateTalentSearchSendMessage($input: InitiateSendMessageV2Input!) {
    initiateSendMessage(input: $input) {
      ... on InitiateConnectionSuccessResponse {
        connectionId
        __typename
      }
      ... on InitiateConnectionErrorResponse {
        error
        __typename
      }
      __typename
    }
  }
`;

async function main() {
  if (!hasValidSession()) {
    console.log("未找到登录 Cookie，请先运行 jobstreet-login.ts");
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
  await page.goto("https://my.employer.seek.com/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  const url = page.url();
  if (url.includes("login") || url.includes("oauth")) {
    console.log("Cookie 已过期");
    await browser.close();
    return;
  }

  console.log("Cookie 有效，开始测试 GraphQL...\n");

  // 替换为真实的 profileId（数字 ID，不是 profileGuid）
  const TEST_PROFILE_ID = "593079776"; // Mikhail Haiqal 的 profileId

  const result = await page.evaluate(
    async ({ mutation, input }) => {
      const res = await fetch("/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: mutation, variables: { input } }),
      });
      return { status: res.status, body: await res.text() };
    },
    {
      mutation: SEND_MESSAGE_MUTATION,
      input: {
        advertiserEmail: "hotcrushmalaysia@gmail.com",
        advertiserFirstName: "HR",
        advertiserLastName: "Team",
        advertiserTitle: "HR Manager",
        advertiserPhone: "+61431029692",
        body: "Hi, this is a test message sent directly via GraphQL.",
        subject: "GraphQL Test",
        origin: "UNCOUPLED_SEARCH",
        searchType: "UNCOUPLED",
        profileId: TEST_PROFILE_ID,
      },
    },
  );

  console.log("HTTP Status:", result.status);
  console.log("Response:", JSON.stringify(JSON.parse(result.body), null, 2));

  await context.close();
  await browser.close();
}

main().catch(console.error);
