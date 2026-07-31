// output/daily/daily.json 的「新鲜度 / 完备性」断言（HIGH-1）。
//
// 背景：sync-to-db 的第 3/6 步是 `DELETE FROM <表> WHERE date = $d` 然后插入，
// 派生视图（daily_sales_record / timeslot_sales_record）直接读 item_hourly_sales。
// 这几步以前对 daily.json 零校验：文件不在就 `[skip] return 0`、字段缺就 `[skip] return 0`，
// 于是一份躺在盘上好几天的陈旧 daily.json（或某个查询失败后残缺的 daily.json）
// 可以让整晚「静默销毁数据」——把库里完整的一天删掉、换成陈旧/残缺的一小撮行，然后 exit 0。
//
// 原来唯一拦住这件事的是 scrape-daily.js 的非零退出 + package.json 的 `&&` 链；
// 第二轮把 && 链换成 run-refresh.mjs（一步失败不阻断后续）时，这个守卫的执行机制被拆掉了，
// 却没有在 sync 侧补上等价的检查。这个模块就是补上的那一半。
//
// 判定分三层，缺一不可：
//   1) 文件级：scrapedAt 的 **KL 日期** 不得早于本轮业务日；抓取窗口 dateRange[1] 同理。
//      —— 时区必须用 KL 而不是 UTC：23:00 KL = 15:00 UTC 同日，但 00:36 KL = 16:36 UTC 前一日，
//         按 UTC 日期比较会把「刚跑完的那一份」误判成陈旧。
//   2) 查询级：scrape-daily 会把每个查询的成败写进 queryStatus。消费方要重写哪张表，
//      就必须确认它依赖的那个查询当晚是 ok —— 「查询失败 -> 字段缺失 -> 静默 skip」这条链就此断掉。
//   3) 区间级：hourlyByDate / itemsByDateHour / itemWaste 是三个独立数组，
//      日期覆盖范围可以不同（itemWaste 很多天本来就一行没有），所以逐段判定，
//      不能用一句笼统的「daily.json 是新的」代替。

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DailyDataError extends Error {}

function fail(message) {
  throw new DailyDataError(message);
}

/** 数组里出现过的日期区间，仅用于把报错信息写得能直接排查。 */
export function dateCoverage(rows) {
  const dates = [...new Set((rows || []).map((r) => r?.date).filter(Boolean))].sort();
  return { dates, first: dates[0] || null, last: dates[dates.length - 1] || null, count: dates.length };
}

/**
 * 文件级新鲜度。expectedDate 是本轮刷新锁定的业务日（REFRESH_BUSINESS_DATE / kualaLumpurDate）。
 * klDate 注入是为了单测能不依赖宿主时区。
 */
export function assertDailyFresh(daily, { expectedDate, file = 'daily.json', klDate }) {
  if (!ISO_DATE.test(expectedDate || '')) fail(`业务日参数非法：${expectedDate}`);
  if (!daily || typeof daily !== 'object' || Array.isArray(daily)) fail(`${file} 不是一个对象，拒绝使用`);

  const scrapedAt = daily.scrapedAt;
  if (!scrapedAt) fail(`${file} 没有 scrapedAt，无法证明它是本轮抓的（旧版产物？）`);
  const stamp = new Date(scrapedAt);
  if (Number.isNaN(stamp.getTime())) fail(`${file} 的 scrapedAt 无法解析：${scrapedAt}`);

  const scrapedKl = klDate(stamp);
  if (scrapedKl < expectedDate) {
    fail(
      `${file} 陈旧：scrapedAt=${scrapedAt}（KL ${scrapedKl}）早于业务日 ${expectedDate}；` +
        ` 今晚的 scrape-daily 没有产出正式文件（很可能写成了 daily.partial.json），拒绝用它重写数据库`,
    );
  }

  const range = Array.isArray(daily.dateRange) ? daily.dateRange : null;
  const windowEnd = range?.[1];
  if (!windowEnd) fail(`${file} 缺少 dateRange，无法确认它覆盖哪个业务日`);
  if (windowEnd < expectedDate) {
    fail(`${file} 的抓取窗口 ${range.join(' .. ')} 未覆盖业务日 ${expectedDate}`);
  }

  return { scrapedKl, windowEnd };
}

/**
 * 单个数组段的可用性。
 *   requireExpectedDate=true  —— 该段必须含有业务日当天的数据（hourlyByDate / itemsByDateHour）。
 *   requireExpectedDate=false —— 只要求「查询成功且字段存在」（itemWaste：某天真的零报损很正常，
 *                                 强行要求当天有行会把正常之夜判成失败）。
 *
 * classifyMissingDate（可选）—— 当天缺失时的第二意见，见 lib/zero-day.js。
 * 传了它就不再无条件抛错：它裁定为 'closed'（多个独立来源证明当天真的零流水）时返回
 * expectedDateStatus='closed'，其余情况返回 'missing'（由调用方决定「先写其他天、再记 PARTIAL」）。
 * 不传时保持老行为（直接抛 DailyDataError），因为「没有第二意见就不许猜」。
 */
export function assertDailySection(
  daily,
  section,
  { expectedDate, requireExpectedDate = true, file = 'daily.json', classifyMissingDate = null } = {},
) {
  const status = daily?.queryStatus?.[section];
  if (status && status !== 'ok') {
    fail(`${file} 的 ${section} 查询当晚失败（queryStatus=${status}），拒绝用它 DELETE+INSERT 覆盖已有数据`);
  }

  const rows = daily?.[section];
  if (!Array.isArray(rows)) {
    fail(`${file} 缺少 ${section} 数组（查询失败或产物残缺），拒绝用它重写数据库`);
  }

  if (!requireExpectedDate) return { rows, expectedDateStatus: 'not-required', verdict: null };

  const cov = dateCoverage(rows);
  if (cov.dates.includes(expectedDate)) return { rows, expectedDateStatus: 'present', verdict: null };

  const where = `${file} 的 ${section} 不含业务日 ${expectedDate}（${rows.length} 行，覆盖 ${cov.first || '空'} .. ${cov.last || '空'}）`;
  if (!classifyMissingDate) fail(`${where}，拒绝用它重写数据库`);

  const verdict = classifyMissingDate();
  if (verdict?.verdict === 'closed') {
    return { rows, expectedDateStatus: 'closed', verdict };
  }
  return {
    rows,
    expectedDateStatus: 'missing',
    verdict,
    missingReason: `${where}，且无法证明当天是零流水日（${verdict?.reason || '没有可用的判定结果'}）`,
  };
}

/**
 * 消费方的统一入口：读文件 -> 文件级新鲜度 -> 段级可用性。
 * 文件级/查询级不满足一律抛 DailyDataError（由 sync-to-db 的 runStep 记成该步失败）；
 * 「只缺业务日当天」这一种情况交给 classifyMissingDate 定性，见上。
 */
export function loadDailySection(
  file,
  section,
  { expectedDate, requireExpectedDate = true, fs, klDate, classifyMissingDate = null },
) {
  if (!fs.existsSync(file)) {
    fail(`${file} 不存在：今晚的 scrape-daily 没有产出正式文件，拒绝重写数据库`);
  }
  let daily;
  try {
    daily = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`${file} 解析失败（${e.message}），拒绝重写数据库`);
  }
  assertDailyFresh(daily, { expectedDate, file, klDate });
  const section_ = assertDailySection(daily, section, {
    expectedDate,
    requireExpectedDate,
    file,
    classifyMissingDate,
  });
  return { daily, ...section_ };
}
