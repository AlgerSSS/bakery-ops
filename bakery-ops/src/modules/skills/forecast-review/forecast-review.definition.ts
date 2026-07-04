// forecast-review.definition.ts — 预测复盘（IMPROVEMENT-PLAN.md F6-②）。
//
// JOIN forecast_snapshot（生成时落的快照，见 forecast.service saveForecastSnapshot）
// × daily_sales_record（standard_name，别名风险小）
// × item_waste（scheduling；item_name 是 POS 名，需过 product_alias 匹配，匹配不上跳过并注明）
// × out_of_stock_record，输出昨日 建议 vs 实卖 vs 报废 vs 断货 偏差 Top5。
// 只读，不推送。【未注册】——统一由接线 agent 注册到 skills/index.ts。

import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { query } from "../../shared/db/postgres";

export const forecastReviewSkillDefinition: SkillDefinition = {
  skillId: "forecast_review",
  name: "预测复盘",
  description: "对比昨日预测快照与实际销售/报废/断货，输出偏差 Top5。支持：预测复盘/预测准不准",
  priority: 86,
  disambiguation: "复盘的是预测准确率（建议 vs 实卖偏差）；不是生成预估单(forecast_order)，也不是店长当日经营复盘(daily_review_chat)",
  triggerKeywords: ["预测复盘", "预测准不准"],
  examples: [
    "昨天预测准不准",
    "预测复盘",
  ],
  requiredInputs: [],
  optionalInputs: [],
  permissions: ["forecast.generate"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: false,
  supportsFiles: false,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};

// ========== 纯函数（单测覆盖） ==========

export interface ForecastDeviationItem {
  productName: string;
  suggestedQty: number;
  actualQty: number;
  /** 排产报废（已归一到标准品名） */
  wasteQty: number;
  wasteAmount: number;
  /** 断货时间，无断货为 null */
  soldoutTime: string | null;
  /** 实卖 - 建议 */
  deviation: number;
}

/**
 * item_waste 的 POS 名 → 标准品名：先查 product_alias，查不到再尝试与快照品名直接相等；
 * 都匹配不上则跳过该项并记入 unmatched（输出时注明）。
 */
export function matchWasteToProducts(
  wasteRows: Array<{ itemName: string; qty: number; amount: number }>,
  aliasMap: Record<string, string>,
  knownProducts: Set<string>
): { byProduct: Record<string, { qty: number; amount: number }>; unmatched: string[] } {
  const byProduct: Record<string, { qty: number; amount: number }> = {};
  const unmatched: string[] = [];
  for (const w of wasteRows) {
    const standard = aliasMap[w.itemName] ?? (knownProducts.has(w.itemName) ? w.itemName : null);
    if (!standard) {
      unmatched.push(w.itemName);
      continue;
    }
    const cur = byProduct[standard] ?? { qty: 0, amount: 0 };
    cur.qty += w.qty;
    cur.amount += w.amount;
    byProduct[standard] = cur;
  }
  return { byProduct, unmatched };
}

/** 以快照为基准合并四路数据，按 |实卖-建议| 降序。 */
export function computeForecastDeviations(
  snapshot: Array<{ productName: string; suggestedQty: number }>,
  salesByProduct: Record<string, number>,
  wasteByProduct: Record<string, { qty: number; amount: number }>,
  soldoutByProduct: Record<string, string>
): ForecastDeviationItem[] {
  const items: ForecastDeviationItem[] = snapshot.map((s) => {
    const actualQty = salesByProduct[s.productName] ?? 0;
    const waste = wasteByProduct[s.productName];
    return {
      productName: s.productName,
      suggestedQty: s.suggestedQty,
      actualQty,
      wasteQty: waste?.qty ?? 0,
      wasteAmount: waste?.amount ?? 0,
      soldoutTime: soldoutByProduct[s.productName] ?? null,
      deviation: actualQty - s.suggestedQty,
    };
  });
  return items.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
}

export function formatForecastReview(date: string, items: ForecastDeviationItem[], unmatchedWaste: string[]): string {
  const lines: string[] = [];
  lines.push(`📐 *预测复盘 ${date}*`);
  lines.push("建议 vs 实卖 vs 报废 vs 断货 · 偏差 Top5");
  lines.push("");
  const top5 = items.slice(0, 5);
  top5.forEach((it, i) => {
    const pct = it.suggestedQty > 0 ? `，${it.deviation >= 0 ? "+" : ""}${Math.round((it.deviation / it.suggestedQty) * 100)}%` : "";
    lines.push(`${i + 1}. ${it.productName}：建议 ${it.suggestedQty} / 实卖 ${it.actualQty}（${it.deviation >= 0 ? "+" : ""}${it.deviation}${pct}）`);
    const extras: string[] = [];
    if (it.wasteQty > 0 || it.wasteAmount > 0) extras.push(`报废 ${it.wasteQty}个 RM${it.wasteAmount}`);
    if (it.soldoutTime) extras.push(`🚫 ${it.soldoutTime} 断货`);
    if (extras.length > 0) lines.push(`   ${extras.join(" ｜ ")}`);
  });
  if (unmatchedWaste.length > 0) {
    lines.push("");
    lines.push(`⚠️ ${unmatchedWaste.length} 项报废记录无法匹配产品（缺 product_alias），已跳过：${unmatchedWaste.join("、")}`);
  }
  return lines.join("\n");
}

// ========== Handler ==========

export class ForecastReviewSkillHandler implements SkillHandler {
  async execute(_input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const date = dayjs().subtract(1, "day").format("YYYY-MM-DD");
    try {
      const [snapshotRows, salesRows, wasteRows, aliasRows, stockoutRows] = await Promise.all([
        query<{ product_name: string; suggested_qty: number }>(
          "SELECT product_name, suggested_qty FROM forecast_snapshot WHERE date = ?", [date]
        ),
        query<{ product_name: string; qty: string | number }>(
          "SELECT standard_name AS product_name, SUM(quantity) AS qty FROM daily_sales_record WHERE date = ? AND standard_name IS NOT NULL GROUP BY standard_name", [date]
        ),
        query<{ item_name: string; qty: string | number; amount: string | number }>(
          "SELECT item_name, SUM(qty) AS qty, SUM(amount) AS amount FROM item_waste WHERE date = ? AND waste_reason = 'scheduling' GROUP BY item_name", [date]
        ),
        query<{ alias: string; standard_name: string }>("SELECT alias, standard_name FROM product_alias"),
        query<{ product_name: string; soldout_time: string }>(
          "SELECT product_name, soldout_time FROM out_of_stock_record WHERE date = ?", [date]
        ),
      ]);

      if (snapshotRows.length === 0) {
        return {
          runId: uuidv4(),
          skillId: "forecast_review",
          status: "success",
          summary: `📐 ${date} 无预测快照，无法复盘。快照从生成预估单时开始记录，明天再试。`,
        };
      }

      const salesByProduct: Record<string, number> = {};
      for (const r of salesRows) salesByProduct[r.product_name] = Number(r.qty) || 0;

      const aliasMap: Record<string, string> = {};
      for (const r of aliasRows) aliasMap[r.alias] = r.standard_name;

      const knownProducts = new Set(snapshotRows.map((r) => r.product_name));
      const { byProduct: wasteByProduct, unmatched } = matchWasteToProducts(
        wasteRows.map((r) => ({ itemName: r.item_name, qty: Math.round(Number(r.qty) || 0), amount: Math.round(Number(r.amount) || 0) })),
        aliasMap,
        knownProducts
      );

      const soldoutByProduct: Record<string, string> = {};
      for (const r of stockoutRows) soldoutByProduct[r.product_name] = r.soldout_time;

      const items = computeForecastDeviations(
        snapshotRows.map((r) => ({ productName: r.product_name, suggestedQty: Number(r.suggested_qty) || 0 })),
        salesByProduct,
        wasteByProduct,
        soldoutByProduct
      );

      return {
        runId: uuidv4(),
        skillId: "forecast_review",
        status: "success",
        summary: formatForecastReview(date, items, unmatched),
      };
    } catch (err) {
      return {
        runId: uuidv4(),
        skillId: "forecast_review",
        status: "error",
        summary: `预测复盘失败：${err instanceof Error ? err.message : String(err)}`,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
