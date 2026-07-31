import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  isReplayable,
  matchCapture,
  missingCaptures,
  missingRequiredCaptures,
  PAGE_CAPTURES,
  pageCaptureSatisfied,
  waitForRequiredCaptures,
} from '../lib/capture-wait.js';

const cap = (reqBody) => ({
  method: 'POST',
  url: 'https://bo.sea.restosuite.ai/api/report/data/queryData',
  reqBody,
});
const withDate = (b) => ({
  ...b,
  filters: [{ fieldName: 'D_businessDate', filterType: 'RANGE', filterValue: ['2026-07-01', '2026-07-30'] }],
});

// 下面的 selectFields 取自 output/sales/*/raw 里 2026-07-04 的真实抓包，别随手改。
const SUMMARY_TOTALS = withDate({
  reportId: '888001',
  selectFields: ['M_Order_COUNT_Orders', 'M_Order_SUM_guests', 'M_Order_SUM_netSales_MultiTaxSys'],
});
const SUMMARY_BY_DATE = withDate({
  reportId: '888001',
  page: { pageNo: 1, pageSize: 100 },
  selectFields: ['D_businessDate', 'D_shopName', 'M_Order_COUNT_Orders'],
});
const OVERVIEW_CORE = withDate({
  reportId: '123',
  selectFields: ['M_Order_SUM_netSales', 'M_Order_SUM_totalGrossSales', 'M_Order_SUM_guests', 'M_Order_COUNT_Orders'],
});
const OVERVIEW_DINING = withDate({
  reportId: '123',
  page: { pageNo: 1, pageSize: 100 },
  selectFields: ['M_Order_COUNT_Orders', 'D_diningOption'],
});

test('没有 D_businessDate 过滤条件的请求不算可重放', () => {
  assert.equal(isReplayable(cap({ reportId: '888001', filters: [] })), false);
});

test('GET 或非报表接口不算可重放', () => {
  assert.equal(isReplayable({ ...cap(SUMMARY_TOTALS), method: 'GET' }), false);
  assert.equal(
    isReplayable({ ...cap(SUMMARY_TOTALS), url: 'https://bo.sea.restosuite.ai/vulcan/profile/getInfo' }),
    false,
  );
});

test('真实抓包的 888001 两条请求都能被识别为可重放', () => {
  assert.equal(isReplayable(cap(SUMMARY_TOTALS)), true);
  assert.equal(isReplayable(cap(SUMMARY_BY_DATE)), true);
});

test('sales-summary 少了按日拆分那条 -> 报缺，且属于必需', () => {
  const specs = PAGE_CAPTURES['sales-summary'];
  assert.deepEqual(missingCaptures([cap(SUMMARY_TOTALS)], specs), ['sales_by_business_date']);
  assert.deepEqual(missingRequiredCaptures([cap(SUMMARY_TOTALS)], specs), ['sales_by_business_date']);
});

test('sales-summary 只少 kpi_summary_totals -> 报缺但不是必需（不该让整晚零写入）', () => {
  const specs = PAGE_CAPTURES['sales-summary'];
  assert.deepEqual(missingCaptures([cap(SUMMARY_BY_DATE)], specs), ['kpi_summary_totals']);
  assert.deepEqual(missingRequiredCaptures([cap(SUMMARY_BY_DATE)], specs), []);
});

test('sales-overview 只少 kpi_overview_core -> 非必需；少 dining -> 必需', () => {
  const specs = PAGE_CAPTURES['sales-overview'];
  assert.deepEqual(missingRequiredCaptures([cap(OVERVIEW_DINING)], specs), []);
  assert.deepEqual(missingCaptures([cap(OVERVIEW_DINING)], specs), ['kpi_overview_core']);
  assert.deepEqual(missingRequiredCaptures([cap(OVERVIEW_CORE)], specs), ['orders_by_dining_option']);
});

test('items-breakdown 整页没有任何必需项（它只喂只读 REST 接口）', () => {
  assert.deepEqual(missingRequiredCaptures([], PAGE_CAPTURES['items-breakdown']), []);
});

