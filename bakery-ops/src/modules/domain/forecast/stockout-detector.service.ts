// stockout-detector.service.ts — 断货自动检测（IMPROVEMENT-PLAN.md F5）。
//
// 扫昨日 item_hourly_sales：单品某小时 h 后连续零销量 + hourly_sales_summary
// 显示 h 后整店仍有单量（宁严：至少 2 个有客流的零销小时）+ 近 4 周同日型
// 该品 h 后平均日销 ≥3 → 判疑似 h 点售罄。检测规则是纯函数 detectStockoutHour，单测覆盖。
// 损失估算复用 stockout-calculator（calculateStockoutLossWithTraffic / calculateStockoutLoss），
// 分时段历史直接取近 4 周同日型 item_hourly_sales 均量（timeslot_sales_record 与
// item_hourly_sales 同源 POS 品名，此处自算保证品名一致 + 口径与检测阈值一致）；
// 单价取该品近 4 周 net_sales/qty 实际成交均价（product 表是中文标准名，POS 英文名大多对不上价）。
// 落库经 forecast-calc.repository saveOutOfStockRecords；out_of_stock_record 表无来源
// 字段，取最接近的 input_name 标 'auto'（手工录入该字段是老板原始输入文本）。
// 落库幂等：当日已有同名 product_name 记录则跳过（同时保护网页手工记录）。
// 推老板一条汇总，无检出不发；推送幂等 daily_push_log kind='stockout_detect'。
// 手工录入（网页端复盘）保留为纠错通道。

import { query } from "@/modules/shared/db/postgres";
import { logger } from "@/modules/shared/logger";
import { notifyInternal } from "@/modules/channel/internal-notify";
import { localDate } from "@/modules/channel/whatsapp/outbound.config";
import { hasPushLog, recordPushLog } from "@/modules/domain/notifications/push-log";
import { getProducts, getProductAliases } from "@/modules/data/repositories/product.repository";
import { getOutOfStockRecords, saveOutOfStockRecords } from "@/modules/data/repositories/forecast-calc.repository";
import { calculateLossSlots, calculateStockoutLoss, calculateStockoutLossWithTraffic } from "./engine/stockout-calculator";
import type { OutOfStockRecord, TimeslotSalesRecord } from "./types";

// ===== 阈值（宁严勿松：面包店存在计划性售罄，先跑两周看误报率） =====
const MIN_HIST_AVG_AFTER_QTY = 3; // 近 4 周同日型 h 后平均日销 ≥3 才值得报
const MIN_ZERO_TRAFFIC_HOURS = 2; // h 后至少 2 个"整店有单但该品零销"的小时
const MIN_HIST_DAYS = 3; // 同日型历史样本天数不足则整体跳过
const HIST_WINDOW_DAYS = 28; // 近 4 周

// ===== 检测规则（纯函数，可单测） =====

export interface StockoutDetectionInput {
  /** 昨日该品逐小时销量（无销量的小时可缺省） */
  itemQtyByHour: Record<number, number>;
  /** 昨日整店逐小时单量 bill_count */
  storeBillsByHour: Record<number, number>;
  /** 近 4 周同日型该品逐小时平均销量 */
  histAvgQtyByHour: Record<number, number>;
}

/**
 * 判定疑似售罄小时 h（h 起连续零销量）。不构成疑似断货时返回 null：
 * - 全天零销（可能当日未生产，不妄断）
 * - 卖到打烊（最后成交小时 ≥ 整店最后有单小时）
 * - h 后整店客流不足（有单的零销小时 < MIN_ZERO_TRAFFIC_HOURS，排除"全店没客流"误报）
 * - 低销量品（近 4 周同日型 h 后平均日销 < MIN_HIST_AVG_AFTER_QTY）
 */
export function detectStockoutHour(input: StockoutDetectionInput): number | null {
  const { itemQtyByHour, storeBillsByHour, histAvgQtyByHour } = input;

  const saleHours = Object.keys(itemQtyByHour).map(Number).filter((h) => (itemQtyByHour[h] || 0) > 0);
  if (saleHours.length === 0) return null;

  const trafficHours = Object.keys(storeBillsByHour).map(Number).filter((h) => (storeBillsByHour[h] || 0) > 0);
  if (trafficHours.length === 0) return null;
  const closeHour = Math.max(...trafficHours);

  const h = Math.max(...saleHours) + 1; // h 起连续零销量（由"最后成交小时"定义保证）
  if (h > closeHour) return null;

  let zeroTrafficHours = 0;
  for (let hour = h; hour <= closeHour; hour++) {
    if ((storeBillsByHour[hour] || 0) > 0) zeroTrafficHours++;
  }
  if (zeroTrafficHours < MIN_ZERO_TRAFFIC_HOURS) return null;

  let histAfter = 0;
  for (const hourStr of Object.keys(histAvgQtyByHour)) {
    if (Number(hourStr) >= h) histAfter += histAvgQtyByHour[Number(hourStr)] || 0;
  }
  if (histAfter < MIN_HIST_AVG_AFTER_QTY) return null;

  return h;
}

