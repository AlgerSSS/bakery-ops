import 'dotenv/config';
import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './lib/csv-parser.js';
import {
  resolveDailyRevenueRecords,
  selectDailyRevenueRecords,
} from './lib/daily-revenue-resolver.js';
import { kualaLumpurDate, refreshBusinessDate } from './lib/business-date.js';
import { loadDailySection } from './lib/daily-freshness.js';
import { classifyBusinessDate, dailyWitnesses, PartialStepError } from './lib/zero-day.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v]; }));

const DB_URL = args['database-url'] || process.env.DATABASE_URL;
if (!DB_URL) { console.error('[sync-to-db] ERROR: DATABASE_URL env var is required'); process.exit(1); }
const sql = postgres(DB_URL, { max: 5, idle_timeout: 20 });

const READABLE_DIR = args['readable-dir'] || 'output/sales/readable';
const DAILY_FILE = args['daily-file'] || 'output/daily/daily.json';
const EXPECTED_DATE_ARG = args['expected-date'];
// 业务日锁定在 daily-refresh.sh 起跑那一刻（REFRESH_BUSINESS_DATE），不再用「此刻的 KL 日期」。
// 否则重试一旦跨过 KL 00:00，EXPECTED_DATE 翻成 D+1，而当晚抓的全是 D，最后一次重试注定失败。
const EXPECTED_DATE = EXPECTED_DATE_ARG || refreshBusinessDate();
const DAILY_REVENUE_ONLY = args['daily-revenue-only'] === 'true';

if (DAILY_REVENUE_ONLY && !EXPECTED_DATE_ARG) {
  console.error('[sync-to-db] ERROR: --daily-revenue-only=true requires --expected-date=YYYY-MM-DD');
  process.exit(1);
}

function loadCsv(relPath) {
  if (!fs.existsSync(relPath)) return null;
  return parseCsv(fs.readFileSync(relPath, 'utf8'));
}

function num(v) { const n = Number(v); return isNaN(n) ? null : n; }

// ---- 业务日当天到底有没有生意：全流程只判一次，判定逻辑见 lib/zero-day.js ----
//
// 公假/停业/POS 整天故障时，报表后台对零流水日直接不返回该日期。上一轮的守卫把这种
// 「今天没生意」一律当成「抓取坏了」，于是第 1/2/3/4 步全失败、第 5 步跳过，连窗口里
// 另外三天完好的数据也一起不写。现在改成：先用多来源交叉验证给当天定性，再决定怎么写。
//
// 三种结论对应三种写法（也是本文件唯一的 0/NULL/失败语义来源）：
//   closed  —— 多个独立来源证明当天真的零流水：
//              daily_revenue 写一行显式的 0（revenue/交易数/流水额 = 0 是实测事实；
//              客单价/折扣率/会员占比 = NULL，因为 0/0 是未定义，不是 0）；
//              所有明细表（小时/单品/支付/就餐/报损）当天**一行不写** ——
//              明细表的语义是「发生过的事」，为不存在的明细写 0 就是伪造。
//   present —— 有来源反证当天有流水，而某个数组恰好缺当天：这就是抓取缺失，必须响亮失败。
//   unknown —— 证据不足：拒绝断言。窗口内其他日期照写，当天不写，该步记 PARTIAL，整体 exit 1。
let verdictCache = null;
function businessDateVerdict() {
  if (verdictCache) return verdictCache;
  let daily = null;
  try {
    if (fs.existsSync(DAILY_FILE)) daily = JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8'));
  } catch (e) {
    console.warn(`  [warn] 判定零流水日时读不了 ${DAILY_FILE}：${e.message}`);
  }
  const csvRows = loadCsv(`${READABLE_DIR}/sales_by_business_date.csv`);
  verdictCache = classifyBusinessDate(EXPECTED_DATE, dailyWitnesses(daily, { csvRows }));
  return verdictCache;
}

