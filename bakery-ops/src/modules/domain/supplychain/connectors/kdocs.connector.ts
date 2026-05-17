import { logger } from "../../../shared/logger";
import type { CatalogItem } from "../types";

const KDOCS_AIRSCRIPT_TOKEN = process.env.KDOCS_AIRSCRIPT_TOKEN || "72bMT4o27JvQoaauRBuSPt";
const KDOCS_WEBHOOK_URL = process.env.KDOCS_WEBHOOK_URL ||
  "https://www.kdocs.cn/api/v3/ide/file/cvUrx5gtcWUf/script/V2-2kgL3YIZEFpdBhLVZZfKd1/sync_task";

// 缓存目录数据（每小时刷新）
let catalogCache: { items: CatalogItem[]; expiresAt: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * 金山文档 AirScript 连接器
 * 通过 AirScript Webhook 读取物品目录和写入订货记录
 */
export class KDocsConnector {
  /**
   * 调用 AirScript Webhook
   */
  private async callScript(argv: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(KDOCS_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "AirScript-Token": KDOCS_AIRSCRIPT_TOKEN,
      },
      body: JSON.stringify({ Context: { argv } }),
    });

    if (!res.ok) {
      throw new Error(`KDocs script call failed: ${res.status}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(`KDocs script error: ${data.error}`);
    }

    // AirScript 返回的 result 是 JSON 字符串
    if (data.data?.result && typeof data.data.result === "string") {
      try {
        return JSON.parse(data.data.result);
      } catch {
        return data.data.result;
      }
    }
    return data.data?.result;
  }

  /**
   * 读取物品目录表
   * 表格结构: col[0]=编号, col[2]=供应商, col[4]=品名, col[5]=规格
   * "常温仓-隔天送" 之后的物品走 WMS 渠道
   */
  async getCatalog(): Promise<CatalogItem[]> {
    // 检查缓存
    if (catalogCache && Date.now() < catalogCache.expiresAt) {
      return catalogCache.items;
    }

    try {
      const rawRows = await this.callScript({ action: "read_catalog" }) as unknown[][];
      if (!Array.isArray(rawRows)) {
        logger.error("KDocs: unexpected response format");
        return catalogCache?.items || [];
      }

      const catalog = this.parseRows(rawRows);
      catalogCache = { items: catalog, expiresAt: Date.now() + CACHE_TTL };
      logger.info("KDocs: loaded catalog", { count: catalog.length });
      return catalog;
    } catch (err) {
      logger.error("KDocs: failed to get catalog", { error: String(err) });
      return catalogCache?.items || [];
    }
  }

  /**
   * 解析表格行为目录项
   */
  private parseRows(rows: unknown[][]): CatalogItem[] {
    const catalog: CatalogItem[] = [];
    let currentSupplier = "";
    let isWmsSection = false;
    let itemIndex = 0;

    // 从第3行开始（跳过标题和表头）
    for (let i = 3; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const col0 = String(row[0] || "").trim(); // 编号
      const col2 = String(row[2] || "").trim(); // 供应商
      const col4 = String(row[4] || "").trim(); // 品名
      const col5 = String(row[5] || "").trim(); // 规格

      // 检测 WMS 区域分界
      if (col2.includes("常温仓") || col2.includes("冷冻仓")) {
        isWmsSection = true;
      }

      // 更新当前供应商
      if (col2 && col2 !== currentSupplier) {
        currentSupplier = col2;
      }

      // 获取品名（可能在 col4 或 col2）
      const name = col4 || "";
      if (!name) continue;

      // 跳过供应商标题行（包含 "1-" 格式的编号范围）
      if (/^\d+-\d+$/.test(name) || name.match(/^[A-Z\s]+\d+-\d+$/)) continue;

      itemIndex++;
      const no = parseInt(col0) || itemIndex;

      catalog.push({
        no,
        name,
        unit: col5 || "",
        channel: isWmsSection ? "wms" : "whatsapp",
        supplier: currentSupplier || undefined,
      });
    }

    return catalog;
  }

  /**
   * 将当日订货记录写回表格
   * 注意：当前只有一个 sheet "前场订货表"，写入会追加到末尾
   */
  async writeOrderRecord(
    date: string,
    items: Array<{ name: string; quantity: number; unit: string }>,
  ): Promise<boolean> {
    try {
      const data = items.map((item) => [date, item.name, item.quantity, item.unit]);
      const result = await this.callScript({
        action: "write_record",
        data,
        sheetName: "前场订货表",
      });

      const parsed = result as { success?: boolean; error?: string };
      if (parsed?.error) {
        logger.error("KDocs: write failed", { error: parsed.error });
        return false;
      }

      logger.info("KDocs: wrote order record", { date, itemCount: items.length });
      return true;
    } catch (err) {
      logger.error("KDocs: failed to write order record", { error: String(err) });
      return false;
    }
  }

  /**
   * 获取所有 sheet 名称
   */
  async getSheetNames(): Promise<string[]> {
    try {
      const result = await this.callScript({ action: "get_sheets" });
      return Array.isArray(result) ? result : [];
    } catch (err) {
      logger.error("KDocs: failed to get sheet names", { error: String(err) });
      return [];
    }
  }
}

export const kdocsConnector = new KDocsConnector();
