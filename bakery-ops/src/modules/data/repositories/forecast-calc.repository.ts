import { query, execute, withTransaction } from "@/modules/shared/db/postgres";
import { logger } from "@/modules/shared/logger";
import type {
  BusinessRules,
  PlanningRules,
  OutOfStockRecord,
  ImportResult,
} from "@/modules/domain/forecast/types";

// ========== DB Row Types ==========
interface BusinessRuleRow {
  id: number;
  rule_key: string;
  rule_value: string;
}

interface FixedScheduleRow {
  id: number;
  product_name: string;
  time_slots: string;
}

interface OutOfStockRow {
  id: number;
  date: string;
  product_name: string;
  input_name: string;
  soldout_time: string;
  soldout_slot: string;
  day_type: string;
  loss_slots: string;
  estimated_loss_qty: number;
  estimated_loss_amount: number;
}

// ========== Converters ==========
function rowToOutOfStock(row: OutOfStockRow): OutOfStockRecord {
  return {
    id: row.id,
    date: row.date,
    productName: row.product_name,
    inputName: row.input_name,
    soldoutTime: row.soldout_time,
    soldoutSlot: row.soldout_slot,
    dayType: row.day_type as OutOfStockRecord["dayType"],
    lossSlots: row.loss_slots ? row.loss_slots.split(",") : [],
    estimatedLossQty: row.estimated_loss_qty,
    estimatedLossAmount: row.estimated_loss_amount,
  };
}

// ========== Business Rules ==========
export async function getBusinessRulesFromDB(): Promise<BusinessRules> {
  const rows = await query<BusinessRuleRow>("SELECT rule_key, rule_value FROM business_rule");
  const map: Record<string, unknown> = {};
  for (const row of rows) {
    map[row.rule_key] = JSON.parse(row.rule_value);
  }
  return {
    firstMonthRevenue: (map.firstMonthRevenue as number) || 1640000,
    operationEnhancement: (map.operationEnhancement as number) || 0.02,
    marketEnhancement: (map.marketEnhancement as number) || 0.04,
    totalEnhancement: (map.totalEnhancement as number) || 0.06,
    monthlyCoefficients: (map.monthlyCoefficients as Record<string, number>) || {},
    weekdayWeights: (map.weekdayWeights as BusinessRules["weekdayWeights"]) || {
      mondayToThursday: 1.0, friday: 1.25, saturday: 1.55, sunday: 1.55,
    },
    shipmentFormula: (map.shipmentFormula as BusinessRules["shipmentFormula"]) || {
      tastingWasteRate: 0.06, waterBarRate: 0.11, shipmentRate: 0.95,
    },
    baselineOverrides: (map.baselineOverrides as BusinessRules["baselineOverrides"]) || {},
    prophetDowWeights: (map.prophetDowWeights as BusinessRules["prophetDowWeights"]) || undefined,
  };
}

export async function getPlanningRulesFromDB(): Promise<PlanningRules> {
  const ruleRows = await query<BusinessRuleRow>("SELECT rule_key, rule_value FROM business_rule");
  const map: Record<string, unknown> = {};
  for (const row of ruleRows) {
    map[row.rule_key] = JSON.parse(row.rule_value);
  }
  const scheduleRows = await query<FixedScheduleRow>("SELECT product_name, time_slots FROM fixed_shipment_schedule");
  const fixedShipmentSchedule: Record<string, string[]> = {};
  for (const row of scheduleRows) {
    fixedShipmentSchedule[row.product_name] = JSON.parse(row.time_slots);
  }
  return {
    timeSlots: (map.timeSlots as string[]) || ["10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00"],
    restockLeadTime: (map.restockLeadTime as PlanningRules["restockLeadTime"]) || { hot: "提前40分钟-1个小时", cold: "提前4个小时" },
    reductionLeadTime: (map.reductionLeadTime as PlanningRules["reductionLeadTime"]) || { hot: "提前2个小时", cold: "提前4个小时" },
    topPriorityRestock: (map.topPriorityRestock as boolean) ?? true,
    breakStockThresholds: (map.breakStockThresholds as Record<string, string>) || {},
    fixedShipmentSchedule,
  };
}

