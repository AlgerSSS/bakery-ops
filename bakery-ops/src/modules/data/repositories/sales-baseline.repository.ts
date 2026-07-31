import { query, execute, withTransaction } from "@/modules/shared/db/postgres";
import type {
  ProductSalesBaseline,
  TimeslotSalesRecord,
  ImportResult,
} from "@/modules/domain/forecast/types";

// ========== DB Row Types ==========
interface BaselineRow {
  id: number;
  product_name: string;
  avg_monday_to_thursday: number;
  avg_friday: number;
  avg_weekend: number;
  total_sales: number;
  day_count: number;
}

interface TimeslotSalesRow {
  product_name: string;
  day_type: string;
  time_slot: string;
  avg_quantity: number;
  sample_count: number;
}

// ========== Converters ==========
function rowToBaseline(row: BaselineRow): ProductSalesBaseline {
  return {
    productName: row.product_name,
    avgMondayToThursday: row.avg_monday_to_thursday,
    avgFriday: row.avg_friday,
    avgWeekend: row.avg_weekend,
    totalSales: row.total_sales,
    dayCount: row.day_count,
  };
}

// ========== Sales Baselines ==========
export async function getSalesBaselines(): Promise<ProductSalesBaseline[]> {
  // 迁移 067：product_sales_baseline 并入 product（列改名 baseline_*，内容是 2026-04-12 冻结快照）。
  const rows = await query<BaselineRow>(
    `SELECT id, name AS product_name, avg_monday_to_thursday, avg_friday, avg_weekend,
            baseline_total_sales AS total_sales, baseline_day_count AS day_count
     FROM product WHERE baseline_total_sales IS NOT NULL ORDER BY id`
  );
  return rows.map(rowToBaseline);
}

// ========== Timeslot Sales ==========
/**
 * 时段销售基线。
 *
 * 【口径】表里的 product_name 是 res_api 写入的英文 POS 名（sync-to-db.js，每晚 TRUNCATE 重灌），
 * 78 个 distinct 名与 product.name（中文）交集为 0、与 product.name_en 交集 43。
 * 而本仓库全部下游都按中文 product.name 取键，于是四处同时静默失效：
 *   · 预估单「预计销售」整行恒 0（use-export.ts），表格等于在说「今天出的货一个都卖不掉」
 *   · 试吃报废分配的中文 keyword 恒 0 命中
 *   · product-suggestion 的回落链恒 miss，直接跌到 2026-04-12 冻结的旧基线
 *   · 人工录入断货的损失估算恒 0
 * 因此在仓库出口处统一经 product.name_en 归一化翻成中文；翻不出来的保留原名。
 * **不要把翻译搬到各个调用方**——分散做正是上面那种四处同时失效的形态。
 */
export async function getTimeslotSalesRecords(dayType?: string): Promise<TimeslotSalesRecord[]> {
  /* Postgres 的 [[:space:]] 不含 U+00A0、btrim 也只去半角空格，
     不先 replace(chr(160),' ') 会漏掉尾部带 tab/NBSP 的 POS 品名。 */
  const NORM = (c: string) =>
    `lower(btrim(regexp_replace(replace(${c}, chr(160), ' '), '[[:space:]]+', ' ', 'g')))`;
  let sql =
    `SELECT COALESCE(p.name, t.product_name) AS product_name,
            t.day_type, t.time_slot, t.avg_quantity, t.sample_count
       FROM timeslot_sales_record t
       LEFT JOIN product p ON ${NORM("p.name_en")} = ${NORM("t.product_name")}`;
  const params: string[] = [];
  if (dayType) { sql += " WHERE t.day_type = ?"; params.push(dayType); }
  sql += " ORDER BY 2, t.time_slot";
  const rows = await query<TimeslotSalesRow>(sql, params);
  return rows.map((r) => ({
    productName: r.product_name,
    dayType: r.day_type as TimeslotSalesRecord["dayType"],
    timeSlot: r.time_slot,
    avgQuantity: r.avg_quantity,
    sampleCount: r.sample_count,
  }));
}

/** 近 4 周同日型的每小时 bill_count 汇总曲线（用于无历史品项的默认上架时段推断）。 */
export async function getHourlyBillCurve(
  dayType: "mondayToThursday" | "friday" | "weekend"
): Promise<{ hour: number; billCount: number }[]> {
  const dowFilter =
    dayType === "weekend" ? "IN (0, 6)"
    : dayType === "friday" ? "= 5"
    : "BETWEEN 1 AND 4";
  const rows = await query<{ hour: number; bill_count: number }>(
    `SELECT hour, SUM(bill_count)::int AS bill_count
     FROM hourly_sales_summary
     WHERE date >= CURRENT_DATE - INTERVAL '28 days'
       AND EXTRACT(DOW FROM date) ${dowFilter}
     GROUP BY hour
     ORDER BY hour`
  );
  return rows.map((r) => ({ hour: r.hour, billCount: Number(r.bill_count) }));
}

export async function hasTimeslotSalesData(): Promise<boolean> {
  const rows = await query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM timeslot_sales_record");
  return (rows[0] as { cnt: number }).cnt > 0;
}

export async function getProductSalesTrend(productNames: string[], startDate: string, endDate: string): Promise<{ product_name: string; date: string; day_of_week: number; total_qty: number }[]> {
  if (productNames.length === 0) return [];
  const placeholders = productNames.map(() => "?").join(", ");
  return query(
    `SELECT standard_name AS product_name, date, day_of_week, SUM(quantity) AS total_qty
     FROM daily_sales_record
     WHERE date >= ? AND date <= ? AND standard_name IN (${placeholders})
     GROUP BY standard_name, date, day_of_week
     ORDER BY date, standard_name`,
    [startDate, endDate, ...productNames]
  );
}
