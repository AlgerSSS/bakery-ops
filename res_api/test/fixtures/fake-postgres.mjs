// 假的 postgres 驱动：让 sync-to-db.js **本体**能在单测里真跑一遍而不碰任何数据库。
//
// 为什么必须是「跑本体」而不是「把逻辑抄进 lib 再测 lib」：
// 上一轮变异测试漏过的三处（dailySection 的 try/catch、第 5 步的 requires 判定、
// 行数塌陷护栏）都在 sync-to-db.js 里，把它们的等价物搬到 lib 只能证明 lib 是对的，
// 证明不了 sync-to-db 真的调用了它们 —— 改坏调用处照样不红。
//
// 用法（见 test/sync-to-db.test.js）：
//   node --import test/fixtures/pg-preload.mjs sync-to-db.js ...
// pg-preload 注册一个 resolve 钩子，把 'postgres' 这个 specifier 指到本文件。
//
// FAKE_PG_SCRIPT: JSON 文件，[{ match: '正则', rows: [...] }]，第一个命中的决定返回值（默认 []）。
// FAKE_PG_LOG:    JSONL 文件，逐条记录真实发出的语句，测试据此断言「DELETE 到底有没有发出去」。
import fs from 'node:fs';

const LOG = process.env.FAKE_PG_LOG || null;
const SCRIPT = process.env.FAKE_PG_SCRIPT ? JSON.parse(fs.readFileSync(process.env.FAKE_PG_SCRIPT, 'utf8')) : [];

function record(entry) {
  if (LOG) fs.appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
}

function respond(text) {
  for (const rule of SCRIPT) {
    if (new RegExp(rule.match, 's').test(text)) return rule.rows || [];
  }
  return [];
}

const plain = (v) =>
  v && typeof v === 'object' && v.__insertHelper ? { insertRows: v.rows, columns: v.columns } : v;

export default function postgres(url, _options) {
  // 兜底：这个驱动永远不该指向真库。测试里 DATABASE_URL 必须带 fake_pg_only 标记。
  if (!/fake_pg_only/.test(String(url))) {
    throw new Error(`fake-postgres: 拒绝启动，DATABASE_URL 不是显式的假地址（${url}）`);
  }

  const sql = (...args) => {
    const [first, ...rest] = args;
    // sql(rows, 'col1', 'col2') 这种 helper 形式：不是查询，只是插值用的批量插入描述。
    if (!Array.isArray(first) || !first.raw) {
      return { __insertHelper: true, rows: Array.isArray(first) ? first.length : 0, columns: rest };
    }
    const text = first.join('?').replace(/\s+/g, ' ').trim();
    record({ kind: 'query', text, values: rest.map(plain) });
    return Promise.resolve(respond(text));
  };

  sql.begin = async (fn) => {
    record({ kind: 'begin' });
    try {
      const out = await fn(sql);
      record({ kind: 'commit' });
      return out;
    } catch (e) {
      record({ kind: 'rollback', error: e.message });
      throw e;
    }
  };
  sql.end = async () => {
    record({ kind: 'end' });
  };
  sql.unsafe = (text) => {
    record({ kind: 'unsafe', text });
    return Promise.resolve(respond(text));
  };
  return sql;
}
