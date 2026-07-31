// Restosuite 后台调用的公共底座：借会话 → 拿 vulcan-token → POST → 校验 code → 分页。
//
// 为什么要抽出来：这段「开一个页把 vulcan-token 借出来，再在页面上下文里 fetch」的代码
// 现在在 scrape-daily.js / scrape-items-by-hour.js / scrape-intraday.mjs 里各写了一份，
// 三份的分页与失败处理还不一样（scrape-daily 根本没分页）。每加一个新脚本就再抄一份，
// 抄漏的那一条永远是「顶到 pageSize 却当成完整结果」——也就是静默截断。
//
// 这里定死三件事：
//   1. 拿不到 vulcan-token = 会话过期，抛 PosSessionError，调用方 exit 2（wrapper 会重登录）。
//   2. code !== '000' 一律抛 PosQueryError，绝不返回半截数据让调用方自己判断。
//   3. 分页顶到 pageSize 上限（maxPages）时抛错，不是 warn 后 break —— 截断的结果
//      长得和完整结果一模一样，只能在这里挡住。
//
// 注意：本文件不做任何 PII 处理。报表行里含 D_customerName/D_customerPhone 等字段，
// 落盘前必须自己过 lib/pii-guard.js。

import { chromium } from 'playwright';
import fs from 'node:fs';

export const DEFAULT_BASE = 'https://bo.sea.restosuite.ai';
export const REPORT_QUERY_PATH = '/api/report/data/queryData';
export const DEFAULT_SHOP_ID = '406994127';
export const DEFAULT_CORPORATION_ID = '450020844';

/** 会话失效（storageState 过期 / 借不到 vulcan-token）。调用方应 exit 2。 */
export class PosSessionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PosSessionError';
    this.exitCode = 2;
  }
}

/** 接口返回了非成功 code，或分页被截断。调用方应 exit 3。 */
export class PosQueryError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'PosQueryError';
    this.exitCode = 3;
    this.detail = detail;
  }
}

/** 报表单元格 { value, displayValue } -> value；其它原样。 */
export function flattenCell(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && ('displayValue' in v || 'abbrDisplayValue' in v)) {
    return v.value;
  }
  return v;
}

export function flattenRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = flattenCell(v);
  return out;
}

/**
 * 开一个已登录的页面并把真实请求头（含 vulcan-token）借出来。
 * warmupPath 必须是一个真的会发 XHR 的后台页面，否则借不到 token。
 */
export async function openAuthedPage({
  base = DEFAULT_BASE,
  storageState = 'storageState.json',
  warmupPath = '/report/report-sales-breakdown',
  shopId = process.env.SHOP_ID || DEFAULT_SHOP_ID,
  headless = true,
  settleMs = 5000,
  gotoTimeoutMs = 60_000,
  log = console.log,
} = {}) {
  if (!fs.existsSync(storageState)) {
    throw new PosSessionError(`${storageState} 不存在，先跑 npm run login`);
  }
  const browser = await chromium.launch({ headless });
  let page;
  try {
    const ctx = await browser.newContext({ storageState });
    page = await ctx.newPage();
    let authHeaders = null;
    let shopIdFromHeaders = null;
    page.on('request', (r) => {
      const h = r.headers();
      if (!authHeaders && h['vulcan-token']) authHeaders = h;
      if (!shopIdFromHeaders && h['shop-id']) shopIdFromHeaders = h['shop-id'];
    });
    await page.goto(`${base}${warmupPath}`, { waitUntil: 'domcontentloaded', timeout: gotoTimeoutMs });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(settleMs);
    if (!authHeaders) {
      throw new PosSessionError(`在 ${warmupPath} 上没有捕获到 vulcan-token —— 会话多半已过期，跑 npm run login`);
    }
    if (!authHeaders['shop-id']) authHeaders['shop-id'] = shopIdFromHeaders || shopId;
    log(`[report-client] 会话就绪 (warmup=${warmupPath} shop-id=${authHeaders['shop-id']})`);
    const call = createApiCaller({ page, base, authHeaders });
    return {
      browser,
      page,
      authHeaders,
      shopId: authHeaders['shop-id'],
      call,
      close: () => browser.close(),
    };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

/** 在页面上下文里发 POST（带上真实请求头与 cookie），返回 { status, body }。 */
export function createApiCaller({ page, base = DEFAULT_BASE, authHeaders }) {
  return async function call(apiPath, payload) {
    return page.evaluate(
      async ({ url, body, origHeaders }) => {
        const forbidden = new Set(['host', 'connection', 'content-length', 'cookie']);
        const headers = {};
        for (const [k, v] of Object.entries(origHeaders || {})) {
          if (!forbidden.has(k.toLowerCase())) headers[k] = v;
        }
        headers['content-type'] = 'application/json';
        headers['accept'] = 'application/json, text/plain, */*';
        const r = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
        const text = await r.text();
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text.slice(0, 500) };
        }
        return { status: r.status, body: parsed };
      },
      { url: base + apiPath, body: payload, origHeaders: authHeaders }
    );
  };
}

/** code==='000' 才算成功；401 单独识别成会话失效（退出码不同）。 */
export function assertOk(res, label) {
  const code = res?.body?.code;
  const msg = res?.body?.msg;
  if (res?.status === 401 || code === '401') {
    throw new PosSessionError(`${label}: HTTP ${res.status} code=${code} —— 会话已失效`);
  }
  if (res?.status !== 200 || code !== '000') {
    throw new PosQueryError(`${label}: status=${res?.status} code=${code} msg=${msg || ''}`, {
      status: res?.status,
      code,
      msg,
    });
  }
  return res.body;
}

