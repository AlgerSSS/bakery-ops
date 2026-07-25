import {
  DailyTarget,
  ProductSuggestion,
  PlanningRules,
  TimeslotSalesRecord,
  TimeSlotSuggestion,
} from "../types";

/**
 * 从近 4 周同日型的 hourly_sales_summary bill_count 曲线中选出销量占比最高的 2 个小时，
 * 作为无历史品项的默认上架时段。无数据/无正值时回落 ["11:00"]。纯函数，曲线由调用方传入。
 */
export function selectDefaultTimeSlots(
  hourlyCurve?: Array<{ hour: number; billCount: number }>
): string[] {
  if (!hourlyCurve || hourlyCurve.length === 0) return ["11:00"];
  const byHour = new Map<number, number>();
  for (const r of hourlyCurve) {
    if (!Number.isInteger(r.hour) || r.hour < 0 || r.hour > 23) continue;
    byHour.set(r.hour, (byHour.get(r.hour) || 0) + (r.billCount || 0));
  }
  const top = Array.from(byHour.entries())
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([hour]) => `${String(hour).padStart(2, "0")}:00`)
    .sort();
  return top.length > 0 ? top : ["11:00"];
}

export function calculateTimeSlotSuggestions(
  productSuggestions: ProductSuggestion[],
  dailyTarget: DailyTarget,
  planningRules: PlanningRules,
  timeslotHistory?: TimeslotSalesRecord[],
  defaultSlots?: string[],
  // P1：单品真实逐时曲线(中文名键，来自 item_hourly_sales)。有则取代对不上名、恒等分的老路。
  productHourly?: Map<string, Record<number, number>>
): TimeSlotSuggestion[] {
  const fixedSchedule = planningRules.fixedShipmentSchedule || {};
  const { dayType } = dailyTarget;

  // 逐时曲线优先用「单品真实小时销量」(中文名键)；无则回落老 timeslotHistory(英文名，多对不上)。
  const historyMap = new Map<string, Map<string, number>>();
  if (productHourly) {
    for (const [name, hours] of productHourly) {
      const sm = new Map<string, number>();
      for (const [h, q] of Object.entries(hours)) {
        const hn = Number(h);
        if (q > 0 && hn >= 0 && hn <= 23) sm.set(`${String(hn).padStart(2, "0")}:00`, q);
      }
      if (sm.size) historyMap.set(name, sm);
    }
  }
  if (timeslotHistory && timeslotHistory.length > 0) {
    for (const r of timeslotHistory) {
      if (r.dayType !== dayType) continue;
      if (historyMap.has(r.productName)) continue; // 真实曲线优先
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

    // DB「出货时间」(fixed_shipment_schedule)优先——只在排期的时段出货；无排期才回落真实曲线/默认。
    let targetSlots: string[];
    let usingSchedule = false;
    if (schedule && schedule.length > 0) {
      targetSlots = [...schedule].sort();
      usingSchedule = true;
    } else if (productHistory && productHistory.size > 0) {
      targetSlots = Array.from(productHistory.keys()).sort();
    } else {
      targetSlots = (defaultSlots && defaultSlots.length > 0) ? defaultSlots : ["11:00"];
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

    // 每个排期时段的权重：按排期出货时，权重=该次覆盖窗口[本次→下次排期)内真实销量之和
    // (首个覆盖其之前全部、末个覆盖其之后全部)，比只取排期整点的销量更贴合"这批货要卖到下批"。
    const slotAvgs = new Map<string, number>();
    let hasHistory = false;
    if (usingSchedule && productHistory && productHistory.size > 0) {
      for (let i = 0; i < targetSlots.length; i++) {
        const lo = i === 0 ? "00:00" : targetSlots[i];
        const hi = i === targetSlots.length - 1 ? "99:99" : targetSlots[i + 1];
        let w = 0;
        for (const [slot, q] of productHistory) if (slot >= lo && slot < hi) w += q;
        slotAvgs.set(targetSlots[i], w);
        if (w > 0) hasHistory = true;
      }
    } else {
      for (const slot of targetSlots) {
        const avg = productHistory?.get(slot) || 0;
        slotAvgs.set(slot, avg);
        if (avg > 0) hasHistory = true;
      }
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
