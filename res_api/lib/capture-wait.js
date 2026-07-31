// 报表请求捕获的「完备性判定」+「条件等待」。
//
// 抽成独立模块是为了可单测：scrape.js 是顶层 await 脚本，import 它就会真的去开浏览器。
//
// 谓词与 apply-translations.js 的 headlineMap 一一对应 —— 这几条决定 headline CSV 能否生成，
// headline CSV 又决定 daily_revenue / daily_payment_breakdown / daily_dining_breakdown 能否写全。
// 改了一边，test/capture-wait.test.js 会红。
//
// 按语义匹配而不是按条数：实测同一页会出 11 条或 10 条（页面重复发同一个查询的次数不固定），
// 用条数做门槛必然误判。

/** 一条捕获是否可用于 30 天重放：POST 报表查询 + filters 里带 D_businessDate。 */
export function isReplayable(c) {
  return (
    c.method === 'POST' &&
    !!c.reqBody &&
    /\/api\/report\/data\/(queryData|dataBlock)/.test(c.url) &&
    Array.isArray(c.reqBody.filters) &&
    c.reqBody.filters.some((f) => f.fieldName === 'D_businessDate')
  );
}

// 每个页面「期望」捕获到的请求。name 与 apply-translations.js 产出的 headline CSV 同名
// （去掉 .csv），便于对照排查。
//
// required 的判定标准必须与 apply-translations.js 的 REQUIRED_HEADLINES 严格一致：
// 只有「某张数据库表的唯一（或唯一精确）来源」才是 required。
//   sales_by_business_date  -> daily_revenue 精确源 + daily_payment_breakdown 唯一源
//   orders_by_dining_option -> daily_dining_breakdown 唯一源
// 其余（kpi_overview_core / kpi_summary_totals / items_totals / items_by_category）
// 只喂 server.js 的只读 REST 接口，没有任何入库表依赖它们。
// 之前把它们也列为 required，等于在捕获层把 apply-translations 那边「收敛到 2 个必需
// headline」的风险控制又抵消掉了 —— 尤其 sales-summary 页实测只有 2 条 replayable，
// 两条都算必需时任何一条抖动都会让整晚零写入。
//
// required=false 不等于「不等」：waitForRequiredCaptures 仍会等它们到齐才收网
// （kpi_overview_core 兼任「页面是否真的渲染完」的信号，也避免提前收网漏掉附带查询），
// 只是等不到时只 warn、不判死。
export const PAGE_CAPTURES = {
  'sales-overview': [
    {
      name: 'kpi_overview_core',
      required: false,
      match: (b) =>
        b.reportId === '123' &&
        !b.page &&
        b.selectFields?.includes('M_Order_SUM_netSales') &&
        !b.selectFields?.includes('D_shopName'),
    },
    {
      name: 'orders_by_dining_option',
      required: true,
      match: (b) => b.reportId === '123' && b.selectFields?.includes('D_diningOption'),
    },
  ],
  'sales-summary': [
    {
      name: 'kpi_summary_totals',
      required: false,
      match: (b) => b.reportId === '888001' && !b.selectFields?.includes('D_businessDate'),
    },
    {
      name: 'sales_by_business_date',
      required: true,
      match: (b) => b.reportId === '888001' && b.selectFields?.includes('D_businessDate'),
    },
  ],
  'items-breakdown': [
    {
      name: 'items_totals',
      required: false,
      match: (b) => b.reportId === '211' && !b.selectFields?.includes('D_category'),
    },
    {
      name: 'items_by_category',
      required: false,
      match: (b) => b.reportId === '211' && b.selectFields?.includes('D_category'),
    },
  ],
};

const safeMatch = (m, b) => {
  try {
    return !!m(b);
  } catch {
    return false;
  }
};

/** 这条请求体命中了哪个声明项（命中多个时返回第一个），没命中返回 null。返回整条 spec。 */
export function matchCapture(reqBody, specs = []) {
  if (!reqBody) return null;
  return specs.find((r) => safeMatch(r.match, reqBody)) || null;
}

/** 已捕获的 body 里还缺哪些声明项（返回 name 数组，保持声明顺序）。 */
export function missingCaptures(captured, specs = []) {
  const bodies = captured.filter(isReplayable).map((c) => c.reqBody);
  return specs.filter((r) => !bodies.some((b) => safeMatch(r.match, b))).map((r) => r.name);
}

/** 缺失项里属于 required 的那些。只有它们才该让进程非 0 退出。 */
export function missingRequiredCaptures(captured, specs = []) {
  const requiredOnly = specs.filter((s) => s.required);
  return missingCaptures(captured, requiredOnly);
}

/**
 * 这一轮 goto 的成果够不够，够就不再重试（scrape.js 的重试条件）。
 *
 * 判定必须用 missingRequired 而不是 missing：第二轮把 kpi_overview_core / kpi_summary_totals /
 * items_totals / items_by_category 降级成 optional，只降在 fail() 判定上；重试条件若仍按
 * 「全部声明项到齐」，任一 optional 项没发出来就会耗满 timeoutMs=45s × 3 次 goto =
 * 每页白烧 2.5 分钟，而最终判定只是 warn + exit 0 —— 正常之夜从 20 秒变几分钟，还没人会发现。
 *
 * capturedReplayable 是兜底：一个 required 项都没声明的页面（items-breakdown）如果这一轮
 * 什么都没抓到，那是页面真的坏了，仍然值得重试 —— 否则「重试 3 次」退化成「试一次就放弃」。
 */
