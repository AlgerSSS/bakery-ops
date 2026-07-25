import ExcelJS from "exceljs";
import { Product, DailySalesRecord, ProductStrategy, TimeslotSalesRecord } from "@/modules/domain/forecast/types";
import productAliasConfig from "@/config/product-aliases.json";

const staticAliasMap: Record<string, string> = productAliasConfig.aliases;

/** Merged alias map: DB aliases override static config */
let mergedAliasMap: Record<string, string> = { ...staticAliasMap };

/** Call before import to merge DB aliases with static config (DB wins on conflict) */
export function setDatabaseAliases(dbAliases: Record<string, string>): void {
  mergedAliasMap = { ...staticAliasMap, ...dbAliases };
}

export function resolveProductName(name: string): string {
  if (!name) return "";
  const trimmed = name.trim();
  const resolved = mergedAliasMap[trimmed] || trimmed;
  // Products mapped to _REMOVED_ are discontinued
  if (resolved === "_REMOVED_") return "";
  return resolved;
}

// ========== Parse Product Prices ==========
export async function parseProductPrices(
  buffer: ArrayBuffer
): Promise<Product[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  const products: Product[] = [];

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= 1) return; // skip header
    const values = row.values as unknown[];
    const category = (values[1] as string) || "";
    const name = (values[2] as string) || "";
    const nameEn = (values[3] as string) || "";
    const price = Number(values[4]) || 0;
    const multipleRaw = values[5];

    if (!name || !price) return;

    let packMultiple = 1;
    let unitType: "batch" | "individual" = "batch";

    if (typeof multipleRaw === "string" && multipleRaw === "个") {
      unitType = "individual";
      packMultiple = 1;
    } else {
      packMultiple = Number(multipleRaw) || 1;
      unitType = "batch";
    }

    products.push({
      id: `product-${rowNum}`,
      category: category || products[products.length - 1]?.category || "",
      name: name.trim(),
      nameEn: nameEn?.trim() || "",
      price,
      packMultiple,
      unitType,
      displayFullQuantity: 0,
    });
  });

  return products;
}

// ========== Parse Display Full Quantity (满柜数量) ==========
export async function parseDisplayFullQuantity(
  buffer: ArrayBuffer
): Promise<Map<string, number>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0]; // 周一至周四 sheet
  const result = new Map<string, number>();

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= 1) return;
    const name = row.getCell(6).value as string; // column 6 = product name (Chinese)
    const qty = Number(row.getCell(9).value) || 0; // column 9 = display full quantity
    if (name && qty > 0) {
      const resolved = resolveProductName(name);
      if (resolved) {
        result.set(resolved, qty);
      }
    }
  });

  return result;
}
// ========== Parse Sales Data ==========
export async function parseSalesData(
  buffer: ArrayBuffer,
  products: Product[]
): Promise<{
  records: DailySalesRecord[];
  unmatchedProducts: string[];
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  const records: DailySalesRecord[] = [];
  const unmatchedSet = new Set<string>();
  const productNameSet = new Set(products.map((p) => p.name));

  // Non-bakery items to exclude (drinks, merchandise, etc.)
  const excludeKeywords = [
    "拿铁",
    "咖啡",
    "柠檬茶",
    "酸奶昔",
    "提拉米苏",
    "抹茶拿铁",
    "泰奶",
    "纸香片",
    "咖啡杯",
    "帆布包",
    "冰箱贴",
    "耳机包",
    "陶瓷",
    "海盐贝果",
    "罗马面包",
    "京都冰抹茶",
  ];

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= 1) return;
    const values = row.values as unknown[];
    const rawName = String(values[1] || "").trim();
    const quantity = Number(values[2]) || 0;
    const dateRaw = values[3];

    if (!rawName || rawName === "总计" || !dateRaw) return;

    // Exclude non-bakery items
    if (excludeKeywords.some((kw) => rawName.includes(kw))) return;

    const standardName = resolveProductName(rawName);

    let dateStr = "";
    if (dateRaw instanceof Date) {
      dateStr = dateRaw.toISOString().split("T")[0];
    } else if (typeof dateRaw === "string") {
      const d = new Date(dateRaw);
      if (!isNaN(d.getTime())) {
        dateStr = d.toISOString().split("T")[0];
      }
    }

    if (!dateStr) return;

    const dateObj = new Date(dateStr);
    const dayOfWeek = dateObj.getDay();

    if (!productNameSet.has(standardName)) {
      unmatchedSet.add(rawName);
      return; // Skip unmatched products — don't pollute sales fact table
    }

    records.push({
      productName: rawName,
      standardName,
      quantity,
      date: dateStr,
      dayOfWeek,
    });
  });

  // 源数据可能把同一产品同一天拆成多行（如归一到同一 product_name 的规格/冷热变体）。
  // 按 (productName, date) 求和合并为一行，匹配 UNIQUE(product_name, date) 约束，
  // 并避免在销售基线里被当成多个样本重复计数。
  const aggregated = new Map<string, DailySalesRecord>();
  for (const r of records) {
    const key = `${r.productName}__${r.date}`;
    const existing = aggregated.get(key);
    if (existing) existing.quantity += r.quantity;
    else aggregated.set(key, { ...r });
  }

  return {
    records: Array.from(aggregated.values()),
    unmatchedProducts: Array.from(unmatchedSet),
  };
}

