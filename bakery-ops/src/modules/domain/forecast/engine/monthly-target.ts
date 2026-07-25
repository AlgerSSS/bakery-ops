import { BusinessRules, MonthlyTarget } from "../types";

export function calculateMonthlyTargets(
  rules: BusinessRules,
  year: number
): MonthlyTarget[] {
  const targets: MonthlyTarget[] = [];

  for (let month = 1; month <= 12; month++) {
    const coefficient = rules.monthlyCoefficients[String(month)] || 1;
    const baseRevenue = rules.firstMonthRevenue * coefficient;
    const enhancedRevenue =
      baseRevenue * (1 + rules.totalEnhancement);

    targets.push({
      month,
      year,
      coefficient,
      baseRevenue: Math.round(baseRevenue),
      enhancedRevenue: Math.round(enhancedRevenue),
    });
  }

  return targets;
}
