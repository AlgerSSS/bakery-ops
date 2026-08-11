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
connection before any target connection. The historically named
`source-s0.mjs` now implements only an encrypted raw-source capture path. It is
inert unless `--capture-encrypted-raw` is present and it has not been run
against the source. It contains no production S0 builder/reader, target
connector, handler or DML path, so this capability does not change
`PHYSICAL_BACKFILL_NOT_STARTED`.

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

The original `envelope.mjs` and `s0.mjs` APIs still buffer one synthetic
artifact and cap reads at 64 MiB. The raw source capture does not relabel or
reuse that format. `envelope-stream.mjs` instead publishes one binary
AES-256-GCM stream per table, with an independent random DEK, and verifies a
file's complete authentication tag before accepting it. Measured live
size/runtime acceptance and any raw-to-S0 conversion remain outstanding.

## Encrypted raw source capture only (implemented, never run)

This is deliberately **not** a production S0. Its encrypted frames do not
compute the domain-separated HMAC source occurrence tokens, duplicate
occurrence ordinals, per-table roots, global occurrence root, `data_root` or
`content_root` required by `s0.mjs` and `openEncryptedS0`. Therefore it cannot
be routed, backfilled or consumed by a handler/target adapter. The fixed status
inside its encrypted manifest is `RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY`;
`s0_compatible`, `routing_allowed` and `target_load_allowed` are all false.
It does not compute any row-identity or occurrence/table/data/content-root
HMAC. It computes only a private key-universe commitment:
`HMAC-SHA256(key, ASCII("hotcrush.r6.raw-source-hmac-key-commitment.v1\0") ||
JCS({capture_sha256, contract_sha256, snapshot_sha256}))`. The encrypted
manifest retains that commitment and `hmac_key_id`; the offline verifier
recomputes it with constant-time comparison so a different 32-byte key under
the same ID, or a changed capture/contract/snapshot binding, is rejected. This
key commitment is not a source occurrence token, a data/content root or S0
evidence.

Running the module with no arguments is deliberately inert and does not read
Keychain or load the PostgreSQL driver:

```sh
node etl/source-s0.mjs
```

A connection is possible only through the explicit CLI form below. The output
directory must already exist, be owned by the current user, not be a symlink,
and have no group/other permissions:

```sh
node etl/source-s0.mjs --capture-encrypted-raw --output-dir /absolute/owner-only-directory
```

The raw capture only reads fixed macOS Keychain items; it never creates or updates
them and has no environment-secret fallback. The KEK/HMAC items remain those
listed above. The source DSN item is account `hotcrush-r6-migration`, service
`com.hotcrush.r6-migration.source.ecsgqcmwtjmcpzqytdqw.dsn.v1`. Its URL must
identify exactly source project `ecsgqcmwtjmcpzqytdqw`, database `postgres`,
port 5432 and `sslmode=verify-full`. Postgres.js is forced to `max: 1`, verified
TLS with hostname checking, no automatic type fetch, and no prepared statements.
TLS trust is pinned to the public Supabase Root 2021 CA (SHA-256 fingerprint
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`),
whose validity is checked before opening the single connection.

Inside one `SERIALIZABLE READ ONLY DEFERRABLE` transaction the raw capture applies
the five frozen session settings, locks all 76 named tables in the contract's
order, then revalidates the exact 76-table/759-column `relkind=r` surface and
the exact named/ordered PK and unique constraints plus all 21 denied view
definitions. It reads view definitions only from `pg_catalog` and never selects
from a registered view. Each table query lists every contracted column and uses
a deterministic identity order; raw PostgreSQL wire text is framed and
encrypted incrementally without a plaintext application file. There is no
`COPY`, temporary object, source write, function/DDL creation, target connection
or handler execution.

The same locked transaction also requires
`pg_catalog.current_database() = 'postgres'` and
`pg_catalog.pg_is_in_recovery() = false`. The database name and non-recovery
value are bound into `snapshot_sha256` and retained in the encrypted manifest;
they are not part of the public receipt. This rejects an accidental hot-standby
capture. It does not prove that no later source commit exists and is not, by
itself, a general freshness or replication-lag proof.

That transaction captures the canonical text returned by
`pg_catalog.pg_current_snapshot()`. The token is strictly parsed, retained only
inside the encrypted manifest and included in `snapshot_sha256`; every shard is
bound to that snapshot hash. This is evidence that all rows were observed under
one MVCC snapshot. It is not a promise that the snapshot can be restored,
reopened or used as a CDC position.

Each file is mode 0600 and encrypted while streaming. Files first live under a
hidden `.raw-partial-*` directory. Only after the source connection is closed
does the writer add an encrypted/authenticated capture manifest, sync the files
and directory, atomically rename the directory to `raw-<capture hash>`, and sync
its parent. A crash before that rename can leave only an explicitly uncommitted
hidden partial directory; it cannot leave a final-looking capture.

The public completion receipt contains only aggregate counts, a random opaque
capture hash, the encrypted manifest artifact hash, and a watermark comprising
the WAL LSN plus source transaction timestamp. Per-table counts, table/content
hashes, the raw MVCC snapshot token and HMAC key commitment remain only inside
the encrypted manifest; row values remain only inside encrypted shards. The
HMAC key ID is authenticated but visible in each envelope header. Paths, the
DSN and key bytes are not written into either. The watermark is descriptive
capture evidence only. It is **not** an approved CDC/catch-up authority, and
must not be presented as a replayable ordered-watermark protocol.

The implementation rejects a source transaction timestamp at or before
`2026-08-11 02:19:36.332094+00`, the end of the recorded `pos_product` refresh
incident. Any future production S0 must derive from a separately approved raw
capture after that boundary. The incident refresh, frozen contract, earlier
schema snapshots and this raw capture's fake/local tests are not S0 evidence. See
[`../evidence/source-pos-product-refresh-incident-2026-08-11.md`](../evidence/source-pos-product-refresh-incident-2026-08-11.md).

## Offline verification

Regenerate and compare the contract:

```sh
node etl/build-contract.mjs
node etl/build-contract.mjs --check
```

Run only the ETL suite:

```sh
node --test tests/test_phase1_etl*.mjs
node --test tests/test_phase1_s0_exporter.mjs
```

The raw-capture-specific suite uses an injected fake connector by default. An
optional PostgreSQL 17.6 fixture test runs only when
`HOTCRUSH_R6_PG17_READONLY_FIXTURE_URL` is explicitly set to a loopback URL;
it never accepts a remote fixture and never reads Keychain.

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
3. independently approve and execute an encrypted raw source capture, then
   build and verify a production S0 with all keyed occurrence/table/data/content
   roots; separately implement a detached exclusion authority;
4. implement a real transactional target adapter in a new release state;
5. implement an ordered catch-up watermark protocol; and
6. require final per-table, per-occurrence, amount and business-key
   reconciliation before any “complete” result.

Until those gates are met, production `load` and `catchup` do not exist.
