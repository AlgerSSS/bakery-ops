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

  // 6. 定时清理过期会话（每 60 秒）
  cron.schedule("* * * * *", () => stateManager.cleanup(), { timezone: "Asia/Kuala_Lumpur" });

  // 7. 每周日凌晨 3 点触发规则提炼
  cron.schedule("0 3 * * 0", async () => {
    logger.info("Weekly rule extraction triggered");
    try {
      const result = await extractRules();
      logger.info("Weekly rule extraction completed", result);
    } catch (err) {
      logger.error("Weekly rule extraction failed", { error: String(err) });
    }
  }, { timezone: "Asia/Kuala_Lumpur" });

  // 8. 每 15 分钟检查招聘通知
  cron.schedule("*/15 * * * *", async () => {
    try {
      await checkAndNotify();
    } catch (err) {
      logger.error("Notification check failed", { error: String(err) });
    }
  }, { timezone: "Asia/Kuala_Lumpur" });

  // 9. 每日检查 POS 数据新鲜度（默认关闭，DATA_FRESHNESS_CHECK=true 启用）
  cron.schedule("0 9 * * *", async () => {
    try {
      await checkDataFreshness();
    } catch (err) {
      logger.error("Data freshness check failed", { error: String(err) });
    }
  }, { timezone: "Asia/Kuala_Lumpur" });

  logger.info("System bootstrapped successfully");

  return { orchestrator, permissionService, skillRegistry, stateManager, auditService };
}
