import assert from "node:assert/strict";
import { X509Certificate, createDecipheriv } from "node:crypto";
import { createRequire } from "node:module";
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalizeJcs, sha256Hex } from "../etl/lib/canonical.mjs";
import { loadMigrationContract } from "../etl/lib/contract.mjs";
import { verifyStreamingEncryptedArtifact } from "../etl/lib/envelope-stream.mjs";
import {
  SOURCE_DSN_KEYCHAIN,
  SOURCE_CAPTURE_INCIDENT_BOUNDARY,
  SOURCE_PROJECT_REF,
  SUPABASE_ROOT_CA_2021,
  SUPABASE_ROOT_CA_2021_FINGERPRINT,
  createPostgresJsSourceConnector,
  loadSourceDsnFromMacOSKeychain,
  validateSourceMvccSnapshot,
} from "../etl/lib/source-postgres.mjs";
import {
  RAW_CAPTURE_MANIFEST_SCHEMA,
  RAW_HMAC_KEY_COMMITMENT_DOMAIN,
  RAW_SHARD_SCHEMA,
  createRawHmacKeyCommitment,
  exportEncryptedRawSourceCapture,
  runRawSourceCaptureCli,
  verifyRawHmacKeyCommitment,
} from "../etl/source-s0.mjs";

const SOURCE_SNAPSHOT = JSON.parse(await readFile(
  new URL("../../evidence/current-schema-snapshot.json", import.meta.url),
  "utf8",
));
const VIEW_DEFINITIONS = new Map(
  SOURCE_SNAPSHOT.views.map((view) => [view.view_name, view.definition]),
);

const KEYRING = {
  kekId: "fixture-kek-v1",
  kek: Buffer.alloc(32, 0x31),
  hmacKeyId: "fixture-hmac-v1",
  hmacKey: Buffer.alloc(32, 0x42),
};

function wire(value) {
  return value === null ? null : Buffer.from(String(value), "utf8");
}

function decryptFixtureArtifact(bytes, expectedArtifactTypeHash) {
  const magic = Buffer.from("HOTCRUSH-AES256GCM-STREAM-V1\n", "ascii");
  assert.equal(bytes.subarray(0, magic.length).equals(magic), true);
  const headerLength = bytes.readUInt32BE(magic.length);
  const headerOffset = magic.length + 4;
  const headerBytes = bytes.subarray(headerOffset, headerOffset + headerLength);
  const header = JSON.parse(headerBytes.toString("utf8"));
  assert.equal(header.artifact_type_sha256, expectedArtifactTypeHash);
  const descriptor = Object.fromEntries([
    "alg",
    "artifact_type_sha256",
    "format",
    "hmac_key_id",
    "kek_id",
    "payload_iv",
    "wrap_iv",
  ].map((key) => [key, header[key]]));
  const unwrap = createDecipheriv(
    "aes-256-gcm",
    KEYRING.kek,
    Buffer.from(header.wrap_iv, "base64url"),
  );
  unwrap.setAAD(canonicalizeJcs(descriptor));
  unwrap.setAuthTag(Buffer.from(header.wrap_tag, "base64url"));
  const dek = Buffer.concat([
    unwrap.update(Buffer.from(header.wrapped_dek, "base64url")),
    unwrap.final(),
  ]);
  try {
    const payloadOffset = headerOffset + headerLength;
    const ciphertext = bytes.subarray(payloadOffset, -16);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      dek,
      Buffer.from(header.payload_iv, "base64url"),
    );
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } finally {
    dek.fill(0);
  }
}

function closeFailingOpen(onClose) {
  return async (...argumentsList) => {
    const handle = await open(...argumentsList);
    return {
      read: (...args) => handle.read(...args),
      stat: (...args) => handle.stat(...args),
      async close() {
        await handle.close();
        onClose();
        throw new Error("fixture_close_must_not_mask_result");
      },
    };
  };
}

function catalogRows(contract) {
  return [
    ...contract.source_tables.flatMap((table) => table.fields.map((field) => [
      wire(table.name),
      wire("r"),
      wire(field.ordinal),
      wire(field.name),
      wire(field.data_type),
      wire(field.nullable ? "t" : "f"),
    ])),
    ...contract.registered_views.flatMap((view) => view.fields.map((field) => [
      wire(view.name),
      wire("v"),
      wire(field.ordinal),
      wire(field.name),
      wire(field.data_type),
      wire(field.nullable ? "t" : "f"),
    ])),
  ];
}

function constraintRows(contract) {
  return contract.source_tables.flatMap((table) => {
    const constraints = [
      ...(table.identity.mode === "PRIMARY_KEY" ? [{
        columns: table.identity.columns,
        constraint_name: table.identity.constraint_name,
        constraint_type: "p",
      }] : []),
      ...table.observed_unique_constraints.map((unique) => ({
        ...unique,
        constraint_type: "u",
      })),
    ];
    return constraints.flatMap((constraint) => constraint.columns.map((column, index) => [
      wire(table.name),
      wire(constraint.constraint_name),
      wire(constraint.constraint_type),
      wire(index + 1),
      wire(column),
      wire("t"),
      wire("f"),
      wire("f"),
      wire("f"),
    ]));
  });
}

