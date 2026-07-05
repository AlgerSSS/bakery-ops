import dayjs from "dayjs";
import {
  calculateMonthlyTargets,
  calculateDailyTargets,
  calculateSalesBaselines,
  calculateProductSuggestions,
  calculateTimeSlotSuggestions,
  selectDefaultTimeSlots,
} from "./forecast-engine";
import {
  getBusinessRulesFromDB,
  getPlanningRulesFromDB,
  getProducts,
  getStrategies,
  getSalesBaselines,
  getTimeslotSalesRecords,
  getDailyRevenues,
  getDailySalesTotal,
  getDailyReview as getReviewFromDB,
  getAIDailyCorrections,
  getHourlyBillCurve,
} from "@/modules/data/repositories/forecast.repository";
import { query, execute } from "@/modules/shared/db/postgres";
import { computeDataDrivenTarget, type DataDrivenTarget } from "./data-driven-target";
import { getProductSalesStats } from "./product-demand";
import { logger } from "@/modules/shared/logger";
import type {
  MonthlyTarget,
  DailyTarget,
  ProductSuggestion,
  TimeSlotSuggestion,
} from "./types";
import { DAY_TYPE_LABELS, DOW_LABELS } from "./constants";

// ========== AI Correction Helper (G2-②) ==========
/** AI_CORRECTION_APPLY=true 时读取当月已采纳的 AI 修正系数；否则返回 undefined（零行为变化）。 */
async function getAICorrectionsIfEnabled(year: number, month: number): Promise<Record<string, number> | undefined> {
  if (process.env.AI_CORRECTION_APPLY !== "true") return undefined;
  try {
    const map = await getAIDailyCorrections(year, month);
    return Object.keys(map).length > 0 ? map : undefined;
  } catch (error) {
    logger.warn("forecast.service getAICorrectionsIfEnabled failed, skipping AI corrections", { error: String(error) });
    return undefined;
  }
}

// ========== Default Timeslot Helper (G5-3) ==========
/** 近 4 周同日型客流曲线 → 默认上架时段（top 2 小时）；查询失败或无数据回落 ["11:00"]。 */
async function getDefaultSlotsForDayType(
  dayType: "mondayToThursday" | "friday" | "weekend"
): Promise<string[]> {
  try {
    const curve = await getHourlyBillCurve(dayType);
    return selectDefaultTimeSlots(curve);
  } catch (error) {
    logger.warn("forecast.service getDefaultSlotsForDayType failed, falling back to 11:00", { error: String(error) });
    return ["11:00"];
  }
}

// ========== Forecast Snapshot (F6-②) ==========
/**
 * 生成时落快照（必须生成时落，不能事后重算——baseline 每晚滚动更新）。
 * ON CONFLICT 覆盖当日最后一版；失败只 logger.warn，绝不阻塞预估单生成。
 */
export async function saveForecastSnapshot(
  date: string,
  products: Array<{ name: string; suggestedQty: number }>
): Promise<void> {
  try {
    if (products.length === 0) return;
    const placeholders = products.map(() => "(?, ?, ?)").join(",");
    const flat = products.flatMap((p) => [date, p.name, p.suggestedQty]);
    await execute(
      `INSERT INTO forecast_snapshot (date, product_name, suggested_qty) VALUES ${placeholders}
       ON CONFLICT (date, product_name) DO UPDATE SET suggested_qty = EXCLUDED.suggested_qty, created_at = NOW()`,
      flat
    );
  } catch (error) {
    logger.warn("forecast.service saveForecastSnapshot failed (non-blocking)", { date, error: String(error) });
  }
}

// ========== Scheduling Waste Alerts (F7-①) ==========
/**
 * 近 7 天 scheduling 报废累计金额超阈值（env WASTE_WARN_RM 默认 100）的单品 → { 标准品名: 金额 }。
 * item_waste.item_name 是 POS 名，经 product_alias 归一到标准名。失败返回 undefined（只提示不改数，绝不阻塞）。
 */