// daily.json 的三个 per-day 数组（hourlyByDate / itemsByDateHour / itemWaste）是本文件
// 第 2/3/4/8 步的唯一数据源，而这几步都是「先 DELETE 当天再插入」。所以每一步取数据之前
// 都要过一遍新鲜度 + 段可用性断言（lib/daily-freshness.js），不满足就抛错记成该步失败 ——
// 从前那句 `if (!daily.x?.length) { console.log('[skip] ...'); return 0; }`
// 在源被截断/文件陈旧时等于静默销毁数据。
//
// 「只缺业务日当天」是唯一一种不直接抛错的情形：交给 businessDateVerdict 定性（见上）。
function dailySection(section, { requireExpectedDate = true } = {}) {
  return loadDailySection(DAILY_FILE, section, {
    expectedDate: EXPECTED_DATE,
    requireExpectedDate,
    fs,
    klDate: kualaLumpurDate,
    classifyMissingDate: requireExpectedDate ? businessDateVerdict : null,
  });
}

/**
 * 一个 per-day 步骤写完之后，怎么处置「当天缺失」。
 *   closed  -> 正常收尾（当天本来就没有明细可写）
 *   missing -> 已写入的其他日期保留，本步记 PARTIAL（deferredFailures + exit 1）
 */
function settleExpectedDate(count, { expectedDateStatus, missingReason }, table) {
  if (expectedDateStatus === 'closed') {
    console.log(`  [info] ${EXPECTED_DATE} 已证实为零流水日，${table} 当天不写任何行（明细表只记录发生过的事）`);
    return count;
  }
  if (expectedDateStatus === 'missing') {
    throw new PartialStepError(`${missingReason}；窗口内其他日期的 ${count} 行已照常写入 ${table}`, { written: count });
  }
  return count;
}

// PLACEHOLDER_MAIN

// === 1. daily_revenue (existing table) ===
async function syncDailyRevenue() {
  const csvRows = loadCsv(`${READABLE_DIR}/sales_by_business_date.csv`) || [];
  // 降级源（hourlyByDate 聚合）同样必须是今晚的：陈旧 daily.json 里恰好有 EXPECTED_DATE 的
  // 可能性虽小（陈旧 = 只含更早的日期），但降级路径写的是 daily_revenue 的当日值，
  // 不能让它绕过新鲜度检查。检查不过就当作「没有降级源」，交给下面的缺日期报错。
  let daily = {};
  try {
    daily = dailySection('hourlyByDate', { requireExpectedDate: false }).daily;
  } catch (e) {
    console.warn(`  [warn] daily.json 不可用作降级源：${e.message}`);
  }
  // CSV 与小时聚合都没有当天时，只有「已证实的零流水日」才允许补一行显式的 0；
  // 判不出来则先把其他日期照常写完，最后记 PARTIAL（见函数末尾），绝不写当天的 0。
  const verdict = businessDateVerdict();
  const { records, fallbackUsed, zeroDayUsed, missingExpectedDate } = resolveDailyRevenueRecords({
    csvRows,
    daily,
    expectedDate: EXPECTED_DATE,
    zeroDay: verdict.verdict === 'closed',
    // 当天判不出来时也要先把其他 29 天的精确记录写进去，再记 PARTIAL。
    // DAILY_REVENUE_ONLY 是「只补当天」的抢修模式，那里必须硬失败。
    partialWhenMissing: !DAILY_REVENUE_ONLY,
  });
  const selectedRecords = selectDailyRevenueRecords(records, EXPECTED_DATE, DAILY_REVENUE_ONLY);
  if (!selectedRecords.length) {
    throw new Error(`daily_revenue source missing expected business date ${EXPECTED_DATE}`);
  }
  if (fallbackUsed) {
    console.warn(`[sync-to-db] daily_revenue ${EXPECTED_DATE} resolved from hourlyByDate fallback`);
  }
  if (zeroDayUsed) {
    console.log(
      `  [info] ${EXPECTED_DATE} 已证实为零流水日：daily_revenue 写 revenue/交易数/流水额=0，` +
        `客单价/折扣率/会员占比=NULL（0/0 未定义）`,
    );
  }

  let count = 0;
  for (const record of selectedRecords) {
    // 保护必须对称：降级路径（hourlyByDate 聚合）只允许补空，不允许改写已有的 888001 精确值。
    // 小时聚合不含无小时归属订单与迟到退款，一次降级重跑会把精确值静默改成近似值。
    //
    // 但「降级」是 per-record 的，不是整轮的开关：resolveDailyRevenueRecords 只在
    // CSV 里没有 EXPECTED_DATE 那一行时才降级，且此时只追加 EXPECTED_DATE 这一条聚合记录，
    // 其余记录仍是 CSV 的精确值（见 lib/daily-revenue-resolver.js）。
    // 若把 degraded 当整轮开关，那 29 天精确记录也会走 COALESCE(旧值, 新值)，
    // 于是迟到退款/作废单造成的历史修正永远写不进去；而且自锁：
    // 第 N 晚降级给 D 日写了近似值，第 N+1 晚 CSV 已有 D 日精确值但当晚又降级 -> 仍被 COALESCE 挡住。
    const degraded = fallbackUsed && record.date === EXPECTED_DATE;
    await sql`
      INSERT INTO daily_revenue (date, revenue, transaction_count, avg_transaction_value, gross_sales, total_discount, discount_rate, member_sales_ratio)
      VALUES (${record.date}, ${record.revenue}, ${record.transaction_count}, ${record.avg_transaction_value}, ${record.gross_sales}, ${record.total_discount}, ${record.discount_rate}, ${record.member_sales_ratio})
      ON CONFLICT ON CONSTRAINT uk_daily_revenue_date DO UPDATE SET
        revenue = CASE WHEN ${degraded} THEN COALESCE(daily_revenue.revenue, EXCLUDED.revenue) ELSE EXCLUDED.revenue END,
        transaction_count = CASE WHEN ${degraded} THEN COALESCE(daily_revenue.transaction_count, EXCLUDED.transaction_count) ELSE EXCLUDED.transaction_count END,
        avg_transaction_value = CASE WHEN ${degraded} THEN COALESCE(daily_revenue.avg_transaction_value, EXCLUDED.avg_transaction_value) ELSE EXCLUDED.avg_transaction_value END,
        gross_sales = CASE WHEN ${degraded} THEN COALESCE(daily_revenue.gross_sales, EXCLUDED.gross_sales) ELSE EXCLUDED.gross_sales END,
        total_discount = CASE WHEN ${degraded} THEN COALESCE(daily_revenue.total_discount, EXCLUDED.total_discount) ELSE EXCLUDED.total_discount END,
        discount_rate = CASE WHEN ${degraded} THEN COALESCE(daily_revenue.discount_rate, EXCLUDED.discount_rate) ELSE EXCLUDED.discount_rate END,
        member_sales_ratio = COALESCE(EXCLUDED.member_sales_ratio, daily_revenue.member_sales_ratio)
    `;
    count++;
  }
  if (missingExpectedDate) {
    throw new PartialStepError(
      `daily_revenue 没有 ${EXPECTED_DATE} 的任何来源（CSV 与小时聚合都没有），` +
        `且无法证明当天是零流水日（${verdict.reason}）；其他日期的 ${count} 行已照常写入`,
      { written: count },
    );
  }
  return count;
}

