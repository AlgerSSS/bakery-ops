/**
 * 招聘模块集成测试 — 启动真实爬虫
 * 运行方式: npx tsx src/__tests__/recruitment.integration.ts
 */
import "dotenv/config";
import { runRecruitmentPipeline } from "@/modules/domain/recruitment/recruitment.service";

async function main() {
  const jdText = "招聘吉隆坡柏威年门店前场店员，要求会中文和英文，有餐饮服务经验优先，全职";

  console.log("=== 招聘集成测试 ===");
  console.log(`JD: ${jdText}`);
  console.log("开始执行...\n");

  const result = await runRecruitmentPipeline(jdText, 10);

  console.log("\n=== 结果 ===");
  console.log(`岗位: ${result.jd.jobTitle}`);
  console.log(`地点: ${result.jd.location}`);
  console.log(`要求: ${result.jd.requirements.join(", ")}`);
  console.log(`语言: ${result.jd.languageRequirements.join(", ")}`);
  console.log(`采集总数: ${result.totalCrawled}`);
  console.log(`去重后: ${result.totalAfterDedup}`);
  console.log(`Top 候选人: ${result.topCandidates.length}`);
  console.log("");

  result.topCandidates.forEach((c, i) => {
    console.log(`#${i + 1} ${c.name} — 匹配度 ${c.matchScore}/100`);
    console.log(`   职位: ${c.currentTitle || "N/A"}`);
    console.log(`   地点: ${c.location || "N/A"}`);
    console.log(`   技能: ${c.skills.join(", ") || "N/A"}`);
    console.log(`   原因: ${c.scoreReason}`);
    console.log(`   简历: ${c.resumeFileId ? `已下载 (${c.resumeFileName})` : "未获取"}`);
    console.log(`   来源: ${c.source} - ${c.sourceUrl}`);
    console.log("");
  });
}

main().catch(console.error);
