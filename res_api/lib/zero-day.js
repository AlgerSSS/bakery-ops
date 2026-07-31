// 「今天确实没有流水」与「今天的数据没抓到」的区分（本轮 P1）。
//
// 背景：上一轮给 daily.json 加的新鲜度守卫要求 hourlyByDate / itemsByDateHour 必须含业务日当天。
// 马来西亚公假、门店停业、POS 整天故障时，报表后台对零流水日**直接不返回该日期**，
// 于是第 1/2/3/4 步全 FAILED、第 5 步 SKIPPED，而且窗口里另外三天完好的数据也一起不写。
// 「宁可失败得响亮」在这里矫枉过正：把「今天没生意」误判成「抓取坏了」，还连累了好日子。
//
// 判定的第一原则：**行数为 0 不等于没生意**。抓取失败同样是 0 行 —— 这是全库最经典的陷阱，
// 所以「某个数组里没有当天」这件事本身**永远不构成证据**，只是提问的起点。
// 真正的证据必须满足四个条件，缺一不可：
//
//   1) 查询本身成功。scrape-daily 会把每个查询的成败写进 daily.json 的 queryStatus，
//      失败的源没有发言权（它的「没有当天」纯粹是失败的副产品）。
//   2) 这个源**确实问了**当天。每个源都带自己的请求窗口（daily.json 的 perDayRange /
//      dateRange）。窗口不含当天时，它的沉默只说明「没问过」。
//   3) 这个源是**活的**：同一窗口里至少有另一天是有流水的。
//      整窗口零行的源不是「连着停业四天」，是查询坏了 —— 它不许当证人。
//   4) 至少两个**互相独立**的源同时作证，且没有任何源反证。
//      独立性来自不同的报表：hourlyByDate 走 888001（订单口径），itemsByDateHour 走 211
//      （单品口径）。一个报表挂掉不会让另一个也恰好只缺当天。
//
// 反证（contradictor）只要一个就够，而且不需要窗口信息 —— 「某个源明确报出当天有流水」
// 是自证的。反证源额外用了两条与上面两个报表完全不同的链路：
//   - output/sales/readable/sales_by_business_date.csv：scrape.js 浏览器抓包 + 30 天重放
//     产出，与 scrape-daily 的 API 直调是两条独立管线。它有当天且非零，就说明
//     「后台有当天的数据，是我们的 per-day 查询没拿到」——这正是必须响亮失败的情形。
//   - itemWaste（报表 100280，报损模块）：当天有报损说明门店当天在运营且后台有当天的数据，
//     此时「一单都没有」只可能是 POS 坏了，同样必须响亮失败。
//
// 判不出来（unknown）时的语义是「拒绝断言」：当天不写，窗口里其他天照写，该步记 PARTIAL，
// 整体退出码仍为 1。绝不把「不确定」四舍五入成 0。
//
// 残留风险（明确记录，不掩饰）：如果报表后台**整体**还没算出当天（不只是我们的查询没拿到），
// 那么所有源都会一致地沉默，任何纯数据方法都无法与「真的停业」区分。此时会判成 closed 并
// 在 daily_revenue 写一行显式的 0。缓解来自增量窗口：per-day 明细默认重抓最近 4 天，
// 当天数据晚到时后面几晚会用 DELETE+INSERT / EXCLUDED 覆盖把它改回真值。

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 某一步「其他日期已写入，但业务日当天缺失且无法证明是零流水」时抛这个。
 * runStep 会把它记成 PARTIAL：数据已落盘的部分保留，整体仍非 0 退出。
 */
export class PartialStepError extends Error {
  constructor(message, { written = 0 } = {}) {
    super(message);
    this.name = 'PartialStepError';
    this.written = written;
  }
}

/**
 * 造一个「证人」。
 *   attestable=false 表示它只能反证、不能作证（窗口不可知或口径不对等，例如报损）。
 *   window=[from,to] 是这个源**实际请求**的日期区间，用于回答「它问过当天吗」。
 *   activeOf(row) 判断这一行是否代表「当天有生意」——只要有一行 active，该日期即被证明非零。
 */
export function buildWitness(
  name,
  { attestable = true, queryOk = false, window = null, rows = [], dateOf = (r) => r?.date, activeOf = () => true } = {},
) {
  const seen = new Set();
  const active = new Set();
  for (const row of rows || []) {
    const d = dateOf(row);
    if (!d || !ISO_DATE.test(String(d))) continue;
    seen.add(String(d));
    if (activeOf(row)) active.add(String(d));
  }
  return { name, attestable, queryOk: !!queryOk, window: window || null, seen, active };
}

function windowCovers(window, date) {
  return Array.isArray(window) && window.length === 2 && !!window[0] && !!window[1] && window[0] <= date && date <= window[1];
}