// === 2. hourly_sales_summary (per-day per-hour) ===
async function syncHourlySales() {
  // 原来的「没有 per-day 数据就退回聚合 hourly，然后 return 0」是个假降级：
  // 它一行都不写，却记成成功。现在缺 hourlyByDate 直接判失败。
  const section = dailySection('hourlyByDate');

  let count = 0;
  for (const h of section.rows) {
    if (!h.date) continue;
    await sql`
      INSERT INTO hourly_sales_summary (date, hour, bill_count, num_of_guests, net_sales, gross_sales, avg_order_net_sales, total_discount, synced_at)
      VALUES (${h.date}, ${num(h.hour)}, ${h.billCount}, ${h.guests}, ${h.netSales}, ${h.grossSales}, ${h.avgTicket}, ${h.discount}, NOW())
      ON CONFLICT (date, hour) DO UPDATE SET
        bill_count = EXCLUDED.bill_count, num_of_guests = EXCLUDED.num_of_guests,
        net_sales = EXCLUDED.net_sales, gross_sales = EXCLUDED.gross_sales,
        avg_order_net_sales = EXCLUDED.avg_order_net_sales, total_discount = EXCLUDED.total_discount, synced_at = NOW()
    `;
    count++;
  }
  return settleExpectedDate(count, section, 'hourly_sales_summary');
}

