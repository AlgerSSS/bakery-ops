import { NextRequest, NextResponse } from "next/server";
import { checkImportKey } from "../_auth";
import { parseSalesData, setDatabaseAliases } from "@/modules/domain/forecast/parsers/excel-parser";
import { withTransaction } from "@/modules/shared/db/postgres";
import { getProducts, getProductAliases, getBusinessRulesFromDB, getOutOfStockRecords } from "@/modules/data/repositories/forecast.repository";
import { calculateSalesBaselines } from "@/modules/domain/forecast/forecast-engine";

export async function POST(req: NextRequest) {
  const denied = checkImportKey(req);
  if (denied) return denied;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ success: false, errors: ["No file provided"] }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const [products, dbAliases, businessRules, stockoutRecords] = await Promise.all([
      getProducts(),
      getProductAliases(),
      getBusinessRulesFromDB(),
      getOutOfStockRecords(),
    ]);

    setDatabaseAliases(dbAliases);
    const { records, unmatchedProducts } = await parseSalesData(buffer, products);

    const baselines = calculateSalesBaselines(records, products, businessRules.baselineOverrides, stockoutRecords);

    await withTransaction(async ({ execute }) => {
      await execute("DELETE FROM daily_sales_record");
      const BATCH = 500;
      for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        const placeholders = batch.map(() => "(?, ?, ?, ?, ?)").join(",");
        const flat = batch.flatMap((r) => [r.productName, r.standardName, r.quantity, r.date, r.dayOfWeek]);
        await execute(
          `INSERT INTO daily_sales_record (product_name, standard_name, quantity, date, day_of_week) VALUES ${placeholders}`,
          flat
        );
      }

      await execute("DELETE FROM product_sales_baseline");
      for (const b of baselines) {
        await execute(
          `INSERT INTO product_sales_baseline (product_name, avg_monday_to_thursday, avg_friday, avg_weekend, total_sales, day_count)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [b.productName, b.avgMondayToThursday, b.avgFriday, b.avgWeekend, b.totalSales, b.dayCount]
        );
      }
    });

    return NextResponse.json({
      success: true,
      totalRows: records.length,
      importedRows: records.length,
      skippedRows: 0,
      errors: [],
      unmatchedProducts,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(error)] },
      { status: 500 }
    );
  }
}
