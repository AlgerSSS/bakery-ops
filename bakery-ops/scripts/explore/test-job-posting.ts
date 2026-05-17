import "dotenv/config";
import { postJob } from "../modules/domain/recruitment/posting/posting.service";

async function main() {
  const input = `招聘值班经理duty manager，我想要一个hotcrush吉隆坡门店的值班经理，值班经理
三门语言，有餐饮行业经验，有上进心且吃苦耐劳，对于数据敏感，对于喜欢的工作充满热爱，年龄区间20-28薪资4000`;

  console.log("=== 测试完整发布流程 ===\n");
  console.log("输入:", input);
  console.log("\n开始发布...\n");

  try {
    const { jd, results } = await postJob(input);

    console.log("=== JD 生成结果 ===");
    console.log(`Title: ${jd.title}`);
    console.log(`Location: ${jd.location}`);
    console.log(`Salary: ${jd.salaryRange || "未指定"}`);
    console.log(`Languages: ${jd.languageRequirements.join(", ")}`);
    console.log(`Requirements: ${jd.requirements.length} 条`);
    console.log();

    console.log("=== 发布结果 ===");
    for (const r of results) {
      console.log(`${r.platform}: ${r.status}`);
      if (r.jobUrl) console.log(`  URL: ${r.jobUrl}`);
      if (r.error) console.log(`  Error: ${r.error}`);
    }
  } catch (err) {
    console.error("发布失败:", err);
  }
}

main().catch(console.error);
