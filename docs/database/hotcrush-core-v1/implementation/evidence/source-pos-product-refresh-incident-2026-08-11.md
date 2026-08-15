# Source `pos_product` refresh incident — 2026-08-11

## Status

This is an execution-incident record, not evidence that the source capture or
physical backfill has completed.

While preparing a read-only comparison between the live RES catalogue and the
legacy source table, an in-memory wrapper around `res_api/sync-catalog.mjs`
failed to pass the intended `--dry-run` flag to the wrapped program. The
program therefore executed its normal catalogue upsert against the existing
source project `ecsgqcmwtjmcpzqytdqw`.

## Confirmed scope

- The RES read immediately before the incident returned 211 current catalogue
  rows: 94 brand-scope rows and 117 store-scope rows. All 211 had a Chinese
  name and 158 had a RES cost card.
- The legacy table contained 211 rows before the incident, with 211 distinct
  `item_key` values. Its previous `synced_at` range was
  `2026-07-31 09:23:17.200335+00` through
  `2026-07-31 09:23:20.277763+00`.
- The existing synchronizer is an upsert-only writer and contains no delete
  path for catalogue rows. It processed two batches, 200 rows and 11 rows.
- A read-only verification transaction after the incident observed 211 rows,
  211 distinct `item_key` values, no duplicate `(org_id, item_id)` group, no
  NULL `first_seen_at` or `synced_at`, 211 rows with `res_status = 1`, and zero
  negative catalogue/cost amounts.
- `first_seen_at` remained in its original range. `synced_at` was updated to
  `2026-08-11 02:19:35.501278+00` through
  `2026-08-11 02:19:36.332094+00` (10:19 MYT).
- The post-incident verification used a repeatable-read, read-only transaction;
  its snapshot was `55358:55358:`.

The upsert can update the following source columns from the current RES
response: `item_id`, `org_id`, `org_type`, `menu_item_code`, `name_en`,
`name_zh`, `category_id`, `category_en`, `category_zh`, `spec`, `sales_price`,
`res_cost_card_id`, `res_spec_id`, `has_cost_card`, `res_total_cost`,
`res_theoretical_cost`, and `res_status`; it also sets `synced_at = now()`.
`item_key` is the conflict key and is not updated.

## Evidence boundary

No row-level pre-write snapshot was captured, so it is not possible to prove
which non-time catalogue values, if any, changed from the previous source-table
state. It is confirmed that the row count and both observed source identity
uniqueness checks did not change. No target-green table, application
connection, deployment, or source table other than `public.pos_product` was
modified by this run.

The upsert transactions have committed; there is no safe row-level rollback
artifact. Restoring an older database backup would be disproportionate and
would replace the current RES catalogue with stale values. The conservative
course is to retain this refresh as the new source state, record the incident,
and ensure the real encrypted S0 is captured only after this timestamp. This
does not waive the rule that subsequent source access is read-only.
