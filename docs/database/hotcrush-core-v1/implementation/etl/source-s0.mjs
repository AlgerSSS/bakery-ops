import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  mkdir,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalizeJcs,
  sha256Hex,
  typedRowFromContract,
} from "./lib/canonical.mjs";
import { loadMigrationContract } from "./lib/contract.mjs";
import {
  assertSafeArtifactDirectory,
  syncArtifactDirectory,
  writeStreamingEncryptedArtifact,
} from "./lib/envelope-stream.mjs";
import { loadMacOSKeychainKeyring, validateKeyring } from "./lib/keys.mjs";
import {
  captureSourceSnapshot,
  createPostgresJsSourceConnector,
  loadSourceDsnFromMacOSKeychain,
} from "./lib/source-postgres.mjs";

const RAW_SHARD_SCHEMA = "hotcrush.r6.raw-source-table-shard.v1";
const RAW_CAPTURE_MANIFEST_SCHEMA = "hotcrush.r6.raw-source-capture-manifest.v1";
const RAW_HMAC_KEY_COMMITMENT_DOMAIN = "hotcrush.r6.raw-source-hmac-key-commitment.v1";
const RAW_CAPTURE_STATUS = "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY";
const MAX_FRAME_BYTES = 128 * 1024 * 1024;

function frame(payload) {
  const bytes = Buffer.from(payload);
  if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) {
    throw new Error("raw_capture_shard_frame_too_large");
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function wireText(value) {
  if (value === null) return null;
  if (!Buffer.isBuffer(value)) throw new TypeError("source_value_not_wire_text");
  const text = value.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(value)) throw new TypeError("source_value_not_wire_text");
  return text;
}

function tableRow(table, values) {
  if (!Array.isArray(values) || values.length !== table.fields.length) {
    throw new TypeError("source_row_shape_mismatch");
  }
  const row = Object.create(null);
  for (const [index, field] of table.fields.entries()) row[field.name] = wireText(values[index]);
  return row;
}

function exactObjectKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(code);
  }
}

function commitmentMessage({ captureSha256, contractSha256, snapshotSha256 }) {
  for (const value of [captureSha256, contractSha256, snapshotSha256]) {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
      throw new TypeError("invalid_raw_hmac_key_commitment_input");
    }
  }
  return canonicalizeJcs({
    capture_sha256: captureSha256,
    contract_sha256: contractSha256,
    snapshot_sha256: snapshotSha256,
  });
}

export function createRawHmacKeyCommitment(input) {
  exactObjectKeys(input, [
    "captureSha256",
    "contractSha256",
    "hmacKey",
    "hmacKeyId",
    "snapshotSha256",
  ], "invalid_raw_hmac_key_commitment_input");
  const { captureSha256, contractSha256, hmacKey, hmacKeyId, snapshotSha256 } = input;
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length !== 32 ||
      typeof hmacKeyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(hmacKeyId)) {
    throw new TypeError("invalid_raw_hmac_key_commitment_input");
  }
  const commitmentHmac = createHmac("sha256", hmacKey)
    .update(Buffer.from(`${RAW_HMAC_KEY_COMMITMENT_DOMAIN}\0`, "ascii"))
    .update(commitmentMessage({ captureSha256, contractSha256, snapshotSha256 }))
    .digest("hex");
  return Object.freeze({
    algorithm: "HMAC-SHA256",
    commitment_hmac_sha256: commitmentHmac,
    domain: RAW_HMAC_KEY_COMMITMENT_DOMAIN,
    encoding: "ASCII_DOMAIN_NUL_THEN_JCS",
    hmac_key_id: hmacKeyId,
  });
}

export function verifyRawHmacKeyCommitment(input) {
  try {
    exactObjectKeys(input, [
      "captureSha256",
      "commitment",
      "contractSha256",
      "hmacKey",
      "hmacKeyId",
      "snapshotSha256",
    ], "raw_hmac_key_commitment_mismatch");
    const { commitment, ...values } = input;
    exactObjectKeys(commitment, [
      "algorithm",
      "commitment_hmac_sha256",
      "domain",
      "encoding",
      "hmac_key_id",
    ], "raw_hmac_key_commitment_mismatch");
    if (commitment.algorithm !== "HMAC-SHA256" ||
        commitment.domain !== RAW_HMAC_KEY_COMMITMENT_DOMAIN ||
        commitment.encoding !== "ASCII_DOMAIN_NUL_THEN_JCS" ||
        commitment.hmac_key_id !== input.hmacKeyId ||
        typeof commitment.commitment_hmac_sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(commitment.commitment_hmac_sha256)) {
      throw new Error("raw_hmac_key_commitment_mismatch");
    }
    const expected = createRawHmacKeyCommitment(values);
    if (!timingSafeEqual(
      Buffer.from(commitment.commitment_hmac_sha256, "hex"),
      Buffer.from(expected.commitment_hmac_sha256, "hex"),
    )) {
      throw new Error("raw_hmac_key_commitment_mismatch");
    }
  } catch {
    throw new Error("raw_hmac_key_commitment_mismatch");
  }
}