function viewDefinitionRows(contract) {
  return contract.registered_views.map((view) => [
    wire(view.name),
    wire(VIEW_DEFINITIONS.get(view.name)),
  ]);
}

function runtimeRow(
  version = "17.6",
  transactionTimestamp = "2026-08-11T03:00:00.000000Z",
  mvccSnapshot = "700:700:",
  databaseName = "postgres",
  inRecovery = false,
) {
  return [[
    wire(version),
    wire("serializable"),
    wire("on"),
    wire("on"),
    wire("ISO, YMD"),
    wire("iso_8601"),
    wire("UTC"),
    wire("hex"),
    wire("3"),
    wire("0/16B6C50"),
    wire(transactionTimestamp),
    wire(mvccSnapshot),
    wire(databaseName),
    wire(inRecovery ? "t" : "f"),
  ]];
}

function rowFor(table, marker = "SENSITIVE_FIXTURE_MARKER") {
  return table.fields.map((field, index) => wire(`${marker}-${index + 1}`));
}

function fakeSource(contract, {
  closeFails = false,
  beforeFailTable = null,
  driftCatalog = false,
  driftConstraint = false,
  driftViewDefinition = false,
  failTable = null,
  runtimeVersion = "17.6",
  transactionTimestamp = "2026-08-11T03:00:00.000000Z",
  mvccSnapshot = "700:700:",
  databaseName = "postgres",
  inRecovery = false,
  tableRows = null,
} = {}) {
  const state = {
    closeFinished: false,
    events: [],
    openCalls: 0,
    queries: [],
    streams: [],
    transactionOptions: null,
  };
  const rowsByTable = tableRows ?? new Map([
    ["appointments", [rowFor(contract.source_tables.find((table) => table.name === "appointments"))]],
  ]);
  const liveCatalog = catalogRows(contract);
  if (driftCatalog) liveCatalog.pop();
  const liveConstraints = constraintRows(contract);
  if (driftConstraint) liveConstraints[0][1] = wire("same_columns_but_wrong_constraint_name");
  const liveViewDefinitions = viewDefinitionRows(contract);
  if (driftViewDefinition) {
    liveViewDefinitions[0][1] = wire(`${liveViewDefinitions[0][1].toString("utf8")}\n-- drift`);
  }

  const transaction = {
    async query(sql, parameters = []) {
      state.queries.push({ parameters: structuredClone(parameters), sql });
      if (sql.startsWith("SET LOCAL ") || sql.startsWith("LOCK TABLE ")) return [];
      if (sql.includes("FROM pg_catalog.pg_constraint")) return liveConstraints;
      if (sql.includes("pg_get_viewdef")) return liveViewDefinitions;
      if (sql.includes("FROM pg_catalog.pg_class")) return liveCatalog;
      if (sql.includes("pg_current_wal_lsn")) {
        return runtimeRow(
          runtimeVersion,
          transactionTimestamp,
          mvccSnapshot,
          databaseName,
          inRecovery,
        );
      }
      throw new Error("unexpected_fake_query");
    },
    stream(sql, parameters = [], batchSize) {
      state.streams.push({ batchSize, parameters: structuredClone(parameters), sql });
      const match = /FROM "public"\."([^"]+)"/.exec(sql);
      if (!match) throw new Error("unexpected_fake_stream");
      const tableName = match[1].replaceAll('""', '"');
      return (async function* streamRows() {
        state.events.push(`stream:${tableName}`);
        if (failTable === tableName) {
          await beforeFailTable?.();
          throw new Error("fixture_stream_failed");
        }
        const rows = rowsByTable.get(tableName) ?? [];
        if (rows.length > 0) yield rows;
      }());
    },
  };
  const connection = {
    async close() {
      state.events.push("close:start");
      await Promise.resolve();
      if (closeFails) throw new Error("fixture_close_secret_must_not_leak");
      state.closeFinished = true;
      state.events.push("close:finish");
    },
    async transactionScope(options, callback) {
      state.transactionOptions = structuredClone(options);
      state.events.push("transaction:start");
      try {
        const result = await callback(transaction);
        state.events.push("transaction:commit");
        return result;
      } catch (error) {
        state.events.push("transaction:rollback");
        throw error;
      }
    },
  };
  return {
    createConnector: async (options) => {
      state.openCalls += 1;
      state.openOptions = structuredClone(options);
      state.events.push("open");
      return connection;
    },
    state,
  };
}

