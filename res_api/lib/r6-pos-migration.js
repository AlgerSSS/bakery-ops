import { buildLegacyPosExport, compareLegacyPosWithR6 } from './r6-shadow.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_DAYS = 31;

function dateAtUtcMidnight(value, field) {
  if (!ISO_DATE.test(value || '')) throw new Error(`${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a real calendar date`);
  }
  return parsed;
}

export function enumerateBusinessDates(fromDate, toDate) {
  const from = dateAtUtcMidnight(fromDate, 'from date');
  const to = dateAtUtcMidnight(toDate, 'to date');
  if (from > to) throw new Error('from date must not be after to date');
  const count = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (count > MAX_WINDOW_DAYS) {
    throw new Error(`migration window cannot exceed ${MAX_WINDOW_DAYS} days`);
  }
  return Array.from({ length: count }, (_, index) => (
    new Date(from.getTime() + index * DAY_MS).toISOString().slice(0, 10)
  ));
}

function exportedAtFor(businessDate, hourlyRows) {
  if (!hourlyRows.length) return `${businessDate}T15:59:59.999Z`;
  const timestamps = hourlyRows.map((row) => new Date(row.synced_at).getTime());
  if (!timestamps.every(Number.isFinite)) {
    throw new Error('hourly source rows contain an invalid synced_at timestamp');
  }
  return new Date(Math.max(...timestamps)).toISOString();
}

function anomaly({ businessDate, dailyRows, hourlyRows, exportedAt, reasonCode, reasonSummary }) {
  return {
    businessDate,
    disposition: 'QUARANTINE',
    daily: dailyRows.length === 1 ? dailyRows[0] : null,
    dailyRows,
    hourly: hourlyRows,
    exportedAt,
    reasonCode,
    reasonSummary,
  };
}

export function buildLegacyPosMigrationPlan({
  fromDate,
  toDate,
  oldStore,
  storeId,
  sourceProjectRef,
  dailyRows,
  hourlyRows,
}) {
  const dates = enumerateBusinessDates(fromDate, toDate);
  if (!oldStore?.trim()) throw new Error('oldStore is required');
  if (!storeId?.trim()) throw new Error('storeId is required');
  if (!/^[a-z]{20}$/.test(sourceProjectRef || '')) throw new Error('sourceProjectRef is invalid');
  if (!Array.isArray(dailyRows) || !Array.isArray(hourlyRows)) {
    throw new Error('dailyRows and hourlyRows must be arrays');
  }
  const dateSet = new Set(dates);
  const dailyByDate = new Map(dates.map((date) => [date, []]));
  const hourlyByDate = new Map(dates.map((date) => [date, []]));

  for (const row of dailyRows) {
    if (row.store !== oldStore) {
      throw new Error(`unexpected source store for ${row.date}: ${row.store}`);
    }
    if (!dateSet.has(row.date)) throw new Error(`daily source date outside requested window: ${row.date}`);
    dailyByDate.get(row.date).push(row);
  }
  for (const row of hourlyRows) {
    if (!dateSet.has(row.date)) throw new Error(`hourly source date outside requested window: ${row.date}`);
    hourlyByDate.get(row.date).push(row);
  }

  const entries = dates.map((businessDate) => {
    const dayRows = dailyByDate.get(businessDate);
    const hourRows = hourlyByDate.get(businessDate);
    let exportedAt;
    try {
      exportedAt = exportedAtFor(businessDate, hourRows);
    } catch (error) {
      return anomaly({
        businessDate,
        dailyRows: dayRows,
        hourlyRows: hourRows,
        exportedAt: `${businessDate}T15:59:59.999Z`,
        reasonCode: 'INVALID_SOURCE_TIMESTAMP',
        reasonSummary: error.message,
      });
    }
    if (dayRows.length === 0) {
      return anomaly({
        businessDate,
        dailyRows: dayRows,
        hourlyRows: hourRows,
        exportedAt,
        reasonCode: 'MISSING_DAILY_SOURCE',
        reasonSummary: 'no daily_revenue row exists for the requested store and business date',
      });
    }
    if (dayRows.length > 1) {
      return anomaly({
        businessDate,
        dailyRows: dayRows,
        hourlyRows: hourRows,
        exportedAt,
        reasonCode: 'DUPLICATE_DAILY_SOURCE',
        reasonSummary: `${dayRows.length} daily_revenue rows exist for one store/business date`,
      });
    }
    if (hourRows.length === 0) {
      return anomaly({
        businessDate,
        dailyRows: dayRows,
        hourlyRows: hourRows,
        exportedAt,
        reasonCode: 'NO_HOURLY_SOURCE',
        reasonSummary: 'no hourly_sales_summary rows exist for the business date',
      });
    }

    try {
      buildLegacyPosExport({
        businessDate,
        storeId,
        sourceProjectRef,
        exportedAt,
        daily: dayRows[0],
        hourly: hourRows,
      });
      return {
        businessDate,
        disposition: 'PROCESS',
        daily: dayRows[0],
        hourly: hourRows,
        exportedAt,
      };
    } catch (error) {
      return anomaly({
        businessDate,
        dailyRows: dayRows,
        hourlyRows: hourRows,
        exportedAt,
        reasonCode: 'SOURCE_RECONCILIATION_FAILED',
        reasonSummary: error.message,
      });
    }
  });

  return {
    entries,
    summary: {
      requestedDays: entries.length,
      processDays: entries.filter((entry) => entry.disposition === 'PROCESS').length,
      quarantineDays: entries.filter((entry) => entry.disposition === 'QUARANTINE').length,
    },
  };
}