// ===== 推送文案（纯函数） =====

export interface StockoutSuspect {
  productName: string;
  soldoutHour: number;
  lossQty: number;
  lossAmount: number;
}

export function buildStockoutDetectText(date: string, suspects: StockoutSuspect[]): string {
  const totalLoss = suspects.reduce((sum, s) => sum + s.lossAmount, 0);
  const lines: string[] = [];
  lines.push(`⚠️ *断货检测* ${date}`);
  lines.push(`昨日疑似断货 ${suspects.length} 款，估损 RM${totalLoss}（自动检测，网页端可修正）`);
  lines.push("");
  suspects.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.productName}: ${s.soldoutHour}:00 后无销量, 估损 ${s.lossQty}个/RM${s.lossAmount}`);
  });
  return lines.join("\n");
}

// ===== 取数与编排 =====

function getDayType(dateStr: string): OutOfStockRecord["dayType"] {
  const dow = new Date(dateStr).getDay();
  if (dow === 0 || dow === 6) return "weekend";
  if (dow === 5) return "friday";
  return "mondayToThursday";
}

interface ItemHistory {
  avgQtyByHour: Record<number, number>;
  totalQty: number;
  totalNet: number;
}

interface DetectedItem {
  itemName: string;
  soldoutHour: number;
  history: ItemHistory;
}

/** POS 英文品名 → 中文标准名（尽力解析，解析不到保留原名）。参照 use-review.ts resolveProductName。 */
function resolveStandardName(
  itemName: string,
  products: Array<{ name: string; nameEn: string }>,
  aliases: Record<string, string>,
): string {
  if (products.some((p) => p.name === itemName)) return itemName;
  if (aliases[itemName]) return aliases[itemName];
  const exactEn = products.find((p) => p.nameEn && p.nameEn === itemName);
  if (exactEn) return exactEn.name;
  const fuzzyEn = products.find((p) => p.nameEn && (itemName.includes(p.nameEn) || p.nameEn.includes(itemName)));
  if (fuzzyEn) return fuzzyEn.name;
  return itemName;
}

async function detectForDate(date: string, dayType: OutOfStockRecord["dayType"]): Promise<{ detected: DetectedItem[]; txCount: number; histDays: number } | null> {
  const itemRows = await query<{ item_name: string; hour: number; qty: number }>(
    "SELECT item_name, hour, qty FROM item_hourly_sales WHERE date = $1",
    [date],
  );
  if (!itemRows.length) {
    logger.info("Stockout detect: no item_hourly_sales for date, skipping", { date });
    return null;
  }
  const billRows = await query<{ hour: number; bill_count: number }>(
    "SELECT hour, bill_count FROM hourly_sales_summary WHERE date = $1",
    [date],
  );
  if (!billRows.length) {
    logger.info("Stockout detect: no hourly_sales_summary for date, skipping", { date });
    return null;
  }

  const dowCond =
    dayType === "friday"
      ? "EXTRACT(DOW FROM date) = 5"
      : dayType === "weekend"
        ? "EXTRACT(DOW FROM date) IN (0, 6)"
        : "EXTRACT(DOW FROM date) IN (1, 2, 3, 4)";
  const histDayRows = await query<{ days: string }>(
    `SELECT COUNT(DISTINCT date) AS days FROM item_hourly_sales
     WHERE date >= $1::date - ${HIST_WINDOW_DAYS} AND date < $1::date AND ${dowCond}`,
    [date],
  );
  const histDays = Number(histDayRows[0]?.days || 0);
  if (histDays < MIN_HIST_DAYS) {
    logger.info("Stockout detect: insufficient same-day-type history, skipping", { date, dayType, histDays });
    return null;
  }
  const histRows = await query<{ item_name: string; hour: number; total_qty: string; total_net: string }>(
    `SELECT item_name, hour, SUM(qty) AS total_qty, SUM(net_sales) AS total_net
     FROM item_hourly_sales
     WHERE date >= $1::date - ${HIST_WINDOW_DAYS} AND date < $1::date AND ${dowCond}
     GROUP BY item_name, hour`,
    [date],
  );

  const storeBillsByHour: Record<number, number> = {};
  let txCount = 0;
  for (const r of billRows) {
    storeBillsByHour[Number(r.hour)] = Number(r.bill_count) || 0;
    txCount += Number(r.bill_count) || 0;
  }

  const qtyByItem = new Map<string, Record<number, number>>();
  for (const r of itemRows) {
    const m = qtyByItem.get(r.item_name) || {};
    m[Number(r.hour)] = (m[Number(r.hour)] || 0) + (Number(r.qty) || 0);
    qtyByItem.set(r.item_name, m);
  }

  const histByItem = new Map<string, ItemHistory>();
  for (const r of histRows) {
    const h = histByItem.get(r.item_name) || { avgQtyByHour: {}, totalQty: 0, totalNet: 0 };
    const qty = Number(r.total_qty) || 0;
    h.avgQtyByHour[Number(r.hour)] = qty / histDays;
    h.totalQty += qty;
    h.totalNet += Number(r.total_net) || 0;
    histByItem.set(r.item_name, h);
  }

  const detected: DetectedItem[] = [];
  for (const [itemName, itemQtyByHour] of qtyByItem) {
    const history = histByItem.get(itemName);
    if (!history) continue; // 无同日型历史（新品），不妄断
    const soldoutHour = detectStockoutHour({ itemQtyByHour, storeBillsByHour, histAvgQtyByHour: history.avgQtyByHour });
    if (soldoutHour === null) continue;
    detected.push({ itemName, soldoutHour, history });
  }
  return { detected, txCount, histDays };
}

/** 入口 — 由接线 agent 挂 cron。无数据/未连接/已推送时安全 no-op。 */
export async function runStockoutDetection(): Promise<void> {
  const yesterday = localDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const dayType = getDayType(yesterday);

  let result: Awaited<ReturnType<typeof detectForDate>>;
  try {
    result = await detectForDate(yesterday, dayType);
  } catch (err) {
    logger.error("Stockout detect: detection failed", { date: yesterday, error: String(err) });
    return;
  }
  if (!result) return;
  if (!result.detected.length) {
    logger.info("Stockout detect: no suspects, nothing to send", { date: yesterday });
    return;
  }

  // 估损 + 落库（当日已有同名记录则跳过落库，保护手工记录；推送仍汇总全部检出）
  const suspects: StockoutSuspect[] = [];
  const toSave: OutOfStockRecord[] = [];
  try {
    const [products, aliases, existing] = await Promise.all([
      getProducts(),
      getProductAliases(),
      getOutOfStockRecords(yesterday),
    ]);
    const existingNames = new Set(existing.map((r) => r.productName));

    for (const d of result.detected) {
      const soldoutTime = `${d.soldoutHour}:00`;
      const record: OutOfStockRecord = {
        date: yesterday,
        productName: d.itemName, // 先用 POS 品名参与损失计算（与分时段历史同名），落库前再换标准名
        inputName: "auto",
        soldoutTime,
        soldoutSlot: `${String(d.soldoutHour).padStart(2, "0")}:00`,
        dayType,
        lossSlots: calculateLossSlots(soldoutTime),
        estimatedLossQty: 0,
        estimatedLossAmount: 0,
      };
      const timeslotHistory: TimeslotSalesRecord[] = Object.entries(d.history.avgQtyByHour).map(([hour, avg]) => ({
        productName: d.itemName,
        dayType,
        timeSlot: `${String(hour).padStart(2, "0")}:00`,
        avgQuantity: avg,
        sampleCount: result!.histDays,
      }));
      const price = d.history.totalQty > 0 ? d.history.totalNet / d.history.totalQty : 0;
      const { lossQty, lossAmount } =
        result.txCount > 0
          ? calculateStockoutLossWithTraffic(record, timeslotHistory, price, result.txCount)
          : calculateStockoutLoss(record, timeslotHistory, price);
      record.estimatedLossQty = lossQty;
      record.estimatedLossAmount = lossAmount;
      record.productName = resolveStandardName(d.itemName, products, aliases);

      suspects.push({ productName: record.productName, soldoutHour: d.soldoutHour, lossQty, lossAmount });
      if (!existingNames.has(record.productName)) toSave.push(record);
    }

    if (toSave.length) {
      await saveOutOfStockRecords(toSave);
      logger.info("Stockout detect: records saved", { date: yesterday, count: toSave.length });
    }
  } catch (err) {
    logger.error("Stockout detect: save failed", { date: yesterday, error: String(err) });
    return;
  }

  // 推老板（幂等 kind='stockout_detect'）
  const owner = process.env.OWNER_WHATSAPP || process.env.OWNER_PHONE || "";
  if (!owner) {
    logger.warn("Stockout detect: OWNER_WHATSAPP not configured, skipping push");
    return;
  }
  try {
    if (await hasPushLog("stockout_detect", owner, yesterday)) {
      logger.info("Stockout detect: already sent, skipping", { recipient: owner, date: yesterday });
      return;
    }
    const sent = await notifyInternal(owner, buildStockoutDetectText(yesterday, suspects));
    if (sent) {
      await recordPushLog("stockout_detect", owner, yesterday);
      logger.info("Stockout detect: sent", { recipient: owner, date: yesterday, suspects: suspects.length });
    } else {
      logger.error("Stockout detect: send failed", { recipient: owner });
    }
  } catch (err) {
    logger.error("Stockout detect: push failed", { recipient: owner, error: String(err) });
  }
}