function assertPublicManifestShape(manifest) {
  assert.deepEqual(Object.keys(manifest).sort(), ["counts", "hashes", "watermark"]);
  assert.deepEqual(Object.keys(manifest.counts).sort(), ["columns", "rows", "shards", "views_queried"]);
  assert.deepEqual(
    Object.keys(manifest.hashes).sort(),
    ["capture_sha256", "manifest_artifact_sha256"],
  );
  assert.ok(Object.values(manifest.hashes).every((value) => /^[0-9a-f]{64}$/.test(value)));
  assert.deepEqual(Object.keys(manifest.watermark).sort(), ["source_transaction_timestamp", "wal_lsn"]);
  assert.match(manifest.watermark.wal_lsn, /^[0-9A-F]+\/[0-9A-F]+$/);
  assert.match(manifest.watermark.source_transaction_timestamp, /^2026-08-11T03:00:00\.000000Z$/);
  const serialized = canonicalizeJcs(manifest).toString("utf8");
  assert.doesNotMatch(
    serialized,
    /content_sha256|ecsgqcmwtjmcpzqytdqw|postgres(?:ql)?:|password|filename|path|table_sha256|hmac|commitment|mvcc|snapshot/i,
  );
}

test("default CLI is inert and does not read Keychain, load a driver, or open a source connection", async () => {
  const calls = [];
  const stdout = [];
  const result = await runRawSourceCaptureCli({
    argv: [],
    dependencies: {
      createConnector: () => calls.push("connector"),
      loadContract: () => calls.push("contract"),
      loadKeyring: () => calls.push("keyring"),
      loadSourceDsn: () => calls.push("dsn"),
    },
    stdout: { write: (chunk) => stdout.push(String(chunk)) },
  });
  assert.equal(result, 0);
  assert.deepEqual(calls, []);
  assert.deepEqual(JSON.parse(stdout.join("")), { status: "RAW_SOURCE_CAPTURE_DISABLED" });

  let flushed = false;
  await runRawSourceCaptureCli({
    argv: [],
    stdout: {
      write(_chunk, callback) {
        setImmediate(() => {
          flushed = true;
          callback();
        });
        return false;
      },
    },
  });
  assert.equal(flushed, true);
  await assert.rejects(
    runRawSourceCaptureCli({
      argv: ["--help"],
      stdout: {
        write(_chunk, callback) {
          setImmediate(() => callback(new Error("DO_NOT_LEAK_OUTPUT_DETAIL")));
          return false;
        },
      },
    }),
    (error) => error.message === "raw_capture_receipt_write_failed",
  );

  await assert.rejects(
    runRawSourceCaptureCli({
      argv: ["--export", "--output-dir", "/tmp"],
      dependencies: {
        createConnector: () => calls.push("connector"),
        loadContract: () => calls.push("contract"),
        loadKeyring: () => calls.push("keyring"),
        loadSourceDsn: () => calls.push("dsn"),
      },
      stdout: { write() {} },
    }),
    /--capture-encrypted-raw/,
  );
  assert.deepEqual(calls, []);
});

test("raw HMAC key commitment has a fixed closed vector and rejects a changed key universe", () => {
  const vector = {
    captureSha256: "11".repeat(32),
    contractSha256: "22".repeat(32),
    hmacKey: KEYRING.hmacKey,
    hmacKeyId: KEYRING.hmacKeyId,
    snapshotSha256: "33".repeat(32),
  };
  const commitment = createRawHmacKeyCommitment(vector);
  assert.deepEqual(commitment, {
    algorithm: "HMAC-SHA256",
    commitment_hmac_sha256: "fd2be047ad79389a8ad98dd5d4ef73240942d5621109d6d7f7da9bc3341887c3",
    domain: RAW_HMAC_KEY_COMMITMENT_DOMAIN,
    encoding: "ASCII_DOMAIN_NUL_THEN_JCS",
    hmac_key_id: KEYRING.hmacKeyId,
  });
  assert.doesNotThrow(() => verifyRawHmacKeyCommitment({ commitment, ...vector }));
  for (const mutation of [
    { hmacKey: Buffer.alloc(32, 0x43) },
    { captureSha256: "44".repeat(32) },
    { contractSha256: "55".repeat(32) },
    { snapshotSha256: "66".repeat(32) },
  ]) {
    assert.throws(
      () => verifyRawHmacKeyCommitment({ commitment, ...vector, ...mutation }),
      /raw_hmac_key_commitment_mismatch/,
    );
  }
  for (const commitmentMutation of [
    { domain: "hotcrush.r6.raw-source-hmac-key-commitment.v2" },
    { encoding: "UNVERSIONED" },
    { hmac_key_id: "same-bytes-wrong-id" },
  ]) {
    assert.throws(
      () => verifyRawHmacKeyCommitment({
        commitment: { ...commitment, ...commitmentMutation },
        ...vector,
      }),
      /raw_hmac_key_commitment_mismatch/,
    );
  }
  assert.throws(
    () => createRawHmacKeyCommitment({ ...vector, extra: true }),
    /invalid_raw_hmac_key_commitment_input/,
  );
});