/**
 * 报表引擎分页拉全量。
 * body 形态（实机验证）：{ reportId, selectFields, filters:[{fieldName,filterType,filterValue}], page:{pageNo,pageSize} }
 * 返回 { rows(已 flatten), pages, total }。任何一页失败或顶到 maxPages 都抛错，不返回半截结果。
 */
export async function fetchReportRows(
  call,
  {
    reportId,
    selectFields,
    filters = [],
    orderBy = [],
    pageSize = 2000,
    maxPages = 60,
    label = `report ${reportId}`,
    log = console.log,
    // 拉完后行数必须等于引擎自报的 total。默认开着：分页少一页与拉全了长得一模一样。
    expectTotal = true,
  }
) {
  const rows = [];
  let pageNo = 1;
  let total = null;
  while (true) {
    const body = {
      reportId: String(reportId),
      selectFields,
      metricsByDimQryV2: [],
      aggFilters: [],
      proportionProperty: { enable: false },
      dimAdditionalStrategy: [],
      filters,
      page: { pageNo, pageSize },
      ...(orderBy.length ? { orderBy } : {}),
    };
    const res = await call(REPORT_QUERY_PATH, body);
    const ok = assertOk(res, `${label} page ${pageNo}`);
    const pageRows = ok?.data?.rows || ok?.data?.list || [];
    total = ok?.data?.page?.total ?? ok?.data?.total ?? total;
    rows.push(...pageRows.map(flattenRow));
    log(`[report-client] ${label} page ${pageNo}: ${pageRows.length} 行（累计 ${rows.length}${total != null ? '/' + total : ''}）`);
    if (pageRows.length < pageSize) break;
    pageNo++;
    if (pageNo > maxPages) {
      // 「顶到上限就 break」等于把截断的结果当完整结果交出去 —— 必须炸。
      throw new PosQueryError(
        `${label}: 已到 maxPages=${maxPages}（每页 ${pageSize}），结果必然被截断，拒绝返回半截数据`,
        { pages: maxPages, pageSize, rows: rows.length, total }
      );
    }
  }
  if (expectTotal && total != null && rows.length !== Number(total)) {
    throw new PosQueryError(`${label}: 实收 ${rows.length} 行 ≠ 引擎自报 total=${total}，分页不完整`, {
      got: rows.length,
      total,
    });
  }
  return { rows, pages: pageNo, total };
}

/**
 * 报表引擎的**翻页不稳定**：同一条件连续翻 8 页，实测会出现跨页重复行 + 同等数量的漏行
 *（总行数仍然等于 total，所以计数校验发现不了）。单日/单月的查询则一页拉完、完全稳定。
 * -> 凡是可能超过一页的行级查询，一律按日期切块，每块自己一页拉完，绝不深翻页。
 * chunkDays 默认 31 天（实机近月 1,030~1,232 行/月，远低于 pageSize）。
 */
export async function fetchReportRowsByDateChunks(
  call,
  { from, to, chunkDays = 31, buildFilters, pageSize = 2000, label = 'report', log = console.log, ...rest }
) {
  const day = 24 * 60 * 60 * 1000;
  const parse = (s) => new Date(`${s}T00:00:00Z`).getTime();
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  const rows = [];
  const chunks = [];
  for (let start = parse(from); start <= parse(to); start += chunkDays * day) {
    const end = Math.min(start + (chunkDays - 1) * day, parse(to));
    const range = [fmt(start), fmt(end)];
    const res = await fetchReportRows(call, {
      ...rest,
      filters: buildFilters(range),
      pageSize,
      maxPages: 3, // 一块超过 3 页说明 chunkDays 定大了，宁可炸也别深翻页
      label: `${label} ${range[0]}..${range[1]}`,
      log: () => {},
    });
    rows.push(...res.rows);
    chunks.push({ range, rows: res.rows.length, total: res.total, pages: res.pages });
    log(`[report-client] ${label} ${range[0]}..${range[1]}: ${res.rows.length} 行（累计 ${rows.length}）`);
  }
  return { rows, chunks, total: chunks.reduce((a, c) => a + Number(c.total || 0), 0) };
}

/**
 * /crm/* 列表接口分页拉全量（信封是 data.list + data.page.total，与报表引擎不同）。
 * mergeBody 会与 { page: { pageNo, pageSize } } 合并。
 */
export async function fetchCrmList(
  call,
  apiPath,
  mergeBody = {},
  { pageSize = 500, maxPages = 60, label = apiPath, log = console.log } = {}
) {
  const items = [];
  let pageNo = 1;
  let total = null;
  while (true) {
    const res = await call(apiPath, { ...mergeBody, page: { pageNo, pageSize } });
    const ok = assertOk(res, `${label} page ${pageNo}`);
    const list = ok?.data?.list || [];
    total = ok?.data?.page?.total ?? total;
    items.push(...list);
    log(`[report-client] ${label} page ${pageNo}: ${list.length} 条（累计 ${items.length}${total != null ? '/' + total : ''}）`);
    if (!list.length) break;
    if (total != null && items.length >= Number(total)) break;
    if (list.length < pageSize) break;
    pageNo++;
    if (pageNo > maxPages) {
      throw new PosQueryError(
        `${label}: 已到 maxPages=${maxPages}（每页 ${pageSize}），结果必然被截断`,
        { pages: maxPages, pageSize, items: items.length, total }
      );
    }
  }
  if (total != null && items.length !== Number(total)) {
    throw new PosQueryError(`${label}: 实收 ${items.length} 条 ≠ 接口自报 total=${total}，分页不完整`, {
      got: items.length,
      total,
    });
  }
  return { items, pages: pageNo, total };
}

/** 把 catch 到的错误翻译成退出码：会话 2 / 查询 3 / 其它 1。 */
export function exitCodeFor(err) {
  return Number.isInteger(err?.exitCode) ? err.exitCode : 1;
}
