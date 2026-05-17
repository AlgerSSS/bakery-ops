import { NextRequest, NextResponse } from "next/server";
import { query } from "@/modules/shared/db/postgres";

const PROPHET_SERVICE_URL = process.env.PROPHET_SERVICE_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const { year, month } = await req.json();
    if (!year || !month) {
      return NextResponse.json({ error: "缺少 year 或 month 参数" }, { status: 400 });
    }

    // 读取过去60天的理想营业额（含断货还原）
    const endDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const startDate = new Date(year, month - 1, -59).toISOString().slice(0, 10);

    // 汇总每日销售总额
    const dailySales = await query<{ date: string; total: number }>(
      `SELECT date, SUM(quantity) as total FROM daily_sales_record
       WHERE date >= ? AND date < ?
       GROUP BY date ORDER BY date`,
      [startDate, endDate]
    );

    // 加上断货损失
    const stockoutLoss = await query<{ date: string; loss: number }>(
      `SELECT date, SUM(estimated_loss_qty) as loss FROM out_of_stock_record
       WHERE date >= ? AND date < ?
       GROUP BY date`,
      [startDate, endDate]
    );
    const lossMap = new Map(stockoutLoss.map((r) => [r.date, r.loss]));

    // 读取产品价格用于计算营业额
    const products = await query<{ name: string; price: number }>(
      "SELECT name, price FROM product"
    );
    const priceMap = new Map(products.map((p) => [p.name, p.price]));

    // 构建历史序列（简化：用总销量 × 平均单价作为营业额近似）
    const avgPrice = products.length > 0
      ? products.reduce((s, p) => s + p.price, 0) / products.length
      : 10;

    const history = dailySales.map((d) => ({
      ds: d.date,
      y: Math.round((d.total + (lossMap.get(d.date) || 0)) * avgPrice),
    }));

    if (history.length < 14) {
      return NextResponse.json({
        error: "历史数据不足（需要至少14天），Prophet无法预测",
        trend_factors: [],
      });
    }

    // 调用 Prophet 微服务
    const response = await fetch(`${PROPHET_SERVICE_URL}/predict-trend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `Prophet 服务调用失败: ${errText}` },
        { status: 500 }
      );
    }

    const result = await response.json();

    // 缓存结果到 business_rule 表
    await query(
      `INSERT INTO business_rule (rule_key, rule_value)
       VALUES ($1, $2)
       ON CONFLICT (rule_key) DO UPDATE SET rule_value = EXCLUDED.rule_value`,
      ["prophet_trend_cache", JSON.stringify({ year, month, ...result, cachedAt: new Date().toISOString() })]
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Prophet trend error:", error);
    return NextResponse.json(
      { error: `Prophet 调用失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
