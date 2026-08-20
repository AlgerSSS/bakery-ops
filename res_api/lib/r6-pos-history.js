const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 31;
const MAX_HISTORY_DAYS = 3660;
const OPTIONS = new Set(['from', 'to', 'old-store', 'r6-store', 'apply', 'help']);

export const EXPECTED_SOURCE_REF = 'ecsgqcmwtjmcpzqytdqw';
export const EXPECTED_R6_REF = 'tmmkknnkcptunxbfjxqn';

function utcDate(value, field) {
  if (!ISO_DATE.test(value || '')) throw new Error(`${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a real calendar date`);
  }
  return parsed;
}

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

export function partitionMigrationWindows(fromDate, toDate) {
  const from = utcDate(fromDate, 'from date');
  const to = utcDate(toDate, 'to date');
  if (from > to) throw new Error('from date must not be after to date');
  const requestedDays = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (requestedDays > MAX_HISTORY_DAYS) {
    throw new Error(`history migration cannot exceed ${MAX_HISTORY_DAYS} days`);
  }

  const windows = [];
  for (let offset = 0; offset < requestedDays; offset += WINDOW_DAYS) {
    const start = new Date(from.getTime() + offset * DAY_MS);
    const days = Math.min(WINDOW_DAYS, requestedDays - offset);
    const end = new Date(start.getTime() + (days - 1) * DAY_MS);
    windows.push({
      fromDate: isoDate(start),
      toDate: isoDate(end),
      requestedDays: days,
    });
  }
  return windows;
}

export function parsePosHistoryArgs(argv, { allowApply = true } = {}) {
  const parsed = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) throw new Error(`unexpected positional argument ${raw}`);
    const [key, ...parts] = raw.slice(2).split('=');
    if (!OPTIONS.has(key) || (key === 'apply' && !allowApply)) {
      throw new Error(`unknown option --${key}`);
    }
    if (['apply', 'help'].includes(key) && raw.includes('=')) {
      throw new Error(`--${key} does not accept a value`);
    }
    if (Object.hasOwn(parsed, key)) throw new Error(`duplicate option --${key}`);
    parsed[key] = parts.join('=');
  }
  if (Object.hasOwn(parsed, 'help')) return { help: true };
  if (!parsed.from || !parsed.to) throw new Error('--from and --to are required');
  partitionMigrationWindows(parsed.from, parsed.to);
  if (!parsed['old-store']?.trim()) throw new Error('--old-store is required');
  if (!parsed['r6-store']?.trim()) throw new Error('--r6-store is required');
  return {
    help: false,
    apply: Object.hasOwn(parsed, 'apply'),
    fromDate: parsed.from,
    toDate: parsed.to,
    oldStore: parsed['old-store'].trim(),
    r6Store: parsed['r6-store'].trim(),
  };
}

function validateLane(sourceRef, targetRef) {
  if (sourceRef !== EXPECTED_SOURCE_REF) {
    throw new Error(`source project must be ${EXPECTED_SOURCE_REF}; received ${sourceRef}`);
  }
  if (targetRef !== EXPECTED_R6_REF) {
    throw new Error(`target project must be ${EXPECTED_R6_REF}; received ${targetRef}`);
  }
}

function validatePlan(window, plan) {
  for (const field of ['requestedDays', 'processDays', 'quarantineDays']) {
    if (!Number.isInteger(plan?.[field]) || plan[field] < 0) {
      throw new Error(`window ${window.fromDate}..${window.toDate} has invalid ${field}`);
    }
  }
  if (plan.requestedDays !== window.requestedDays
      || plan.processDays + plan.quarantineDays !== window.requestedDays) {
    throw new Error(`window ${window.fromDate}..${window.toDate} has inconsistent plan counts`);
  }
}

function retryableDrainError(error) {
  return /(connecterror|connecttimeout|readtimeout|remoteprotocolerror|tls|ssl|eof|timed?\s*out|temporary failure|network)/i
    .test(error?.message || '');
}

async function drainWithRetry({
  window,
  drainWindow,
  onProgress,
  sleep,
  maxAttempts,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await drainWindow(window, window.requestedDays);
      const details = result && typeof result === 'object' ? result : { result };
      return { ...details, attempts: attempt };
    } catch (error) {
      if (attempt >= maxAttempts || !retryableDrainError(error)) throw error;
      onProgress({
        event: 'drain-retry',
        fromDate: window.fromDate,
        toDate: window.toDate,
        attempt,
        error: error.message.slice(0, 500),
      });
      await sleep(attempt * 2_000);
    }
  }
  throw new Error('unreachable POS drain retry state');
}

