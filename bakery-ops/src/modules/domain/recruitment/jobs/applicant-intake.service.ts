// applicant-intake.service.ts — JobStreet 每日 12:00 申请人拉取，人工联系版（IMPROVEMENT-PLAN.md F12）。
//
// 原计划的冷发路径被 DEFER（owner decision），本版【不发任何冷消息】：
//   - fetchActiveJobs → 逐个 active 职位 fetchApplicants（applications GraphQL op，列表页即含 phone/email）；
//   - applicationRepository.createOrGet 以 external_applicant_id 去重落库，contact_status='needs_manual'
//     （电话一并存下方便人工联系，但绝不据此外呼）；
//   - 当天新增 N>0 时推店长一条汇总（暖号码，幂等 kind='jobstreet_pull'），请其上后台或人工联系；
//   - 会话过期时 logger.error 提示重跑 scripts/explore/jobstreet-relogin.ts，正常返回。
// cron '0 12 * * *' 的注册仍留在 bootstrap.ts（注释状态），由接线统一处理。

import { logger } from "../../../shared/logger";
import { notifyInternal } from "../../../channel/internal-notify";
import { localDate } from "../../../channel/whatsapp/outbound.config";
import { storeRepository, type StoreRow } from "../../../data/repositories/store.repository";
import { applicationRepository } from "../../../data/repositories/application.repository";
import { userRepository } from "../../../data/repositories/user.repository";
import { hasPushLog, recordPushLog } from "../../notifications/push-log";
import { hasValidSession } from "../connectors/jobstreet-login";
import { JobStreetActiveJobs } from "./jobstreet.active-jobs";

const PUSH_KIND = "jobstreet_pull";

/** 店长汇总文本：新增人数 + 名单 + 人工联系提示。 */
export function buildIntakeSummaryText(names: string[]): string {
  return `今日 JobStreet 新增 ${names.length} 位申请人：${names.join("、")}，请上后台或人工联系。`;
}

/** 入口 — 12:00 cron。会话过期/无新增时安全 no-op，绝不外呼申请人。 */
export async function pullDailyApplicants(): Promise<void> {
  if (!hasValidSession()) {
    logger.error(
      "JobStreet applicant intake: session expired — run scripts/explore/jobstreet-relogin.ts to refresh the login",
    );
    return;
  }

  const stores = await storeRepository.listActive();
  const store = stores[0]; // 与 pre-router 一致：默认唯一在营门店
  if (!store) {
    logger.warn("JobStreet applicant intake: no active store, skipping");
    return;
  }

  const fetcher = new JobStreetActiveJobs();
  const jobs = await fetcher.fetchActiveJobs();
  const activeJobs = jobs.filter((j) => j.status === "active");

  let pulled = 0;
  const newNames: string[] = [];

  for (const job of activeJobs) {
    const applicants = await fetcher.fetchApplicants(job.jobId);
    pulled += applicants.length;

    for (const a of applicants) {
      if (!a.applicantId) continue;

      // 去重：同 external_applicant_id 已落库则跳过。
      const existing = await applicationRepository.findByExternalId(store.store_code, null, a.applicantId);
      if (existing) continue;

      const row = await applicationRepository.createOrGet({
        store_id: store.store_code,
        external_applicant_id: a.applicantId,
        name: a.name,
        phone: a.phone,
        contact_status: "needs_manual",
        source: "jobstreet",
      });
      // createOrGet 带 phone 时会先按电话去重；命中已有申请（如 WhatsApp 进线的同一人）时
      // 返回行的 external_applicant_id 不等于本次的，不算新增。
      if (row && row.external_applicant_id === a.applicantId) newNames.push(a.name);
    }
  }

  logger.info("JobStreet applicant intake: done", {
    jobs: activeJobs.length,
    pulled,
    created: newNames.length,
  });

  if (newNames.length === 0) return;
  await notifyManager(store, newNames);
}

async function notifyManager(store: StoreRow, names: string[]): Promise<void> {
  const recipient = await resolveManagerPhone(store);
  if (!recipient) {
    logger.warn("JobStreet applicant intake: no manager/owner phone configured, skipping push");
    return;
  }

  const today = localDate();
  if (await hasPushLog(PUSH_KIND, recipient, today)) {
    logger.info("JobStreet applicant intake: already pushed today, skipping", { recipient, date: today });
    return;
  }

  const sent = await notifyInternal(recipient, buildIntakeSummaryText(names));
  if (!sent) {
    logger.error("JobStreet applicant intake: push failed", { recipient });
    return;
  }
  await recordPushLog(PUSH_KIND, recipient, today);
  logger.info("JobStreet applicant intake: pushed manager summary", { recipient, count: names.length });
}

/** 收件人：门店店长（stores.manager_user_id → users.phone）；未配置时兜底老板 (OWNER_WHATSAPP)。 */
async function resolveManagerPhone(store: StoreRow): Promise<string | null> {
  const { managerUserId } = await storeRepository.getManagerAndChef(store.store_code);
  if (managerUserId) {
    const manager = await userRepository.getByUserId(managerUserId);
    if (manager?.phone) return manager.phone;
  }
  return process.env.OWNER_WHATSAPP || process.env.OWNER_PHONE || null;
}
