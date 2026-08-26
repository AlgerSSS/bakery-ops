// 会员日 1.5 倍积分补差。
//
// 为什么需要这个文件：RES 的会员日权益只接受 2–9 的整数倍积分，方案要的 1.5 倍配不出来
// （见 lib/benefit-readiness.js 的 memberDayPointsMultiplier）。所以周三当天 RES 只给
// 1 倍，缺的 0.5 倍由服务器在次日补。
//
// 三个必须守住的点：
//   1. 补差额 = floor(实付 × 1.5) − floor(实付)，不是 floor(实付 × 0.5)。
//      RM1.99 的情况两者差 1 分：前者 2−1=1，后者 floor(0.995)=0。按订单逐笔算，不要先汇总再乘。
//   2. 幂等靠 claimed→applied 状态机，不是"跑完再记"。RES 调用成功但进程崩溃的窗口里，
//      账本停在 claimed；下一次运行必须把它报成需要人工核对，绝不能自动重试——重试就是重复送分，
//      而积分送出去收不回来。
//   3. 只处理周三。传进来的业务日不是吉隆坡时区的周三就直接拒绝，不做"就近找周三"这种猜测。

export const MEMBER_DAY = Object.freeze({
  timeZone: "Asia/Kuala_Lumpur",
  weekday: 3,          // 周三
  multiplier: 1.5,
  resBaseMultiplier: 1, // RES 原生 RM1 = 1 分
  effectiveFrom: "2026-08-30",
});

/**
 * RES 积分调整的方向枚举。这两个值来自后台 JS 包里 Point Adjustment 表单的
 * adjustIncrease / adjustDecrease 单选项，并在真实卡上验证过 7 确实是"增加积分"。
 * 注意别用储值调整那套（10/20）——用 10 打积分接口会被拒：invalid request param: type。
 */
export const POINT_ADJUST_TYPE = Object.freeze({ increase: 7, decrease: 701 });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertBusinessDate(value) {
  const date = String(value ?? "").trim();
  if (!DATE_RE.test(date)) {
    throw new TypeError(`Business date must be YYYY-MM-DD, got ${JSON.stringify(value)}.`);
  }
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) {
    throw new TypeError(`${date} is not a real calendar date.`);
  }
  return date;
}

/** 业务日是不是会员日（周三）。业务日本身就是门店本地日期，不需要再做时区换算。 */
export function isMemberDay(businessDate) {
  const date = assertBusinessDate(businessDate);
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === MEMBER_DAY.weekday;
}

/**
 * 从给定日期往回找最近的一个周三（含当天）。
 * 主跑在周三 23:59（当天即目标），补扫在周四凌晨（目标是昨天），同一函数都成立。
 */
export function mostRecentMemberDay(fromDate) {
  const date = assertBusinessDate(fromDate);
  const [y, m, d] = date.split("-").map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 7; i += 1) {
    if (cursor.getUTCDay() === MEMBER_DAY.weekday) return cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  throw new Error("Unreachable: no Wednesday within 7 days.");
}

export function assertMemberDay(businessDate) {
  const date = assertBusinessDate(businessDate);
  if (!isMemberDay(date)) {
    throw new Error(`${date} is not a Wednesday; member-day top-up refuses to run.`);
  }
  return date;
}

/** 活动从 8 月 30 日生效；由于当天是周日，首个可补积分业务日是 9 月 2 日。 */
export function isMemberDayActive(
  businessDate,
  effectiveFrom = MEMBER_DAY.effectiveFrom,
) {
  const date = assertBusinessDate(businessDate);
  const start = assertBusinessDate(effectiveFrom);
  return isMemberDay(date) && date >= start;
}

/**
 * 单笔订单要补的积分。
 * 目标是 floor(实付 × 1.5)，RES 已经给了 floor(实付 × 1)，差额就是要补的。
 * 退单/冲正金额为负时返回 0——补差只加不减，扣减由 RES 自己的冲正流程处理。
 */
