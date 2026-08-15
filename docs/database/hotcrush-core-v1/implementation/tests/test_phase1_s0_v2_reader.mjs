import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalizeJcs,
  canonicalizeTypedRow,
  sha256Hex,
} from "../etl/lib/canonical.mjs";
import { loadMigrationContract } from "../etl/lib/contract.mjs";
import { writeStreamingEncryptedArtifact } from "../etl/lib/envelope-stream.mjs";
import {
  RAW_CAPTURE_MANIFEST_SCHEMA,
  RAW_SHARD_SCHEMA,
  createRawHmacKeyCommitment,
} from "../etl/source-s0.mjs";
import {
  closeAuthenticatedRawCapture,
  issueAuthenticatedRawCaptureInputAuthority,
  iterateAuthenticatedRawCapture,
  openAuthenticatedRawCapture,
} from "../etl/lib/raw-capture-authenticated-reader.mjs";

const KEYRING = {
  kekId: "reader-fixture-kek-v1",
  kek: Buffer.alloc(32, 0x31),
  hmacKeyId: "reader-fixture-hmac-v1",
  hmacKey: Buffer.alloc(32, 0x42),
};
const CAPTURE = "11".repeat(32);
const SNAPSHOT = "44".repeat(32);
const WATERMARK = Object.freeze({
  source_transaction_timestamp: "2026-08-11T03:00:00.000000Z",
  wal_lsn: "0/16B6C50",
});

