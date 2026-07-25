// llm-output-validation.test.ts
//
// G3b: LLM 输出落库前的 zod 形状校验。
// 坏形状（如 eventType 是数组、description 是数字）必须被拦截并走既有错误路径，
// 不落库；合法形状行为不变。

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/domain/ai/ai-provider", () => ({
  aiProvider: {
    chatCompletionLong: vi.fn(),
  },
}));

vi.mock("@/modules/data/repositories/employee.repository", () => ({
  employeeRepository: {
    listRecent: vi.fn().mockResolvedValue([]),
    getByStatus: vi.fn(),
  },
}));

vi.mock("@/modules/data/repositories/employee-event.repository", () => ({
  employeeEventRepository: {
    getByEmployee: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/modules/data/repositories/screening-rule.repository", () => ({
  screeningRuleRepository: {
    upsert: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/domain/knowledge/lightrag-client", () => ({
  lightragClient: {
    ingest: vi.fn().mockResolvedValue(undefined),
  },
}));

import { aiProvider } from "@/modules/domain/ai/ai-provider";
import { employeeRepository } from "@/modules/data/repositories/employee.repository";
import { screeningRuleRepository } from "@/modules/data/repositories/screening-rule.repository";
import { parseEmployeeEvent } from "@/modules/domain/employee/employee-event.parser";
import { extractRules } from "@/modules/domain/employee/rule-extractor";

const mockChat = vi.mocked(aiProvider.chatCompletionLong);
const mockGetByStatus = vi.mocked(employeeRepository.getByStatus);
const mockUpsert = vi.mocked(screeningRuleRepository.upsert);

const fakeEmployee = (id: string, status: string) => ({
  id,
  name: `员工${id}`,
  job_title: "Cashier",
  store_id: "pavilion",
  status,
  skills: [],
  languages: [],
  education: null,
  source: "manual",
  hired_at: null,
  resigned_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseEmployeeEvent zod validation", () => {
  it("rejects bad shapes (eventType as array) via the existing error path", async () => {
    mockChat.mockResolvedValue(JSON.stringify({
      employeeName: "张三",
      employeeId: null,
      eventType: ["hired", "resigned"],
      summary: "张三入职",
      data: {},
      isNewEmployee: true,
    }));

    await expect(parseEmployeeEvent("张三今天入职")).rejects.toThrow("无法解析员工事件信息");
  });

  it("passes through a valid shape unchanged", async () => {
    mockChat.mockResolvedValue(JSON.stringify({
      employeeName: "张三",
      employeeId: null,
      eventType: "hired",
      summary: "张三入职",
      data: { position: "Cashier" },
      isNewEmployee: true,
    }));

    const parsed = await parseEmployeeEvent("张三今天入职");
    expect(parsed.eventType).toBe("hired");
    expect(parsed.data).toEqual({ position: "Cashier" });
  });
});

describe("extractRules zod validation", () => {
  beforeEach(() => {
    // resigned + terminated + hired 各 1 人，凑够 totalSamples >= 3
    mockGetByStatus.mockImplementation(async (status: string) => [fakeEmployee(`e-${status}`, status)] as never);
  });

  it("rejects bad shapes (description as number) and does not upsert", async () => {
    mockChat.mockResolvedValue(JSON.stringify([
      { rule_type: "negative", category: "retention", description: 123, evidence: "证据", confidence: 0.7, job_titles: [] },
    ]));

    const result = await extractRules();
    expect(result).toEqual({ rulesExtracted: 0, error: "LLM response failed schema validation" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("upserts rules for a valid shape", async () => {
    mockChat.mockResolvedValue(JSON.stringify([
      { rule_type: "negative", category: "retention", description: "通勤超 1 小时留存差", evidence: "证据", confidence: 0.7, job_titles: [] },
    ]));

    const result = await extractRules();
    expect(result).toEqual({ rulesExtracted: 1 });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ description: "通勤超 1 小时留存差" }));
  });
});
