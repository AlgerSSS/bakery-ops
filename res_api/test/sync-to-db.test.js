// sync-to-db.js **本体**的行为测试：真的把脚本跑起来，只把 postgres 驱动换成假的
// （test/fixtures/fake-postgres.mjs，见那里的说明）。不连任何数据库、不碰仓库里的 output/。
//
// 存在的理由是上一轮变异测试漏过的那两处，全都在这个文件里、全都是「调用处」的判定：
//   1) syncDailyRevenue 里 dailySection 的 try/catch（改成永远吞掉也不红）
//   2) item_hourly_sales 的行数塌陷护栏 `if (n >= 20 && now < n * SHRINK_RATIO)`（改成 if(false) 也不红）
// 把等价逻辑搬进 lib 再测 lib 只能证明 lib 对，证明不了 sync-to-db 真的用了它。
// 所以这里断言的是「哪些语句真的发给了数据库」——DELETE 发没发出去，是这几个护栏唯一说了算的事。
//
// 2026-07-31（迁移 068）起，daily_sales_record / timeslot_sales_record 变成了由
// item_hourly_sales 派生的**视图**：本脚本不许再对它们发任何 INSERT/DELETE/TRUNCATE，
// 发了就是对视图写入、直接炸。每个用例末尾的 neverWriteViews 就是钉这件事的。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const SYNC = new URL('../sync-to-db.js', import.meta.url).pathname;
const PRELOAD = new URL('./fixtures/pg-preload.mjs', import.meta.url).pathname;
const EXPECTED = '2026-07-26';
const WINDOW = ['2026-07-23', EXPECTED];

const hourRow = (date, hour, netSales = 100) => ({
  date, hour: String(hour), billCount: 5, guests: 6, avgTicket: 20, grossSales: netSales + 10, netSales, discount: 10,
});
const itemRow = (date, hour, name, qty = 3) => ({
  date, name, hour: String(hour), qty, netSales: 30, grossSales: 33,
});

/** 一份「今晚刚抓完、四天俱全」的 daily.json。overrides 用来造各种病态形态。 */
function freshDaily(overrides = {}) {
  const days = ['2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'];
  return {
    dateRange: ['2026-06-27', EXPECTED],
    businessDate: EXPECTED,
    perDayRange: WINDOW,
    scrapedAt: '2026-07-26T15:10:00.000Z', // KL 23:10 当晚
    queryStatus: {
      summary: 'ok', hourly: 'ok', items: 'ok',
      hourlyByDate: 'ok', itemsByDateHour: 'ok', itemWaste: 'ok',
    },
    hourlyByDate: days.flatMap((d) => [hourRow(d, 12), hourRow(d, 13)]),
    itemsByDateHour: days.flatMap((d) => [itemRow(d, 12, '蛋挞'), itemRow(d, 13, '拿铁')]),
    itemWaste: days.slice(0, 3).map((d) => ({ date: d, name: '蛋挞', reason: 'abnormal loss', qty: 1, amount: 2 })),
    ...overrides,
  };
}

const csvFor = (dates) =>
  ['Business Date,Net Sales,Gross Sales,Bill Count,Avg Order Net Sales,Amount Of Discount,Total Payment received,Payment Subtotal — Cash']
    .concat(dates.map((d) => `${d},900.50,1000.00,20,45.02,99.50,950.00,500.00`))
    .join('\n');

const DINING_CSV = 'Dining Options,Bill Count\nDine-in,80\nTakeaway,20\n';

/** 默认的库侧回应：行数塌陷护栏查不到旧行。 */
const DEFAULT_SCRIPT = [];

