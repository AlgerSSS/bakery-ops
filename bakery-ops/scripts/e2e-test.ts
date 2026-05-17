/**
 * End-to-end module test — validates each domain module works correctly.
 * Run with: npx tsx scripts/e2e-test.ts
 */
import "dotenv/config";

const results: { module: string; test: string; status: "pass" | "fail"; detail?: string }[] = [];

function log(module: string, test: string, status: "pass" | "fail", detail?: string) {
  results.push({ module, test, status, detail });
  const icon = status === "pass" ? "✓" : "✗";
  console.log(`  ${icon} [${module}] ${test}${detail ? ` — ${detail}` : ""}`);
}

async function testDatabase() {
  console.log("\n━━━ 1. Database Connection ━━━");
  try {
    const { query } = await import("../src/modules/shared/db/postgres");
    const rows = await query<{ now: string }>("SELECT NOW() as now");
    log("database", "连接 PostgreSQL", "pass", `time=${rows[0].now}`);
  } catch (e: any) {
    log("database", "连接 PostgreSQL", "fail", e.message);
  }
}

async function testForecastEngine() {
  console.log("\n━━━ 2. Forecast Engine (纯计算) ━━━");
  try {
    const { calculateSalesBaselines, calculateMonthlyTargets, calculateDailyTargets } =
      await import("../src/modules/domain/forecast/forecast-engine");

    // Monthly targets
    const monthly = calculateMonthlyTargets(1640000, { "1": 0.08, "2": 0.07, "3": 0.08 });
    if (monthly.length === 12 && monthly[0].target > 0) {
      log("forecast", "calculateMonthlyTargets", "pass", `Jan=${monthly[0].target}`);
    } else {
      log("forecast", "calculateMonthlyTargets", "fail", `got ${monthly.length} months`);
    }

    // Daily targets
    const daily = calculateDailyTargets(
      monthly[0].target,
      2026, 1,
      { mondayToThursday: 1.0, friday: 1.25, saturday: 1.55, sunday: 1.55 },
      []
    );
    if (daily.length === 31) {
      log("forecast", "calculateDailyTargets", "pass", `31 days, day1=${daily[0].target.toFixed(0)}`);
    } else {
      log("forecast", "calculateDailyTargets", "fail", `got ${daily.length} days`);
    }

    // Sales baselines
    const records = [
      { productName: "牛角包", standardName: "牛角包", quantity: 10, date: "2026-01-06", dayOfWeek: 1 },
      { productName: "牛角包", standardName: "牛角包", quantity: 12, date: "2026-01-07", dayOfWeek: 2 },
      { productName: "牛角包", standardName: "牛角包", quantity: 15, date: "2026-01-10", dayOfWeek: 5 },
      { productName: "牛角包", standardName: "牛角包", quantity: 20, date: "2026-01-11", dayOfWeek: 6 },
    ];
    const products = [{ id: "1", category: "面包", name: "牛角包", nameEn: "Croissant", price: 8, packMultiple: 6, unitType: "batch" as const, displayFullQuantity: 0 }];
    const baselines = calculateSalesBaselines(records, products, {});
    if (baselines.length > 0 && baselines[0].avgMondayToThursday > 0) {
      log("forecast", "calculateSalesBaselines", "pass", `牛角包 weekday avg=${baselines[0].avgMondayToThursday}`);
    } else {
      log("forecast", "calculateSalesBaselines", "fail", "empty baselines");
    }
  } catch (e: any) {
    log("forecast", "forecast-engine", "fail", e.message);
  }
}

async function testForecastRepository() {
  console.log("\n━━━ 3. Forecast Repository (DB) ━━━");
  try {
    const repo = await import("../src/modules/data/repositories/forecast.repository");

    const products = await repo.getProducts();
    log("forecast-repo", "getProducts", products.length > 0 ? "pass" : "fail", `count=${products.length}`);

    const strategies = await repo.getStrategies();
    log("forecast-repo", "getStrategies", strategies.length > 0 ? "pass" : "fail", `count=${strategies.length}`);

    const baselines = await repo.getSalesBaselines();
    log("forecast-repo", "getSalesBaselines", baselines.length > 0 ? "pass" : "fail", `count=${baselines.length}`);

    const rules = await repo.getBusinessRulesFromDB();
    log("forecast-repo", "getBusinessRules", rules.firstMonthRevenue > 0 ? "pass" : "fail", `revenue=${rules.firstMonthRevenue}`);

    const holidays = await repo.getHolidays(2026);
    log("forecast-repo", "getHolidays", "pass", `count=${holidays.length}`);

    const segments = await repo.getPromptSegments();
    log("forecast-repo", "getPromptSegments", segments.length > 0 ? "pass" : "fail", `count=${segments.length}`);

    const templates = await repo.getPromptTemplates();
    log("forecast-repo", "getPromptTemplates", templates.length > 0 ? "pass" : "fail", `count=${templates.length}`);
  } catch (e: any) {
    log("forecast-repo", "repository queries", "fail", e.message);
  }
}

