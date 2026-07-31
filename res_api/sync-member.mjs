// 会员数据入库：output/member/*.json -> pos_member / pos_member_card_txn / pos_member_daily。
//
// 独立成一步（而不是塞进 sync-to-db.js）的理由：会员链路可以整条失败而不连累 9 张营收表，
// 反过来营收表出问题也不该挡住会员写入。run-refresh.mjs 把它排在三个 scrape-member-* 之后。
//
// 【写入纪律】全部 upsert，ON CONFLICT ON CONSTRAINT + 显式约束名。
//   **严禁 TRUNCATE / DELETE-then-INSERT**（timeslot_sales_record 事故的直接成因）。
//   pos_member.phone_e164 是 GENERATED 生成列，绝不出现在 INSERT 列清单里（写了报 428C9）。
//
// 【回填】MEMBER_IN_DIR=output/member-backfill 可指向全量产物（2024-01-01 起 14,414 行）。
//   滚动窗口与全量覆盖同一批 txn_id，靠 uk_pos_member_card_txn 收敛成同一行。
//
// 退出码：0 成功 / 1 失败。日志只出计数，绝不出手机号。

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { refreshBusinessDate } from './lib/business-date.js';
import { aggregateTxnCounts, mapDaily, mapMember, mapTxn, splitAdjustments } from './lib/member-map.js';

const IN_DIR = process.env.MEMBER_IN_DIR || 'output/member';
const SNAPSHOT_DIR = process.env.MEMBER_SNAPSHOT_DIR || 'output/member';
const STORE = process.env.MEMBER_STORE || '吉隆坡Pavilion门店';
const BUSINESS_DATE = refreshBusinessDate();
const CHUNK = Number(process.env.MEMBER_UPSERT_CHUNK || 500);

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** 分批 upsert，返回写入行数。cols 必须与表列名一致且不含生成列。 */
async function upsert(sql, table, constraint, cols, rows) {
  if (!rows.length) return 0;
  const updatable = cols.filter((c) => !['member_id', 'store', 'txn_id', 'date'].includes(c));
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const res = await sql`
      insert into ${sql(table)} ${sql(batch, cols)}
      on conflict on constraint ${sql.unsafe(constraint)} do update set
        ${sql(updatable.reduce((a, c) => ({ ...a, [c]: sql`excluded.${sql(c)}` }), {}))},
        fetched_at = now()
    `;
    n += res.count ?? batch.length;
  }
  return n;
}