// ========== Parse Strategy Data ==========
export async function parseStrategyData(
  buffer: ArrayBuffer
): Promise<ProductStrategy[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  const strategies: ProductStrategy[] = [];

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= 1) return;
    const values = row.values as unknown[];
    const positioning = String(values[2] || "").trim();
    const rawName = String(values[4] || "").trim();
    const coldHot = String(values[5] || "").trim();
    const salesRatio = Number(values[6]) || 0;
    const targetTCRaw = values[7];
    const audience = String(values[8] || "").trim();
    const breakStockRaw = values[9];

    if (!rawName) return;

    // Clean product name: remove trailing numbers
    const cleanName = resolveProductName(rawName);

    let targetTC: number | null = null;
    if (typeof targetTCRaw === "number") {
      targetTC = targetTCRaw;
    } else if (
      typeof targetTCRaw === "string" &&
      targetTCRaw !== "—" &&
      targetTCRaw !== "-"
    ) {
      targetTC = Number(targetTCRaw) || null;
    }

    let breakStockTime = "";
    if (breakStockRaw instanceof Date) {
      const hours = breakStockRaw.getHours();
      const minutes = breakStockRaw.getMinutes();
      breakStockTime = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
    } else if (typeof breakStockRaw === "string") {
      breakStockTime = breakStockRaw.trim();
    }

    strategies.push({
      productName: cleanName,
      positioning: positioning as "TOP" | "潜在TOP" | "其他",
      category: String(values[3] || "").trim(),
      coldHot: coldHot as "冷" | "热",
      salesRatio,
      targetTC,
      audience,
      breakStockTime,
      sortOrder: rowNum - 1,
    });
  });

  return strategies;
}

// Non-bakery keywords shared across parsers
const EXCLUDE_KEYWORDS = [
  "拿铁", "咖啡", "柠檬茶", "酸奶昔", "提拉米苏", "抹茶拿铁",
  "泰奶", "纸香片", "咖啡杯", "帆布包", "冰箱贴", "耳机包",
  "陶瓷", "海盐贝果", "罗马面包", "京都冰抹茶",
];

// ========== Parse Timeslot Sales Data ==========
export async function parseTimeslotSalesData(
  buffer: ArrayBuffer,
  products: Product[]
): Promise<{ records: TimeslotSalesRecord[]; unmatchedProducts: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  const productNameSet = new Set(products.map((p) => p.name));
  const unmatchedSet = new Set<string>();

  // System time slots (map source "HH:00 ~ HH:00" to start hour "HH:00")
  const SYSTEM_SLOTS = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];

  // Accumulator: product -> dayType -> timeSlot -> { totalQty, daySet }
  const acc: Record<string, Record<string, Record<string, { totalQty: number; days: Set<string> }>>> = {};

  sheet.eachRow((row, rowNum) => {
    if (rowNum <= 1) return;
    const values = row.values as unknown[];
    const rawName = String(values[1] || "").trim();
    const quantity = Number(values[2]) || 0;
    const dateRaw = values[3];
    const slotRaw = String(values[4] || "").trim();

    if (!rawName || rawName === "总计" || !dateRaw || !slotRaw) return;
    if (EXCLUDE_KEYWORDS.some((kw) => rawName.includes(kw))) return;

    const standardName = resolveProductName(rawName);
    if (!standardName || !productNameSet.has(standardName)) {
      unmatchedSet.add(rawName);
      return;
    }

    // Parse date
    let dateStr = "";
    if (dateRaw instanceof Date) {
      dateStr = dateRaw.toISOString().split("T")[0];
    } else if (typeof dateRaw === "string") {
      const d = new Date(dateRaw);
      if (!isNaN(d.getTime())) dateStr = d.toISOString().split("T")[0];
    }
    if (!dateStr) return;

    // Determine day type
    const dow = new Date(dateStr).getDay();
    let dayType: "mondayToThursday" | "friday" | "weekend";
    if (dow === 0 || dow === 6) dayType = "weekend";
    else if (dow === 5) dayType = "friday";
    else dayType = "mondayToThursday";

    // Map time slot: "10:00 ~ 11:00" -> "10:00"
    const slotMatch = slotRaw.match(/^(\d{1,2}):00/);
    if (!slotMatch) return;
    const hour = parseInt(slotMatch[1], 10);
    const mappedSlot = `${String(hour).padStart(2, "0")}:00`;
    if (!SYSTEM_SLOTS.includes(mappedSlot)) return; // skip out-of-range slots

    // Accumulate
    if (!acc[standardName]) acc[standardName] = {};
    if (!acc[standardName][dayType]) acc[standardName][dayType] = {};
    if (!acc[standardName][dayType][mappedSlot]) {
      acc[standardName][dayType][mappedSlot] = { totalQty: 0, days: new Set() };
    }
    acc[standardName][dayType][mappedSlot].totalQty += quantity;
    acc[standardName][dayType][mappedSlot].days.add(dateStr);
  });

  // Convert to averages
  const records: TimeslotSalesRecord[] = [];
  for (const [productName, dayTypes] of Object.entries(acc)) {
    for (const [dayType, slots] of Object.entries(dayTypes)) {
      for (const [timeSlot, data] of Object.entries(slots)) {
        const sampleCount = data.days.size;
        records.push({
          productName,
          dayType: dayType as TimeslotSalesRecord["dayType"],
          timeSlot,
          avgQuantity: sampleCount > 0 ? Math.round((data.totalQty / sampleCount) * 10) / 10 : 0,
          sampleCount,
        });
      }
    }
  }

  return { records, unmatchedProducts: Array.from(unmatchedSet) };
}
