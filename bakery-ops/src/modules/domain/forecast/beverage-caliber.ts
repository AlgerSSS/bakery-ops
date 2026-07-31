// beverage-caliber.ts — 「什么算现制饮品」「什么不是排产品」的口径，由 bakery-ops 自持。
//
// 【背景】口径原先寄生在 item_category.category LIKE '%饮品%'。该表归财务站所有，由
// 门店财务AI分析系统/sql/item_menu_category.sql 第 3 行 TRUNCATE 整表重灌；2026-07-07 换成
// Restosuite 英文营销分组后，这条判据静默返回 0 行 —— 近 30 天 326 条断货记录里 100 条是饮品
// 误报，水吧营业额恒报 RM0（2026-07-24 正确值 RM7186）。
// 现在口径落在 business_rule（唯一写者 = 本仓库 forecast-calc.repository.updateBusinessRule，
// 编辑入口 settings-page.tsx），item_category 从此只用于「品类结构」展示。
//
// 【三条铁律，改这个文件前先读】
// 1) 显式白名单、逐品枚举。绝不用 LIKE / 子串 / 分组前缀：
//    · 'Matcha' 会吞掉 5 款抹茶烘焙（抹茶红豆贝果/浓醇抹茶巴斯克/抹茶熔岩/京都抹茶树莓挞…）
//    · 'Iced' 会吞掉 7 款冰系贝果与冰可颂
//    · 'Coffee' 会吞掉 Berlin Volufra Coffee Pretzel、French Rich Coffee Macaron（都有报废记录）
//    · 'Chocolate series' 里混着 Thai Milk Tea Tiramisu（杯装甜品，近 30 天真实断货 13 次 RM2580）
// 2) 未知新品默认「仍然检测」。误报可见可纠错；漏判静默丢钱。
// 3) DB 查空 / 解析失败 → 回落内置常量，绝不回落成空集。
import { query } from "@/modules/shared/db/postgres";
import { logger } from "@/modules/shared/logger";

export const BEVERAGE_RULE_KEY = "beverageItems";
export const NON_PRODUCTION_RULE_KEY = "stockoutExcludeItems";

/** 现制饮品（POS 英文原样品名）。与 migrations/100_beverage_caliber.sql 保持一致。 */
export const DEFAULT_BEVERAGE_ITEMS: readonly string[] = [
  // Coffee Latte Series
  "Americano", "Latte", "Coconut Latte", "Rose Latte", "Thai Milk Latte",
  "Calpis Jasmine Breeze Cold Brew",
  // Matcha series（注意：同名词根的抹茶烘焙品不在此列）
  "Strawberry Rose Latte", "Matcha Latte", "Kyoto Matcha",
  // 'Membership Price' 桶里的冷萃（该分组是价格/会员营销桶，不是品类，所以必须逐品写死）
  "Mocha Cold Brew", "Chocolate Cold Brew", "Pistachio Cold Brew",
  "Strawberry Cold Brew", "vanilla cold brew",
  // item_category 里根本没有这一行（2026-07-20 首次出单）——任何按分类表的方案都会漏
  "Golden Tropic Cold Brew",
  // lemon tea series（手打=现场摇制）
  "Beryl Splash", "Pink Tango", "Triple Energy", "Power CRush",
  // milkshake series（Pistachio Green jewel 旧中文快照误分为「其他甜品」，此处纠正）
  "Golden Mango", "Strawberry Glaze", "Avo Matcha", "Pistachio Green jewel",
  // Chocolate series 里唯一真饮品（同组的 Thai Milk Tea Tiramisu 是甜品，故意不在此列）
  "Italian Crispy Iced Cocoa",
  // 仅见于 res_api/_drinks.json，尚未上架；预置以免上架当天误报
  "Cocoa",
];

/** 非生产品（周边商品）：不会「卖完」，永不做断货检测；【不】计入水吧营业额。 */
export const DEFAULT_NON_PRODUCTION_ITEMS: readonly string[] = [
  "Hot Crush Butterfly Fridge Magnet",
  "Hot Crush Butterfly Scent Card",
  "Hot Crush Ceramic Coffee Cup",
  "Hot Crush Dual-Layer  Coffee Cup", // POS 原样：中间两个空格，归一化会折叠
  "Hot Crush Heart Fridge Magnet",
  "Hot Crush Heart Scent Card",       // 2026-07-18 估损 RM13545 那一条
  "Hot Crush Petite Bow Earbuds Case",
  "Hot Crush Petronas Twin Towers Fridge Magnet",
  "Hot Crush Red Stripes Canvas Tote Bag",
  "Hot Crush Rosé Bloom Fridge Magnet",
  "Hot Crush Rosé Bloom Scent Card",
  "杯子",
];

