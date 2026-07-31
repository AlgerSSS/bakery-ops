// HIGH-1 的回归测试：陈旧 / 残缺的 output/daily/daily.json 必须让 sync-to-db 的
// 第 2/3/4/5/8 步失败，而不是 `[skip] return 0` 静默成功后照样 DELETE + INSERT。
// 纯文件系统，不开浏览器、不连库。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertDailyFresh, assertDailySection, loadDailySection } from '../lib/daily-freshness.js';
import { kualaLumpurDate, refreshBusinessDate } from '../lib/business-date.js';

const EXPECTED = '2026-07-26';

/** 一份「今晚刚抓完」的 daily.json：KL 23:10 = 15:10Z 同日。 */
function freshDaily(overrides = {}) {
  return {
    dateRange: ['2026-06-27', EXPECTED],
    businessDate: EXPECTED,
    scrapedAt: '2026-07-26T15:10:00.000Z',
    queryStatus: { hourlyByDate: 'ok', itemsByDateHour: 'ok', itemWaste: 'ok' },
    hourlyByDate: [{ date: EXPECTED, hour: '12', netSales: 10 }],
    itemsByDateHour: [{ date: EXPECTED, hour: '12', name: 'x', qty: 1 }],
    itemWaste: [{ date: EXPECTED, name: 'x', qty: 1 }],
    ...overrides,
  };
}