function frame(bytesInput) {
  const bytes = Buffer.from(bytesInput);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function rawTableRow(table) {
  if (table.name !== "schema_migrations") return [];
  return [canonicalizeTypedRow(table.name, [
    { name: "version", pg_type: "integer", raw: "108" },
    { name: "name", pg_type: "text", raw: "SENSITIVE-RAW-ROW-MARKER" },
    { name: "applied_at", pg_type: "timestamp with time zone", raw: "2026-08-10 12:34:56+00" },
    { name: "filename", pg_type: "text", raw: "108_phase1.sql" },
    { name: "checksum", pg_type: "text", raw: null },
  ])];
}

async function createRawFixture(root, { invalidManifest = false, tamperLastShard = false } = {}) {
  const contract = await loadMigrationContract();
  const contractSha256 = sha256Hex(canonicalizeJcs(contract));
  const captureDirectory = path.join(root, `raw-${CAPTURE}`);
  await mkdir(captureDirectory, { mode: 0o700 });
  const shards = [];
  for (const [index, table] of contract.source_tables.entries()) {
    const shardIndex = index + 1;
    const tableSha256 = sha256Hex(Buffer.from(table.name, "utf8"));
    const bindingSha256 = sha256Hex(canonicalizeJcs({
      capture_sha256: CAPTURE,
      contract_sha256: contractSha256,
      schema: RAW_SHARD_SCHEMA,
      shard_index: shardIndex,
      snapshot_sha256: SNAPSHOT,
      table_sha256: tableSha256,
    }));
    const rows = rawTableRow(table);
    const rowFrames = rows.map(frame);
    const rowHash = createHash("sha256");
    for (const rowFrame of rowFrames) rowHash.update(rowFrame);
    const plaintext = [
      frame(canonicalizeJcs({
        capture_sha256: CAPTURE,
        contract_sha256: contractSha256,
        fields: table.fields.map((field) => ({
          name: field.name,
          nullable: field.nullable,
          pg_type: field.data_type,
        })),
        frame: "HEADER",
        schema: RAW_SHARD_SCHEMA,
        shard_index: shardIndex,
        snapshot_sha256: SNAPSHOT,
        status: "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY",
        table: table.name,
        table_sha256: tableSha256,
        watermark: WATERMARK,
      })),
      ...rowFrames,
      frame(canonicalizeJcs({
        frame: "TRAILER",
        row_count: rows.length,
        row_stream_sha256: rowHash.digest("hex"),
        schema: RAW_SHARD_SCHEMA,
      })),
    ];
    const receipt = await writeStreamingEncryptedArtifact({
      artifactTypeHash: bindingSha256,
      directory: captureDirectory,
      filename: `${String(shardIndex).padStart(3, "0")}.raw.enc`,
      keyring: KEYRING,
      plaintextChunks: (async function* chunks() {
        for (const bytes of plaintext) yield bytes;
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
  const rows = shards.reduce((sum, shard) => sum + shard.counts.rows, 0);
  const manifest = {
    capture_sha256: CAPTURE,
    counts: { columns: 759, rows, shards: 76, views_queried: 0 },
    hashes: {
      catalog_sha256: "55".repeat(32),
      contract_sha256: contractSha256,
      shard_set_sha256: sha256Hex(canonicalizeJcs(shards)),
      snapshot_sha256: SNAPSHOT,
    },
    hmac_key_commitment: createRawHmacKeyCommitment({
      captureSha256: CAPTURE,
      contractSha256,
      hmacKey: KEYRING.hmacKey,
      hmacKeyId: KEYRING.hmacKeyId,
      snapshotSha256: SNAPSHOT,
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
    capture_sha256: CAPTURE,
    schema: RAW_CAPTURE_MANIFEST_SCHEMA,
  }));
  const manifestReceipt = await writeStreamingEncryptedArtifact({
    artifactTypeHash: manifestBinding,
    directory: captureDirectory,
    filename: "capture-manifest.raw.enc",
    keyring: KEYRING,
    plaintextChunks: (async function* chunks() {
      yield invalidManifest ? Buffer.from("NOT-CANONICAL-MANIFEST", "utf8") : canonicalizeJcs(manifest);
    }()),
  });
  if (tamperLastShard) {
    const last = path.join(captureDirectory, "076.raw.enc");
    const bytes = await readFile(last);
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    await writeFile(last, bytes, { mode: 0o600 });
  }
  return { captureDirectory, contract, manifestReceipt };
}

function readerOptions(fixture, snapshotParent, detached = fixture.manifestReceipt.artifact_sha256) {
  return {
    captureDirectory: fixture.captureDirectory,
    contract: fixture.contract,
    detachedManifestArtifactSha256: detached,
    keyring: KEYRING,
    resourcePolicy: {
      freeSpaceReserveBytes: 0,
      maxArtifactBytes: 16 * 1024 * 1024,
      maxFrameBytes: 128 * 1024 * 1024,
      temporaryDiskMultiplier: 2,
    },
    snapshotParent,
    statfsImpl: async () => ({ bavail: 1_000_000n, bsize: 4096n }),
  };
}

test("reader copies an exact encrypted private snapshot and authenticates all 77 files before row parsing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reader-source-"));
  const snapshotParent = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reader-snapshot-"));
  await chmod(root, 0o700);
  await chmod(snapshotParent, 0o700);
  try {
    const fixture = await createRawFixture(root);
    let parsedFrames = 0;
    const capability = await openAuthenticatedRawCapture(readerOptions(fixture, snapshotParent));
    assert.equal(parsedFrames, 0);
    assert.equal(capability.status, "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY");
    assert.equal(capability.capture_sha256, CAPTURE);
    assert.equal(capability.snapshot_sha256, SNAPSHOT);
    assert.equal(capability.manifest_content_sha256, fixture.manifestReceipt.content_sha256);
    assert.deepEqual(capability.counts, { columns: 759, rows: 1, shards: 76, views_queried: 0 });
    const snapshotFiles = await readdir(capability.snapshot_directory);
    assert.equal(snapshotFiles.length, 77);
    for (const filename of snapshotFiles) {
      const source = await lstat(path.join(fixture.captureDirectory, filename));
      const copied = await lstat(path.join(capability.snapshot_directory, filename));
      assert.equal(copied.mode & 0o777, 0o600);
      assert.equal(copied.nlink, 1);
      assert.notEqual(`${source.dev}:${source.ino}`, `${copied.dev}:${copied.ino}`);
      assert.equal(
        (await readFile(path.join(capability.snapshot_directory, filename)))
          .includes(Buffer.from("SENSITIVE-RAW-ROW-MARKER")),
        false,
      );
    }
    const events = [];
    for await (const event of iterateAuthenticatedRawCapture(capability)) {
      parsedFrames += 1;
      events.push(event);
    }
    assert.equal(events.filter((event) => event.type === "TABLE_START").length, 76);
    assert.equal(events.filter((event) => event.type === "TABLE_END").length, 76);
    const row = events.find((event) => event.type === "ROW");
    assert.equal(row.table, "schema_migrations");
    assert.equal(row.typed_row_bytes.includes(Buffer.from("SENSITIVE-RAW-ROW-MARKER")), true);
    await closeAuthenticatedRawCapture(capability);
    assert.deepEqual(await readdir(snapshotParent), []);
    await assert.rejects(
      async () => {
        for await (const _event of iterateAuthenticatedRawCapture(capability)) { /* closed */ }
      },
      /raw_capture_capability_closed/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
    await rm(snapshotParent, { force: true, recursive: true });
  }
});

test("RAW input authority exists only after one complete authenticated consumption", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reader-authority-"));
  const snapshotParent = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reader-authority-snapshot-"));
  await chmod(root, 0o700);
  await chmod(snapshotParent, 0o700);
  let capability;
  try {
    const fixture = await createRawFixture(root);
    capability = await openAuthenticatedRawCapture(readerOptions(fixture, snapshotParent));
    assert.throws(
      () => issueAuthenticatedRawCaptureInputAuthority(capability),
      /raw_capture_capability_invalid/,
    );
    const partial = iterateAuthenticatedRawCapture(capability)[Symbol.asyncIterator]();
    assert.equal((await partial.next()).done, false);
    await partial.return();
    assert.throws(
      () => issueAuthenticatedRawCaptureInputAuthority(capability),
      /raw_capture_capability_invalid/,
    );
    for await (const _event of iterateAuthenticatedRawCapture(capability)) { /* consume */ }
    assert.doesNotThrow(() => issueAuthenticatedRawCaptureInputAuthority(capability));
    await assert.rejects(
      async () => {
        for await (const _event of iterateAuthenticatedRawCapture(capability)) { /* consumed */ }
      },
      /raw_capture_capability_consumed/,
    );
  } finally {
    if (capability) await closeAuthenticatedRawCapture(capability).catch(() => {});
    await rm(root, { force: true, recursive: true });
    await rm(snapshotParent, { force: true, recursive: true });
  }
});

test("reader rejects detached-hash, tamper, missing, extra, symlink, hardlink, and mode drift without retaining a snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reader-reject-"));
  const snapshotParent = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reader-reject-snapshot-"));
  await chmod(root, 0o700);
  await chmod(snapshotParent, 0o700);
  try {
    const fixture = await createRawFixture(root);
    await assert.rejects(
      openAuthenticatedRawCapture(readerOptions(fixture, snapshotParent, "99".repeat(32))),
      /raw_capture_manifest_artifact_hash_mismatch/,
    );
    assert.deepEqual(await readdir(snapshotParent), []);

    await assert.rejects(
      openAuthenticatedRawCapture({
        ...readerOptions(fixture, snapshotParent),
        statfsImpl: async () => ({ bavail: 1n, bsize: 1n }),
      }),
      /raw_capture_insufficient_snapshot_space/,
    );
    assert.deepEqual(await readdir(snapshotParent), []);

    const extra = path.join(fixture.captureDirectory, "extra.raw.enc");
    await writeFile(extra, Buffer.from("not allowed"), { mode: 0o600 });
    await assert.rejects(openAuthenticatedRawCapture(readerOptions(fixture, snapshotParent)), /raw_capture_file_set_mismatch/);
    await unlink(extra);

    const first = path.join(fixture.captureDirectory, "001.raw.enc");
    const held = `${first}.held`;
    await rename(first, held);
    await assert.rejects(openAuthenticatedRawCapture(readerOptions(fixture, snapshotParent)), /raw_capture_file_set_mismatch/);
    await rename(held, first);

    await chmod(first, 0o644);
    await assert.rejects(openAuthenticatedRawCapture(readerOptions(fixture, snapshotParent)), /raw_capture_file_unsafe/);
    await chmod(first, 0o600);

    const hard = path.join(fixture.captureDirectory, "hardlink.fixture");
    await link(first, hard);
    await assert.rejects(openAuthenticatedRawCapture(readerOptions(fixture, snapshotParent)), /raw_capture_file_set_mismatch|raw_capture_file_unsafe/);
    await unlink(hard);

    const symlinkHeld = path.join(root, "symlink-target.enc");
    await rename(first, symlinkHeld);
    await symlink(symlinkHeld, first);
    await assert.rejects(openAuthenticatedRawCapture(readerOptions(fixture, snapshotParent)), /raw_capture_file_unsafe/);
    await unlink(first);
    await rename(symlinkHeld, first);
    assert.deepEqual(await readdir(snapshotParent), []);

    const tamperedRoot = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reader-tampered-"));
    await chmod(tamperedRoot, 0o700);
    try {
      const tampered = await createRawFixture(tamperedRoot, { tamperLastShard: true });
      await assert.rejects(
        openAuthenticatedRawCapture(readerOptions(tampered, snapshotParent)),
        /raw_capture_shard_authentication_failed/,
      );
      assert.deepEqual(await readdir(snapshotParent), []);
    } finally {
      await rm(tamperedRoot, { force: true, recursive: true });
    }

    const precedenceRoot = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-reader-precedence-"));
    await chmod(precedenceRoot, 0o700);
    try {
      const precedence = await createRawFixture(precedenceRoot, {
        invalidManifest: true,
        tamperLastShard: true,
      });
      await assert.rejects(
        openAuthenticatedRawCapture(readerOptions(precedence, snapshotParent)),
        /raw_capture_shard_authentication_failed/,
      );
      assert.deepEqual(await readdir(snapshotParent), []);
    } finally {
      await rm(precedenceRoot, { force: true, recursive: true });
    }
  } finally {
    await rm(root, { force: true, recursive: true });
    await rm(snapshotParent, { force: true, recursive: true });
  }
});
