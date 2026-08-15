import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalizeJcs, canonicalizeTypedRow, sha256Hex } from "../etl/lib/canonical.mjs";
import { loadMigrationContract } from "../etl/lib/contract.mjs";
import { writeStreamingEncryptedArtifact } from "../etl/lib/envelope-stream.mjs";
import {
  closeAuthenticatedRawCapture,
  issueAuthenticatedRawCaptureInputAuthority,
  iterateAuthenticatedRawCapture,
  openAuthenticatedRawCapture,
} from "../etl/lib/raw-capture-authenticated-reader.mjs";
import {
  buildS0V2ContentDocument,
  buildS0V2Table,
  computeS0V2GlobalRoots,
} from "../etl/lib/s0-v2-format.mjs";
import { S0_V2_ADDENDUM_SHA256 } from "../etl/s0-v2-addendum-release.mjs";
import { convertRawCaptureToS0V2 } from "../etl/s0-v2-convert.mjs";
import { writeVerifiedS0V2Candidate } from "../etl/lib/s0-v2-writer.mjs";
import {
  closeReferenceEncryptedSorter,
  createReferenceEncryptedSorter,
  iterateReferenceEncryptedSorter,
  pushReferenceEncryptedSorter,
  referenceBuildS0V2ContentDocument,
  referenceBuildS0V2Table,
  referenceComputeS0V2GlobalRoots,
  sealReferenceEncryptedSorter,
} from "../etl/reference/s0-v2-reference-sort.mjs";
import { verifyS0V2Candidate } from "../etl/reference/s0-v2-reference-verifier.mjs";
import {
  RAW_CAPTURE_MANIFEST_SCHEMA,
  RAW_SHARD_SCHEMA,
  createRawHmacKeyCommitment,
} from "../etl/source-s0.mjs";

const HMAC_KEY = Buffer.from(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "hex",
);
const KEYRING = {
  kekId: "s0-v2-reference-kek-v1",
  kek: Buffer.alloc(32, 0x51),
  hmacKeyId: "vector-hmac-v1",
  hmacKey: HMAC_KEY,
};
const FILE_SHA = "7ea542ef1e654b094628bbb97868b28a963879a4815740f7fa4f65c8c60d8587";
const JCS_SHA = "4fb6c9acb9decfe873f9e44e954e1af5d7a6d7fc1005e529979bb6a584cc814f";
const CAPTURE_SHA = "11".repeat(32);
const SNAPSHOT_SHA = "44".repeat(32);
const WATERMARK = Object.freeze({
  source_transaction_timestamp: "2026-08-11T03:00:00.000000Z",
  wal_lsn: "0/16B6C50",
});
const ENOUGH_OUTPUT_SPACE = async () => ({ bavail: 100_000_000n, bsize: 4096n });

function typed(table, values) {
  return canonicalizeTypedRow(table.name, table.fields.map((field, index) => ({
    name: field.name,
    pg_type: field.data_type,
    raw: values[index],
  })));
}

function rowsFor(table) {
  if (table.name === "schema_migrations") {
    return [typed(table, ["108", "phase1", "2026-08-10 12:34:56+00", "108_phase1.sql", null])];
  }
  if (table.name === "app_user_role_pre083") {
    const a = typed(table, ["7", "2", null, "2026-01-02 03:04:05+00"]);
    return [a, typed(table, ["7", "3", "9", null]), a];
  }
  return [];
}