function withDailyFile(daily, fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'hotcrush-daily-'));
  const file = path.join(root, 'daily.json');
  if (daily !== null) writeFileSync(file, JSON.stringify(daily, null, 2));
  try {
    return fn(file);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const load = (file, section, opts = {}) =>
  loadDailySection(file, section, { expectedDate: EXPECTED, fs, klDate: kualaLumpurDate, ...opts });

test('盘上躺了两天的 daily.json 会被拒收（实物形态：scrapedAt=07-24，今天是 07-26）', () => {
  // 复现本次排查里的实物：scrapedAt=2026-07-24T16:36:12.627Z，内容只覆盖 07-22..07-24。
  const stale = {
    dateRange: ['2026-06-26', '2026-07-25'],
    scrapedAt: '2026-07-24T16:36:12.627Z',
    hourlyByDate: [{ date: '2026-07-24', hour: '12' }],
    itemsByDateHour: [{ date: '2026-07-24', hour: '12', name: 'x' }],
    itemWaste: [{ date: '2026-07-24', name: 'x' }],
  };
  withDailyFile(stale, (file) => {
    for (const section of ['hourlyByDate', 'itemsByDateHour']) {
      assert.throws(() => load(file, section), /陈旧/, `${section} 必须拒收陈旧文件`);
    }
    // itemWaste 不要求含当天，但同样必须被文件级新鲜度拦住（第 8 步是 DELETE+INSERT）。
    assert.throws(() => load(file, 'itemWaste', { requireExpectedDate: false }), /陈旧/);
  });
});

test('文件不存在 = 今晚 scrape-daily 没产出正式文件 -> 失败，不是 skip', () => {
  withDailyFile(null, (file) => {
    assert.throws(() => load(file, 'itemsByDateHour'), /不存在/);
  });
});

test('scrapedAt 的时区按 KL 判定：KL 00:36（前一日 UTC）写出的文件对 D+1 仍然新鲜', () => {
  // 23:00 起跑、跨过午夜写完的那一份：UTC 日期是 07-26，KL 日期是 07-27。
  const crossMidnight = freshDaily({ scrapedAt: '2026-07-26T16:36:00.000Z' });
  assert.doesNotThrow(() =>
    assertDailyFresh(crossMidnight, { expectedDate: EXPECTED, klDate: kualaLumpurDate }),
  );
  // 反向：同一时刻若按 UTC 日期比较会是 07-26 == 07-26 也通过，所以再验一个真正的边界 ——
  // KL 07-26 00:36（= 07-25T16:36Z）对业务日 07-26 来说是「当天凌晨」，仍算新鲜；
  // 而 07-25T15:36Z（KL 07-25 23:36）就是陈旧。
  assert.doesNotThrow(() =>
    assertDailyFresh(freshDaily({ scrapedAt: '2026-07-25T16:36:00.000Z' }), {
      expectedDate: EXPECTED,
      klDate: kualaLumpurDate,
    }),
  );
  assert.throws(
    () =>
      assertDailyFresh(freshDaily({ scrapedAt: '2026-07-25T15:36:00.000Z' }), {
        expectedDate: EXPECTED,
        klDate: kualaLumpurDate,
      }),
    /陈旧/,
  );
});

test('三个数组各判各的：hourlyByDate / itemsByDateHour 必须含当天，itemWaste 允许当天零报损', () => {
  // 覆盖范围不同是常态（itemWaste 很多天本来就一行没有），不能用一句笼统判断代替。
  const daily = freshDaily({
    itemsByDateHour: [{ date: '2026-07-25', hour: '12', name: 'x' }], // 只到昨天
    itemWaste: [],
  });

  assert.doesNotThrow(() => assertDailySection(daily, 'hourlyByDate', { expectedDate: EXPECTED }));
  assert.throws(
    () => assertDailySection(daily, 'itemsByDateHour', { expectedDate: EXPECTED }),
    /不含业务日 2026-07-26/,
  );
  assert.doesNotThrow(() =>
    assertDailySection(daily, 'itemWaste', { expectedDate: EXPECTED, requireExpectedDate: false }),
  );
});

test('查询失败留下的 queryStatus 会让对应的那一步失败（空数组和查询失败长得一模一样）', () => {
  const daily = freshDaily({
    queryStatus: { hourlyByDate: 'ok', itemsByDateHour: 'ok', itemWaste: 'failed(status=500 code=undefined)' },
  });
  assert.throws(
    () => assertDailySection(daily, 'itemWaste', { expectedDate: EXPECTED, requireExpectedDate: false }),
    /查询当晚失败/,
  );
  assert.doesNotThrow(() => assertDailySection(daily, 'hourlyByDate', { expectedDate: EXPECTED }));
});

test('字段整段缺失（查询失败 -> 没写进 JSON）也判失败，而不是 skip', () => {
  const daily = freshDaily();
  delete daily.itemsByDateHour;
  assert.throws(() => assertDailySection(daily, 'itemsByDateHour', { expectedDate: EXPECTED }), /缺少 itemsByDateHour/);
});

test('缺 scrapedAt / dateRange 的旧版产物一律拒收', () => {
  const noStamp = freshDaily();
  delete noStamp.scrapedAt;
  assert.throws(() => assertDailyFresh(noStamp, { expectedDate: EXPECTED, klDate: kualaLumpurDate }), /没有 scrapedAt/);

  const noRange = freshDaily();
  delete noRange.dateRange;
  assert.throws(() => assertDailyFresh(noRange, { expectedDate: EXPECTED, klDate: kualaLumpurDate }), /缺少 dateRange/);

  const oldWindow = freshDaily({ dateRange: ['2026-06-20', '2026-07-25'] });
  assert.throws(() => assertDailyFresh(oldWindow, { expectedDate: EXPECTED, klDate: kualaLumpurDate }), /未覆盖业务日/);
});

test('今晚的完整产物照常通过', () => {
  withDailyFile(freshDaily(), (file) => {
    assert.equal(load(file, 'itemsByDateHour').rows.length, 1);
    assert.equal(load(file, 'hourlyByDate').rows.length, 1);
    assert.equal(load(file, 'itemWaste', { requireExpectedDate: false }).rows.length, 1);
  });
});

// ---------- 「只缺业务日当天」交给第二意见定性（零流水日 vs 抓取缺失）----------
//
// 注：守卫是否真的接在 sync-to-db 的第 2/3/4/5/8 步上，现在由 test/sync-to-db.test.js
// 把脚本本体跑起来（假 postgres 驱动）来证明 —— 那里断言的是「DELETE/TRUNCATE 到底有没有
// 发出去」。原来这里那三条拿正则扫源码的断言证明不了调用处，已删除。

test('不传第二意见时保持老行为：缺当天直接抛错（没有证据就不许猜）', () => {
  const daily = freshDaily({ itemsByDateHour: [{ date: '2026-07-25', hour: '12', name: 'x' }] });
  assert.throws(
    () => assertDailySection(daily, 'itemsByDateHour', { expectedDate: EXPECTED }),
    /不含业务日 2026-07-26/,
  );
});

test('第二意见判 closed -> 该段可用（当天本来就没有行），判不出来 -> missing 且带上理由', () => {
  const daily = freshDaily({ itemsByDateHour: [{ date: '2026-07-25', hour: '12', name: 'x' }] });

  const closed = assertDailySection(daily, 'itemsByDateHour', {
    expectedDate: EXPECTED,
    classifyMissingDate: () => ({ verdict: 'closed', reason: '两个独立来源都报零' }),
  });
  assert.equal(closed.expectedDateStatus, 'closed');
  assert.equal(closed.rows.length, 1, '其他日期的行必须原样返回，好让调用方照写');

  const unknown = assertDailySection(daily, 'itemsByDateHour', {
    expectedDate: EXPECTED,
    classifyMissingDate: () => ({ verdict: 'unknown', reason: '只有 1 个来源能作证' }),
  });
  assert.equal(unknown.expectedDateStatus, 'missing');
  assert.match(unknown.missingReason, /只有 1 个来源能作证/);
  assert.equal(unknown.rows.length, 1);
});

test('第二意见管不到文件级/查询级：陈旧文件与失败查询照样直接抛', () => {
  const always = () => ({ verdict: 'closed', reason: '别信我' });
  const failed = freshDaily({ queryStatus: { itemsByDateHour: 'failed(status=500 code=undefined)' } });
  assert.throws(
    () => assertDailySection(failed, 'itemsByDateHour', { expectedDate: EXPECTED, classifyMissingDate: always }),
    /查询当晚失败/,
  );

  const stale = { ...freshDaily(), scrapedAt: '2026-07-24T16:36:12.627Z' };
  withDailyFile(stale, (file) => {
    assert.throws(() => load(file, 'itemsByDateHour', { classifyMissingDate: always }), /陈旧/);
  });
});

test('业务日锁定：REFRESH_BUSINESS_DATE 存在时压过墙钟，非法值忽略', () => {
  assert.equal(refreshBusinessDate({ REFRESH_BUSINESS_DATE: '2026-07-26' }), '2026-07-26');
  assert.equal(
    refreshBusinessDate({ REFRESH_BUSINESS_DATE: 'garbage' }, new Date('2026-07-26T16:30:00Z')),
    '2026-07-27',
  );
  assert.equal(refreshBusinessDate({}, new Date('2026-07-26T16:30:00Z')), '2026-07-27');
});