test('捕获层的必需清单与 apply-translations 的 REQUIRED_HEADLINES 严格一致', () => {
  // 两边不一致就会重演 MEDIUM-1：捕获层多要求几条，等于把 apply 那边
  // 「只有 2 个 headline 是必需」的风险控制在上游又抵消掉。
  const src = readFileSync(new URL('../apply-translations.js', import.meta.url), 'utf8');
  const block = src.match(/const REQUIRED_HEADLINES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, '没能在 apply-translations.js 里找到 REQUIRED_HEADLINES');
  const applyRequired = [...block[1].matchAll(/'([^']+)\.csv'/g)].map((m) => m[1]).sort();

  const captureRequired = Object.values(PAGE_CAPTURES)
    .flat()
    .filter((s) => s.required)
    .map((s) => s.name)
    .sort();

  assert.deepEqual(captureRequired, applyRequired);
  assert.deepEqual(applyRequired, ['orders_by_dining_option', 'sales_by_business_date']);
});

test('sales-overview 的 KPI 与就餐方式两条谓词互不串门', () => {
  const specs = PAGE_CAPTURES['sales-overview'];
  assert.equal(matchCapture(OVERVIEW_CORE, specs).name, 'kpi_overview_core');
  assert.equal(matchCapture(OVERVIEW_CORE, specs).required, false);
  assert.equal(matchCapture(OVERVIEW_DINING, specs).name, 'orders_by_dining_option');
  assert.equal(matchCapture(OVERVIEW_DINING, specs).required, true);
  assert.deepEqual(missingCaptures([cap(OVERVIEW_CORE), cap(OVERVIEW_DINING)], specs), []);
});

test('带 D_shopName 的 123 报表不能冒充 kpi_overview_core', () => {
  const shopBreakdown = withDate({
    reportId: '123',
    page: { pageNo: 1, pageSize: 100 },
    selectFields: ['D_shopName', 'M_Order_SUM_netSales', 'M_Order_COUNT_Orders'],
  });
  assert.equal(matchCapture(shopBreakdown, PAGE_CAPTURES['sales-overview']), null);
});

test('匹配谓词抛异常时按未命中处理，不冒泡', () => {
  const boom = [{ name: 'boom', required: true, match: () => { throw new Error('nope'); } }];
  assert.deepEqual(missingCaptures([cap(SUMMARY_TOTALS)], boom), ['boom']);
  assert.equal(matchCapture(SUMMARY_TOTALS, boom), null);
});

