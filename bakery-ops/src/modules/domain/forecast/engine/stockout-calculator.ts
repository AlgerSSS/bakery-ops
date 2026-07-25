import { OutOfStockRecord, TimeslotSalesRecord } from "../types";

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
  // 整点售罄（m===0）：该整点时段全程无货，整段计入损失，从 h 起算；
  // 整点后售罄（m>0）：该时段已有部分销售，从下一时段 h+1 起算损失。
  const nextSlotHour = m > 0 ? h + 1 : h;
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
