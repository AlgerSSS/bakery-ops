import { NextRequest, NextResponse } from "next/server";
import { query } from "@/modules/shared/db/postgres";
import { buildPrompt } from "@/modules/domain/forecast/prompt-engine";
import { generateJsonFromPrompt } from "@/modules/domain/forecast/gemini-client";


export async function POST(req: NextRequest) {
  try {
    const { eventId } = await req.json();
    if (!eventId) {
      return NextResponse.json({ error: "缺少 eventId 参数" }, { status: 400 });
    }

    // 读取赋能事件
    const events = await query<{
      id: number; event_name: string; event_type: string;
      start_date: string; end_date: string; target_products: string;
      platform: string; exposure_count: number; click_count: number; cost: number;
      operation_type: string; operation_detail: string;
    }>("SELECT * FROM empowerment_event WHERE id = ?", [eventId]);

    if (events.length === 0) {
      return NextResponse.json({ error: "赋能事件不存在" }, { status: 404 });
    }
    const event = events[0];

    // 基线期：活动前14天
    const baselineStart = new Date(event.start_date);
    baselineStart.setDate(baselineStart.getDate() - 14);
    const baselineStartStr = baselineStart.toISOString().slice(0, 10);

    // 后效期：活动后7天
    const afterEnd = new Date(event.end_date);
    afterEnd.setDate(afterEnd.getDate() + 7);
    const afterEndStr = afterEnd.toISOString().slice(0, 10);

    // 读取基线期、活动期、后效期的销售数据
    const salesData = await query<{ date: string; product_name: string; quantity: number }>(
      `SELECT date, standard_name as product_name, SUM(quantity) as quantity
       FROM daily_sales_record
       WHERE date >= ? AND date <= ?
       GROUP BY date, standard_name`,
      [baselineStartStr, afterEndStr]
    );

    // 按时期分组
    const baseline: Record<string, number[]> = {};
    const during: Record<string, number[]> = {};
    const after: Record<string, number[]> = {};

    for (const row of salesData) {
      const bucket = row.date < event.start_date ? baseline
        : row.date <= event.end_date ? during
        : after;
      if (!bucket[row.product_name]) bucket[row.product_name] = [];
      bucket[row.product_name].push(row.quantity);
    }

    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    const baselineSales = Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, avg(v)]));
    const periodSales = Object.fromEntries(Object.entries(during).map(([k, v]) => [k, avg(v)]));
    const afterSales = Object.fromEntries(Object.entries(after).map(([k, v]) => [k, avg(v)]));

    // 读取整个分析区间内的节日和事件数据
    const holidays = await query<{ date: string; name: string; type: string; note: string }>(
      "SELECT date, name, type, note FROM holiday WHERE date >= ? AND date <= ? ORDER BY date",
      [baselineStartStr, afterEndStr]
    );
    const contextEvents = await query<{ date: string; event_tag: string; description: string }>(
      "SELECT date, event_tag, description FROM context_event WHERE date >= ? AND date <= ? ORDER BY date",
      [baselineStartStr, afterEndStr]
    );

    const holidaysText = holidays.length > 0
      ? holidays.map((h) => `${h.date} [${h.type}] ${h.name}${h.note ? `（${h.note}）` : ""}`).join("\n")
      : "无";
    const contextEventsText = contextEvents.length > 0
      ? contextEvents.map((e) => `${e.date} [${e.event_tag}] ${e.description}`).join("\n")
      : "无";
    // Build event info text
    const eventInfoText = `- 活动名称：${event.event_name}
- 类型：${event.event_type === "market" ? "市场赋能" : "营运赋能"}
- 时间：${event.start_date} ~ ${event.end_date}
- 关联产品：${event.target_products || "全部"}
${event.event_type === "market" ? `- 平台：${event.platform}\n- 曝光数据：${event.exposure_count}次曝光，${event.click_count}次点击\n- 投入费用：RM ${event.cost}` : `- 营运类型：${event.operation_type}\n- 详情：${event.operation_detail}`}`;

    const vars: Record<string, string> = {
      eventInfo: eventInfoText,
      baselineSales: JSON.stringify(baselineSales),
      periodSales: JSON.stringify(periodSales),
      afterSales: JSON.stringify(afterSales),
      holidays: holidaysText,
      contextEvents: contextEventsText,
    };
    const built = await buildPrompt("empowerment_review", vars);

    const text = await generateJsonFromPrompt(built);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "AI 返回格式解析失败", rawText: text }, { status: 500 });
    }

    // 保存复盘结果
    await query(
      "UPDATE empowerment_event SET review_json = $1, reviewed_at = NOW() WHERE id = $2",
      [JSON.stringify(parsed), eventId]
    );

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("Empowerment review error:", error);
    return NextResponse.json(
      { error: `AI 调用失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