test("raw MVCC snapshot evidence accepts only canonical closed pg_snapshot text", () => {
  assert.equal(validateSourceMvccSnapshot("700:705:700,703"), "700:705:700,703");
  assert.equal(validateSourceMvccSnapshot("700:700:"), "700:700:");
  for (const invalid of [
    "0700:700:",
    "700:699:",
    "700:705:699",
    "700:705:703,703",
    "700:705:704,703",
    "700:705:705",
    "700:705:700,",
    "700:705",
  ]) {
    assert.throws(() => validateSourceMvccSnapshot(invalid), /source_runtime_drift/);
  }
});

test("explicit raw capture locks and revalidates the exact source before 76 streaming projections", async () => {
  const contract = await loadMigrationContract();
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-source-raw-"));
  await mkdir(path.join(directory, ".raw-partial-stale"), { mode: 0o700 });
  const fake = fakeSource(contract);

  const manifest = await exportEncryptedRawSourceCapture({
    contract,
    createConnector: fake.createConnector,
    directory,
    keyring: KEYRING,
  });

  assert.equal(fake.state.openCalls, 1);
  assert.deepEqual(fake.state.openOptions, {
    maxConnections: 1,
    sourceProjectRef: SOURCE_PROJECT_REF,
    tlsMode: "verify-full",
  });
  assert.deepEqual(fake.state.transactionOptions, {
    deferrable: true,
    isolationLevel: "SERIALIZABLE",
    readOnly: true,
  });
  assert.equal(fake.state.closeFinished, true);
  assert.equal(fake.state.events.at(-1), "close:finish");

  const allSql = [
    ...fake.state.queries.map((entry) => entry.sql),
    ...fake.state.streams.map((entry) => entry.sql),
  ];
  assert.ok(allSql.every((sql) => !/\b(?:ALTER|CALL|COMMENT|COPY|CREATE|DELETE|DO|DROP|GRANT|INSERT|MERGE|REVOKE|TRUNCATE|UPDATE)\b/i.test(sql)));
  assert.ok(allSql.every((sql) => !/\bTEMP(?:ORARY)?\b/i.test(sql)));
  assert.ok(allSql.every((sql) => !/SELECT\s+\*/i.test(sql)));

  const settings = fake.state.queries.filter((entry) => entry.sql.startsWith("SET LOCAL "));
  assert.deepEqual(settings.map((entry) => entry.sql), [
    "SET LOCAL \"DateStyle\" = 'ISO, YMD'",
    "SET LOCAL \"IntervalStyle\" = 'iso_8601'",
    "SET LOCAL \"TimeZone\" = 'UTC'",
    "SET LOCAL \"bytea_output\" = 'hex'",
    "SET LOCAL \"extra_float_digits\" = '3'",
  ]);
  const lock = fake.state.queries.find((entry) => entry.sql.startsWith("LOCK TABLE "));
  assert.ok(lock);
  assert.match(lock.sql, / IN ACCESS SHARE MODE$/);
  let previousOffset = -1;
  for (const tableName of contract.source_capture_contract.lock_order) {
    const quoted = `\"public\".\"${tableName.replaceAll('"', '""')}\"`;
    const offset = lock.sql.indexOf(quoted);
    assert.ok(offset > previousOffset, `lock order drift for ${tableName}`);
    previousOffset = offset;
  }

  const catalogIndex = fake.state.queries.findIndex((entry) => entry.sql.includes("FROM pg_catalog.pg_class"));
  const constraintIndex = fake.state.queries.findIndex((entry) =>
    entry.sql.includes("FROM pg_catalog.pg_constraint")
  );
  const viewDefinitionIndex = fake.state.queries.findIndex((entry) => entry.sql.includes("pg_get_viewdef"));
  const runtimeIndex = fake.state.queries.findIndex((entry) => entry.sql.includes("pg_current_wal_lsn"));
  const lockIndex = fake.state.queries.indexOf(lock);
  assert.ok(
    lockIndex >= 0 && catalogIndex > lockIndex && constraintIndex > catalogIndex &&
    viewDefinitionIndex > constraintIndex && runtimeIndex > viewDefinitionIndex,
  );
  assert.deepEqual(fake.state.queries[constraintIndex].parameters, ["public"]);
  assert.deepEqual(fake.state.queries[viewDefinitionIndex].parameters, ["public"]);
  assert.match(fake.state.queries[runtimeIndex].sql, /pg_catalog\.current_database\(\)/);
  assert.match(fake.state.queries[runtimeIndex].sql, /pg_catalog\.pg_is_in_recovery\(\)/);
  assert.equal(fake.state.streams.length, 76);
  assert.ok(fake.state.streams.every((entry) => entry.batchSize === 128));
  assert.ok(fake.state.streams.every((entry) => entry.parameters.length === 0));
  assert.ok(fake.state.streams.every((entry) => /^SELECT /.test(entry.sql)));
  for (const [index, entry] of fake.state.streams.entries()) {
    const table = contract.source_tables[index];
    assert.match(entry.sql, new RegExp(`FROM \\\"public\\\"\\.\\\"${table.name}\\\"`));
    const projection = entry.sql.slice("SELECT ".length, entry.sql.indexOf("\nFROM "));
    assert.equal(projection.split(", ").length, table.fields.length);
    for (const field of table.fields) assert.ok(projection.includes(`\"${field.name.replaceAll('"', '""')}\"`));
    const orderFields = table.identity.mode === "FULL_ROW_MULTISET"
      ? table.fields.map((field) => field.name)
      : table.identity.columns;
    assert.equal(
      entry.sql.slice(entry.sql.indexOf("\nORDER BY ") + "\nORDER BY ".length),
      orderFields.map((name) => `\"${name.replaceAll('"', '""')}\" ASC NULLS FIRST`).join(", "),
    );
  }
  for (const view of contract.registered_views) {
    assert.ok(fake.state.streams.every((entry) => !entry.sql.includes(`\"public\".\"${view.name}\"`)));
  }

  assertPublicManifestShape(manifest);
  assert.deepEqual(manifest.counts, { columns: 759, rows: 1, shards: 76, views_queried: 0 });
  const captureEntries = (await readdir(directory)).sort();
  assert.deepEqual(captureEntries, [
    ".raw-partial-stale",
    `raw-${manifest.hashes.capture_sha256}`,
  ]);
  assert.deepEqual(await readdir(path.join(directory, ".raw-partial-stale")), []);
  const captureDirectory = path.join(directory, `raw-${manifest.hashes.capture_sha256}`);
  assert.equal((await stat(captureDirectory)).mode & 0o777, 0o700);
  const shardFiles = (await readdir(captureDirectory)).sort();
  assert.equal(shardFiles.length, 77);
  assert.deepEqual(
    shardFiles,
    [
      ...Array.from({ length: 76 }, (_unused, index) => `${String(index + 1).padStart(3, "0")}.raw.enc`),
      "capture-manifest.raw.enc",
    ].sort(),
  );
  for (const filename of shardFiles) {
    assert.equal((await stat(path.join(captureDirectory, filename))).mode & 0o777, 0o600);
  }

  const appointmentIndex = contract.source_tables.findIndex((table) => table.name === "appointments");
  const appointmentPath = path.join(
    captureDirectory,
    `${String(appointmentIndex + 1).padStart(3, "0")}.raw.enc`,
  );
  const encrypted = await readFile(appointmentPath);
  assert.equal(encrypted.includes(Buffer.from("SENSITIVE_FIXTURE_MARKER")), false);
  assert.equal((await stat(appointmentPath)).mode & 0o777, 0o600);
  const manifestPath = path.join(captureDirectory, "capture-manifest.raw.enc");
  const manifestBinding = sha256Hex(canonicalizeJcs({
    capture_sha256: manifest.hashes.capture_sha256,
    schema: RAW_CAPTURE_MANIFEST_SCHEMA,
  }));
  const verified = await verifyStreamingEncryptedArtifact({
    expectedArtifactTypeHash: manifestBinding,
    keyring: KEYRING,
    path: manifestPath,
  });
  assert.equal(verified.artifact_sha256, manifest.hashes.manifest_artifact_sha256);
  const encryptedManifest = await readFile(manifestPath);
  const privateManifest = JSON.parse(
    decryptFixtureArtifact(encryptedManifest, manifestBinding).toString("utf8"),
  );
  assert.equal(privateManifest.schema, RAW_CAPTURE_MANIFEST_SCHEMA);
  assert.equal(privateManifest.status, "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY");
  assert.equal(privateManifest.s0_compatible, false);
  assert.equal(privateManifest.routing_allowed, false);
  assert.equal(privateManifest.target_load_allowed, false);
  assert.equal(privateManifest.source_mvcc_snapshot, "700:700:");
  assert.equal(privateManifest.source_database, "postgres");
  assert.equal(privateManifest.source_is_in_recovery, false);
  assert.doesNotThrow(() => verifyRawHmacKeyCommitment({
    captureSha256: privateManifest.capture_sha256,
    commitment: privateManifest.hmac_key_commitment,
    contractSha256: privateManifest.hashes.contract_sha256,
    hmacKey: KEYRING.hmacKey,
    hmacKeyId: KEYRING.hmacKeyId,
    snapshotSha256: privateManifest.hashes.snapshot_sha256,
  }));
  assert.equal(privateManifest.shards.length, 76);
  assert.deepEqual(
    Object.keys(privateManifest.shards[0].hashes).sort(),
    ["artifact_sha256", "binding_sha256", "content_sha256", "table_sha256"],
  );
  const appointmentPrivate = privateManifest.shards[appointmentIndex];
  const expectedAppointmentBinding = sha256Hex(canonicalizeJcs({
    capture_sha256: privateManifest.capture_sha256,
    contract_sha256: privateManifest.hashes.contract_sha256,
    schema: RAW_SHARD_SCHEMA,
    shard_index: appointmentIndex + 1,
    snapshot_sha256: privateManifest.hashes.snapshot_sha256,
    table_sha256: sha256Hex(Buffer.from("appointments", "utf8")),
  }));
  assert.equal(appointmentPrivate.hashes.binding_sha256, expectedAppointmentBinding);
  const appointmentVerified = await verifyStreamingEncryptedArtifact({
    expectedArtifactTypeHash: expectedAppointmentBinding,
    keyring: KEYRING,
    path: appointmentPath,
  });
  assert.equal(appointmentVerified.artifact_sha256, appointmentPrivate.hashes.artifact_sha256);
  assert.equal(appointmentVerified.content_sha256, appointmentPrivate.hashes.content_sha256);
  let successfulCloseAttempted = false;
  await assert.rejects(
    verifyStreamingEncryptedArtifact({
      expectedArtifactTypeHash: expectedAppointmentBinding,
      keyring: KEYRING,
      openFileImpl: closeFailingOpen(() => { successfulCloseAttempted = true; }),
      path: appointmentPath,
    }),
    /stream_envelope_close_failed/,
  );
  assert.equal(successfulCloseAttempted, true);
  const tampered = Buffer.from(encryptedManifest);
  tampered[Math.floor(tampered.length / 2)] ^= 1;
  await writeFile(manifestPath, tampered, { mode: 0o600 });
  let failedCloseAttempted = false;
  await assert.rejects(
    verifyStreamingEncryptedArtifact({
      expectedArtifactTypeHash: manifestBinding,
      keyring: KEYRING,
      openFileImpl: closeFailingOpen(() => { failedCloseAttempted = true; }),
      path: manifestPath,
    }),
    (error) => error.message === "stream_envelope_authentication_failed" &&
      error.closeFailure?.message === "stream_envelope_close_failed" &&
      !Object.keys(error).includes("closeFailure"),
  );
  assert.equal(failedCloseAttempted, true);
});

