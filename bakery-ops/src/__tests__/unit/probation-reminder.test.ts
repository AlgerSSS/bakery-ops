// probation-reminder.test.ts — F13 试用期转正提醒：窗口判断纯函数 + 提醒文案。

import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/shared/db/postgres", () => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("@/modules/channel/whatsapp/whatsapp.client", () => ({
  isClientConnected: vi.fn().mockResolvedValue(true),
  sendTextTo: vi.fn().mockResolvedValue({ ok: true }),
}));

import {
  isInProbationWindow,
  buildProbationReminderText,
  probationDays,
} from "@/modules/domain/recruitment/probation-reminder.service";

const NOW = new Date("2026-07-02T09:00:00Z");

/** hired_at exactly N days before NOW. */
function hiredDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("isInProbationWindow (default 90 days, window [80, 90])", () => {
  it("inside the window: 80 / 85 / 90 days -> true", () => {
    expect(isInProbationWindow(hiredDaysAgo(80), NOW, 90)).toBe(true);
    expect(isInProbationWindow(hiredDaysAgo(85), NOW, 90)).toBe(true);
    expect(isInProbationWindow(hiredDaysAgo(90), NOW, 90)).toBe(true);
  });

  it("outside the window: 79 / 91 / 0 days -> false", () => {
    expect(isInProbationWindow(hiredDaysAgo(79), NOW, 90)).toBe(false);
    expect(isInProbationWindow(hiredDaysAgo(91), NOW, 90)).toBe(false);
    expect(isInProbationWindow(hiredDaysAgo(0), NOW, 90)).toBe(false);
  });

  it("respects a custom PROBATION_DAYS (e.g. 60 -> window [50, 60])", () => {
    expect(isInProbationWindow(hiredDaysAgo(50), NOW, 60)).toBe(true);
    expect(isInProbationWindow(hiredDaysAgo(60), NOW, 60)).toBe(true);
    expect(isInProbationWindow(hiredDaysAgo(49), NOW, 60)).toBe(false);
    expect(isInProbationWindow(hiredDaysAgo(61), NOW, 60)).toBe(false);
  });

  it("invalid hired_at -> false", () => {
    expect(isInProbationWindow("not-a-date", NOW, 90)).toBe(false);
    expect(isInProbationWindow("", NOW, 90)).toBe(false);
  });
});

describe("probationDays env parsing", () => {
  it("defaults to 90 when PROBATION_DAYS is unset or invalid", () => {
    const prev = process.env.PROBATION_DAYS;
    delete process.env.PROBATION_DAYS;
    expect(probationDays()).toBe(90);
    process.env.PROBATION_DAYS = "abc";
    expect(probationDays()).toBe(90);
    process.env.PROBATION_DAYS = "60";
    expect(probationDays()).toBe(60);
    if (prev === undefined) delete process.env.PROBATION_DAYS;
    else process.env.PROBATION_DAYS = prev;
  });
});

describe("buildProbationReminderText", () => {
  it("mentions the employee name and the one-line reply that registers 转正", () => {
    const text = buildProbationReminderText("张三");
    expect(text).toContain("张三 入职将满 3 个月");
    expect(text).toContain("尚未记录转正");
    expect(text).toContain("张三 试用期通过");
  });
});
