// kol-collab — KOL 合作跟踪与效果复盘（IMPROVEMENT-PLAN.md F16/F17）。
// 指令：
//   合作 @handle 确认 500 7月10日   → confirmed + deal_amount + scheduled_at
//   合作 @handle 完成 / 放弃        → completed / declined + completed_at
//   合作列表                        → 按状态分组列出
//   合作效果 @handle                → 档期前后 7 天营业额/单数/客单价对比 + 粗 ROI + 涨幅 Top3 单品
// 注意：本 skill 尚未注册（由接线 agent 统一注册 skillId=kol_collab）。
import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { query } from "../../shared/db/postgres";
import { kolRepository } from "../../data/repositories/kol.repository";
import { kolCollaborationRepository } from "../../data/repositories/kol-collaboration.repository";
import type { KOLCollaborationRow } from "../../domain/marketing/types";
import { logger } from "../../shared/logger";

export const kolCollabSkillDefinition: SkillDefinition = {
  skillId: "kol_collab",
  name: "KOL合作跟踪",
  description:
    "跟踪 KOL 合作进度与效果。指令：「合作 @handle 确认 500 7月10日」「合作 @handle 完成/放弃」" +
    "「合作列表」「合作效果 @handle」",
  priority: 83,
  disambiguation: "跟踪/确认/复盘已有博主合作（确认金额档期、完成放弃、列表、效果）；不是找博主(kol_discovery)也不是发邀请文案(kol_outreach)",
  triggerKeywords: ["合作列表", "合作"],
  examples: [
    "合作 @foodlover_kl 确认 500 7月10日",
    "合作 @foodlover_kl 完成",
    "合作列表",
    "合作效果 @foodlover_kl",
  ],
  requiredInputs: [
    { name: "text", type: "string", description: "合作跟踪指令" },
  ],
  optionalInputs: [],
  permissions: ["marketing.use"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: false,
  supportsFiles: false,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};

// ============ 指令解析（导出便于单测） ============

export type CollabCommand =
  | { type: "confirm"; handle: string; amount: number; scheduledDate: string | null }
  | { type: "complete"; handle: string }
  | { type: "decline"; handle: string }
  | { type: "list" }
  | { type: "effect"; handle: string }
  | null;

/** "X月X日/号" → YYYY-MM-DD（当前年份；F16 先支持这一种格式）。 */
export function parseChineseDate(text: string, today = dayjs()): string | null {
  const m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (!m) return null;
  const month = parseInt(m[1]);
  const day = parseInt(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return today.year() + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

export function parseCollabCommand(text: string): CollabCommand {
  const t = text.trim();

  const effectMatch = t.match(/合作效果\s*@?([a-zA-Z0-9_.]+)/);
  if (effectMatch) return { type: "effect", handle: effectMatch[1] };

  if (/合作列表/.test(t)) return { type: "list" };

  const confirmMatch = t.match(/合作\s*@?([a-zA-Z0-9_.]+)\s*确认\s*(\d+(?:\.\d+)?)\s*(?:块|元|rm)?/i);
  if (confirmMatch) {
    return {
      type: "confirm",
      handle: confirmMatch[1],
      amount: parseFloat(confirmMatch[2]),
      scheduledDate: parseChineseDate(t),
    };
  }

  const doneMatch = t.match(/合作\s*@?([a-zA-Z0-9_.]+)\s*(完成|放弃)/);
  if (doneMatch) {
    return { type: doneMatch[2] === "完成" ? "complete" : "decline", handle: doneMatch[1] };
  }

  return null;
}

// ============ Handler ============

const STATUS_LABELS: Record<string, string> = {
  prospected: "待联系",
  contacted: "已联系",
  negotiating: "洽谈中",
  confirmed: "已确认",
  completed: "已完成",
  declined: "已放弃",
};
const STATUS_ORDER = ["negotiating", "confirmed", "contacted", "prospected", "completed", "declined"];

export class KOLCollabSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const text = String(input.input.text || "");
    const cmd = parseCollabCommand(text);

    try {
      if (!cmd) {
        return this.reply("error",
          "没看懂这条合作指令。支持：\n" +
          "  合作 @handle 确认 500 7月10日\n" +
          "  合作 @handle 完成 / 放弃\n" +
          "  合作列表\n" +
          "  合作效果 @handle");
      }

      switch (cmd.type) {
        case "confirm": return await this.confirm(cmd.handle, cmd.amount, cmd.scheduledDate);
        case "complete": return await this.close(cmd.handle, "completed");
        case "decline": return await this.close(cmd.handle, "declined");
        case "list": return await this.list();
        case "effect": return await this.effect(cmd.handle);
      }
    } catch (err) {
      logger.error("KOL collab skill failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "kol_collab",
        status: "error",
        summary: `合作跟踪失败: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    }
  }

  private reply(status: "success" | "error", summary: string): SkillExecutionResult {
    return { runId: uuidv4(), skillId: "kol_collab", status, summary };
  }

  private async latestCollab(kolId: string): Promise<KOLCollaborationRow | null> {
    const collabs = await kolCollaborationRepository.getByKOLId(kolId);
    return collabs[0] ?? null;
  }

  /** F16: 合作 @handle 确认 500 7月10日 */
  private async confirm(handle: string, amount: number, scheduledDate: string | null): Promise<SkillExecutionResult> {
    const kol = await kolRepository.getByHandleAnyPlatform(handle);
    if (!kol) return this.reply("error", `没找到博主 @${handle}，请检查 handle 或先添加。`);

    let collab = await this.latestCollab(kol.id);
    if (!collab) {
      collab = await kolCollaborationRepository.create({ kol_id: kol.id, status: "confirmed" });
      if (!collab) return this.reply("error", `创建 @${handle} 的合作记录失败，请稍后重试。`);
    }

    const extra: Record<string, unknown> = { deal_amount: amount };
    if (scheduledDate) extra.scheduled_at = dayjs(scheduledDate).toISOString();
    await kolCollaborationRepository.updateStatus(collab.id, "confirmed", extra);

    return this.reply("success",
      `已确认与 @${kol.platform_handle} 的合作：金额 RM${amount}` +
      (scheduledDate ? `，档期 ${scheduledDate}` : `（未填档期，可再发「合作 @${handle} 确认 金额 X月X日」补上）`) +
      `。到店/发布后回「合作 @${kol.platform_handle} 完成」。`);
  }

  /** F16: 合作 @handle 完成 / 放弃 */
  private async close(handle: string, status: "completed" | "declined"): Promise<SkillExecutionResult> {
    const kol = await kolRepository.getByHandleAnyPlatform(handle);
    if (!kol) return this.reply("error", `没找到博主 @${handle}，请检查 handle 或先添加。`);

    const collab = await this.latestCollab(kol.id);
    if (!collab) {
      return this.reply("error", `@${handle} 还没有合作记录。先用「合作 @${handle} 确认 金额 X月X日」登记。`);
    }

    await kolCollaborationRepository.updateStatus(collab.id, status, {
      completed_at: new Date().toISOString(),
    });

    return this.reply("success",
      status === "completed"
        ? `已标记 @${kol.platform_handle} 的合作为完成。之后可发「合作效果 @${kol.platform_handle}」看前后对比。`
        : `已标记 @${kol.platform_handle} 的合作为放弃。`);
  }

  /** F16: 合作列表 —— getRecent + 内存按状态分组 */
  private async list(): Promise<SkillExecutionResult> {
    const collabs = await kolCollaborationRepository.getRecent(50);
    if (collabs.length === 0) {
      return this.reply("success", "还没有任何合作记录。用「联系KOL」生成触达文案，或「合作 @handle 确认 金额 X月X日」直接登记。");
    }

    // handle 查询去重缓存
    const handleCache = new Map<string, string>();
    const handleOf = async (kolId: string): Promise<string> => {
      if (!handleCache.has(kolId)) {
        const kol = await kolRepository.getById(kolId);
        handleCache.set(kolId, kol ? kol.platform_handle : kolId.slice(0, 8));
      }
      return handleCache.get(kolId)!;
    };

    const grouped = new Map<string, KOLCollaborationRow[]>();
    for (const c of collabs) {
      const list = grouped.get(c.status) ?? [];
      list.push(c);
      grouped.set(c.status, list);
    }

    const today = dayjs().startOf("day");
    const lines: string[] = ["━━━ 合作列表 ━━━"];
    for (const status of STATUS_ORDER) {
      const items = grouped.get(status);
      if (!items || items.length === 0) continue;
      lines.push("", `【${STATUS_LABELS[status] ?? status}】${items.length} 个`);
      for (const c of items) {
        const handle = await handleOf(c.kol_id);
        const parts = [`  • @${handle}`];
        if (c.deal_amount != null) parts.push(`RM${c.deal_amount}`);
        if (c.scheduled_at) {
          const sched = dayjs(c.scheduled_at).startOf("day");
          const diff = sched.diff(today, "day");
          const rel = diff > 0 ? `还有${diff}天` : diff === 0 ? "今天" : `已过${-diff}天`;
          parts.push(`档期 ${sched.format("MM-DD")}(${rel})`);
        } else {
          parts.push(`跟进${today.diff(dayjs(c.created_at).startOf("day"), "day")}天`);
        }
        lines.push(parts.join(" — "));
      }
    }

    return this.reply("success", lines.join("\n"));
  }

  /** F17: 合作效果 @handle —— 基准日前 7 天 vs 后 7 天（含基准日） */
  private async effect(handle: string): Promise<SkillExecutionResult> {
    const kol = await kolRepository.getByHandleAnyPlatform(handle);
    if (!kol) return this.reply("error", `没找到博主 @${handle}，请检查 handle 或先添加。`);

    const collabs = await kolCollaborationRepository.getByKOLId(kol.id);
    const target = collabs.find((c) => c.status === "confirmed" || c.status === "completed");
    if (!target) {
      return this.reply("error",
        `@${handle} 还没有已确认/完成的合作记录，无法对账。先用「合作 @${handle} 确认 金额 X月X日」登记。`);
    }

    const baseRaw = target.scheduled_at || target.completed_at;
    if (!baseRaw) {
      return this.reply("error",
        `@${handle} 的合作没有档期/完成时间，无法定基准日。用「合作 @${handle} 确认 金额 X月X日」补档期。`);
    }

    const base = dayjs(baseRaw).startOf("day");
    const beforeStart = base.subtract(7, "day").format("YYYY-MM-DD");
    const beforeEnd = base.subtract(1, "day").format("YYYY-MM-DD");
    const afterStart = base.format("YYYY-MM-DD");
    const afterEnd = base.add(6, "day").format("YYYY-MM-DD");

    const revRows = await query<{ date: string; revenue: number; transaction_count: number | null; avg_transaction_value: number | null }>(
      "SELECT date, revenue, transaction_count, avg_transaction_value FROM daily_revenue WHERE date >= ? AND date <= ? ORDER BY date",
      [beforeStart, afterEnd],
    );
    const before = revRows.filter((r) => r.date <= beforeEnd);
    const after = revRows.filter((r) => r.date >= afterStart);

    if (before.length === 0 || after.length === 0) {
      return this.reply("success",
        `━━━ 合作效果 @${kol.platform_handle} ━━━\n` +
        `基准日: ${afterStart}\n` +
        `${before.length === 0 ? "基准日前 7 天" : "基准日起 7 天"}还没有营业数据，暂时对不了账（档期未到或数据未回传）。`);
    }

    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
    const pct = (from: number, to: number) =>
      from > 0 ? `${to >= from ? "+" : ""}${(((to - from) / from) * 100).toFixed(1)}%` : "N/A";

    const bRev = avg(before.map((r) => r.revenue));
    const aRev = avg(after.map((r) => r.revenue));
    const bTx = avg(before.filter((r) => r.transaction_count != null).map((r) => r.transaction_count!));
    const aTx = avg(after.filter((r) => r.transaction_count != null).map((r) => r.transaction_count!));
    const bAtv = avg(before.filter((r) => r.avg_transaction_value != null).map((r) => r.avg_transaction_value!));
    const aAtv = avg(after.filter((r) => r.avg_transaction_value != null).map((r) => r.avg_transaction_value!));

    const lines: string[] = [
      `━━━ 合作效果 @${kol.platform_handle} ━━━`,
      `基准日: ${afterStart}（${target.scheduled_at ? "档期" : "完成日"}）｜状态: ${STATUS_LABELS[target.status] ?? target.status}`,
      `前 ${before.length} 天 vs 后 ${after.length} 天（含基准日）:`,
      `- 日均营业额: ${bRev.toFixed(0)} → ${aRev.toFixed(0)} (${pct(bRev, aRev)})`,
      `- 日均单数: ${bTx > 0 ? bTx.toFixed(0) : "N/A"} → ${aTx > 0 ? aTx.toFixed(0) : "N/A"} (${pct(bTx, aTx)})`,
      `- 客单价: ${bAtv > 0 ? bAtv.toFixed(2) : "N/A"} → ${aAtv > 0 ? aAtv.toFixed(2) : "N/A"} (${pct(bAtv, aAtv)})`,
    ];

    // 粗 ROI：后 7 天总营收增量 / 合作花费
    if (target.deal_amount != null && Number(target.deal_amount) > 0) {
      const dealAmount = Number(target.deal_amount);
      // 用日均差 × 后窗口天数估增量，避免前后窗口天数不等失真
      const uplift = (aRev - bRev) * after.length;
      lines.push(
        `- 粗 ROI: 增量营收 ≈ RM${uplift.toFixed(0)} / 花费 RM${dealAmount} = ${(uplift / dealAmount).toFixed(1)}x`,
      );
    }

    // 后 7 天涨幅 Top3 单品
    const sumByName = async (start: string, end: string): Promise<Map<string, number>> => {
      const rows = await query<{ standard_name: string; qty: number }>(
        "SELECT standard_name, SUM(quantity) AS qty FROM daily_sales_record WHERE date >= ? AND date <= ? GROUP BY standard_name",
        [start, end],
      );
      return new Map(rows.map((r) => [r.standard_name, Number(r.qty)]));
    };
    const beforeQty = await sumByName(beforeStart, beforeEnd);
    const afterQty = await sumByName(afterStart, afterEnd);

    const growth = [...afterQty.entries()]
      .map(([name, aq]) => ({ name, before: beforeQty.get(name) ?? 0, after: aq, diff: aq - (beforeQty.get(name) ?? 0) }))
      .filter((g) => g.diff > 0)
      .sort((x, y) => y.diff - x.diff)
      .slice(0, 3);

    if (growth.length > 0) {
      lines.push(`后 7 天涨幅 Top${growth.length} 单品:`);
      growth.forEach((g, i) => {
        const gp = g.before > 0 ? ` (+${((g.diff / g.before) * 100).toFixed(0)}%)` : "";
        lines.push(`  ${i + 1}. ${g.name}: ${g.before} → ${g.after}，+${g.diff}${gp}`);
      });
    } else {
      lines.push("后 7 天无明显上涨单品。");
    }

    lines.push("", "注: 单店 7 天归因噪音大，以上仅作参考，不是结论。");
    return this.reply("success", lines.join("\n"));
  }
}