async function main() {
  const started = Date.now();
  console.log(`[member-sync] business date=${BUSINESS_DATE} store=${STORE} in=${IN_DIR}`);

  const flowsPath = path.join(IN_DIR, 'flows.json');
  const trendsPath = path.join(SNAPSHOT_DIR, 'trends.json');
  const snapPath = path.join(SNAPSHOT_DIR, 'snapshot.json');
  for (const p of [flowsPath, snapPath]) {
    if (!fs.existsSync(p)) throw new Error(`缺少产物 ${p} —— 先跑对应的 scrape-member-* 脚本`);
  }

  const flows = readJson(flowsPath);
  const snapRaw = readJson(snapPath);
  const members = Array.isArray(snapRaw) ? snapRaw : snapRaw.members || snapRaw.rows;
  const trends = fs.existsSync(trendsPath) ? readJson(trendsPath).daily || [] : [];
  const trendsByDate = new Map(trends.map((t) => [t.business_date, t]));
  if (!trends.length) console.warn('[member-sync] 没有 trends.json —— 人数/消费额列将写 NULL 并标 is_partial');

  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });
  const failures = [];
  try {
    // ---- 1. pos_member（快照式，全量 upsert，不 DELETE 失效行；靠 snapshot_date 识别）----
    const memberRows = members.map((m) => mapMember(m, { store: STORE, snapshotDate: BUSINESS_DATE }));
    const withPhone = memberRows.filter((m) => m.phone_national).length;
    const n1 = await upsert(sql, 'pos_member', 'uk_pos_member_store_member', Object.keys(memberRows[0]), memberRows);
    console.log(`[member-sync] pos_member: ${n1} 行（有手机号 ${withPhone}，无 ${memberRows.length - withPhone}）`);

    // ---- 2. pos_member_card_txn ----
    const txnRows = flows.txns.map((t) => mapTxn(t, { store: STORE }));
    const unknown = txnRows.filter((t) => t.txn_type_label === 'unknown').length;
    if (unknown) failures.push(`${unknown} 条 unknown 交易类型 —— POS 可能加了新类型`);
    const n2 = await upsert(sql, 'pos_member_card_txn', 'uk_pos_member_card_txn', Object.keys(txnRows[0]), txnRows);
    console.log(`[member-sync] pos_member_card_txn: ${n2} 行（unknown 类型 ${unknown}）`);

    // ---- 3. pos_member_daily ----
    const txnAgg = aggregateTxnCounts(flows.txns);
    const { byDate: adjustSplit, reclassified, nearThreshold } = splitAdjustments(flows.txns);
    // 重分类必须可见：这是启发式，不能静默生效。
    for (const r of reclassified) {
      console.log(`[member-sync] 后台调账按客户预存计入充值: ${r.date} RM ${r.amount.toFixed(2)}`);
    }
    for (const r of nearThreshold) {
      console.warn(`[member-sync] ⚠️ 调增金额接近阈值，建议人工判读: ${r.date} RM ${r.amount.toFixed(2)}`);
    }
    const balanceSource = (d) => d.balance_end_source || 'unknown';
    const dailyRows = flows.daily.map((d) =>
      mapDaily(d, { store: STORE, trendsByDate, txnAgg, adjustSplit, businessDate: BUSINESS_DATE, balanceSource })
    );
    const partial = dailyRows.filter((r) => r.is_partial).length;
    const n3 = await upsert(sql, 'pos_member_daily', 'uk_pos_member_daily', Object.keys(dailyRows[0]), dailyRows);
    console.log(`[member-sync] pos_member_daily: ${n3} 行（其中 is_partial ${partial}）`);

    // ---- 4. 一致性哨兵（只 warn，不阻断；差异本身是有价值的信号）----
    // 注意：只按 date 关联，不按 store —— daily_revenue.store 全部为 NULL。
    const drift = await sql`
      select d.date::text as date, d.net_sales, m.card_payment_net
      from daily_breakdown d
      join pos_member_daily m on m.date = d.date
      where d.dim_type = 'payment'
        and d.dim_value ilike '%member%'
        and m.card_payment_net is not null
        and abs(d.net_sales - m.card_payment_net) > 0.01
      order by d.date desc limit 5`;
    if (drift.length) {
      console.warn(`[member-sync] ⚠️ card_payment_net 与 daily_breakdown(payment) 有 ${drift.length} 天不一致（两条独立采集路径分叉）`);
      for (const r of drift) console.warn(`    ${r.date}: dpb=${r.net_sales} vs member=${r.card_payment_net}`);
    } else {
      console.log('[member-sync] ✅ card_payment_net 与 daily_breakdown(payment) 逐日一致');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  if (failures.length) {
    for (const f of failures) console.error(`[member-sync] [FAIL] ${f}`);
    process.exit(1);
  }
  console.log(`[member-sync] done（${((Date.now() - started) / 1000).toFixed(1)}s）`);
}

main().catch((e) => {
  console.error(`[member-sync] ${e.message || e.constructor?.name || e}`);
  if (e.stack) console.error(e.stack.split('\n').slice(0, 8).join('\n'));
  for (const k of ['code', 'severity', 'detail', 'hint', 'where', 'column_name', 'table_name']) {
    if (e[k]) console.error(`  ${k}: ${e[k]}`);
  }
  process.exit(1);
});
