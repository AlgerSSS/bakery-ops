import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import {
  getProductForecast,
  getDailyRevenue,
  getLatestReview,
  formatForecastText,
  formatForecastCompact,
  formatRevenueText,
  generateFullForecast,
} from "../../domain/forecast/forecast.service";
import { buildForecastExcelBuffer } from "../../domain/forecast/forecast-excel";
import { getTimeslotSalesRecords, getFixedShipmentSchedules, getProducts } from "../../data/repositories/forecast.repository";
import { fileService } from "../../domain/files/file-service";
import { query } from "../../shared/db/postgres";
import dayjs from "dayjs";

export const forecastOrderSkillDefinition: SkillDefinition = {
  skillId: "forecast_order",
  name: "预估单",
  description: "生成营业额目标、单品出货建议、分时段排产。支持：预估/排产/出货建议/营业额查询",
  priority: 85,
  disambiguation: "生成营业额目标与出货/排产预估；不是据此生成后厨执行计划(kitchen_production_plan)，也不是结合实际销售的每日复盘(daily_review_chat)",
  triggerKeywords: [
    "预估单", "排产", "出货", "出货建议", "预测",
    "营业额目标", "日目标", "月目标", "单品建议",
    "时段排产", "分时段", "营业额",
    "发预估单", "导出", "excel", "表格", "发表格",
  ],
  examples: [
    "明天出什么",
    "预估明天",
    "今天营业额多少",
    "后天排产",
  ],
  requiredInputs: [],
  optionalInputs: [
    { name: "targetDate", type: "date", description: "目标日期，默认明天" },
    { name: "queryType", type: "enum", description: "查询类型", enumValues: ["forecast", "revenue", "review"] },
  ],
  permissions: ["forecast.generate"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: false,
  supportsFiles: true,
  supportsCron: false,
  outputTypes: ["text", "excel"],
  handler: null,
};

export class ForecastOrderSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const text = (input.input.text as string) || "";
    const lower = text.toLowerCase();

    // Determine what the user wants
    let queryType = (input.input.queryType as string) || "";
    let targetDate = (input.input.targetDate as string) || (input.input.date as string) || "";

    // 文字里明确要「预估单/表格/excel/导出」→ 一律给填好的 Excel 附件（优先级最高，
    // 覆盖 LLM 路由给的 queryType；summary 再带一段文字摘要）。用户 2026-07-05 定案。
    if (lower.includes("excel") || lower.includes("表格") || lower.includes("导出") || lower.includes("预估单") || lower.includes("发表格")) {
      queryType = "excel";
    } else if (!queryType) {
      // 其余按文字自动判断
      if (lower.includes("营业额") || lower.includes("业绩") || lower.includes("销售")) {
        queryType = "revenue";
      } else if (lower.includes("复盘") || lower.includes("总结") || lower.includes("review")) {
        queryType = "review";
      } else {
        queryType = "forecast";
      }
    }

    // Parse date from text or normalize non-standard targetDate (e.g. "5.10", "5/10")
    if (!targetDate) {
      targetDate = parseDateFromText(text);
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      // targetDate is non-standard (e.g. "5.10" from LLM), try to parse it
      targetDate = parseDateFromText(targetDate) || parseDateFromText(text);
    }

    try {
      if (queryType === "excel") {
        const date = targetDate || dayjs().add(1, "day").format("YYYY-MM-DD");
        const forecast = await getProductForecast(date);

        // Build DailyTarget shape from forecast output
        const dow = dayjs(date).day();
        const dayTypeMap: Record<string, "mondayToThursday" | "friday" | "weekend"> = {
          "周一至周四": "mondayToThursday", "周五": "friday", "周末": "weekend",
        };
        const dailyTarget = {
          date,
          dayOfWeek: dow,
          dayType: dayTypeMap[forecast.dayType] ?? "mondayToThursday",
          baseWeight: 1,
          weight: 1,
          revenue: forecast.targetRevenue,
          shipmentAmount: forecast.targetShipment,
        };

        const [timeslotRecords, fixedSchedule, products] = await Promise.all([
          getTimeslotSalesRecords(),
          getFixedShipmentSchedules(),
          getProducts(),
        ]);

        const productSuggestions = forecast.products.map((p) => ({
          productName: p.name,
          price: p.price,
          packMultiple: p.packMultiple,
          unitType: "batch" as const,
          baselineQuantity: p.baselineQty,
          suggestedQuantity: p.suggestedQty,
          roundedQuantity: p.suggestedQty,
          totalAmount: p.totalAmount,
          positioning: p.positioning,
          coldHot: p.coldHot,
          displayFullQuantity: products.find((pr) => pr.name === p.name)?.displayFullQuantity ?? 0,
        }));

        // 上周同日销量(中文名，经 name_en↔POS 归一化连接)，填「上周销售」列
        const lwDate = dayjs(date).subtract(7, "day").format("YYYY-MM-DD");
        const lwRows = await query<{ cn: string; q: number }>(
          `SELECT p.name AS cn, SUM(s.qty)::int AS q FROM item_hourly_sales s
             JOIN product p ON lower(btrim(regexp_replace(p.name_en,'[[:space:]]+',' ','g')))
                             = lower(btrim(regexp_replace(s.item_name,'[[:space:]]+',' ','g')))
            WHERE s.date = $1 GROUP BY p.name`,
          [lwDate],
        );
        const lastWeekSales = new Map(lwRows.map((r) => [r.cn, Number(r.q)]));

        const buf = await buildForecastExcelBuffer({
          date,
          dailyTarget,
          productSuggestions,
          timeSlotSuggestions: forecast.timeSlots,
          timeslotSalesRecords: timeslotRecords,
          fixedSchedule,
          products,
          lastWeekSales,
        });

        const outputFile = await fileService.saveFile(
          buf,
          `排产预估单_${date}.xlsx`,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        return {
          runId: uuidv4(),
          skillId: "forecast_order",
          status: "success",
          summary: `${formatForecastCompact(forecast)}\n\n📎 完整排产预估单 Excel 见附件（${date}）`,
          files: [outputFile],
        };
      }

      if (queryType === "revenue") {
        // Revenue query — default to yesterday if no specific date
        const date = targetDate || dayjs().subtract(1, "day").format("YYYY-MM-DD");
        const [revenue, review] = await Promise.all([
          getDailyRevenue(date),
          getLatestReview(),
        ]);
        const summary = formatRevenueText(date, revenue, review);
        return { runId: uuidv4(), skillId: "forecast_order", status: "success", summary };
      }

      if (queryType === "review") {
        const review = await getLatestReview();
        if (!review) {
          return { runId: uuidv4(), skillId: "forecast_order", status: "success", summary: "暂无昨日复盘数据。请先在网页端完成复盘。" };
        }
        const lines: string[] = [];
        lines.push(`📝 *${review.date} 复盘*`);
        lines.push("");
        lines.push(review.summary);
        if (review.highlights.length > 0) {
          lines.push("");
          lines.push("*亮点*");
          review.highlights.forEach((h) => lines.push(`  ✅ ${h}`));
        }
        if (review.painPoints.length > 0) {
          lines.push("");
          lines.push("*问题*");
          review.painPoints.forEach((p) => lines.push(`  ⚠️ ${p}`));
        }
        if (review.suggestions) {
          lines.push("");
          lines.push(`💡 *明日建议*：${review.suggestions}`);
        }
        return { runId: uuidv4(), skillId: "forecast_order", status: "success", summary: lines.join("\n") };
      }

      // Default: forecast
      const date = targetDate || dayjs().add(1, "day").format("YYYY-MM-DD");
      const forecast = await getProductForecast(date);

      // Compact format by default, full format if user asks for details
      const isCompact = !(lower.includes("详细") || lower.includes("全") || lower.includes("全部") || lower.includes("时段"));
      const summary = isCompact ? formatForecastCompact(forecast) : formatForecastText(forecast);

      return { runId: uuidv4(), skillId: "forecast_order", status: "success", summary };
    } catch (err) {
      return {
        runId: uuidv4(),
        skillId: "forecast_order",
        status: "error",
        summary: `预估单生成失败：${err instanceof Error ? err.message : String(err)}`,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ========== Date Parsing ==========
function parseDateFromText(text: string): string {
  const today = dayjs();
  const lower = text.toLowerCase();

  if (lower.includes("今天") || lower.includes("今日") || lower.includes("today")) {
    return today.format("YYYY-MM-DD");
  }
  if (lower.includes("明天") || lower.includes("明日") || lower.includes("tomorrow")) {
    return today.add(1, "day").format("YYYY-MM-DD");
  }
  if (lower.includes("后天") || lower.includes("后天")) {
    return today.add(2, "day").format("YYYY-MM-DD");
  }
  if (lower.includes("昨天") || lower.includes("昨日") || lower.includes("yesterday")) {
    return today.subtract(1, "day").format("YYYY-MM-DD");
  }

  // Match patterns like "5月8日", "5/8", "5.10", "2026-05-08"
  const datePatterns = [
    /(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /(\d{1,2})\/(\d{1,2})/,
    /(\d{1,2})\.(\d{1,2})/,
    /(\d{4})-(\d{1,2})-(\d{1,2})/,
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      let year = today.year();
      let month: number;
      let day: number;

      if (match.length === 4) {
        // YYYY-MM-DD
        year = parseInt(match[1]);
        month = parseInt(match[2]);
        day = parseInt(match[3]);
      } else {
        // M月D日 or M/D
        month = parseInt(match[1]);
        day = parseInt(match[2]);
      }

      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const parsed = dayjs(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
        if (parsed.isValid()) return parsed.format("YYYY-MM-DD");
      }
    }
  }

  return "";
}
