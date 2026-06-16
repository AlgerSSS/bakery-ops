import { query } from "@/modules/shared/db/postgres";
import { logger } from "@/modules/shared/logger";
import { getWhatsAppClient } from "@/modules/channel/whatsapp/whatsapp.client";
import dayjs from "dayjs";

/**
 * 检查 POS 销售数据新鲜度（默认关闭）。
 * 启用条件：DATA_FRESHNESS_CHECK=true 且配置了 DATABASE_URL。
 * 只读 daily_revenue 的 MAX(date)，记录日志，必要时通过 WhatsApp 提醒店主。
 * 表缺失 / DB 不可用 / WhatsApp 未就绪时降级为 no-op，绝不抛出。
 */
export async function checkDataFreshness(): Promise<void> {
  if (process.env.DATA_FRESHNESS_CHECK !== "true") return;
  if (!process.env.DATABASE_URL) return;

  let maxDate: string | null;
  try {
    const rows = await query<{ max_date: string | null }>(
      "SELECT MAX(date) AS max_date FROM daily_revenue"
    );
    maxDate = rows[0]?.max_date ?? null;
  } catch (err) {
    logger.warn("Data freshness check failed (degrading to no-op)", { error: String(err) });
    return;
  }

  const maxStaleDays = Number(process.env.DATA_FRESHNESS_MAX_STALE_DAYS || 2);
  const staleDays = maxDate === null ? Infinity : dayjs().diff(dayjs(maxDate), "day");

  if (staleDays <= maxStaleDays) {
    logger.info("Data freshness OK", { latestSalesDate: maxDate, staleDays });
    return;
  }

  logger.warn("POS sales data is stale", { latestSalesDate: maxDate, staleDays, maxStaleDays });

  const ownerId = process.env.OWNER_WHATSAPP || process.env.OWNER_PHONE || "";
  if (!ownerId) return;

  try {
    const client = getWhatsAppClient();
    if (!client.info) {
      logger.warn("WhatsApp client not ready, skipping freshness alert");
      return;
    }
    await client.sendMessage(
      ownerId,
      `⚠️ POS 销售数据已过期\n最新数据日期: ${maxDate ?? "无"}\n已停滞 ${staleDays} 天（阈值 ${maxStaleDays} 天）\n请检查 scraper / sync-to-db 是否正常`
    );
  } catch (err) {
    logger.warn("Failed to send freshness alert to WhatsApp", { error: String(err) });
  }
}