export async function runPosHistory({
  args,
  sourceRef,
  targetRef,
  registerWindow,
  drainWindow,
  verifyWindow,
  onProgress = () => {},
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxDrainAttempts = 3,
}) {
  validateLane(sourceRef, targetRef);
  const windows = partitionMigrationWindows(args.fromDate, args.toDate);
  const results = [];

  for (const window of windows) {
    onProgress({ event: 'window-started', ...window, mode: args.apply ? 'apply' : 'dry-run' });
    const plan = await registerWindow(window, args.apply);
    validatePlan(window, plan);
    const result = { ...window, plan };

    if (args.apply) {
      result.drain = await drainWithRetry({
        window,
        drainWindow,
        onProgress,
        sleep,
        maxAttempts: maxDrainAttempts,
      });
      result.verification = await verifyWindow(window);
      if (!result.verification?.ok || result.verification.mismatchCount !== 0) {
        throw new Error(
          `window ${window.fromDate}..${window.toDate} failed reconciliation: `
          + JSON.stringify(result.verification?.mismatches || []),
        );
      }
    }

    results.push(result);
    onProgress({ event: 'window-completed', ...window, mode: args.apply ? 'apply' : 'dry-run' });
  }

  return {
    mode: args.apply ? 'apply' : 'dry-run',
    sourceProjectRef: sourceRef,
    targetProjectRef: targetRef,
    fromDate: args.fromDate,
    toDate: args.toDate,
    windows: results,
    totals: {
      requestedDays: results.reduce((sum, result) => sum + result.plan.requestedDays, 0),
      processDays: results.reduce((sum, result) => sum + result.plan.processDays, 0),
      quarantineDays: results.reduce((sum, result) => sum + result.plan.quarantineDays, 0),
      verifiedWindows: args.apply ? results.length : 0,
    },
  };
}

export async function verifyPosHistory({
  args,
  sourceRef,
  targetRef,
  verifyWindow,
  onProgress = () => {},
}) {
  validateLane(sourceRef, targetRef);
  const windows = partitionMigrationWindows(args.fromDate, args.toDate);
  const results = [];
  const numericFields = [
    'processDays',
    'quarantineDays',
    'sourceDailyRows',
    'sourceHourlyRows',
    'r6DailyRows',
    'r6HourlyRows',
    'r6LegacyBatches',
  ];

  for (const window of windows) {
    onProgress({ event: 'verification-window-started', ...window });
    const verification = await verifyWindow(window);
    if (!verification?.ok || verification.mismatchCount !== 0) {
      throw new Error(
        `window ${window.fromDate}..${window.toDate} failed reconciliation: `
        + JSON.stringify(verification?.mismatches || []),
      );
    }
    for (const field of numericFields) {
      if (!Number.isInteger(verification[field]) || verification[field] < 0) {
        throw new Error(`window ${window.fromDate}..${window.toDate} has invalid ${field}`);
      }
    }
    if (verification.processDays + verification.quarantineDays !== window.requestedDays
        || verification.r6DailyRows !== verification.processDays
        || verification.r6LegacyBatches !== window.requestedDays) {
      throw new Error(`window ${window.fromDate}..${window.toDate} has inconsistent counts`);
    }
    results.push({ ...window, verification });
    onProgress({ event: 'verification-window-completed', ...window });
  }

  return {
    ok: true,
    sourceProjectRef: sourceRef,
    targetProjectRef: targetRef,
    fromDate: args.fromDate,
    toDate: args.toDate,
    windows: results,
    totals: {
      requestedDays: windows.reduce((sum, window) => sum + window.requestedDays, 0),
      processDays: results.reduce((sum, result) => sum + result.verification.processDays, 0),
      quarantineDays: results.reduce(
        (sum, result) => sum + result.verification.quarantineDays,
        0,
      ),
      sourceDailyRows: results.reduce(
        (sum, result) => sum + result.verification.sourceDailyRows,
        0,
      ),
      sourceHourlyRows: results.reduce(
        (sum, result) => sum + result.verification.sourceHourlyRows,
        0,
      ),
      r6DailyRows: results.reduce(
        (sum, result) => sum + result.verification.r6DailyRows,
        0,
      ),
      r6HourlyRows: results.reduce(
        (sum, result) => sum + result.verification.r6HourlyRows,
        0,
      ),
      r6LegacyBatches: results.reduce(
        (sum, result) => sum + result.verification.r6LegacyBatches,
        0,
      ),
      mismatchCount: 0,
    },
  };
}
