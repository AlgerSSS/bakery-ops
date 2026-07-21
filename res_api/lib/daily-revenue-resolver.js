function num(value) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Current business date in the shop timezone, independent of the host timezone. */
export function kualaLumpurDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
    avg_transaction_value:
      totals.transactionCount > 0 ? roundMoney(revenue / totals.transactionCount) : 0,
    gross_sales: grossSales,
    total_discount: totalDiscount,
    discount_rate: grossSales > 0 ? +(totalDiscount / grossSales).toFixed(4) : null,
    member_sales_ratio: null,
  };
}

/** Resolve normalized daily_revenue rows and guarantee the expected business date. */
export function resolveDailyRevenueRecords({ csvRows = [], daily = {}, expectedDate }) {
  const records = csvRows
    .filter((row) => row?.['Business Date'])
    .map(fromCsvRow);

  if (records.some((record) => record.date === expectedDate)) {
    return { records, fallbackUsed: false };
  }

  const hourlyRows = (daily.hourlyByDate || []).filter((row) => row?.date === expectedDate);
  const fallback = fromHourlyRows(hourlyRows, expectedDate);
  if (!fallback) throw new Error(`daily_revenue source missing expected business date ${expectedDate}`);

  return { records: [...records, fallback], fallbackUsed: true };
}

/** Limit a recovery run to one business date so no historical rows are rewritten. */
export function selectDailyRevenueRecords(records, expectedDate, dailyRevenueOnly = false) {
  if (!dailyRevenueOnly) return records;
  return records.filter((record) => record.date === expectedDate);
}
