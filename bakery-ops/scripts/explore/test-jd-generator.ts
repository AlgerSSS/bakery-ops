import "dotenv/config";
import { generateJobDescription } from "../modules/domain/recruitment/jd-generator";

async function main() {
  const input = `招聘值班经理duty manager，我想要一个hotcrush吉隆坡门店的值班经理，值班经理
三门语言，有餐饮行业经验，有上进心且吃苦耐劳，对于数据敏感，对于喜欢的工作充满热爱，年龄区间20-28薪资4000`;

  console.log("=== 测试 JD 生成 ===\n");
  console.log("输入:", input);
  console.log("\n生成中...\n");

  const jd = await generateJobDescription(input);
  console.log("=== 生成结果 ===\n");
  console.log(JSON.stringify(jd, null, 2));
}

main().catch(console.error);