test('声明项到齐且静默后立即返回 ok=true', async () => {
  const fakePage = { waitForTimeout: async () => {} };
  const captured = [cap(SUMMARY_TOTALS), cap(SUMMARY_BY_DATE)];
  const r = await waitForRequiredCaptures(fakePage, {
    getCaptured: () => captured,
    required: PAGE_CAPTURES['sales-summary'],
    timeoutMs: 2000,
    quietMs: 0,
    pollMs: 1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.settled, true);
  assert.equal(r.capturedCount, 2);
  assert.deepEqual(r.missingRequired, []);
});

test('minWaitMs 是下限：声明项已齐也不会提前于原 6s 收网', async () => {
  let slept = 0;
  const fakePage = { waitForTimeout: async (ms) => { slept += ms; } };
  const captured = [cap(SUMMARY_TOTALS), cap(SUMMARY_BY_DATE)];
  const r = await waitForRequiredCaptures(fakePage, {
    getCaptured: () => captured,
    required: PAGE_CAPTURES['sales-summary'],
    timeoutMs: 5000,
    minWaitMs: 40,
    quietMs: 0,
    pollMs: 5,
  });
  assert.equal(r.ok, true);
  assert.ok(r.waitedMs >= 40, `waitedMs=${r.waitedMs} 应不小于 minWaitMs`);
  assert.ok(slept > 0, '应至少轮询过一次');
});

test('还有在途响应体时不算到齐（宽限期内）', async () => {
  const fakePage = { waitForTimeout: async () => {} };
  const captured = [cap(SUMMARY_TOTALS), cap(SUMMARY_BY_DATE)];
  const r = await waitForRequiredCaptures(fakePage, {
    getCaptured: () => captured,
    getPending: () => 1,
    required: PAGE_CAPTURES['sales-summary'],
    timeoutMs: 30,
    quietMs: 0,
    pollMs: 1,
    settleGraceMs: 60000,
  });
  assert.equal(r.ok, false);
});

test('长轮询/心跳导致永不静默时，声明项已齐仍会在宽限期后收网', async () => {
  // 页面上有秒级心跳 JSON：captured 一直增长、pending 一直非 0，
  // quiet 条件永远不成立。若不兜底，ok 会永远 false -> 整晚零写入。
  const fakePage = { waitForTimeout: async () => {} };
  const captured = [cap(SUMMARY_TOTALS), cap(SUMMARY_BY_DATE)];
  const r = await waitForRequiredCaptures(fakePage, {
    getCaptured: () => {
      captured.push(cap({ reportId: 'heartbeat' })); // 每次轮询都有新响应
      return captured;
    },
    getPending: () => 1, // 永远有在途
    required: PAGE_CAPTURES['sales-summary'],
    timeoutMs: 5000,
    quietMs: 1000,
    pollMs: 1,
    settleGraceMs: 20,
  });
  assert.equal(r.ok, true);
  assert.equal(r.settled, false, 'settled=false 保留「没真正静默」的日志线索');
  assert.deepEqual(r.missingRequired, []);
  assert.ok(r.waitedMs < 5000, '不该一直等到 timeoutMs');
});

test('捕获永远不齐时超时返回 ok=false 而不是永久挂起', async () => {
  const fakePage = { waitForTimeout: async () => {} };
  const r = await waitForRequiredCaptures(fakePage, {
    getCaptured: () => [],
    required: PAGE_CAPTURES['sales-summary'],
    timeoutMs: 50,
    quietMs: 0,
    pollMs: 5,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['kpi_summary_totals', 'sales_by_business_date']);
  assert.deepEqual(r.missingRequired, ['sales_by_business_date']);
});

// ---------- HIGH-2：required 齐了就别为 optional 烧满 timeoutMs ----------

test('只缺 optional 项时在宽限期后收网，不再耗满 timeoutMs（正常之夜每页省下 40s）', async () => {
  // 复现形态：sales-summary 只发出了 sales_by_business_date（required），
  // kpi_summary_totals（optional，第二轮降级的那批）迟迟不来。
  const fakePage = { waitForTimeout: async () => {} };
  const captured = [cap(SUMMARY_BY_DATE)];
  const r = await waitForRequiredCaptures(fakePage, {
    getCaptured: () => captured,
    required: PAGE_CAPTURES['sales-summary'],
    timeoutMs: 45000,     // 与 scrape.js 线上一致
    quietMs: 0,
    pollMs: 1,
    optionalGraceMs: 20,
  });

  assert.equal(r.ok, true, 'required 已齐就该收网，而不是超时返回 ok=false');
  assert.deepEqual(r.missing, ['kpi_summary_totals'], 'optional 缺失仍要如实上报（日志线索）');
  assert.deepEqual(r.missingRequired, []);
  assert.ok(r.waitedMs < 5000, `不该烧满 45s，实际 ${r.waitedMs}ms`);
});

test('optional 项在宽限期内到达时，走的仍是「全到齐」路径（更稳的行为没丢）', async () => {
  const fakePage = { waitForTimeout: async () => {} };
  const captured = [cap(SUMMARY_BY_DATE)];
  let polls = 0;
  const r = await waitForRequiredCaptures(fakePage, {
    getCaptured: () => {
      if (++polls === 3) captured.push(cap(SUMMARY_TOTALS)); // 晚到但在宽限期内
      return captured;
    },
    required: PAGE_CAPTURES['sales-summary'],
    timeoutMs: 5000,
    quietMs: 0,
    pollMs: 1,
    optionalGraceMs: 1000,
  });

  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, [], '等到了就该按「全到齐」收网');
  assert.equal(r.capturedCount, 2);
});

test('整页零个 required 项（items-breakdown）不会立刻收网：minWaitMs 仍是下限', async () => {
  const fakePage = { waitForTimeout: async (ms) => { await new Promise((r) => setTimeout(r, ms)); } };
  const r = await waitForRequiredCaptures(fakePage, {
    getCaptured: () => [],
    required: PAGE_CAPTURES['items-breakdown'], // 两条都是 optional
    timeoutMs: 5000,
    minWaitMs: 60,
    quietMs: 0,
    pollMs: 5,
    optionalGraceMs: 0,
  });

  assert.equal(r.ok, true);
  assert.deepEqual(r.missingRequired, []);
  assert.ok(r.waitedMs >= 60, `waitedMs=${r.waitedMs} 应不小于 minWaitMs（原来的固定 6s 下限）`);
  assert.ok(r.waitedMs < 5000, '也不该烧满 timeoutMs');
});

test('重试条件只看 missingRequired：optional 缺失不该再触发一轮 45s 的 goto', () => {
  // 行为断言（原来是拿正则扫 scrape.js 的源码，改坏判定照样绿）。
  const optionalMissing = { missingRequired: [], missing: ['kpi_summary_totals'], ok: true };
  assert.equal(pageCaptureSatisfied(optionalMissing, 7), true, 'required 已齐就该收，别为 optional 再烧 45s');

  const requiredMissing = { missingRequired: ['sales_by_business_date'], missing: ['sales_by_business_date'], ok: false };
  assert.equal(pageCaptureSatisfied(requiredMissing, 7), false, 'required 缺失必须重试');

  // items-breakdown 那种「整页零个 required」的形态：这一轮什么都没抓到时仍要重试，
  // 否则「重试 3 次」退化成「试一次就放弃」。
  assert.equal(pageCaptureSatisfied({ missingRequired: [], missing: ['items_totals'] }, 0), false);
  assert.equal(pageCaptureSatisfied(null, 5), false, 'goto 从没成功过（waitResult=null）必须重试');
});

// ---------- 默认宽限期本身也是行为：optionalGraceMs 不传时必须是 5 秒量级 ----------

/** 虚拟时钟：page.waitForTimeout 推进它，于是「等了多久」可以断言而不必真的空转。 */
function virtualClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    page: { waitForTimeout: async (ms) => { t += ms; } },
  };
}

