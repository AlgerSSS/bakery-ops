// 每晚刷新的「步骤编排」纯逻辑：跑完所有步骤、聚合退出码。
//
// 为什么不再用 package.json 里的 `a && b && c`：
//   && 链的语义是「前一步失败 => 后面全不跑」，但这条链上的步骤彼此并不都有依赖关系。
//   sync-to-db 的第 2/3/4/5/8 步只读 output/daily/daily.json（scrape-daily.js 产出），
//   与 scrape.js 抓的三个报表页毫无关系。于是「sales-overview 一页坏掉」在 && 链下
//   等于「daily_sales_record / hourly_sales_summary / item_hourly_sales /
//   timeslot_sales_record / item_waste 当晚一行不写」—— 把「失败得响亮」放大成「整晚零写入」。
//
// 新语义：每步都跑（login 失败除外，后面全部依赖会话），各自记录退出码，最后聚合：
//   任一 critical 步骤失败 -> 整体 exit 1（daily-refresh.sh 的重试与告警照常触发）
//   只有 optional 步骤失败 -> exit 0，但日志里明确告警
//
// 这里放编排逻辑 + 一个可注入的 spawn runner（createSpawnRunner），
// 后者让「真的起子进程、超时被杀、退出码聚合」这些行为可以用假脚本单测，不必开浏览器。

import { spawn } from 'node:child_process';
import path from 'node:path';

/** 超时被杀的步骤统一用这个退出码，和脚本自己的 1/2/3 区分开（沿用 GNU timeout 的约定）。 */
export const TIMEOUT_EXIT_CODE = 124;

/**
 * 按序执行 steps。run(step) 返回该步的退出码（数字）。
 *
 * step: { name, critical, gate? }
 *   critical: 失败是否应让整体 exit 1
 *   gate:     失败是否应跳过后续所有步骤（只有 login 该置 true）
 */
export async function runSteps(steps, run) {
  const results = [];
  let gateFailure = null;

  for (const step of steps) {
    if (gateFailure) {
      results.push({
        name: step.name,
        critical: !!step.critical,
        status: 'skipped',
        code: null,
        reason: `${gateFailure} 失败，后续步骤全部依赖该会话`,
      });
      continue;
    }

    const started = Date.now();
    let code;
    try {
      code = await run(step);
    } catch (e) {
      // run() 自己炸了（spawn 失败等）也算这一步失败，不能把整个 runner 带走。
      code = 1;
      console.error(`[refresh] ${step.name} 无法启动: ${e.message}`);
    }
    const status = code === 0 ? 'ok' : 'failed';
    results.push({
      name: step.name,
      critical: !!step.critical,
      status,
      code,
      durationMs: Date.now() - started,
    });
    if (status === 'failed' && step.gate) gateFailure = step.name;
  }

  return results;
}

/** 聚合退出码：critical 失败（或被 gate 跳过的 critical 步骤）才 exit 1。 */
export function summarizeSteps(results) {
  const failed = results.filter((r) => r.status === 'failed');
  const skipped = results.filter((r) => r.status === 'skipped');
  const failedCritical = failed.filter((r) => r.critical);
  const failedOptional = failed.filter((r) => !r.critical);
  // 被 gate 跳过的 critical 步骤同样算「今晚没写成」，必须计入退出码 ——
  // 否则 login 之后全部跳过反而 exit 0。
  const skippedCritical = skipped.filter((r) => r.critical);

  return {
    exitCode: failedCritical.length || skippedCritical.length ? 1 : 0,
    failedCritical,
    failedOptional,
    skipped,
    skippedCritical,
    ok: results.filter((r) => r.status === 'ok'),
  };
}

/**
 * L1：--only / --skip 的步骤名必须真实存在。
 * 上一轮的失败注入演练正是用这两个开关做的，拼错时静默跳过 0 个步骤 =「演练看起来通过了」。
 */
export function selectSteps(steps, { only = null, skip = [] } = {}) {
  const known = new Set(steps.map((s) => s.name));
  const unknown = [...(only || []), ...skip].filter((n) => !known.has(n));
  if (unknown.length) {
    return {
      selected: [],
      error:
        `未知步骤名: ${unknown.join(', ')}\n` +
        `  可用步骤: ${[...known].join(', ')}`,
    };
  }
  const skipSet = new Set(skip);
  const selected = steps.filter((s) => (only ? only.includes(s.name) : true) && !skipSet.has(s.name));
  if (!selected.length) {
    return { selected: [], error: '没有可执行的步骤（--only/--skip 把所有步骤都排除了）' };
  }
  return { selected, error: null };
}

/**
 * M3：下一次尝试该重跑哪些步骤。
 * 整条链重跑一遍要 20 分钟起，而绝大多数失败只坏在一两步上；
 * 但重跑集合不能只有失败的那些：
 *   - login 必须带上，后面每一步都要会话；
 *   - sync-to-db 必须带上，否则「上游修好了但没人把它写进库」。
 * 返回值保持声明顺序，供 `--only=` 直接使用。
 */
