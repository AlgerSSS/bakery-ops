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
  id: number;
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
  const rows = await query<BaselineRow>("SELECT * FROM product_sales_baseline ORDER BY id");
  return rows.map(rowToBaseline);
}

// ========== Timeslot Sales ==========
export async function getTimeslotSalesRecords(dayType?: string): Promise<TimeslotSalesRecord[]> {
  let sql = "SELECT * FROM timeslot_sales_record";
  const params: string[] = [];
  if (dayType) { sql += " WHERE day_type = ?"; params.push(dayType); }
  sql += " ORDER BY product_name, time_slot";
  const rows = await query<TimeslotSalesRow>(sql, params);
  return rows.map((r) => ({
    productName: r.product_name,
    dayType: r.day_type as TimeslotSalesRecord["dayType"],
    timeSlot: r.time_slot,
    avgQuantity: r.avg_quantity,
    sampleCount: r.sample_count,
  }));
}

export async function importTimeslotSalesData(records: TimeslotSalesRecord[]): Promise<ImportResult> {
  try {
    await execute("DELETE FROM timeslot_sales_record");
    for (const r of records) {
      await execute(
        `INSERT INTO timeslot_sales_record (product_name, day_type, time_slot, avg_quantity, sample_count)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (product_name, day_type, time_slot) DO UPDATE SET avg_quantity=EXCLUDED.avg_quantity, sample_count=EXCLUDED.sample_count`,
        [r.productName, r.dayType, r.timeSlot, r.avgQuantity, r.sampleCount]
      );
    }
    return { success: true, totalRows: records.length, importedRows: records.length, skippedRows: 0, errors: [] };
  } catch (error) {
    return { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(error)] };
  }
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