export function bonusPointsForOrder(actualPaid) {
  // Number(null) 是 0、Number("") 也是 0——金额缺失必须报错，不能被当成"补 0 分"放过。
  if (actualPaid === null || actualPaid === undefined || actualPaid === "") {
    throw new TypeError("Actual paid amount is missing.");
  }
  const paid = Number(actualPaid);
  if (!Number.isFinite(paid)) {
    throw new TypeError(`Actual paid amount is not finite: ${JSON.stringify(actualPaid)}.`);
  }
  if (paid <= 0) return 0;
  const ideal = Math.floor(paid * MEMBER_DAY.multiplier);
  const granted = Math.floor(paid * MEMBER_DAY.resBaseMultiplier);
  const bonus = ideal - granted;
  if (bonus < 0) throw new Error(`Negative bonus computed for ${paid}.`);
  return bonus;
}

/**
 * 把订单聚合成"每张卡补多少分"。
 * 逐笔算再相加——先汇总再乘会因为取整少给分。
 */
export function buildTopUpPlan(orders, { maxPointsPerCard = 5000 } = {}) {
  if (!Array.isArray(orders)) throw new TypeError("orders must be an array.");
  const byCard = new Map();
  let skippedNoCard = 0;
  let skippedZero = 0;

  for (const order of orders) {
    const cardNo = String(order?.cardNo ?? "").trim();
    if (!cardNo) { skippedNoCard += 1; continue; }
    const bonus = bonusPointsForOrder(order?.actualPaid);
    if (bonus === 0) { skippedZero += 1; continue; }
    const entry = byCard.get(cardNo) ?? { cardNo, points: 0, orders: [] };
    entry.points += bonus;
    entry.orders.push({ orderId: String(order?.orderId ?? ""), actualPaid: Number(order.actualPaid), bonus });
    byCard.set(cardNo, entry);
  }

  const overCap = [];
  for (const entry of byCard.values()) {
    if (entry.points > maxPointsPerCard) overCap.push({ cardNo: entry.cardNo, points: entry.points });
  }

  const cards = [...byCard.values()].sort((a, b) => a.cardNo.localeCompare(b.cardNo));
  return {
    cards,
    totalPoints: cards.reduce((sum, c) => sum + c.points, 0),
    cardCount: cards.length,
    orderCount: orders.length,
    skippedNoCard,
    skippedZero,
    overCap,
  };
}

/** 一张卡一个业务日只允许一条账本记录，key 唯一。 */
export function ledgerKey(businessDate, cardNo) {
  return `${assertBusinessDate(businessDate)}|${String(cardNo ?? "").trim()}`;
}

export const LEDGER_STATES = Object.freeze(["claimed", "applied", "failed"]);

/**
 * 判断一张卡这一天该发多少。
 *
 * 账本里的 points 是【累计已发】，不是"本次要发"。这样主跑（周三 23:59）之后
 * 如果还有晚到的订单，补扫（周四凌晨）能只补差额而不重复发。
 *
 * applied 且计划额 > 已发  -> 补差额
 * applied 且计划额 <= 已发  -> 跳过（不做负向回收，退单由 RES 自己的冲正处理）
 * claimed                  -> RES 调用结果不明，必须人工核对，绝不自动重试
 * failed                   -> 明确失败，可以整额重试
 */
export function decideCard(ledgerEntry, plannedPoints) {
  const planned = Number(plannedPoints);
  if (!Number.isInteger(planned) || planned < 0) {
    throw new TypeError(`Planned points must be a non-negative integer, got ${JSON.stringify(plannedPoints)}.`);
  }
  if (!ledgerEntry) return { action: "grant", points: planned, reason: "no_prior_record" };
  switch (ledgerEntry.state) {
    case "applied": {
      const granted = Number(ledgerEntry.points);
      if (!Number.isInteger(granted) || granted < 0) {
        return { action: "halt", points: 0, reason: "corrupt_applied_amount" };
      }
      const delta = planned - granted;
      return delta > 0
        ? { action: "grant", points: delta, reason: "late_orders_top_up" }
        : { action: "skip", points: 0, reason: "already_applied" };
    }
    case "claimed": return { action: "halt", points: 0, reason: "unresolved_claim" };
    case "failed":  return { action: "grant", points: planned, reason: "retry_after_failure" };
    default: return { action: "halt", points: 0, reason: `unknown_state:${ledgerEntry.state}` };
  }
}

/** 发送给 RES 的备注，带业务日与订单数，便于事后在后台逐条对账。 */
export function adjustmentRemark(businessDate, orderCount) {
  return `MEMBERDAY 1.5x top-up ${assertBusinessDate(businessDate)} (${orderCount} order(s))`;
}