// === 3. item_hourly_sales (per-day per-hour per-item) ===
async function syncItemHourlySales() {
  const section = dailySection('itemsByDateHour');
  const daily = { itemsByDateHour: section.rows };

  const transFile = 'output/sales/translations.json';
  let itemNames = {};
  if (fs.existsSync(transFile)) {
    const t = JSON.parse(fs.readFileSync(transFile, 'utf8'));
    itemNames = t.dimOptions?.D_itemName || {};
  }

  // Collect unique rows
  const seen = new Set();
  const batch = [];
  for (const r of daily.itemsByDateHour) {
    if (!r.date || !r.name) continue;
    // r.name 是 RES 的稳定商品键；显示名会重复也会改，只能当展示用。
    const itemKey = r.name;
    const name = itemNames[itemKey] || itemKey;
    const uid = `${r.date}|${r.hour}|${itemKey}`;
    if (seen.has(uid)) continue;
    seen.add(uid);
    batch.push({ date: r.date, hour: Number(r.hour), item_key: itemKey, item_name: name, qty: r.qty || 0, net_sales: r.netSales || 0, gross_sales: r.grossSales || 0 });
  }

  // Clear and bulk insert in chunks — atomic per run so a mid-sync crash
  // can't leave a date half-deleted (IMPROVEMENT-PLAN.md A4)
  await sql.begin(async (sql) => {
    const dates = [...new Set(batch.map(r => r.date))];
    // 「日期齐全但行数塌陷」的护栏：源被截断（分页中断、pageSize 打满）时日期看着都在，
    // 只是每天少了一大半行。DELETE+INSERT 会把这份缩水结果写成事实，而
    // daily_sales_record / timeslot_sales_record 视图直接由本表派生，塌陷会原样透出。
    // 所以先比一比同一天的旧行数：缩水超过阈值就整笔回滚。
    // 允许缩水的正常情形（作废单、退款）幅度很小，SHRINK_RATIO=0.5 有充足余量；
    // 确需强推时 SYNC_ALLOW_SHRINK=1。
    const SHRINK_RATIO = Number(process.env.SYNC_SHRINK_RATIO || 0.5);
    if (process.env.SYNC_ALLOW_SHRINK !== '1' && dates.length) {
      const before = await sql`
        SELECT date::text AS date, COUNT(*)::int AS n FROM item_hourly_sales
        WHERE date = ANY(${dates}) GROUP BY date
      `;
      const newCount = new Map();
      for (const r of batch) newCount.set(r.date, (newCount.get(r.date) || 0) + 1);
      for (const { date, n } of before) {
        const now = newCount.get(date) || 0;
        // n < 20 的日子（开业极晚/极冷清）比例噪声大，不参与判定。
        if (n >= 20 && now < n * SHRINK_RATIO) {
          throw new Error(
            `item_hourly_sales ${date} 行数塌陷：库里 ${n} 行，本次只有 ${now} 行` +
              `（阈值 ${Math.round(SHRINK_RATIO * 100)}%）—— 源很可能被截断，已回滚。确认无误可用 SYNC_ALLOW_SHRINK=1 重跑`,
          );
        }
      }
    }
    for (const d of dates) {
      await sql`DELETE FROM item_hourly_sales WHERE date = ${d}`;
    }
    for (let i = 0; i < batch.length; i += 500) {
      const chunk = batch.slice(i, i + 500);
      await sql`INSERT INTO item_hourly_sales ${sql(chunk, 'date', 'hour', 'item_key', 'item_name', 'qty', 'net_sales', 'gross_sales')}`;
    }
  });
  // 当天无法证明是零流水日时记 PARTIAL：其他日期已经写进去了，整轮仍以 exit 1 收尾告警。
  return settleExpectedDate(batch.length, section, 'item_hourly_sales');
}