export function pageCaptureSatisfied(waitResult, capturedReplayable) {
  if (!waitResult) return false;
  return !waitResult.missingRequired.length && capturedReplayable > 0;
}

/**
 * 条件等待，取代 `await page.waitForTimeout(6000)`。
 *
 * 满足「等满 minWaitMs + 声明项全到齐 + 无在途响应体 + 静默 quietMs」就立刻返回；
 * 否则等到 timeoutMs。
 *
 * minWaitMs 是原来那句 `waitForTimeout(6000)` 的下限保留：页面上还有若干「非必需但有用」
 * 的查询（payment_by_payer_type / items_by_dish_unit_30d）不在声明清单里，提前收网会把
 * 它们漏掉。新逻辑因此只会等得更久，绝不会比原来抓得少。
 *
 * getPending() 让在途的 `await response.text()` 也被算进去 —— 这是「有时 11 条有时 10 条」
 * 的根因之一：不是页面没发，是快照取早了。
 *
 * optionalGraceMs 是对「可选声明项永远不来」的兜底（HIGH-2 的另一半）：
 * required 已齐、页面也已静默，却还缺某个 optional 项时，再宽限 optionalGraceMs 就收网。
 * 否则整整 timeoutMs=45s 会被白烧，而这一页最终只是 warn —— 正常之夜每页多花 2.5 分钟。
 * 「等到所有声明项到齐」这个更稳的行为并没有丢：只要 optional 项在这段宽限里到达，
 * 走的仍是「全到齐」分支；到不了才收网，且只在页面已经静默（无新捕获、无在途 body）之后。
 *
 * settleGraceMs 是对「静默永远不来」的兜底：若页面上有长轮询 / 秒级心跳 JSON，
 * captured.length 会一直增长、getPending() 也可能一直非 0，于是 quiet 条件永不成立、
 * ok 永远 false —— 声明项其实早就齐了，却被判成「整晚零写入」。改动前的固定等待对此免疫，
 * 不能因为换了条件等待反而引入新的整晚失败模式。所以：声明项齐了并且已过 minWaitMs，
 * 再宽限 settleGraceMs 还没静默下来，就照样收网（settled=false 只作为日志线索）。
 */
export async function waitForRequiredCaptures(
  page,
  {
    getCaptured,
    getPending = () => 0,
    required = [],
    timeoutMs = 45000,
    minWaitMs = 0,
    quietMs = 1500,
    pollMs = 250,
    settleGraceMs = 10000,
    optionalGraceMs = 5000,
    // 注入时钟：让「默认宽限期到底是多少」这件事可以被虚拟时间测出来，
    // 而不是让单测真的空转 5 秒（真等 5 秒的测试没人愿意留，于是默认值就没人守）。
    now = Date.now,
  } = {}
) {
  const specs = required;
  const start = now();
  const deadline = start + timeoutMs;
  let lastCount = -1;
  let quietSince = start;
  let allPresentSince = null;
  let requiredPresentSince = null;

  const done = (settled) => {
    const captured = getCaptured();
    return {
      ok: true,
      settled,
      missing: missingCaptures(captured, specs),
      missingRequired: missingRequiredCaptures(captured, specs),
      waitedMs: now() - start,
      capturedCount: captured.length,
    };
  };

  while (now() < deadline) {
    const captured = getCaptured();
    if (captured.length !== lastCount) {
      lastCount = captured.length;
      quietSince = now();
    }
    const missing = missingCaptures(captured, specs);
    if (missing.length === 0) {
      if (allPresentSince === null) allPresentSince = now();
    } else {
      allPresentSince = null;
    }
    const missingReq = missingRequiredCaptures(captured, specs);
    if (missingReq.length === 0) {
      if (requiredPresentSince === null) requiredPresentSince = now();
    } else {
      requiredPresentSince = null;
    }

    const pastMinWait = now() - start >= minWaitMs;
    const quiet = getPending() === 0 && now() - quietSince >= quietMs;
    if (missing.length === 0 && pastMinWait) {
      if (quiet) return done(true);
      // 长轮询/心跳导致的「永不静默」兜底。
      if (now() - allPresentSince >= settleGraceMs) return done(false);
    }
    // required 已齐 + 页面已静默 + 宽限期已过 => 不再为迟迟不来的 optional 项烧满 timeoutMs。
    if (
      missingReq.length === 0 &&
      pastMinWait &&
      quiet &&
      now() - requiredPresentSince >= optionalGraceMs
    ) {
      return done(true);
    }
    await page.waitForTimeout(pollMs);
  }

  const captured = getCaptured();
  return {
    ok: false,
    settled: false,
    missing: missingCaptures(captured, specs),
    missingRequired: missingRequiredCaptures(captured, specs),
    waitedMs: now() - start,
    capturedCount: captured.length,
  };
}
