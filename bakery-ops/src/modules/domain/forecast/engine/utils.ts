export function roundToMultiple(quantity: number, multiple: number, unitType: "batch" | "individual"): number {
  if (unitType === "individual") return Math.max(1, Math.round(quantity));
  if (multiple <= 0) return Math.max(1, Math.round(quantity));
  return Math.max(multiple, Math.ceil(quantity / multiple) * multiple);
}
