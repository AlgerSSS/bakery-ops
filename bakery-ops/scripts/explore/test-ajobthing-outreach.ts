/**
 * AJobThing Outreach 测试
 *
 * 用法: npx tsx src/__tests__/test-ajobthing-outreach.ts
 *
 * 测试 Stream Chat API 发送消息给一个已知候选人
 * 免费，不消耗积分
 */
import { AJobThingOutreach } from "../modules/domain/recruitment/outreach/ajobthing.outreach";
import type { ScoredCandidate, ParsedJD } from "../modules/domain/recruitment/types";

async function main() {
  const outreach = new AJobThingOutreach();

  // 测试预算查询（应返回 null，表示无限制）
  const budget = await outreach.getRemainingBudget();
  console.log("AJobThing remaining budget:", budget);

  // 构造一个测试候选人（需要替换为真实的 encoded_id）
  const testCandidate: ScoredCandidate = {
    candidateId: "test-001",
    source: "AJobThing",
    sourceUrl: "https://www.ajobthing.com/candidatesearch?profile=TEST_ENCODED_ID",
    name: "Test Candidate",
    skills: [],
    languages: ["English", "Mandarin"],
    matchScore: 85,
    scoreBreakdown: { skillMatch: 80, experienceMatch: 90, locationMatch: 85, languageMatch: 90 },
    scoreReason: "Good match",
    rawData: {
      encoded_id: "TEST_ENCODED_ID",  // 替换为真实值
      id: 12345,                       // 替换为真实值
    },
  };

  const testJD: ParsedJD = {
    jobTitle: "前场店员",
    location: "Kuala Lumpur",
    requirements: ["餐饮经验"],
    preferredSkills: ["客户服务"],
    experienceYears: 1,
    languageRequirements: ["Mandarin", "English"],
    jobType: "full_time",
    rawText: "测试 JD",
  };

  const message = {
    subject: "Job Opportunity — Cashier",
    body: "Hi {candidateName}, we are currently hiring for {jobTitle} in {location} and think your background is a great fit. If you're interested, feel free to reply or WhatsApp us at +60175437858.",
  };

  console.log("\n=== 开始测试 AJobThing Outreach ===");
  console.log("注意: 请先将 testCandidate.rawData 中的 encoded_id 和 id 替换为真实值\n");

  const result = await outreach.sendMessages([testCandidate], testJD, message);

  console.log("\n=== 测试结果 ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