async function getSchedulingWasteAlerts(): Promise<Record<string, number> | undefined> {
  const threshold = Number(process.env.WASTE_WARN_RM) || 100;
  try {
    const rows = await query<{ name: string; total: string | number }>(
      `SELECT COALESCE(pa.standard_name, iw.item_name) AS name, SUM(iw.amount) AS total
       FROM item_waste iw
       LEFT JOIN product_alias pa ON pa.alias = iw.item_name
       WHERE iw.waste_reason = 'scheduling' AND iw.date >= CURRENT_DATE - 7
       GROUP BY 1
       HAVING SUM(iw.amount) > ?`,
      [threshold]
    );
    if (rows.length === 0) return undefined;
    const alerts: Record<string, number> = {};
    for (const r of rows) alerts[r.name] = Math.round(Number(r.total));
    return alerts;
  } catch (error) {
    logger.warn("forecast.service getSchedulingWasteAlerts failed, skipping waste alerts", { error: String(error) });
    return undefined;
  }
}


// ========== Day Type Helper ==========
function getDayType(dateStr: string): "mondayToThursday" | "friday" | "weekend" {
  const dow = dayjs(dateStr).day();
  if (dow === 0 || dow === 6) return "weekend";
  if (dow === 5) return "friday";
  return "mondayToThursday";
}

// ========== Revenue ==========
export async function getDailyRevenue(date: string): Promise<{ date: string; revenue: number; transaction_count: number | null; avg_transaction_value: number | null } | null> {
  const rows = await getDailyRevenues(date, date);
  return rows.length > 0 ? rows[0] : null;
}

// ========== Review ==========
export async function getLatestReview(): Promise<{
  date: string;
  summary: string;
  highlights: string[];
  painPoints: string[];
  suggestions: string;
} | null> {
  const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
  const data = await getReviewFromDB(yesterday);
  if (!data) return null;
  return {
    date: data.date,
    summary: data.review?.summary || "",
    highlights: data.review?.highlights || [],
    painPoints: data.review?.painPoints || [],
    suggestions: data.tomorrowSuggestions?.reason || "",
  };
}

