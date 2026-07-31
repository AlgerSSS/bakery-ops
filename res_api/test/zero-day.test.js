// 「今天真的没生意」vs「今天的数据没抓到」的判定单测。
// 这里只测纯逻辑；它接在 sync-to-db 上的效果由 test/sync-to-db.test.js 端到端验证。

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWitness, classifyBusinessDate, dailyWitnesses } from '../lib/zero-day.js';
import { resolveDailyRevenueRecords, zeroSalesRecord } from '../lib/daily-revenue-resolver.js';

const D = '2026-07-26';
const WINDOW = ['2026-07-23', D];

const liveZero = (name) =>
  buildWitness(name, {
    queryOk: true,
    window: WINDOW,
    // 窗口里另外三天有流水（证明查询是活的），唯独当天一行没有。
    rows: [{ date: '2026-07-24', netSales: 100 }, { date: '2026-07-25', netSales: 120 }],
    activeOf: (r) => Number(r.netSales) !== 0,
  });

test('两个独立来源都问过当天、都报零、且各自窗口内有别的日子有流水 -> closed', () => {
  const v = classifyBusinessDate(D, [liveZero('888001'), liveZero('211')]);
  assert.equal(v.verdict, 'closed');
  assert.deepEqual(v.attesting, ['888001', '211']);
  assert.match(v.reason, /都报零/);
});

test('只有一个来源作证时不够（单一来源坏掉与门店停业长得一样）', () => {
  const v = classifyBusinessDate(D, [liveZero('888001')]);
  assert.equal(v.verdict, 'unknown');
  assert.deepEqual(v.attesting, ['888001']);
});

test('整窗口一行都没有的来源没有作证资格 —— 「0 行 = 没生意」正是要防的陷阱', () => {
  const dead = (name) => buildWitness(name, { queryOk: true, window: WINDOW, rows: [] });
  const v = classifyBusinessDate(D, [dead('888001'), dead('211')]);
  assert.equal(v.verdict, 'unknown', '连续四天零行只可能是查询坏了');
  assert.deepEqual(v.attesting, []);
  assert.match(v.reason, /无法证明查询是活的/);
});

test('当晚查询失败的来源没有作证资格（它的沉默是失败的副产品）', () => {
  const broken = buildWitness('211', { queryOk: false, window: WINDOW, rows: [] });
  const v = classifyBusinessDate(D, [liveZero('888001'), broken]);
  assert.equal(v.verdict, 'unknown');
  assert.match(v.reason, /211=当晚查询失败/);
});

test('窗口没覆盖当天的来源没有作证资格（它压根没问过）', () => {
  const narrow = buildWitness('211', {
    queryOk: true,
    window: ['2026-07-20', '2026-07-25'],
    rows: [{ date: '2026-07-24', netSales: 100 }],
    activeOf: (r) => Number(r.netSales) !== 0,
  });
  const v = classifyBusinessDate(D, [liveZero('888001'), narrow]);
  assert.equal(v.verdict, 'unknown');
  assert.match(v.reason, /没问过当天/);
});

test('任何一个来源报出当天有流水就是反证 -> present（那是抓取缺失，必须响亮失败）', () => {
  const hasToday = buildWitness('csv', {
    attestable: false,
    queryOk: true,
    rows: [{ date: D, netSales: 5000 }],
    activeOf: (r) => Number(r.netSales) !== 0,
  });
  const v = classifyBusinessDate(D, [liveZero('888001'), liveZero('211'), hasToday]);
  assert.equal(v.verdict, 'present', '两个来源报零也压不过一个明确的反证');
  assert.deepEqual(v.contradicting, ['csv']);
});

test('只反证不作证的来源（报损/CSV）自己凑不出 closed', () => {
  const csvZero = buildWitness('csv', { attestable: false, queryOk: true, rows: [{ date: '2026-07-24', netSales: 1 }], activeOf: () => true });
  const wasteZero = buildWitness('waste', { attestable: false, queryOk: true, window: WINDOW, rows: [] });
  assert.equal(classifyBusinessDate(D, [csvZero, wasteZero]).verdict, 'unknown');
  // 但它们能把一个本来成立的 closed 推翻。
  assert.equal(classifyBusinessDate(D, [liveZero('a'), liveZero('b'), csvZero, wasteZero]).verdict, 'closed');
});

test('当天有报损 = 门店在运营且后台有当天的数据 -> 反证「一单都没有」', () => {
  const daily = {
    perDayRange: WINDOW,
    queryStatus: { hourlyByDate: 'ok', itemsByDateHour: 'ok', itemWaste: 'ok' },
    hourlyByDate: [{ date: '2026-07-24', netSales: 100, billCount: 3 }],
    itemsByDateHour: [{ date: '2026-07-24', qty: 5, netSales: 50 }],
    itemWaste: [{ date: D, qty: 3, amount: 9 }],
  };
  const v = classifyBusinessDate(D, dailyWitnesses(daily));
  assert.equal(v.verdict, 'present');
  assert.match(v.contradicting.join(), /itemWaste/);
});