// === 4. daily_breakdown (payment, per-day from sales_by_business_date) ===
async function syncPaymentBreakdown() {
  const rows = loadCsv(`${READABLE_DIR}/sales_by_business_date.csv`);
  // 本维度没有任何 fallback 数据源，CSV 一缺就必须炸，不能静默返回 0。
  // 实测后果：daily_breakdown(payment) 停在 2026-07-23，而当晚整链 exit=0。
  if (!rows?.length) {
    throw new Error(`daily_breakdown(payment) 源缺失：${READABLE_DIR}/sales_by_business_date.csv 不存在或为空`);
  }
  // 「有文件但没有今天这一行」有两种可能：30 天窗口重放的半成功形态（必须响亮失败），
  // 或者当天真的零流水（门店停业 -> 一笔支付都没有 -> 报表里根本没有这一天）。
  // 由 businessDateVerdict 区分；判不出来时先把其他日期写完再记 PARTIAL，
  // 而不是像以前那样在写入之前抛错、连带 29 天完好数据一起不写。
  const missingToday = !rows.some((r) => r['Business Date'] === EXPECTED_DATE);
  const verdict = missingToday ? businessDateVerdict() : null;
  if (missingToday && verdict.verdict === 'closed') {
    console.log(`  [info] ${EXPECTED_DATE} 已证实为零流水日：当天没有任何支付，daily_breakdown(payment) 不写当天`);
  }

  let count = 0;
  for (const r of rows) {
    const date = r['Business Date'];
    if (!date) continue;
    const totalPayment = num(r['Total Payment received']) || 0;
    if (totalPayment <= 0) continue;

    const channels = [
      ['ExternalBankCard', num(r['Payment Subtotal — External Bank Card'])],
      ['Membership card balance', num(r['Payment Subtotal — Membership card pay'])],
      ['Cash', num(r['Payment Subtotal — Cash'])],
    ];

    for (const [method, amount] of channels) {
      if (amount == null) continue;
      const ratio = totalPayment > 0 ? +(amount / totalPayment).toFixed(4) : null;
      await sql`
        INSERT INTO daily_breakdown (date, dim_type, dim_value, net_sales, ratio)
        VALUES (${date}, 'payment', ${method}, ${amount}, ${ratio})
        ON CONFLICT (date, dim_type, dim_value) DO UPDATE SET
          net_sales = EXCLUDED.net_sales, ratio = EXCLUDED.ratio
      `;
      count++;
    }
  }
  if (missingToday && verdict.verdict !== 'closed') {
    throw new PartialStepError(
      `daily_breakdown(payment) 源里没有 ${EXPECTED_DATE} 这一天，且无法证明当天是零流水日` +
        `（${verdict.reason}）；其他日期的 ${count} 行已照常写入`,
      { written: count },
    );
  }
  return count;
}

// === 5. daily_breakdown (dining, 30-day ratios fanned out per date) ===
async function syncDiningBreakdown() {
  // We don't have per-day dining data from the CSV, only 30-day totals.
  // Store the 30-day ratio for each date in the range as a reference.
  const rows = loadCsv(`${READABLE_DIR}/orders_by_dining_option.csv`);
  // MEDIUM-2：本维度没有任何 fallback 数据源，CSV 一缺就必须炸（与第 4 步同一处理）。
  // 而且 apply-translations 现在是 delete-first：文件不存在 = 今晚没重建成功，
  // 静默 return 0 会让「daily_breakdown(dining) 停在几天前」而整链 exit 0。
  if (!rows?.length) {
    throw new Error(`daily_breakdown(dining) 源缺失：${READABLE_DIR}/orders_by_dining_option.csv 不存在或为空`);
  }

  const total = rows.reduce((a, r) => a + (num(r['Bill Count']) || 0), 0);
  // Get all dates from daily_revenue to assign dining ratios
  const revenueRows = loadCsv(`${READABLE_DIR}/sales_by_business_date.csv`);
  if (!revenueRows?.length) {
    throw new Error(`daily_breakdown(dining) 缺少日期源：${READABLE_DIR}/sales_by_business_date.csv 不存在或为空`);
  }
  // 与第 6 步同一处理：零流水日当天没有任何账单，日期源里没有当天是正常的。
  const missingToday = !revenueRows.some((r) => r['Business Date'] === EXPECTED_DATE);
  const verdict = missingToday ? businessDateVerdict() : null;
  if (missingToday && verdict.verdict === 'closed') {
    console.log(`  [info] ${EXPECTED_DATE} 已证实为零流水日：当天没有任何账单，daily_breakdown(dining) 不写当天`);
  }

  let count = 0;
  for (const rev of revenueRows) {
    const date = rev['Business Date'];
    if (!date) continue;
    for (const r of rows) {
      const option = r['Dining Options'] || '';
      if (!option) continue;
      const billCount = num(r['Bill Count']);
      const ratio = total > 0 ? +(billCount / total).toFixed(4) : null;
      await sql`
        INSERT INTO daily_breakdown (date, dim_type, dim_value, bill_count, net_sales, ratio)
        VALUES (${date}, 'dining', ${option}, ${null}, ${null}, ${ratio})
        ON CONFLICT (date, dim_type, dim_value) DO UPDATE SET ratio = EXCLUDED.ratio
      `;
      count++;
    }
  }
  if (missingToday && verdict.verdict !== 'closed') {
    throw new PartialStepError(
      `daily_breakdown(dining) 的日期源里没有 ${EXPECTED_DATE} 这一天，且无法证明当天是零流水日` +
        `（${verdict.reason}）；其他日期的 ${count} 行已照常写入`,
      { written: count },
    );
  }
  return count;
}

