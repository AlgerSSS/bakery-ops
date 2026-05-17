import { parseJD } from "./jd-parser";
import { JobStreetConnector } from "./connectors/jobstreet.connector";
import { IndeedConnector } from "./connectors/indeed.connector";
import { AJobThingConnector } from "./connectors/ajobthing.connector";
import { deduplicateCandidates } from "./candidate-deduper";
import { scoreCandidates } from "./candidate-scorer";
import { generateCandidateResumePdf } from "./resume-pdf";
import { runOutreach } from "./outreach/outreach.service";
import type { Candidate, RecruitmentTaskResult } from "./types";
import type { JobSiteConnector } from "./connector.interface";
import { employeeRepository } from "../../data/repositories/employee.repository";
import { parseFromCandidateData } from "../resume/resume-parser";
import { larkSyncService } from "../lark/lark-sync.service";
import { logger } from "../../shared/logger";

const MAX_CANDIDATES = 10;

const connectors: JobSiteConnector[] = [
  new JobStreetConnector(),
  new IndeedConnector(),
  new AJobThingConnector(),
];

/**
 * 招聘全流程：JD 解析 → Talent Search 搜索 → 去重 → AI 评分 → 返回 Top N
 */
export async function runRecruitmentPipeline(
  jdText: string,
  maxCandidates = MAX_CANDIDATES,
  outreachEnabled = false,
): Promise<RecruitmentTaskResult> {
  // 1. 解析 JD
  logger.info("Recruitment pipeline: parsing JD");
  const jd = await parseJD(jdText);
  logger.info("JD parsed", { jobTitle: jd.jobTitle, location: jd.location });

  // 2. 搜索候选人（Talent Search 返回 20 个最相关的 profiles）
  logger.info("Recruitment pipeline: searching talent pool");
  const crawlResults = await Promise.allSettled(
    connectors.map((c) => c.search(jd, 20)),
  );

  const allCandidates: Candidate[] = [];
  for (const result of crawlResults) {
    if (result.status === "fulfilled") {
      allCandidates.push(...result.value.candidates);
      logger.info(`Crawled ${result.value.source}: ${result.value.candidates.length} candidates`);
    } else {
      logger.error("Connector failed", { error: String(result.reason) });
    }
  }

  logger.info(`Total candidates found: ${allCandidates.length}`);

  // 3. 去重
  const deduped = deduplicateCandidates(allCandidates);
  logger.info(`After deduplication: ${deduped.length}`);

  // 4. AI 评分
  logger.info("Recruitment pipeline: scoring candidates");
  const scored = await scoreCandidates(deduped, jd);

  // 5. 取 Top N
  const topCandidates = scored.slice(0, maxCandidates);

  // 6. 为每个候选人生成简历 PDF
  logger.info("Recruitment pipeline: generating resume PDFs");
  for (const candidate of topCandidates) {
    try {
      const file = await generateCandidateResumePdf(candidate);
      candidate.resumeFileId = file.fileId;
      candidate.resumeFileName = file.fileName;
    } catch (err) {
      logger.error("Failed to generate resume PDF", { name: candidate.name, error: String(err) });
    }
  }

  // 7. 候选人自动建档到数据库 + 简历结构化解析 + 飞书同步
  logger.info("Recruitment pipeline: saving candidates to DB");
  for (const candidate of topCandidates) {
    try {
      const savedEmployee = await employeeRepository.upsertFromCandidate({
        ...candidate,
        experience: candidate.experience,
        rawData: candidate.rawData,
        matchScore: candidate.matchScore,
        scoreReason: candidate.scoreReason,
        recruitmentJdTitle: jd.jobTitle,
        recruitmentJdLocation: jd.location,
      });

      // 简历结构化解析 + 飞书同步（异步，不阻塞主流程）
      if (savedEmployee) {
        parseFromCandidateData(
          candidate.rawData || {},
          candidate.experience,
          candidate.education,
        ).then((parsedResume) => {
          // 存入 metadata
          const metadata = { ...savedEmployee.metadata, parsed_resume: parsedResume };
          employeeRepository.updateStatus(savedEmployee.id, savedEmployee.status, { metadata } as any);
          // 同步到飞书
          larkSyncService.onEmployeeCreated(savedEmployee, parsedResume).catch(() => {});
        }).catch((err) => {
          logger.warn("Resume parse/Lark sync failed (non-blocking)", { name: candidate.name, error: String(err) });
        });
      }
    } catch (err) {
      logger.error("Failed to save candidate to DB", { name: candidate.name, error: String(err) });
    }
  }

  logger.info("Recruitment pipeline: complete", {
    totalFound: allCandidates.length,
    totalDeduped: deduped.length,
    topCount: topCandidates.length,
    topNames: topCandidates.map((c) => `${c.name}(${c.matchScore})`),
  });

  const result: RecruitmentTaskResult = {
    jd,
    totalCrawled: allCandidates.length,
    totalAfterDedup: deduped.length,
    topCandidates,
  };

  // 8. 自动触达候选人
  if (outreachEnabled) {
    logger.info("Recruitment pipeline: starting outreach");
    try {
      const outreachResults = await runOutreach(topCandidates, jd);
      result.outreach = outreachResults;
      const totalSent = outreachResults.reduce((sum, r) => sum + r.sent, 0);
      const totalFailed = outreachResults.reduce((sum, r) => sum + r.failed, 0);
      logger.info("Recruitment pipeline: outreach complete", { totalSent, totalFailed });
    } catch (err) {
      logger.error("Recruitment pipeline: outreach failed", { error: String(err) });
    }
  }

  return result;
}
