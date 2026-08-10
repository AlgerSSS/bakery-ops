# Green Phase 1 apply evidence — 2026-08-10

## Scope and safety boundary

- Target Supabase project: `hotcrush-core-r6-green` (`tmmkknnkcptunxbfjxqn`).
- Source production project `ecsgqcmwtjmcpzqytdqw` was not written.
- Applications remain connected to the source project; no application cutover was performed.
- The connection used TLS `verify-full` with the Supabase production CA. No password or DSN is recorded here.
- This evidence covers the empty Phase 1 physical foundation only. It does not claim historical data migration, views, business-role activation, or application readiness.

## Frozen release

- Foundation commit: `0dc15c42532560ef24e7e1d87e4e92aada5587a6`.
- Concurrent-runner fix commit: `8a896012a7bec2f3bdde13ecdddb7c254efd6aac`.
- `phase1.sql` SHA-256: `0cdb26dbf255022997c3e167a28f12709b4c73c4ad75d364ed312ff37843176d`.
- Expected catalog fingerprint: `a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea`.

## Observed result

- The sealed Phase 1 transaction was applied once to the green project.
- The committed catalog contains the approved Phase 1 contract: 100 tables, 1,374 columns, 100 primary keys, 102 unique constraints, 332 checks, 19 exclusion constraints, 289 validated foreign keys, 224 supporting foreign-key indexes, forced RLS on all 100 tables, zero policies, zero SQL views, and zero `hc_r6_*` roles.
- The migration ledger contains exactly one `R6_PHASE1_BASELINE` entry with the approved payload checksum.
- After the concurrent-runner fix, the authoritative runner was executed again against the same green project at `2026-08-10T15:01:47Z` and returned:

```text
NOOP phase1.sql sha256=0cdb26dbf255022997c3e167a28f12709b4c73c4ad75d364ed312ff37843176d catalog=a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea
```

This proves the green catalog still matches the detached approved contract and that the rerun executed no DDL. It does not prove that business data are current or complete.

## Concurrency incident and closure

During the initial apply, a nearly concurrent second runner exposed a stale-snapshot race caused by acquiring a transaction advisory lock after `BEGIN SERIALIZABLE`. That second transaction failed the preflight relation-collision check and rolled back without changing the green project.

The runner now acquires a session advisory lock in autocommit mode before opening the SERIALIZABLE business transaction, neutralizes inherited transaction/lock/statement timeouts, and holds the lock until the connection closes. The fix passed 43 static tests and a real two-runner PostgreSQL 17.6 harness requiring exactly one `APPLIED`, one `NOOP`, one ledger row, no residual lock, and the same catalog fingerprint.

## Remaining gates

- Encrypted S0 source snapshot and 76-table/759-field executable ETL contract.
- Per-source-row `TARGET`, `QUARANTINE`, or approved `EXCLUSION` conservation ledger.
- Deterministic backfill, reconciliation, and identical-S0 zero-DML rerun.
- Final writer freeze, catch-up, and current-data proof.
- Separate business authorization, RLS policies/grants, views, and application cutover.