test("column, identity, view-definition, and stream drift fail closed before publishing a capture", async () => {
  const contract = await loadMigrationContract();
  for (const scenario of [
    { driftCatalog: true, expected: /source_catalog_drift/ },
    { driftConstraint: true, expected: /source_constraint_drift/ },
    { driftViewDefinition: true, expected: /source_view_definition_drift/ },
    { failTable: "daily_revenue", expected: /fixture_stream_failed/ },
  ]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-source-fail-"));
    const fake = fakeSource(contract, scenario);
    await assert.rejects(
      exportEncryptedRawSourceCapture({
        contract,
        createConnector: fake.createConnector,
        directory,
        keyring: KEYRING,
      }),
      scenario.expected,
    );
    assert.equal(fake.state.closeFinished, true);
    assert.equal(fake.state.events.at(-1), "close:finish");
    assert.ok(fake.state.events.includes("transaction:rollback"));
    if (scenario.failTable === null || scenario.failTable === undefined) {
      assert.equal(fake.state.streams.length, 0);
    }
    assert.deepEqual(await readdir(directory), []);
  }

  const closeFailureDirectory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-source-close-fail-"));
  const closeFailure = fakeSource(contract, { closeFails: true });
  await assert.rejects(
    exportEncryptedRawSourceCapture({
      contract,
      createConnector: closeFailure.createConnector,
      directory: closeFailureDirectory,
      keyring: KEYRING,
    }),
    (error) => error.message === "source_close_failed",
  );
  assert.equal(closeFailure.state.closeFinished, false);
  assert.equal(closeFailure.state.events.at(-1), "close:start");
  assert.deepEqual(await readdir(closeFailureDirectory), []);

  const operationAndCloseDirectory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-op-close-fail-"));
  const operationAndClose = fakeSource(contract, { closeFails: true, driftCatalog: true });
  await assert.rejects(
    exportEncryptedRawSourceCapture({
      contract,
      createConnector: operationAndClose.createConnector,
      directory: operationAndCloseDirectory,
      keyring: KEYRING,
    }),
    (error) => error.message === "source_catalog_drift",
  );
  assert.equal(operationAndClose.state.closeFinished, false);
  assert.deepEqual(await readdir(operationAndCloseDirectory), []);

  const cleanupFailureDirectory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-cleanup-fail-"));
  const cleanupFailure = fakeSource(contract, {
    failTable: "ai_call_log",
    async beforeFailTable() {
      const [partial] = (await readdir(cleanupFailureDirectory)).filter((name) =>
        name.startsWith(".raw-partial-")
      );
      await mkdir(path.join(cleanupFailureDirectory, partial, "untracked-sabotage"), { mode: 0o700 });
    },
  });
  await assert.rejects(
    exportEncryptedRawSourceCapture({
      contract,
      createConnector: cleanupFailure.createConnector,
      directory: cleanupFailureDirectory,
      keyring: KEYRING,
    }),
    (error) => error.message === "fixture_stream_failed" &&
      error.cleanupFailure?.message === "raw_capture_cleanup_failed",
  );
  await rm(cleanupFailureDirectory, { force: true, recursive: true });
});

