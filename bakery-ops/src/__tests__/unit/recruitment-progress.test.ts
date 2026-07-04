// recruitment-progress.test.ts — F10 招聘进展指令的单元测试：
//   (a) application.repository countByStage / countRecentApplications（mock db query）
//   (b) buildProgressText / buildBackupPoolText 纯模板（STAGE_TO_LARK 标签 + 自备标签）

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/shared/db/postgres", () => ({
  query: vi.fn(),
  execute: vi.fn(),
}));

import { query } from "@/modules/shared/db/postgres";
import { applicationRepository, type ApplicationRow } from "@/modules/data/repositories/application.repository";
import {
  buildProgressText,
  stageLabel,
} from "@/modules/skills/recruitment-progress/recruitment-progress.definition";
import { buildBackupPoolText } from "@/modules/skills/backup-pool/backup-pool.definition";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("application.repository.countByStage", () => {
  it("maps GROUP BY rows to a stage->count record", async () => {
    (query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { stage: "new", count: 3 },
      { stage: "contacting", count: 2 },
      { stage: "hired", count: 1 },
    ]);
    const counts = await applicationRepository.countByStage("pavilion");
    expect(counts).toEqual({ new: 3, contacting: 2, hired: 1 });
    const [sql, params] = (query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toMatch(/GROUP BY stage/);
    expect(params).toEqual(["pavilion"]);
  });

  it("returns {} when the query fails", async () => {
    (query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    expect(await applicationRepository.countByStage("pavilion")).toEqual({});
  });
});

describe("application.repository.countRecentApplications", () => {
  it("returns the count for the last N days", async () => {
    (query as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: 4 }]);
    expect(await applicationRepository.countRecentApplications("pavilion", 7)).toBe(4);
    const [, params] = (query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params).toEqual(["pavilion", 7]);
  });

  it("returns 0 on empty result or query failure", async () => {
    (query as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    expect(await applicationRepository.countRecentApplications("pavilion", 7)).toBe(0);
    (query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    expect(await applicationRepository.countRecentApplications("pavilion", 7)).toBe(0);
  });
});

describe("recruitment-progress: stage labels + funnel template", () => {
  it("uses STAGE_TO_LARK labels and self-provided labels for the null-mapped stages", () => {
    expect(stageLabel("contacting")).toBe("①联系约面");
    expect(stageLabel("hired")).toBe("已入职");
    expect(stageLabel("rejected")).toBe("已淘汰");
    expect(stageLabel("backup_pool")).toBe("备选池");
    // null-mapped in STAGE_TO_LARK -> self-provided labels
    expect(stageLabel("new")).toBe("新申请");
    expect(stageLabel("opted_out")).toBe("已退出");
    expect(stageLabel("no_show")).toBe("爽约");
  });

  it("renders the funnel in one message with zero-fill for absent stages", () => {
    const text = buildProgressText({
      storeName: "Pavilion",
      counts: { new: 3, contacting: 2, first_interview: 1, hired: 1, rejected: 2 },
      recentCount: 4,
    });
    expect(text).toContain("招聘进展（Pavilion）");
    expect(text).toContain("新申请 3 → ①联系约面 2 → ②初面 1");
    expect(text).toContain("③试工 0"); // absent stage zero-filled
    expect(text).toContain("已入职 1");
    expect(text).toContain("已淘汰 2 ｜ 备选池 0 ｜ 已退出 0 ｜ 爽约 0");
    expect(text).toContain("本周新增申请：4");
  });
});

describe("backup-pool: template", () => {
  const row = (over: Partial<ApplicationRow> = {}): ApplicationRow =>
    ({
      id: "app_1",
      store_id: "pavilion",
      contact_status: "ready",
      stage: "backup_pool",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-20T10:00:00Z",
      ...over,
    }) as ApplicationRow;

  it("lists 姓名/前场后厨/入池日期/电话 and ends with the manual-contact hint", () => {
    const text = buildBackupPoolText([
      row({ name: "张三", role_area: "FOH", phone: "60123456789" }),
      row({ id: "app_2", name: "李四", role_area: "BOH", phone: "60198765432", updated_at: "2026-06-25T08:00:00Z" }),
    ]);
    expect(text).toContain("备选池（2 人）");
    expect(text).toContain("1. 张三 ｜ 前场 ｜ 2026-06-20 ｜ 60123456789");
    expect(text).toContain("2. 李四 ｜ 后厨 ｜ 2026-06-25 ｜ 60198765432");
    expect(text).toContain("如需启用，请人工联系候选人。");
  });

  it("empty pool -> friendly empty message", () => {
    expect(buildBackupPoolText([])).toBe("👥 备选池暂无候选人。");
  });
});
