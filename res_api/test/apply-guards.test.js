// 生成物的两条「诚实性」回归测试，纯文件系统（不开浏览器、不连库）：
//   MEDIUM-1  apply-translations 的 delete-first 必须排在所有可抛点之前
//             （replay-30d 目录缺失 / translations.json 坏掉时，陈旧 headline CSV 也必须消失）
//   HIGH-3    apply-items-by-hour 必须先删再判：陈旧 rows.json 不许被重建成「今晚的 mtime」

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const APPLY_TRANSLATIONS = new URL('../apply-translations.js', import.meta.url).pathname;
const APPLY_ITEMS_BY_HOUR = new URL('../apply-items-by-hour.js', import.meta.url).pathname;

const HEADLINES = [
  'kpi_overview_core.csv',
  'kpi_summary_totals.csv',
  'sales_by_business_date.csv',
  'items_totals.csv',
  'items_by_category.csv',
  'items_by_dish_unit_30d.csv',
  'orders_by_dining_option.csv',
  'payment_by_payer_type.csv',
  'items_by_category_overview.csv',
];
const ITEM_CSVS = ['items_by_hour_long.csv', 'items_by_hour_qty.csv', 'items_by_hour_sales.csv'];

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'hotcrush-guard-'));
  const salesDir = path.join(root, 'output', 'sales');
  mkdirSync(path.join(salesDir, 'readable'), { recursive: true });
  return { root, salesDir, readable: path.join(salesDir, 'readable') };
}

const stale = (dir, names) => {
  for (const n of names) writeFileSync(path.join(dir, n), 'stale,from,several,days,ago\n1,2,3,4,5\n');
};

// ---------- MEDIUM-1 ----------

test('replay-30d 目录整个缺失时，陈旧 headline CSV 仍然必须被删除', () => {
  const { root, salesDir, readable } = fixture();
  try {
    // 关键：replay-30d 目录一个都不建 —— 这正是复核沙盒里 ENOENT 未捕获退出的场景。
    writeFileSync(
      path.join(salesDir, 'translations.json'),
      JSON.stringify({ dimOptions: {}, dynamicSubHeads: {}, metricTitles: {}, dimTitles: {} }),
    );
    stale(readable, HEADLINES);

    const run = spawnSync(process.execPath, [APPLY_TRANSLATIONS], { cwd: root, encoding: 'utf8' });

    assert.equal(run.status, 1, run.stdout + run.stderr);
    for (const n of HEADLINES) {
      assert.equal(existsSync(path.join(readable, n)), false, `${n} 必须已被删除（陈旧文件不能存活）`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('translations.json 坏掉（第一处可抛点）时，陈旧 headline CSV 同样必须被删除', () => {
  const { root, salesDir, readable } = fixture();
  try {
    for (const slug of ['sales-overview', 'sales-summary', 'items-breakdown']) {
      mkdirSync(path.join(salesDir, slug, 'replay-30d'), { recursive: true });
    }
    writeFileSync(path.join(salesDir, 'translations.json'), '{ not json');
    stale(readable, HEADLINES);

    const run = spawnSync(process.execPath, [APPLY_TRANSLATIONS], { cwd: root, encoding: 'utf8' });

    assert.notEqual(run.status, 0);
    for (const n of HEADLINES) {
      assert.equal(existsSync(path.join(readable, n)), false, `${n} 必须已被删除`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------- HIGH-3 ----------

function itemsFixture({ meta, rows, businessDate }) {
  const { root, salesDir, readable } = fixture();
  const dir = path.join(salesDir, 'items-by-hour');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(salesDir, 'translations.json'),
    JSON.stringify({ dimOptions: { D_itemName: { i1: 'Croissant' }, D_unit: { u1: 'pc' } } }),
  );
  if (rows) writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(rows));
  if (meta) writeFileSync(path.join(dir, 'rows.meta.json'), JSON.stringify(meta));
  stale(readable, ITEM_CSVS);
  const run = () =>
    spawnSync(process.execPath, [APPLY_ITEMS_BY_HOUR], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, REFRESH_BUSINESS_DATE: businessDate },
    });
  return { root, readable, run };
}

const ROWS = [{ D_itemName: 'i1', D_unit: 'u1', D_hours: '12', M_Item_SUM_netQty: 3, M_Item_SUM_netSales: 30 }];

test('rows.json 是几天前那一轮的 -> 拒绝重建，且陈旧 CSV 先被删掉（不许伪造 mtime）', () => {
  const { root, readable, run } = itemsFixture({
    rows: ROWS,
    meta: { scrapedAt: '2026-07-22T15:00:00.000Z', businessDate: '2026-07-22', rowCount: 1, complete: true },
    businessDate: '2026-07-26',
  });
  try {
    const r = run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /2026-07-22 那一轮抓的/);
    for (const n of ITEM_CSVS) {
      assert.equal(existsSync(path.join(readable, n)), false, `${n} 必须已被删除，而不是被今晚的 mtime 盖上`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rows.json 被标记为截断（分页失败）时同样拒绝重建', () => {
  const { root, readable, run } = itemsFixture({
    rows: ROWS,
    meta: {
      scrapedAt: '2026-07-26T15:00:00.000Z',
      businessDate: '2026-07-26',
      rowCount: 1,
      complete: false,
      failure: 'page 2 failed: status=500',
    },
    businessDate: '2026-07-26',
  });
  try {
    const r = run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /不完整/);
    for (const n of ITEM_CSVS) assert.equal(existsSync(path.join(readable, n)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('只有 rows.json、没有 sidecar 时也拒绝（mtime 不能自证新鲜度）', () => {
  const { root, readable, run } = itemsFixture({ rows: ROWS, meta: null, businessDate: '2026-07-26' });
  try {
    const r = run();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /rows\.meta\.json/);
    for (const n of ITEM_CSVS) assert.equal(existsSync(path.join(readable, n)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('本轮抓的完整 rows.json 照常重建三个 CSV', () => {
  const { root, readable, run } = itemsFixture({
    rows: ROWS,
    meta: { scrapedAt: '2026-07-26T15:00:00.000Z', businessDate: '2026-07-26', rowCount: 1, complete: true },
    businessDate: '2026-07-26',
  });
  try {
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const n of ITEM_CSVS) {
      const f = path.join(readable, n);
      assert.equal(existsSync(f), true, `${n} 应被重建`);
      assert.ok(statSync(f).size > 0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