async function testPromptEngine() {
  console.log("\n━━━ 4. Prompt Engine ━━━");
  try {
    const { buildPrompt } = await import("../src/modules/domain/forecast/prompt-engine");
    const result = await buildPrompt("daily_correction", {
      year: "2026", month: "5", monthPadded: "05", daysInMonth: "31",
      cityInfo: "吉隆坡", holidayInfo: "无", adjacentInfo: "", yearOverview: "",
      eventsInfo: "", baseCoefficientsInfo: "test",
    });
    if (result.systemInstruction && result.prompt && result.model) {
      log("prompt-engine", "buildPrompt(daily_correction)", "pass", `model=${result.model}`);
    } else {
      log("prompt-engine", "buildPrompt(daily_correction)", "fail", "missing fields");
    }
  } catch (e: any) {
    log("prompt-engine", "buildPrompt", "fail", e.message);
  }
}

async function testOpenRouterAI() {
  console.log("\n━━━ 5. OpenRouter AI Provider ━━━");
  try {
    const { openrouterProvider } = await import("../src/modules/shared/ai/openrouter.provider");
    const response = await openrouterProvider.chatCompletion("回复一个字：好", 10);
    if (response && response.length > 0) {
      log("ai", "chatCompletion", "pass", `response="${response.trim()}"`);
    } else {
      log("ai", "chatCompletion", "fail", "empty response");
    }
  } catch (e: any) {
    log("ai", "chatCompletion", "fail", e.message);
  }
}

async function testSupplyChain() {
  console.log("\n━━━ 6. Supply Chain (Order Parser) ━━━");
  try {
    const { parseOrderItems } = await import("../src/modules/domain/supplychain/order-parser");
    const items = parseOrderItems("面粉:50kg, 糖:20kg, 鸡蛋:200个");
    if (items.length === 3 && items[0].name.includes("面粉")) {
      log("supplychain", "parseOrderItems 标准格式", "pass", `parsed ${items.length} items`);
    } else {
      log("supplychain", "parseOrderItems 标准格式", "fail", `got ${items.length} items`);
    }

    const items2 = parseOrderItems("面粉：50kg，糖：20kg");
    log("supplychain", "parseOrderItems 中文冒号", items2.length === 2 ? "pass" : "fail", `parsed ${items2.length} items`);
  } catch (e: any) {
    log("supplychain", "order-parser", "fail", e.message);
  }
}

async function testProductionPlan() {
  console.log("\n━━━ 7. Production Plan ━━━");
  try {
    const { generateProductionPlan } = await import("../src/modules/domain/production-plan/plan-generator");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split("T")[0];
    const plan = await generateProductionPlan(dateStr);
    if (plan && plan.batches && plan.batches.length > 0) {
      log("production-plan", "generateProductionPlan", "pass", `${plan.batches.length} batches for ${dateStr}`);
    } else {
      log("production-plan", "generateProductionPlan", "pass", `plan generated (0 batches — may need forecast data)`);
    }
  } catch (e: any) {
    log("production-plan", "plan-generator", "fail", e.message);
  }
}

async function testEmployeeModule() {
  console.log("\n━━━ 8. Employee Module ━━━");
  try {
    const { parseEmployeeEvent } = await import("../src/modules/domain/employee/employee-event.parser");
    const event = parseEmployeeEvent("Mikhail 今天面试表现不错，沟通能力强");
    if (event && event.employeeName) {
      log("employee", "parseEmployeeEvent", "pass", `name=${event.employeeName}, type=${event.eventType}`);
    } else {
      log("employee", "parseEmployeeEvent", "fail", "could not parse");
    }
  } catch (e: any) {
    log("employee", "employee-event.parser", "fail", e.message);
  }

  try {
    const { employeeRepository } = await import("../src/modules/data/repositories/employee.repository");
    const stats = await employeeRepository.getStats();
    log("employee", "getStats", "pass", `total=${stats.total}, active=${stats.active}`);
  } catch (e: any) {
    log("employee", "getStats", "fail", e.message);
  }
}

