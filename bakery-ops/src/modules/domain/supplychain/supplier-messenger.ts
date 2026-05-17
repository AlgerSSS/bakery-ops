import { logger } from "../../shared/logger";
import { getWhatsAppClient } from "../../channel/whatsapp/whatsapp.client";
import { MessageMedia } from "whatsapp-web.js";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_SUPPLIER_WHATSAPP = process.env.SUPPLIER_DEFAULT_WHATSAPP || "";

/**
 * 供应商消息发送器
 * 通过 WhatsApp 发送订货 Excel 给供应商
 */
export class SupplierMessenger {
  /**
   * 发送订货 Excel 给供应商
   */
  async sendOrderToSupplier(
    supplierWhatsappId: string | undefined,
    excelFilePath: string,
    caption: string,
  ): Promise<{ success: boolean; error?: string }> {
    const targetId = supplierWhatsappId || DEFAULT_SUPPLIER_WHATSAPP;
    if (!targetId) {
      return { success: false, error: "未配置供应商 WhatsApp ID" };
    }

    try {
      const client = getWhatsAppClient();

      // 读取 Excel 文件并转为 base64
      if (!fs.existsSync(excelFilePath)) {
        return { success: false, error: `文件不存在: ${excelFilePath}` };
      }

      const fileData = fs.readFileSync(excelFilePath);
      const base64 = fileData.toString("base64");
      const fileName = path.basename(excelFilePath);

      const media = new MessageMedia(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        base64,
        fileName,
      );

      await client.sendMessage(targetId, media, { caption });

      logger.info("Supplier messenger: sent order to supplier", {
        supplier: targetId,
        file: fileName,
      });

      return { success: true };
    } catch (err) {
      const error = String(err);
      logger.error("Supplier messenger: failed to send", { error });
      return { success: false, error: `发送失败: ${error}` };
    }
  }
}

export const supplierMessenger = new SupplierMessenger();
