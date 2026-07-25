import { getProductForecast } from "@/modules/domain/forecast/forecast.service";
import type { ProductionBatch, ProductionPlan } from "./types";
import prepTimesConfig from "./prep-times.json";

// 备制时长配置（分钟）：prep-times.json 按品项覆盖，师傅逐品校准只改 JSON。
// 值可以是数字（该品项冷热通用）或 { hot, cold } 对象；"默认" 为兜底。
type PrepTimeEntry = number | { hot?: number; cold?: number };

const FALLBACK_PREP = { hot: 50, cold: 240 };

export function getPrepMinutes(
  productName: string,
  coldHot: "冷" | "热",
  config: Record<string, PrepTimeEntry> = prepTimesConfig as Record<string, PrepTimeEntry>
): number {
  const key = coldHot === "热" ? "hot" : "cold";
  const entry = config[productName];
  if (typeof entry === "number") return entry;
  if (entry && typeof entry[key] === "number") return entry[key]!;
  const def = config["默认"];
  if (typeof def === "number") return def;
  if (def && typeof def[key] === "number") return def[key]!;
  return FALLBACK_PREP[key];
}

const WORKSTATION_LABELS: Record<ProductionBatch["workstation"], string> = {
  "oven-1": "烤箱1",
  "oven-2": "烤箱2",
  "cold-prep": "冷品台",
  "assembly": "组装台",
};

function subtractMinutes(timeSlot: string, minutes: number): string {
  const [h, m] = timeSlot.split(":").map(Number);
  const totalMinutes = h * 60 + m - minutes;
  const newH = Math.floor(totalMinutes / 60);
  const newM = totalMinutes % 60;
  if (newH < 0) return "00:00";
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

function assignWorkstation(
  coldHot: "冷" | "热",
  batchIndex: number
): ProductionBatch["workstation"] {
  if (coldHot === "冷") return "cold-prep";
  // Alternate hot products between oven-1 and oven-2 to balance load
  return batchIndex % 2 === 0 ? "oven-1" : "oven-2";
}

export async function generateProductionPlan(date: string): Promise<ProductionPlan> {
  const forecast = await getProductForecast(date);

  const productMeta = new Map<string, { coldHot: string; packMultiple: number }>();
  for (const p of forecast.products) {
    productMeta.set(p.name, { coldHot: p.coldHot, packMultiple: p.packMultiple });
  }

  const batches: ProductionBatch[] = [];
  let hotBatchIndex = 0;

  for (const slot of forecast.timeSlots) {
    const meta = productMeta.get(slot.productName);
    if (!meta || slot.quantity <= 0) continue;

    const coldHot = (meta.coldHot === "冷" ? "冷" : "热") as "冷" | "热";
    const prepMinutes = getPrepMinutes(slot.productName, coldHot);
    const prepareBy = subtractMinutes(slot.timeSlot, prepMinutes);
    const batchCount = meta.packMultiple > 1
      ? Math.ceil(slot.quantity / meta.packMultiple)
      : slot.quantity;
    const workstation = assignWorkstation(coldHot, coldHot === "热" ? hotBatchIndex++ : 0);

    batches.push({
      productName: slot.productName,
      coldHot,
      timeSlot: slot.timeSlot,
      quantity: slot.quantity,
      packMultiple: meta.packMultiple,
      batchCount,
      prepareBy,
      workstation,
    });
  }

  batches.sort((a, b) => a.prepareBy.localeCompare(b.prepareBy));

  const summary = formatPlanSummary(date, forecast.dayType, forecast.targetRevenue, batches);

  return {
    date,
    dayType: forecast.dayType,
    targetRevenue: forecast.targetRevenue,
    batches,
    summary,
  };
}

function formatPlanSummary(
  date: string,
  dayType: string,
  targetRevenue: number,
  batches: ProductionBatch[]
): string {
  const lines: string[] = [];
  lines.push(`🍞 *后厨生产计划*`);
  lines.push(`📅 ${date}（${dayType}）| 目标 RM${targetRevenue.toLocaleString()}`);
  lines.push("");

  const byTime = new Map<string, ProductionBatch[]>();
  for (const b of batches) {
    if (!byTime.has(b.prepareBy)) byTime.set(b.prepareBy, []);
    byTime.get(b.prepareBy)!.push(b);
  }

  for (const [time, items] of Array.from(byTime.entries()).sort()) {
    lines.push(`⏰ *${time} 前准备*`);
    for (const item of items) {
      const icon = item.coldHot === "热" ? "🔥" : "🧊";
      const ws = WORKSTATION_LABELS[item.workstation];
      lines.push(`  ${icon} ${item.productName}: ${item.quantity}个（${item.batchCount}批）→ [${ws}] → ${item.timeSlot} 上架`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

