import { NextRequest, NextResponse } from "next/server";
import { parseStrategyData } from "@/modules/domain/forecast/parsers/excel-parser";
import { execute } from "@/modules/shared/db/postgres";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ success: false, errors: ["No file provided"] }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const strategies = await parseStrategyData(buffer);

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
         ON CONFLICT (product_name) DO UPDATE SET positioning=EXCLUDED.positioning, category=EXCLUDED.category, cold_hot=EXCLUDED.cold_hot,
         sales_ratio=EXCLUDED.sales_ratio, target_tc=EXCLUDED.target_tc, audience=EXCLUDED.audience, break_stock_time=EXCLUDED.break_stock_time, sort_order=EXCLUDED.sort_order`,
        [s.productName, s.positioning, s.category, s.coldHot, s.salesRatio, s.targetTC, s.audience, s.breakStockTime, sortOrder]
      );
    }

    return NextResponse.json({
      success: true,
      totalRows: strategies.length,
      importedRows: strategies.length,
      skippedRows: 0,
      errors: [],
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(error)] },
      { status: 500 }
    );
  }
}