function runSync({ daily = freshDaily(), csvDates = ['2026-07-23', '2026-07-24', '2026-07-25', EXPECTED], script = [] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'hotcrush-sync-'));
  try {
    mkdirSync(path.join(root, 'output', 'daily'), { recursive: true });
    mkdirSync(path.join(root, 'output', 'sales', 'readable'), { recursive: true });
    if (daily) writeFileSync(path.join(root, 'output/daily/daily.json'), JSON.stringify(daily));
    writeFileSync(path.join(root, 'output/sales/translations.json'), JSON.stringify({ dimOptions: { D_itemName: {} } }));
    writeFileSync(path.join(root, 'output/sales/readable/sales_by_business_date.csv'), csvFor(csvDates));
    writeFileSync(path.join(root, 'output/sales/readable/orders_by_dining_option.csv'), DINING_CSV);

    const logFile = path.join(root, 'pg.jsonl');
    const scriptFile = path.join(root, 'pg-script.json');
    writeFileSync(logFile, '');
    writeFileSync(scriptFile, JSON.stringify([...script, ...DEFAULT_SCRIPT]));

    const run = spawnSync(process.execPath, ['--import', PRELOAD, SYNC, `--expected-date=${EXPECTED}`], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        // 假地址里的 fake_pg_only 是 fake-postgres.mjs 的准入标记：指到真库会直接抛错。
        DATABASE_URL: 'postgres://fake:fake@127.0.0.1:1/fake_pg_only',
        FAKE_PG_LOG: logFile,
        FAKE_PG_SCRIPT: scriptFile,
      },
    });

    const entries = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const queries = entries.filter((e) => e.kind === 'query');
    return {
      status: run.status,
      out: `${run.stdout}${run.stderr}`,
      queries,
      /** 发出过匹配 re 的语句吗（可再按参数过滤）。 */
      sent: (re, valueFilter = () => true) => queries.some((q) => re.test(q.text) && valueFilter(q.values)),
      deleted: (table) =>
        queries.filter((q) => new RegExp(`DELETE FROM ${table} WHERE date =`).test(q.text)).map((q) => q.values[0]).sort(),
      revenueRowFor: (date) =>
        queries.find((q) => /INSERT INTO daily_revenue/.test(q.text) && q.values[0] === date)?.values || null,
      /** 派生视图是禁区：对它们发任何写语句，迁移 068 之后就是对视图写入。 */
      neverWriteViews: () => {
        for (const q of queries) {
          assert.ok(
            !/(INSERT INTO|DELETE FROM|UPDATE|TRUNCATE)\s+(daily_sales_record|timeslot_sales_record)/.test(q.text),
            `不许再写派生视图: ${q.text}`,
          );
        }
      },
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------- 正常之夜：确认这套改造没有把好日子弄坏 ----------

test('四天俱全的正常之夜：七步全过，exit 0，两个维度照常写进 daily_breakdown', () => {
  const r = runSync();

  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /定性 = present/);
  assert.deepEqual(r.deleted('item_hourly_sales'), ['2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26']);
  assert.ok(r.sent(/INSERT INTO daily_breakdown[\s\S]*?'payment'/), '支付维度必须写入');
  assert.ok(r.sent(/INSERT INTO daily_breakdown[\s\S]*?'dining'/), '就餐维度必须写入');
  assert.ok(r.revenueRowFor(EXPECTED), 'daily_revenue 必须写到业务日当天');
  r.neverWriteViews();
});

test('陈旧 daily.json：第 2/3/6 步一行不删不写（守卫真的接在调用处）', () => {
  // 盘上躺了两天的产物（scrapedAt=07-24）。以前是 `[skip] return 0` 静默成功后照样 DELETE+INSERT。
  const r = runSync({ daily: freshDaily({ scrapedAt: '2026-07-24T16:36:12.627Z' }) });

  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /陈旧/);
  assert.deepEqual(r.deleted('item_hourly_sales'), []);
  assert.deepEqual(r.deleted('item_waste'), []);
  assert.ok(!r.sent(/INSERT INTO hourly_sales_summary/));
  // 只读 CSV 的第 4/5 步与 daily.json 无关，照常写（一张表的源坏了不该让另外几张也空一晚）。
  assert.ok(r.sent(/INSERT INTO daily_breakdown[\s\S]*?'payment'/));
  assert.ok(r.sent(/INSERT INTO daily_breakdown[\s\S]*?'dining'/));
  r.neverWriteViews();
});

// ---------- 一、零流水日不再误伤 ----------