function shardPlaintext({
  captureSha256,
  contractSha256,
  rows,
  shardIndex,
  snapshotSha256,
  state,
  table,
  tableSha256,
  watermark,
}) {
  return (async function* plaintext() {
    const header = {
      capture_sha256: captureSha256,
      contract_sha256: contractSha256,
      fields: table.fields.map((field) => ({
        name: field.name,
        nullable: field.nullable,
        pg_type: field.data_type,
      })),
      frame: "HEADER",
      schema: RAW_SHARD_SCHEMA,
      shard_index: shardIndex,
      snapshot_sha256: snapshotSha256,
      status: RAW_CAPTURE_STATUS,
      table: table.name,
      table_sha256: tableSha256,
      watermark,
    };
    yield frame(canonicalizeJcs(header));
    const rowStreamHash = createHash("sha256");
    for await (const values of rows) {
      const typed = typedRowFromContract(table, tableRow(table, values));
      const typedFrame = frame(typed);
      rowStreamHash.update(typedFrame);
      state.rows += 1;
      if (!Number.isSafeInteger(state.rows)) throw new Error("raw_capture_row_count_overflow");
      yield typedFrame;
    }
    yield frame(canonicalizeJcs({
      frame: "TRAILER",
      row_count: state.rows,
      row_stream_sha256: rowStreamHash.digest("hex"),
      schema: RAW_SHARD_SCHEMA,
    }));
  }());
}

function shardBinding({ captureSha256, contractSha256, shardIndex, snapshotSha256, tableSha256 }) {
  return sha256Hex(canonicalizeJcs({
    capture_sha256: captureSha256,
    contract_sha256: contractSha256,
    schema: RAW_SHARD_SCHEMA,
    shard_index: shardIndex,
    snapshot_sha256: snapshotSha256,
    table_sha256: tableSha256,
  }));
}

function manifestBinding(captureSha256) {
  return sha256Hex(canonicalizeJcs({
    capture_sha256: captureSha256,
    schema: RAW_CAPTURE_MANIFEST_SCHEMA,
  }));
}

async function cleanupCapture(paths, captureDirectory) {
  let failed = false;
  for (const artifactPath of [...paths].reverse()) {
    try {
      await unlink(artifactPath);
    } catch {
      failed = true;
    }
  }
  try {
    await rmdir(captureDirectory);
  } catch {
    failed = true;
  }
  if (failed) throw new Error("raw_capture_cleanup_failed");
}

function preserveCleanupFailure(operationError) {
  const primary = operationError instanceof Error && Object.isExtensible(operationError)
    ? operationError
    : new Error(
      operationError instanceof Error ? operationError.message : "raw_source_capture_failed",
      { cause: operationError },
    );
  Object.defineProperty(primary, "cleanupFailure", {
    configurable: false,
    enumerable: false,
    value: new Error("raw_capture_cleanup_failed"),
    writable: false,
  });
  return primary;
}

