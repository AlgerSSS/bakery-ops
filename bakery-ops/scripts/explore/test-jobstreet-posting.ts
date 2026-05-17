/**
 * 测试 JobStreet Express Create 发布流程
 *
 * 用法: npx tsx src/__tests__/test-jobstreet-posting.ts
 */
import "dotenv/config";
import { JobStreetPosting } from "../modules/domain/recruitment/posting/jobstreet.posting";
import type { GeneratedJD } from "../modules/domain/recruitment/types";

async function main() {
  console.log("=== 测试 JobStreet 发布 ===\n");

  const testJD: GeneratedJD = {
    title: "Duty Manager",
    description:
      "We are looking for a dedicated Duty Manager to join our Hot Crush bakery team in Kuala Lumpur. The ideal candidate should be trilingual (English, Malay, Mandarin), have F&B industry experience, and demonstrate strong data sensitivity and passion for the role.",
    requirements: [
      "Trilingual: English, Malay, and Mandarin",
      "F&B industry experience preferred",
      "Age 20-28",
      "Strong work ethic and data sensitivity",
      "Passionate and hardworking",
    ],
    benefits: ["Competitive salary", "Career growth opportunities"],
    location: "Kuala Lumpur",
    salaryRange: "RM 4000",
    jobType: "full_time",
    experienceYears: 1,
    languageRequirements: ["English", "Malay", "Mandarin"],
  };

  const posting = new JobStreetPosting();
  console.log("开始发布...\n");
  const result = await posting.postJob(testJD);
  console.log("\n发布结果:", JSON.stringify(result, null, 2));
}

main().catch(console.error);
