# Daily Review Refresh Guard Design

## Problem

The 23:30 daily review cron is healthy, but it skips when `daily_revenue` has no row for the Kuala Lumpur business date. On 2026-07-20 the Restosuite Sales Summary page emitted no `queryData` request. The scraper kept the previous run's `replay-30d` files, `apply-translations.js` rebuilt `sales_by_business_date.csv` from those stale files, and `sync-to-db.js` reported success after upserting old rows.

## Approved outcome

The refresh pipeline must never mistake stale generated files for a successful current-day refresh. When the Sales Summary page is unavailable, the pipeline should still produce the daily-review fields from the independently scraped `hourlyByDate` dataset. If neither source contains the expected business date, the refresh must fail so `daily-refresh.sh` retries it.

## Design

### Generated-output lifecycle

`scrape.js` clears each target's generated `replay-30d` directory before capturing the current run. `apply-translations.js` removes every generated headline CSV before rebuilding it. A missing query can therefore produce a missing artifact, but never a stale artifact carrying yesterday's data.

### Daily revenue resolution

A new pure module, `res_api/lib/daily-revenue-resolver.js`, normalizes daily-revenue records and resolves the expected Kuala Lumpur business date:

1. Prefer a current-date row from `sales_by_business_date.csv`.
2. If it is absent, aggregate `daily.json.hourlyByDate` for the expected date.
3. Derive `revenue`, `gross_sales`, `transaction_count`, `avg_transaction_value`, `total_discount`, and `discount_rate`; leave `member_sales_ratio` null because hourly data does not contain payment membership detail.
4. Throw when neither source contains the expected date.

`sync-to-db.js` accepts `--expected-date=YYYY-MM-DD` for deterministic recovery and testing; otherwise it uses the current Kuala Lumpur date. A later successful Sales Summary run overwrites the fallback row with the richer authoritative values.

### Cron failure semantics

`runMorningBrief()` throws when the expected `daily_revenue` row is absent. The existing `wrapCron` boundary records the run as failed and logs the error instead of marking a silent skip as completed. The default freshness tolerance becomes one day, so a missing prior business day alerts on the following morning.

## Testing

- Node built-in tests cover stale generated-file cleanup and daily-revenue source resolution.
- Existing Vitest coverage is updated so a missing current-day row must reject and send nothing.
- Targeted tests run red before implementation and green afterward.
- Full TypeScript, Vitest, Next build, and res_api Node tests run before deployment.

## Deployment and recovery

After local verification, the fix is merged into the primary worktree and deployed to Contabo core. The existing 2026-07-20 `daily.json` can be replayed with `--expected-date=2026-07-20 --daily-revenue-only=true` to restore only the missing database row without touching the other sync stages or sending a retroactive notification. No automatic historical Lark message is sent.
