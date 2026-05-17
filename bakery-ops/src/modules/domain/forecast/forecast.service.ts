import dayjs from "dayjs";
import {
  calculateMonthlyTargets,
  calculateDailyTargets,
  calculateSalesBaselines,
  calculateProductSuggestions,
  calculateTimeSlotSuggestions,
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
} from "@/modules/data/repositories/forecast.repository";
import type {
  MonthlyTarget,
  DailyTarget,
  ProductSuggestion,
  TimeSlotSuggestion,
} from "./types";

// ========== Day Type Helper ==========
function getDayType(dateStr: string): "mondayToThursday" | "friday" | "weekend" {
  const dow = dayjs(dateStr).day();
  if (dow === 0 || dow === 6) return "weekend";
  if (dow === 5) return "friday";
  return "mondayToThursday";
}

const DAY_TYPE_LABELS: Record<string, string> = {
  mondayToThursday: "周一至周四",
  friday: "周五",
  weekend: "周末",
};

const DOW_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

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

  const dailyTargets = calculateDailyTargets(targetMonth, businessRules);
  const dailyTarget = dailyTargets.find((d) => d.date === date);
  if (!dailyTarget) throw new Error(`Date ${date} not found in daily targets`);

  const dayTypeHistory = allTimeslotHistory.filter((r) => r.dayType === dayType);
  const productSuggestions = calculateProductSuggestions(
    dailyTarget, products, baselines, strategies, allTimeslotHistory, businessRules.productBoosts
  );
  const timeSlotSuggestions = calculateTimeSlotSuggestions(productSuggestions, dailyTarget, planningRules, dayTypeHistory);

  return {
    date,
    dayType: DAY_TYPE_LABELS[dayType] || dayType,
    dayOfWeek: `周${DOW_LABELS[dow]}`,
    targetShipment: dailyTarget.shipmentAmount,
    targetRevenue: dailyTarget.revenue,
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

  const dailyTargets = calculateDailyTargets(targetMonth, businessRules);

  const productSuggestionsMap: Record<string, ProductSuggestion[]> = {};
  const timeSlotSuggestionsMap: Record<string, TimeSlotSuggestion[]> = {};

  const daysToProcess = day
    ? dailyTargets.filter((d) => d.date === `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`)
    : dailyTargets;

  for (const dt of daysToProcess) {
    const prodSugg = calculateProductSuggestions(dt, products, baselines, strategies, allTimeslotHistory, businessRules.productBoosts);
    productSuggestionsMap[dt.date] = prodSugg;
    const dayTypeHistory = allTimeslotHistory.filter((r) => r.dayType === dt.dayType);
    timeSlotSuggestionsMap[dt.date] = calculateTimeSlotSuggestions(prodSugg, dt, planningRules, dayTypeHistory);
  }

  return { monthlyTargets, dailyTargets, productSuggestions: productSuggestionsMap, timeSlotSuggestions: timeSlotSuggestionsMap };
}

// ========== Format Helpers (WhatsApp output) ==========
export function formatForecastText(forecast: Awaited<ReturnType<typeof getProductForecast>>): string {
  const lines: string[] = [];
  lines.push(`📊 *排产预估单*`);
  lines.push(`📅 日期：${forecast.date} ${forecast.dayOfWeek}（${forecast.dayType}）`);
  lines.push(`🎯 目标营业额：${forecast.targetRevenue.toLocaleString()} | 出货金额：${forecast.targetShipment.toLocaleString()}`);
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
  const topProducts = forecast.products.filter((p) => p.positioning === "TOP" || p.positioning === "潜在TOP");
  for (const p of topProducts) {
    lines.push(`• ${p.name}: *${p.suggestedQty}*个`);
  }
  lines.push(`_其他 ${forecast.products.length - topProducts.length} 款产品已按历史销量分配_`);
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
  const [planningRules, timeslotHistory] = await Promise.all([
    getPlanningRulesFromDB(),
    getTimeslotSalesRecords(dailyTarget.dayType),
  ]);
  const { calculateTimeSlotSuggestions } = await import("./forecast-engine");
  return calculateTimeSlotSuggestions(productSuggestions, dailyTarget, planningRules, timeslotHistory);
}