test("runtime, database, and recovery drift fail before any table query or unsafe connect", async () => {
  const contract = await loadMigrationContract();
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-version-drift-"));
  const fake = fakeSource(contract, { runtimeVersion: "17.5" });
  await assert.rejects(
    exportEncryptedRawSourceCapture({
      contract,
      createConnector: fake.createConnector,
      directory,
      keyring: KEYRING,
    }),
    /source_runtime_drift/,
  );
  assert.equal(fake.state.streams.length, 0);
  assert.equal(fake.state.closeFinished, true);
  assert.deepEqual(await readdir(directory), []);

  const beforeIncidentDirectory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-before-incident-"));
  const beforeIncident = fakeSource(contract, {
    transactionTimestamp: "2026-08-11T02:19:36.332094Z",
  });
  await assert.rejects(
    exportEncryptedRawSourceCapture({
      contract,
      createConnector: beforeIncident.createConnector,
      directory: beforeIncidentDirectory,
      keyring: KEYRING,
    }),
    /source_capture_predates_incident_boundary/,
  );
  assert.equal(beforeIncident.state.streams.length, 0);
  assert.equal(beforeIncident.state.closeFinished, true);
  assert.deepEqual(await readdir(beforeIncidentDirectory), []);

  const invalidSnapshotDirectory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-invalid-mvcc-"));
  const invalidSnapshot = fakeSource(contract, { mvccSnapshot: "0700:700:" });
  await assert.rejects(
    exportEncryptedRawSourceCapture({
      contract,
      createConnector: invalidSnapshot.createConnector,
      directory: invalidSnapshotDirectory,
      keyring: KEYRING,
    }),
    /source_runtime_drift/,
  );
  assert.equal(invalidSnapshot.state.streams.length, 0);
  assert.equal(invalidSnapshot.state.closeFinished, true);
  assert.deepEqual(await readdir(invalidSnapshotDirectory), []);

  for (const [label, options] of [
    ["wrong-database", { databaseName: "template1" }],
    ["recovery", { inRecovery: true }],
  ]) {
    const runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), `hc-r6-${label}-`));
    const runtime = fakeSource(contract, options);
    await assert.rejects(
      exportEncryptedRawSourceCapture({
        contract,
        createConnector: runtime.createConnector,
        directory: runtimeDirectory,
        keyring: KEYRING,
      }),
      /source_runtime_drift/,
    );
    assert.equal(runtime.state.streams.length, 0);
    assert.equal(runtime.state.closeFinished, true);
    assert.deepEqual(await readdir(runtimeDirectory), []);
  }

  const unsafeDirectory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-unsafe-output-"));
  await chmod(unsafeDirectory, 0o755);
  const never = fakeSource(contract);
  await assert.rejects(
    exportEncryptedRawSourceCapture({
      contract,
      createConnector: never.createConnector,
      directory: unsafeDirectory,
      keyring: KEYRING,
    }),
    /unsafe_artifact_directory/,
  );
  assert.equal(never.state.openCalls, 0);
  const cliCalls = [];
  await assert.rejects(
    runRawSourceCaptureCli({
      argv: ["--capture-encrypted-raw", "--output-dir", unsafeDirectory],
      dependencies: {
        createConnector: () => cliCalls.push("connector"),
        loadContract: () => cliCalls.push("contract"),
        loadKeyring: () => cliCalls.push("keyring"),
        loadSourceDsn: () => cliCalls.push("dsn"),
      },
      stdout: { write() {} },
    }),
    /unsafe_artifact_directory/,
  );
  assert.deepEqual(cliCalls, []);
});

