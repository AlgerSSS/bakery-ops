// scrape-daily 的「必需查询失败就不许覆盖正式 daily.json」判定。
//
// 上一轮的变异测试在这里漏过：判定原本写在 scrape-daily.js 的查询循环里
// （`if (REQUIRED_QUERIES.includes(name)) failedRequired.push(name)`），
// 而 scrape-daily.js 是顶层 await 的 playwright 脚本，import 它就会真的开浏览器 ——
// 于是那一行只有源码正则「覆盖」它，改坏也不红。
// 现在判定全部从落盘的 queryStatus 推导（lib/daily-queries.js），可以直接跑行为。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { classifyQueryOutcome, REQUIRED_QUERIES, summarizeQueryStatus } from '../lib/daily-queries.js';

const allOk = () =>
  Object.fromEntries(
    [...REQUIRED_QUERIES, 'payment', 'itemsByHour', 'diningOption'].map((q) => [q, 'ok']),
  );

test('HTTP 200 + code 000 才算成功，其余一律记成 failed(...)', () => {
  assert.deepEqual(classifyQueryOutcome({ status: 200, body: { code: '000' } }), { ok: true, status: 'ok' });
  assert.equal(classifyQueryOutcome({ status: 500, body: {} }).ok, false);
  assert.equal(classifyQueryOutcome({ status: 200, body: { code: '401' } }).ok, false);
  assert.match(classifyQueryOutcome({ status: 200, body: { code: '401' } }).status, /failed\(status=200 code=401\)/);
  // 会话过期时后台会回 200 + 一个空壳 body，这也必须算失败（否则 daily.json 里是「ok + 空数组」）。
  assert.equal(classifyQueryOutcome({ status: 200, body: {} }).ok, false);
  assert.equal(classifyQueryOutcome(undefined).ok, false);
});

test('真实消费方要的六个查询都是必需的：任何一个失败都必须拦下正式文件', () => {
  // 这六个各自的消费方见 lib/daily-queries.js 的注释；漏掉任何一个都会重演
  // 「查询失败 -> 字段缺失 -> scrape-daily exit 0 -> sync-to-db 拿残缺文件重写库」。
  for (const q of ['summary', 'hourly', 'items', 'hourlyByDate', 'itemsByDateHour', 'itemWaste']) {
    const status = { ...allOk(), [q]: 'failed(status=500 code=undefined)' };
    assert.deepEqual(summarizeQueryStatus(status).failedRequired, [q], `${q} 必须是必需查询`);
  }
});

test('非必需查询失败只进 failedOptional，不拦正式文件', () => {
  const status = { ...allOk(), payment: 'failed(status=500 code=undefined)', diningOption: 'failed(status=502 code=undefined)' };
  const s = summarizeQueryStatus(status);
  assert.deepEqual(s.failedRequired, []);
  assert.deepEqual(s.failedOptional, ['payment', 'diningOption']);
});

test('必需查询压根没跑到（被改名/从 queries 里删掉）等同于失败，不能静默通过', () => {
  const status = { ...allOk() };
  delete status.itemsByDateHour;
  assert.deepEqual(summarizeQueryStatus(status).failedRequired, ['itemsByDateHour']);
  assert.deepEqual(summarizeQueryStatus({}).failedRequired, REQUIRED_QUERIES);
});

test('全绿之夜没有任何失败面', () => {
  const s = summarizeQueryStatus(allOk());
  assert.deepEqual(s.failedRequired, []);
  assert.deepEqual(s.failedOptional, []);
});

// ---------- 唯一保留的源码级防漂移断言（不当作行为覆盖）----------

test('scrape-daily 仍然由 summarizeQueryStatus 决定是否覆盖正式 daily.json', () => {
  // 判定本身已经被上面几条行为测试盯住；这里只防「判定被绕过 / 写入顺序被调换」这种结构漂移：
  // 必需查询失败时写 daily.partial.json 并 exit 1，正式文件的写入必须排在这个分支之后。
  const src = readFileSync(new URL('../scrape-daily.js', import.meta.url), 'utf8');
  const derive = src.indexOf('summarizeQueryStatus(queryStatus)');
  const abort = src.indexOf('if (failedRequired.length)');
  const writeFinal = src.indexOf('fs.writeFileSync(finalFile');
  assert.ok(derive > 0, 'failedRequired 必须从 queryStatus 推导，不许在循环里另记一份');
  assert.ok(abort > derive && writeFinal > abort, '正式 daily.json 的写入必须排在「必需查询失败就退出」之后');
  assert.match(src, /daily\.partial\.json/);
});
