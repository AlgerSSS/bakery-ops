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

  // 5. 连接 WhatsApp Adapter
  whatsappAdapter.setHandler((msg) => orchestrator.handle(msg));
  whatsappAdapter.start();

  // 5b. Lark 入站（长连接）：内部人员在 Lark 与机器人对话，走同一个 orchestrator。
  //     凭据未配置时自动禁用；连接失败不影响 WhatsApp 主链路。
  larkInboundAdapter.setHandler((msg) => orchestrator.handle(msg));
  larkInboundAdapter.start();

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

  // 6. 定时清理过期会话（每 60 秒）——高频任务不进 audit 心跳（每天会写 ~2880 条噪音记录），
  //    失败只打日志；心跳留给低频业务 cron。
  cron.schedule("* * * * *", () => {
    try {
      stateManager.cleanup();
    } catch (err) {
      logger.error("Cron job failed: session_cleanup", { error: String(err) });
    }
  }, { timezone: "Asia/Kuala_Lumpur" });

  // 7. 每周日凌晨 3 点触发规则提炼
  cron.schedule("0 3 * * 0", wrapCron("weekly_rule_extraction", async () => {
    logger.info("Weekly rule extraction triggered");
    const result = await extractRules();
    logger.info("Weekly rule extraction completed", result);
  }), { timezone: "Asia/Kuala_Lumpur" });

  // 8. 每 15 分钟检查招聘通知。当前唯一的检查器是 JobStreet，且默认关闭
  //    （需 JOBSTREET_NOTIFICATIONS_ENABLED=true；其 GraphQL query 仍是未验证占位符，
  //    待 live discovery 确认后才开启）。flag 关闭时 checkAndNotify 干净 no-op，不报错。
  cron.schedule("*/15 * * * *", wrapCron("recruitment_notify", checkAndNotify), { timezone: "Asia/Kuala_Lumpur" });

  // 9. 每日检查 POS 数据新鲜度（默认关闭，DATA_FRESHNESS_CHECK=true 启用）
  cron.schedule("0 9 * * *", wrapCron("data_freshness_check", checkDataFreshness), { timezone: "Asia/Kuala_Lumpur" });

  // 9a. 每日 07:00 后厨生产计划推送：主厨 + 抄送老板，幂等(kind, recipient, date)
  cron.schedule("0 7 * * *", wrapCron("production_plan_push", runProductionPlanPush), { timezone: "Asia/Kuala_Lumpur" });

  // 9b. 每晚 23:30 今日复盘：23:00 数据刷新后推送，覆盖当天；收件人读 team_member 订阅，幂等(kind, recipient, date)；无数据静默跳过
  cron.schedule("30 23 * * *", wrapCron("morning_brief", runMorningBrief), { timezone: "Asia/Kuala_Lumpur" });

  // 9c. 每日 03:00 同步 Lark 组织架构 → team_member（保留用户配的 role/subscriptions）。启动时也同步一次。
  cron.schedule("0 3 * * *", wrapCron("lark_org_sync", async () => { await syncLarkOrg(); }), { timezone: "Asia/Kuala_Lumpur" });
  void syncLarkOrg().catch((e) => logger.warn("startup lark org sync failed", { error: String(e) }));

  // 10. 每晚 23:00 试工摘要：分别推送给店长(前场/FOH)和厨师长(后厨/BOH)，幂等(店,收件人,日期)
  cron.schedule("0 23 * * *", wrapCron("trial_digest", runTrialDigest), { timezone: "Asia/Kuala_Lumpur" });

  // 10b. 每晚 21:00 初面结论摘要：分别推送给店长(前场/FOH)和厨师长(后厨/BOH)，幂等(店,收件人,日期,kind)
  cron.schedule("0 21 * * *", wrapCron("interview_digest", runInterviewDigest), { timezone: "Asia/Kuala_Lumpur" });

  // 11. 每 2 分钟排空 WhatsApp 冷发外呼队列（治理：营业时间/日上限/抖动）。队列空时为安全 no-op。
  //     高频任务不进 audit 心跳（同 session_cleanup），worker 自带日志。
  cron.schedule("*/2 * * * *", async () => {
    try {
      await drainOutboundQueue();
    } catch (err) {
      logger.error("Cron job failed: outbound_queue_drain", { error: String(err) });
    }
  }, { timezone: "Asia/Kuala_Lumpur" });

  // 12. 每日 12:00 JobStreet 申请人拉取（F12）
  cron.schedule("0 12 * * *", wrapCron("jobstreet_pull", pullDailyApplicants), { timezone: "Asia/Kuala_Lumpur" });

  // 13. 每周一 10:00 经营周报（F3）
  cron.schedule("0 10 * * 1", wrapCron("weekly_report", runWeeklyReport), { timezone: "Asia/Kuala_Lumpur" });

  // 14. 每晚 23:30 断货检测（检测口径为"昨日"，见 stockout-detector.service）
  cron.schedule("30 23 * * *", wrapCron("stockout_detect", runStockoutDetection), { timezone: "Asia/Kuala_Lumpur" });

  // 15. 工作日 16:00 订货提醒（F4）
  cron.schedule("0 16 * * 1-5", wrapCron("order_reminder", runOrderReminder), { timezone: "Asia/Kuala_Lumpur" });

  // 16. 每日 09:05 面试当日提醒（F11）
  cron.schedule("5 9 * * *", wrapCron("appointment_reminder", runAppointmentReminder), { timezone: "Asia/Kuala_Lumpur" });

  // 17. 每日 09:10 转正提醒（env 可选 PROBATION_DAYS，默认 90）
  cron.schedule("10 9 * * *", wrapCron("probation_reminder", runProbationReminder), { timezone: "Asia/Kuala_Lumpur" });

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
