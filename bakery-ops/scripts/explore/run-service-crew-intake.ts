/**
 * Service crew intake: pull JobStreet applicants -> LLM resume screen -> write to DB (applications)
 * -> write to Lark 试工流程跟踪. Does NOT send WhatsApp (that is a separate, gated step).
 *   npx tsx scripts/explore/run-service-crew-intake.ts
 */
import "dotenv/config";
import { JobStreetActiveJobs } from "../../src/modules/domain/recruitment/jobs/jobstreet.active-jobs";
import { jobOpeningRepository } from "../../src/modules/data/repositories/job-opening.repository";
import { applicationRepository } from "../../src/modules/data/repositories/application.repository";
import { larkRecruitmentService } from "../../src/modules/domain/lark/lark-recruitment.service";
import { aiProvider } from "../../src/modules/domain/ai/ai-provider";
import type { JobApplicant } from "../../src/modules/domain/recruitment/types";

const STORE = "pavilion";
const maskP = (s?: string) => (s ? s.slice(0, 4) + "****" + s.slice(-2) : "(none)");
const maskN = (s: string) => s.slice(0, 2) + "***";

interface Screen { applicantId: string; invite: boolean; fitScore: number; reason: string }

async function screen(apps: JobApplicant[]): Promise<Map<string, Screen>> {
  const roster = apps.map((a) => ({
    id: a.applicantId,
    currentTitle: a.currentTitle || "(none)",
    experienceYears: a.experienceYears ?? 0,
  }));
  const prompt = [
    "你是 Hot Crush（吉隆坡连锁烘焙咖啡店）的招聘初筛助手。岗位：前场 Service Crew（柜台/收银/水吧/服务，需轮班+周末，面向顾客，入门级，看重态度与稳定性，不强制经验）。",
    "对每位投递者做初筛：判断是否值得邀约面试(invite)，给 fitScore(0-100) 与一句中文理由。入门岗门槛低——只要无明显硬伤(完全无关且毫无服务意愿的除外)，一般都 invite=true。",
    "只输出 JSON 数组，元素 {\"id\":string,\"invite\":boolean,\"fitScore\":number,\"reason\":string}，不要多余文字。",
    "投递者：",
    JSON.stringify(roster, null, 1),
  ].join("\n");

  const raw = await aiProvider.chatCompletionLong(prompt);
  const m = raw.match(/\[[\s\S]*\]/);
  const arr: any[] = m ? JSON.parse(m[0]) : [];
  const out = new Map<string, Screen>();
  for (const r of arr) out.set(String(r.id), { applicantId: String(r.id), invite: !!r.invite, fitScore: Number(r.fitScore) || 0, reason: String(r.reason || "") });
  return out;
}

async function main() {
  const conn = new JobStreetActiveJobs();
  const jobs = await conn.fetchActiveJobs();
  const sc = jobs.find((j) => /service\s*crew/i.test(j.title));
  if (!sc) { console.log("Service crew job not found"); return; }
  console.log(`Service crew jobId=${sc.jobId}, applicants=${sc.applicantCount}`);

  const opening = await jobOpeningRepository.upsertFromJobStreet(STORE, sc.jobId, "FOH", sc.title);
  console.log("job_opening:", opening?.id);

  const apps = await conn.fetchApplicants(sc.jobId);
  console.log(`pulled ${apps.length} applicants`);

  const screens = await screen(apps);
  console.log("\n=== screening + writes ===");

  for (const a of apps) {
    const s = screens.get(a.applicantId) || { invite: true, fitScore: 50, reason: "默认邀约" } as Screen;
    const hasPhone = !!a.phone;

    // 1. DB: applications row (dedup on store+phone), stage -> contacting (①联系约面 for invited)
    const app = await applicationRepository.createOrGet({
      store_id: STORE,
      job_opening_id: opening?.id,
      phone: a.phone,
      name: a.name,
      external_applicant_id: a.applicantId,
      role_area: "FOH",
      contact_status: hasPhone ? "ready" : "needs_manual",
      source: "jobstreet",
    });
    if (!app) { console.log(`  ✗ ${maskN(a.name)} — DB write failed`); continue; }
    await applicationRepository.advanceStage(app.id, s.invite ? "contacting" : "backup_pool");

    // 2. Lark: candidate row in 试工流程跟踪 (当前阶段 ①联系约面, 应聘类型 前场, 来源渠道 招聘平台)
    const larkId = await larkRecruitmentService.upsertCandidateRow(
      { ...app, name: a.name, role_area: "FOH" },
      {
        当前阶段: s.invite ? "①联系约面" : "备选池",
        应聘类型: "前场",
        来源渠道: "招聘平台",
        firstContactDate: new Date().toISOString(),
      },
    );

    console.log(`  ${s.invite ? "✓invite" : "—hold"} ${maskN(a.name)} fit=${s.fitScore} phone=${maskP(a.phone)} | app=${app.id.slice(0, 8)} lark=${larkId ? larkId.slice(0, 10) : "FAIL"} | ${s.reason}`);
  }
  console.log("\nDONE (no WhatsApp sent — outreach is the next gated step)");
}

main().catch((e) => { console.error("ERR", String(e).slice(0, 400)); process.exit(1); });
