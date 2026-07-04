import { readFileSync } from "fs";
import { resolve } from "path";
import cron from "node-cron";
import { skillRegistry } from "./modules/orchestrator/skill-registry";
import { StateManager } from "./modules/orchestrator/state-manager";
import { PermissionService } from "./modules/orchestrator/permission-service";
import { AuditService } from "./modules/orchestrator/audit-service";
import { Orchestrator } from "./modules/orchestrator/orchestrator";
import { whatsappAdapter } from "./modules/channel/whatsapp/whatsapp.adapter";
import { aiProvider } from "./modules/domain/ai/ai-provider";
import { logger } from "./modules/shared/logger";
import { allSkills } from "./modules/skills";
import { sessionStateRepository } from "./modules/data/repositories/session-state.repository";
import { auditLogRepository } from "./modules/data/repositories/audit-log.repository";
import type { User } from "./modules/shared/types";
import { extractRules } from "./modules/domain/employee/rule-extractor";
import { checkAndNotify } from "./modules/domain/recruitment/notifications/notification.service";
import { checkDataFreshness } from "./modules/domain/notifications/freshness-check";
import { runMorningBrief } from "./modules/domain/notifications/morning-brief.service";
import { runProductionPlanPush } from "./modules/domain/notifications/production-plan-push.service";
import { runTrialDigest } from "./modules/domain/recruitment/digest/trial-digest.service";
import { runInterviewDigest } from "./modules/domain/recruitment/digest/interview-digest.service";
import { drainOutboundQueue } from "./modules/channel/whatsapp/outbound.worker";
import { runWeeklyReport } from "./modules/domain/notifications/weekly-report.service";
import { runStockoutDetection } from "./modules/domain/forecast/stockout-detector.service";
import { runOrderReminder } from "./modules/domain/supplychain/order-reminder.service";
import { runAppointmentReminder } from "./modules/domain/recruitment/appointment-reminder.service";
import { runProbationReminder } from "./modules/domain/recruitment/probation-reminder.service";
import { syncLarkOrg } from "./modules/domain/lark/lark-org-sync.service";
import { pullDailyApplicants } from "./modules/domain/recruitment/jobs/applicant-intake.service";
import { lightragClient } from "./modules/domain/knowledge/lightrag-client";
import { larkInboundAdapter } from "./modules/channel/lark/lark-inbound";

// 幂等守卫：`npm run dev` 下 server.ts 会直接调用 bootstrap()，而 Next.js 的
// instrumentation hook (app.prepare()) 又会在另一个模块 realm 再调一次。用 globalThis
// 缓存（跨 realm 共享）确保只真正初始化一次，避免起两个 WhatsApp 客户端抢同一会话锁。
export function bootstrap() {
  const g = globalThis as unknown as { __bakeryOpsBootstrap?: ReturnType<typeof runBootstrap> };
  if (!g.__bakeryOpsBootstrap) {
    g.__bakeryOpsBootstrap = runBootstrap();
  }
  return g.__bakeryOpsBootstrap;
}