// ========== Full Forecast for a Date ==========
export async function getProductForecast(date: string): Promise<{
  date: string;
  dayType: string;
  dayOfWeek: string;
  targetShipment: number;
  targetRevenue: number;
  /** 当前生效口径：new=数据驱动(中位数/P85)，legacy=预算法。默认 legacy。 */
  forecastMode: "legacy" | "new";
  /** 数据驱动目标(应收)，历史足够时给出，供新旧并显对照；不足则 undefined。 */
  dataDriven?: DataDrivenTarget;
  /** legacy 预算法的目标营业额，始终给出，供并显对照。 */
  legacyBudgetRevenue: number;
  products: Array<{
    name: string;
    positioning: string;
    coldHot: string;
    price: number;
    packMultiple: number;
    baselineQty: number;
    suggestedQty: number;
    totalAmount: number;
  }>;
  timeSlots: Array<{
    productName: string;
    timeSlot: string;
    quantity: number;
    amount: number;
  }>;
  aiCorrection?: number;
  /** F7-①：近 7 天排产报废超阈值单品 { 标准品名: 金额 }，仅用于输出提示，不参与计算。 */
  wasteAlerts?: Record<string, number>;
}> {
  const dayType = getDayType(date);
  const dow = dayjs(date).day();
  const month = dayjs(date).month() + 1;
  const year = dayjs(date).year();

  const [businessRules, planningRules, products, baselines, strategies, allTimeslotHistory] = await Promise.all([
    getBusinessRulesFromDB(),
    getPlanningRulesFromDB(),
    getProducts(),
    getSalesBaselines(),
    getStrategies(),
    getTimeslotSalesRecords(),
  ]);

  const monthlyTargets = calculateMonthlyTargets(businessRules, year);
  const targetMonth = monthlyTargets.find((t) => t.month === month);
  if (!targetMonth) throw new Error(`Month ${month} not found`);

  const aiCorrections = await getAICorrectionsIfEnabled(year, month);
  const dailyTargets = calculateDailyTargets(targetMonth, businessRules, aiCorrections);
  const dailyTarget = dailyTargets.find((d) => d.date === date);
  if (!dailyTarget) throw new Error(`Date ${date} not found in daily targets`);

  // 数据驱动目标(应收)：仅 new 模式计算（避免 legacy 每次预估多打一次 DB）。
  // new 模式下接管排产与 KPI，并与 legacy 预算(legacyBudgetRevenue，无需额外查询)并显对照。
  const forecastMode: "legacy" | "new" = process.env.FORECAST_MODE === "new" ? "new" : "legacy";
  const dataDriven = forecastMode === "new" ? await computeDataDrivenTarget(date) : null;
  const shipmentRate = businessRules.shipmentFormula?.shipmentRate ?? 0.95;
  const useNew = forecastMode === "new" && dataDriven !== null;

  // new 模式：排产按「中位数需求」缩放（少报废）；KPI/达成率用 P85。legacy 保持预算法。
  const effectiveTarget: DailyTarget = useNew
    ? { ...dailyTarget, revenue: dataDriven!.medianDemand, shipmentAmount: Math.round(dataDriven!.medianDemand * shipmentRate) }
    : dailyTarget;

  const dayTypeHistory = allTimeslotHistory.filter((r) => r.dayType === dayType);
  // P0/P1：new 模式下按单品实时销量(item_hourly_sales)取需求(中位数/P85)+逐时曲线，
  // 取代 12 周旧基线与对不上名的 timeslot 老路。legacy 模式不查(保持原行为)。
  const rawStats = useNew ? await getProductSalesStats(date) : undefined;
  // 安全阀：单品统计为空(历史断档/名映射全失效)时不启用新基线+剪枝，避免误把预估单剪空。
  const productStats = rawStats && rawStats.size > 0 ? rawStats : undefined;
  const productSuggestions = calculateProductSuggestions(
    effectiveTarget, products, baselines, strategies, allTimeslotHistory, businessRules.productBoosts, productStats
  );
  const defaultSlots = await getDefaultSlotsForDayType(dayType);
  const productHourly = productStats
    ? new Map(Array.from(productStats, ([n, s]) => [n, s.hourly] as [string, Record<number, number>]))
    : undefined;
  const timeSlotSuggestions = calculateTimeSlotSuggestions(productSuggestions, effectiveTarget, planningRules, dayTypeHistory, defaultSlots, productHourly);

  // F6-②：生成时 fire-and-forget 落快照（内部自捕获，不阻塞）
  void saveForecastSnapshot(
    date,
    productSuggestions.map((s) => ({ name: s.productName, suggestedQty: s.roundedQuantity }))
  );

  const wasteAlerts = await getSchedulingWasteAlerts();

  return {
    date,
    dayType: DAY_TYPE_LABELS[dayType] || dayType,
    dayOfWeek: `周${DOW_LABELS[dow]}`,
    targetShipment: useNew ? Math.round(dataDriven!.medianDemand * shipmentRate) : dailyTarget.shipmentAmount,
    targetRevenue: useNew ? dataDriven!.p85Target : dailyTarget.revenue,
    forecastMode,
    dataDriven: dataDriven ?? undefined,
    legacyBudgetRevenue: dailyTarget.revenue,
    products: productSuggestions.map((s) => ({
      name: s.productName,
      positioning: s.positioning,
      coldHot: s.coldHot,
      price: s.price,
      packMultiple: s.packMultiple,
      baselineQty: s.baselineQuantity,
      suggestedQty: s.roundedQuantity,
      totalAmount: s.totalAmount,
    })),
    timeSlots: timeSlotSuggestions,
    aiCorrection: aiCorrections?.[date],
    wasteAlerts,
  };
}

