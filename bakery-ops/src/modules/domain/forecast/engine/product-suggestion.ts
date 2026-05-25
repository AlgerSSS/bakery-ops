import {
  DailyTarget,
  Product,
  ProductSuggestion,
  ProductSalesBaseline,
  ProductStrategy,
  TimeslotSalesRecord,
} from "../types";
import { roundToMultiple } from "./utils";

export function calculateProductSuggestions(
  dailyTarget: DailyTarget,
  products: Product[],
  baselines: ProductSalesBaseline[],
  strategies: ProductStrategy[],
  timeslotRecords?: TimeslotSalesRecord[],
  productBoosts?: Record<string, number>
): ProductSuggestion[] {
  const { shipmentAmount, dayType } = dailyTarget;

  const strategyMap = new Map<string, ProductStrategy>();
  for (const s of strategies) {
    strategyMap.set(s.productName, s);
  }

  const baselineMap = new Map<string, ProductSalesBaseline>();
  for (const b of baselines) {
    baselineMap.set(b.productName, b);
  }

  const timeslotBaselineMap = new Map<string, number>();
  if (timeslotRecords && timeslotRecords.length > 0) {
    for (const r of timeslotRecords) {
      if (r.dayType !== dayType) continue;
      timeslotBaselineMap.set(
        r.productName,
        (timeslotBaselineMap.get(r.productName) || 0) + r.avgQuantity
      );
    }
  }

  const suggestions: ProductSuggestion[] = [];

  const boostMultipliers: Record<string, { top: number; potentialTop: number }> = {
    mondayToThursday: { top: 1.10, potentialTop: 1.05 },
    friday: { top: 1.12, potentialTop: 1.06 },
    weekend: { top: 1.15, potentialTop: 1.08 },
  };

  const minQuantityMultipliers: Record<string, { top: number; potentialTop: number; other: number }> = {
    mondayToThursday: { top: 2, potentialTop: 1, other: 1 },
    friday: { top: 2.5, potentialTop: 1.5, other: 1 },
    weekend: { top: 3, potentialTop: 2, other: 1.5 },
  };

  const boost = boostMultipliers[dayType] || boostMultipliers.mondayToThursday;
  const minQtyMult = minQuantityMultipliers[dayType] || minQuantityMultipliers.mondayToThursday;

  for (const product of products) {
    const baseline = baselineMap.get(product.name);
    const strategy = strategyMap.get(product.name);

    let baselineQty = 0;
    const timeslotQty = timeslotBaselineMap.get(product.name);
    if (timeslotQty !== undefined && timeslotQty > 0) {
      baselineQty = Math.round(timeslotQty);
    } else if (baseline) {
      switch (dayType) {
        case "mondayToThursday":
          baselineQty = baseline.avgMondayToThursday;
          break;
        case "friday":
          baselineQty = baseline.avgFriday;
          break;
        case "weekend":
          baselineQty = baseline.avgWeekend;
          break;
      }
    }

    let adjustedQty = baselineQty;
    const positioning = strategy?.positioning || "其他";

    if (positioning === "TOP" && adjustedQty > 0) {
      adjustedQty = Math.round(adjustedQty * boost.top);
    } else if (positioning === "潜在TOP" && adjustedQty > 0) {
      adjustedQty = Math.round(adjustedQty * boost.potentialTop);
    }

    const productBoost = productBoosts?.[product.name];
    if (productBoost && productBoost > 0 && adjustedQty > 0) {
      adjustedQty = Math.round(adjustedQty * productBoost);
    }

    if (adjustedQty === 0) {
      if (positioning === "TOP") {
        adjustedQty = Math.round(product.packMultiple * minQtyMult.top);
      } else if (positioning === "潜在TOP") {
        adjustedQty = Math.round(product.packMultiple * minQtyMult.potentialTop);
      } else {
        adjustedQty = product.unitType === "individual"
          ? Math.round(5 * minQtyMult.other)
          : Math.round(product.packMultiple * minQtyMult.other);
      }
    }

    const roundedQty = roundToMultiple(adjustedQty, product.packMultiple, product.unitType);

    suggestions.push({
      productName: product.name,
      price: product.price,
      packMultiple: product.packMultiple,
      unitType: product.unitType,
      baselineQuantity: baselineQty,
      suggestedQuantity: adjustedQty,
      roundedQuantity: roundedQty,
      totalAmount: Math.round(roundedQty * product.price),
      positioning,
      coldHot: strategy?.coldHot || "热",
      displayFullQuantity: product.displayFullQuantity || 0,
    });
  }

  const totalSuggested = suggestions.reduce((sum, s) => sum + s.totalAmount, 0);
  const ratio = totalSuggested > 0 ? shipmentAmount / totalSuggested : 1;

  if (Math.abs(ratio - 1) > 0.05) {
    for (const s of suggestions) {
      const scaledQty = Math.round(s.suggestedQuantity * ratio);
      s.suggestedQuantity = scaledQty;
      s.roundedQuantity = roundToMultiple(scaledQty, s.packMultiple, s.unitType);
      s.totalAmount = Math.round(s.roundedQuantity * s.price);
    }
  }

  const positioningPriority: Record<string, number> = { "TOP": 0, "潜在TOP": 1, "其他": 2 };
  const strategyOrderMap = new Map<string, number>();
  for (const s of strategies) {
    strategyOrderMap.set(s.productName, s.sortOrder);
  }

  suggestions.sort((a, b) => {
    const pa = positioningPriority[a.positioning] ?? 2;
    const pb = positioningPriority[b.positioning] ?? 2;
    if (pa !== pb) return pa - pb;
    const oa = strategyOrderMap.get(a.productName) ?? 999;
    const ob = strategyOrderMap.get(b.productName) ?? 999;
    return oa - ob;
  });

  return suggestions;
}