export async function exportEncryptedRawSourceCapture({
  contract,
  createConnector,
  directory,
  keyring: keyringInput,
}) {
  const baseIdentity = await assertSafeArtifactDirectory(directory);
  const captureSha256 = sha256Hex(randomBytes(32));
  const partialDirectory = path.join(directory, `.raw-partial-${captureSha256}`);
  const finalDirectory = path.join(directory, `raw-${captureSha256}`);
  if ([partialDirectory, finalDirectory].some((candidate) => {
    const relative = path.relative(directory, candidate);
    return relative.startsWith("..") || path.isAbsolute(relative);
  })) {
    throw new Error("unsafe_artifact_directory");
  }
  const keyring = validateKeyring(keyringInput);
  const publishedPaths = [];
  let created = false;
  let renamed = false;
  try {
    await mkdir(partialDirectory, { mode: 0o700 });
    created = true;
    const currentBaseIdentity = await assertSafeArtifactDirectory(directory);
    if (currentBaseIdentity.dev !== baseIdentity.dev || currentBaseIdentity.ino !== baseIdentity.ino) {
      throw new Error("unsafe_artifact_directory");
    }
    await assertSafeArtifactDirectory(partialDirectory);
    let nextShardIndex = 1;
    const captured = await captureSourceSnapshot({
      contract,
      createConnector,
      onTable: async ({ contractSha256, rows, snapshotSha256, table, watermark }) => {
        const shardIndex = nextShardIndex;
        nextShardIndex += 1;
        const tableSha256 = sha256Hex(Buffer.from(table.name, "utf8"));
        const bindingSha256 = shardBinding({
          captureSha256,
          contractSha256,
          shardIndex,
          snapshotSha256,
          tableSha256,
        });
        const state = { rows: 0 };
        const receipt = await writeStreamingEncryptedArtifact({
          artifactTypeHash: bindingSha256,
          directory: partialDirectory,
          filename: `${String(shardIndex).padStart(3, "0")}.raw.enc`,
          keyring,
          plaintextChunks: shardPlaintext({
            captureSha256,
            contractSha256,
            rows,
            shardIndex,
            snapshotSha256,
            state,
            table,
            tableSha256,
            watermark,
          }),
        });
        publishedPaths.push(receipt.path);
        return Object.freeze({
          counts: Object.freeze({ columns: table.fields.length, rows: state.rows }),
          hashes: Object.freeze({
            artifact_sha256: receipt.artifact_sha256,
            binding_sha256: bindingSha256,
            content_sha256: receipt.content_sha256,
            table_sha256: tableSha256,
          }),
          shard_index: shardIndex,
        });
      },
    });
    if (captured.tableResults.length !== 76 || publishedPaths.length !== 76) {
      throw new Error("raw_capture_shard_count_mismatch");
    }
    const shards = captured.tableResults;
    const rows = shards.reduce((total, shard) => total + shard.counts.rows, 0);
    const columns = shards.reduce((total, shard) => total + shard.counts.columns, 0);
    if (!Number.isSafeInteger(rows) || columns !== 759) {
      throw new Error("raw_capture_completion_count_mismatch");
    }
    const counts = Object.freeze({ columns, rows, shards: shards.length, views_queried: 0 });
    const privateManifest = Object.freeze({
      capture_sha256: captureSha256,
      counts,
      hashes: Object.freeze({
        catalog_sha256: captured.catalogSha256,
        contract_sha256: captured.contractSha256,
        shard_set_sha256: sha256Hex(canonicalizeJcs(shards)),
        snapshot_sha256: captured.snapshotSha256,
      }),
      hmac_key_commitment: createRawHmacKeyCommitment({
        captureSha256,
        contractSha256: captured.contractSha256,
        hmacKey: keyring.hmacKey,
        hmacKeyId: keyring.hmacKeyId,
        snapshotSha256: captured.snapshotSha256,
      }),
      routing_allowed: false,
      schema: RAW_CAPTURE_MANIFEST_SCHEMA,
      shards,
      s0_compatible: false,
      source_database: captured.sourceDatabase,
      source_is_in_recovery: captured.sourceIsInRecovery,
      source_mvcc_snapshot: captured.mvccSnapshot,
      status: RAW_CAPTURE_STATUS,
      target_load_allowed: false,
      watermark: captured.watermark,
    });
    const manifestReceipt = await writeStreamingEncryptedArtifact({
      artifactTypeHash: manifestBinding(captureSha256),
      directory: partialDirectory,
      filename: "capture-manifest.raw.enc",
      keyring,
      plaintextChunks: (async function* manifestPlaintext() {
        yield canonicalizeJcs(privateManifest);
      }()),
    });
    publishedPaths.push(manifestReceipt.path);
    await syncArtifactDirectory(partialDirectory);
    const finalBaseIdentity = await assertSafeArtifactDirectory(directory);
    if (finalBaseIdentity.dev !== baseIdentity.dev || finalBaseIdentity.ino !== baseIdentity.ino) {
      throw new Error("unsafe_artifact_directory");
    }
    await rename(partialDirectory, finalDirectory);
    renamed = true;
    await syncArtifactDirectory(directory);
    return Object.freeze({
      counts,
      hashes: Object.freeze({
        capture_sha256: captureSha256,
        manifest_artifact_sha256: manifestReceipt.artifact_sha256,
      }),
      watermark: captured.watermark,
    });
  } catch (error) {
    let operationError = error;
    if (created && !renamed) {
      try {
        await cleanupCapture(publishedPaths, partialDirectory);
      } catch {
        operationError = preserveCleanupFailure(operationError);
      }
    }
    if (renamed) throw new Error("raw_capture_publish_outcome_unknown");
    throw operationError;
  } finally {
    keyring.kek.fill(0);
    keyring.hmacKey.fill(0);
  }
}