// ========== Full Forecast for a Month ==========
export async function generateFullForecast(
  year: number,
  month: number,
  day?: number
): Promise<{
  monthlyTargets: MonthlyTarget[];
  dailyTargets: DailyTarget[];
  productSuggestions: Record<string, ProductSuggestion[]>;
  timeSlotSuggestions: Record<string, TimeSlotSuggestion[]>;
}> {
  const [businessRules, planningRules, products, baselines, strategies, allTimeslotHistory] = await Promise.all([
    getBusinessRulesFromDB(),
    getPlanningRulesFromDB(),
    getProducts(),
    getSalesBaselines(),
    getStrategies(),
    getTimeslotSalesRecords(),
  ]);

  const monthlyTargets = calculateMonthlyTargets(businessRules, year);
  const targetMonth = monthlyTargets.find((t) => t.month === month);
  if (!targetMonth) throw new Error(`Month ${month} not found`);

  const aiCorrections = await getAICorrectionsIfEnabled(year, month);
  const dailyTargets = calculateDailyTargets(targetMonth, businessRules, aiCorrections);

  const productSuggestionsMap: Record<string, ProductSuggestion[]> = {};
  const timeSlotSuggestionsMap: Record<string, TimeSlotSuggestion[]> = {};

  const daysToProcess = day
    ? dailyTargets.filter((d) => d.date === `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`)
    : dailyTargets;

  const defaultSlotsCache = new Map<string, string[]>();
  for (const dt of daysToProcess) {
    const prodSugg = calculateProductSuggestions(dt, products, baselines, strategies, allTimeslotHistory, businessRules.productBoosts);
    productSuggestionsMap[dt.date] = prodSugg;
    const dayTypeHistory = allTimeslotHistory.filter((r) => r.dayType === dt.dayType);
    if (!defaultSlotsCache.has(dt.dayType)) {
      defaultSlotsCache.set(dt.dayType, await getDefaultSlotsForDayType(dt.dayType));
    }
    timeSlotSuggestionsMap[dt.date] = calculateTimeSlotSuggestions(prodSugg, dt, planningRules, dayTypeHistory, defaultSlotsCache.get(dt.dayType));
  }

  return { monthlyTargets, dailyTargets, productSuggestions: productSuggestionsMap, timeSlotSuggestions: timeSlotSuggestionsMap };
}

// ========== Format Helpers (WhatsApp output) ==========
function formatAICorrectionLine(coefficient: number): string {
  const pct = Math.round((coefficient - 1) * 1000) / 10;
  return `_（已应用 AI 修正 ${pct >= 0 ? "+" : ""}${pct}%）_`;
}

export function formatForecastText(forecast: Awaited<ReturnType<typeof getProductForecast>>): string {
  const lines: string[] = [];
  lines.push(`📊 *排产预估单*`);
  lines.push(`📅 日期：${forecast.date} ${forecast.dayOfWeek}（${forecast.dayType}）`);
  lines.push(`🎯 目标营业额：${forecast.targetRevenue.toLocaleString()} | 出货金额：${forecast.targetShipment.toLocaleString()}`);
  if (forecast.aiCorrection !== undefined) lines.push(formatAICorrectionLine(forecast.aiCorrection));
  lines.push("");
  lines.push("*单品出货建议*");
  lines.push("");

  const top = forecast.products.filter((p) => p.positioning === "TOP");
  const potential = forecast.products.filter((p) => p.positioning === "潜在TOP");
  const other = forecast.products.filter((p) => p.positioning === "其他");

  for (const group of [top, potential, other]) {
    if (group.length === 0) continue;
    const label = group[0].positioning;
    lines.push(`▸ ${label}`);
    for (const p of group) {
      const coldHot = p.coldHot === "热" ? "🔥" : "🧊";
      lines.push(`  ${coldHot} ${p.name}: ${p.suggestedQty}个 × RM${p.price} = RM${p.totalAmount.toLocaleString()}`);
    }
    lines.push("");
  }

  const totalQty = forecast.products.reduce((s, p) => s + p.suggestedQty, 0);
  const totalAmount = forecast.products.reduce((s, p) => s + p.totalAmount, 0);
  lines.push(`✅ 总计：${totalQty}个，RM${totalAmount.toLocaleString()}`);
  return lines.join("\n");
}