test('不传 optionalGraceMs 时用默认值收网：约 5s 后返回，而不是烧满 45s 的 timeout', async () => {
  const { now, page } = virtualClock();
  const captured = [cap(SUMMARY_BY_DATE)]; // required 已齐，optional 永远不来

  const r = await waitForRequiredCaptures(page, {
    getCaptured: () => captured,
    required: PAGE_CAPTURES['sales-summary'],
    timeoutMs: 45000, // 与 scrape.js 线上一致
    quietMs: 0,
    pollMs: 250,
    now,
  });

  assert.equal(r.ok, true, '默认宽限期若被改大，这里会一路烧到 timeout 返回 ok=false');
  assert.deepEqual(r.missing, ['kpi_summary_totals']);
  assert.ok(r.waitedMs >= 5000, `默认宽限期不该小于 5s（实际 ${r.waitedMs}ms）—— 改小会把 optional 项抓漏`);
  assert.ok(r.waitedMs <= 6000, `默认宽限期不该大于 5s 量级（实际 ${r.waitedMs}ms）—— 改大等于每页白烧 40s`);
});

test('默认 settleGraceMs 同理：永不静默的页面在 10s 量级收网，不烧满 45s', async () => {
  const { now, page } = virtualClock();
  const captured = [cap(SUMMARY_TOTALS), cap(SUMMARY_BY_DATE)];

  const r = await waitForRequiredCaptures(page, {
    getCaptured: () => {
      captured.push(cap({ reportId: 'heartbeat' })); // 秒级心跳，captured 一直增长
      return captured;
    },
    getPending: () => 1, // 永远有在途 body
    required: PAGE_CAPTURES['sales-summary'],
    timeoutMs: 45000,
    pollMs: 250,
    now,
  });

  assert.equal(r.ok, true);
  assert.equal(r.settled, false);
  assert.ok(r.waitedMs >= 10000 && r.waitedMs <= 11000, `默认 settleGraceMs 应为 10s 量级，实际 ${r.waitedMs}ms`);
});
