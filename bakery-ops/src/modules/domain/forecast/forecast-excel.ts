import ExcelJS from "exceljs";
import { DAY_TYPE_LABELS, DOW_LABELS, ALL_SLOTS } from "@/ui/constants";
import type {
  TimeSlotSuggestion,
  ProductSuggestion,
  TimeslotSalesRecord,
  Product,
  DailyTarget,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function buildForecastExcelBuffer(opts: {
  date: string;
  dailyTarget: DailyTarget;
  productSuggestions: ProductSuggestion[];
  timeSlotSuggestions: TimeSlotSuggestion[];
  timeslotSalesRecords: TimeslotSalesRecord[];
  fixedSchedule: Record<string, string[]>;
  products: Product[];
}): Promise<Buffer> {
  const { date, dailyTarget, productSuggestions, timeSlotSuggestions, timeslotSalesRecords, fixedSchedule, products } = opts;

  const wb = new ExcelJS.Workbook();
  buildTimeSlotSheet(wb, { timeSlotSuggestions, productSuggestions, timeslotSalesRecords, fixedSchedule, products, dailyTarget, selectedDate: date });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function buildTimeSlotSheet(wb: any, opts: {
  timeSlotSuggestions: TimeSlotSuggestion[];
  productSuggestions: ProductSuggestion[];
  timeslotSalesRecords: TimeslotSalesRecord[];
  fixedSchedule: Record<string, string[]>;
  products: Product[];
  dailyTarget: DailyTarget;
  selectedDate: string;
}) {
  const { timeSlotSuggestions, productSuggestions, timeslotSalesRecords, fixedSchedule, products, dailyTarget, selectedDate } = opts;
  const ws = wb.addWorksheet(`分时段_${selectedDate}`);
  const slotHeaders = ALL_SLOTS.map((s) => s.replace(":00", "点"));
  const COL_OFFSET_QTY = 9;

  ws.columns = [
    { width: 22 }, { width: 8 }, { width: 6 }, { width: 8 }, { width: 6 }, { width: 6 }, { width: 8 }, { width: 10 },
    ...ALL_SLOTS.map(() => ({ width: 7 })),
    ...ALL_SLOTS.map(() => ({ width: 8 })),
    { width: 8 }, { width: 8 }, { width: 8 }, { width: 12 }, { width: 8 }, { width: 12 },
  ];

  const headerFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF3F4F6" } };
  const fixedSlotFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF0071E3" } };
  const sumRowFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFCE4E5" } };
  const salesRowFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEFF6FF" } };
  const remainRowFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF9FAFB" } };
  const tastingFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFFBEB" } };
  const titleFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFDBEAFE" } };
  const thinBorder = {
    top: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
    bottom: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
    left: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
    right: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
  };

  const shipmentAmount = dailyTarget.shipmentAmount;
  const dayRevenue = dailyTarget.revenue;
  const dayOfWeek = `周${DOW_LABELS[dailyTarget.dayOfWeek]}`;
  const dayTypeLabel = DAY_TYPE_LABELS[dailyTarget.dayType];
  const tastingWasteAmount = Math.round(shipmentAmount * 0.06);

  // Row 1: Title
  const titleRow = ws.addRow(["生产预估单"]);
  ws.mergeCells(1, 1, 1, 8);
  titleRow.getCell(1).font = { bold: true, size: 14 };
  titleRow.getCell(1).fill = titleFill;
  titleRow.getCell(1).alignment = { horizontal: "center" };

  // Row 2: Date & basic info
  const infoRow = ws.addRow([`日期：${selectedDate}`, "", `${dayOfWeek}（${dayTypeLabel}）`, "", "业绩预估", dayRevenue, "出货金额", shipmentAmount]);
  infoRow.eachCell((cell: any) => { cell.font = { size: 10 }; cell.border = thinBorder; });
  infoRow.getCell(5).font = { bold: true, size: 10 };
  infoRow.getCell(6).font = { bold: true, size: 10, color: { argb: "FFDC2626" } };
  infoRow.getCell(7).font = { bold: true, size: 10 };
  infoRow.getCell(8).font = { bold: true, size: 10, color: { argb: "FFDC2626" } };

  // Row 3
  const infoRow2 = ws.addRow(["", "", "", "", "试吃+排产", tastingWasteAmount, "试吃占比", "6%"]);
  infoRow2.eachCell((cell: any) => { cell.font = { size: 10 }; cell.border = thinBorder; });
  ws.addRow([]);

  // Header row
  const headerRow = ws.addRow(["品名", "定位", "冷/热", "单价", "倍数", "满柜", "总数", "金额",
    ...slotHeaders.map((s) => `${s}出货`), ...slotHeaders.map((s) => `${s}金额`),
    "试吃量", "试吃金额", "加货数量", "加货备注", "减货数量", "减货备注"]);
  headerRow.eachCell((cell: any) => {
    cell.fill = headerFill; cell.font = { bold: true, size: 9, color: { argb: "FF6B7280" } };
    cell.border = thinBorder; cell.alignment = { horizontal: "center" };
  });
  headerRow.getCell(1).alignment = { horizontal: "left" };

  // Build pivot data
  const productNames = [...new Set(productSuggestions.map((p) => p.productName))];
  const slotMap = new Map<string, Map<string, TimeSlotSuggestion>>();
  for (const s of timeSlotSuggestions) {
    if (!slotMap.has(s.productName)) slotMap.set(s.productName, new Map());
    slotMap.get(s.productName)!.set(s.timeSlot, s);
  }
  const productInfoMap = new Map<string, ProductSuggestion>();
  for (const p of productSuggestions) productInfoMap.set(p.productName, p);
  const fullQtyMap = new Map<string, number>();
  for (const p of products) fullQtyMap.set(p.name, p.displayFullQuantity);
  const priceMap = new Map<string, number>();
  for (const p of productSuggestions) priceMap.set(p.productName, p.price);

  // Product rows
  for (const name of productNames) {
    const info = productInfoMap.get(name);
    const schedule = fixedSchedule[name] || [];
    const productSlots = timeSlotSuggestions.filter((s) => s.productName === name);
    const totalQty = productSlots.reduce((sum, s) => sum + s.quantity, 0);
    const totalAmount = productSlots.reduce((sum, s) => sum + s.amount, 0);
    const slotQtyValues = ALL_SLOTS.map((slot) => { const data = slotMap.get(name)?.get(slot); return data && data.quantity > 0 ? data.quantity : ""; });
    const slotAmtValues = ALL_SLOTS.map((slot) => { const data = slotMap.get(name)?.get(slot); return data && data.amount > 0 ? data.amount : ""; });
    const row = ws.addRow([name, info?.positioning ?? "", info?.coldHot ?? "", info?.price ?? "", info?.packMultiple ?? "", fullQtyMap.get(name) ?? "", totalQty, totalAmount, ...slotQtyValues, ...slotAmtValues, "", "", "", "", "", ""]);
    row.eachCell((cell: any, colNumber: number) => { cell.border = thinBorder; cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" }; cell.font = { size: 10 }; });
    ALL_SLOTS.forEach((slot, idx) => {
      if (schedule.includes(slot)) { const cell = row.getCell(COL_OFFSET_QTY + idx); cell.fill = fixedSlotFill; cell.font = { bold: true, size: 10 }; }
    });
  }

  // 合计 row
  const sumSlotQtyValues = ALL_SLOTS.map((slot) => timeSlotSuggestions.filter((s) => s.timeSlot === slot).reduce((sum, s) => sum + s.quantity, 0) || "");
  const sumSlotAmtValues = ALL_SLOTS.map((slot) => timeSlotSuggestions.filter((s) => s.timeSlot === slot).reduce((sum, s) => sum + s.amount, 0) || "");
  const sumRow = ws.addRow(["合计", "", "", "", "", "", timeSlotSuggestions.reduce((s, item) => s + item.quantity, 0), timeSlotSuggestions.reduce((s, item) => s + item.amount, 0), ...sumSlotQtyValues, ...sumSlotAmtValues]);
  sumRow.eachCell((cell: any) => { cell.fill = sumRowFill; cell.font = { bold: true, size: 10 }; cell.border = thinBorder; cell.alignment = { horizontal: "center" }; });
  sumRow.getCell(1).alignment = { horizontal: "left" };

  // 预计销售 row
  let estimatedSalesTotal = 0;
  const salesSlotValues = ALL_SLOTS.map((slot) => {
    if (slot < "12:00") return "";
    const amt = Math.round(timeslotSalesRecords.filter((r) => r.timeSlot === slot).reduce((sum, r) => sum + r.avgQuantity * (priceMap.get(r.productName) ?? 0), 0));
    estimatedSalesTotal += amt;
    return amt || "";
  });
  const salesRow = ws.addRow(["预计销售", "", "", "", "", "", "", estimatedSalesTotal || "", ...salesSlotValues]);
  salesRow.eachCell((cell: any) => { cell.fill = salesRowFill; cell.font = { size: 10, color: { argb: "FF1D4ED8" } }; cell.border = thinBorder; cell.alignment = { horizontal: "center" }; });
  salesRow.getCell(1).alignment = { horizontal: "left" };

  // 预计剩余 row
  const shipmentTotal = timeSlotSuggestions.reduce((s, item) => s + item.amount, 0);
  let cumulativeShipment = 0;
  let cumulativeSales = 0;
  const remainSlotValues = ALL_SLOTS.map((slot, idx) => {
    const slotShipment = timeSlotSuggestions.filter((s) => s.timeSlot === slot).reduce((sum, s) => sum + s.amount, 0);
    cumulativeShipment += slotShipment;
    const salesVal = typeof salesSlotValues[idx] === "number" ? salesSlotValues[idx] as number : 0;
    cumulativeSales += salesVal;
    if (cumulativeShipment === 0 && cumulativeSales === 0) return "";
    return cumulativeShipment - cumulativeSales;
  });
  const remainRow = ws.addRow(["预计剩余", "", "", "", "", "", "", shipmentTotal - estimatedSalesTotal, ...remainSlotValues]);
  remainRow.eachCell((cell: any, colNumber: number) => {
    cell.fill = remainRowFill; cell.border = thinBorder; cell.alignment = { horizontal: "center" };
    const val = cell.value as number;
    if (colNumber >= 8 && typeof val === "number") cell.font = { size: 10, color: { argb: val < 0 ? "FFEF4444" : "FF16A34A" } };
    else cell.font = { size: 10 };
  });
  remainRow.getCell(1).alignment = { horizontal: "left" };

  // 门店陈列 row
  const displaySlotValues = ALL_SLOTS.map((slot) => {
    const slotAmt = timeSlotSuggestions.filter((s) => s.timeSlot === slot).reduce((sum, s) => {
      const fq = fullQtyMap.get(s.productName) ?? 0;
      const price = priceMap.get(s.productName) ?? 0;
      return sum + fq * price;
    }, 0);
    return slotAmt > 0 ? slotAmt : "";
  });
  const displayTotal = products.reduce((sum, p) => sum + p.displayFullQuantity * p.price, 0);
  const displayRow = ws.addRow(["门店陈列(满柜金额)", "", "", "", "", "", "", displayTotal || "", ...displaySlotValues]);
  displayRow.eachCell((cell: any) => {
    cell.fill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF0FDF4" } };
    cell.font = { size: 10, color: { argb: "FF16A34A" } }; cell.border = thinBorder; cell.alignment = { horizontal: "center" };
  });
  displayRow.getCell(1).alignment = { horizontal: "left" };

  // 试吃报废表格
  const tastingProducts = [
    { name: "蛋挞", keyword: "蛋挞", rate: 0.015 },
    { name: "马卡龙", keyword: "马卡龙", rate: 0.015 },
    { name: "坚果棒", keyword: "坚果棒", rate: 0.01 },
  ];
  const wasteRate = 0.02;
  const activeSlots = ALL_SLOTS.filter((s) => s >= "12:00");
  const productSlotSales: Record<string, Record<string, number>> = {};
  for (const tp of tastingProducts) {
    productSlotSales[tp.name] = {};
    for (const slot of activeSlots) {
      const sales = timeslotSalesRecords.filter((r) => r.timeSlot === slot && r.productName.includes(tp.keyword)).reduce((sum, r) => sum + r.avgQuantity * (priceMap.get(r.productName) ?? 0), 0);
      productSlotSales[tp.name][slot] = sales;
    }
  }
  const slotAssignment: Record<string, string> = {};
  for (const slot of activeSlots) {
    let bestProduct = ""; let bestSales = 0;
    for (const tp of tastingProducts) { const sales = productSlotSales[tp.name][slot]; if (sales > bestSales) { bestSales = sales; bestProduct = tp.name; } }
    if (bestProduct) slotAssignment[slot] = bestProduct;
  }
  const getSalesForSlot = (slot: string): number => { const idx = ALL_SLOTS.indexOf(slot); const v = salesSlotValues[idx]; return typeof v === "number" ? v : 0; };
  const productAssignedSlots: Record<string, string[]> = {};
  for (const tp of tastingProducts) productAssignedSlots[tp.name] = [];
  for (const [slot, pName] of Object.entries(slotAssignment)) productAssignedSlots[pName].push(slot);
  for (const tp of tastingProducts) {
    if (productAssignedSlots[tp.name].length === 0) {
      const slotsWithSales = activeSlots.filter((s) => getSalesForSlot(s) > 0);
      productAssignedSlots[tp.name] = slotsWithSales.length > 0 ? slotsWithSales : activeSlots;
    }
  }
  const tastingSlotAmounts: Record<string, Record<string, number>> = {};
  for (const tp of tastingProducts) {
    tastingSlotAmounts[tp.name] = {};
    const totalBudget = Math.round(shipmentAmount * tp.rate);
    const slots = productAssignedSlots[tp.name];
    const slotSalesSum = slots.reduce((sum, s) => sum + getSalesForSlot(s), 0);
    for (const slot of slots) {
      const slotSales = getSalesForSlot(slot);
      tastingSlotAmounts[tp.name][slot] = slotSalesSum > 0 ? Math.round(totalBudget * slotSales / slotSalesSum) : Math.round(totalBudget / slots.length);
    }
  }

  ws.addRow([]);
  const tastingHeaderRow = ws.addRow(["试吃分配", "", "", "", "", "", "", "", ...slotHeaders]);
  tastingHeaderRow.eachCell((cell: any) => { cell.fill = tastingFill; cell.font = { bold: true, size: 10 }; cell.border = thinBorder; cell.alignment = { horizontal: "center" }; });
  tastingHeaderRow.getCell(1).alignment = { horizontal: "left" };

  const tastingPriceMap: Record<string, number> = {};
  for (const tp of tastingProducts) { const match = productSuggestions.find((p) => p.productName.includes(tp.keyword)); tastingPriceMap[tp.name] = match?.price ?? 0; }

  for (const tp of tastingProducts) {
    const totalBudget = Math.round(shipmentAmount * tp.rate);
    const unitPrice = tastingPriceMap[tp.name];
    const slotValues = ALL_SLOTS.map((slot) => { const amt = tastingSlotAmounts[tp.name][slot]; return amt && amt > 0 ? amt : ""; });
    const row = ws.addRow([tp.name, "", "", "", "", "", "", totalBudget, ...slotValues]);
    row.eachCell((cell: any, colNumber: number) => { cell.fill = tastingFill; cell.font = { size: 10 }; cell.border = thinBorder; cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" }; });
    const totalQty = unitPrice > 0 ? Math.ceil(totalBudget / unitPrice) : 0;
    const qtySlotValues = ALL_SLOTS.map((slot) => { const amt = tastingSlotAmounts[tp.name][slot]; if (!amt || amt <= 0 || unitPrice <= 0) return ""; return Math.ceil(amt / unitPrice); });
    const qtyRow = ws.addRow([`${tp.name}(个数)`, "", "", "", "", "", "", totalQty || "", ...qtySlotValues]);
    qtyRow.eachCell((cell: any, colNumber: number) => { cell.fill = tastingFill; cell.font = { size: 10, color: { argb: "FF6B7280" } }; cell.border = thinBorder; cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" }; });
  }

  const tastingSubtotal = Math.round(shipmentAmount * 0.04);
  const subtotalSlotValues = ALL_SLOTS.map((slot) => { const total = tastingProducts.reduce((sum, tp) => { const amt = tastingSlotAmounts[tp.name][slot]; return sum + (amt && amt > 0 ? amt : 0); }, 0); return total > 0 ? total : ""; });
  const subtotalRow = ws.addRow(["试吃小计", "", "", "", "", "", "", tastingSubtotal, ...subtotalSlotValues]);
  subtotalRow.eachCell((cell: any, colNumber: number) => { cell.fill = tastingFill; cell.font = { bold: true, size: 10 }; cell.border = thinBorder; cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" }; });

  const tastingSalesRow = ws.addRow(["该时段预计销售", "", "", "", "", "", "", estimatedSalesTotal || "", ...salesSlotValues]);
  tastingSalesRow.eachCell((cell: any, colNumber: number) => { cell.fill = tastingFill; cell.font = { size: 10, color: { argb: "FF1D4ED8" } }; cell.border = thinBorder; cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" }; });

  const wasteAmount = Math.round(shipmentAmount * wasteRate);
  const wasteRow = ws.addRow(["排产报废", "", "", "", "", "", "", wasteAmount]);
  wasteRow.eachCell((cell: any, colNumber: number) => { cell.fill = tastingFill; cell.font = { size: 10 }; cell.border = thinBorder; cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" }; });

  const totalLoss = Math.round(shipmentAmount * 0.06);
  const lossRow = ws.addRow(["损耗合计", "", "", "", "", "", "", totalLoss]);
  lossRow.eachCell((cell: any, colNumber: number) => { cell.fill = tastingFill; cell.font = { bold: true, size: 10 }; cell.border = thinBorder; cell.alignment = { horizontal: colNumber <= 1 ? "left" : "center" }; });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
