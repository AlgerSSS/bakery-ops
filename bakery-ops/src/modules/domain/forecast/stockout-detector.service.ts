// stockout-detector.service.ts — 断货自动检测（IMPROVEMENT-PLAN.md F5）。
//
// 判定（用户 2026-07-04 定案）：逐品看当天有无「排产报废」(item_waste waste_reason='scheduling')：
// 有报废=收工有剩余=没断货；无报废=卖光了=最后一个顾客的购买时间即断货时间；卖到打烊
// (最后成交=打烊时间)不算提前断货。检测规则是纯函数 detectStockout，单测覆盖。
// 断货时间精度：优先 item_last_sale（res_api reportId=211 + D_time 维度，分钟级），缺失回落
// item_hourly_sales 最后成交小时（小时级）。损失估算仍按整点档（分时段历史），展示/落库分钟精度。
// 损失估算复用 stockout-calculator（calculateStockoutLossWithTraffic / calculateStockoutLoss），
// 分时段历史直接取近 4 周同日型 item_hourly_sales 均量（timeslot_sales_record 与
// item_hourly_sales 同源 POS 品名，此处自算保证品名一致 + 口径与检测阈值一致）；
// 单价取该品近 4 周 net_sales/qty 实际成交均价（product 表是中文标准名，POS 英文名大多对不上价）。
// 落库经 forecast-calc.repository saveOutOfStockRecords；out_of_stock_record 表无来源
// 字段，取最接近的 input_name 标 'auto'（手工录入该字段是老板原始输入文本）。
// 落库幂等：当日已有同名 product_name 记录则跳过（同时保护网页手工记录）。
// 推给 team_member 订阅 'stockout' 的人（Lark 直发，对内只走 Lark），无检出不发；
// 推送幂等 daily_push_log kind='stockout_detect'（recipient=open_id）。
// 手工录入（网页端复盘）保留为纠错通道。

import { query } from "@/modules/shared/db/postgres";
import { logger } from "@/modules/shared/logger";
import { sendLarkToUser } from "@/modules/channel/lark/lark-messenger";
import { teamRepository } from "@/modules/data/repositories/team.repository";
import { localDate } from "@/modules/channel/whatsapp/outbound.config";
import { hasPushLog, recordPushLog } from "@/modules/domain/notifications/push-log";
import { getProducts, getProductAliases } from "@/modules/data/repositories/product.repository";
import { getOutOfStockRecords, saveOutOfStockRecords } from "@/modules/data/repositories/forecast-calc.repository";
import { calculateLossSlots, calculateStockoutLoss, calculateStockoutLossWithTraffic } from "./engine/stockout-calculator";
import type { OutOfStockRecord, TimeslotSalesRecord } from "./types";

// ===== 阈值（仅损失估算用；断货判定不看历史） =====
const MIN_HIST_DAYS = 3; // 同日型历史样本不足则损失估算降级（不影响断货判定）
const HIST_WINDOW_DAYS = 28; // 近 4 周（损失估算用）

// ===== 检测规则（纯函数，可单测） =====
// 逻辑（用户 2026-07-04）：断货 = 该品当天「非饮品」+「无排产报废」+ 有销量 + 最后成交时间 < 打烊时间。
//   · 饮品类（现制，item_category 品类含"饮品"）→ 永不做断货检测（用户 2026-07-05）。
//   · 有排产报废 → 收工有剩余 → 没断货。
//   · 无排产报废 → 卖光了 → 最后一个顾客的购买(分钟)即断货时间。
//   · 卖到打烊（最后成交 = 打烊时间）→ 全天有货，不算提前断货。
// 精度：优先 item_last_sale（reportId=211 + D_time 维度，分钟级）；缺失时回落
//   item_hourly_sales 的最后成交小时（小时级）。时间统一用「自 00:00 起的分钟数」比较。

export interface StockoutDetectionInput {
  /** 当天该品最后成交时间（自 00:00 起分钟数）；当天无销量传 null */
  lastSaleMinutes: number | null;
  /** 整店打烊时间（分钟数）= 当天最后一笔成交 */
  closeMinutes: number;
  /** 当天该品是否有排产报废 */
  hasSchedulingWaste: boolean;
  /** 是否饮品类（现制，永不做断货检测） */
  isBeverage: boolean;
}