// === 6. item_waste (per-day per-item waste with reason) ===
async function syncItemWaste() {
  // itemWaste 与另外两个数组不同：某天真的一条报损都没有是完全正常的，
  // 所以只要求「文件新鲜 + 该查询当晚 ok + 字段存在」，不要求含 EXPECTED_DATE。
  // 空数组时 batch 为空、不会 DELETE 任何一天，安全。
  const { rows: itemWaste } = dailySection('itemWaste', { requireExpectedDate: false });
  if (!itemWaste.length) { console.log('  [info] itemWaste 查询成功但当窗口零报损，无需写入'); return 0; }
  const daily = { itemWaste };

  const transFile = 'output/sales/translations.json';
  let itemNames = {};
  if (fs.existsSync(transFile)) {
    const t = JSON.parse(fs.readFileSync(transFile, 'utf8'));
    itemNames = t.dimOptions?.D_itemName || {};
  }

  const REASON_MAP = {
    'abnormal loss': 'production',
    'taste testing and spoilage reporting': 'tasting',
    'production scheduling and loss reporting': 'scheduling',
  };

  const seen = new Set();
  const batch = [];
  for (const r of daily.itemWaste) {
    if (!r.date || !r.name) continue;
    const itemKey = r.name;
    const name = itemNames[itemKey] || itemKey;
    const reason = REASON_MAP[r.reason] || r.reason || 'other';
    const uid = `${r.date}|${itemKey}|${reason}`;
    if (seen.has(uid)) continue;
    seen.add(uid);
    batch.push({ date: r.date, item_key: itemKey, item_name: name, waste_reason: reason, qty: r.qty || 0, amount: r.amount || 0 });
  }

  // Delete existing and bulk insert — atomic per run (IMPROVEMENT-PLAN.md A4)
  await sql.begin(async (sql) => {
    const dates = [...new Set(batch.map(r => r.date))];
    for (const d of dates) {
      await sql`DELETE FROM item_waste WHERE date = ${d}`;
    }
    for (let i = 0; i < batch.length; i += 500) {
      const chunk = batch.slice(i, i + 500);
      await sql`INSERT INTO item_waste ${sql(chunk, 'date', 'item_key', 'item_name', 'waste_reason', 'qty', 'amount')}`;
    }
  });
  return batch.length;
}

// === 7. item_last_sale (per-day per-item last-sale MINUTE, for precise stockout) ===
// Source: scrape-item-last-sale.mjs → output/sales/item-last-sale.json (menuItemId keyed).
// Translate id → readable name via the same D_itemName map as item_hourly_sales/item_waste.
async function syncItemLastSale() {
  const file = 'output/sales/item-last-sale.json';
  if (!fs.existsSync(file)) { console.log('  [skip] item-last-sale.json not found'); return 0; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data.rows?.length) { console.log('  [skip] no rows'); return 0; }

  const transFile = 'output/sales/translations.json';
  let itemNames = {};
  if (fs.existsSync(transFile)) {
    const t = JSON.parse(fs.readFileSync(transFile, 'utf8'));
    itemNames = t.dimOptions?.D_itemName || {};
  }

  // Collapse to one row per (date, readable name): keep the latest last_sale_time.
  const byKey = new Map();
  for (const r of data.rows) {
    if (!r.date || !r.id || !r.lastTime) continue;
    const itemKey = r.id;
    const name = itemNames[itemKey] || itemKey;
    const key = `${r.date}|${itemKey}`;
    const cur = byKey.get(key);
    if (!cur || r.lastTime > cur.last_sale_time) {
      byKey.set(key, { date: r.date, item_key: itemKey, item_name: name, last_sale_time: r.lastTime, day_qty: (cur?.day_qty || 0) + (Number(r.dayQty) || 0) });
    } else {
      cur.day_qty += Number(r.dayQty) || 0;
    }
  }
  const batch = [...byKey.values()];

  await sql.begin(async (sql) => {
    const dates = [...new Set(batch.map(r => r.date))];
    for (const d of dates) await sql`DELETE FROM item_last_sale WHERE date = ${d}`;
    for (let i = 0; i < batch.length; i += 500) {
      const chunk = batch.slice(i, i + 500);
      await sql`INSERT INTO item_last_sale ${sql(chunk, 'date', 'item_key', 'item_name', 'last_sale_time', 'day_qty')}`;
    }
  });
  return batch.length;
}