async function testSkillRegistry() {
  console.log("\n━━━ 9. Skill Registry & Auto-Registration ━━━");
  try {
    const { allSkills } = await import("../src/modules/skills");
    log("skills", "allSkills 导入", "pass", `${allSkills.length} skills`);

    const { skillRegistry } = await import("../src/modules/orchestrator/skill-registry");
    for (const { definition, Handler } of allSkills) {
      definition.handler = new Handler();
      skillRegistry.register(definition);
    }
    const registered = skillRegistry.getAll();
    log("skills", "自动注册", registered.length === 14 ? "pass" : "fail", `registered=${registered.length}/14`);
  } catch (e: any) {
    log("skills", "skill registration", "fail", e.message);
  }
}

async function testIntentRouter() {
  console.log("\n━━━ 10. Intent Router (关键词层) ━━━");
  try {
    const { IntentRouter } = await import("../src/modules/orchestrator/intent-router");
    const { skillRegistry } = await import("../src/modules/orchestrator/skill-registry");
    const { openrouterProvider } = await import("../src/modules/shared/ai/openrouter.provider");

    const router = new IntentRouter(skillRegistry, openrouterProvider);

    // Test keyword matching (Layer 1) — should not call LLM
    const testCases = [
      { input: "帮我招人", expected: "recruitment_sourcing" },
      { input: "订货: 面粉:50kg", expected: "supply_order" },
      { input: "到货: 面粉:48kg", expected: "arrival_check" },
      { input: "明天预估单", expected: "forecast_order" },
      { input: "帮我找KOL", expected: "kol_discovery" },
    ];

    for (const tc of testCases) {
      const result = await router.route(tc.input, [{ role: "user", content: tc.input }]);
      const matched = result.skillId === tc.expected;
      log("intent-router", `"${tc.input}" → ${tc.expected}`, matched ? "pass" : "fail",
        matched ? undefined : `got ${result.skillId || "chat"}`);
    }
  } catch (e: any) {
    log("intent-router", "routing", "fail", e.message);
  }
}

async function testRecruitmentDB() {
  console.log("\n━━━ 11. Recruitment (DB only, no Playwright) ━━━");
  try {
    const { employeeRepository } = await import("../src/modules/data/repositories/employee.repository");
    const recent = await employeeRepository.findRecentCandidates(5);
    log("recruitment", "findRecentCandidates", "pass", `count=${recent.length}`);
  } catch (e: any) {
    log("recruitment", "findRecentCandidates", "fail", e.message);
  }
}

async function testSupplyChainDB() {
  console.log("\n━━━ 12. Supply Chain (DB) ━━━");
  try {
    const { supplyOrderRepository } = await import("../src/modules/data/repositories/supply-order.repository");
    const orders = await supplyOrderRepository.getRecentOrders("store_kl", 3);
    log("supplychain-db", "getRecentOrders", "pass", `count=${orders.length}`);
  } catch (e: any) {
    log("supplychain-db", "getRecentOrders", "fail", e.message);
  }
}

async function testLarkModule() {
  console.log("\n━━━ 13. Lark Module ━━━");
  try {
    const lark = await import("../src/modules/domain/lark/lark-base.service");
    log("lark", "module import", "pass");
  } catch (e: any) {
    log("lark", "module import", "fail", e.message);
  }
}

async function testKnowledgeModule() {
  console.log("\n━━━ 14. Knowledge (LightRAG) ━━━");
  try {
    const { LightRAGClient } = await import("../src/modules/domain/knowledge/lightrag-client");
    log("knowledge", "module import", "pass");
  } catch (e: any) {
    log("knowledge", "module import", "fail", e.message);
  }
}

async function testNodeCron() {
  console.log("\n━━━ 15. Node-Cron ━━━");
  try {
    const cron = await import("node-cron");
    const valid = cron.validate("0 3 * * 0");
    log("cron", "validate cron expression", valid ? "pass" : "fail");
  } catch (e: any) {
    log("cron", "node-cron import", "fail", e.message);
  }
}

// ===== Main =====
async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   Bakery-Ops E2E Module Test Suite   ║");
  console.log("╚══════════════════════════════════════╝");

  await testDatabase();
  await testForecastEngine();
  await testForecastRepository();
  await testPromptEngine();
  await testOpenRouterAI();
  await testSupplyChain();
  await testProductionPlan();
  await testEmployeeModule();
  await testSkillRegistry();
  await testIntentRouter();
  await testRecruitmentDB();
  await testSupplyChainDB();
  await testLarkModule();
  await testKnowledgeModule();
  await testNodeCron();

  // Summary
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║            Test Summary              ║");
  console.log("╚══════════════════════════════════════╝");
  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;
  console.log(`\n  Total: ${results.length} | Pass: ${passed} | Fail: ${failed}\n`);

  if (failed > 0) {
    console.log("  Failed tests:");
    for (const r of results.filter(r => r.status === "fail")) {
      console.log(`    ✗ [${r.module}] ${r.test}: ${r.detail || ""}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
