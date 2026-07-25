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

    // 【已摘除】这里原本是 DELETE FROM daily_sales_record + DELETE FROM product_sales_baseline
    // 后整表重灌。两处都必须拆掉：
    //   · daily_sales_record 的唯一合法写者是 res_api/sync-to-db.js（按 date 逐日重写），
    //     整表清空会抹掉爬虫写的半年 POS 数据（2026-01-01 起 10364 行）。
    //   · product_sales_baseline 已由 item_hourly_sales 实时中位数取代（product-demand.ts），
    //     停写让它冻结，等观察期满后单独提 DROP 迁移。
    // Excel 导入现在只做解析与未匹配品名校验，不落库。

    return NextResponse.json({
      success: true,
      totalRows: records.length,
      importedRows: 0,
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
