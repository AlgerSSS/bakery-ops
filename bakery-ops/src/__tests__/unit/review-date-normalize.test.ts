// 复盘日期规范化（修复"复盘7.1号"查无数据的 bug）
import { describe, it, expect } from "vitest";
import { normalizeDate } from "../../modules/skills/daily-review-chat/daily-review-chat.definition";

describe("normalizeDate", () => {
  const yr = new Date().getFullYear();
  it("短格式 7.1 / 7-1 / 7/1 → 补当前年 + 补零", () => {
    expect(normalizeDate("7.1")).toBe(`${yr}-07-01`);
    expect(normalizeDate("7-1")).toBe(`${yr}-07-01`);
    expect(normalizeDate("7/1")).toBe(`${yr}-07-01`);
  });
  it("中文 7月1日 / 7月1号", () => {
    expect(normalizeDate("7月1日")).toBe(`${yr}-07-01`);
    expect(normalizeDate("7月1号")).toBe(`${yr}-07-01`);
  });
  it("带年 2026-07-01 / 2026.7.1 原样规范", () => {
    expect(normalizeDate("2026-07-01")).toBe("2026-07-01");
    expect(normalizeDate("2026.7.1")).toBe("2026-07-01");
  });
  it("从整句里抽日期", () => {
    expect(normalizeDate("复盘一下7.1号的数据")).toBe(`${yr}-07-01`);
    expect(normalizeDate("帮我看看 2026-06-30 的复盘")).toBe("2026-06-30");
  });
  it("已规范化的日期幂等（follow-up 复用 _reviewDate 时安全）", () => {
    expect(normalizeDate(normalizeDate("7.1"))).toBe(`${yr}-07-01`);
  });
  it("取不到日期返回空串", () => {
    expect(normalizeDate("今天生意怎么样")).toBe("");
    expect(normalizeDate("")).toBe("");
  });
});

// 年份幻觉防护：用户说"6.29"，LLM 猜成 2024，应以用户原话（当前年）为准
describe("normalizeDate 年份来源", () => {
  const yr = new Date().getFullYear();
  it("无年份短格式 → 当前年（不是模型猜的历史年）", () => {
    expect(normalizeDate("6.29复盘")).toBe(`${yr}-06-29`);
  });
  it("用户显式带年份时才用该年份", () => {
    expect(normalizeDate("复盘2025年3月1日")).toBe("2025-03-01");
    expect(normalizeDate("2024-06-29")).toBe("2024-06-29");
  });
});
