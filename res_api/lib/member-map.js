// 会员产物 -> 数据库行的纯映射层。不连库、不发请求，可单测。
//
// 为什么单独一个模块：产物的字段名与表列名有多处不同名（topup_face -> topup_face_value、
// redeem -> redeem_amount、balance_end_money -> balance_end_cash、point -> point_delta…），
// 按名直映会静默错位或丢列。把映射摊开在一处，改表结构时只需要改这里，并且能被测试钉住。
//
// 表结构以 财务仓库 sql/060_pos_member_baseline.sql 为准。

/** POS 与门店都在吉隆坡，报表引擎返回的时间是不带时区的 KL 墙上时间。 */
export const KL_OFFSET = '+08:00';

/**
 * 报表引擎的 txn_time 形如 '2026-06-13T12:08:17.583834'：**没有 Z、没有 +08:00**。
 * 直接塞进 timestamptz 会被按会话时区（Supabase 默认 UTC）解释，全表偏 8 小时，
 * 而且与独立落库的 business_date 自相矛盾。这里显式补上 KL 偏移。
 * 已经带时区的（snapshot 侧的字段带 Z）原样返回。
 */
export function klTimestamp(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return s; // 已带时区
  return `${s}${KL_OFFSET}`;
}

/** 'YYYY-MM-DDTHH:mm:ss…' 或 'YYYY-MM-DD' -> 'YYYY-MM-DD'；取不出来给 null。 */
export function dateOnly(raw) {
  if (raw == null || raw === '') return null;
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new TypeError(`期望数字，拿到 ${JSON.stringify(v)}`);
  return n;
};
const int = (v) => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

/** snapshot.json 的一行 -> pos_member 的一行。**绝不产出 phone_e164**（生成列）。 */
export function mapMember(row, { store, snapshotDate }) {
  return {
    member_id: String(row.member_id),
    store,
    has_profile: !!row.has_profile,
    phone_country_code: row.phone_country_code ?? null,
    phone_national: row.phone_national ?? null,
    registered_on: dateOnly(row.profile_created_at),
    register_shop_id: row.initial_shop_id ?? null,
    source_type: int(row.source_type),
    card_count: int(row.card_count) ?? 0,
    level_name: row.level_name ?? null,
    growth: int(row.growth),
    point_balance: int(row.points),
    balance_total: num(row.balance),
    balance_cash: num(row.money_balance),
    balance_gift: num(row.gift_balance),
    balance_frozen: num(row.frozen_balance),
    lifetime_topup_amount: num(row.recharge_amount_total),
    lifetime_topup_count: int(row.recharge_count),
    lifetime_consume_amount: num(row.consumption_amount_total),
    lifetime_consume_count: int(row.consumption_count),
    first_card_created_on: dateOnly(row.card_created_at),
    last_recharge_at: klTimestamp(row.last_recharge_time),
    last_trans_at: klTimestamp(row.last_trans_time),
    snapshot_date: snapshotDate,
  };
}

/**
 * 抓取侧的 txn_type_label -> 库里 ck_pos_member_card_txn_label 允许的取值。
 *
 * ⚠️ 唯一不同名的是类型 20：抓取侧叫 'redeem'，060 的 CHECK 只收 'consume'。
 * 这里改抓取侧而不是改库，因为 060 已执行且 checksum 锁死，为一个命名再加一条迁移不值。
 *
 * ⚠️ 但由此留下一个真实的绊脚点：**pos_member_daily 的列名用的是 redeem_***
 * （redeem_amount / redeem_count / redeem_cash / redeem_gift），
 * 而 pos_member_card_txn 的标签是 'consume'。
 * 写 `WHERE txn_type_label = 'redeem'` 会得 0 行 —— 要查核销请用 txn_type = 20，
 * 或者 txn_type_label = 'consume'。
 */
const LABEL_TO_DB = { redeem: 'consume' };

