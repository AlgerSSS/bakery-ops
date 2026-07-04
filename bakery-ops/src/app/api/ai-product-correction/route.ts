import { NextRequest, NextResponse } from "next/server";
import { query } from "@/modules/shared/db/postgres";
import { buildPrompt } from "@/modules/domain/forecast/prompt-engine";
import { generateJsonFromPrompt } from "@/modules/domain/forecast/gemini-client";
import { roundCorrections, rebalanceToTarget } from "@/modules/domain/forecast/correction-math";
import { DAY_TYPE_LABELS } from "@/modules/domain/forecast/constants";

interface BaselineRow {
  product_name: string;
  avg_monday_to_thursday: number;
  avg_friday: number;
  avg_weekend: number;
}

interface TimeslotRow {
  product_name: string;
  time_slot: string;
  avg_quantity: number;
}

interface ProductInput {
  productName: string;
  price: number;
  packMultiple: number;
  unitType: "batch" | "individual";
  positioning: string;
  coldHot: string;
  roundedQuantity: number;
  adjustedQuantity?: number;
}


const DAY_TYPE_COL: Record<string, string> = {
  mondayToThursday: "avg_monday_to_thursday",
  friday: "avg_friday",
  weekend: "avg_weekend",
};


export async function POST(req: NextRequest) {
  try {
    const { dayType, date, shipmentAmount, productSuggestions } = await req.json();
    if (!dayType || !productSuggestions || !shipmentAmount) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }

    const baselines = await query<BaselineRow>(
      "SELECT product_name, avg_monday_to_thursday, avg_friday, avg_weekend FROM product_sales_baseline"
    );
    const baselineMap = new Map<string, number>();
    const col = DAY_TYPE_COL[dayType] || "avg_monday_to_thursday";
    for (const row of baselines) {
      baselineMap.set(row.product_name, row[col as keyof BaselineRow] as number);
    }

    const timeslotData = await query<TimeslotRow>(
      "SELECT product_name, time_slot, avg_quantity FROM timeslot_sales_record WHERE day_type = ? ORDER BY product_name, time_slot",
      [dayType]
    );
    const timeslotMap: Record<string, { timeSlot: string; avgQty: number }[]> = {};
    for (const row of timeslotData) {
      if (!timeslotMap[row.product_name]) timeslotMap[row.product_name] = [];
      timeslotMap[row.product_name].push({ timeSlot: row.time_slot, avgQty: row.avg_quantity });
    }

    // 需求3: 查询近30天断货历史，统计各产品断货频率和损失
    const stockoutStart = new Date();
    stockoutStart.setDate(stockoutStart.getDate() - 30);
    const stockoutStartStr = stockoutStart.toISOString().split("T")[0];
    const stockoutRows = await query<{ product_name: string; cnt: number; total_loss_qty: number; total_loss_amount: number }>(
      `SELECT product_name, COUNT(*) as cnt, SUM(estimated_loss_qty) as total_loss_qty, SUM(estimated_loss_amount) as total_loss_amount
       FROM out_of_stock_record WHERE date >= ? GROUP BY product_name ORDER BY cnt DESC`,
      [stockoutStartStr]
    );
    let stockoutContext = "";
    if (stockoutRows.length > 0) {
      stockoutContext = "\n【近30天断货历史（用于判断是否需要增加排产）】\n";
      for (const r of stockoutRows) {
        stockoutContext += `- ${r.product_name}：断货${r.cnt}次，累计损失数量=${r.total_loss_qty}，累计损失金额=${r.total_loss_amount}\n`;
      }
      stockoutContext += "注意：断货频繁的产品应适当增加排产量，避免再次断货造成损失。\n";
    }

    const dayLabel = DAY_TYPE_LABELS[dayType] || dayType;
    const products = productSuggestions as ProductInput[];

    let currentTotal = 0;
    let productContext = "";
    for (const p of products) {
      const qty = p.adjustedQuantity ?? p.roundedQuantity;
      const amount = qty * p.price;
      currentTotal += amount;
      const hist = baselineMap.get(p.productName);
      const histStr = hist !== undefined ? `历史日均销量=${hist.toFixed(1)}` : "无历史数据";
      productContext += `- ${p.productName}：数量=${qty}，单价=${p.price}，金额=${amount}，定位=${p.positioning}，冷热=${p.coldHot}，倍数=${p.packMultiple}，类型=${p.unitType === "batch" ? "整批" : "按个"}，${histStr}\n`;
    }

    let timeslotContext = "";
    if (timeslotData.length > 0) {
      timeslotContext = "\n【分时段消费分布参考】\n";
      for (const [name, slots] of Object.entries(timeslotMap)) {
        timeslotContext += `${name}：${slots.map(s => `${s.timeSlot}=${s.avgQty}`).join(", ")}\n`;
      }
    }

    const vars: Record<string, string> = {
      shipmentAmount: String(shipmentAmount),
      productCount: String(products.length),
      productContext: `当前日期：${date || "未知"}\n日期类型：${dayLabel}\n目标出货金额：${shipmentAmount}\n当前建议总金额：${currentTotal}\n\n【当前系统建议方案】\n${productContext}`,
      timeslotContext,
      stockoutContext,
    };
    const built = await buildPrompt("product_correction", vars);
    const prompt = `请根据历史销售数据，对当前的单品出货建议进行校正。\n\n${built.prompt}`;

    const text = await generateJsonFromPrompt(built, prompt);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "AI 返回格式解析失败", rawText: text }, { status: 500 });
    }

    if (!parsed.corrections || !Array.isArray(parsed.corrections)) {
      return NextResponse.json({ error: "AI 返回的 corrections 格式不正确", rawText: text }, { status: 500 });
    }

    const productMap = new Map<string, ProductInput>();
    for (const p of productSuggestions as ProductInput[]) {
      productMap.set(p.productName, p);
    }

    const corrections = roundCorrections(parsed.corrections, productMap);

    // 金额兜底
    const correctedTotal = rebalanceToTarget(corrections, products, productMap, shipmentAmount);

    return NextResponse.json({
      corrections,
      analysis: parsed.analysis || "",
      correctedTotal,
      targetAmount: shipmentAmount,
    });
  } catch (error) {
    console.error("AI product correction error:", error);
    return NextResponse.json(
      { error: `AI 调用失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

