import { NextRequest, NextResponse } from "next/server";
import { query } from "@/modules/shared/db/postgres";
import { buildPrompt } from "@/modules/domain/forecast/prompt-engine";
import { generateJsonFromPrompt } from "@/modules/domain/forecast/gemini-client";
import dayjs from "dayjs";

interface HolidayRow { date: string; name: string; type: string; coefficient: number | null; note: string; }
interface ContextEventRow { date: string; event_tag: string; description: string; }
interface BusinessRuleRow { rule_key: string; rule_value: string; }

export async function POST(req: NextRequest) {
  try {
    const { year, month, city } = await req.json();
    if (!year || !month) return NextResponse.json({ error: "缺少 year 或 month 参数" }, { status: 400 });

    const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const prevMonthPrefix = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
    const nextMonthPrefix = `${nextYear}-${String(nextMonth).padStart(2, "0")}`;

    const [holidays, adjacentHolidays, allYearHolidays, events, ruleRows] = await Promise.all([
      query<HolidayRow>("SELECT date, name, type, coefficient, note FROM holiday WHERE date LIKE ? ORDER BY date", [`${monthPrefix}%`]),
      query<HolidayRow>("SELECT date, name, type, note FROM holiday WHERE date LIKE ? OR date LIKE ? ORDER BY date", [`${prevMonthPrefix}%`, `${nextMonthPrefix}%`]),
      query<HolidayRow>("SELECT date, name, type, note FROM holiday WHERE date LIKE ? ORDER BY date", [`${year}%`]),
      query<ContextEventRow>("SELECT date, event_tag, description FROM context_event WHERE date LIKE ? ORDER BY date", [`${monthPrefix}%`]),
      query<BusinessRuleRow>("SELECT rule_key, rule_value FROM business_rule"),
    ]);

    const ruleMap: Record<string, unknown> = {};
    for (const r of ruleRows) ruleMap[r.rule_key] = JSON.parse(r.rule_value);
    const weekdayWeights = (ruleMap.weekdayWeights as { mondayToThursday: number; friday: number; saturday: number; sunday: number }) || { mondayToThursday: 1.0, friday: 1.2, saturday: 1.35, sunday: 1.35 };
    const prophetDowWeights = (ruleMap.prophetDowWeights as { monday: number; tuesday: number; wednesday: number; thursday: number }) || { monday: 1.025, tuesday: 0.976, wednesday: 0.981, thursday: 1.017 };
    const dowWeightMap: Record<number, number> = { 1: prophetDowWeights.monday, 2: prophetDowWeights.tuesday, 3: prophetDowWeights.wednesday, 4: prophetDowWeights.thursday };

    const daysInMonth = new Date(year, month, 0).getDate();
    const baseCoefficientInfo: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dow = dayjs(dateStr).day();
      let baseCoeff: number;
      if (dow === 6) baseCoeff = weekdayWeights.saturday;
      else if (dow === 0) baseCoeff = weekdayWeights.sunday;
      else if (dow === 5) baseCoeff = weekdayWeights.friday;
      else baseCoeff = weekdayWeights.mondayToThursday * (dowWeightMap[dow] ?? 1.0);
      baseCoefficientInfo.push(`${dateStr}(${["日","一","二","三","四","五","六"][dow]}): 基础系数=${baseCoeff.toFixed(3)}`);
    }

    const cityInfo = city ? `，城市：${city}` : "，城市：吉隆坡（Kuala Lumpur）";
    const typeLabels: Record<string, string> = { public_holiday: "法定公假", festival: "重要节日", promotion: "促销活动", ramadan: "斋月", other: "其他" };

    let holidayInfo = holidays.length > 0
      ? "\n\n【当月节假日/特殊日期】\n" + holidays.map((h) => `- ${h.date}：${h.name}（${typeLabels[h.type] || h.type}）${h.note ? `，备注：${h.note}` : ""}`).join("\n")
      : "\n\n当月没有录入节假日信息，请根据你对马来西亚节假日的了解补充判断。\n";
    let adjacentInfo = adjacentHolidays.length > 0
      ? "\n【相邻月份节假日】\n" + adjacentHolidays.map((h) => `- ${h.date}：${h.name}（${typeLabels[h.type] || h.type}）${h.note ? `，备注：${h.note}` : ""}`).join("\n")
      : "";
    let yearOverview = allYearHolidays.length > 0
      ? `\n【${year}年全年节假日概览】\n` + allYearHolidays.map((h) => `- ${h.date}：${h.name}（${typeLabels[h.type] || h.type}）`).join("\n")
      : "";
    const eventsInfo = events.length > 0
      ? "\n【当月事件上下文】\n" + events.map((e) => `- ${e.date}：[${e.event_tag}] ${e.description}`).join("\n")
      : "";

    const vars: Record<string, string> = {
      year: String(year), month: String(month), monthPadded: String(month).padStart(2, "0"),
      daysInMonth: String(daysInMonth), cityInfo, holidayInfo, adjacentInfo, yearOverview, eventsInfo,
      baseCoefficientsInfo: `\n【各日基础系数】\n${baseCoefficientInfo.join("\n")}\n`,
    };
    const built = await buildPrompt("daily_correction", vars);
    const prompt = `请分析 ${year}年${month}月 的每一天（共${daysInMonth}天）${cityInfo}，给出每天的营业额系数。\n\n${built.prompt}`;

    const text = await generateJsonFromPrompt(built, prompt);

    let corrections;
    try { corrections = JSON.parse(text); } catch {
      return NextResponse.json({ error: "AI 返回格式解析失败", rawText: text }, { status: 500 });
    }
    if (!Array.isArray(corrections)) return NextResponse.json({ error: "AI 返回的不是数组格式", rawText: text }, { status: 500 });

    const holidayMap = new Map(holidays.map((h) => [h.date, h]));
    const normalized = corrections.map((item: { date: string; coefficient: number; reason: string }) => {
      const dbHoliday = holidayMap.get(item.date);
      return { date: item.date, coefficient: Number(item.coefficient) || 1.0, reason: dbHoliday ? `${dbHoliday.name} — ${item.reason || "节假日"}` : item.reason || "无说明" };
    });
    return NextResponse.json({ corrections: normalized });
  } catch (error) {
    return NextResponse.json({ error: `AI 调用失败: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
  }
}
