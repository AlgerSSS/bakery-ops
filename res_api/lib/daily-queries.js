// scrape-daily.js 的「哪些查询是必需的 / 今晚谁失败了」的唯一判定处。
//
// 抽出来有两个原因：
//   1) scrape-daily.js 是顶层 await 的 playwright 脚本，import 它就会真的开浏览器，
//      于是那句 `if (REQUIRED_QUERIES.includes(name)) failedRequired.push(name)` 无法被行为测试
//      覆盖 —— 上一轮的变异测试正是在这里漏过（改坏也不红）。
//   2) 更重要的是去掉「两份真相」：原来 failedRequired 是在查询循环里边跑边 push 的，
//      而 queryStatus 是另一份记录并且会随 daily.json 落盘给 sync-to-db 消费。
//      两者可以悄悄不一致（漏 push / 名字写错 / 查询被从 queries 里删掉）。
//      现在 failedRequired 一律从 queryStatus 推导，落盘的那份就是判定依据本身。
//
// 必需清单必须对齐「真实消费方」，不能只凭直觉挑三个聚合查询：
//   hourlyByDate    -> sync 第 3 步 hourly_sales_summary（也是 daily_revenue 的降级源）
//   itemsByDateHour -> sync 第 2 步 daily_sales_record、第 4 步 item_hourly_sales，
//                      第 5 步 timeslot_sales_record 再从第 4 步的结果重建
//   itemWaste       -> sync 第 8 步 item_waste（唯一来源）
//   summary/hourly/items -> server.js /v1/daily/* 的正文
export const REQUIRED_QUERIES = ['summary', 'hourly', 'items', 'hourlyByDate', 'itemsByDateHour', 'itemWaste'];

/** 单个查询的成败判定。status 会原样落进 daily.json 的 queryStatus 供 sync-to-db 按段判定。 */
export function classifyQueryOutcome(response) {
  const ok = response?.status === 200 && response?.body?.code === '000';
  return {
    ok,
    status: ok ? 'ok' : `failed(status=${response?.status} code=${response?.body?.code})`,
  };
}

/**
 * 从落盘的 queryStatus 推导今晚的失败面。
 *   failedRequired —— 必需查询里失败的（含压根没跑到的：查询被误删/改名同样是事故）
 *   failedOptional —— 非必需查询里失败的（只 warn）
 * 返回顺序固定按 REQUIRED_QUERIES 声明顺序，日志可比对。
 */
export function summarizeQueryStatus(queryStatus = {}, { requiredQueries = REQUIRED_QUERIES } = {}) {
  const failedRequired = requiredQueries.filter((name) => queryStatus[name] !== 'ok');
  const failedOptional = Object.entries(queryStatus)
    .filter(([name, status]) => status !== 'ok' && !requiredQueries.includes(name))
    .map(([name]) => name);
  return { failedRequired, failedOptional };
}