// 每一步都「失败也不阻断后面的步骤」，最后统一报错并非 0 退出。
// 理由与 lib/step-runner.js 一致：这 7 张表的数据源彼此基本独立
// （2/3/6 只读 daily.json，1/4/5 只读 readable CSV，7 只读 item-last-sale.json），
// 一张表的源缺失不该让另外 6 张当晚一行不写。
// stepStatus 只用于日志与汇总：派生视图（daily_sales_record / timeslot_sales_record）
// 直接读 item_hourly_sales，不再需要「步骤间依赖」—— 源没写进去，视图自然停在旧数据。
const deferredFailures = [];
const stepStatus = new Map();
async function runStep(label, fn, { id = label } = {}) {
  console.log(label);
  try {
    const count = await fn();
    console.log(`   -> ${count} rows\n`);
    stepStatus.set(id, 'ok');
    return count;
  } catch (e) {
    // PARTIAL：窗口内其他日期已经写进去了（保留），只有业务日当天写不了且判不出是不是零流水日。
    // 记成失败（deferredFailures -> exit 1 -> daily-refresh.sh 重试/告警照常），状态记 'partial'。
    if (e instanceof PartialStepError) {
      console.error(`   -> PARTIAL: 已写 ${e.written} 行；${e.message}\n`);
      deferredFailures.push(`${label}: ${e.message}`);
      stepStatus.set(id, 'partial');
      return e.written;
    }
    console.error(`   -> FAILED: ${e.message}\n`);
    deferredFailures.push(`${label}: ${e.message}`);
    stepStatus.set(id, 'failed');
    return null;
  }
}

async function main() {
  console.log(`[sync-to-db] syncing scraped data to database... (business date ${EXPECTED_DATE})\n`);
  // 当天定性只在整轮开头判一次并打进日志：排查时第一眼就能看到「今晚是把当天当成有生意、
  // 零流水、还是判不出来」，而不是从九步的分散日志里拼。
  const v = businessDateVerdict();
  console.log(`[sync-to-db] ${EXPECTED_DATE} 定性 = ${v.verdict}：${v.reason}\n`);

  await runStep('1. daily_revenue (existing)', syncDailyRevenue);

  if (DAILY_REVENUE_ONLY) {
    console.log(`[sync-to-db] daily-revenue-only complete for ${EXPECTED_DATE}`);
    return finish();
  }
  await runStep('2. hourly_sales_summary (per-day per-hour)', syncHourlySales);
  await runStep('3. item_hourly_sales (per-day per-hour per-item)', syncItemHourlySales);
  await runStep('4. daily_breakdown(payment)', syncPaymentBreakdown);
  await runStep('5. daily_breakdown(dining)', syncDiningBreakdown);
  await runStep('6. item_waste (per-day per-item waste)', syncItemWaste);
  await runStep('7. item_last_sale (per-day per-item last-sale minute)', syncItemLastSale);

  return finish();
}

async function finish() {
  if (deferredFailures.length) {
    console.error('[sync-to-db] FAILED:');
    for (const f of deferredFailures) console.error(`  - ${f}`);
    await sql.end();
    process.exit(1);
  }

  console.log('[sync-to-db] done');
  await sql.end();
}

main().catch(async e => {
  console.error('[sync-to-db] ERROR:', e.message);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