/** flows.json 的 txns 一行 -> pos_member_card_txn 的一行。 */
export function mapTxn(row, { store }) {
  return {
    txn_id: String(row.trans_serial_number),
    store,
    pos_shop_id: row.pos_shop_id ?? null,
    business_date: row.business_date,
    txn_at: klTimestamp(row.txn_time),
    member_id: row.member_id ?? null,
    card_no: row.card_no == null ? null : String(row.card_no),
    txn_type: int(row.txn_type),
    txn_type_label: LABEL_TO_DB[row.txn_type_label] || row.txn_type_label,
    money_amount: num(row.money_amount),
    gift_amount: num(row.gift_amount),
    total_amount: num(row.total_amount),
    trade_amount: num(row.trade_amount),
    before_money_balance: num(row.before_money_balance),
    after_money_balance: num(row.after_money_balance),
    before_gift_balance: num(row.before_gift_balance),
    after_gift_balance: num(row.after_gift_balance),
    point_delta: int(row.point),
    pos_order_no: row.pos_order_id ?? null,
    order_id: row.order_id ?? null,
    source_code: row.source ?? null,
    source: 'report_100150',
  };
}

/**
 * 走后台调账（txn_type=50）但性质是**客户预存**的金额下限。
 *
 * 实测（2024-01-01 至今全量 35 笔调整）：RM 1,000 以下 30 笔、最大 850.00，
 * 都是「RM 200 → 余额 100」这类补偿/纠错；RM 1,000 以上只有 1 笔 —— 2026-06-06 的
 * 30,000.00（会员当天注册开卡、余额 0→30,000、此后 19 笔正常消费、至今仍余 26,330.77）。
 * 中间是 35 倍空档，今天不存在边界样本。
 *
 * 这是**启发式**，不是 POS 给的语义。出现接近阈值的样本时会打日志提示人工判读。
 */
export const MEMBER_TOPUP_ADJUST_MIN = Number(process.env.MEMBER_TOPUP_ADJUST_MIN || 1000);

/** 阈值附近（0.5x ~ 2x）的样本值得人看一眼，避免启发式静默误判。 */
const NEAR_THRESHOLD = (v) => v >= MEMBER_TOPUP_ADJUST_MIN / 2 && v < MEMBER_TOPUP_ADJUST_MIN * 2;

/**
 * 把当日的 txn_type=50/60 拆成「客户预存（计入充值）」与「纠错（不计入）」。
 * 两者之和恒等于 adjust_net —— 061 的 ck_pos_member_daily_adjust_split 会校验这一点。
 * 返回 { byDate: Map, reclassified: [], nearThreshold: [] }。
 */
export function splitAdjustments(txns) {
  const byDate = new Map();
  const reclassified = [];
  const nearThreshold = [];
  for (const t of txns) {
    const type = Number(t.txn_type);
    if (type !== 50 && type !== 60) continue;
    const d = t.business_date;
    let a = byDate.get(d);
    if (!a) { a = { topup_adjust_amount: 0, adjust_correction: 0 }; byDate.set(d, a); }
    const amt = Number(t.total_amount) || 0;
    // 只有**调增**才可能是预存；调减（60）一律算纠错。
    if (type === 50 && Math.abs(amt) >= MEMBER_TOPUP_ADJUST_MIN) {
      a.topup_adjust_amount += amt;
      reclassified.push({ date: d, amount: amt });
    } else {
      a.adjust_correction += amt;
      if (type === 50 && NEAR_THRESHOLD(Math.abs(amt))) nearThreshold.push({ date: d, amount: amt });
    }
  }
  for (const a of byDate.values()) {
    a.topup_adjust_amount = Math.round(a.topup_adjust_amount * 100) / 100;
    a.adjust_correction = Math.round(a.adjust_correction * 100) / 100;
  }
  return { byDate, reclassified, nearThreshold };
}

/**
 * 从流水按 (business_date, txn_type) 聚合出 pos_member_daily 里
 * **产物没有直接来源**的四列：topup_count / redeem_count / redeem_cash / redeem_gift。
 * 复核实测：flows.daily 只给了 txn_count（全类型合计）与 redeem 总额，没有分类型笔数与本金/赠送拆分。
 */