test('零流水日（公假停业）：当天无明细，但窗口内另外三天照写，整体 exit 0', () => {
  // 形态：所有查询都成功，窗口问过 07-26，可就是没有 07-26 的行；CSV 里也没有 07-26。
  const days = ['2026-07-23', '2026-07-24', '2026-07-25'];
  const r = runSync({
    daily: freshDaily({
      hourlyByDate: days.flatMap((d) => [hourRow(d, 12), hourRow(d, 13)]),
      itemsByDateHour: days.flatMap((d) => [itemRow(d, 12, '蛋挞')]),
      itemWaste: [],
    }),
    csvDates: days,
  });

  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /定性 = closed/);
  // 好日子照写：这正是上一轮「全有全无」丢掉的东西。
  assert.deepEqual(r.deleted('item_hourly_sales'), days);
  // 当天一行明细都不写（明细表只记录发生过的事）。
  assert.ok(!r.deleted('item_hourly_sales').includes(EXPECTED));
  assert.ok(!r.sent(/INSERT INTO hourly_sales_summary/, (v) => v[0] === EXPECTED));
  assert.ok(!r.sent(/INSERT INTO daily_breakdown/, (v) => v[0] === EXPECTED));
  r.neverWriteViews();
});

test('零流水日在 daily_revenue 留一行显式的 0：0 是实测事实，0/0 的比率写 NULL', () => {
  const days = ['2026-07-23', '2026-07-24', '2026-07-25'];
  const r = runSync({
    daily: freshDaily({
      hourlyByDate: days.flatMap((d) => [hourRow(d, 12)]),
      itemsByDateHour: days.flatMap((d) => [itemRow(d, 12, '蛋挞')]),
      itemWaste: [],
    }),
    csvDates: days,
  });

  const row = r.revenueRowFor(EXPECTED);
  assert.ok(row, `零流水日必须写 daily_revenue：${r.out}`);
  // 迁移 102 起 store 是第 2 个参数（唯一键成了 (date, store)），后面的位次整体后移一位。
  assert.equal(row[1], '吉隆坡Pavilion门店', 'store 必须写进去，否则新唯一键匹配不上');
  assert.equal(row[2], 0, 'revenue = 0（当天真的没有流水）');
  assert.equal(row[3], 0, 'transaction_count = 0');
  assert.equal(row[4], null, '客单价 = 0/0 未定义，必须 NULL 而不是 0');
  assert.equal(row[5], 0, 'gross_sales = 0');
  assert.equal(row[7], null, '折扣率 = 0/0 未定义，必须 NULL');
  assert.equal(row[8], null, '会员占比 = 0/0 未定义，必须 NULL');
  assert.equal(row[9], false, '零流水日不是降级近似值，不能走 COALESCE 保护（否则晚到的真值永远盖不回来）');
});

test('判不出是不是零流水日：其他天照写，当天不写，该步 PARTIAL 且整体 exit 1', () => {
  // 形态：hourlyByDate 有当天（=当天确有生意），itemsByDateHour 却没有 -> 这是抓取缺失，
  // 绝不能当成零流水日，但也不该让另外三天跟着不写。
  const days = ['2026-07-23', '2026-07-24', '2026-07-25'];
  const r = runSync({
    daily: freshDaily({
      itemsByDateHour: days.flatMap((d) => [itemRow(d, 12, '蛋挞')]),
    }),
  });

  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /定性 = present/);
  assert.match(r.out, /PARTIAL/);
  assert.deepEqual(r.deleted('item_hourly_sales'), days, '另外三天必须照写');
  assert.ok(!r.deleted('item_hourly_sales').includes(EXPECTED), '当天不许写');
  r.neverWriteViews();
});

