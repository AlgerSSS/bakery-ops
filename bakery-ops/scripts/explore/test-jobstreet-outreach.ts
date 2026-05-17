/**
 * JobStreet Outreach 测试
 *
 * 用法: npx tsx src/__tests__/test-jobstreet-outreach.ts
 *
 * 测试 Send message (Invite to Apply) 功能
 * 注意: 每次发送消耗 1 个 connection（每月 10 个免费）
 */
import { JobStreetOutreach } from "../modules/domain/recruitment/outreach/jobstreet.outreach";
import type { ScoredCandidate, ParsedJD } from "../modules/domain/recruitment/types";

async function main() {
  const outreach = new JobStreetOutreach();

  // 测试预算查询
  console.log("=== 查询 JobStreet 剩余 connection ===");
  const budget = await outreach.getRemainingBudget();
  console.log("Remaining budget:", budget);

  if (budget !== null && budget <= 0) {
    console.log("预算已用完，跳过发送测试");
    return;
  }

  // 构造一个测试候选人（需要替换为真实的 profileGuid）
  const testCandidate: ScoredCandidate = {
    candidateId: "test-js-001",
    source: "JobStreet",
    sourceUrl: "https://my.employer.seek.com/talentsearch/profiles/TEST_GUID?market=MY",
    name: "Test Candidate",
    skills: ["JavaScript", "React"],
    languages: ["English", "Mandarin"],
    matchScore: 90,
    scoreBreakdown: { skillMatch: 85, experienceMatch: 90, locationMatch: 95, languageMatch: 90 },
    scoreReason: "Strong match",
    rawData: {
      profileGuid: "TEST_PROFILE_GUID",  // 替换为真实值
      serviceToken: "TEST_SERVICE_TOKEN", // 替换为真实值
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
    subject: "Job Opportunity — {jobTitle}",
    body: "Hi {candidateName}, we are currently hiring for {jobTitle} in {location} and think your background is a great fit. If you're interested, feel free to reply or WhatsApp us at +60175437858.",
  };

  console.log("\n=== 开始测试 JobStreet Outreach ===");
  console.log("注意: 请先将 testCandidate.rawData 中的 profileGuid 和 serviceToken 替换为真实值");
  console.log("注意: 此测试会消耗 1 个 connection\n");

  const result = await outreach.sendMessages([testCandidate], testJD, message);

  console.log("\n=== 测试结果 ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
