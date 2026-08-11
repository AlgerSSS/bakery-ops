# R6 Phase 1 data-migration contract and synthetic safety scaffold

## Status

`PHYSICAL_BACKFILL_NOT_STARTED`

This directory does **not** contain an approved production backfill. It freezes
the current source surface and proves fail-closed mechanics with synthetic,
offline fixtures. No code in this directory has connected to the source or
green Supabase project, exported a source row, created a Keychain secret, or
executed target DML.

The distinction is deliberate:

- `declared_transform_code` preserves the 759-field design evidence;
- `execution_handler_id` is `null` for every physical source field;
- `execution_handlers` is the exact empty object;
- without an independently approved, typed handler, every real A/R row routes
  to `QUARANTINE`, never `TARGET`;
- the eight X tables also route to `QUARANTINE` because this release has no
  exclusion authority or approved exclusion reason;
- `fact_shift` is B0: zero rows are expected and any row is a blocking
  quarantine event.

Synthetic results such as `SYNTHETIC_PARTIAL` and `SYNTHETIC_NOOP` prove engine
behavior only. They are not evidence that historical data has been migrated or
reconciled.

## Frozen source and target surface

`migration-contract.json` is regenerated only from the frozen repository
evidence and the sealed Phase 1 DDL manifest. It covers exactly:

- 76 physical source tables and all 759 physical fields;
- 21 old views and 180 view fields as `export=false` registry entries only;
- 69 primary-key identities;
- five selected unique-key identities;
- two `FULL_ROW_MULTISET` identities, which retain duplicate occurrences;
- source classes A19, R19, P29, X8 and B0 one;
- 100 target tables and 291 declared foreign keys: 289 active plus two
  extension-deferred declarations;
- a 99-component SCC load plan with 10 cyclic components, 12 intra-component
  constraints and eight waves.

`daily_revenue` deliberately uses
`uk_daily_revenue_date_store(date, store)` as its migration identity. The
observed `UNIQUE(date)` is recorded as a stronger single-store source
constraint, not treated as the long-term multi-store identity.

The source-capture contract requires PostgreSQL 17.6,
`SERIALIZABLE READ ONLY DEFERRABLE`, deterministic `ACCESS SHARE` locks over
all 76 base tables, exact projection of 759 columns, fixed session settings,
schema revalidation after locking, TLS verification and closing the source
connection before any target connection. That contract is registered but no
production streaming extractor exists in this release.

The target catalog must retain fingerprint
`a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea`,
the existing `pgcrypto`, `citext` and `btree_gist` extensions, and zero public
views. ETL has a zero-DDL contract: it may not create, alter, comment, drop,
grant, revoke, truncate, call or execute a `DO` block against target schema
objects.

## Privacy and artifact boundaries

The synthetic scaffold uses only Node built-ins and is tested on Node 24.4.1.
Its custom protocol is named `hotcrush.typed-jcs.v1`; it is a restricted,
fail-closed JCS subset, not a claim of complete RFC 8785 coverage. PostgreSQL
wire values are retained as `(declared type, text-or-null)` so `bigint`,
`numeric`, timestamps and `jsonb` are not first coerced through JavaScript
numbers or dates.

Sensitive deterministic identity is:

1. domain-separated HMAC-SHA256 with the migration HMAC key;
2. UUIDv5 over the ASCII string `hmac-sha256:<lowercase full digest>`.

UUIDv5 is only a repeatable anchor; it is not encryption. The complete HMAC is
retained in the encrypted route ledger.

Artifacts use an independent random DEK per file, AES-256-GCM payload
encryption and AES-256-GCM DEK wrapping under a separate KEK. The KEK and HMAC
key are separate 32-byte macOS Keychain items read with `/usr/bin/security`
through a no-shell argument array. The runtime never creates keys or falls back
to environment variables.

The writer creates only a mode-0600 encrypted temporary file and atomically
publishes it inside an owner-only, non-symlink directory. “No plaintext file”
is an application-level guarantee; plaintext still exists transiently in
process memory and can be affected by swap or core dumps.

The current envelope implementation buffers one artifact and caps reads at 64
MiB. It is therefore a **synthetic scaffold**, not the production S0 exporter.
Production capture still requires per-table encrypted streaming shards,
verify-before-consume replay and measured size/runtime acceptance.

## Offline verification

Regenerate and compare the contract:

```sh
node etl/build-contract.mjs
node etl/build-contract.mjs --check
```

Run only the ETL suite:

```sh
node --test tests/test_phase1_etl*.mjs
```

The offline tests cover contract mutation rejection, deterministic SCC
planning, type-preserving canonical frames, HMAC/UUID boundaries, encrypted
artifact authentication, read-only fake Keychain calls, mode-0600 publication,
logical S0 stability with randomized ciphertext, duplicate multiset
preservation, exactly-one row routing, unapproved-handler quarantine, S0-route
binding, per-table conservation and same-S0 zero-DML behavior in a branded
in-memory adapter.

## Gates before a real data run

The next approved implementation lane must, table by table for A19/R19:

1. define a closed typed handler ID, code hash, input types, exact target fields
   and evidence/approval reference;
2. validate real source value domains, units, target CHECKs, unique keys and
   foreign keys in a no-write dry run;
3. implement streaming encrypted S0 shards and a detached exclusion authority;
4. implement a real transactional target adapter in a new release state;
5. implement an ordered catch-up watermark protocol; and
6. require final per-table, per-occurrence, amount and business-key
   reconciliation before any “complete” result.

Until those gates are met, production `load` and `catchup` do not exist.
