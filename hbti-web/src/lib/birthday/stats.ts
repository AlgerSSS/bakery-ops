import type { SqlRunner } from "@/lib/db/postgres";

/**
 * 会员年度消费回顾查询。数据源是 pos_member_order_item（全库最细的
 * 「谁·哪天·买了什么」）+ pos_product（商品名）。口径纪律：
 * - 重复行已按 (order_id, item_key) 在同步侧 SUM 合并，这里直接 SUM，绝不去重；
 * - net_sales 是 RES 净额口径，不与储值卡核销金额对账；
 * - 商品名只 join 不存，改名不会产生历史漂移。
 */

export interface BirthdayTopItem {
  nameZh: string | null;
  nameEn: string | null;
  categoryZh: string | null;
  qty: number;
  netSales: number;
}

export interface BirthdayMonthSlice {
  /** YYYY-MM */
  month: string;
  netSales: number;
  visits: number;
}

export interface BirthdayYearStats {
  year: number;
  totalQty: number;
  totalNetSales: number;
  orderCount: number;
  distinctProducts: number;
  activeMonths: number;
  topItems: BirthdayTopItem[];
  monthly: BirthdayMonthSlice[];
  /** 年度「最爱」= 按数量排的第一名。 */
  favorite: BirthdayTopItem | null;
}

export interface BirthdayMemberBasics {
  memberId: string;
  levelName: string | null;
  pointBalance: number | null;
  registeredOn: string | null;
  maskedPhone: string | null;
}

export async function readMemberBasics(
  sql: SqlRunner,
  memberId: string,
): Promise<BirthdayMemberBasics | null> {
  const rows = await sql`
    SELECT member_id, level_name, point_balance,
           registered_on::text AS registered_on, phone_e164
      FROM public.pos_member
     WHERE member_id = ${memberId}
     LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    memberId: String(row.member_id),
    levelName: row.level_name ?? null,
    pointBalance:
      row.point_balance === null || row.point_balance === undefined
        ? null
        : Number(row.point_balance),
    registeredOn: row.registered_on ?? null,
    maskedPhone: maskPhone(row.phone_e164),
  };
}

/** 只取年度实付消费总额（等级判定的口径，与 readYearStats 的 totalNetSales 同源）。 */
export async function readAnnualSpend(
  sql: SqlRunner,
  memberId: string,
  year: number,
): Promise<number> {
  const rows = await sql`
    SELECT COALESCE(SUM(net_sales), 0)::float8 AS spend
      FROM public.pos_member_order_item
     WHERE member_id = ${memberId}
       AND business_date >= ${year + "-01-01"}::date
       AND business_date <  ${year + 1 + "-01-01"}::date
  `;
  const row = rows[0];
  return row ? Number(row.spend) : 0;
}

export async function readYearStats(
  sql: SqlRunner,
  memberId: string,
  year: number,
): Promise<BirthdayYearStats | null> {
  const from = year + "-01-01";
  const to = year + 1 + "-01-01";

  const totals = await sql`
    SELECT COALESCE(SUM(qty), 0)::float8 AS total_qty,
           COALESCE(SUM(net_sales), 0)::float8 AS total_net,
           COUNT(DISTINCT order_id)::int AS order_count,
           COUNT(DISTINCT item_key)::int AS distinct_products,
           COUNT(DISTINCT to_char(business_date, 'YYYY-MM'))::int AS active_months
      FROM public.pos_member_order_item
     WHERE member_id = ${memberId}
       AND business_date >= ${from}::date
       AND business_date <  ${to}::date
  `;
  const t = totals[0];
  if (!t || Number(t.order_count) === 0) {
    return null;
  }

  const topItems = await sql`
    SELECT p.name_zh, p.name_en, p.category_zh,
           SUM(m.qty)::float8 AS qty, SUM(m.net_sales)::float8 AS net_sales
      FROM public.pos_member_order_item m
      JOIN public.pos_product p ON p.item_key = m.item_key
     WHERE m.member_id = ${memberId}
       AND m.business_date >= ${from}::date
       AND m.business_date <  ${to}::date
     GROUP BY p.name_zh, p.name_en, p.category_zh
     ORDER BY qty DESC, net_sales DESC
     LIMIT 5
  `;

  const monthly = await sql`
    SELECT to_char(business_date, 'YYYY-MM') AS month,
           SUM(net_sales)::float8 AS net_sales,
           COUNT(DISTINCT order_id)::int AS visits
      FROM public.pos_member_order_item
     WHERE member_id = ${memberId}
       AND business_date >= ${from}::date
       AND business_date <  ${to}::date
     GROUP BY 1
     ORDER BY 1
  `;

  const items: BirthdayTopItem[] = topItems.map((r) => ({
    nameZh: r.name_zh ?? null,
    nameEn: r.name_en ?? null,
    categoryZh: r.category_zh ?? null,
    qty: Number(r.qty),
    netSales: Number(r.net_sales),
  }));

  return {
    year,
    totalQty: Number(t.total_qty),
    totalNetSales: Number(t.total_net),
    orderCount: Number(t.order_count),
    distinctProducts: Number(t.distinct_products),
    activeMonths: Number(t.active_months),
    topItems: items,
    monthly: monthly.map((r) => ({
      month: String(r.month),
      netSales: Number(r.net_sales),
      visits: Number(r.visits),
    })),
    favorite: items[0] ?? null,
  };
}

/** 只留尾号 4 位，其余打码。生日卡上的「身份感」用，不外露完整手机号。 */
export function maskPhone(e164: unknown): string | null {
  if (typeof e164 !== "string" || e164.length < 5) return null;
  const tail = e164.slice(-4);
  return "**** " + tail;
}
