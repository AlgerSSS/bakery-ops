// 「今晚这一轮刷新到底是哪个业务日」的单一来源。
//
// 为什么需要它（M3 的二次伤害）：整条链上每个脚本各自算 `new Date()` 的 KL 日期。
// 正常之夜 23:00 起跑，大家都算出 D，没问题；一旦重试把墙钟推过 KL 00:00，
// scrape* 抓的仍是 D 的数据（页面默认窗口按启动时刻定），而 sync-to-db 的
// EXPECTED_DATE 翻成 D+1，于是最后一次重试注定失败 —— 而且失败得毫无意义。
//
// 解法：daily-refresh.sh 在第一次尝试之前把业务日算一次并 export REFRESH_BUSINESS_DATE，
// 整条链（含所有重试）全部读它。跨午夜的重试因此仍然对齐到 D。
// 未设置时退回「此刻的 KL 日期」，保证手工单跑脚本的行为不变。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Current business date in the shop timezone, independent of the host timezone. */
export function kualaLumpurDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * 本轮刷新锁定的业务日（YYYY-MM-DD）。
 * REFRESH_BUSINESS_DATE 格式不合法时忽略并告警 —— 宁可退回墙钟，也不要用一个畸形日期去删表。
 */
export function refreshBusinessDate(env = process.env, now = new Date()) {
  const pinned = env.REFRESH_BUSINESS_DATE;
  if (pinned) {
    if (DATE_RE.test(pinned.trim())) return pinned.trim();
    console.warn(`[business-date] 忽略非法的 REFRESH_BUSINESS_DATE=${pinned}（期望 YYYY-MM-DD）`);
  }
  return kualaLumpurDate(now);
}

/** 业务日字符串 -> 本地零点 Date，供各脚本沿用原来的 fmtDash/fmtSlash 逻辑。 */
export function businessDateToLocalMidnight(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`[business-date] 无法解析业务日 ${dateStr}`);
  d.setHours(0, 0, 0, 0);
  return d;
}
