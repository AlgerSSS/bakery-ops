import dayjs from "dayjs";
import { BusinessRules, MonthlyTarget, DailyTarget } from "../types";

// prophetDowWeights 的默认值源自早年一次 Prophet 拟合，现为设置页可调的普通系数；
// 原 prophetFactors 参数与 /api/prophet-trend 装饰链路已删（IMPROVEMENT-PLAN G2-③，2026-07-02）。
export function calculateDailyTargets(
  monthlyTarget: MonthlyTarget,
  rules: BusinessRules,
  aiCorrections?: Record<string, number>
): DailyTarget[] {
  const { year, month, enhancedRevenue } = monthlyTarget;
  const weights = rules.weekdayWeights;
  const shipmentRate = rules.shipmentFormula.shipmentRate;

  const daysInMonth = dayjs(`${year}-${String(month).padStart(2, "0")}-01`).daysInMonth();
  const days: { date: string; dayOfWeek: number; dayType: DailyTarget["dayType"]; baseWeight: number; weight: number }[] = [];

  const dowCfg = rules.prophetDowWeights;
  const prophetDowWeights: Record<number, number> = {
    1: dowCfg?.monday ?? 1.025,
    2: dowCfg?.tuesday ?? 0.976,
    3: dowCfg?.wednesday ?? 0.981,
    4: dowCfg?.thursday ?? 1.017,
  };

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayObj = dayjs(dateStr);
    const dow = dayObj.day();

    let dayType: DailyTarget["dayType"];
    let weight: number;

    if (dow === 6) {
      dayType = "weekend";
      weight = weights.saturday;
    } else if (dow === 0) {
      dayType = "weekend";
      weight = weights.sunday;
    } else if (dow === 5) {
      dayType = "friday";
      weight = weights.friday;
    } else {
      dayType = "mondayToThursday";
      weight = weights.mondayToThursday * prophetDowWeights[dow];
    }

    days.push({ date: dateStr, dayOfWeek: dow, dayType, baseWeight: Math.round(weight * 1000) / 1000, weight });
  }

  for (const d of days) {
    let w = d.weight;
    if (aiCorrections?.[d.date]) {
      w *= aiCorrections[d.date];
    }
    d.weight = Math.round(w * 1000) / 1000;
  }

  const totalWeight = days.reduce((sum, d) => sum + d.weight, 0);

  let distributed = 0;
  const dailyTargets: DailyTarget[] = days.map((d, index) => {
    let revenue: number;
    if (index === days.length - 1) {
      revenue = enhancedRevenue - distributed;
    } else {
      revenue = Math.round((enhancedRevenue * d.weight) / totalWeight);
      distributed += revenue;
    }

    return {
      date: d.date,
      dayOfWeek: d.dayOfWeek,
      dayType: d.dayType,
      baseWeight: d.baseWeight,
      weight: d.weight,
      revenue,
      shipmentAmount: Math.round(revenue * shipmentRate),
    };
  });

  return dailyTargets;
}
