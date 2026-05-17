import * as fs from "fs";
import * as path from "path";
import { logger } from "../../shared/logger";
import type { OrderItem } from "./types";

const TEMPLATE_PATH = process.env.ORDER_EXCEL_TEMPLATE || "./templates/order-template.xlsx";
const OUTPUT_DIR = "./tmp/orders";

/**
 * Excel 模板填充器
 * 读取订货模板 → 填入数据 → 另存为新文件
 */
export class ExcelFiller {
  /**
   * 填充订货模板并保存
   * @returns 生成的文件路径
   */
  async fillOrderTemplate(
    items: OrderItem[],
    storeName: string,
    date: string,
  ): Promise<string | null> {
    try {
      // 确保输出目录存在
      if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      }

      const workbook = new (await import("exceljs")).default.Workbook();

      // 尝试读取模板，如果不存在则创建新的
      if (fs.existsSync(TEMPLATE_PATH)) {
        await workbook.xlsx.readFile(TEMPLATE_PATH);
      } else {
        logger.warn("Excel template not found, creating from scratch", { path: TEMPLATE_PATH });
      }

      let sheet = workbook.getWorksheet(1);
      if (!sheet) {
        sheet = workbook.addWorksheet("订货单");
      }

      // 写入表头信息
      sheet.getCell("A1").value = `订货单 - ${storeName}`;
      sheet.getCell("A2").value = `日期: ${date}`;

      // 写入表头行
      const headerRow = 4;
      sheet.getCell(`A${headerRow}`).value = "NO";
      sheet.getCell(`B${headerRow}`).value = "品名";
      sheet.getCell(`C${headerRow}`).value = "数量";
      sheet.getCell(`D${headerRow}`).value = "单位";
      sheet.getCell(`E${headerRow}`).value = "备注";

      // 写入物品数据
      for (let i = 0; i < items.length; i++) {
        const row = headerRow + 1 + i;
        const item = items[i];
        sheet.getCell(`A${row}`).value = item.catalogNo || i + 1;
        sheet.getCell(`B${row}`).value = item.name;
        sheet.getCell(`C${row}`).value = item.quantity;
        sheet.getCell(`D${row}`).value = item.unit;
        sheet.getCell(`E${row}`).value = item.supplier || "";
      }

      // 保存文件
      const fileName = `order_${storeName}_${date.replace(/-/g, "")}.xlsx`;
      const outputPath = path.join(OUTPUT_DIR, fileName);
      await workbook.xlsx.writeFile(outputPath);

      logger.info("Excel order file created", { path: outputPath, items: items.length });
      return outputPath;
    } catch (err) {
      logger.error("Failed to fill Excel template", { error: String(err) });
      return null;
    }
  }
}

export const excelFiller = new ExcelFiller();
