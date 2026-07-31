import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  createSpawnRunner,
  formatSummary,
  retrySelection,
  runSteps,
  selectSteps,
  summarizeSteps,
  TIMEOUT_EXIT_CODE,
} from '../lib/step-runner.js';

const step = (name, extra = {}) => ({ name, critical: true, ...extra });

/** 用一张「哪些步骤该失败」的表驱动假 run()，同时记录实际执行顺序。 */
function fakeRun(failing = {}) {
  const ran = [];
  const run = async (s) => {
    ran.push(s.name);
    return failing[s.name] ?? 0;
  };
  return { ran, run };
}

test('中间一步失败不阻断后续步骤（HIGH-1 的核心）', async () => {
  const steps = [step('login', { gate: true }), step('scrape'), step('scrape-daily'), step('sync-to-db')];
  const { ran, run } = fakeRun({ scrape: 1 });

  const results = await runSteps(steps, run);

  // scrape 挂了，scrape-daily / sync-to-db 照样跑 —— 否则 daily.json 喂的 5 张表当晚一行不写。
  assert.deepEqual(ran, ['login', 'scrape', 'scrape-daily', 'sync-to-db']);
  assert.deepEqual(results.map((r) => r.status), ['ok', 'failed', 'ok', 'ok']);
  assert.equal(summarizeSteps(results).exitCode, 1);
});

test('关键步骤失败 -> exit 1；只有可选步骤失败 -> exit 0 但告警', async () => {
  const optionalOnly = await runSteps(
    [step('scrape'), step('item-last-sale', { critical: false })],
    fakeRun({ 'item-last-sale': 1 }).run,
  );
  const s1 = summarizeSteps(optionalOnly);
  assert.equal(s1.exitCode, 0);
  assert.deepEqual(s1.failedOptional.map((r) => r.name), ['item-last-sale']);
  assert.match(formatSummary(optionalOnly).join('\n'), /WARN: 可选步骤失败/);

  const criticalToo = await runSteps(
    [step('scrape'), step('item-last-sale', { critical: false })],
    fakeRun({ scrape: 1, 'item-last-sale': 1 }).run,
  );
  assert.equal(summarizeSteps(criticalToo).exitCode, 1);
});

test('login 是 gate：失败则后续全部跳过，且退出码仍为 1', async () => {
  const steps = [step('login', { gate: true }), step('scrape'), step('sync-to-db')];
  const { ran, run } = fakeRun({ login: 1 });

  const results = await runSteps(steps, run);

  assert.deepEqual(ran, ['login']);
  assert.deepEqual(results.map((r) => r.status), ['failed', 'skipped', 'skipped']);
  assert.equal(summarizeSteps(results).exitCode, 1);
  assert.match(results[1].reason, /login 失败/);
});

test('被 gate 跳过的关键步骤单独也能把退出码抬到 1', () => {
  // 防回归：如果只统计 failed，login 之后全跳过的一晚会误报 exit 0。
  const results = [
    { name: 'login', critical: false, status: 'failed', code: 1 },
    { name: 'sync-to-db', critical: true, status: 'skipped', code: null, reason: 'x' },
  ];
  assert.equal(summarizeSteps(results).exitCode, 1);
});

test('全绿时 exit 0', async () => {
  const results = await runSteps([step('a'), step('b')], fakeRun().run);
  assert.equal(summarizeSteps(results).exitCode, 0);
  assert.match(formatSummary(results).join('\n'), /all steps ok/);
});

test('run() 自己抛异常按该步失败处理，不带走整个 runner', async () => {
  const steps = [step('boom'), step('after')];
  const ran = [];
  const results = await runSteps(steps, async (s) => {
    ran.push(s.name);
    if (s.name === 'boom') throw new Error('spawn failed');
    return 0;
  });

  assert.deepEqual(ran, ['boom', 'after']);
  assert.deepEqual(results.map((r) => r.status), ['failed', 'ok']);
  assert.equal(summarizeSteps(results).exitCode, 1);
});

test('package.json 的 refresh 已经不是 && 串联', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.refresh, 'node run-refresh.mjs');
  assert.doesNotMatch(pkg.scripts.refresh, /&&/);
});

// ---------- L1：--only / --skip 的步骤名必须校验 ----------

test('selectSteps 拒绝拼错的步骤名（拼错时静默跳过 0 个步骤 = 失败注入演练假通过）', () => {
  const steps = [step('login', { gate: true }), step('scrape'), step('sync-to-db')];

  const typo = selectSteps(steps, { only: ['scrap'] });
  assert.deepEqual(typo.selected, []);
  assert.match(typo.error, /未知步骤名: scrap/);
  assert.match(typo.error, /可用步骤: login, scrape, sync-to-db/);

  const typoSkip = selectSteps(steps, { skip: ['sync_to_db'] });
  assert.match(typoSkip.error, /未知步骤名: sync_to_db/);

  const ok = selectSteps(steps, { only: ['scrape', 'sync-to-db'] });
  assert.equal(ok.error, null);
  assert.deepEqual(ok.selected.map((s) => s.name), ['scrape', 'sync-to-db']);

  // 名字都对但集合为空仍要报错（旧守卫的行为保留）。
  assert.match(selectSteps(steps, { only: ['login'], skip: ['login'] }).error, /没有可执行的步骤/);
});

test('run-refresh.mjs 入口对拼错的步骤名直接非零退出', () => {
  const entry = new URL('../run-refresh.mjs', import.meta.url).pathname;
  const typo = spawnSync(process.execPath, [entry, '--only=__none__'], { encoding: 'utf8' });
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /未知步骤名: __none__/);

  const empty = spawnSync(process.execPath, [entry, '--only=login', '--skip=login'], { encoding: 'utf8' });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /没有可执行的步骤/);
});

