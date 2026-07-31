import { NextRequest, NextResponse } from "next/server";
import { checkImportKey } from "../_auth";
import { parseStrategyData } from "@/modules/domain/forecast/parsers/excel-parser";
import { importStrategies } from "@/modules/data/repositories/forecast-calc.repository";

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
    const strategies = await parseStrategyData(buffer);
    // 写路径与设置页 data 目录自动导入共用（迁移 067 后策略是 product 的列）。
    const result = await importStrategies(strategies);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { success: false, totalRows: 0, importedRows: 0, skippedRows: 0, errors: [String(error)] },
      { status: 500 }
    );
  }
}
