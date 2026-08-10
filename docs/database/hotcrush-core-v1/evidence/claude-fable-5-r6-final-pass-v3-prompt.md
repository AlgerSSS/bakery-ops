# HOT CRUSH Core V1 R6 — Claude Fable 5 final independent approval audit

You are the final independent database-design reviewer. Work read-only. Do not edit files, do not connect to production, and do not execute DDL/DML. Be adversarial and evidence-led; do not approve because the author says the checks passed.

Review root:

`/Users/weiliangshao/hot/docs/database/hotcrush-core-v1`

The business goal is a single-enterprise, multi-location extensible data foundation: preserve the smallest irreducible identities, versions, source observations, decisions/workflow facts, and necessary platform state; connect modules through stable IDs and explicit provenance; derive repeatable analytics as views instead of storing recomputable outputs. Table count is not itself the optimization target, but a table must not survive merely because an earlier draft named it.

## Claims you must independently verify

1. The active catalog is **not 154 physical tables**. R5 had 154 candidate objects requiring dispositions. R6 has 137 potential physical contracts: 100 phase-1 (81 business + 19 platform), 33 extension-only, and 4 source-conditional. The 154 dispositions must reconcile exactly to those physical contracts plus merged, derived, and removed outcomes, without double counting.
2. The model has 59 read-only views (41 phase-1, 13 extension, 5 source-conditional), 1,810 physical-table fields, 642 view fields, and 419 FK fields. Every one of the 196 table/view objects and all 2,452 fields must have a non-empty, object-specific comment contract.
3. All 137 physical tables were individually audited for grain, derivability, why storage is required, writer, readers, mutation policy, and phase. No deterministic aggregate/current-state/reporting result is being mislabeled as an irreducible fact. Challenge counterexamples rather than accepting classifications.
4. All 939 current production fields have exactly one non-silent disposition. Every current table marked CRITICAL, plus the deliberately elevated high-risk tables in the validator, must use explicit field-level mappings; `OBJECT_TARGETS` is forbidden there. Pay special attention to the prior findings on `item_hourly_sales`, `employees`, `cost_card_item_price`, `staff`, `cost_card_recipe`, `finance_revenue_daily`, `fact_hbti_response`, and `fact_shift`.
5. Optional source observations preserve missing as NULL rather than fabricating zero, including `hr_timesheet_entry.break_minutes`. `pos_sales_day.source_guest_count` and source-provided average order value remain distinct from derived canonical metrics.
6. Every JSONB field is exhaustively classified as behavior-driving or evidence-only, never both. Every behavior-driving JSONB field has a concrete database validation guard and schema-version contract. Check campaign rules, HR screening rules, survey validation rules, recipe component conditions, offer compensation, and the original guarded fields.
7. `app_user.notification_subscription_codes` preserves the current preference state without adding a speculative table; it has a governed update contract, array constraints, registry validation, audit logging, and is not treated as RBAC or employment truth.
8. The package-local hash tool declares an explicit deterministic scope, runs read-only, produces the same output twice, and openly excludes PNG/PDF/interactive exports whose third-party metadata can drift. Verify that those visual exports are separately checked for 61 pages, coverage and clarity; do not treat a hash as proof of semantic correctness.
9. The Draw.io source contains all 137 tables, 59 views and 419 FK connections across 61 pages; the PDF is 61 pages and the four named PNGs are high-resolution. The package must state that it is design-only and has not changed production or application contracts.

## Required checks

- Read the declarative model and generators, not only the prose report.
- Read the previous result `evidence/claude-fable-5-r6-final-pass-v2-pass-with-changes.md` and verify every material finding is actually closed.
- Run only read-only checks such as:
  - `python3 tools/validate-review-package.py`
  - `python3 tools/hash-review-package.py` twice
  - targeted CSV/JSON/XML queries needed to test the claims
- Distinguish design-approval completeness from later migration/runtime verification. Do not fail a design-only package merely because production rollout evidence is intentionally not claimed; do fail it if the package falsely claims runtime readiness.
- Do not invent a reason to reduce the table count. If you believe a table can be removed or changed, name the exact table, deterministic derivation, lost fact or mixed grain, and downstream consequence.

## Verdict contract

The first line must be exactly one of:

- `PASS`
- `PASS_WITH_CHANGES`
- `FAIL`

Use `PASS` only if there is no material design or acceptance defect remaining. Cosmetic preferences and explicitly declared migration-time verification do not block PASS. If not PASS, list each blocking item with exact file/table/field, violated invariant, and the smallest valid correction. If PASS, state the exact verified counts and explicitly confirm closure of the previous M1/M2/M3 findings and the reproducible-hash boundary.
