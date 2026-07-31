import { query, execute, withTransaction } from "@/modules/shared/db/postgres";
import type {
  Product,
  ProductStrategy,
} from "@/modules/domain/forecast/types";

// ========== DB Row Types ==========
interface ProductRow {
  id: number;
  category: string;
  name: string;
  name_en: string;
  price: number;
  pack_multiple: number;
  unit_type: string;
  display_full_quantity: number;
}

interface StrategyRow {
  id: number;
  product_name: string;
  positioning: string;
  category: string;
  cold_hot: string;
  sales_ratio: number;
  target_tc: number | null;
  audience: string;
  break_stock_time: string;
  sort_order: number;
}

interface AliasRow {
  id: number;
  alias: string;
  standard_name: string;
}

interface ProductConfigRow {
  product_name: string;
  pack_multiple: number;
  unit_type: string;
  display_full_quantity: number;
}

// ========== Converters ==========
function rowToProduct(row: ProductRow): Product {
  return {
    id: `product-${row.id}`,
    category: row.category,
    name: row.name,
    nameEn: row.name_en,
    price: row.price,
    packMultiple: row.pack_multiple,
    unitType: row.unit_type as "batch" | "individual",
    displayFullQuantity: row.display_full_quantity || 0,
  };
}

function rowToStrategy(row: StrategyRow): ProductStrategy {
  return {
    productName: row.product_name,
    positioning: row.positioning as "TOP" | "潜在TOP" | "其他",
    category: row.category,
    coldHot: row.cold_hot as "冷" | "热",
    salesRatio: row.sales_ratio,
    targetTC: row.target_tc,
    audience: row.audience,
    breakStockTime: row.break_stock_time,
    sortOrder: row.sort_order,
  };
}

// ========== Products ==========
export async function getProducts(): Promise<Product[]> {
  const rows = await query<ProductRow>("SELECT * FROM product ORDER BY id");
  return rows.map(rowToProduct);
}

export async function getStrategies(): Promise<ProductStrategy[]> {
  // 迁移 067：product_strategy 已并入 product。原表 sort_order 是 NOT NULL，
  // 用它过滤正好等价于原来的 52 行（product 里另外 2 行没有策略配置）。
  const rows = await query<StrategyRow>(
    `SELECT id, name AS product_name, positioning, category, cold_hot,
            sales_ratio, target_tc, audience, break_stock_time, sort_order
     FROM product WHERE sort_order IS NOT NULL ORDER BY sort_order, id`
  );
  return rows.map(rowToStrategy);
}

export async function getProductAliases(): Promise<Record<string, string>> {
  const rows = await query<AliasRow>("SELECT alias, standard_name FROM product_alias");
  const result: Record<string, string> = {};
  for (const row of rows) result[row.alias] = row.standard_name;
  return result;
}

export async function updateProductAlias(alias: string, standardName: string): Promise<void> {
  await execute(
    `INSERT INTO product_alias (alias, standard_name) VALUES (?, ?)
     ON CONFLICT (alias) DO UPDATE SET standard_name = EXCLUDED.standard_name`,
    [alias, standardName]
  );
}

export async function deleteProductAlias(alias: string): Promise<void> {
  await execute("DELETE FROM product_alias WHERE alias = ?", [alias]);
}

// ========== Product Config ==========
export async function getProductConfigs(): Promise<ProductConfigRow[]> {
  // product_config 在库里从不存在（迁移 067 核实），这三个列一直长在 product 上。
  return query<ProductConfigRow>(
    "SELECT name AS product_name, pack_multiple, unit_type, display_full_quantity FROM product ORDER BY name"
  );
}

export async function updateProductConfig(
  productName: string,
  packMultiple: number,
  unitType: string,
  displayFullQuantity: number
): Promise<void> {
  // 原先先写 product_config 再写 product：前者是不存在的表，第一 execute 就抛，
  // 设置页保存因此从未成功过。product 本来就是唯一落点。
  await execute(
    "UPDATE product SET pack_multiple = ?, unit_type = ?, display_full_quantity = ? WHERE name = ?",
    [packMultiple, unitType, displayFullQuantity, productName]
  );
}
