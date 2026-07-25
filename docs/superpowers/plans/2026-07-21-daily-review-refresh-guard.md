# Daily Review Refresh Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale Restosuite replay files from suppressing the 23:30 daily review, while retaining a verified hourly-data fallback for the current business date.

**Architecture:** Generated scraper artifacts are reset before every run. A pure resolver selects the current-date Sales Summary row or builds an equivalent core revenue record from `hourlyByDate`; absence from both sources is fatal. The daily-review cron propagates missing-data failure to the existing audit wrapper.

**Tech Stack:** Node.js ESM, Node built-in test runner, TypeScript, Vitest, PostgreSQL, node-cron, systemd.

---

### Task 1: Lock generated-output and revenue-resolution behavior

**Files:**
- Create: `res_api/test/daily-refresh-guard.test.js`
- Create: `res_api/lib/generated-output.js`
- Create: `res_api/lib/daily-revenue-resolver.js`

- [ ] **Step 1: Write one failing Node test for generated-directory cleanup**

Create a temporary replay directory with an `old.json` file, call `resetGeneratedDirectory(dir)`, and assert that the directory exists and is empty.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test res_api/test/daily-refresh-guard.test.js`

Expected: FAIL because `generated-output.js` does not exist.

- [ ] **Step 3: Implement the generated-output helper**

Implement `resetGeneratedDirectory(directory)` with `rmSync(directory, { recursive: true, force: true })` followed by `mkdirSync(directory, { recursive: true })`, and implement `removeGeneratedFile(file)` with `rmSync(file, { force: true })`.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test res_api/test/daily-refresh-guard.test.js`

Expected: one passing test.

- [ ] **Step 5: Add resolver tests one behavior at a time**

Add cases asserting that `resolveDailyRevenueRecords`:

- prefers a CSV row containing the expected date;
- aggregates current-date `hourlyByDate` when the CSV is stale or absent;
- throws when both sources omit the expected date;
- computes Kuala Lumpur dates independently of the host timezone.

- [ ] **Step 6: Implement the pure resolver and verify GREEN after each case**

The normalized record interface is:

```js
{
  date,
  revenue,
  transaction_count,
  avg_transaction_value,
  gross_sales,
  total_discount,
  discount_rate,
  member_sales_ratio,
}
```

Run after each slice: `node --test res_api/test/daily-refresh-guard.test.js`.

### Task 2: Wire the guard into the refresh pipeline

**Files:**
- Modify: `res_api/scrape.js`
- Modify: `res_api/apply-translations.js`
- Modify: `res_api/sync-to-db.js`
- Modify: `res_api/package.json`

- [ ] **Step 1: Reset replay output in `scrape.js`**

Replace the replay directory's unconditional `mkdirSync` with `resetGeneratedDirectory(replayDir)` before each target page is opened.

- [ ] **Step 2: Remove headline CSVs before rebuilding**

Before `findFirstRows`, remove every `headlineMap` output path. Missing current captures must leave the file missing rather than preserving yesterday's file.

- [ ] **Step 3: Resolve and upsert a verified expected date**

Parse `--expected-date`; default to `kualaLumpurDate()`. Normalize fresh CSV rows, add an hourly fallback only when the expected date is missing, log fallback usage, and throw before successful completion if no current record exists.

- [ ] **Step 4: Add the Node regression test command**

Add `test:unit: npm` script value `node --test test/*.test.js` and keep the existing API smoke test separate.

- [ ] **Step 5: Run the Node regression suite**

Run: `cd res_api && npm run test:unit`

Expected: all guard and resolver tests pass.

### Task 3: Make a missing review row observable

**Files:**
- Modify: `bakery-ops/src/__tests__/unit/daily-push.test.ts`
- Modify: `bakery-ops/src/modules/domain/notifications/morning-brief.service.ts`
- Modify: `bakery-ops/src/modules/domain/notifications/freshness-check.ts`

- [ ] **Step 1: Change the missing-row test to expect rejection**

Use `await expect(runMorningBrief()).rejects.toThrow(/daily_revenue/)` and retain assertions that no message or push log is created.

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `cd bakery-ops && npx vitest run src/__tests__/unit/daily-push.test.ts`

Expected: the missing-row case fails because the current function resolves.

- [ ] **Step 3: Throw on missing data and tighten freshness default**

Replace the silent return with an error carrying the expected date. Change the default maximum stale days from two to one while preserving the environment override.

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run: `cd bakery-ops && npx vitest run src/__tests__/unit/daily-push.test.ts`

Expected: all daily-push tests pass.

### Task 4: Verify, integrate, deploy, and recover

**Files:**
- Verify all modified files listed above.

- [ ] **Step 1: Run full local gates**

Run from `bakery-ops`: `./node_modules/.bin/tsc --noEmit`, `npx vitest run`, and `npx next build`.

Run from `res_api`: `npm run test:unit`.

Expected: every command exits zero.

- [ ] **Step 2: Review the diff and commit only repair files**

Stage the spec, plan, tests, helper modules, and targeted production files. Commit messages follow the repository Lore protocol and name the stale-cache decision.

- [ ] **Step 3: Fast-forward the primary worktree and deploy core**

Merge the verified repair branch into `/Users/weiliangshao/hot`, run `./deploy.sh core`, and verify `hotcrush-core` is active with `INSTANCE_ROLE=core`.

- [ ] **Step 4: Recover the missing 2026-07-20 row without sending messages**

On Contabo run `node sync-to-db.js --expected-date=2026-07-20 --daily-revenue-only=true` against the retained 2026-07-20 artifacts, then query `daily_revenue` for that date. This mode writes only the requested `daily_revenue` row and skips the other sync stages. Do not invoke `runMorningBrief` manually.

- [ ] **Step 5: Verify production readiness**

Confirm deployed files contain the cache reset and fallback guard, service restart logs show a healthy core bootstrap, and the restored database row exists. Report that the real 23:00/23:30 schedule remains the final live-time validation.
