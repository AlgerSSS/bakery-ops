# HOT CRUSH Core V1 R6 — Phase 1 physical foundation

This directory is the sealed, database-independent implementation lane for the
P0c Phase 1 foundation. The compiler reads the repository `target-model.json`;
it does not hand-maintain a second table or field list.

## Delivered physical contract

Phase 1 contains only the minimum physical foundation:

- 100 `CORE_MIGRATION` tables and 1,374 columns;
- 100 primary keys;
- 102 UNIQUE constraints: 78 ordinary, 9 `NULLS NOT DISTINCT`, 15
  `NULLS DISTINCT`;
- 332 CHECK constraints: 90 table-level and 242 field-level;
- 19 DEFERRABLE EXCLUDE constraints;
- 289 active DEFERRABLE foreign keys, including the composite
  `mkt_reward_claim(reward_stock_id,reward_id)` relationship;
- 224 child-side FK support indexes;
- 100 table comments, 1,374 column comments, 842 constraint comments and 224
  support-index comments;
- ENABLE + FORCE RLS on all 100 tables, with zero policies and zero managed
  table/function grants;
- zero views, zero ETL and zero business-data writes.

The generated payload is [`generated/phase1.sql`](generated/phase1.sql). It is
the only SQL payload the runner executes. The 18 stage files remain review
fragments and are verified as an exact, ordered, gap-free concatenation of that
payload.

## Security boundary

`OWNER_MODE=EXECUTOR_OWNER`: the 100 tables, helper function and migration
ledger are owned by `postgres`.

Phase 1 intentionally creates **no `hc_r6_*` roles**. Supabase's green-project
`postgres` executor is not a platform superuser; PostgreSQL 17 automatically
creates creator memberships when such an executor creates roles. Creating the
planned 11 business roles here would therefore violate the zero-membership
contract. Their exact names remain in the manifest as
`DEFERRED_NOT_EXECUTED`, with
`requires_platform_superuser_bootstrap=true`. Role creation and policies belong
in a later, separately approved security migration.

For `PUBLIC`, `anon`, `authenticated` and `service_role`, Phase 1:

- revokes `CREATE` on `public` and explicitly preserves `USAGE`;
- revokes privileges on all 100 managed tables;
- revokes helper-function execution;
- verifies both direct ACLs and effective inherited privileges.

It does not alter `postgres` default privileges and does not change extension
owners.

## Immutable release artifacts

- `generated/phase1-ddl-manifest.json`: ordered stages, byte offsets, object
  inventory, model/review provenance and semantic edge hashes;
- `generated/phase1.sql`: single authoritative migration payload;
- `phase1-catalog-contract.json`: canonical PostgreSQL 17.6 catalog result,
  including exact types, defaults, constraint/index definitions, comments,
  owners, RLS, function properties and ACLs;
- `phase1_release.py`: manual detached seal for the three artifacts above;
- `phase1_apply.py`: target-gated, one-snapshot, one-transaction runner;
- `phase1_catalog.py`: closed-schema catalog capture and exact set-diff verifier.

Frozen release identifiers:

- review package SHA-256:
  `6b863293c5aa3358c45c52468f614583f309ccb8a3ea717f3ad90ad76dfceaa0`;
- target model canonical SHA-256:
  `52b1e84ae5cfa16871a058adaca3d1482d91460f7aad6f99186cab5b7e4ed986`;
- `phase1.sql` SHA-256:
  `0cdb26dbf255022997c3e167a28f12709b4c73c4ad75d364ed312ff37843176d`;
- catalog fingerprint:
  `a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea`;
- Docker image digest:
  `postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94`.

## Transaction and rerun semantics

Before connecting, the runner:

1. validates the detached release seal;
2. snapshots every bundle file once through a no-follow directory descriptor;
3. verifies every size, SHA-256, stage offset and byte range;
4. parses the catalog contract as canonical, duplicate-key-free, closed JSON;
5. rejects the production source project and every target except the approved
   green project or an explicit numeric-loopback scratch database.

The fresh path runs all stages in one SERIALIZABLE transaction under one
advisory lock. It executes through FK validation (`041`), verifies that the
ledger is still postgres-owned and not yet FORCE RLS, inserts the immutable
ledger row with `execution_ms=NULL`, then executes security/comments/catalog
acceptance (`080/090/099`), performs the detached exact catalog comparison and
commits. A failure before commit rolls back all Phase 1 objects and the ledger.

The rerun path accepts only one exact baseline ledger row with the same filename
and checksum. It executes no DDL, re-runs the complete catalog comparison and
returns `NOOP`. A different checksum or a ledger gap is rejected.

## Verified acceptance

Static suite:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

Current result: **38/38 pass**.

Artifact regeneration and byte verification:

```sh
python3 phase1_ddl_compiler.py generate
python3 phase1_ddl_compiler.py check
```

Disposable PostgreSQL acceptance:

```sh
python3 tests/run_phase1_pg17_acceptance.py
```

The harness creates two independent `postgres:17.6-alpine` clusters, applies
the same sealed bytes, reruns both as `NOOP`, compares canonical catalogs byte
for byte, and verifies transaction rollback, ledger idempotency, CHECK
enforcement, EXCLUDE adjacency/overlap/predicate behavior, composite FK
`MATCH SIMPLE`/orphan/deferred/delete behavior, ACL denial and default-deny RLS.
The final result was `PASS` with the catalog fingerprint shown above.

## Explicitly not approved or claimed

- No SQL in this directory has been executed against the source or green
  Supabase project.
- No application has switched databases.
- No view or ETL/backfill is included.
- Historical cost, HBTI and reward source fidelity is not yet proven. Their
  data phase requires an S0-deidentified row-level routing ledger and an actual
  canonical-payload reconciliation.
- Reward-claim write activation remains `DEFERRED_WRITE_ACTIVATION` until the
  future atomic write path enforces
  `campaign_member.campaign_version_id = reward_stock.campaign_version_id`.

Those are data/write-activation gates, not reasons to weaken or silently alter
the empty physical Phase 1 contract.