export function aggregateTxnCounts(txns) {
  const by = new Map();
  for (const t of txns) {
    const d = t.business_date;
    let a = by.get(d);
    if (!a) {
      a = { topup_count: 0, redeem_count: 0, redeem_cash: 0, redeem_gift: 0 };
      by.set(d, a);
    }
    const type = Number(t.txn_type);
    if (type === 10) a.topup_count += 1;
    if (type === 20) {
      a.redeem_count += 1;
      a.redeem_cash += Number(t.money_amount) || 0;
      a.redeem_gift += Number(t.gift_amount) || 0;
    }
  }
  for (const a of by.values()) {
    a.redeem_cash = Math.round(a.redeem_cash * 100) / 100;
    a.redeem_gift = Math.round(a.redeem_gift * 100) / 100;
  }
  return by;
}

/**
 * flows.daily + trends.daily + 流水聚合 -> pos_member_daily 的一行。
 *
 * is_partial / missing_sources 的判据（遵守「绝不用 0 填补缺失事实」）：
 *  - trends 没有这一天 -> missing_sources 加 'trends'，四列人数/消费额写 NULL
 *  - 这一天就是当前业务日（还没过完）-> missing_sources 加 'incomplete_day'
 * 两者任一成立即 is_partial=true。
 *
 * 注意 card_payment_net / card_payment_ratio / net_stored_value_face / member_consume_ratio
 * 都是**生成列**，不出现在这里。
 */
export function mapDaily(d, { store, trendsByDate, txnAgg, adjustSplit, businessDate, balanceSource }) {
  const t = trendsByDate.get(d.business_date) || null;
  const agg = txnAgg.get(d.business_date) || {
    topup_count: null, redeem_count: null, redeem_cash: null, redeem_gift: null,
  };
  const split = adjustSplit.get(d.business_date) || { topup_adjust_amount: 0, adjust_correction: 0 };
  const missing = [];
  if (!t) missing.push('trends');
  if (d.business_date === businessDate) missing.push('incomplete_day');

  return {
    date: d.business_date,
    store,
    new_member_count: t ? int(t.new_member_count) : null,
    consumed_member_count: t ? int(t.consumed_member_count) : null,
    recharged_member_count: t ? int(t.recharged_member_count) : null,
    points_member_count: t ? int(t.points_member_count) : null,
    member_consume_amount: t ? num(t.member_consume_amount) : null,
    total_consume_amount: t ? num(t.total_consume_amount) : null,
    topup_cash: num(d.topup_cash),
    topup_gift: num(d.topup_gift),
    topup_face_value: num(d.topup_face),
    topup_count: agg.topup_count,
    topup_refund: num(d.topup_refund),
    redeem_amount: num(d.redeem),
    redeem_cash: agg.redeem_cash,
    redeem_gift: agg.redeem_gift,
    redeem_count: agg.redeem_count,
    consume_refund: num(d.consume_refund),
    adjust_net: num(d.adjust_net),
    // 061：把 adjust_net 拆成「客户预存（计入 topup_total）」与「纠错」。两者之和恒等于 adjust_net。
    topup_adjust_amount: split.topup_adjust_amount,
    adjust_correction: split.adjust_correction,
    net_stored_value_cash: num(d.net_stored_value_cash),
    balance_end_total: num(d.balance_end_total),
    balance_end_cash: num(d.balance_end_money),
    balance_end_gift: num(d.balance_end_gift),
    is_partial: missing.length > 0,
    missing_sources: missing.length ? missing : null,
    // 如实记录期末余额是实测锚点还是恒等式反推 —— 939 天里 938 天是 derived，
    // 表注释说的「当天抓当天记」对历史行并不成立，不写清楚会被误当成实测快照。
    source: `flows:100150+100242;balance:${balanceSource(d)};trends:${t ? 'ok' : 'missing'}`,
  };
}