/**
 * 品名归一化：折叠所有空白（含 tab 与 U+00A0）→ 单空格，trim，小写。
 * POS 品名带尾部 tab(0x09) 或 NBSP 的现象是实测存在的（Berlin Volufra 系列 6 款）。
 */
export function normCaliberName(s: string): string {
  return s.replace(/[\s ]+/g, " ").trim().toLowerCase();
}

/**
 * 与 normCaliberName 等价的 SQL 片段。
 * Postgres 的 [[:space:]] 不含 U+00A0、btrim 也只去半角空格，必须先 replace(chr(160),' ')。
 */
export const NORM_SQL = (col: string) =>
  `lower(btrim(regexp_replace(replace(${col}, chr(160), ' '), '[[:space:]]+', ' ', 'g')))`;

async function loadRuleList(key: string, fallback: readonly string[]): Promise<string[]> {
  try {
    const rows = await query<{ rule_value: string }>(
      "SELECT rule_value FROM business_rule WHERE rule_key = ?",
      [key],
    );
    const raw = rows[0]?.rule_value;
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0 && arr.every((x) => typeof x === "string")) {
        return arr as string[];
      }
    }
  } catch (e) {
    logger.warn(`business_rule.${key} 读取/解析失败，回落内置清单`, { err: String(e) });
    return [...fallback];
  }
  // 缺行、空数组、类型不对 —— 一律回落，绝不返回空集。
  logger.warn(`business_rule.${key} 缺失或为空，回落内置清单`, { fallbackSize: fallback.length });
  return [...fallback];
}

/** 现制饮品清单（POS 英文原样名）。 */
export async function getBeverageItems(): Promise<string[]> {
  return loadRuleList(BEVERAGE_RULE_KEY, DEFAULT_BEVERAGE_ITEMS);
}

/** 非生产品清单（周边商品，POS 英文原样名）。 */
export async function getNonProductionItems(): Promise<string[]> {
  return loadRuleList(NON_PRODUCTION_RULE_KEY, DEFAULT_NON_PRODUCTION_ITEMS);
}

/** 归一化后的饮品名集合，供 TS 侧 has() 判定。 */
export async function getBeverageNameSet(): Promise<Set<string>> {
  return new Set((await getBeverageItems()).map(normCaliberName));
}

/** 归一化后的非生产品名集合。 */
export async function getNonProductionNameSet(): Promise<Set<string>> {
  return new Set((await getNonProductionItems()).map(normCaliberName));
}

/**
 * 漂移探测器 —— 把「按英文分组判饮品」这个方案降级成提示，不给它判决权。
 * 报两类可疑品（只 warn，不改任何判定）：
 *   suspects  : 近 7 天出单、分类（pos_product，迁移 067 后 item_category 并入）落在六个疑似饮品组之一、但不在 beverageItems 里
 *   newcomers : 近 7 天首次出现的新 POS 品名（兜住 Golden Tropic Cold Brew 这种连分类都没有的）
 */
export async function detectBeverageCaliberDrift(
  date: string,
): Promise<{ suspects: string[]; newcomers: string[] }> {
  const BEV_GROUPS = [
    "Coffee Latte Series", "Matcha series", "lemon tea series",
    "milkshake series", "Membership Price", "Chocolate series",
  ];
  try {
    const [bevSet, nonProdSet] = await Promise.all([getBeverageNameSet(), getNonProductionNameSet()]);
    const rows = await query<{ item_name: string; category: string | null; is_new: boolean }>(
      `SELECT s.item_name,
              COALESCE(c.category_display, c.category_en, c.category_zh) AS category,
              NOT EXISTS (
                SELECT 1 FROM item_hourly_sales o
                 WHERE ${NORM_SQL("o.item_name")} = ${NORM_SQL("s.item_name")}
                   AND o.date < $1::date - 7
              ) AS is_new
         FROM item_hourly_sales s
         LEFT JOIN pos_product c ON ${NORM_SQL("c.name_en")} = ${NORM_SQL("s.item_name")}
        WHERE s.date > $1::date - 7 AND s.date <= $1::date
        GROUP BY s.item_name, c.category_display, c.category_en, c.category_zh`,
      [date],
    );
    const suspects: string[] = [];
    const newcomers: string[] = [];
    for (const r of rows) {
      const n = normCaliberName(r.item_name);
      if (bevSet.has(n) || nonProdSet.has(n)) continue;
      if (r.is_new) newcomers.push(r.item_name);
      else if (r.category && BEV_GROUPS.includes(r.category)) suspects.push(r.item_name);
    }
    if (suspects.length || newcomers.length) {
      logger.warn("饮品口径可能漏配，请到设置页确认后补进 business_rule.beverageItems", {
        date, suspects, newcomers,
      });
    }
    return { suspects, newcomers };
  } catch (e) {
    logger.warn("饮品口径漂移探测失败（不影响主流程）", { err: String(e) });
    return { suspects: [], newcomers: [] };
  }
}