test('POS 明确返回一行全零的当天，比「没有这一行」是更强的零证据', () => {
  const explicitZero = (name) =>
    buildWitness(name, {
      queryOk: true,
      window: WINDOW,
      rows: [{ date: '2026-07-24', netSales: 100 }, { date: D, netSales: 0, billCount: 0 }],
      activeOf: (r) => Number(r.netSales) !== 0 || Number(r.billCount) > 0,
    });
  assert.equal(classifyBusinessDate(D, [explicitZero('a'), explicitZero('b')]).verdict, 'closed');
});

test('dailyWitnesses 从真实形态的 daily.json 造证人：公假当晚判 closed', () => {
  const days = ['2026-07-23', '2026-07-24', '2026-07-25'];
  const daily = {
    perDayRange: WINDOW,
    queryStatus: { hourlyByDate: 'ok', itemsByDateHour: 'ok', itemWaste: 'ok' },
    hourlyByDate: days.map((d) => ({ date: d, hour: '12', billCount: 5, netSales: 100 })),
    itemsByDateHour: days.map((d) => ({ date: d, name: 'x', hour: '12', qty: 2, netSales: 20 })),
    itemWaste: [],
  };
  const csvRows = days.map((d) => ({ 'Business Date': d, 'Net Sales': '900', 'Bill Count': '20' }));
  const v = classifyBusinessDate(D, dailyWitnesses(daily, { csvRows }));
  assert.equal(v.verdict, 'closed');
  assert.equal(v.attesting.length, 2);

  // 同一份数据，只要 CSV 里出现当天且非零，立刻翻成 present。
  const withToday = [...csvRows, { 'Business Date': D, 'Net Sales': '4200', 'Bill Count': '60' }];
  assert.equal(classifyBusinessDate(D, dailyWitnesses(daily, { csvRows: withToday })).verdict, 'present');
});

test('daily.json 读不出来时不会瞎判（没有证人 -> unknown）', () => {
  assert.equal(classifyBusinessDate(D, dailyWitnesses(null)).verdict, 'unknown');
  assert.equal(classifyBusinessDate(D, []).verdict, 'unknown');
});

// ---------- daily_revenue 的 0 / NULL 语义 ----------

test('零流水日记录：事实为零写 0，0/0 的比率写 NULL', () => {
  assert.deepEqual(zeroSalesRecord(D), {
    date: D,
    revenue: 0,
    transaction_count: 0,
    avg_transaction_value: null,
    gross_sales: 0,
    total_discount: 0,
    discount_rate: null,
    member_sales_ratio: null,
  });
});

test('resolveDailyRevenueRecords 只有拿到 zeroDay 授权才补零行，否则照旧抛错', () => {
  const csvRows = [{ 'Business Date': '2026-07-25', 'Net Sales': '900' }];
  assert.throws(
    () => resolveDailyRevenueRecords({ csvRows, daily: { hourlyByDate: [] }, expectedDate: D }),
    /missing expected business date/,
  );

  const zero = resolveDailyRevenueRecords({ csvRows, daily: { hourlyByDate: [] }, expectedDate: D, zeroDay: true });
  assert.equal(zero.zeroDayUsed, true);
  assert.equal(zero.fallbackUsed, false, '零流水日的 0 是事实，不是降级近似值 —— 不能被 COALESCE 锁住');
  assert.equal(zero.records.at(-1).revenue, 0);
  assert.equal(zero.records.length, 2, 'CSV 里其他日期的记录一条都不能丢');
});

test('partialWhenMissing：当天没来源也先把其他日期交出来，由调用方记 PARTIAL', () => {
  const csvRows = [
    { 'Business Date': '2026-07-24', 'Net Sales': '800' },
    { 'Business Date': '2026-07-25', 'Net Sales': '900' },
  ];
  const out = resolveDailyRevenueRecords({
    csvRows,
    daily: { hourlyByDate: [] },
    expectedDate: D,
    partialWhenMissing: true,
  });
  assert.equal(out.missingExpectedDate, true);
  assert.equal(out.zeroDayUsed, false);
  assert.deepEqual(out.records.map((r) => r.date), ['2026-07-24', '2026-07-25'], '好日子一天都不能丢');
  // 不开这个开关时（--daily-revenue-only 的抢修模式）仍然硬失败。
  assert.throws(
    () => resolveDailyRevenueRecords({ csvRows, daily: { hourlyByDate: [] }, expectedDate: D }),
    /missing expected business date/,
  );
});

test('有小时数据时优先走降级聚合，zeroDay 不参与（有生意就不是零流水日）', () => {
  const out = resolveDailyRevenueRecords({
    csvRows: [],
    daily: { hourlyByDate: [{ date: D, hour: '12', billCount: 4, netSales: 400, grossSales: 440, discount: 40 }] },
    expectedDate: D,
    zeroDay: true,
  });
  assert.equal(out.zeroDayUsed, false);
  assert.equal(out.fallbackUsed, true);
  assert.equal(out.records[0].revenue, 400);
});

test('0 笔交易的客单价是 NULL 而不是 0（0/0 未定义，写 0 会污染下游均值）', () => {
  const out = resolveDailyRevenueRecords({
    csvRows: [],
    daily: { hourlyByDate: [{ date: D, hour: '12', billCount: 0, netSales: 0, grossSales: 0, discount: 0 }] },
    expectedDate: D,
  });
  assert.equal(out.records[0].avg_transaction_value, null);
  assert.equal(out.records[0].revenue, 0);
});