export function retrySelection(results, steps) {
  const broken = results.filter((r) => r.critical && (r.status === 'failed' || r.status === 'skipped'));
  if (!broken.length) return [];
  const want = new Set(broken.map((r) => r.name));
  want.add('login');
  want.add('sync-to-db');
  return steps.filter((s) => want.has(s.name)).map((s) => s.name);
}

/**
 * 真正起子进程的 runner。之所以带超时：
 *   goto 30s->60s + 新增 45s 条件等待 + 每页 3 次重试，让 scrape.js 的坏会话之夜从最坏
 *   3.3 分钟涨到 ~19 分钟；再乘以 shell 的整链重试，23:00 起跑能逼近 1 小时、堆出一大把 chromium。
 * 单步超时把每一步的墙钟封死，deadlineAt 再把整轮封死。
 *
 * 杀进程用「进程组」：脚本是 node，chromium 是它的子进程；只杀 node 会把 chromium 留在机器上。
 * 先 SIGTERM（playwright 默认 handleSIGTERM，会关掉浏览器），宽限期后再 SIGKILL。
 */
export function createSpawnRunner({
  cwd,
  execPath = process.execPath,
  defaultTimeoutMs = 5 * 60_000,
  timeouts = {},
  deadlineAt = null,
  killGraceMs = 10_000,
  env = process.env,
  log = console.log,
  logError = console.error,
} = {}) {
  let current = null;
  const killTree = (child, signal) => {
    try {
      process.kill(-child.pid, signal); // 进程组：连 chromium 一起
    } catch {
      try { child.kill(signal); } catch { /* 已经退出了 */ }
    }
  };

  const runner = (step) =>
    new Promise((resolve) => {
      const stepBudget = timeouts[step.name] ?? defaultTimeoutMs;
      const remaining = deadlineAt ? deadlineAt - Date.now() : Infinity;
      const budget = Math.min(stepBudget, remaining);
      if (budget <= 0) {
        logError(`[refresh] ${step.name} 未执行：本轮总时长预算已用尽`);
        resolve(TIMEOUT_EXIT_CODE);
        return;
      }

      log(`\n---------- [refresh] ${step.name} (${step.script}) 预算 ${Math.round(budget / 1000)}s ----------`);
      const child = spawn(execPath, [path.join(cwd, step.script)], {
        cwd,
        stdio: 'inherit', // 日志和以前一样能逐行排查
        env,
        detached: true,   // 自成进程组，才能连子孙一起杀
      });
      current = child;

      let timedOut = false;
      let hardKill = null;
      const timer = setTimeout(() => {
        timedOut = true;
        logError(`[refresh] ${step.name} 超时（${Math.round(budget / 1000)}s），发送 SIGTERM`);
        killTree(child, 'SIGTERM');
        hardKill = setTimeout(() => {
          logError(`[refresh] ${step.name} SIGTERM 后仍未退出，SIGKILL`);
          killTree(child, 'SIGKILL');
        }, killGraceMs);
      }, budget);

      const finish = (code, signal) => {
        clearTimeout(timer);
        if (hardKill) clearTimeout(hardKill);
        current = null;
        // 被信号杀掉时 code 为 null，必须算失败，否则 OOM kill 会被当成成功。
        const exitCode = timedOut ? TIMEOUT_EXIT_CODE : code === null ? 1 : code;
        log(`[refresh] ${step.name} exit=${exitCode}${signal ? ` signal=${signal}` : ''}`);
        resolve(exitCode);
      };

      child.on('error', (e) => {
        logError(`[refresh] ${step.name} spawn 失败: ${e.message}`);
        finish(1, null);
      });
      child.on('close', finish);
    });

  // detached 的子进程不会跟着父进程收到终端信号，父进程被 Ctrl-C / systemd 停掉时要主动带走它。
  runner.killCurrent = (signal = 'SIGTERM') => {
    if (current) killTree(current, signal);
  };
  return runner;
}

/** 人类可读的收尾报告（数组，每行一条）。 */
export function formatSummary(results) {
  const s = summarizeSteps(results);
  const lines = ['', '========== refresh summary =========='];
  for (const r of results) {
    const mark = r.status === 'ok' ? 'OK  ' : r.status === 'skipped' ? 'SKIP' : 'FAIL';
    const tag = r.critical ? 'critical' : 'optional';
    const detail =
      r.status === 'failed'
        ? ` exit=${r.code}`
        : r.status === 'skipped'
          ? ` (${r.reason})`
          : ` ${Math.round((r.durationMs || 0) / 1000)}s`;
    lines.push(`  ${mark} ${r.name} [${tag}]${detail}`);
  }
  if (s.failedCritical.length) {
    lines.push(`[refresh] FAILED: 关键步骤失败 -> ${s.failedCritical.map((r) => r.name).join(', ')}`);
  }
  if (s.skippedCritical.length) {
    lines.push(`[refresh] FAILED: 关键步骤未执行 -> ${s.skippedCritical.map((r) => r.name).join(', ')}`);
  }
  if (s.failedOptional.length) {
    lines.push(`[refresh] WARN: 可选步骤失败（不影响退出码）-> ${s.failedOptional.map((r) => r.name).join(', ')}`);
  }
  if (s.exitCode === 0 && !s.failedOptional.length) lines.push('[refresh] all steps ok');
  lines.push('=====================================');
  return lines;
}
