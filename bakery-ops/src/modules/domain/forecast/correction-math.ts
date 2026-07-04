/**
 * ai-product-correction 的纯算术部分：数量取整与金额兜底再分配。
 * 从 src/app/api/ai-product-correction/route.ts 提取，行为保持不变。
 */

export interface CorrectionProduct {
  productName: string;
  price: number;
  packMultiple: number;
  unitType: "batch" | "individual";
  positioning: string;
  roundedQuantity: number;
  adjustedQuantity?: number;
}

export interface CorrectionItem {
  productName: string;
  suggestedQuantity: number;
  reason: string;
}

/** 数量取整：非负四舍五入；整批产品按 packMultiple 取整 */
export function roundCorrections(
  rawCorrections: { productName: string; suggestedQuantity: number; reason: string }[],
  productMap: Map<string, CorrectionProduct>
): CorrectionItem[] {
  return rawCorrections.map((c) => {
    const product = productMap.get(c.productName);
    let qty = Math.max(0, Math.round(c.suggestedQuantity));
    if (product && product.unitType === "batch" && product.packMultiple > 1) {
      qty = Math.round(qty / product.packMultiple) * product.packMultiple;
    }
    return { productName: c.productName, suggestedQuantity: qty, reason: c.reason || "" };
  });
}

/**
 * 金额兜底：若校正后总金额偏离目标超过 2%，按定位优先级（TOP > 潜在TOP > 其他，
 * 同级按单价降序）逐个增减一个步进量，直至回到容差内。
 * 会就地修改 corrections 的 suggestedQuantity，返回最终 correctedTotal。
 */
export function rebalanceToTarget(
  corrections: CorrectionItem[],
  products: CorrectionProduct[],
  productMap: Map<string, CorrectionProduct>,
  shipmentAmount: number
): number {
  const correctionMap = new Map<string, number>();
  for (const c of corrections) {
    correctionMap.set(c.productName, c.suggestedQuantity);
  }
  let correctedTotal = 0;
  for (const p of products) {
    const qty = correctionMap.get(p.productName) ?? (p.adjustedQuantity ?? p.roundedQuantity);
    correctedTotal += qty * p.price;
  }

  const diff = shipmentAmount - correctedTotal;
  const tolerance = shipmentAmount * 0.02;
  if (Math.abs(diff) > tolerance) {
    const adjustable = corrections
      .map((c) => ({
        correction: c,
        product: productMap.get(c.productName),
      }))
      .filter((x): x is { correction: CorrectionItem; product: CorrectionProduct } => !!x.product)
      .sort((a, b) => {
        const posOrder: Record<string, number> = { "TOP": 0, "潜在TOP": 1, "其他": 2 };
        const pa = posOrder[a.product.positioning] ?? 2;
        const pb = posOrder[b.product.positioning] ?? 2;
        if (pa !== pb) return pa - pb;
        return b.product.price - a.product.price;
      });

    let remaining = diff;
    for (const { correction: c, product: p } of adjustable) {
      if (Math.abs(remaining) <= tolerance) break;
      if (!p) continue;
      const unit = (p.unitType === "batch" && p.packMultiple > 1) ? p.packMultiple : 1;
      const stepAmount = unit * p.price;
      if (remaining > 0 && stepAmount <= remaining * 1.5) {
        c.suggestedQuantity += unit;
        remaining -= stepAmount;
        correctionMap.set(c.productName, c.suggestedQuantity);
      } else if (remaining < 0 && c.suggestedQuantity > unit) {
        c.suggestedQuantity -= unit;
        remaining += stepAmount;
        correctionMap.set(c.productName, c.suggestedQuantity);
      }
    }
    correctedTotal = 0;
    for (const p of products) {
      const qty = correctionMap.get(p.productName) ?? (p.adjustedQuantity ?? p.roundedQuantity);
      correctedTotal += qty * p.price;
    }
  }

  return correctedTotal;
}