/** 返回断货时间（= 最后成交分钟数）；非断货返回 null。 */
export function detectStockout(input: StockoutDetectionInput): number | null {
  const { lastSaleMinutes, closeMinutes, hasSchedulingWaste, isBeverage } = input;
  if (isBeverage) return null; // 饮品(现制) → 不适用断货检测
  if (hasSchedulingWaste) return null; // 有排产报废 → 有剩余 → 没断货
  if (lastSaleMinutes == null) return null; // 当天无销量
  if (lastSaleMinutes >= closeMinutes) return null; // 卖到打烊 → 不算提前断货
  return lastSaleMinutes; // 断货时间 = 最后成交分钟
}

/** 分钟数 → "HH:MM"。 */
export function minutesToHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

// ===== 推送文案（纯函数） =====

export interface StockoutSuspect {
  productName: string;
  soldoutTime: string; // "HH:MM" 断货(最后成交)时间
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
    lines.push(`${i + 1}. ${s.productName}: 最后成交 ${s.soldoutTime}, 之后断货, 估损 ${s.lossQty}个/RM${s.lossAmount}`);
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
  soldoutMinutes: number;
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

/** 品名归一化（折叠空白含 U+00A0 + trim + 小写），与 item_category 落库口径一致，用于品类匹配。 */
function normItemName(s: string): string {
  return s.replace(/[\s ]+/g, " ").trim().toLowerCase();
}

async function detectForDate(date: string, dayType: OutOfStockRecord["dayType"]): Promise<{ detected: DetectedItem[]; txCount: number; histDays: number } | null> {
  // 整店客流(txCount, 供带客流损失估算)
  const billRows = await query<{ bill_count: number }>(
    "SELECT bill_count FROM hourly_sales_summary WHERE date = $1",
    [date],
  );
  let txCount = 0;
  for (const r of billRows) txCount += Number(r.bill_count) || 0;

  // 每品「最后成交时间」(分钟)：优先 item_last_sale(分钟级)，缺失回落 item_hourly_sales(小时级)。
  // 打烊时间统一取「当天最后一笔单品成交」(两条路径同源同口径，避免因数据源不同产生不一致判定)。
  const lastSaleByItem = new Map<string, number>();
  let closeMinutes = 0;
  const lastSaleRows = await query<{ item_name: string; mins: string }>(
    "SELECT item_name, (EXTRACT(HOUR FROM last_sale_time) * 60 + EXTRACT(MINUTE FROM last_sale_time))::int AS mins FROM item_last_sale WHERE date = $1",
    [date],
  );
  if (lastSaleRows.length) {
    for (const r of lastSaleRows) {
      const m = Number(r.mins);
      lastSaleByItem.set(r.item_name, m);
      if (m > closeMinutes) closeMinutes = m;
    }
  } else {
    // 回落：item_hourly_sales 最后成交小时 × 60；打烊 = 所有单品里最晚的最后成交小时（与主路径同口径）。
    const itemRows = await query<{ item_name: string; hour: number; qty: number }>(
      "SELECT item_name, hour, qty FROM item_hourly_sales WHERE date = $1",
      [date],
    );
    if (!itemRows.length) {
      logger.info("Stockout detect: 当天既无 item_last_sale 也无 item_hourly_sales，跳过", { date });
      return null;
    }
    const maxHour = new Map<string, number>();
    for (const r of itemRows) {
      if (Number(r.qty) > 0) {
        const h = Number(r.hour);
        if (h > (maxHour.get(r.item_name) ?? -1)) maxHour.set(r.item_name, h);
      }
    }
    for (const [name, h] of maxHour) {
      lastSaleByItem.set(name, h * 60);
      if (h * 60 > closeMinutes) closeMinutes = h * 60;
    }
    logger.info("Stockout detect: item_last_sale 缺失，回落小时级口径", { date, items: lastSaleByItem.size, closeMinutes });
  }
  if (!lastSaleByItem.size) {
    logger.info("Stockout detect: 当天无有效成交，跳过", { date });
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
    logger.info("Stockout detect: 同日型历史不足，损失估算降级（不影响断货判定）", { date, dayType, histDays });
  }
  const histRows = histDays > 0
    ? await query<{ item_name: string; hour: number; total_qty: string; total_net: string }>(
        `SELECT item_name, hour, SUM(qty) AS total_qty, SUM(net_sales) AS total_net
         FROM item_hourly_sales
         WHERE date >= $1::date - ${HIST_WINDOW_DAYS} AND date < $1::date AND ${dowCond}
         GROUP BY item_name, hour`,
        [date],
      )
    : [];

  // 当天有排产报废(scheduling)的品名 → 收工还有剩余 → 判「没断货」
  const wasteRows = await query<{ item_name: string }>(
    "SELECT item_name FROM item_waste WHERE date = $1 AND waste_reason = 'scheduling' GROUP BY item_name HAVING SUM(qty) > 0",
    [date],
  );
  const schedulingWasteSet = new Set(wasteRows.map((r) => r.item_name));

  // 饮品类（item_category 品类含"饮品"，如 咖啡饮品/特调饮品）→ 永不做断货检测（现制，用户 2026-07-05）。
  // 与销售品名做归一化匹配。item_category 缺失/未映射的新品不视为饮品（仍会检测，需补品类）。
  const bevRows = await query<{ item_name: string }>(
    "SELECT item_name FROM item_category WHERE category LIKE '%饮品%'",
    [],
  );
  const beverageSet = new Set(bevRows.map((r) => normItemName(r.item_name)));

  const histByItem = new Map<string, ItemHistory>();
  for (const r of histRows) {
    const h = histByItem.get(r.item_name) || { avgQtyByHour: {}, totalQty: 0, totalNet: 0 };
    const qty = Number(r.total_qty) || 0;
    h.avgQtyByHour[Number(r.hour)] = qty / histDays;
    h.totalQty += qty;
    h.totalNet += Number(r.total_net) || 0;
    histByItem.set(r.item_name, h);
  }

  const EMPTY_HIST: ItemHistory = { avgQtyByHour: {}, totalQty: 0, totalNet: 0 };
  const detected: DetectedItem[] = [];
  for (const [itemName, lastSaleMinutes] of lastSaleByItem) {
    const soldoutMinutes = detectStockout({
      lastSaleMinutes,
      closeMinutes,
      hasSchedulingWaste: schedulingWasteSet.has(itemName),
      isBeverage: beverageSet.has(normItemName(itemName)),
    });
    if (soldoutMinutes === null) continue;
    detected.push({ itemName, soldoutMinutes, history: histByItem.get(itemName) || EMPTY_HIST });
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
      const soldoutHour = Math.floor(d.soldoutMinutes / 60); // 损失估算按整点档
      const soldoutTime = minutesToHHMM(d.soldoutMinutes); // 展示/落库=分钟精度（断货时间）
      const record: OutOfStockRecord = {
        date: yesterday,
        productName: d.itemName, // 先用 POS 品名参与损失计算（与分时段历史同名），落库前再换标准名
        inputName: "auto",
        soldoutTime,
        soldoutSlot: `${String(soldoutHour).padStart(2, "0")}:00`,
        dayType,
        // 损失从「最后成交小时之后」算起：该小时本身有成交，不计入损失
        lossSlots: calculateLossSlots(`${soldoutHour + 1}:00`),
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
      // 无可估损失 → 卖到营业结束(最后成交在营业末档)或无历史，不算真断货，不推不存。
      // 营业时段建模到 21:00(BUSINESS_SLOTS)，故卖到 21:00/22:00 打烊的品损失为 0，自然被此滤除。
      if (lossQty <= 0) continue;
      record.estimatedLossQty = lossQty;
      record.estimatedLossAmount = lossAmount;
      record.productName = resolveStandardName(d.itemName, products, aliases);

      suspects.push({ productName: record.productName, soldoutTime, lossQty, lossAmount });
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

  if (!suspects.length) {
    logger.info("Stockout detect: 检出均无可估损失，跳过推送", { date: yesterday });
    return;
  }

  // 推给 team_member 订阅 'stockout' 的人（Lark 直发，对内只走 Lark；幂等 kind='stockout_detect'）
  const openIds = await teamRepository.getSubscriberOpenIds("stockout");
  if (!openIds.length) {
    logger.error("Stockout detect: 无有效收件人(team_member 无 stockout 订阅者)");
    return;
  }
  const text = buildStockoutDetectText(yesterday, suspects);
  for (const openId of openIds) {
    try {
      if (await hasPushLog("stockout_detect", openId, yesterday)) {
        logger.info("Stockout detect: already sent, skipping", { openId, date: yesterday });
        continue;
      }
      const sent = await sendLarkToUser(openId, text);
      if (sent) {
        await recordPushLog("stockout_detect", openId, yesterday);
        logger.info("Stockout detect: sent", { openId, date: yesterday, suspects: suspects.length });
      } else {
        logger.error("Stockout detect: send failed", { openId });
      }
    } catch (err) {
      logger.error("Stockout detect: push failed", { openId, error: String(err) });
    }
  }
}