export function compareLegacyPosMigrationPlan({
  plan,
  storeId,
  sourceProjectRef,
  window,
}) {
  if (!Array.isArray(plan?.entries)) throw new Error('migration plan entries are required');
  if (!Array.isArray(window?.daily)
      || !Array.isArray(window?.hourly)
      || !Array.isArray(window?.legacy_batches)) {
    throw new Error('R6 migration window is malformed');
  }
  const dailyByDate = new Map(window.daily.map((row) => [row.business_date, row]));
  const hourlyByDate = new Map();
  for (const row of window.hourly) {
    const rows = hourlyByDate.get(row.business_date) || [];
    rows.push(row);
    hourlyByDate.set(row.business_date, rows);
  }
  const batchesByDate = new Map();
  for (const row of window.legacy_batches) {
    const rows = batchesByDate.get(row.business_date) || [];
    rows.push(row);
    batchesByDate.set(row.business_date, rows);
  }

  const mismatches = [];
  for (const entry of plan.entries) {
    const batches = batchesByDate.get(entry.businessDate) || [];
    if (entry.disposition === 'PROCESS') {
      const acceptedBatch = batches.find((batch) => (
        batch.source_system === 'LEGACY_POS_EXPORT'
        && batch.status === 'READY'
        && batch.processing_status === 'SUCCEEDED'
      ));
      if (!acceptedBatch) {
        mismatches.push(`${entry.businessDate}: accepted legacy batch with SUCCEEDED processing is missing`);
      }
      const comparison = compareLegacyPosWithR6({
        businessDate: entry.businessDate,
        storeId,
        sourceProjectRef,
        exportedAt: entry.exportedAt,
        daily: entry.daily,
        hourly: entry.hourly,
        r6: {
          daily: dailyByDate.get(entry.businessDate) || null,
          hourly: hourlyByDate.get(entry.businessDate) || [],
        },
      });
      mismatches.push(...comparison.mismatches.map((message) => `${entry.businessDate}: ${message}`));
      continue;
    }

    const anomalyBatch = batches.find((batch) => (
      batch.source_system === 'LEGACY_POS_ANOMALY'
      && batch.status === 'QUARANTINED'
      && batch.reason_code === entry.reasonCode
    ));
    if (!anomalyBatch) {
      mismatches.push(
        `${entry.businessDate}: quarantined ${entry.reasonCode} evidence batch is missing`,
      );
    }
    const hasAcceptedFallback = batches.some((batch) => (
      batch.source_system === 'LEGACY_POS_EXPORT'
      && batch.status === 'READY'
      && batch.processing_status === 'SUCCEEDED'
    ));
    if (!hasAcceptedFallback && dailyByDate.has(entry.businessDate)) {
      mismatches.push(`${entry.businessDate}: current fact exists without an accepted fallback batch`);
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatchCount: mismatches.length,
    mismatches,
    processDays: plan.summary.processDays,
    quarantineDays: plan.summary.quarantineDays,
  };
}