test("Postgres.js connector is pinned to one verify-full connection and rejects a wrong project DSN", async () => {
  const calls = [];
  const fakeSql = {
    begin() { throw new Error("must_not_begin"); },
    async end(options) { calls.push({ end: structuredClone(options) }); },
  };
  const sourceDsn = `postgresql://postgres.${SOURCE_PROJECT_REF}:fixture@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`;
  const connector = createPostgresJsSourceConnector({
    dsn: sourceDsn,
    postgresFactory(dsn, options) {
      calls.push({ dsn, options: structuredClone(options) });
      return fakeSql;
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dsn, sourceDsn);
  assert.equal(calls[0].options.max, 1);
  assert.deepEqual(calls[0].options.connection, {
    application_name: "hotcrush-r6-raw-source-capture",
  });
  assert.equal(calls[0].options.fetch_types, false);
  assert.equal(calls[0].options.prepare, false);
  assert.deepEqual(calls[0].options.ssl, {
    ca: SUPABASE_ROOT_CA_2021,
    minVersion: "TLSv1.2",
    rejectUnauthorized: true,
    servername: "aws-0-us-east-1.pooler.supabase.com",
  });
  const pinnedRoot = new X509Certificate(calls[0].options.ssl.ca);
  assert.equal(pinnedRoot.fingerprint256, SUPABASE_ROOT_CA_2021_FINGERPRINT);
  assert.equal(pinnedRoot.ca, true);
  assert.equal(pinnedRoot.subject, pinnedRoot.issuer);
  assert.equal(pinnedRoot.verify(pinnedRoot.publicKey), true);
  assert.ok(Date.parse(pinnedRoot.validFrom) <= Date.now());
  assert.ok(Date.now() < Date.parse(pinnedRoot.validTo));
  await connector.close();
  assert.deepEqual(calls[1], { end: { timeout: 5 } });

  for (const wrong of [
    "postgresql://postgres.wrong:fixture@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full",
    `postgresql://postgres.${SOURCE_PROJECT_REF}:fixture@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=disable`,
    `postgresql://postgres.${SOURCE_PROJECT_REF}:fixture@aws-0-us-east-1.pooler.supabase.com:5432/other?sslmode=verify-full`,
  ]) {
    assert.throws(
      () => createPostgresJsSourceConnector({ dsn: wrong, postgresFactory: () => fakeSql }),
      /source_dsn_rejected/,
    );
  }
});

test("source DSN provider is fixed, read-only, no-shell, and redacts Keychain failures", async () => {
  const sourceDsn = `postgresql://postgres.${SOURCE_PROJECT_REF}:fixture@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`;
  const calls = [];
  const result = await loadSourceDsnFromMacOSKeychain({
    execFileImpl(file, args, options, callback) {
      calls.push({ args, file, options });
      callback(null, `${sourceDsn}\n`, "");
    },
  });
  assert.equal(result, sourceDsn);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "/usr/bin/security");
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].args, [
    "find-generic-password",
    "-a", SOURCE_DSN_KEYCHAIN.account,
    "-s", SOURCE_DSN_KEYCHAIN.service,
    "-w",
  ]);
  await assert.rejects(
    loadSourceDsnFromMacOSKeychain({
      execFileImpl(_file, _args, _options, callback) {
        callback(new Error("dsn=DO_NOT_LEAK"), "", "dsn=DO_NOT_LEAK");
      },
    }),
    (error) => error.message === "source_dsn_keychain_read_failed",
  );
});

