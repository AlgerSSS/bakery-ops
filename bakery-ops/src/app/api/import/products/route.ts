import { NextRequest, NextResponse } from "next/server";
import { parseProductPrices, parseDisplayFullQuantity } from "@/modules/domain/forecast/parsers/excel-parser";
import { withTransaction } from "@/modules/shared/db/postgres";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ success: false, errors: ["No file provided"] }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const products = await parseProductPrices(buffer);

    // Optional: display_full_quantity file
    const dfqFile = formData.get("dfq_file") as File | null;
    const dfqMap = dfqFile ? await parseDisplayFullQuantity(await dfqFile.arrayBuffer()) : null;

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

    return NextResponse.json({
      success: true,
      totalRows: products.length,
      importedRows: products.length,
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
