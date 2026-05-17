import { NextRequest, NextResponse } from "next/server";
import { parseSalesData, setDatabaseAliases } from "@/modules/domain/forecast/parsers/excel-parser";
import { execute } from "@/modules/shared/db/postgres";
import { getProducts, getProductAliases, getBusinessRulesFromDB } from "@/modules/data/repositories/forecast.repository";
import { calculateSalesBaselines } from "@/modules/domain/forecast/forecast-engine";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ success: false, errors: ["No file provided"] }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const [products, dbAliases, businessRules] = await Promise.all([
      getProducts(),
      getProductAliases(),
      getBusinessRulesFromDB(),
    ]);

    setDatabaseAliases(dbAliases);
    const { records, unmatchedProducts } = await parseSalesData(buffer, products);

    const baselines = calculateSalesBaselines(records, products, businessRules.baselineOverrides);

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
