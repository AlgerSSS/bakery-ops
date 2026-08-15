import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalizeJcs, canonicalizeTypedRow, sha256Hex } from "../etl/lib/canonical.mjs";
import { loadMigrationContract } from "../etl/lib/contract.mjs";
import { writeStreamingEncryptedArtifact } from "../etl/lib/envelope-stream.mjs";
import {
  buildS0V2ContentDocument,
  buildS0V2Table,
  computeS0V2GlobalRoots,
} from "../etl/lib/s0-v2-format.mjs";
import { convertRawCaptureToS0V2 } from "../etl/s0-v2-convert.mjs";
import {
  RAW_CAPTURE_MANIFEST_SCHEMA,
  RAW_SHARD_SCHEMA,
  createRawHmacKeyCommitment,
} from "../etl/source-s0.mjs";
import { verifyS0V2Candidate } from "../etl/reference/s0-v2-reference-verifier.mjs";
import { S0_V2_ADDENDUM_SHA256 } from "../etl/s0-v2-addendum-release.mjs";
import { boundedS0V2Plaintext } from "../etl/lib/s0-v2-writer.mjs";

const KEY = Buffer.from(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "hex",
);
const FILE_SHA = "7ea542ef1e654b094628bbb97868b28a963879a4815740f7fa4f65c8c60d8587";
const JCS_SHA = "4fb6c9acb9decfe873f9e44e954e1af5d7a6d7fc1005e529979bb6a584cc814f";
const CAPTURE_SHA = "11".repeat(32);
const SNAPSHOT_SHA = "44".repeat(32);
const INTEGRATION_KEYRING = Object.freeze({
  hmacKey: KEY,
  hmacKeyId: "vector-hmac-v1",
  kek: Buffer.alloc(32, 0x51),
  kekId: "s0-v2-integration-kek-v1",
});
const WATERMARK = Object.freeze({
  source_transaction_timestamp: "2026-08-11T03:00:00.000000Z",
  wal_lsn: "0/16B6C50",
});
const BASE_OUTPUT_REQUIREMENT = 17n * 1024n * 1024n * 1024n;
const FIXTURE_REFERENCE_SPILL_REQUIREMENT = 3n * 1_056n * 3n;

const KEYED_TABLE = Object.freeze({
  fields: Object.freeze([
    Object.freeze({ data_type: "integer", name: "version", nullable: false }),
    Object.freeze({ data_type: "text", name: "name", nullable: false }),
    Object.freeze({ data_type: "timestamp with time zone", name: "applied_at", nullable: true }),
    Object.freeze({ data_type: "text", name: "filename", nullable: true }),
    Object.freeze({ data_type: "text", name: "checksum", nullable: true }),
  ]),
  identity: Object.freeze({ columns: Object.freeze(["version"]), mode: "PRIMARY_KEY" }),
  name: "schema_migrations",
});
const MULTISET_TABLE = Object.freeze({
  fields: Object.freeze([
    Object.freeze({ data_type: "bigint", name: "user_id", nullable: true }),
    Object.freeze({ data_type: "bigint", name: "role_id", nullable: true }),
    Object.freeze({ data_type: "bigint", name: "assigned_by", nullable: true }),
    Object.freeze({ data_type: "timestamp with time zone", name: "assigned_at", nullable: true }),
  ]),
  identity: Object.freeze({ columns: Object.freeze([]), mode: "FULL_ROW_MULTISET" }),
  name: "app_user_role_pre083",
});

function typed(table, values) {
  return canonicalizeTypedRow(table.name, table.fields.map((field, index) => ({
    name: field.name,
    pg_type: field.data_type,
    raw: values[index],
  })));
}

