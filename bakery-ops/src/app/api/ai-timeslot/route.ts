import { NextRequest, NextResponse } from "next/server";
import { query } from "@/modules/shared/db/postgres";
import { buildPrompt } from "@/modules/domain/forecast/prompt-engine";
import { generateJsonFromPrompt } from "@/modules/domain/forecast/gemini-client";

interface TimeslotSalesRow {
  product_name: string;
  day_type: string;
  time_slot: string;
  avg_quantity: number;
  sample_count: number;
}


export async function POST(req: NextRequest) {
  try {
    const { dayType, productSuggestions, timeSlots } = await req.json();
    if (!dayType || !productSuggestions || !timeSlots) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }

    const timeslotData = await query<TimeslotSalesRow>(
      "SELECT product_name, day_type, time_slot, avg_quantity, sample_count FROM timeslot_sales_record WHERE day_type = ? ORDER BY product_name, time_slot",
      [dayType]
    );

    const dayTypeLabels: Record<string, string> = {
      mondayToThursday: "周一至周四",
      friday: "周五",
      weekend: "周六周日",
    };

    const productTimeslotMap: Record<string, { timeSlot: string; avgQty: number }[]> = {};
    for (const row of timeslotData) {
      if (!productTimeslotMap[row.product_name]) {
        productTimeslotMap[row.product_name] = [];
      }
      productTimeslotMap[row.product_name].push({
        timeSlot: row.time_slot,
        avgQty: row.avg_quantity,
      });
    }

    const hasHistoricalData = timeslotData.length > 0;

    let historicalContext = "";
    if (hasHistoricalData) {
      historicalContext = "\n\n【历史分时段销售数据】\n";
      historicalContext += `日期类型：${dayTypeLabels[dayType] || dayType}\n\n`;
      for (const [name, slots] of Object.entries(productTimeslotMap)) {
        historicalContext += `${name}：`;
        historicalContext += slots.map((s) => `${s.timeSlot}=${s.avgQty}`).join(", ");
        historicalContext += "\n";
      }
    } else {
      historicalContext = "\n\n当前没有历史分时段销售数据，请根据烘焙行业经验和产品属性进行合理分配。\n";
    }

    let productInfo = "\n【当日产品出货建议】\n";
    for (const p of productSuggestions) {
      const qty = p.adjustedQuantity ?? p.roundedQuantity;
      productInfo += `- ${p.productName}：总量=${qty}，单价=${p.price}，`;
      productInfo += `定位=${p.positioning}，冷热=${p.coldHot}，倍数=${p.packMultiple}，`;
      productInfo += `类型=${p.unitType === "batch" ? "整批" : "按个"}\n`;
    }

    const vars: Record<string, string> = {
      productContext: `当前日期类型：${dayTypeLabels[dayType] || dayType}\n可用时段：${timeSlots.join(", ")}\n${productInfo}`,
      timeslotContext: historicalContext,
    };
    const built = await buildPrompt("timeslot_allocation", vars);
    const text = await generateJsonFromPrompt(built);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "AI 返回格式解析失败", rawText: text }, { status: 500 });
    }

    if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
      return NextResponse.json({ error: "AI 返回的 suggestions 格式不正确", rawText: text }, { status: 500 });
    }

    const productPriceMap = new Map<string, number>();
    for (const p of productSuggestions) {
      productPriceMap.set(p.productName, p.price);
    }

    const normalized = parsed.suggestions.map((s: { productName: string; timeSlot: string; quantity: number; reason: string }) => ({
      productName: s.productName,
      timeSlot: s.timeSlot,
      quantity: Math.max(0, Math.round(s.quantity)),
      amount: Math.round(Math.max(0, Math.round(s.quantity)) * (productPriceMap.get(s.productName) || 0)),
      reason: s.reason || "",
    }));

    return NextResponse.json({
      suggestions: normalized,
      analysis: parsed.analysis || "",
    });
  } catch (error) {
    console.error("AI timeslot error:", error);
    return NextResponse.json(
      { error: `AI 调用失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

