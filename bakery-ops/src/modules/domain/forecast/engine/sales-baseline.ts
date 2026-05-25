import {
  DailySalesRecord,
  Product,
  ProductSalesBaseline,
  OutOfStockRecord,
} from "../types";

export function calculateSalesBaselines(
  salesRecords: DailySalesRecord[],
  products: Product[],
  baselineOverrides?: Record<string, { mondayToThursday: number; friday: number; weekend: number }>,
  stockoutRecords?: OutOfStockRecord[]
): ProductSalesBaseline[] {
  const productNameSet = new Set(products.map((p) => p.name));

  const groupedSales: Record<
    string,
    { mondayToThursday: number[]; friday: number[]; weekend: number[] }
  > = {};

  const dailyAgg: Record<string, Record<string, number>> = {};

  for (const record of salesRecords) {
    const name = record.standardName;
    if (!productNameSet.has(name)) continue;

    if (!dailyAgg[name]) dailyAgg[name] = {};
    if (!dailyAgg[name][record.date]) dailyAgg[name][record.date] = 0;
    dailyAgg[name][record.date] += record.quantity;
  }

  if (stockoutRecords && stockoutRecords.length > 0) {
    for (const oos of stockoutRecords) {
      const name = oos.productName;
      if (!productNameSet.has(name)) continue;
      if (!dailyAgg[name]) dailyAgg[name] = {};
      if (!dailyAgg[name][oos.date]) dailyAgg[name][oos.date] = 0;
      dailyAgg[name][oos.date] += oos.estimatedLossQty;
    }
  }

  for (const [name, dateSales] of Object.entries(dailyAgg)) {
    if (!groupedSales[name]) {
      groupedSales[name] = { mondayToThursday: [], friday: [], weekend: [] };
    }

    for (const [dateStr, qty] of Object.entries(dateSales)) {
      const dow = new Date(dateStr).getDay();
      if (dow === 0 || dow === 6) {
        groupedSales[name].weekend.push(qty);
      } else if (dow === 5) {
        groupedSales[name].friday.push(qty);
      } else {
        groupedSales[name].mondayToThursday.push(qty);
      }
    }
  }

  const baselines: ProductSalesBaseline[] = [];

  for (const product of products) {
    const override = baselineOverrides?.[product.name];
    if (override) {
      baselines.push({
        productName: product.name,
        avgMondayToThursday: override.mondayToThursday,
        avgFriday: override.friday,
        avgWeekend: override.weekend,
        totalSales: 0,
        dayCount: 0,
      });
      continue;
    }

    const data = groupedSales[product.name];
    if (!data) {
      baselines.push({
        productName: product.name,
        avgMondayToThursday: 0,
        avgFriday: 0,
        avgWeekend: 0,
        totalSales: 0,
        dayCount: 0,
      });
      continue;
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    baselines.push({
      productName: product.name,
      avgMondayToThursday: avg(data.mondayToThursday),
      avgFriday: avg(data.friday),
      avgWeekend: avg(data.weekend),
      totalSales:
        data.mondayToThursday.reduce((a, b) => a + b, 0) +
        data.friday.reduce((a, b) => a + b, 0) +
        data.weekend.reduce((a, b) => a + b, 0),
      dayCount:
        data.mondayToThursday.length + data.friday.length + data.weekend.length,
    });
  }

  return baselines;
}