function framed(bytesInput) {
  const bytes = Buffer.from(bytesInput);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function integrationRows(table) {
  if (table.name === "schema_migrations") {
    return [typed(table, ["108", "phase1", "2026-08-10 12:34:56+00", "108_phase1.sql", null])];
  }
  if (table.name === "app_user_role_pre083") {
    const a = typed(table, ["7", "2", null, "2026-01-02 03:04:05+00"]);
    return [a, typed(table, ["7", "3", "9", null]), a];
  }
  return [];
}

async function createIntegrationRaw(parent) {
  const contract = await loadMigrationContract();
  const contractSha256 = sha256Hex(canonicalizeJcs(contract));
  const captureDirectory = path.join(parent, `raw-${CAPTURE_SHA}`);
  await mkdir(captureDirectory, { mode: 0o700 });
  const shards = [];
  for (const [index, table] of contract.source_tables.entries()) {
    const shardIndex = index + 1;
    const tableSha256 = sha256Hex(Buffer.from(table.name, "utf8"));
    const bindingSha256 = sha256Hex(canonicalizeJcs({
      capture_sha256: CAPTURE_SHA,
      contract_sha256: contractSha256,
      schema: RAW_SHARD_SCHEMA,
      shard_index: shardIndex,
      snapshot_sha256: SNAPSHOT_SHA,
      table_sha256: tableSha256,
    }));
    const rows = integrationRows(table);
    const rowHash = createHash("sha256");
    for (const row of rows) rowHash.update(framed(row));
    const receipt = await writeStreamingEncryptedArtifact({
      artifactTypeHash: bindingSha256,
      directory: captureDirectory,
      filename: `${String(shardIndex).padStart(3, "0")}.raw.enc`,
      keyring: INTEGRATION_KEYRING,
      plaintextChunks: (async function* chunks() {
        yield framed(canonicalizeJcs({
          capture_sha256: CAPTURE_SHA,
          contract_sha256: contractSha256,
          fields: table.fields.map((field) => ({
            name: field.name,
            nullable: field.nullable,
            pg_type: field.data_type,
          })),
          frame: "HEADER",
          schema: RAW_SHARD_SCHEMA,
          shard_index: shardIndex,
          snapshot_sha256: SNAPSHOT_SHA,
          status: "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY",
          table: table.name,
          table_sha256: tableSha256,
          watermark: WATERMARK,
        }));
        for (const row of rows) yield framed(row);
        yield framed(canonicalizeJcs({
          frame: "TRAILER",
          row_count: rows.length,
          row_stream_sha256: rowHash.digest("hex"),
          schema: RAW_SHARD_SCHEMA,
        }));
      }()),
    });
    shards.push({
      counts: { columns: table.fields.length, rows: rows.length },
      hashes: {
        artifact_sha256: receipt.artifact_sha256,
        binding_sha256: bindingSha256,
        content_sha256: receipt.content_sha256,
        table_sha256: tableSha256,
      },
      shard_index: shardIndex,
    });
  }
  const manifest = {
    capture_sha256: CAPTURE_SHA,
    counts: { columns: 759, rows: 4, shards: 76, views_queried: 0 },
    hashes: {
      catalog_sha256: "55".repeat(32),
      contract_sha256: contractSha256,
      shard_set_sha256: sha256Hex(canonicalizeJcs(shards)),
      snapshot_sha256: SNAPSHOT_SHA,
    },
    hmac_key_commitment: createRawHmacKeyCommitment({
      captureSha256: CAPTURE_SHA,
      contractSha256,
      hmacKey: INTEGRATION_KEYRING.hmacKey,
      hmacKeyId: INTEGRATION_KEYRING.hmacKeyId,
      snapshotSha256: SNAPSHOT_SHA,
    }),
    routing_allowed: false,
    schema: RAW_CAPTURE_MANIFEST_SCHEMA,
    shards,
    s0_compatible: false,
    source_database: "postgres",
    source_is_in_recovery: false,
    source_mvcc_snapshot: "700:700:",
    source_runtime_addendum: {
      schema: "hotcrush.r6.raw-source-runtime-addendum.v1",
      session_settings: { statement_timeout: "0" },
    },
    status: "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY",
    target_load_allowed: false,
    watermark: WATERMARK,
  };
  const binding = sha256Hex(canonicalizeJcs({
    capture_sha256: CAPTURE_SHA,
    schema: RAW_CAPTURE_MANIFEST_SCHEMA,
  }));
  const manifestReceipt = await writeStreamingEncryptedArtifact({
    artifactTypeHash: binding,
    directory: captureDirectory,
    filename: "capture-manifest.raw.enc",
    keyring: INTEGRATION_KEYRING,
    plaintextChunks: (async function* chunks() { yield canonicalizeJcs(manifest); }()),
  });
  return { captureDirectory, contract, manifestReceipt };
}

test("production S0 v2 keyed vector preserves wire text and has exact identity, streams, and roots", () => {
  const table = buildS0V2Table({
    hmacKey: KEY,
    table: KEYED_TABLE,
    typedRows: [typed(KEYED_TABLE, [
      "108",
      "phase1",
      "2026-08-10 12:34:56+00",
      "108_phase1.sql",
      null,
    ])],
  });
  assert.equal(table.records[0].identity_hmac_hex, "fff1f0fcf1d532005e62bba2d83188effe6be62a17607444560c58dc89bf80ba");
  assert.equal(table.records[0].row_id, "d0f5761f-ce10-5b6e-9888-37af970e9a8f");
  assert.equal(table.records[0].payload_hmac_hex, "80b8d4b0acfb9345188c768a7667e41b75d2bacd104f8d2708a7cbc6f646df22");
  assert.equal(table.records[0].occurrence_hmac_hex, "4b4bf6eaf92e2525fa3753d90c8171588b84f45ff2705ab201d11f3f1f6be7f5");
  assert.equal(table.records[0].occurrence_id, "67396a7c-3ccb-5bb2-b27a-7839f8e3cc86");
  assert.deepEqual(table.streams, {
    data: {
      bytes: 374,
      root_hex: "37829cbb8b048870c77fc1b212bfe83eb009bcfdd66c430efafa08089c5be7ce",
      sha256: "5404d7ad31d4607e02a63a8dd77289e25641e446b2be205cef1271a36c70816e",
    },
    occurrences: {
      bytes: 259,
      root_hex: "e657fd8a8faadb5f01b68ce8ee44623622e1de93cd1cdfd3b485ef0528852c0f",
      sha256: "a76e4b17600fb6eca8e6daff9d3b216d021981cff806340aa28badb0924ab7ac",
    },
  });
  assert.equal(table.table_root_hex, "f83ee9781e59e599f5f22ba66275d2e37f3741acb7e84cd4d56d5a57f2109f79");
});

test("production S0 v2 multiset vector groups by payload, ignores RAW ordinal, and sorts occurrence UUID ASCII", () => {
  const a = typed(MULTISET_TABLE, ["7", "2", null, "2026-01-02 03:04:05+00"]);
  const b = typed(MULTISET_TABLE, ["7", "3", "9", null]);
  const table = buildS0V2Table({
    hmacKey: KEY,
    table: MULTISET_TABLE,
    typedRows: [a, b, a],
  });
  assert.deepEqual(table.records.map((row) => row.occurrence_id), [
    "12d1537f-ef0f-5052-9a56-bccc16836310",
    "66dce593-9110-550c-89c8-9066c60efcc6",
    "81911d68-4d10-5b46-84ee-48a8c75b9692",
  ]);
  assert.deepEqual(table.records.map((row) => row.occurrence_hmac_hex), [
    "b34e56ed96f3cba112437b50c73dc100b49ff21e245e96490139be539d727142",
    "bc9d85b8f2c9ca2ef3a0ff927785d021a24bf7bef53ccd59bd9df702f9f21099",
    "cd9a0c6081c18e4320f62fba012eb9bacd3a5dfed495fe06c7dc4b1bb4bcb440",
  ]);
  assert.deepEqual(table.streams, {
    data: {
      bytes: 939,
      root_hex: "a1d6d80283cb2a10925dccb4b5ddf91c3849e1c41f5daf926274cef7a49d45ca",
      sha256: "4d72ef890ce2b6a4478c243eeb682df2b53c3211f6e62614008e2ebef058ddb9",
    },
    occurrences: {
      bytes: 786,
      root_hex: "f04d5d61fa089a1f1254cf9d308d1c87cf8f70d3324ff4195bc6165b2dc5d318",
      sha256: "eeea8f01eea096a738fe24ff99001641e3f2d9a15a717ab8e8576527d7da56cc",
    },
  });
  assert.equal(table.table_root_hex, "f25a281a15e8e0b92690bfca92bcf22511aac99144b44d06f8ef84976a6b2364");
});

test("global and content roots bind both base hashes and exact closed runtime provenance", () => {
  const keyed = buildS0V2Table({
    hmacKey: KEY,
    table: KEYED_TABLE,
    typedRows: [typed(KEYED_TABLE, ["108", "phase1", "2026-08-10 12:34:56+00", "108_phase1.sql", null])],
  });
  const a = typed(MULTISET_TABLE, ["7", "2", null, "2026-01-02 03:04:05+00"]);
  const multiset = buildS0V2Table({
    hmacKey: KEY,
    table: MULTISET_TABLE,
    typedRows: [a, a, typed(MULTISET_TABLE, ["7", "3", "9", null])],
  });
  const roots = computeS0V2GlobalRoots({
    baseContractFileSha256: FILE_SHA,
    baseContractJcsSha256: JCS_SHA,
    hmacKey: KEY,
    tables: [keyed, multiset],
  });
  assert.equal(roots.data_root_hex, "ff600a9dec008d134969ed6e6db5572273ed84c118b34c6ac5ba7ed30002c310");
  assert.equal(roots.occurrence_set_root_hex, "c07bc9752245f2b308fffab36b0cc175d00d99193b0e02acac4e8c100f65636e");
  const content = buildS0V2ContentDocument({
    addendumSha256: "aa".repeat(32),
    baseContractFileSha256: FILE_SHA,
    baseContractJcsSha256: JCS_SHA,
    counts: { columns: 9, rows: 4, tables: 2, views_queried: 0 },
    hmacKey: KEY,
    hmacKeyId: "vector-hmac-v1",
    input: {
      capture_sha256: "11".repeat(32),
      manifest_artifact_sha256: "22".repeat(32),
      manifest_content_sha256: "33".repeat(32),
      snapshot_sha256: "44".repeat(32),
      status: "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY",
    },
    roots,
    tables: [keyed, multiset],
  });
  assert.equal(content.content_root_hex, "e65c12b89e646c7ec2fde588150faa12cd33ac8fd48a331aa8469f34a393a215");
  assert.equal(Object.hasOwn(content.document, "content_root"), false);
  assert.deepEqual(Object.keys(content.document).sort(), [
    "addendum_sha256",
    "base_contract_bytes",
    "base_contract_file_sha256",
    "base_contract_jcs_sha256",
    "catchup_allowed",
    "counts",
    "data_root",
    "hmac_key_id",
    "input",
    "occurrence_set_root",
    "release_status",
    "routing_allowed",
    "schema",
    "status",
    "table_roots",
    "target_load_allowed",
  ]);
});

test("duplicate keyed identity fails the complete table and typed rows are strict canonical contract bytes", () => {
  const first = typed(KEYED_TABLE, ["108", "phase1", null, null, null]);
  const second = typed(KEYED_TABLE, ["108", "different payload", null, null, null]);
  assert.throws(
    () => buildS0V2Table({ hmacKey: KEY, table: KEYED_TABLE, typedRows: [first, second] }),
    /s0_v2_duplicate_source_identity/,
  );
  assert.throws(
    () => buildS0V2Table({
      hmacKey: KEY,
      table: KEYED_TABLE,
      typedRows: [Buffer.concat([first, Buffer.from("\n")])],
    }),
    /s0_v2_typed_row_invalid/,
  );
  assert.throws(
    () => buildS0V2Table({
      hmacKey: KEY,
      table: KEYED_TABLE,
      typedRows: [typed(KEYED_TABLE, [null, "phase1", null, null, null])],
    }),
    /s0_v2_source_not_null_violation/,
  );
});

test("offline converter turns an authenticated 77-file RAW fixture into one independently verified S0 v2 stream", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-convert-"));
  const output = path.join(root, "output");
  const snapshots = path.join(root, "snapshots");
  const work = path.join(root, "work");
  for (const directory of [root, output, snapshots, work]) {
    if (directory !== root) await mkdir(directory, { mode: 0o700 });
    await chmod(directory, 0o700);
  }
  try {
    const fixture = await createIntegrationRaw(root);
    const result = await convertRawCaptureToS0V2({
      captureDirectory: fixture.captureDirectory,
      contract: fixture.contract,
      detachedManifestArtifactSha256: fixture.manifestReceipt.artifact_sha256,
      directory: output,
      filename: "fixture.s0-v2.enc",
      keyring: INTEGRATION_KEYRING,
      snapshotParent: snapshots,
      statfsImpl: async () => ({ bavail: 100_000_000n, bsize: 4096n }),
      workDirectory: work,
    });
    assert.equal(result.publication_outcome, "PUBLISHED");
    const receipt = result.receipt;
    assert.deepEqual(receipt.counts, { columns: 759, rows: 4, tables: 76, views_queried: 0 });
    assert.deepEqual(await readdir(output), ["fixture.s0-v2.enc"]);
    assert.deepEqual(await readdir(snapshots), []);
    assert.deepEqual(await readdir(work), []);
    const verified = await verifyS0V2Candidate({
      contract: fixture.contract,
      expectedAddendumSha256: S0_V2_ADDENDUM_SHA256,
      expectedArtifactSha256: receipt.hashes.artifact_sha256,
      expectedInput: {
        capture_sha256: CAPTURE_SHA,
        manifest_artifact_sha256: fixture.manifestReceipt.artifact_sha256,
        manifest_content_sha256: fixture.manifestReceipt.content_sha256,
        snapshot_sha256: SNAPSHOT_SHA,
        status: "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY",
      },
      keyring: INTEGRATION_KEYRING,
      path: path.join(output, "fixture.s0-v2.enc"),
      workDirectory: work,
    });
    assert.deepEqual(verified.counts, receipt.counts);
    const originalArtifact = await readFile(path.join(output, "fixture.s0-v2.enc"));
    const second = await convertRawCaptureToS0V2({
      captureDirectory: fixture.captureDirectory,
      contract: fixture.contract,
      detachedManifestArtifactSha256: fixture.manifestReceipt.artifact_sha256,
      directory: output,
      filename: "fixture.s0-v2.enc",
      keyring: INTEGRATION_KEYRING,
      snapshotParent: snapshots,
      statfsImpl: async () => ({ bavail: 100_000_000n, bsize: 4096n }),
      workDirectory: work,
    });
    assert.equal(second.publication_outcome, "NOOP");
    assert.deepEqual(second.receipt, receipt);
    assert.equal(
      sha256Hex(await readFile(path.join(output, "fixture.s0-v2.enc"))),
      sha256Hex(originalArtifact),
    );
    assert.deepEqual(await readdir(output), ["fixture.s0-v2.enc"]);
    assert.deepEqual(await readdir(snapshots), []);
    assert.deepEqual(await readdir(work), []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("output-space failure occurs before RAW snapshot, sort, or candidate side effects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-no-output-space-"));
  const output = path.join(root, "output");
  const snapshots = path.join(root, "snapshots");
  const work = path.join(root, "work");
  for (const directory of [output, snapshots, work]) await mkdir(directory, { mode: 0o700 });
  try {
    const fixture = await createIntegrationRaw(root);
    await assert.rejects(
      convertRawCaptureToS0V2({
        captureDirectory: fixture.captureDirectory,
        contract: fixture.contract,
        detachedManifestArtifactSha256: fixture.manifestReceipt.artifact_sha256,
        directory: output,
        filename: "must-not-start.s0-v2.enc",
        keyring: INTEGRATION_KEYRING,
        snapshotParent: snapshots,
        statfsImpl: async () => ({ bavail: 1n, bsize: 4096n }),
        workDirectory: work,
      }),
      /s0_v2_insufficient_output_space/,
    );
    assert.deepEqual(await readdir(output), []);
    assert.deepEqual(await readdir(snapshots), []);
    assert.deepEqual(await readdir(work), []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("reference spill budget fails before candidate creation and cleans authenticated work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reference-space-"));
  const output = path.join(root, "output");
  const snapshots = path.join(root, "snapshots");
  const work = path.join(root, "work");
  for (const directory of [output, snapshots, work]) await mkdir(directory, { mode: 0o700 });
  try {
    const fixture = await createIntegrationRaw(root);
    await assert.rejects(
      convertRawCaptureToS0V2({
        captureDirectory: fixture.captureDirectory,
        contract: fixture.contract,
        detachedManifestArtifactSha256: fixture.manifestReceipt.artifact_sha256,
        directory: output,
        filename: "must-not-create-candidate.s0-v2.enc",
        keyring: INTEGRATION_KEYRING,
        snapshotParent: snapshots,
        statfsImpl: async (directory) => directory === output
          ? { bavail: BASE_OUTPUT_REQUIREMENT, bsize: 1n }
          : { bavail: 100_000_000n, bsize: 4096n },
        workDirectory: work,
      }),
      /s0_v2_insufficient_output_space/,
    );
    assert.deepEqual(await readdir(output), []);
    assert.deepEqual(await readdir(snapshots), []);
    assert.deepEqual(await readdir(work), []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("reference spill budget accepts the exact conservative boundary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reference-boundary-"));
  const output = path.join(root, "output");
  const snapshots = path.join(root, "snapshots");
  const work = path.join(root, "work");
  for (const directory of [output, snapshots, work]) await mkdir(directory, { mode: 0o700 });
  try {
    const fixture = await createIntegrationRaw(root);
    const result = await convertRawCaptureToS0V2({
      captureDirectory: fixture.captureDirectory,
      contract: fixture.contract,
      detachedManifestArtifactSha256: fixture.manifestReceipt.artifact_sha256,
      directory: output,
      filename: "exact-boundary.s0-v2.enc",
      keyring: INTEGRATION_KEYRING,
      snapshotParent: snapshots,
      statfsImpl: async (directory) => directory === output
        ? {
          bavail: BASE_OUTPUT_REQUIREMENT + FIXTURE_REFERENCE_SPILL_REQUIREMENT,
          bsize: 1n,
        }
        : { bavail: 100_000_000n, bsize: 4096n },
      workDirectory: work,
    });
    assert.equal(result.publication_outcome, "PUBLISHED");
    assert.deepEqual(await readdir(output), ["exact-boundary.s0-v2.enc"]);
    assert.deepEqual(await readdir(snapshots), []);
    assert.deepEqual(await readdir(work), []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("the 16 GiB artifact budget rejects an offending chunk before yielding it", async () => {
  const consumed = [];
  const chunks = (async function* source() {
    yield Buffer.alloc(5, 0x11);
    yield Buffer.alloc(4, 0x22);
  }());
  const iterator = boundedS0V2Plaintext(chunks, 8)[Symbol.asyncIterator]();
  const first = await iterator.next();
  consumed.push(first.value);
  assert.equal(first.done, false);
  assert.equal(first.value.length, 5);
  await assert.rejects(iterator.next(), /s0_v2_artifact_too_large/);
  assert.equal(consumed.length, 1);
});
