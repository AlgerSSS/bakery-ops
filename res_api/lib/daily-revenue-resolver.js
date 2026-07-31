// kualaLumpurDate 的定义已搬到 lib/business-date.js（那里还有 REFRESH_BUSINESS_DATE 的锁定逻辑）。
// 这里保留再导出，老的 import 路径不变。
export { kualaLumpurDate } from './business-date.js';

function num(value) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function fromCsvRow(row) {
  const grossSales = num(row['Gross Sales']);
  const totalDiscount = num(row['Amount Of Discount']);
  const totalPayment = num(row['Total Payment received']) || num(row['Net Sales']);
  const memberPayment = num(row['Payment Subtotal — Membership card pay']) || 0;

  return {
    date: row['Business Date'],
    revenue: num(row['Net Sales']),
    transaction_count: num(row['Bill Count']),
    avg_transaction_value: num(row['Avg Order Net Sales']),
    gross_sales: grossSales,
    total_discount: totalDiscount,
    discount_rate: grossSales > 0 ? +(totalDiscount / grossSales).toFixed(4) : null,
    member_sales_ratio: totalPayment > 0 ? +(memberPayment / totalPayment).toFixed(4) : null,
  };
}

function roundMoney(value) {
  return +value.toFixed(2);
}

function fromHourlyRows(rows, expectedDate) {
  if (!rows.length) return null;

  const totals = rows.reduce(
    (sum, row) => ({
      revenue: sum.revenue + (num(row.netSales) || 0),
      grossSales: sum.grossSales + (num(row.grossSales) || 0),
      transactionCount: sum.transactionCount + (num(row.billCount) || 0),
      totalDiscount: sum.totalDiscount + (num(row.discount) || 0),
    }),
    { revenue: 0, grossSales: 0, transactionCount: 0, totalDiscount: 0 },
  );

  const revenue = roundMoney(totals.revenue);
  const grossSales = roundMoney(totals.grossSales);
  const totalDiscount = roundMoney(totals.totalDiscount);

  return {
    date: expectedDate,
    revenue,
    transaction_count: totals.transactionCount,
    // 0 笔交易的「客单价」是未定义（0/0），不是 0。写 0 就是用 0 填补缺失事实，
    // 而且会被下游当成真实的「客单价 0 元」参与均值。
    avg_transaction_value:
      totals.transactionCount > 0 ? roundMoney(revenue / totals.transactionCount) : null,
    gross_sales: grossSales,
    total_discount: totalDiscount,
    discount_rate: grossSales > 0 ? +(totalDiscount / grossSales).toFixed(4) : null,
    member_sales_ratio: null,
  };
}

/**
 * 已证实的零流水日（门店停业/公假）在 daily_revenue 里的那一行。
 *
 * 写 0 的部分是**实测事实**：当天没有订单、没有流水。
 * 写 NULL 的部分是**未定义**：客单价 = 0/0，折扣率 = 0/0，会员占比 = 0/0 —— 这三个不是 0。
 * 「绝不用 0 填补缺失事实」在这里的含义正是：事实为零就写 0，事实未定义就写 NULL，
 * 事实不知道（判不出是不是零流水日）就整步失败，绝不写这一行。
 */
export function zeroSalesRecord(expectedDate) {
  return {
    date: expectedDate,
    revenue: 0,
    transaction_count: 0,
    avg_transaction_value: null,
    gross_sales: 0,
    total_discount: 0,
    discount_rate: null,
    member_sales_ratio: null,
  };
}

/**
 * Resolve normalized daily_revenue rows and guarantee the expected business date.
 *
 * zeroDay=true 只应由 lib/zero-day.js 的 'closed' 裁定驱动：CSV 与小时聚合都没有当天，
 * 而多个独立来源已证明当天真的零流水。此时补一条显式的 0 行，而不是抛错让 30 天全不写。
 *
 * partialWhenMissing=true 时，「当天没有任何来源且不是已证实的零流水日」不再抛错，
 * 而是照常返回其余日期的记录并置 missingExpectedDate=true：调用方先把好日子写进去，
 * 再把这一步记成 PARTIAL。全有全无（当天缺一天 -> 29 天精确记录也一并不写）是过度的。
 */
export function resolveDailyRevenueRecords({
  csvRows = [],
  daily = {},
  expectedDate,
  zeroDay = false,
  partialWhenMissing = false,
}) {
  const records = csvRows
    .filter((row) => row?.['Business Date'])
    .map(fromCsvRow);

  if (records.some((record) => record.date === expectedDate)) {
    return { records, fallbackUsed: false, zeroDayUsed: false, missingExpectedDate: false };
  }

  const hourlyRows = (daily.hourlyByDate || []).filter((row) => row?.date === expectedDate);
  const fallback = fromHourlyRows(hourlyRows, expectedDate);
  if (fallback) {
    return { records: [...records, fallback], fallbackUsed: true, zeroDayUsed: false, missingExpectedDate: false };
  }

  // 零流水日的 0 是事实，不是降级近似值：fallbackUsed 保持 false，
  // 这样它走的是 EXCLUDED 覆盖而不是 COALESCE 保护 —— 当天数据晚到时后面几晚能把它改回真值。
  if (zeroDay) {
    return {
      records: [...records, zeroSalesRecord(expectedDate)],
      fallbackUsed: false,
      zeroDayUsed: true,
      missingExpectedDate: false,
    };
  }

  if (partialWhenMissing) {
    return { records, fallbackUsed: false, zeroDayUsed: false, missingExpectedDate: true };
  }

  throw new Error(`daily_revenue source missing expected business date ${expectedDate}`);
}

/** Limit a recovery run to one business date so no historical rows are rewritten. */
export function selectDailyRevenueRecords(records, expectedDate, dailyRevenueOnly = false) {
  if (!dailyRevenueOnly) return records;
  return records.filter((record) => record.date === expectedDate);
}