export function formatForecastCompact(forecast: Awaited<ReturnType<typeof getProductForecast>>): string {
  const lines: string[] = [];
  lines.push(`📊 *${forecast.date} ${forecast.dayOfWeek}* | 目标 RM${forecast.targetShipment.toLocaleString()}`);
  if (forecast.aiCorrection !== undefined) lines.push(formatAICorrectionLine(forecast.aiCorrection));
  const topProducts = forecast.products.filter((p) => p.positioning === "TOP" || p.positioning === "潜在TOP");
  const wasteAlerts = forecast.wasteAlerts ?? {};
  for (const p of topProducts) {
    lines.push(`• ${p.name}: *${p.suggestedQty}*个`);
    if (wasteAlerts[p.name] !== undefined) {
      lines.push(`  ⚠️ 近7天排产报废 RM${wasteAlerts[p.name]}，建议下调`);
    }
  }
  lines.push(`_其他 ${forecast.products.length - topProducts.length} 款产品已按历史销量分配_`);
  // F7-①：未出现在输出里的超标单品，末尾汇总一行
  const shownNames = new Set(topProducts.map((p) => p.name));
  const hiddenAlerts = Object.entries(wasteAlerts).filter(([name]) => !shownNames.has(name));
  if (hiddenAlerts.length > 0) {
    lines.push(`⚠️ 另有 ${hiddenAlerts.length} 款近7天排产报废超标：${hiddenAlerts.map(([name, amt]) => `${name}(RM${amt})`).join("、")}`);
  }
  return lines.join("\n");
}

export function formatRevenueText(
  date: string,
  revenue: { date: string; revenue: number; transaction_count: number | null; avg_transaction_value: number | null } | null,
  review: Awaited<ReturnType<typeof getLatestReview>>
): string {
  const lines: string[] = [];
  lines.push(`💰 *${date} 营业额*`);
  if (revenue && revenue.revenue > 0) {
    lines.push(`📊 营业额：RM ${revenue.revenue.toLocaleString()}`);
    if (revenue.transaction_count) lines.push(`🧾 客单数：${revenue.transaction_count}`);
    if (revenue.avg_transaction_value) lines.push(`👤 客单价：RM ${revenue.avg_transaction_value}`);
  } else {
    lines.push("暂无数据");
  }
  if (review) {
    lines.push("");
    lines.push(`📝 *昨日AI复盘摘要*`);
    lines.push(review.summary);
    if (review.suggestions) {
      lines.push("");
      lines.push(`💡 *建议*：${review.suggestions}`);
    }
  }
  return lines.join("\n");
}

// ========== Individual Forecast Generation Functions ==========
export async function generateMonthlyTargetsWithCustomCoefficients(
  year: number,
  customCoefficients: Record<string, number>
): Promise<MonthlyTarget[]> {
  const businessRules = await getBusinessRulesFromDB();
  const { calculateMonthlyTargets } = await import("./forecast-engine");
  return calculateMonthlyTargets({ ...businessRules, monthlyCoefficients: customCoefficients }, year);
}

export async function generateDailyTargets(monthlyTarget: MonthlyTarget): Promise<DailyTarget[]> {
  const businessRules = await getBusinessRulesFromDB();
  const { calculateDailyTargets } = await import("./forecast-engine");
  return calculateDailyTargets(monthlyTarget, businessRules);
}

export async function generateProductSuggestions(dailyTarget: DailyTarget): Promise<ProductSuggestion[]> {
  const [products, baselines, strategies, timeslotRecords, businessRules] = await Promise.all([
    getProducts(),
    getSalesBaselines(),
    getStrategies(),
    getTimeslotSalesRecords(),
    getBusinessRulesFromDB(),
  ]);
  const { calculateProductSuggestions } = await import("./forecast-engine");
  return calculateProductSuggestions(dailyTarget, products, baselines, strategies, timeslotRecords, businessRules.productBoosts);
}

export async function generateTimeSlotSuggestions(
  productSuggestions: ProductSuggestion[],
  dailyTarget: DailyTarget
): Promise<TimeSlotSuggestion[]> {
  const [planningRules, timeslotHistory, defaultSlots] = await Promise.all([
    getPlanningRulesFromDB(),
    getTimeslotSalesRecords(dailyTarget.dayType),
    getDefaultSlotsForDayType(dailyTarget.dayType),
  ]);
  const { calculateTimeSlotSuggestions } = await import("./forecast-engine");
  return calculateTimeSlotSuggestions(productSuggestions, dailyTarget, planningRules, timeslotHistory, defaultSlots);
}
