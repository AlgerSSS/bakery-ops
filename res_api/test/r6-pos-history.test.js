import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPECTED_R6_REF,
  EXPECTED_SOURCE_REF,
  parsePosHistoryArgs,
  partitionMigrationWindows,
  runPosHistory,
  verifyPosHistory,
} from '../lib/r6-pos-history.js';

test('history range is partitioned into inclusive windows of at most 31 days', () => {
  const windows = partitionMigrationWindows('2025-12-03', '2026-08-19');

  assert.equal(windows.length, 9);
  assert.deepEqual(windows[0], {
    fromDate: '2025-12-03',
    toDate: '2026-01-02',
    requestedDays: 31,
  });
  assert.deepEqual(windows.at(-1), {
    fromDate: '2026-08-08',
    toDate: '2026-08-19',
    requestedDays: 12,
  });
  assert.equal(windows.reduce((total, window) => total + window.requestedDays, 0), 260);
});

test('history CLI is dry-run by default and rejects ambiguous flags', () => {
  assert.deepEqual(
    parsePosHistoryArgs([
      '--from=2025-12-03',
      '--to=2026-08-19',
      '--old-store=Pavilion',
      '--r6-store=HC001',
    ]),
    {
      help: false,
      apply: false,
      fromDate: '2025-12-03',
      toDate: '2026-08-19',
      oldStore: 'Pavilion',
      r6Store: 'HC001',
    },
  );
  assert.throws(
    () => parsePosHistoryArgs([
      '--from=2025-12-03', '--to=2026-08-19', '--old-store=Pavilion',
      '--r6-store=HC001', '--apply=false',
    ]),
    /--apply does not accept a value/,
  );
  assert.throws(
    () => parsePosHistoryArgs([
      '--from=2025-12-03', '--to=2026-08-19', '--old-store=Pavilion',
      '--r6-store=HC001', '--continue-on-error',
    ]),
    /unknown option/,
  );
  assert.throws(
    () => parsePosHistoryArgs([
      '--from=2025-12-03', '--to=2026-08-19', '--old-store=Pavilion',
      '--r6-store=HC001', '--apply',
    ], { allowApply: false }),
    /unknown option --apply/,
  );
});

test('history ranges have a hard upper bound and real calendar validation', () => {
  assert.throws(
    () => partitionMigrationWindows('2026-02-30', '2026-03-01'),
    /real calendar date/,
  );
  assert.throws(
    () => partitionMigrationWindows('2015-01-01', '2026-01-01'),
    /cannot exceed 3660 days/,
  );
});

test('dry-run plans every window without draining or verifying', async () => {
  const calls = [];
  const result = await runPosHistory({
    args: {
      apply: false,
      fromDate: '2026-01-01',
      toDate: '2026-02-01',
      oldStore: 'Pavilion',
      r6Store: 'HC001',
    },
    sourceRef: EXPECTED_SOURCE_REF,
    targetRef: EXPECTED_R6_REF,
    registerWindow: async (window, apply) => {
      calls.push(['register', window.fromDate, apply]);
      return {
        requestedDays: window.requestedDays,
        processDays: window.requestedDays - 1,
        quarantineDays: 1,
      };
    },
    drainWindow: async () => calls.push(['drain']),
    verifyWindow: async () => calls.push(['verify']),
  });

  assert.deepEqual(calls, [
    ['register', '2026-01-01', false],
    ['register', '2026-02-01', false],
  ]);
  assert.deepEqual(result.totals, {
    requestedDays: 32,
    processDays: 30,
    quarantineDays: 2,
    verifiedWindows: 0,
  });
});

test('apply runs register, bounded drain, and verification sequentially per window', async () => {
  const calls = [];
  const result = await runPosHistory({
    args: {
      apply: true,
      fromDate: '2026-01-01',
      toDate: '2026-02-01',
      oldStore: 'Pavilion',
      r6Store: 'HC001',
    },
    sourceRef: EXPECTED_SOURCE_REF,
    targetRef: EXPECTED_R6_REF,
    registerWindow: async (window, apply) => {
      calls.push(['register', window.fromDate, apply]);
      return {
        requestedDays: window.requestedDays,
        processDays: window.requestedDays - 1,
        quarantineDays: 1,
      };
    },
    drainWindow: async (window, maxRuns) => {
      calls.push(['drain', window.fromDate, maxRuns]);
      return { processed: maxRuns, drained: true };
    },
    verifyWindow: async (window) => {
      calls.push(['verify', window.fromDate]);
      return { ok: true, mismatchCount: 0 };
    },
  });

  assert.deepEqual(calls, [
    ['register', '2026-01-01', true],
    ['drain', '2026-01-01', 31],
    ['verify', '2026-01-01'],
    ['register', '2026-02-01', true],
    ['drain', '2026-02-01', 1],
    ['verify', '2026-02-01'],
  ]);
  assert.equal(result.totals.verifiedWindows, 2);
});