const localFixtureUrl = process.env.HOTCRUSH_R6_PG17_READONLY_FIXTURE_URL;
test("optional local PG17.6 fixture accepts the exact read-only deferrable transaction", {
  skip: !localFixtureUrl,
}, async () => {
  const parsed = new URL(localFixtureUrl);
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(parsed.hostname), "fixture must be loopback-only");
  const requireFromBakery = createRequire(new URL("../../../../../bakery-ops/package.json", import.meta.url));
  const postgres = requireFromBakery("postgres");
  const sql = postgres(localFixtureUrl, {
    fetch_types: false,
    max: 1,
    prepare: false,
    ssl: false,
  });
  try {
    await sql.begin("ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE", async (tx) => {
      await tx.unsafe("SET LOCAL \"DateStyle\" = 'ISO, YMD'");
      await tx.unsafe("SET LOCAL \"IntervalStyle\" = 'iso_8601'");
      await tx.unsafe("SET LOCAL \"TimeZone\" = 'UTC'");
      await tx.unsafe("SET LOCAL \"bytea_output\" = 'hex'");
      await tx.unsafe("SET LOCAL \"extra_float_digits\" = '3'");
      await tx.unsafe("LOCK TABLE pg_catalog.pg_class IN ACCESS SHARE MODE");
      const [row] = await tx.unsafe(`SELECT
        pg_catalog.current_setting('server_version') AS server_version,
        pg_catalog.current_setting('transaction_isolation') AS isolation_level,
        pg_catalog.current_setting('transaction_read_only') AS read_only,
        pg_catalog.current_setting('transaction_deferrable') AS deferrable,
        pg_catalog.current_setting('DateStyle') AS date_style,
        pg_catalog.current_setting('IntervalStyle') AS interval_style,
        pg_catalog.current_setting('TimeZone') AS time_zone,
        pg_catalog.current_setting('bytea_output') AS bytea_output,
        pg_catalog.current_setting('extra_float_digits') AS extra_float_digits,
        pg_catalog.pg_current_wal_lsn()::text AS source_wal_lsn,
        pg_catalog.to_char(
          pg_catalog.transaction_timestamp(),
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) AS source_transaction_timestamp,
        pg_catalog.pg_current_snapshot()::text AS source_mvcc_snapshot,
        pg_catalog.current_database()::text AS source_database,
        CASE WHEN pg_catalog.pg_is_in_recovery() THEN 't' ELSE 'f' END
          AS source_is_in_recovery`).raw();
      const values = row.map((value) => value.toString("utf8"));
      assert.deepEqual(values.slice(0, 9), [
        "17.6", "serializable", "on", "on", "ISO, YMD", "iso_8601", "UTC", "hex", "3",
      ]);
      assert.match(values[9], /^[0-9A-F]+\/[0-9A-F]+$/);
      assert.match(values[10], /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/);
      assert.ok(values[10] > SOURCE_CAPTURE_INCIDENT_BOUNDARY);
      assert.match(values[11], /^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*):(?:[0-9]+(?:,[0-9]+)*)?$/);
      assert.equal(validateSourceMvccSnapshot(values[11]), values[11]);
      assert.equal(values[12], "postgres");
      assert.equal(values[13], "f");
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