function usageError() {
  throw new Error(
    "usage: node etl/source-s0.mjs --capture-encrypted-raw --output-dir /owner-only-directory",
  );
}

function writePublicReceipt(stdout, chunk) {
  if (!stdout || typeof stdout.write !== "function") {
    return Promise.reject(new Error("raw_capture_receipt_write_failed"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const onError = () => finish(new Error("raw_capture_receipt_write_failed"));
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (typeof stdout.off === "function") stdout.off("error", onError);
      if (error) reject(new Error("raw_capture_receipt_write_failed"));
      else resolve();
    };
    if (typeof stdout.once === "function") stdout.once("error", onError);
    let accepted;
    try {
      accepted = stdout.write(chunk, (error) => finish(error));
    } catch {
      finish(new Error("raw_capture_receipt_write_failed"));
      return;
    }
    if (stdout.write.length < 2) {
      if (accepted === false) {
        if (typeof stdout.once === "function") {
          stdout.once("drain", () => finish());
        } else {
          finish(new Error("raw_capture_receipt_write_failed"));
        }
      } else {
        finish();
      }
    }
  });
}

export async function runRawSourceCaptureCli({
  argv = process.argv.slice(2),
  dependencies = {},
  stdout = process.stdout,
} = {}) {
  if (!Array.isArray(argv)) usageError();
  if (argv.length === 0) {
    await writePublicReceipt(
      stdout,
      `${JSON.stringify({ status: "RAW_SOURCE_CAPTURE_DISABLED" })}\n`,
    );
    return 0;
  }
  if (argv.length === 1 && argv[0] === "--help") {
    await writePublicReceipt(
      stdout,
      "node etl/source-s0.mjs --capture-encrypted-raw --output-dir /owner-only-directory\n",
    );
    return 0;
  }
  if (argv.length !== 3 || argv[0] !== "--capture-encrypted-raw" || argv[1] !== "--output-dir" ||
      typeof argv[2] !== "string" || !path.isAbsolute(argv[2])) {
    usageError();
  }

  const loadContract = dependencies.loadContract ?? loadMigrationContract;
  const loadKeyring = dependencies.loadKeyring ?? loadMacOSKeychainKeyring;
  const loadSourceDsn = dependencies.loadSourceDsn ?? loadSourceDsnFromMacOSKeychain;
  const connectorFromDsn = dependencies.createConnector ??
    ((dsn) => createPostgresJsSourceConnector({ dsn }));
  await assertSafeArtifactDirectory(argv[2]);
  const contract = await loadContract();
  const keyring = await loadKeyring();
  let manifest;
  try {
    const sourceDsn = await loadSourceDsn();
    manifest = await exportEncryptedRawSourceCapture({
      contract,
      createConnector: (requiredOptions) => connectorFromDsn(sourceDsn, requiredOptions),
      directory: argv[2],
      keyring,
    });
  } finally {
    keyring?.kek?.fill(0);
    keyring?.hmacKey?.fill(0);
  }
  await writePublicReceipt(stdout, `${canonicalizeJcs(manifest).toString("utf8")}\n`);
  return 0;
}

function publicError(error) {
  if (error?.cleanupFailure?.message === "raw_capture_cleanup_failed") {
    return "raw_capture_cleanup_incomplete";
  }
  const allowed = new Set([
    "keychain_read_failed",
    "raw_capture_publish_outcome_unknown",
    "raw_capture_receipt_write_failed",
    "source_capture_predates_incident_boundary",
    "source_close_failed",
    "source_dsn_keychain_read_failed",
    "source_driver_unavailable",
    "source_tls_ca_invalid",
    "unsafe_artifact_directory",
  ]);
  return error instanceof Error && allowed.has(error.message)
    ? error.message
    : "raw_source_capture_failed";
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runRawSourceCaptureCli().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: publicError(error) })}\n`);
    process.exitCode = 1;
  });
}

export {
  RAW_CAPTURE_MANIFEST_SCHEMA,
  RAW_CAPTURE_STATUS,
  RAW_HMAC_KEY_COMMITMENT_DOMAIN,
  RAW_SHARD_SCHEMA,
};
