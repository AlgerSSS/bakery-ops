/**
 * Integration tests for Phase 1 — runs against the real database (DATABASE_URL).
 * Verifies: user loading, employee CRUD, event writing, screening rules.
 */
import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import { UserRepository } from "@/modules/data/repositories/user.repository";
import { EmployeeRepository } from "@/modules/data/repositories/employee.repository";
import { EmployeeEventRepository } from "@/modules/data/repositories/employee-event.repository";
import { ScreeningRuleRepository } from "@/modules/data/repositories/screening-rule.repository";
import { execute } from "@/modules/shared/db/postgres";

const userRepo = new UserRepository();
const employeeRepo = new EmployeeRepository();
const eventRepo = new EmployeeEventRepository();
const ruleRepo = new ScreeningRuleRepository();

// Track created IDs for cleanup
const createdEmployeeIds: string[] = [];
const createdRuleIds: string[] = [];

afterAll(async () => {
  // Clean up test data
  for (const id of createdEmployeeIds) {
    await execute("DELETE FROM employee_events WHERE employee_id = ?", [id]);
    await execute("DELETE FROM employees WHERE id = ?", [id]);
  }
  for (const id of createdRuleIds) {
    await execute("DELETE FROM screening_rules WHERE id = ?", [id]);
  }
});

describe("UserRepository (integration)", () => {
  it("loads seed users from the database", async () => {
    const users = await userRepo.getAll();
    expect(users.length).toBeGreaterThanOrEqual(4);
    const owner = users.find(u => u.userId === "u_owner");
    expect(owner).toBeDefined();
    expect(owner!.role).toBe("owner");
  });

  it("finds user by phone", async () => {
    const user = await userRepo.getByPhone("61431029692");
    expect(user).not.toBeNull();
    expect(user!.userId).toBe("u_owner");
  });
});

describe("EmployeeRepository (integration)", () => {
  it("creates and retrieves an employee", async () => {
    const emp = await employeeRepo.create({
      name: "Test Employee 测试",
      source: "manual",
      status: "candidate",
      job_title: "cashier",
      skills: ["communication", "mandarin"],
      languages: ["english", "mandarin"],
    });
    expect(emp).not.toBeNull();
    expect(emp!.id).toBeDefined();
    expect(emp!.name).toBe("Test Employee 测试");
    createdEmployeeIds.push(emp!.id);

    // Retrieve by ID
    const found = await employeeRepo.getById(emp!.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Test Employee 测试");
  });

  it("finds employee by name (ilike)", async () => {
    const found = await employeeRepo.findByName("Test Employee");
    expect(found).not.toBeNull();
    expect(found!.name).toContain("Test Employee");
  });

  it("lists recent employees", async () => {
    const recent = await employeeRepo.listRecent(10);
    expect(recent.length).toBeGreaterThanOrEqual(1);
  });

  it("updates employee status", async () => {
    const id = createdEmployeeIds[0];
    await employeeRepo.updateStatus(id, "interviewing", {
      interviewed_at: new Date().toISOString(),
    });
    const updated = await employeeRepo.getById(id);
    expect(updated!.status).toBe("interviewing");
  });

  it("gets stats", async () => {
    const stats = await employeeRepo.getStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
  });
});

describe("EmployeeEventRepository (integration)", () => {
  it("creates and retrieves events for an employee", async () => {
    const empId = createdEmployeeIds[0];
    await eventRepo.create({
      employee_id: empId,
      event_type: "interview_feedback",
      summary: "面试表现良好，沟通能力强",
      raw_message: "张三面试表现不错，沟通能力强",
      reported_by: "u_owner",
      data: { rating: 4, strengths: ["沟通能力强"], concerns: [] },
    });

    const events = await eventRepo.getByEmployee(empId);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event_type).toBe("interview_feedback");
    expect(events[0].summary).toContain("沟通能力强");
  });

  it("queries events by type", async () => {
    const events = await eventRepo.getByType("interview_feedback");
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ScreeningRuleRepository (integration)", () => {
  it("creates and retrieves active rules", async () => {
    await ruleRepo.upsert({
      rule_type: "negative",
      category: "retention",
      description: "有3段以上短期工作经历的候选人离职风险高",
      evidence: "测试数据",
      confidence: 0.75,
      sample_count: 5,
      job_titles: ["cashier"],
      departments: [],
      is_active: true,
    });

    const rules = await ruleRepo.getActiveRules("cashier");
    expect(rules.length).toBeGreaterThanOrEqual(1);
    const testRule = rules.find(r => r.description.includes("短期工作经历"));
    expect(testRule).toBeDefined();
    if (testRule) createdRuleIds.push(testRule.id);
  });

  it("filters rules by job title", async () => {
    const cashierRules = await ruleRepo.getActiveRules("cashier");
    const bakerRules = await ruleRepo.getActiveRules("baker");
    // Our test rule is for cashier, so cashier should have it
    expect(cashierRules.some(r => r.description.includes("短期工作经历"))).toBe(true);
  });
});

describe("Employee lifecycle (integration)", () => {
  it("simulates full lifecycle: candidate → interviewing → hired → resigned", async () => {
    // Create candidate
    const emp = await employeeRepo.create({
      name: "Lifecycle Test 生命周期",
      source: "jobstreet",
      status: "candidate",
      job_title: "baker",
    });
    expect(emp).not.toBeNull();
    createdEmployeeIds.push(emp!.id);

    // Interview
    await employeeRepo.updateStatus(emp!.id, "interviewing", {
      interviewed_at: new Date().toISOString(),
    });
    await eventRepo.create({
      employee_id: emp!.id,
      event_type: "interview_feedback",
      summary: "面试通过",
      reported_by: "u_owner",
      data: { rating: 4 },
    });

    // Hire
    await employeeRepo.updateStatus(emp!.id, "hired", {
      hired_at: new Date().toISOString(),
      store_id: "pavilion",
    });
    await eventRepo.create({
      employee_id: emp!.id,
      event_type: "hired",
      summary: "入职 Pavilion 店",
      reported_by: "u_owner",
      data: { store: "pavilion" },
    });

    // Resign
    await employeeRepo.updateStatus(emp!.id, "resigned", {
      resigned_at: new Date().toISOString(),
    });
    await eventRepo.create({
      employee_id: emp!.id,
      event_type: "resigned",
      summary: "离职，原因：通勤距离",
      reported_by: "u_owner",
      data: { tenure_months: 1, reason: "通勤距离", reason_category: "commute" },
    });

    // Verify final state
    const final = await employeeRepo.getById(emp!.id);
    expect(final!.status).toBe("resigned");
    expect(final!.resigned_at).toBeDefined();

    const events = await eventRepo.getByEmployee(emp!.id);
    expect(events.length).toBe(3);
  });
});