async function runBootstrap() {
  // 0. 关键环境变量校验（warn-only 不退出；fail-fast 需用户另行确认）。
  //    dotenv 加载由 server.ts / postgres.ts 兜底完成，此处只做启动期明示告警。
  const requiredEnvVars = ["DATABASE_URL", "OPENROUTER_API_KEY", "OWNER_WHATSAPP"];
  for (const name of requiredEnvVars) {
    if (!process.env[name]) {
      logger.error(`Missing required environment variable: ${name}（请在 .env 中配置，参考 .env.example）`);
    }
  }

  // 1. 自动注册 Skills
  for (const { definition, Handler } of allSkills) {
    definition.handler = new Handler();
    skillRegistry.register(definition);
  }

  // 2. 初始化服务
  const stateManager = new StateManager(sessionStateRepository);
  const permissionService = new PermissionService();
  const auditService = new AuditService(auditLogRepository);

  // 2a. 冷启动时尝试从 DB 恢复进行中的多轮会话（迁移未应用/DB 不可用时静默 no-op）
  try {
    await stateManager.hydrate(sessionStateRepository);
  } catch (err) {
    logger.debug("session_state hydrate skipped", { error: String(err) });
  }

  // 3. 从数据库加载用户，失败则 fallback 到 users.json
  try {
    await permissionService.loadUsers();
  } catch (err) {
    logger.warn("Failed to load users from database, falling back to users.json", { error: String(err) });
  }

  if (!permissionService.isLoaded()) {
    const usersPath = resolve(process.cwd(), "users.json");
    try {
      const usersData: User[] = JSON.parse(readFileSync(usersPath, "utf-8"));
      for (const user of usersData) {
        if (!user.phone) continue;
        permissionService.registerUser(user);
      }
      logger.info(`Loaded ${usersData.length} users from users.json (fallback)`);
    } catch (err) {
      logger.error("Failed to load users.json", { error: err });
      throw new Error("Cannot start without users — check database or users.json");
    }
  }

  // 4. 创建 Orchestrator
  const orchestrator = new Orchestrator(
    skillRegistry,
    stateManager,
    permissionService,
    auditService,
    aiProvider,
  );

  // INSTANCE_ROLE：拆分部署用。core=核心(Lark入站+复盘/预测/内部推送，跑云上 Contabo)；
  // whatsapp=WA(招聘，跑住宅 IP/家用机避免封号)；不设=all(全部，单机/本地)。
  // 两边共用同一 DB，按角色分派「渠道 + 定时任务」，避免两边重复触发。
  const ROLE = process.env.INSTANCE_ROLE || "all";
  const onCore = ROLE === "all" || ROLE === "core";
  const onWa = ROLE === "all" || ROLE === "whatsapp";
  logger.info("Instance role", { role: ROLE, onCore, onWa });

  // 5. WhatsApp Adapter（仅 whatsapp/all 连接；core 不连，避开数据中心 IP 封号）
  whatsappAdapter.setHandler((msg) => orchestrator.handle(msg));
  if (onWa) whatsappAdapter.start();

  // 5b. Lark 入站长连接（仅 core/all 接收）。注：Lark「发送」(sendLarkToUser 等)走 API token，
  //     任何角色都能发，不受此限——所以 whatsapp 角色的招聘 cron 仍能往 Lark 发摘要。
  larkInboundAdapter.setHandler((msg) => orchestrator.handle(msg));
  if (onCore) larkInboundAdapter.start();

  // 5a. cron 心跳：每个定时任务执行前后写 audit_log（channel='cron'），失败记 failRun。
  //     供"状态"指令读取近 24h 运行统计，防止定时任务静默停摆无人知晓。
  const wrapCron = (name: string, fn: () => unknown) => async () => {
    const run = auditService.startRun(name, "system", "cron", {});
    try {
      await fn();
      auditService.completeRun(run.runId, {});
    } catch (err) {
      auditService.failRun(run.runId, String(err));
      logger.error(`Cron job failed: ${name}`, { error: String(err) });
    }
  };

  const TZ = { timezone: "Asia/Kuala_Lumpur" } as const;

  // 6. 定时清理过期会话（每 60 秒）——每个实例清自己的会话，两边都跑。高频不进 audit 心跳。
  cron.schedule("* * * * *", () => {
    try {
      stateManager.cleanup();
    } catch (err) {
      logger.error("Cron job failed: session_cleanup", { error: String(err) });
    }
  }, TZ);

  // ── core 角色的定时任务（Lark/内部推送/预测/数据；跑云上）──
  // 7. 每周日凌晨 3 点触发规则提炼
  if (onCore) cron.schedule("0 3 * * 0", wrapCron("weekly_rule_extraction", async () => {
    logger.info("Weekly rule extraction triggered");
    const result = await extractRules();
    logger.info("Weekly rule extraction completed", result);
  }), TZ);

  // 9. 每日检查 POS 数据新鲜度（默认关闭，DATA_FRESHNESS_CHECK=true 启用）
  if (onCore) cron.schedule("0 9 * * *", wrapCron("data_freshness_check", checkDataFreshness), TZ);

  // 9a. 每日 07:00 后厨生产计划推送：主厨 + 抄送老板，幂等(kind, recipient, date)
  if (onCore) cron.schedule("0 7 * * *", wrapCron("production_plan_push", runProductionPlanPush), TZ);

  // 9b. 每晚 23:30 今日复盘：收件人读 team_member 订阅（Lark 发送），无数据静默跳过
  if (onCore) cron.schedule("30 23 * * *", wrapCron("morning_brief", runMorningBrief), TZ);

  // 9c. 每日 03:00 同步 Lark 组织架构 → team_member（保留用户配的 role/subscriptions）。core 启动时也同步一次。
  if (onCore) {
    cron.schedule("0 3 * * *", wrapCron("lark_org_sync", async () => { await syncLarkOrg(); }), TZ);
    void syncLarkOrg().catch((e) => logger.warn("startup lark org sync failed", { error: String(e) }));
  }

  // 13. 每周一 10:00 经营周报（F3）
  if (onCore) cron.schedule("0 10 * * 1", wrapCron("weekly_report", runWeeklyReport), TZ);

  // 14. 每晚 23:30 断货检测（检测口径为"昨日"）
  if (onCore) cron.schedule("30 23 * * *", wrapCron("stockout_detect", runStockoutDetection), TZ);

  // 15. 工作日 16:00 订货提醒（F4，Lark 发送）
  if (onCore) cron.schedule("0 16 * * 1-5", wrapCron("order_reminder", runOrderReminder), TZ);

  // ── whatsapp 角色的定时任务（招聘/候选人；跑有 WA 客户端的一侧）──
  // 8. 每 15 分钟检查招聘通知（JobStreet，默认关闭；候选人走 WhatsApp）
  if (onWa) cron.schedule("*/15 * * * *", wrapCron("recruitment_notify", checkAndNotify), TZ);

  // 10. 每晚 23:00 试工摘要（推店长/厨师长；含 WA 回落）
  if (onWa) cron.schedule("0 23 * * *", wrapCron("trial_digest", runTrialDigest), TZ);

  // 10b. 每晚 21:00 初面结论摘要
  if (onWa) cron.schedule("0 21 * * *", wrapCron("interview_digest", runInterviewDigest), TZ);

  // 11. 每 2 分钟排空 WhatsApp 冷发外呼队列。队列空时安全 no-op；高频不进 audit 心跳。
  if (onWa) cron.schedule("*/2 * * * *", async () => {
    try {
      await drainOutboundQueue();
    } catch (err) {
      logger.error("Cron job failed: outbound_queue_drain", { error: String(err) });
    }
  }, TZ);

  // 12. 每日 12:00 JobStreet 申请人拉取（F12）
  if (onWa) cron.schedule("0 12 * * *", wrapCron("jobstreet_pull", pullDailyApplicants), TZ);

  // 16. 每日 09:05 面试当日提醒（F11，候选人）
  if (onWa) cron.schedule("5 9 * * *", wrapCron("appointment_reminder", runAppointmentReminder), TZ);

  // 17. 每日 09:10 转正提醒（env 可选 PROBATION_DAYS，默认 90）
  if (onWa) cron.schedule("10 9 * * *", wrapCron("probation_reminder", runProbationReminder), TZ);

  // 18. 一次性 LightRAG 健康探测（fire-and-forget）：不可用时只告警，不阻塞启动。
  lightragClient
    .isAvailable()
    .then((ok) => {
      if (!ok) logger.warn("LightRAG 服务不可用——复盘知识索引降级，见 IMPROVEMENT-PLAN G4");
    })
    .catch(() => {
      logger.warn("LightRAG 服务不可用——复盘知识索引降级，见 IMPROVEMENT-PLAN G4");
    });

  logger.info("System bootstrapped successfully");

  return { orchestrator, permissionService, skillRegistry, stateManager, auditService };
}