function framed(bytesInput) {
  const bytes = Buffer.from(bytesInput);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

async function authenticatedInputAuthority(contract) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reference-raw-"));
  const snapshots = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reference-snapshot-"));
  await chmod(root, 0o700);
  await chmod(snapshots, 0o700);
  const captureDirectory = path.join(root, `raw-${CAPTURE_SHA}`);
  const workDirectory = path.join(root, "work");
  await mkdir(captureDirectory, { mode: 0o700 });
  await mkdir(workDirectory, { mode: 0o700 });
  const contractSha256 = sha256Hex(canonicalizeJcs(contract));
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
    const rows = rowsFor(table);
    const rowHash = createHash("sha256");
    for (const row of rows) rowHash.update(framed(row));
    const receipt = await writeStreamingEncryptedArtifact({
      artifactTypeHash: bindingSha256,
      directory: captureDirectory,
      filename: `${String(shardIndex).padStart(3, "0")}.raw.enc`,
      keyring: KEYRING,
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
      hmacKey: KEYRING.hmacKey,
      hmacKeyId: KEYRING.hmacKeyId,
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
  const manifestBinding = sha256Hex(canonicalizeJcs({
    capture_sha256: CAPTURE_SHA,
    schema: RAW_CAPTURE_MANIFEST_SCHEMA,
  }));
  const manifestReceipt = await writeStreamingEncryptedArtifact({
    artifactTypeHash: manifestBinding,
    directory: captureDirectory,
    filename: "capture-manifest.raw.enc",
    keyring: KEYRING,
    plaintextChunks: (async function* chunks() { yield canonicalizeJcs(manifest); }()),
  });
  const capabilities = [];
  async function openAuthority() {
    const capability = await openAuthenticatedRawCapture({
      captureDirectory,
      contract,
      detachedManifestArtifactSha256: manifestReceipt.artifact_sha256,
      keyring: KEYRING,
      resourcePolicy: {
        freeSpaceReserveBytes: 0,
        maxArtifactBytes: 16 * 1024 * 1024,
        maxFrameBytes: 128 * 1024 * 1024,
        temporaryDiskMultiplier: 2,
      },
      snapshotParent: snapshots,
      statfsImpl: async () => ({ bavail: 1_000_000n, bsize: 4096n }),
    });
    capabilities.push(capability);
    for await (const _event of iterateAuthenticatedRawCapture(capability)) {
      // Complete authenticated consumption is mandatory before an input authority can exist.
    }
    return {
      authority: issueAuthenticatedRawCaptureInputAuthority(capability),
      releaseSources: () => closeAuthenticatedRawCapture(capability),
    };
  }
  const initial = await openAuthority();
  return {
    authority: initial.authority,
    expectedInput: {
      capture_sha256: CAPTURE_SHA,
      manifest_artifact_sha256: manifestReceipt.artifact_sha256,
      manifest_content_sha256: manifestReceipt.content_sha256,
      snapshot_sha256: SNAPSHOT_SHA,
      status: "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY",
    },
    snapshotParent: snapshots,
    workDirectory,
    async convert({ directory, filename, statfsImpl = ENOUGH_OUTPUT_SPACE, testHooks } = {}) {
      await initial.releaseSources();
      return convertRawCaptureToS0V2({
        captureDirectory,
        contract,
        detachedManifestArtifactSha256: manifestReceipt.artifact_sha256,
        directory,
        filename,
        keyring: KEYRING,
        snapshotParent: snapshots,
        statfsImpl,
        ...(testHooks === undefined ? {} : { testHooks }),
        workDirectory,
      });
    },
    async close() {
      await Promise.allSettled(capabilities.map((capability) =>
        closeAuthenticatedRawCapture(capability)));
      await rm(root, { force: true, recursive: true });
      await rm(snapshots, { force: true, recursive: true });
    },
    releaseSources: initial.releaseSources,
    reopen: openAuthority,
  };
}

async function fullFixture(addendumSha256 = S0_V2_ADDENDUM_SHA256) {
  const contract = await loadMigrationContract();
  const tables = contract.source_tables.map((table) => buildS0V2Table({
    hmacKey: HMAC_KEY,
    table,
    typedRows: rowsFor(table),
  }));
  const roots = computeS0V2GlobalRoots({
    baseContractFileSha256: FILE_SHA,
    baseContractJcsSha256: JCS_SHA,
    hmacKey: HMAC_KEY,
    tables,
  });
  const source = await authenticatedInputAuthority(contract);
  const content = buildS0V2ContentDocument({
    addendumSha256,
    baseContractFileSha256: FILE_SHA,
    baseContractJcsSha256: JCS_SHA,
    counts: { columns: 759, rows: 4, tables: 76, views_queried: 0 },
    hmacKey: HMAC_KEY,
    hmacKeyId: KEYRING.hmacKeyId,
    input: source.expectedInput,
    roots,
    tables,
  });
  return {
    content,
    contract,
    inputAuthority: source.authority,
    releaseSources: source.releaseSources,
    source,
    tables,
  };
}

test("clean-room vector implementation independently reproduces every fixed keyed, multiset, and global root", async () => {
  const contract = await loadMigrationContract();
  const selected = ["schema_migrations", "app_user_role_pre083"].map((name) =>
    contract.source_tables.find((table) => table.name === name));
  const referenceTables = selected.map((table) => referenceBuildS0V2Table({
    hmacKey: HMAC_KEY,
    table,
    typedRows: rowsFor(table),
  }));
  const productionTables = selected.map((table) => buildS0V2Table({
    hmacKey: HMAC_KEY,
    table,
    typedRows: rowsFor(table),
  }));
  assert.deepEqual(
    referenceTables.map((table) => ({
      records: table.records.map((record) => ({
        identity_hmac_hex: record.identity_hmac_hex,
        occurrence_hmac_hex: record.occurrence_hmac_hex,
        occurrence_id: record.occurrence_id,
        payload_hmac_hex: record.payload_hmac_hex,
        row_id: record.row_id,
      })),
      streams: table.streams,
      table: table.table,
      table_root_hex: table.table_root_hex,
    })),
    productionTables.map((table) => ({
      records: table.records.map((record) => ({
        identity_hmac_hex: record.identity_hmac_hex,
        occurrence_hmac_hex: record.occurrence_hmac_hex,
        occurrence_id: record.occurrence_id,
        payload_hmac_hex: record.payload_hmac_hex,
        row_id: record.row_id,
      })),
      streams: table.streams,
      table: table.table,
      table_root_hex: table.table_root_hex,
    })),
  );
  const roots = referenceComputeS0V2GlobalRoots({
    baseContractFileSha256: FILE_SHA,
    baseContractJcsSha256: JCS_SHA,
    hmacKey: HMAC_KEY,
    tables: referenceTables,
  });
  assert.equal(roots.data_root_hex, "ff600a9dec008d134969ed6e6db5572273ed84c118b34c6ac5ba7ed30002c310");
  assert.equal(roots.occurrence_set_root_hex, "c07bc9752245f2b308fffab36b0cc175d00d99193b0e02acac4e8c100f65636e");
  const content = referenceBuildS0V2ContentDocument({
    addendumSha256: "aa".repeat(32),
    baseContractFileSha256: FILE_SHA,
    baseContractJcsSha256: JCS_SHA,
    counts: { columns: 9, rows: 4, tables: 2, views_queried: 0 },
    hmacKey: HMAC_KEY,
    hmacKeyId: "vector-hmac-v1",
    input: {
      capture_sha256: "11".repeat(32),
      manifest_artifact_sha256: "22".repeat(32),
      manifest_content_sha256: "33".repeat(32),
      snapshot_sha256: "44".repeat(32),
      status: "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY",
    },
    roots,
    tables: referenceTables,
  });
  assert.equal(content.content_root_hex, "e65c12b89e646c7ec2fde588150faa12cd33ac8fd48a331aa8469f34a393a215");
});

test("clean-room verifier spill sort is independently bounded, encrypted, and cleanup-complete", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reference-spill-"));
  await chmod(directory, 0o700);
  const policy = {
    maxMemoryBytes: 4096,
    maxMergePasses: 8,
    maxOpenRuns: 2,
    maxRecordBytes: 256,
    maxRunBytes: 1024,
  };
  let sorter;
  try {
    await assert.rejects(
      createReferenceEncryptedSorter({
        policy: { ...policy, maxMemoryBytes: 1024 },
        workDirectory: directory,
      }),
      /reference_sort_policy_invalid/,
    );
    assert.deepEqual(await readdir(directory), []);

    sorter = await createReferenceEncryptedSorter({ policy, workDirectory: directory });
    const expected = [];
    for (let index = 23; index >= 0; index -= 1) {
      const record = {
        key: index.toString(16).padStart(64, "0"),
        value: (23 - index).toString(16).padStart(32, "0"),
      };
      expected.push(record);
      await pushReferenceEncryptedSorter(sorter, record);
    }
    await sealReferenceEncryptedSorter(sorter);
    const [spillDirectoryName] = await readdir(directory);
    assert.match(spillDirectoryName, /^\.s0-v2-reference-sort-/);
    const spillDirectory = path.join(directory, spillDirectoryName);
    const spillFiles = await readdir(spillDirectory);
    assert.ok(spillFiles.length >= 1);
    for (const filename of spillFiles) {
      const spillPath = path.join(spillDirectory, filename);
      assert.equal((await lstat(spillPath)).mode & 0o777, 0o600);
      const ciphertext = await readFile(spillPath);
      assert.equal(ciphertext.includes(Buffer.from(expected[0].key, "utf8")), false);
      assert.equal(ciphertext.includes(Buffer.from(expected[0].value, "utf8")), false);
    }
    const actual = [];
    for await (const record of iterateReferenceEncryptedSorter(sorter)) {
      actual.push({ key: record.key, value: record.value });
    }
    assert.deepEqual(actual, expected.sort((left, right) =>
      left.key.localeCompare(right.key) || left.value.localeCompare(right.value)));
    await closeReferenceEncryptedSorter(sorter);
    sorter = undefined;
    assert.deepEqual(await readdir(directory), []);
  } finally {
    if (sorter) await closeReferenceEncryptedSorter(sorter).catch(() => {});
    await rm(directory, { force: true, recursive: true });
  }
});

test("writer publishes one encrypted stream only after clean-room verification and exposes a redacted receipt", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-writer-"));
  await chmod(directory, 0o700);
  let fixture;
  try {
    fixture = await fullFixture();
    const result = await fixture.source.convert({
      directory,
      filename: "fixture.s0-v2.enc",
      statfsImpl: ENOUGH_OUTPUT_SPACE,
    });
    assert.deepEqual(Object.keys(result).sort(), ["publication_outcome", "receipt"]);
    assert.equal(result.publication_outcome, "PUBLISHED");
    const receipt = result.receipt;
    assert.deepEqual(Object.keys(receipt).sort(), ["counts", "hashes", "schema", "status"]);
    assert.deepEqual(Object.keys(receipt.hashes).sort(), ["artifact_sha256", "artifact_type_sha256"]);
    assert.equal(receipt.status, "S0_ENCRYPTED_OFFLINE_VERIFIED_V2");
    assert.equal(receipt.schema, "hotcrush.r6.s0.offline.v2");
    assert.deepEqual(receipt.counts, { columns: 759, rows: 4, tables: 76, views_queried: 0 });
    assert.equal(JSON.stringify(receipt).includes(fixture.content.content_root), false);
    assert.deepEqual(await readdir(directory), ["fixture.s0-v2.enc"]);
    assert.equal((await lstat(path.join(directory, "fixture.s0-v2.enc"))).mode & 0o777, 0o600);
    assert.equal(
      (await readFile(path.join(directory, "fixture.s0-v2.enc")))
        .includes(Buffer.from("phase1", "utf8")),
      false,
    );

    const verified = await verifyS0V2Candidate({
      contract: fixture.contract,
      expectedAddendumSha256: S0_V2_ADDENDUM_SHA256,
      expectedArtifactSha256: receipt.hashes.artifact_sha256,
      expectedInput: fixture.content.document.input,
      keyring: KEYRING,
      path: path.join(directory, "fixture.s0-v2.enc"),
      workDirectory: directory,
    });
    assert.equal(verified.artifact_type_sha256, receipt.hashes.artifact_type_sha256);
    assert.equal(verified.content_root, fixture.content.content_root);
    assert.deepEqual(verified.counts, receipt.counts);
    await assert.rejects(
      verifyS0V2Candidate({
        contract: fixture.contract,
        expectedAddendumSha256: "de".repeat(32),
        expectedArtifactSha256: receipt.hashes.artifact_sha256,
        expectedInput: fixture.content.document.input,
        keyring: KEYRING,
        path: path.join(directory, "fixture.s0-v2.enc"),
        workDirectory: directory,
      }),
      /s0_v2_reference_verification_failed/,
    );
    await assert.rejects(
      verifyS0V2Candidate({
        contract: fixture.contract,
        expectedAddendumSha256: S0_V2_ADDENDUM_SHA256,
        expectedArtifactSha256: receipt.hashes.artifact_sha256,
        expectedInput: {
          ...fixture.content.document.input,
          capture_sha256: "99".repeat(32),
        },
        keyring: KEYRING,
        path: path.join(directory, "fixture.s0-v2.enc"),
        workDirectory: directory,
      }),
      /s0_v2_reference_verification_failed/,
    );

    const tampered = await readFile(path.join(directory, "fixture.s0-v2.enc"));
    tampered[Math.floor(tampered.length / 2)] ^= 1;
    await writeFile(path.join(directory, "fixture.s0-v2.enc"), tampered, { mode: 0o600 });
    await assert.rejects(
      verifyS0V2Candidate({
        contract: fixture.contract,
        expectedAddendumSha256: S0_V2_ADDENDUM_SHA256,
        expectedArtifactSha256: receipt.hashes.artifact_sha256,
        expectedInput: fixture.content.document.input,
        keyring: KEYRING,
        path: path.join(directory, "fixture.s0-v2.enc"),
        workDirectory: directory,
      }),
      /s0_v2_reference_verification_failed/,
    );
  } finally {
    await fixture?.source.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("an untrusted caller cannot inject poisoned rows into the reference-verification path", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-writer-reject-"));
  await chmod(directory, 0o700);
  let fixture;
  try {
    fixture = await fullFixture();
    const poisonedTables = fixture.tables.map((table) => {
      if (table.table !== "schema_migrations") return table;
      return {
        ...table,
        records: async function* poisonedRecords() {
          for (const record of table.records) {
            const typed = JSON.parse(record.typed_row_bytes.toString("utf8"));
            typed.values[1].raw = "reference-must-reject-this-payload";
            yield { ...record, typed_row_bytes: canonicalizeTypedRow(
              table.table,
              typed.values,
            ) };
          }
        },
      };
    });
    await assert.rejects(
      writeVerifiedS0V2Candidate({
        content: fixture.content,
        contract: fixture.contract,
        directory,
        filename: "must-not-publish.s0-v2.enc",
        inputAuthority: fixture.inputAuthority,
        keyring: KEYRING,
        releaseSources: fixture.releaseSources,
        statfsImpl: ENOUGH_OUTPUT_SPACE,
        tables: poisonedTables,
      }),
      /s0_v2_writer_conversion_authority_invalid/,
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await fixture?.source.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("writer rejects a self-consistent candidate whose RAW provenance differs from its authenticated authority", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-writer-provenance-"));
  await chmod(directory, 0o700);
  let fixture;
  try {
    fixture = await fullFixture();
    const roots = computeS0V2GlobalRoots({
      baseContractFileSha256: FILE_SHA,
      baseContractJcsSha256: JCS_SHA,
      hmacKey: HMAC_KEY,
      tables: fixture.tables,
    });
    const fakeContent = buildS0V2ContentDocument({
      addendumSha256: S0_V2_ADDENDUM_SHA256,
      baseContractFileSha256: FILE_SHA,
      baseContractJcsSha256: JCS_SHA,
      counts: { columns: 759, rows: 4, tables: 76, views_queried: 0 },
      hmacKey: HMAC_KEY,
      hmacKeyId: KEYRING.hmacKeyId,
      input: { ...fixture.source.expectedInput, capture_sha256: "99".repeat(32) },
      roots,
      tables: fixture.tables,
    });
    await assert.rejects(
      writeVerifiedS0V2Candidate({
        content: fakeContent,
        contract: fixture.contract,
        directory,
        filename: "fake-provenance.s0-v2.enc",
        inputAuthority: fixture.inputAuthority,
        keyring: KEYRING,
        statfsImpl: ENOUGH_OUTPUT_SPACE,
        tables: fixture.tables,
      }),
      /s0_v2_writer_content_invalid/,
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await fixture?.source.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("an authenticated RAW authority cannot publish same-count substituted rows into an empty destination", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-row-substitution-"));
  await chmod(directory, 0o700);
  let fixture;
  try {
    fixture = await fullFixture();
    const substitutedTables = fixture.contract.source_tables.map((table) => buildS0V2Table({
      hmacKey: HMAC_KEY,
      table,
      typedRows: table.name === "schema_migrations"
        ? [typed(table, [
          "108",
          "not-in-authenticated-raw",
          "2026-08-10 12:34:56+00",
          "108_phase1.sql",
          null,
        ])]
        : rowsFor(table),
    }));
    const roots = computeS0V2GlobalRoots({
      baseContractFileSha256: FILE_SHA,
      baseContractJcsSha256: JCS_SHA,
      hmacKey: HMAC_KEY,
      tables: substitutedTables,
    });
    const substitutedContent = buildS0V2ContentDocument({
      addendumSha256: S0_V2_ADDENDUM_SHA256,
      baseContractFileSha256: FILE_SHA,
      baseContractJcsSha256: JCS_SHA,
      counts: { columns: 759, rows: 4, tables: 76, views_queried: 0 },
      hmacKey: HMAC_KEY,
      hmacKeyId: KEYRING.hmacKeyId,
      input: fixture.source.expectedInput,
      roots,
      tables: substitutedTables,
    });
    await assert.rejects(
      writeVerifiedS0V2Candidate({
        content: substitutedContent,
        contract: fixture.contract,
        directory,
        filename: "must-not-publish.s0-v2.enc",
        inputAuthority: fixture.inputAuthority,
        keyring: KEYRING,
        statfsImpl: ENOUGH_OUTPUT_SPACE,
        tables: substitutedTables,
      }),
      /s0_v2_writer_conversion_authority_invalid/,
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await fixture?.source.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("publication crash matrix is fail-closed, recoverable, and idempotent without receipt drift", async () => {
  for (const scenario of [
    { hook: "afterLink", retryOutcome: "RECOVERED_PUBLISHED" },
    { hook: "beforeCandidateUnlink", retryOutcome: "RECOVERED_PUBLISHED" },
    { hook: "afterCandidateUnlink", retryOutcome: "RECOVERED_PUBLISHED" },
    { hook: "beforeDirectorySync", retryOutcome: "RECOVERED_PUBLISHED" },
    { hook: "beforeTemporaryRemove", retryOutcome: "RECOVERED_PUBLISHED" },
    { hook: "beforeFinalDirectorySync", retryOutcome: "NOOP" },
  ]) {
    const { hook, retryOutcome } = scenario;
    const directory = await mkdtemp(path.join(os.tmpdir(), `hc-s0-v2-publish-${hook}-`));
    await chmod(directory, 0o700);
    let fixture;
    try {
      fixture = await fullFixture();
      const filename = "recoverable.s0-v2.enc";
      await assert.rejects(
        fixture.source.convert({
          directory,
          filename,
          statfsImpl: ENOUGH_OUTPUT_SPACE,
          testHooks: { [hook]: async () => { throw new Error(`fault:${hook}`); } },
        }),
        /PUBLISH_OUTCOME_UNKNOWN/,
      );
      const finalPath = path.join(directory, filename);
      assert.equal((await lstat(finalPath)).isFile(), true);

      const recovered = await fixture.source.convert({
        directory,
        filename,
        statfsImpl: ENOUGH_OUTPUT_SPACE,
      });
      assert.equal(recovered.publication_outcome, retryOutcome);
      assert.equal((await lstat(finalPath)).nlink, 1);
      assert.deepEqual(await readdir(directory), [filename]);
      const publishedBytes = await readFile(finalPath);

      const noop = await fixture.source.convert({
        directory,
        filename,
        statfsImpl: ENOUGH_OUTPUT_SPACE,
      });
      assert.equal(noop.publication_outcome, "NOOP");
      assert.deepEqual(noop.receipt, recovered.receipt);
      assert.deepEqual(await readFile(finalPath), publishedBytes);
      assert.deepEqual(await readdir(directory), [filename]);
    } finally {
      await fixture?.source.close();
      await rm(directory, { force: true, recursive: true });
    }
  }
});

test("a failed pre-link cleanup leaves a blocking residue and retry starts no new RAW work", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-prelink-residue-"));
  await chmod(directory, 0o700);
  let fixture;
  try {
    fixture = await fullFixture();
    const filename = "must-remain-blocked.s0-v2.enc";
    await assert.rejects(
      fixture.source.convert({
        directory,
        filename,
        testHooks: {
          beforeLink: async () => { throw new Error("fixture_prelink_failure"); },
          beforeUnpublishedCleanup: async () => { throw new Error("fixture_cleanup_failure"); },
        },
      }),
      (error) => {
        assert.equal(error.message, "fixture_prelink_failure");
        assert.equal(error.cleanupFailure?.message, "fixture_cleanup_failure");
        return true;
      },
    );
    const residue = (await readdir(directory)).filter((name) =>
      name.startsWith(".s0-v2-candidate-"));
    assert.equal(residue.length, 1);
    assert.equal((await readdir(directory)).includes(filename), false);

    await assert.rejects(
      fixture.source.convert({ directory, filename }),
      /PUBLISH_PRELINK_RESIDUE_BLOCKED/,
    );
    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.startsWith(".s0-v2-candidate-")),
      residue,
    );
    assert.equal((await readdir(directory)).includes(filename), false);
    assert.deepEqual(await readdir(fixture.source.snapshotParent), []);
    assert.deepEqual(await readdir(fixture.source.workDirectory), []);
  } finally {
    await fixture?.source.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("an existing artifact whose bytes drift rejects retry without overwriting it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-destination-conflict-"));
  await chmod(directory, 0o700);
  let fixture;
  try {
    fixture = await fullFixture();
    const filename = "immutable.s0-v2.enc";
    await fixture.source.convert({
      directory,
      filename,
      statfsImpl: ENOUGH_OUTPUT_SPACE,
    });
    const finalPath = path.join(directory, filename);
    const drifted = await readFile(finalPath);
    drifted[Math.floor(drifted.length / 2)] ^= 1;
    await writeFile(finalPath, drifted, { mode: 0o600 });
    await assert.rejects(
      fixture.source.convert({
        directory,
        filename,
        statfsImpl: ENOUGH_OUTPUT_SPACE,
      }),
      /DESTINATION_CONFLICT/,
    );
    assert.deepEqual(await readFile(finalPath), drifted);
    assert.deepEqual(await readdir(directory), [filename]);
  } finally {
    await fixture?.source.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("writer binds the content document to the independently pinned addendum release", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-writer-anchor-"));
  await chmod(directory, 0o700);
  let fixture;
  try {
    fixture = await fullFixture("de".repeat(32));
    await assert.rejects(
      writeVerifiedS0V2Candidate({
        content: fixture.content,
        contract: fixture.contract,
        directory,
        filename: "fake-anchor.s0-v2.enc",
        inputAuthority: fixture.inputAuthority,
        keyring: KEYRING,
        tables: fixture.tables,
      }),
      /s0_v2_writer_content_invalid/,
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await fixture?.source.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("an untrusted direct writer caller cannot trigger its supplied source-cleanup callback", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-writer-release-"));
  await chmod(directory, 0o700);
  let fixture;
  try {
    fixture = await fullFixture();
    let releaseCalls = 0;
    await assert.rejects(
      writeVerifiedS0V2Candidate({
        content: fixture.content,
        contract: fixture.contract,
        directory,
        filename: "must-not-publish.s0-v2.enc",
        inputAuthority: fixture.inputAuthority,
        keyring: KEYRING,
        releaseSources: async () => {
          releaseCalls += 1;
          throw new Error("fixture_source_cleanup_failed");
        },
        tables: fixture.tables,
      }),
      /s0_v2_writer_conversion_authority_invalid/,
    );
    assert.equal(releaseCalls, 0);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await fixture?.source.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test("clean-room verifier import graph cannot reach production identity, root, sort, envelope, router, or converter", async () => {
  const verifierSource = await readFile(
    new URL("../etl/reference/s0-v2-reference-verifier.mjs", import.meta.url),
    "utf8",
  );
  const sortSource = await readFile(
    new URL("../etl/reference/s0-v2-reference-sort.mjs", import.meta.url),
    "utf8",
  );
  const imports = [...`${verifierSource}\n${sortSource}`.matchAll(/from\s+["']([^"']+)["']/g)]
    .map((match) => match[1]);
  assert.ok(imports.length > 0);
  assert.ok(imports.every((specifier) =>
    specifier.startsWith("node:") || specifier === "./s0-v2-reference-sort.mjs"));
  assert.doesNotMatch(
    `${verifierSource}\n${sortSource}`,
    /\.\.\/|canonical\.mjs|identity\.mjs|encrypted-external-sort|envelope|router|source-s0|s0-v2-convert/,
  );
});

test("writer and clean-room verifier reject proxy contracts without invoking traps", async () => {
  let traps = 0;
  const contract = new Proxy({}, {
    get() { traps += 1; throw new Error("proxy_get_executed"); },
    getOwnPropertyDescriptor() { traps += 1; throw new Error("proxy_descriptor_executed"); },
    ownKeys() { traps += 1; throw new Error("proxy_keys_executed"); },
  });
  await assert.rejects(
    verifyS0V2Candidate({
      contract,
      expectedAddendumSha256: S0_V2_ADDENDUM_SHA256,
      expectedArtifactSha256: "00".repeat(32),
      keyring: KEYRING,
      path: "/does/not/matter",
    }),
    /s0_v2_reference_verification_failed/,
  );
  await assert.rejects(
    writeVerifiedS0V2Candidate({
      content: {},
      contract,
      directory: "/does/not/matter",
      filename: "candidate.enc",
      keyring: KEYRING,
      tables: [],
    }),
    /s0_v2_writer_input_invalid/,
  );
  assert.equal(traps, 0);
});
