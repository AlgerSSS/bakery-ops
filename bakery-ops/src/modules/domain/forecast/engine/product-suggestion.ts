import {
  DailyTarget,
  Product,
  ProductSuggestion,
  ProductSalesBaseline,
  ProductStrategy,
  TimeslotSalesRecord,
} from "../types";
import { roundToMultiple } from "./utils";
import type { ProductDemand } from "../product-demand";

export function calculateProductSuggestions(
  dailyTarget: DailyTarget,
  products: Product[],
  baselines: ProductSalesBaseline[],
  strategies: ProductStrategy[],
  timeslotRecords?: TimeslotSalesRecord[],
  productBoosts?: Record<string, number>,
  // P0/P1：单品级实时需求(中位数/P85)。提供时取代老基线，并跳过定位加成与全局 rescale。
  productStats?: Map<string, ProductDemand>
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
    const positioning = strategy?.positioning || "其他";
    const stats = productStats?.get(product.name);

    // P2 剪枝：新口径下，近期完全无销量(无 stats)的下架/僵尸品不进预估单(与人工只排在售品一致)。
    if (productStats && !stats) continue;

    // 需求基线：优先单品级实时中位数(P0/P1)；无实时样本时回落老路(timeslot / 12 周旧基线)。
    let baselineQty = 0;
    if (stats && stats.median > 0) {
      // 中位数=典型同星期几需求(回测 MAE≈10%，优于人工 15%)；P85 太高会过量报废。
      baselineQty = stats.median;
    } else {
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
    }

    let adjustedQty = baselineQty;

    // 定位加成只在回落老基线时叠加；单品实时中位数已是最准(回测 MAE≈10%，优于人工)，
    // 再上浮会过量报废，防断货交给「断货检测」+ 人工加货那条路。
    if (!(stats && stats.median > 0)) {
      if (positioning === "TOP" && adjustedQty > 0) {
        adjustedQty = Math.round(adjustedQty * boost.top);
      } else if (positioning === "潜在TOP" && adjustedQty > 0) {
        adjustedQty = Math.round(adjustedQty * boost.potentialTop);
      }
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

  // 全局 rescale：仅老口径用。新口径(单品实时需求)不做——按比例砍会削掉爆款喂长尾，
  // 而单品实际销量之和本身就是需求；总量对不上目标是"该多做多少"的真实反映(P1)。
  const totalSuggested = suggestions.reduce((sum, s) => sum + s.totalAmount, 0);
  const ratio = totalSuggested > 0 ? shipmentAmount / totalSuggested : 1;

  if (!productStats && Math.abs(ratio - 1) > 0.05) {
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
