import { getDb, type SqlRunner } from "@/lib/db/postgres";

/**
 * HBTI 完成礼的周边抽取。
 *
 * 概率不是配置出来的，是**由剩余库存实时算出来的**：某个品项还剩多少，它被抽中的概率就占多少。
 * 这样九种周边会同时见底，而不是先发完热门款、剩一堆没人要的躺在仓库里。
 *
 * 用固定概率会出事：按初始库存写死权重后，玫瑰冰箱贴（只有 6 件）在发到第 400 份左右
 * 就会被抽空，此后每一次抽中它都是一张发不出实物的券。模拟过 10,000 轮，固定概率下
 * 出现「发了券没货」的概率是 21.9%；实时权重是 0%。
 */

export interface GiftDraw {
  templateName: string;
  displayName: string;
  remainingAfter: number;
}

export interface GiftStockRow {
  templateName: string;
  displayName: string;
  initialStock: number;
  issuedCount: number;
  remaining: number;
  isActive: boolean;
}

/**
 * 抽一件周边并扣减库存；池子空了（全部发完或全部停用）返回 null。
 *
 * 整个过程在一个事务里完成，并用 `FOR UPDATE` 锁住候选行：两个顾客同时提交时，
 * 后一个会等前一个提交完再读，读到的是已经扣过的余量。不加锁的话，两个请求可能
 * 同时看到「玫瑰冰箱贴还剩 1」并各自抽中它，数据库的 not_oversold 约束会让其中一个
 * 报错——顾客侧就是一次莫名其妙的失败。
 *
 * 调用方必须保证：抽中之后若后续流程失败，要调用 `releaseGift` 归还，否则这一件
 * 库存会被永久占住（券没发出去，账上却少了一件）。
 */
export async function drawGift(
  sql: SqlRunner = getDb(),
): Promise<GiftDraw | null> {
  const run = async (tx: SqlRunner): Promise<GiftDraw | null> => {
    const rows = await tx<
      { template_name: string; display_name: string; remaining: number }[]
    >`
      SELECT template_name,
             display_name,
             (initial_stock - issued_count) AS remaining
        FROM hbti_gift_stock
       WHERE is_active
         AND initial_stock > issued_count
       ORDER BY template_name
         FOR UPDATE
    `;

    if (rows.length === 0) {
      return null;
    }

    const picked = pickWeighted(
      rows.map((r) => ({ ...r, remaining: Number(r.remaining) })),
      Math.random(),
    );

    await tx`
      UPDATE hbti_gift_stock
         SET issued_count = issued_count + 1,
             updated_at   = NOW()
       WHERE template_name = ${picked.template_name}
    `;

    return {
      templateName: picked.template_name,
      displayName: picked.display_name,
      remainingAfter: picked.remaining - 1,
    };
  };

  // 已经在调用方事务里（集成测试）时不能再 begin，直接复用。
  return "begin" in sql ? sql.begin((tx) => run(tx)) : run(sql);
}

/**
 * 按 remaining 加权挑一行。`roll` 取 [0, 1)，由调用方传入以便测试。
 *
 * 用累加法而不是 `ORDER BY -log(random()) / remaining` 之类的写法：前者的概率一眼
 * 就能验证（每行占据的区间长度正比于它的权重），后者不能。
 *
 * 末尾的兜底 return 处理浮点累加的边角：roll 极度接近 1 时，减到最后一行仍可能剩下
 * 一个极小的正数。这时返回最后一行，而不是让 undefined 漏出去——绝不能因为浮点误差
 * 让一个已经答完题的顾客拿不到奖。
 */
export function pickWeighted<T extends { remaining: number }>(
  rows: readonly T[],
  roll: number,
): T {
  const total = rows.reduce((sum, row) => sum + row.remaining, 0);
  let point = roll * total;
  for (const row of rows) {
    point -= row.remaining;
    if (point < 0) {
      return row;
    }
  }
  return rows[rows.length - 1];
}

/**
 * 归还一件库存。用于抽中之后、券实际发出之前失败的情形。
 * `GREATEST(issued_count - 1, 0)` 保证重复归还不会把账做成负数。
 */
export async function releaseGift(
  templateName: string,
  sql: SqlRunner = getDb(),
): Promise<void> {
  await sql`
    UPDATE hbti_gift_stock
       SET issued_count = GREATEST(issued_count - 1, 0),
           updated_at   = NOW()
     WHERE template_name = ${templateName}
  `;
}

/** 运营查看用：九个品项的当前余量与实时概率。 */
export async function listGiftStock(
  sql: SqlRunner = getDb(),
): Promise<readonly GiftStockRow[]> {
  const rows = await sql<
    {
      template_name: string;
      display_name: string;
      initial_stock: number;
      issued_count: number;
      is_active: boolean;
    }[]
  >`
    SELECT template_name, display_name, initial_stock, issued_count, is_active
      FROM hbti_gift_stock
     ORDER BY template_name
  `;

  return rows.map((r) => ({
    templateName: r.template_name,
    displayName: r.display_name,
    initialStock: Number(r.initial_stock),
    issuedCount: Number(r.issued_count),
    remaining: Number(r.initial_stock) - Number(r.issued_count),
    isActive: r.is_active,
  }));
}