// ---------- M3：失败步骤回传给 shell，下一次只重跑它们 ----------

test('retrySelection 只回传失败步骤，但必带 login 与 sync-to-db', () => {
  const steps = [
    step('login', { gate: true }),
    step('scrape'),
    step('scrape-daily'),
    step('item-last-sale', { critical: false }),
    step('sync-to-db'),
  ];

  const results = [
    { name: 'login', critical: true, status: 'ok' },
    { name: 'scrape', critical: true, status: 'failed', code: 1 },
    { name: 'scrape-daily', critical: true, status: 'ok' },
    { name: 'item-last-sale', critical: false, status: 'failed', code: 1 },
    { name: 'sync-to-db', critical: true, status: 'ok' },
  ];

  // login 是会话前提；sync-to-db 必须重跑，否则「上游修好了但没人把它写进库」。
  // item-last-sale 是 optional，它自己失败不触发整轮重试（退出码为 0）。
  assert.deepEqual(retrySelection(results, steps), ['login', 'scrape', 'sync-to-db']);

  const allGreen = results.map((r) => ({ ...r, status: 'ok' }));
  assert.deepEqual(retrySelection(allGreen, steps), []);
});

// ---------- L2：真·端到端 —— 真的 spawn 子进程 ----------

/** 造一个只含假脚本的临时目录，避免碰到仓库里真实的 output/ 树。 */
function makeScriptFixture(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hotcrush-steps-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  return dir;
}

test('createSpawnRunner 真的起子进程：一步非零退出后，后面的步骤照样执行并聚合 exit 1', async () => {
  const dir = makeScriptFixture({
    'ok.mjs': 'import fs from "node:fs"; fs.appendFileSync(process.env.TRACE, "ok\\n");',
    'boom.mjs': 'import fs from "node:fs"; fs.appendFileSync(process.env.TRACE, "boom\\n"); process.exit(3);',
    'later.mjs': 'import fs from "node:fs"; fs.appendFileSync(process.env.TRACE, "later\\n");',
  });
  const trace = path.join(dir, 'trace.txt');

  try {
    const run = createSpawnRunner({
      cwd: dir,
      env: { ...process.env, TRACE: trace },
      defaultTimeoutMs: 30_000,
      log: () => {},
      logError: () => {},
    });
    const results = await runSteps(
      [
        { name: 'ok', script: 'ok.mjs', critical: true },
        { name: 'boom', script: 'boom.mjs', critical: true },
        { name: 'later', script: 'later.mjs', critical: true },
      ],
      run,
    );

    // 三个子进程都真的跑了（文件是子进程自己写的，父进程无从伪造）。
    assert.equal(readFileSync(trace, 'utf8'), 'ok\nboom\nlater\n');
    assert.deepEqual(results.map((r) => r.status), ['ok', 'failed', 'ok']);
    assert.equal(results[1].code, 3, '子进程真实退出码要原样带回来');
    assert.equal(summarizeSteps(results).exitCode, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createSpawnRunner 的 gate 步骤失败会真的跳过后续 spawn', async () => {
  const dir = makeScriptFixture({
    'gate.mjs': 'process.exit(2);',
    'never.mjs': 'import fs from "node:fs"; fs.writeFileSync(process.env.MARKER, "ran");',
  });
  const marker = path.join(dir, 'marker.txt');

  try {
    const run = createSpawnRunner({ cwd: dir, env: { ...process.env, MARKER: marker }, log: () => {}, logError: () => {} });
    const results = await runSteps(
      [
        { name: 'login', script: 'gate.mjs', critical: true, gate: true },
        { name: 'after', script: 'never.mjs', critical: true },
      ],
      run,
    );

    assert.deepEqual(results.map((r) => r.status), ['failed', 'skipped']);
    assert.equal(existsSyncSafe(marker), false, 'gate 失败后不该再 spawn 后续步骤');
    assert.equal(summarizeSteps(results).exitCode, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createSpawnRunner 的单步超时会杀掉子进程并记为失败（M3 的时长封顶）', async () => {
  const dir = makeScriptFixture({
    // 挂住不退出的步骤：模拟 goto 60s × 3 次重试那种「空烧」。
    'hang.mjs': 'setInterval(() => {}, 1000);',
  });

  try {
    const run = createSpawnRunner({
      cwd: dir,
      timeouts: { hang: 400 },
      killGraceMs: 300,
      log: () => {},
      logError: () => {},
    });
    const started = Date.now();
    const results = await runSteps([{ name: 'hang', script: 'hang.mjs', critical: true }], run);
    const elapsed = Date.now() - started;

    assert.equal(results[0].status, 'failed');
    assert.equal(results[0].code, TIMEOUT_EXIT_CODE);
    assert.ok(elapsed < 10_000, `超时应立刻收网，实际耗时 ${elapsed}ms`);
    assert.equal(summarizeSteps(results).exitCode, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('整轮 deadline 用尽后剩余步骤不再 spawn', async () => {
  const dir = makeScriptFixture({
    'never.mjs': 'import fs from "node:fs"; fs.writeFileSync(process.env.MARKER, "ran");',
  });
  const marker = path.join(dir, 'marker.txt');

  try {
    const run = createSpawnRunner({
      cwd: dir,
      deadlineAt: Date.now() - 1, // 预算已经用尽
      env: { ...process.env, MARKER: marker },
      log: () => {},
      logError: () => {},
    });
    const results = await runSteps([{ name: 'late', script: 'never.mjs', critical: true }], run);

    assert.equal(results[0].code, TIMEOUT_EXIT_CODE);
    assert.equal(existsSyncSafe(marker), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function existsSyncSafe(p) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}
