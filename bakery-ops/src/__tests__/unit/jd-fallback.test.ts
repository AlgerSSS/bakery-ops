// jd-fallback.test.ts
//
// Locks in the AI-failure fallback behavior of jd-generator / jd-parser:
// when aiProvider throws, both fall back to a keyword→English mapping over
// the same set of Chinese keys (values differ on purpose: job title vs
// search keyword).

import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/domain/ai/ai-provider", () => ({
  aiProvider: {
    chatCompletionLong: vi.fn().mockRejectedValue(new Error("ai down")),
  },
}));

import { generateJobDescription } from "@/modules/domain/recruitment/jd-generator";
import { parseJD } from "@/modules/domain/recruitment/jd-parser";

describe("generateJobDescription fallback (aiProvider failure)", () => {
  it("maps Chinese keywords to English job titles", async () => {
    expect((await generateJobDescription("招聘收银员一名")).title).toBe("Cashier");
    expect((await generateJobDescription("需要烘焙人员")).title).toBe("Bakery Staff");
    expect((await generateJobDescription("找蛋糕裱花")).title).toBe("Pastry Chef");
  });

  it("returns Staff and default fields when no keyword matches", async () => {
    const jd = await generateJobDescription("急聘，待遇优");
    expect(jd.title).toBe("Staff");
    expect(jd.location).toBe("Kuala Lumpur, Selangor");
    expect(jd.jobType).toBe("full_time");
    expect(jd.languageRequirements).toEqual(["Mandarin"]);
  });
});

describe("parseJD fallback (aiProvider failure)", () => {
  it("maps Chinese keywords to English search keywords", async () => {
    expect((await parseJD("招聘收银员一名")).jobTitle).toBe("cashier");
    expect((await parseJD("需要烘焙人员")).jobTitle).toBe("bakery");
    expect((await parseJD("找蛋糕裱花")).jobTitle).toBe("pastry");
  });

  it("returns staff and default fields when no keyword matches", async () => {
    const parsed = await parseJD("急聘，待遇优");
    expect(parsed.jobTitle).toBe("staff");
    expect(parsed.location).toBe("Kuala Lumpur");
    expect(parsed.jobType).toBe("full_time");
    expect(parsed.rawText).toBe("急聘，待遇优");
  });
});