test('apply stops immediately when a window does not reconcile', async () => {
  const calls = [];
  await assert.rejects(
    runPosHistory({
      args: {
        apply: true,
        fromDate: '2026-01-01',
        toDate: '2026-02-01',
        oldStore: 'Pavilion',
        r6Store: 'HC001',
      },
      sourceRef: EXPECTED_SOURCE_REF,
      targetRef: EXPECTED_R6_REF,
      registerWindow: async (window) => {
        calls.push(['register', window.fromDate]);
        return {
          requestedDays: window.requestedDays,
          processDays: window.requestedDays,
          quarantineDays: 0,
        };
      },
      drainWindow: async (window) => calls.push(['drain', window.fromDate]),
      verifyWindow: async (window) => {
        calls.push(['verify', window.fromDate]);
        return { ok: false, mismatchCount: 1, mismatches: ['missing fact'] };
      },
    }),
    /window 2026-01-01\.\.2026-01-31 failed reconciliation/,
  );
  assert.deepEqual(calls, [
    ['register', '2026-01-01'],
    ['drain', '2026-01-01'],
    ['verify', '2026-01-01'],
  ]);
});

test('apply retries a transient drain failure inside the same window', async () => {
  const calls = [];
  let drainAttempts = 0;
  const result = await runPosHistory({
    args: {
      apply: true,
      fromDate: '2026-01-01',
      toDate: '2026-01-01',
      oldStore: 'Pavilion',
      r6Store: 'HC001',
    },
    sourceRef: EXPECTED_SOURCE_REF,
    targetRef: EXPECTED_R6_REF,
    registerWindow: async () => {
      calls.push('register');
      return { requestedDays: 1, processDays: 1, quarantineDays: 0 };
    },
    drainWindow: async () => {
      drainAttempts += 1;
      calls.push(`drain-${drainAttempts}`);
      if (drainAttempts === 1) throw new Error('temporary TLS EOF');
      return { processed: 1, drained: true };
    },
    verifyWindow: async () => {
      calls.push('verify');
      return { ok: true, mismatchCount: 0 };
    },
    sleep: async () => calls.push('sleep'),
  });

  assert.deepEqual(calls, ['register', 'drain-1', 'sleep', 'drain-2', 'verify']);
  assert.equal(result.windows[0].drain.attempts, 2);
});

test('apply does not retry a deterministic worker validation failure', async () => {
  let drains = 0;
  await assert.rejects(
    runPosHistory({
      args: {
        apply: true,
        fromDate: '2026-01-01',
        toDate: '2026-01-01',
        oldStore: 'Pavilion',
        r6Store: 'HC001',
      },
      sourceRef: EXPECTED_SOURCE_REF,
      targetRef: EXPECTED_R6_REF,
      registerWindow: async () => (
        { requestedDays: 1, processDays: 1, quarantineDays: 0 }
      ),
      drainWindow: async () => {
        drains += 1;
        throw new Error('PosDataValidationError: sha256 mismatch');
      },
      verifyWindow: async () => assert.fail('must not verify'),
      sleep: async () => assert.fail('must not sleep'),
    }),
    /sha256 mismatch/,
  );
  assert.equal(drains, 1);
});

test('apply refuses any source or target project outside the fixed migration lane', async () => {
  const base = {
    args: {
      apply: true,
      fromDate: '2026-01-01',
      toDate: '2026-01-01',
      oldStore: 'Pavilion',
      r6Store: 'HC001',
    },
    registerWindow: async () => assert.fail('must not register'),
    drainWindow: async () => assert.fail('must not drain'),
    verifyWindow: async () => assert.fail('must not verify'),
  };

  await assert.rejects(
    runPosHistory({ ...base, sourceRef: EXPECTED_R6_REF, targetRef: EXPECTED_R6_REF }),
    /source project must be/,
  );
  await assert.rejects(
    runPosHistory({ ...base, sourceRef: EXPECTED_SOURCE_REF, targetRef: EXPECTED_SOURCE_REF }),
    /target project must be/,
  );
});

test('independent history verification aggregates every window and fails closed', async () => {
  const calls = [];
  const args = {
    apply: false,
    fromDate: '2026-01-01',
    toDate: '2026-02-01',
    oldStore: 'Pavilion',
    r6Store: 'HC001',
  };
  const result = await verifyPosHistory({
    args,
    sourceRef: EXPECTED_SOURCE_REF,
    targetRef: EXPECTED_R6_REF,
    verifyWindow: async (window) => {
      calls.push(window.fromDate);
      return {
        ok: true,
        mismatchCount: 0,
        processDays: window.requestedDays,
        quarantineDays: 0,
        sourceDailyRows: window.requestedDays,
        sourceHourlyRows: window.requestedDays * 10,
        r6DailyRows: window.requestedDays,
        r6HourlyRows: window.requestedDays * 10,
        r6LegacyBatches: window.requestedDays,
      };
    },
  });

  assert.deepEqual(calls, ['2026-01-01', '2026-02-01']);
  assert.deepEqual(result.totals, {
    requestedDays: 32,
    processDays: 32,
    quarantineDays: 0,
    sourceDailyRows: 32,
    sourceHourlyRows: 320,
    r6DailyRows: 32,
    r6HourlyRows: 320,
    r6LegacyBatches: 32,
    mismatchCount: 0,
  });

  await assert.rejects(
    verifyPosHistory({
      args: { ...args, toDate: '2026-01-01' },
      sourceRef: EXPECTED_SOURCE_REF,
      targetRef: EXPECTED_R6_REF,
      verifyWindow: async () => ({
        ok: false,
        mismatchCount: 1,
        mismatches: ['daily row missing'],
      }),
    }),
    /failed reconciliation/,
  );
});
