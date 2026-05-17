import dayjs from "dayjs";
import {
  BusinessRules,
  MonthlyTarget,
  DailyTarget,
  ProductSuggestion,
  ProductSalesBaseline,
  Product,
  ProductStrategy,
  DailySalesRecord,
  TimeSlotSuggestion,
  PlanningRules,
  TimeslotSalesRecord,
  OutOfStockRecord,
} from "./types";

// ========== Monthly Revenue Target ==========
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

// ========== Daily Target Split ==========
export function calculateDailyTargets(
  monthlyTarget: MonthlyTarget,
  rules: BusinessRules,
  prophetFactors?: Record<string, number>,
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

// ========== V2: Stockout Loss Calculation ==========

const BUSINESS_SLOTS = ["12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];

export function parseStockoutLine(line: string): { inputName: string; soldoutTime: string } | null {
  const match = line.trim().match(/^(.+?)\s+(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const inputName = match[1].trim();
  let hour = parseInt(match[2]);
  const minute = match[3];

  if (hour <= 11) hour += 12;

  return { inputName, soldoutTime: `${hour}:${minute}` };
}

export function calculateLossSlots(soldoutTime: string): string[] {
  const [h, m] = soldoutTime.split(":").map(Number);
  const nextSlotHour = m > 0 ? h + 1 : h + 1;
  const slots: string[] = [];
  for (let hour = nextSlotHour; hour <= 21; hour++) {
    slots.push(`${String(hour).padStart(2, "0")}:00`);
  }
  return slots;
}

export function calculateStockoutLoss(
  record: OutOfStockRecord,
  timeslotHistory: TimeslotSalesRecord[],
  productPrice: number
): { lossQty: number; lossAmount: number } {
  const historyMap = new Map<string, number>();
  for (const r of timeslotHistory) {
    if (r.productName === record.productName && r.dayType === record.dayType) {
      historyMap.set(r.timeSlot, r.avgQuantity);
    }
  }

  let lossQty = 0;
  for (const slot of record.lossSlots) {
    lossQty += historyMap.get(slot) || 0;
  }

  return {
    lossQty: Math.round(lossQty),
    lossAmount: Math.round(lossQty * productPrice),
  };
}

export function calculateStockoutLossWithTraffic(
  record: OutOfStockRecord,
  timeslotHistory: TimeslotSalesRecord[],
  productPrice: number,
  todayTransactionCount: number
): { lossQty: number; lossAmount: number } {
  const historyMap = new Map<string, number>();
  let totalHistoryQty = 0;
  for (const r of timeslotHistory) {
    if (r.productName === record.productName && r.dayType === record.dayType) {
      historyMap.set(r.timeSlot, r.avgQuantity);
      totalHistoryQty += r.avgQuantity;
    }
  }

  if (totalHistoryQty === 0 || BUSINESS_SLOTS.length === 0) {
    return calculateStockoutLoss(record, timeslotHistory, productPrice);
  }

  const avgTrafficPerSlot = todayTransactionCount / BUSINESS_SLOTS.length;

  let lossQty = 0;
  for (const slot of record.lossSlots) {
    const histAvg = historyMap.get(slot) || 0;
    if (histAvg === 0) continue;
    const slotProportion = histAvg / totalHistoryQty;
    const expectedSales = avgTrafficPerSlot * slotProportion * BUSINESS_SLOTS.length;
    lossQty += expectedSales;
  }

  const historicalLoss = calculateStockoutLoss(record, timeslotHistory, productPrice);
  const maxLossQty = historicalLoss.lossQty * 2;
  lossQty = Math.min(Math.round(lossQty), maxLossQty > 0 ? maxLossQty : Math.round(lossQty));

  return {
    lossQty,
    lossAmount: Math.round(lossQty * productPrice),
  };
}

// ========== Sales Baseline Calculation ==========
export function calculateSalesBaselines(
  salesRecords: DailySalesRecord[],
  products: Product[],
  baselineOverrides?: Record<string, { mondayToThursday: number; friday: number; weekend: number }>,
  stockoutRecords?: OutOfStockRecord[]
): ProductSalesBaseline[] {
  const productNameSet = new Set(products.map((p) => p.name));

  const groupedSales: Record<
    string,
    { mondayToThursday: number[]; friday: number[]; weekend: number[] }
  > = {};

  const dailyAgg: Record<string, Record<string, number>> = {};

  for (const record of salesRecords) {
    const name = record.standardName;
    if (!productNameSet.has(name)) continue;

    if (!dailyAgg[name]) dailyAgg[name] = {};
    if (!dailyAgg[name][record.date]) dailyAgg[name][record.date] = 0;
    dailyAgg[name][record.date] += record.quantity;
  }

  if (stockoutRecords && stockoutRecords.length > 0) {
    for (const oos of stockoutRecords) {
      const name = oos.productName;
      if (!productNameSet.has(name)) continue;
      if (!dailyAgg[name]) dailyAgg[name] = {};
      if (!dailyAgg[name][oos.date]) dailyAgg[name][oos.date] = 0;
      dailyAgg[name][oos.date] += oos.estimatedLossQty;
    }
  }

  for (const [name, dateSales] of Object.entries(dailyAgg)) {
    if (!groupedSales[name]) {
      groupedSales[name] = { mondayToThursday: [], friday: [], weekend: [] };
    }

    for (const [dateStr, qty] of Object.entries(dateSales)) {
      const dow = new Date(dateStr).getDay();
      if (dow === 0 || dow === 6) {
        groupedSales[name].weekend.push(qty);
      } else if (dow === 5) {
        groupedSales[name].friday.push(qty);
      } else {
        groupedSales[name].mondayToThursday.push(qty);
      }
    }
  }

  const baselines: ProductSalesBaseline[] = [];

  for (const product of products) {
    const override = baselineOverrides?.[product.name];
    if (override) {
      baselines.push({
        productName: product.name,
        avgMondayToThursday: override.mondayToThursday,
        avgFriday: override.friday,
        avgWeekend: override.weekend,
        totalSales: 0,
        dayCount: 0,
      });
      continue;
    }

    const data = groupedSales[product.name];
    if (!data) {
      baselines.push({
        productName: product.name,
        avgMondayToThursday: 0,
        avgFriday: 0,
        avgWeekend: 0,
        totalSales: 0,
        dayCount: 0,
      });
      continue;
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    baselines.push({
      productName: product.name,
      avgMondayToThursday: avg(data.mondayToThursday),
      avgFriday: avg(data.friday),
      avgWeekend: avg(data.weekend),
      totalSales:
        data.mondayToThursday.reduce((a, b) => a + b, 0) +
        data.friday.reduce((a, b) => a + b, 0) +
        data.weekend.reduce((a, b) => a + b, 0),
      dayCount:
        data.mondayToThursday.length + data.friday.length + data.weekend.length,
    });
  }

  return baselines;
}

// ========== Round to Pack Multiple ==========
function roundToMultiple(quantity: number, multiple: number, unitType: "batch" | "individual"): number {
  if (unitType === "individual") return Math.max(1, Math.round(quantity));
  if (multiple <= 0) return Math.max(1, Math.round(quantity));
  return Math.max(multiple, Math.ceil(quantity / multiple) * multiple);
}

// ========== Product Shipment Suggestions ==========
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

// ========== Time Slot Distribution ==========
export function calculateTimeSlotSuggestions(
  productSuggestions: ProductSuggestion[],
  dailyTarget: DailyTarget,
  planningRules: PlanningRules,
  timeslotHistory?: TimeslotSalesRecord[]
): TimeSlotSuggestion[] {
  const fixedSchedule = planningRules.fixedShipmentSchedule || {};
  const { dayType } = dailyTarget;

  const historyMap = new Map<string, Map<string, number>>();
  if (timeslotHistory && timeslotHistory.length > 0) {
    for (const r of timeslotHistory) {
      if (r.dayType !== dayType) continue;
      if (!historyMap.has(r.productName)) historyMap.set(r.productName, new Map());
      historyMap.get(r.productName)!.set(r.timeSlot, r.avgQuantity);
    }
  }

  const slotSuggestions: TimeSlotSuggestion[] = [];

  for (const product of productSuggestions) {
    const productHistory = historyMap.get(product.productName);
    const multiple = product.unitType === "batch" ? product.packMultiple : 1;

    const rawQty = product.adjustedQuantity ?? product.roundedQuantity;
    const totalQty = (multiple > 1)
      ? Math.ceil(rawQty / multiple) * multiple
      : rawQty;
    if (totalQty <= 0) continue;
    const schedule = fixedSchedule[product.productName];
    const fullQty = product.displayFullQuantity || 0;

    let targetSlots: string[];
    if (schedule && schedule.length > 0) {
      targetSlots = schedule;
    } else if (productHistory && productHistory.size > 0) {
      targetSlots = Array.from(productHistory.keys()).sort();
    } else {
      targetSlots = ["11:00"];
    }

    if (targetSlots.length === 1) {
      slotSuggestions.push({
        productName: product.productName,
        timeSlot: targetSlots[0],
        quantity: totalQty,
        amount: Math.round(totalQty * product.price),
      });
      continue;
    }

    const slotAvgs = new Map<string, number>();
    let hasHistory = false;
    for (const slot of targetSlots) {
      const avg = productHistory?.get(slot) || 0;
      slotAvgs.set(slot, avg);
      if (avg > 0) hasHistory = true;
    }

    let allocation: Map<string, number>;
    if (hasHistory) {
      const histTotal = Array.from(slotAvgs.values()).reduce((s, v) => s + v, 0);
      allocation = distributeByProportion(totalQty, slotAvgs, histTotal, multiple, product.unitType);
    } else {
      const equalAvgs = new Map<string, number>();
      for (const slot of targetSlots) equalAvgs.set(slot, 1);
      allocation = distributeByProportion(totalQty, equalAvgs, targetSlots.length, multiple, product.unitType);
    }

    const unit = (product.unitType === "batch" && multiple > 1) ? multiple : 1;
    const earlySlots = targetSlots.filter((s) => s <= "12:00");
    const lateSlots = targetSlots.filter((s) => s > "12:00");

    if (fullQty > 0 && earlySlots.length > 0 && lateSlots.length > 0) {
      const alignedFullQty = Math.ceil(fullQty / unit) * unit;
      let earlySum = earlySlots.reduce((s, slot) => s + (allocation.get(slot) || 0), 0);

      if (earlySum < alignedFullQty) {
        let deficit = alignedFullQty - earlySum;
        const reversedLate = [...lateSlots].reverse();
        for (const lateSlot of reversedLate) {
          if (deficit <= 0) break;
          const lateQty = allocation.get(lateSlot) || 0;
          const take = Math.min(deficit, Math.floor(lateQty / unit) * unit);
          if (take > 0) {
            allocation.set(lateSlot, lateQty - take);
            deficit -= take;
          }
        }
        const lastEarly = earlySlots[earlySlots.length - 1];
        const covered = alignedFullQty - earlySum - deficit;
        if (covered > 0) {
          allocation.set(lastEarly, (allocation.get(lastEarly) || 0) + covered);
        }
      }
    }

    if (earlySlots.length > 0 && lateSlots.length > 0) {
      const earlySum = earlySlots.reduce((s, slot) => s + (allocation.get(slot) || 0), 0);
      if (earlySum === 0) {
        for (let i = lateSlots.length - 1; i >= 0; i--) {
          const lateQty = allocation.get(lateSlots[i]) || 0;
          if (lateQty >= unit) {
            allocation.set(lateSlots[i], lateQty - unit);
            allocation.set(earlySlots[earlySlots.length - 1], unit);
            break;
          }
        }
      }
    }

    for (const slot of targetSlots) {
      const qty = allocation.get(slot) || 0;
      if (qty > 0) {
        slotSuggestions.push({
          productName: product.productName,
          timeSlot: slot,
          quantity: qty,
          amount: Math.round(qty * product.price),
        });
      }
    }
  }

  return slotSuggestions;
}

function distributeByProportion(
  totalQty: number,
  slotAvgs: Map<string, number>,
  histTotal: number,
  multiple: number,
  unitType: "batch" | "individual"
): Map<string, number> {
  const slots = Array.from(slotAvgs.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const n = slots.length;
  const unit = (unitType === "batch" && multiple > 1) ? multiple : 1;

  const allocated = new Array(n).fill(0);

  if (histTotal > 0) {
    let guaranteed = 0;
    for (let i = 0; i < n; i++) {
      if (slots[i][1] > 0 && totalQty >= guaranteed + unit) {
        allocated[i] = unit;
        guaranteed += unit;
      }
    }

    const remaining = totalQty - guaranteed;
    if (remaining > 0) {
      for (let i = 0; i < n; i++) {
        const raw = (remaining * slots[i][1]) / histTotal;
        const extra = Math.floor(raw / unit) * unit;
        allocated[i] += extra;
      }

      let leftover = totalQty - allocated.reduce((s, v) => s + v, 0);
      if (leftover > 0) {
        const losses = slots.map((s, i) => ({
          idx: i,
          loss: (remaining * s[1]) / histTotal - (allocated[i] - (slots[i][1] > 0 ? unit : 0)),
        }));
        losses.sort((a, b) => b.loss - a.loss);

        for (const { idx } of losses) {
          if (leftover <= 0) break;
          if (leftover >= unit) {
            allocated[idx] += unit;
            leftover -= unit;
          }
        }
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      allocated[i] = Math.floor(totalQty / n / unit) * unit;
    }
    let leftover = totalQty - allocated.reduce((s, v) => s + v, 0);
    for (let i = 0; i < n && leftover >= unit; i++) {
      allocated[i] += unit;
      leftover -= unit;
    }
  }

  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    result.set(slots[i][0], Math.max(0, allocated[i]));
  }
  return result;
}