export async function updateBusinessRule(key: string, value: unknown): Promise<void> {
  await execute(
    `INSERT INTO business_rule (rule_key, rule_value) VALUES (?, ?)
     ON CONFLICT (rule_key) DO UPDATE SET rule_value = EXCLUDED.rule_value`,
    [key, JSON.stringify(value)]
  );
}

// ========== Out of Stock ==========
export async function getOutOfStockRecords(date?: string): Promise<OutOfStockRecord[]> {
  let sql = "SELECT * FROM out_of_stock_record";
  const params: string[] = [];
  if (date) { sql += " WHERE date = ?"; params.push(date); }
  sql += " ORDER BY date DESC, product_name";
  const rows = await query<OutOfStockRow>(sql, params);
  return rows.map(rowToOutOfStock);
}

export async function saveOutOfStockRecords(records: OutOfStockRecord[]): Promise<void> {
  for (const r of records) {
    await execute(
      `INSERT INTO out_of_stock_record (date, product_name, input_name, soldout_time, soldout_slot, day_type, loss_slots, estimated_loss_qty, estimated_loss_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.date, r.productName, r.inputName, r.soldoutTime, r.soldoutSlot, r.dayType, r.lossSlots.join(","), r.estimatedLossQty, r.estimatedLossAmount]
    );
  }
}

export async function deleteOutOfStockByDate(date: string): Promise<void> {
  await execute("DELETE FROM out_of_stock_record WHERE date = ?", [date]);
}

// ========== Fixed Shipment Schedule ==========
export async function getFixedShipmentSchedules(): Promise<Record<string, string[]>> {
  const rows = await query<FixedScheduleRow>("SELECT product_name, time_slots FROM fixed_shipment_schedule");
  const result: Record<string, string[]> = {};
  for (const row of rows) result[row.product_name] = JSON.parse(row.time_slots);
  return result;
}

export async function updateFixedShipmentSchedule(productName: string, timeSlots: string[]): Promise<void> {
  await execute(
    `INSERT INTO fixed_shipment_schedule (product_name, time_slots) VALUES (?, ?)
     ON CONFLICT (product_name) DO UPDATE SET time_slots = EXCLUDED.time_slots`,
    [productName, JSON.stringify(timeSlots)]
  );
}

export async function deleteFixedShipmentSchedule(productName: string): Promise<void> {
  await execute("DELETE FROM fixed_shipment_schedule WHERE product_name = ?", [productName]);
}

// ========== Daily Sales Total ==========
export async function getDailySalesTotal(date: string): Promise<number> {
  const revenueRows = await query<{ revenue: number }>("SELECT revenue FROM daily_revenue WHERE date = ?", [date]);
  if (revenueRows.length > 0) return Math.round(revenueRows[0].revenue);
  const rows = await query<{ product_name: string; qty: number }>(
    `SELECT standard_name as product_name, SUM(quantity) as qty FROM daily_sales_record WHERE date = ? GROUP BY standard_name`,
    [date]
  );
  if (rows.length === 0) return 0;
  const products = await query<{ name: string; price: number }>("SELECT name, price FROM product");
  const priceMap = new Map(products.map((p) => [p.name, p.price]));
  let total = 0;
  for (const r of rows) total += r.qty * (priceMap.get(r.product_name) || 0);
  return Math.round(total);
}

// ========== Scheduling Waste Rate (F7-②) ==========
/** 纯计算：报废金额 ÷ 营业额；任一无效或 ≤0 返回 null（调用方 fallback 默认值）。 */
export function computeWasteRate(wasteTotal: number | null, revenueTotal: number | null): number | null {
  const waste = Number(wasteTotal);
  const revenue = Number(revenueTotal);
  if (!Number.isFinite(waste) || !Number.isFinite(revenue) || waste <= 0 || revenue <= 0) return null;
  return waste / revenue;
}

/**
 * 实测排产报废率：近 30 天 scheduling 报废金额 ÷ 同期营业额（走金额汇总，绕开单品名匹配）。
 * 无数据返回 null。
 */
export async function getSchedulingWasteRate30d(): Promise<number | null> {
  const wasteRows = await query<{ total: string | number | null }>(
    "SELECT SUM(amount) as total FROM item_waste WHERE waste_reason = 'scheduling' AND date >= CURRENT_DATE - 30"
  );
  const revenueRows = await query<{ total: string | number | null }>(
    "SELECT SUM(revenue) as total FROM daily_revenue WHERE date >= to_char(CURRENT_DATE - 30, 'YYYY-MM-DD')"
  );
  return computeWasteRate(Number(wasteRows[0]?.total ?? 0), Number(revenueRows[0]?.total ?? 0));
}

// ========== Auto Import from Data Directory ==========
export async function autoImportFromDataDir(): Promise<{
  products: ImportResult;
  sales: ImportResult;
  strategy: ImportResult;
  timeslot: ImportResult;
}> {
  const { readFile } = await import("fs/promises");
  const path = await import("path");
  const {
    parseProductPrices,
    parseSalesData,
    parseStrategyData,
    parseTimeslotSalesData,
    parseDisplayFullQuantity,
    setDatabaseAliases,
  } = await import("@/modules/domain/forecast/parsers/excel-parser");
  const { calculateSalesBaselines } = await import("@/modules/domain/forecast/forecast-engine");
  const { getProducts, getProductAliases } = await import("./product.repository");

  const dataDir = path.join(process.cwd(), "data");

  let productResult: ImportResult;
  try {
    const buf = await readFile(path.join(dataDir, "产品价格信息与倍数.xlsx"));
    const products = await parseProductPrices(buf.buffer as ArrayBuffer);
    let dfqMap: Map<string, number> | null = null;
    try {
      const dfqBuf = await readFile(path.join(dataDir, "kl陈列满柜单品数量.xlsx"));
      dfqMap = await parseDisplayFullQuantity(dfqBuf.buffer as ArrayBuffer);
    } catch (error) {
      // file may not exist
      logger.warn("forecast-calc.repository.autoImportFromDataDir dfq file skipped", { error: String(error) });
    }
    await withTransaction(async ({ execute }) => {
      await execute("DELETE FROM product");
      for (const p of products) {
        await execute(
          `INSERT INTO product (category, name, name_en, price, pack_multiple, unit_type)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET category=EXCLUDED.category, name_en=EXCLUDED.name_en, price=EXCLUDED.price, pack_multiple=EXCLUDED.pack_multiple, unit_type=EXCLUDED.unit_type`,
          [p.category, p.name, p.nameEn, p.price, p.packMultiple, p.unitType]
        );
      }
      if (dfqMap) {
        for (const [name, qty] of dfqMap) {
          await execute("UPDATE product SET display_full_quantity = ? WHERE name = ?", [qty, name]);
        }
      }
    });
    productResult = { success: true, totalRows: products.length, importedRows: products.length, skippedRows: 0, errors: [] };
  } catch (e) {
    productResult = { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(e)] };
  }

  let strategyResult: ImportResult;
  try {
    const buf = await readFile(path.join(dataDir, "产品销售策略.xlsx"));
    const strategies = await parseStrategyData(buf.buffer as ArrayBuffer);
    await withTransaction(async ({ execute }) => {
      await execute("DELETE FROM product_strategy");
      const seen = new Set<string>();
      let sortOrder = 0;
      for (const s of strategies) {
        if (seen.has(s.productName)) continue;
        seen.add(s.productName);
        sortOrder++;
        await execute(
          `INSERT INTO product_strategy (product_name, positioning, category, cold_hot, sales_ratio, target_tc, audience, break_stock_time, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (product_name) DO UPDATE SET positioning=EXCLUDED.positioning, category=EXCLUDED.category, cold_hot=EXCLUDED.cold_hot, sales_ratio=EXCLUDED.sales_ratio, target_tc=EXCLUDED.target_tc, audience=EXCLUDED.audience, break_stock_time=EXCLUDED.break_stock_time, sort_order=EXCLUDED.sort_order`,
          [s.productName, s.positioning, s.category, s.coldHot, s.salesRatio, s.targetTC, s.audience, s.breakStockTime, sortOrder]
        );
      }
    });
    strategyResult = { success: true, totalRows: strategies.length, importedRows: strategies.length, skippedRows: 0, errors: [] };
  } catch (e) {
    strategyResult = { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(e)] };
  }

  let salesResult: ImportResult;
  try {
    const products = await getProducts();
    const dbAliases = await getProductAliases();
    setDatabaseAliases(dbAliases);
    const buf = await readFile(path.join(dataDir, "单品销售数量1.1-4.2.xlsx"));
    const { records, unmatchedProducts } = await parseSalesData(buf.buffer as ArrayBuffer, products);
    const businessRules = await getBusinessRulesFromDB();
    const stockoutRecords = await getOutOfStockRecords();
    const baselines = calculateSalesBaselines(records, products, businessRules.baselineOverrides, stockoutRecords);
    await withTransaction(async ({ execute }) => {
      await execute("DELETE FROM daily_sales_record");
      const BATCH = 500;
      for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        const placeholders = batch.map(() => "(?, ?, ?, ?, ?)").join(",");
        const flat = batch.flatMap((r) => [r.productName, r.standardName, r.quantity, r.date, r.dayOfWeek]);
        await execute(`INSERT INTO daily_sales_record (product_name, standard_name, quantity, date, day_of_week) VALUES ${placeholders}`, flat);
      }
      await execute("DELETE FROM product_sales_baseline");
      for (const b of baselines) {
        await execute(
          `INSERT INTO product_sales_baseline (product_name, avg_monday_to_thursday, avg_friday, avg_weekend, total_sales, day_count) VALUES (?, ?, ?, ?, ?, ?)`,
          [b.productName, b.avgMondayToThursday, b.avgFriday, b.avgWeekend, b.totalSales, b.dayCount]
        );
      }
    });
    salesResult = { success: true, totalRows: records.length, importedRows: records.length, skippedRows: 0, errors: [], unmatchedProducts };
  } catch (e) {
    salesResult = { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(e)] };
  }

  let timeslotResult: ImportResult;
  try {
    const products = await getProducts();
    const fs = await import("fs");
    const timeslotDir = path.join(dataDir, "时段销售");
    if (fs.existsSync(timeslotDir)) {
      const files = fs.readdirSync(timeslotDir).filter((f: string) => f.endsWith(".xlsx"));
      if (files.length > 0) {
        let allTsRecords: import("@/modules/domain/forecast/types").TimeslotSalesRecord[] = [];
        const allTsUnmatched = new Set<string>();
        for (const file of files) {
          const buf = await readFile(path.join(timeslotDir, file));
          const { records: tsRecords, unmatchedProducts: tsUnmatched } = await parseTimeslotSalesData(buf.buffer as ArrayBuffer, products);
          allTsRecords = allTsRecords.concat(tsRecords);
          for (const u of tsUnmatched) allTsUnmatched.add(u);
        }
        await withTransaction(async ({ execute }) => {
          await execute("DELETE FROM timeslot_sales_record");
          for (const r of allTsRecords) {
            await execute(
              `INSERT INTO timeslot_sales_record (product_name, day_type, time_slot, avg_quantity, sample_count) VALUES (?, ?, ?, ?, ?) ON CONFLICT (product_name, day_type, time_slot) DO UPDATE SET avg_quantity=EXCLUDED.avg_quantity, sample_count=EXCLUDED.sample_count`,
              [r.productName, r.dayType, r.timeSlot, r.avgQuantity, r.sampleCount]
            );
          }
        });
        timeslotResult = { success: true, totalRows: allTsRecords.length, importedRows: allTsRecords.length, skippedRows: 0, errors: [], unmatchedProducts: Array.from(allTsUnmatched) };
      } else {
        timeslotResult = { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: ["时段销售目录下无 xlsx 文件"] };
      }
    } else {
      timeslotResult = { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: ["时段销售目录不存在"] };
    }
  } catch (e) {
    timeslotResult = { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(e)] };
  }

  return { products: productResult, sales: salesResult, strategy: strategyResult, timeslot: timeslotResult };
}