test('整窗口零行的源没有作证资格（0 行 != 没生意），判成 unknown 而不是 closed', () => {
  // hourlyByDate / itemsByDateHour 都是空数组：这不是「连着停业四天」，是查询坏了。
  const r = runSync({
    daily: freshDaily({ hourlyByDate: [], itemsByDateHour: [], itemWaste: [] }),
    csvDates: ['2026-07-23', '2026-07-24', '2026-07-25'],
  });

  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /定性 = unknown/);
  assert.match(r.out, /无法证明查询是活的/);
  assert.equal(r.revenueRowFor(EXPECTED), null, '判不出来时绝不写当天的 0');
  // 但第 1 步不是全有全无：CSV 里其他日期的精确记录照写，当天缺失单独记 PARTIAL。
  assert.ok(r.revenueRowFor('2026-07-25'), 'daily_revenue 的其他日期必须照常写入');
  assert.ok(r.revenueRowFor('2026-07-23'));
  assert.match(
    r.out,
    /- 1\. daily_revenue \(existing\): daily_revenue 没有 2026-07-26 的任何来源/,
    '写了其他天不等于这一步成功：当天缺失必须出现在失败汇总里',
  );
});

// ---------- 二、补齐变异测试漏过的三处（都在本文件的调用处） ----------

test('漏点 1：CSV 缺当天时必须真的用 daily.json 当降级源（try/catch 不许把它吞成 {}）', () => {
  // dailySection 那句 try/catch 若「永远吞掉」，daily 就永远是 {}，
  // 降级源消失 -> 第 1 步直接失败、当天 daily_revenue 一行不写。
  const r = runSync({ csvDates: ['2026-07-23', '2026-07-24', '2026-07-25'] });

  assert.match(r.out, /resolved from hourlyByDate fallback/);
  const row = r.revenueRowFor(EXPECTED);
  assert.ok(row, `必须用小时聚合补出当天的 daily_revenue：${r.out}`);
  assert.equal(row[1], '吉隆坡Pavilion门店', 'store 必须写进去');
  assert.equal(row[2], 200, '两条 hourlyByDate（各 100）聚合出 200');
  assert.equal(row[9], true, '降级出来的当天记录必须打 degraded 标记（走 COALESCE 保护）');
});

test('漏点 2：itemsByDateHour 失败时，item_hourly_sales 一行不删不写，其余步骤照常', () => {
  // itemsByDateHour 当晚查询失败 -> 第 3 步失败。派生视图直接读 item_hourly_sales，
  // 只要这一步没写入，视图自然停在旧数据上 —— 不需要也不再有「重建基线」这一步。
  const r = runSync({
    daily: freshDaily({
      queryStatus: {
        summary: 'ok', hourly: 'ok', items: 'ok',
        hourlyByDate: 'ok', itemsByDateHour: 'failed(status=500 code=undefined)', itemWaste: 'ok',
      },
    }),
  });

  assert.equal(r.status, 1, r.out);
  assert.deepEqual(r.deleted('item_hourly_sales'), []);
  assert.ok(!r.sent(/INSERT INTO item_hourly_sales/));
  // 第 2/4/5/7 步与 itemsByDateHour 无关，必须照常写。
  assert.ok(r.sent(/INSERT INTO hourly_sales_summary/));
  assert.ok(r.sent(/INSERT INTO daily_breakdown[\s\S]*?'payment'/));
  r.neverWriteViews();
});

test('漏点 3：行数塌陷时整笔回滚，一条 DELETE 都不许发出去', () => {
  // 库里 07-23 有 200 行，今晚只剩 2 行（源被截断）-> 必须在 DELETE 之前抛。
  const r = runSync({
    script: [
      {
        match: 'COUNT\\(\\*\\)::int AS n FROM item_hourly_sales',
        rows: [{ date: '2026-07-23', n: 200 }],
      },
    ],
  });

  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /行数塌陷/);
  assert.deepEqual(r.deleted('item_hourly_sales'), [], '护栏必须早于 DELETE，一天都不许删');
  assert.ok(!r.sent(/INSERT INTO item_hourly_sales/));
  // 与塌陷无关的步骤照常。
  assert.ok(r.sent(/INSERT INTO hourly_sales_summary/));
  r.neverWriteViews();
});

test('行数塌陷护栏对 n<20 的冷清日子不误伤（比例噪声大，不参与判定）', () => {
  const r = runSync({
    script: [
      { match: 'COUNT\\(\\*\\)::int AS n FROM item_hourly_sales', rows: [{ date: '2026-07-23', n: 19 }] },
    ],
  });

  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.deleted('item_hourly_sales'), ['2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26']);
});