/**
 * 业务日当天到底是「零流水」还是「没抓到」。
 * 只在「某个 per-day 数组里没有当天」时才需要问这个问题。
 *
 * 返回 verdict：
 *   'present' —— 有源反证当天有流水：那么缺当天的那个数组是真的坏了，必须响亮失败。
 *   'closed'  —— 至少 minWitnesses 个独立、活着、问过当天的源一致报零，且无人反证。
 *   'unknown' —— 证据不足，拒绝断言。
 */
export function classifyBusinessDate(expectedDate, witnesses = [], { minWitnesses = 2 } = {}) {
  const detail = { attesting: [], contradicting: [], rejected: [] };
  if (!ISO_DATE.test(expectedDate || '')) {
    return { verdict: 'unknown', ...detail, reason: `业务日参数非法：${expectedDate}` };
  }

  for (const w of witnesses) {
    if (w.queryOk && w.active.has(expectedDate)) {
      detail.contradicting.push(w.name);
      continue;
    }
    if (!w.attestable) continue;
    if (!w.queryOk) {
      detail.rejected.push(`${w.name}=当晚查询失败`);
      continue;
    }
    if (!windowCovers(w.window, expectedDate)) {
      detail.rejected.push(`${w.name}=请求窗口 ${w.window ? w.window.join('..') : '未知'} 没问过当天`);
      continue;
    }
    // 「整窗口一行都没有」不是连着停业，是查询坏了：不许当证人。
    if (![...w.active].some((d) => d !== expectedDate)) {
      detail.rejected.push(`${w.name}=整窗口无任何有流水的日期，无法证明查询是活的`);
      continue;
    }
    detail.attesting.push(w.name);
  }

  if (detail.contradicting.length) {
    return {
      verdict: 'present',
      ...detail,
      reason: `${detail.contradicting.join('、')} 明确报出 ${expectedDate} 有流水，说明当天确有生意 —— 缺当天的那个源是抓取缺失`,
    };
  }
  if (detail.attesting.length >= minWitnesses) {
    return {
      verdict: 'closed',
      ...detail,
      reason:
        `${detail.attesting.join('、')} 共 ${detail.attesting.length} 个独立来源都问过 ${expectedDate} 且都报零，` +
        `各自窗口内其他日期均有流水（证明查询是活的），无任何来源反证`,
    };
  }
  return {
    verdict: 'unknown',
    ...detail,
    reason:
      `只有 ${detail.attesting.length} 个来源能为 ${expectedDate} 零流水作证（需要 ${minWitnesses} 个）` +
      (detail.rejected.length ? `；被排除的来源：${detail.rejected.join('，')}` : ''),
  };
}

/** 从 daily.json 造出本模块需要的四个证人。daily 为 null（文件不可用）时返回空数组。 */
export function dailyWitnesses(daily, { csvRows = null } = {}) {
  const out = [];
  if (daily && typeof daily === 'object') {
    const perDay = Array.isArray(daily.perDayRange) ? daily.perDayRange : daily.dateRange;
    const statusOf = (q) => daily.queryStatus?.[q] === 'ok';
    out.push(
      buildWitness('hourlyByDate(888001 订单)', {
        queryOk: statusOf('hourlyByDate'),
        window: perDay,
        rows: daily.hourlyByDate,
        activeOf: (r) => Number(r?.billCount) > 0 || Number(r?.netSales) !== 0 || Number(r?.grossSales) !== 0,
      }),
      buildWitness('itemsByDateHour(211 单品)', {
        queryOk: statusOf('itemsByDateHour'),
        window: perDay,
        rows: daily.itemsByDateHour,
        activeOf: (r) => Number(r?.qty) > 0 || Number(r?.netSales) !== 0 || Number(r?.grossSales) !== 0,
      }),
      // 报损与销售不同口径：当天有报损只能说明门店在运营、后台有当天的数据，
      // 不能反过来用「没报损」证明没生意。所以只反证、不作证。
      buildWitness('itemWaste(100280 报损)', {
        attestable: false,
        queryOk: statusOf('itemWaste'),
        window: perDay,
        rows: daily.itemWaste,
        activeOf: (r) => Number(r?.qty) > 0 || Number(r?.amount) !== 0,
      }),
    );
  }
  if (Array.isArray(csvRows)) {
    // scrape.js 抓包重放产出的 30 天日表：与 scrape-daily 的 API 直调是独立管线。
    // 但 sync-to-db 无法从 CSV 本身确认它请求的窗口（窗口写在 scrape.js 的重放请求体里），
    // 所以同样只反证、不作证。
    out.push(
      buildWitness('sales_by_business_date.csv(重放管线)', {
        attestable: false,
        queryOk: csvRows.length > 0,
        rows: csvRows,
        dateOf: (r) => r?.['Business Date'],
        activeOf: (r) =>
          Number(r?.['Net Sales']) !== 0 ||
          Number(r?.['Bill Count']) > 0 ||
          Number(r?.['Total Payment received']) !== 0,
      }),
    );
  }
  return out;
}
