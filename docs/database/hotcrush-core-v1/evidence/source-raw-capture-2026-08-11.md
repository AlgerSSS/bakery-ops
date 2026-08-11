# R6 source RAW capture evidence — 2026-08-11

Status: `RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY`

This record proves one complete, encrypted, read-only capture of the current
source database. It does **not** prove that a production S0, route ledger,
target backfill, catch-up, cutover, or application switch exists. The physical
backfill status remains `PHYSICAL_BACKFILL_NOT_STARTED`.

## Confirmed execution facts

- Exporter baseline commit: `afcd7d8`.
- Source-timeout correction commit: `af46a27`.
- Source transaction timestamp: `2026-08-11T03:55:44.625905Z`
  (`2026-08-11 11:55:44.625905` Asia/Kuala_Lumpur).
- Source WAL watermark: `16/1000000`.
- Capture SHA-256: `e8654ae700b8c2ba1b559a4ce577071bcb18febe16891173a6a18a3f526c28ee`.
- Encrypted manifest artifact SHA-256:
  `c54a71dfc6183236a0f2d5684477b0412cc048df1351992314ae59501c66304b`.
- Captured surface: 76 base tables, 759 columns, 168,833 row occurrences.
- Registered views queried: 0 of 21.
- Published artifacts: 76 encrypted table shards plus one encrypted manifest.
- Exact encrypted logical bytes: 136,433,725.
- Artifact file mode: `0600`; capture directory mode: `0700`.
- Remaining partial capture directories after publication: 0.
- The manifest artifact was independently hashed after publication and matched
  the public receipt.
- The capture timestamp is later than the source catalogue refresh incident
  boundary `2026-08-11T02:19:36.332094Z`.

The encrypted capture is retained outside the repository in the owner-only R6
migration directory. No plaintext source row, database password, KEK, or HMAC
key is recorded in this evidence file or committed to Git.

## Failure and correction evidence

The first real attempt stopped safely after 52 completed tables. A separate
read-only diagnostic reproduced PostgreSQL SQLSTATE `57014` while streaming
`item_hourly_sales`; the inherited source setting was exactly
`statement_timeout = 2min`. The partial directory was completely removed and
the target database was never connected.

The corrected exporter sets `statement_timeout = 0` as the first statement
inside the read-only transaction, reads the effective value back as `0`, and
binds the explicit RAW runtime addendum into the encrypted snapshot evidence.
It does not change the source role or database-level setting. Independent
review found no P0/P1 issue in that correction, and the successful capture
passed the original two-minute failure point.

## Evidence boundary

- The capture is a source snapshot, not an S0.
- The 168,833 count is exact for this transaction, not a claim about later
  source state.
- The encrypted artifacts have not yet been converted into the independently
  verified S0 v2 format.
- No source DML/DDL, target DDL/DML, application reconfiguration, or writer
  activation occurred as part of this capture.
