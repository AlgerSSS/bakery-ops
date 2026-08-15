# R6A1 FX and signed-POS resolved design overlay

Status: **DESIGN_ONLY_NOT_COMPILED / NOT_APPLY_COMPATIBLE / NOT_ACTIVATED**.

This deterministic overlay resolves the pinned R6 model into a review-only R6A1 model. It performs no database, network, Keychain, S0, RES, or target writes.

## Closed decisions

- `FX-001` — APPROVED_DDL_LEVEL_CONTRACT: Add app_currency, finance_accounting_entity (LEGAL_ENTITY|BRANCH supertype), finance_fx_rate_observation, finance_currency_assignment, and finance_currency_policy without jurisdiction, currency, timezone, cutoff, provider, or live-rate defaults.
- `FX-002` — APPROVED_DDL_LEVEL_CONTRACT: Delete the current location operating-currency field to avoid a second currency source, do not add a current accounting-entity pointer that would misstate history, defer the effective-dated ownership relation, remove MY, timezone, and 04:00 defaults, and make supplier country and quote currency nullable without defaults.
- `FX-003` — APPROVED_DDL_LEVEL_CONTRACT: For 20 Phase1 and five future currency fields remove defaults and add app_currency references; delete two Phase1 currency fields, and add the missing mkt_reward_stock currency reference.
- `FX-004` — APPROVED_FAIL_CLOSED_BOUNDARY: finance_currency_assignment carries effective-dated LOCATION/OPERATING and ACCOUNTING_ENTITY/FUNCTIONAL currency only; finance_accounting_entity is a LEGAL_ENTITY|BRANCH supertype; finance_currency_policy carries pair-specific conversion only; ENTITY_PRESENTATION and GROUP are deferred, NULL scope is not a group default, and mixed grain is forbidden.
- `SCM-001` — APPROVED_DDL_LEVEL_CONTRACT: Replace supplier price observation with material price observation at material grain, retaining raw transaction currency and excluding stored FX-derived amounts.
- `COST-001` — APPROVED_ARCHIVE_ROUTE_C: Replace material price with material cost selection, bind each selection to a currency assignment, forbid global NULL scope, and store the approved selection rather than a derived MYR amount; active cost_card_recipe_version must DROP reference_sale_price and currency, while legacy raw values remain only in authenticated encrypted S0 or migration archive plus its route manifest, never default to MYR, and never participates in margin.
- `POS-001` — APPROVED_DDL_LEVEL_CONTRACT: Permit signed POS facts and replace aggregated order items with raw reversal-line facts; negative, zero, and mixed-sign values are valid when allowed by the source contract.
- `MIGRATION-001` — APPROVED_FAIL_CLOSED_BOUNDARY: Use legacy pos_member_order_item only for reconciliation; line-level pos_order_item intents must come from the separately approved raw RES Report211 replay package.
- `RELEASE-001` — APPROVED_FAIL_CLOSED_BOUNDARY: Publish a design-only resolved catalog with zero SQL views; it is not compatible with phase1_apply and production-data readiness depends only on a future latest-S0 conservation artifact.

## Independently recomputed model boundary

- Phase 1: 105 tables, 1470 columns, 105 PK, 113 UQ, 404 CHECK, 21 EXCLUDE, 332 active FK, 266 FK-support indexes.
- Global: 142 physical tables / 1908 physical fields; 59 logical views / 727 view fields; 2635 declared fields total.
- Resolved model SHA-256: `72c68f5961cbf2c6456cf61d39d3b3e8188f458de90c88ef7c1afaac4be80a7f`.
- The former 104/1450 candidate remains historical and is not used to construct the model.

## Fail-closed migration boundary

- `pos_member_order_item` is reconciliation-only. Line-level target facts come only from the approved external RES Report211 raw replay package; legacy `source_row_count` is not migrated.
- Legacy MYR, `MIGRATED_MANUAL`, stored-FX, and normalized-price mappings have no approved target intent.
- Recipe reference price/currency leave the active recipe model; legacy values remain only in authenticated encrypted S0 or a migration archive with a future route manifest.
- Constraint triggers, controlled functions, SQL payloads, catalog capture, latest-S0 conservation, and affected-view SELECT specifications are deliberately not represented as complete.
- Trigger contracts are listed separately and are excluded from the 975 p/u/c/x/f business-constraint comments.
- Build provenance uses one O_NOFOLLOW/dirfd byte snapshot for validation, rendering and hashing; the byte-carrying compile/exec bootstrap injects the exact compiler snapshot; remaining disk-bound inputs are checked before publish. The bootstrap is the trust root and requires the repository's serialized writer freeze from launch.

## Authority references

- ISO 4217 structure and minor units: https://www.iso.org/standard/64758.html
- IFRS IAS 21 functional and presentation currency concepts: https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2024/issued/part-a/ias-21-the-effects-of-changes-in-foreign-exchange-rates.pdf?bypass=on
- Bank Negara Malaysia historical exchange-rate download is a future optional provider example only; no provider is selected here: https://financialmarkets.bnm.gov.my/data-download-exchange-rates
