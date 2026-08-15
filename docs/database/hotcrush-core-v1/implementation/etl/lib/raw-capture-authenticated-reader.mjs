import {
  createDecipheriv,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { types as utilTypes } from "node:util";

import {
  TYPED_SCHEMA,
  canonicalizeJcs,
  parseCanonicalJcs,
  sha256Hex,
} from "./canonical.mjs";
import { validateMigrationContract } from "./contract.mjs";
import {
  assertSafeArtifactDirectory,
  verifyStreamingEncryptedArtifact,
} from "./envelope-stream.mjs";
import { validateKeyring } from "./keys.mjs";

const RAW_SHARD_SCHEMA = "hotcrush.r6.raw-source-table-shard.v1";
const RAW_MANIFEST_SCHEMA = "hotcrush.r6.raw-source-capture-manifest.v1";
const RAW_STATUS = "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY";
const COMMITMENT_DOMAIN = "hotcrush.r6.raw-source-hmac-key-commitment.v1";
const MAGIC = Buffer.from("HOTCRUSH-AES256GCM-STREAM-V1\n", "ascii");
const TAG_BYTES = 16;
const MAX_HEADER_BYTES = 16 * 1024;
const DIGEST = /^[0-9a-f]{64}$/;
const CAPABILITIES = new WeakMap();
const INPUT_AUTHORITIES = new WeakMap();

function exactPlainObject(value, expected, code, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(code);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors);
  const allowed = new Set([...expected, ...optional]);
  if (expected.some((key) => !Object.hasOwn(descriptors, key)) ||
      actual.some((key) => !allowed.has(key)) ||
      Object.values(descriptors).some((descriptor) => !("value" in descriptor))) {
    throw new TypeError(code);
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function validatePolicy(input) {
  const policy = exactPlainObject(input, [
    "freeSpaceReserveBytes",
    "maxArtifactBytes",
    "maxFrameBytes",
    "temporaryDiskMultiplier",
  ], "raw_capture_reader_policy_invalid");
  for (const value of Object.values(policy)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("raw_capture_reader_policy_invalid");
  }
  if (policy.maxArtifactBytes <= MAGIC.length + 4 + TAG_BYTES || policy.maxFrameBytes <= 0 ||
      policy.temporaryDiskMultiplier < 2) {
    throw new TypeError("raw_capture_reader_policy_invalid");
  }
  return Object.freeze(policy);
}

function expectedFiles() {
  return [
    ...Array.from({ length: 76 }, (_unused, index) => `${String(index + 1).padStart(3, "0")}.raw.enc`),
    "capture-manifest.raw.enc",
  ].sort();
}

function statIdentity(info) {
  return Object.freeze({
    ctimeNs: info.ctimeNs,
    dev: info.dev,
    ino: info.ino,
    mode: info.mode,
    mtimeNs: info.mtimeNs,
    nlink: info.nlink,
    size: info.size,
    uid: info.uid,
  });
}

function sameIdentity(left, right) {
  return ["ctimeNs", "dev", "ino", "mode", "mtimeNs", "nlink", "size", "uid"]
    .every((key) => left[key] === right[key]);
}

function assertSafeFileStat(info, maxArtifactBytes) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n ||
      (info.mode & 0o777n) !== 0o600n || info.size <= 0n ||
      info.size > BigInt(maxArtifactBytes) ||
      (typeof process.getuid === "function" && info.uid !== BigInt(process.getuid()))) {
    throw new Error("raw_capture_file_unsafe");
  }
}

async function inventory(directory, policy) {
  const names = (await readdir(directory)).sort();
  const expected = expectedFiles();
  if (canonicalizeJcs(names).toString("utf8") !== canonicalizeJcs(expected).toString("utf8")) {
    throw new Error("raw_capture_file_set_mismatch");
  }
  const files = new Map();
  const inodes = new Set();
  let totalBytes = 0n;
  for (const name of names) {
    const info = await lstat(path.join(directory, name), { bigint: true });
    assertSafeFileStat(info, policy.maxArtifactBytes);
    const inode = `${info.dev}:${info.ino}`;
    if (inodes.has(inode)) throw new Error("raw_capture_file_unsafe");
    inodes.add(inode);
    files.set(name, statIdentity(info));
    totalBytes += info.size;
  }
  return Object.freeze({ files, names: Object.freeze(names), totalBytes });
}

function availableBytes(info) {
  try {
    const bavail = typeof info?.bavail === "bigint" ? info.bavail : BigInt(info?.bavail);
    const bsize = typeof info?.bsize === "bigint" ? info.bsize : BigInt(info?.bsize);
    if (bavail < 0n || bsize <= 0n) throw new Error();
    return bavail * bsize;
  } catch {
    throw new Error("raw_capture_space_probe_failed");
  }
}

async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes.subarray(offset));
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      throw new Error("raw_capture_snapshot_copy_failed");
    }
    offset += bytesWritten;
  }
}

async function copyAuthenticatedInput(sourcePath, targetPath, expected, policy) {
  const readFlags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const writeFlags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY |
    (fsConstants.O_NOFOLLOW ?? 0);
  const source = await open(sourcePath, readFlags);
  let target;
  try {
    const before = await source.stat({ bigint: true });
    assertSafeFileStat(before, policy.maxArtifactBytes);
    if (!sameIdentity(statIdentity(before), expected)) throw new Error("raw_capture_inode_drift");
    target = await open(targetPath, writeFlags, 0o600);
    let position = 0n;
    while (position < before.size) {
      const length = Number(before.size - position > 64n * 1024n ? 64n * 1024n : before.size - position);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await source.read(buffer, 0, length, Number(position));
      if (bytesRead !== length) throw new Error("raw_capture_inode_drift");
      await writeAll(target, buffer);
      position += BigInt(bytesRead);
    }
    const after = await source.stat({ bigint: true });
    if (!sameIdentity(statIdentity(after), expected)) throw new Error("raw_capture_inode_drift");
    await target.sync();
    await target.close();
    target = null;
    const copied = await lstat(targetPath, { bigint: true });
    assertSafeFileStat(copied, policy.maxArtifactBytes);
    if (copied.size !== expected.size) throw new Error("raw_capture_snapshot_copy_failed");
  } finally {
    await Promise.allSettled([source.close(), target?.close()]);
  }
}

async function readExact(handle, length, position) {
  const output = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(output, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error("raw_capture_envelope_truncated");
    offset += bytesRead;
  }
  return output;
}

async function openExpectedArtifact(artifactPath, flags, expected, maxArtifactBytes, driftCode) {
  const handle = await open(artifactPath, flags);
  try {
    const info = await handle.stat({ bigint: true });
    assertSafeFileStat(info, maxArtifactBytes);
    if (!sameIdentity(statIdentity(info), expected)) throw new Error(driftCode);
    return handle;
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function readEnvelopeArtifactTypeHash(artifactPath, expectedIdentity, maxArtifactBytes) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await openExpectedArtifact(
    artifactPath,
    flags,
    expectedIdentity,
    maxArtifactBytes,
    "raw_capture_snapshot_inode_drift",
  );
  try {
    const magic = await readExact(handle, MAGIC.length, 0);
    if (!magic.equals(MAGIC)) throw new Error("raw_capture_envelope_invalid");
    const headerLengthBytes = await readExact(handle, 4, MAGIC.length);
    const headerLength = headerLengthBytes.readUInt32BE();
    if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES) throw new Error("raw_capture_envelope_invalid");
    const header = parseCanonicalJcs(
      await readExact(handle, headerLength, MAGIC.length + 4),
      { maxBytes: MAX_HEADER_BYTES },
    );
    const values = exactPlainObject(header, [
      "alg", "artifact_type_sha256", "format", "hmac_key_id", "kek_id",
      "payload_iv", "wrap_iv", "wrap_tag", "wrapped_dek",
    ], "raw_capture_envelope_invalid");
    if (typeof values.artifact_type_sha256 !== "string" || !DIGEST.test(values.artifact_type_sha256)) {
      throw new Error("raw_capture_envelope_invalid");
    }
    return values.artifact_type_sha256;
  } finally {
    await handle.close();
  }
}

function decodeB64(value, length) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("raw_capture_envelope_invalid");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value) {
    throw new Error("raw_capture_envelope_invalid");
  }
  return bytes;
}

async function* decryptArtifact({
  artifactPath,
  artifactTypeHash,
  expectedIdentity,
  keyring,
  maxArtifactBytes,
}) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await openExpectedArtifact(
    artifactPath,
    flags,
    expectedIdentity,
    maxArtifactBytes,
    "raw_capture_snapshot_inode_drift",
  );
  let dek;
  try {
    const info = await handle.stat({ bigint: true });
    const size = Number(info.size);
    const magic = await readExact(handle, MAGIC.length, 0);
    if (!magic.equals(MAGIC)) throw new Error("raw_capture_envelope_invalid");
    const headerLengthBytes = await readExact(handle, 4, MAGIC.length);
    const headerLength = headerLengthBytes.readUInt32BE();
    if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES) throw new Error("raw_capture_envelope_invalid");
    const headerOffset = MAGIC.length + 4;
    const headerBytes = await readExact(handle, headerLength, headerOffset);
    const header = parseCanonicalJcs(headerBytes, { maxBytes: MAX_HEADER_BYTES });
    const values = exactPlainObject(header, [
      "alg", "artifact_type_sha256", "format", "hmac_key_id", "kek_id",
      "payload_iv", "wrap_iv", "wrap_tag", "wrapped_dek",
    ], "raw_capture_envelope_invalid");
    if (values.alg !== "AES-256-GCM" || values.format !== "hotcrush.aes256gcm-stream.v1" ||
        values.artifact_type_sha256 !== artifactTypeHash || values.hmac_key_id !== keyring.hmacKeyId ||
        values.kek_id !== keyring.kekId) {
      throw new Error("raw_capture_envelope_invalid");
    }
    const descriptor = Object.fromEntries([
      "alg", "artifact_type_sha256", "format", "hmac_key_id", "kek_id", "payload_iv", "wrap_iv",
    ].map((key) => [key, values[key]]));
    const unwrap = createDecipheriv("aes-256-gcm", keyring.kek, decodeB64(values.wrap_iv, 12));
    unwrap.setAAD(canonicalizeJcs(descriptor));
    unwrap.setAuthTag(decodeB64(values.wrap_tag, TAG_BYTES));
    dek = Buffer.concat([
      unwrap.update(decodeB64(values.wrapped_dek, 32)),
      unwrap.final(),
    ]);
    const payloadOffset = headerOffset + headerLength;
    const ciphertextBytes = size - payloadOffset - TAG_BYTES;
    if (ciphertextBytes < 0) throw new Error("raw_capture_envelope_invalid");
    const tag = await readExact(handle, TAG_BYTES, payloadOffset + ciphertextBytes);
    const decipher = createDecipheriv("aes-256-gcm", dek, decodeB64(values.payload_iv, 12));
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(tag);
    let position = payloadOffset;
    let remaining = ciphertextBytes;
    while (remaining > 0) {
      const length = Math.min(64 * 1024, remaining);
      yield decipher.update(await readExact(handle, length, position));
      position += length;
      remaining -= length;
    }
    yield decipher.final();
  } finally {
    dek?.fill(0);
    await handle.close();
  }
}

async function readArtifactPlaintext(options, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of decryptArtifact(options)) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("raw_capture_manifest_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function commitmentMessage(captureSha256, contractSha256, snapshotSha256) {
  return canonicalizeJcs({
    capture_sha256: captureSha256,
    contract_sha256: contractSha256,
    snapshot_sha256: snapshotSha256,
  });
}

function verifyCommitment(manifest, keyring) {
  const commitment = exactPlainObject(manifest.hmac_key_commitment, [
    "algorithm", "commitment_hmac_sha256", "domain", "encoding", "hmac_key_id",
  ], "raw_capture_manifest_invalid");
  if (commitment.algorithm !== "HMAC-SHA256" || commitment.domain !== COMMITMENT_DOMAIN ||
      commitment.encoding !== "ASCII_DOMAIN_NUL_THEN_JCS" ||
      commitment.hmac_key_id !== keyring.hmacKeyId || !DIGEST.test(commitment.commitment_hmac_sha256)) {
    throw new Error("raw_capture_hmac_commitment_mismatch");
  }
  const expected = createHmac("sha256", keyring.hmacKey)
    .update(Buffer.from(`${COMMITMENT_DOMAIN}\0`, "ascii"))
    .update(commitmentMessage(
      manifest.capture_sha256,
      manifest.hashes.contract_sha256,
      manifest.hashes.snapshot_sha256,
    ))
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(commitment.commitment_hmac_sha256, "hex"))) {
    throw new Error("raw_capture_hmac_commitment_mismatch");
  }
}

function validMvccSnapshot(value) {
  if (typeof value !== "string") return false;
  const match = /^(0|[1-9][0-9]*):(0|[1-9][0-9]*):((?:0|[1-9][0-9]*)(?:,(?:0|[1-9][0-9]*))*)?$/.exec(value);
  if (!match) return false;
  const xmin = BigInt(match[1]);
  const xmax = BigInt(match[2]);
  if (xmin > xmax) return false;
  const activeText = match[3] ?? "";
  const active = activeText === "" ? [] : activeText.split(",").map(BigInt);
  return active.every((xid, index) => xid >= xmin && xid < xmax &&
    (index === 0 || active[index - 1] < xid));
}

function validateManifest(manifest, contract, captureSha256, keyring) {
  exactPlainObject(manifest, [
    "capture_sha256", "counts", "hashes", "hmac_key_commitment", "routing_allowed", "schema",
    "shards", "s0_compatible", "source_database", "source_is_in_recovery", "source_mvcc_snapshot",
    "source_runtime_addendum", "status", "target_load_allowed", "watermark",
  ], "raw_capture_manifest_invalid");
  exactPlainObject(manifest.counts, ["columns", "rows", "shards", "views_queried"], "raw_capture_manifest_invalid");
  exactPlainObject(manifest.hashes, [
    "catalog_sha256", "contract_sha256", "shard_set_sha256", "snapshot_sha256",
  ], "raw_capture_manifest_invalid");
  const runtimeAddendum = exactPlainObject(
    manifest.source_runtime_addendum,
    ["schema", "session_settings"],
    "raw_capture_manifest_invalid",
  );
  const runtimeSettings = exactPlainObject(
    runtimeAddendum.session_settings,
    ["statement_timeout"],
    "raw_capture_manifest_invalid",
  );
  const watermark = exactPlainObject(
    manifest.watermark,
    ["source_transaction_timestamp", "wal_lsn"],
    "raw_capture_manifest_invalid",
  );
  const contractSha256 = sha256Hex(canonicalizeJcs(contract));
  if (manifest.capture_sha256 !== captureSha256 || manifest.schema !== RAW_MANIFEST_SCHEMA ||
      manifest.status !== RAW_STATUS || manifest.routing_allowed !== false ||
      manifest.target_load_allowed !== false || manifest.s0_compatible !== false ||
      manifest.source_database !== "postgres" || manifest.source_is_in_recovery !== false ||
      manifest.hashes.contract_sha256 !== contractSha256 ||
      ![manifest.hashes.catalog_sha256, manifest.hashes.snapshot_sha256]
        .every((value) => typeof value === "string" && DIGEST.test(value)) ||
      manifest.counts.columns !== 759 || manifest.counts.shards !== 76 ||
      manifest.counts.views_queried !== 0 || !Number.isSafeInteger(manifest.counts.rows) ||
      manifest.counts.rows < 0 || !Array.isArray(manifest.shards) || manifest.shards.length !== 76 ||
      manifest.hashes.shard_set_sha256 !== sha256Hex(canonicalizeJcs(manifest.shards)) ||
      runtimeAddendum.schema !== "hotcrush.r6.raw-source-runtime-addendum.v1" ||
      runtimeSettings.statement_timeout !== "0" || !validMvccSnapshot(manifest.source_mvcc_snapshot) ||
      typeof watermark.source_transaction_timestamp !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(watermark.source_transaction_timestamp) ||
      typeof watermark.wal_lsn !== "string" || !/^[0-9A-F]+\/[0-9A-F]+$/.test(watermark.wal_lsn)) {
    throw new Error("raw_capture_manifest_invalid");
  }
  verifyCommitment(manifest, keyring);
  let rows = 0;
  const validatedShards = manifest.shards.map((shard, index) => {
    exactPlainObject(shard, ["counts", "hashes", "shard_index"], "raw_capture_manifest_invalid");
    exactPlainObject(shard.counts, ["columns", "rows"], "raw_capture_manifest_invalid");
    exactPlainObject(shard.hashes, [
      "artifact_sha256", "binding_sha256", "content_sha256", "table_sha256",
    ], "raw_capture_manifest_invalid");
    const table = contract.source_tables[index];
    const shardIndex = index + 1;
    const tableSha256 = sha256Hex(Buffer.from(table.name, "utf8"));
    const bindingSha256 = sha256Hex(canonicalizeJcs({
      capture_sha256: captureSha256,
      contract_sha256: contractSha256,
      schema: RAW_SHARD_SCHEMA,
      shard_index: shardIndex,
      snapshot_sha256: manifest.hashes.snapshot_sha256,
      table_sha256: tableSha256,
    }));
    if (shard.shard_index !== shardIndex || shard.counts.columns !== table.fields.length ||
        !Number.isSafeInteger(shard.counts.rows) || shard.counts.rows < 0 ||
        shard.hashes.table_sha256 !== tableSha256 || shard.hashes.binding_sha256 !== bindingSha256 ||
        ![shard.hashes.artifact_sha256, shard.hashes.content_sha256].every((value) => DIGEST.test(value))) {
      throw new Error("raw_capture_manifest_invalid");
    }
    rows += shard.counts.rows;
    if (!Number.isSafeInteger(rows)) throw new Error("raw_capture_manifest_invalid");
    return Object.freeze({ ...shard, table });
  });
  if (rows !== manifest.counts.rows) throw new Error("raw_capture_manifest_invalid");
  return Object.freeze(validatedShards);
}

async function assertInventoryUnchanged(directory, before, policy) {
  const after = await inventory(directory, policy);
  if (after.names.length !== before.names.length ||
      after.names.some((name, index) => name !== before.names[index]) ||
      after.names.some((name) => !sameIdentity(after.files.get(name), before.files.get(name)))) {
    throw new Error("raw_capture_inode_drift");
  }
}

async function assertDirectoryIdentity(directory, expected) {
  const current = await assertSafeArtifactDirectory(directory);
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error("raw_capture_inode_drift");
  }
}

export async function openAuthenticatedRawCapture(input) {
  const options = exactPlainObject(input, [
    "captureDirectory", "contract", "detachedManifestArtifactSha256", "keyring", "resourcePolicy",
    "snapshotParent", "statfsImpl",
  ], "raw_capture_reader_input_invalid");
  const policy = validatePolicy(options.resourcePolicy);
  if (typeof options.captureDirectory !== "string" || !path.isAbsolute(options.captureDirectory) ||
      typeof options.snapshotParent !== "string" || !path.isAbsolute(options.snapshotParent) ||
      typeof options.statfsImpl !== "function" ||
      typeof options.detachedManifestArtifactSha256 !== "string" ||
      !DIGEST.test(options.detachedManifestArtifactSha256)) {
    throw new TypeError("raw_capture_reader_input_invalid");
  }
  validateMigrationContract(options.contract);
  const captureMatch = /^raw-([0-9a-f]{64})$/.exec(path.basename(options.captureDirectory));
  if (!captureMatch) throw new Error("raw_capture_directory_name_invalid");
  const captureSha256 = captureMatch[1];
  const captureDirectoryIdentity = await assertSafeArtifactDirectory(options.captureDirectory);
  const snapshotParentIdentity = await assertSafeArtifactDirectory(options.snapshotParent);
  const sourceInventory = await inventory(options.captureDirectory, policy);
  let free;
  try {
    free = availableBytes(await options.statfsImpl(options.snapshotParent));
  } catch (error) {
    if (error?.message === "raw_capture_space_probe_failed") throw error;
    throw new Error("raw_capture_space_probe_failed");
  }
  const required = sourceInventory.totalBytes * BigInt(policy.temporaryDiskMultiplier) +
    BigInt(policy.freeSpaceReserveBytes);
  if (free < required) throw new Error("raw_capture_insufficient_snapshot_space");
  await assertDirectoryIdentity(options.captureDirectory, captureDirectoryIdentity);
  await assertDirectoryIdentity(options.snapshotParent, snapshotParentIdentity);
  const keyring = validateKeyring(options.keyring);
  let snapshotDirectory;
  try {
    snapshotDirectory = await mkdtemp(path.join(options.snapshotParent, ".raw-auth-snapshot-"));
    await chmod(snapshotDirectory, 0o700);
    await assertSafeArtifactDirectory(snapshotDirectory);
    for (const name of sourceInventory.names) {
      await copyAuthenticatedInput(
        path.join(options.captureDirectory, name),
        path.join(snapshotDirectory, name),
        sourceInventory.files.get(name),
        policy,
      );
    }
    await assertInventoryUnchanged(options.captureDirectory, sourceInventory, policy);
    await assertDirectoryIdentity(options.captureDirectory, captureDirectoryIdentity);
    await assertDirectoryIdentity(options.snapshotParent, snapshotParentIdentity);
    const snapshotInventory = await inventory(snapshotDirectory, policy);

    const authenticated = new Map();
    for (const name of snapshotInventory.names) {
      const artifactPath = path.join(snapshotDirectory, name);
      const expectedIdentity = snapshotInventory.files.get(name);
      let artifactTypeHash;
      let receipt;
      try {
        artifactTypeHash = await readEnvelopeArtifactTypeHash(
          artifactPath,
          expectedIdentity,
          policy.maxArtifactBytes,
        );
        receipt = await verifyStreamingEncryptedArtifact({
          expectedArtifactTypeHash: artifactTypeHash,
          keyring,
          maxBytes: policy.maxArtifactBytes,
          openFileImpl: (_artifactPath, flags) => openExpectedArtifact(
            artifactPath,
            flags,
            expectedIdentity,
            policy.maxArtifactBytes,
            "raw_capture_snapshot_inode_drift",
          ),
          path: artifactPath,
        });
      } catch {
        throw new Error(name === "capture-manifest.raw.enc"
          ? "raw_capture_manifest_authentication_failed"
          : "raw_capture_shard_authentication_failed");
      }
      authenticated.set(name, Object.freeze({ artifactTypeHash, receipt }));
    }

    const manifestPath = path.join(snapshotDirectory, "capture-manifest.raw.enc");
    const manifestAuthentication = authenticated.get("capture-manifest.raw.enc");
    const manifestReceipt = manifestAuthentication.receipt;
    if (manifestReceipt.artifact_sha256 !== options.detachedManifestArtifactSha256) {
      throw new Error("raw_capture_manifest_artifact_hash_mismatch");
    }
    const manifestBytes = await readArtifactPlaintext({
      artifactPath: manifestPath,
      artifactTypeHash: manifestAuthentication.artifactTypeHash,
      expectedIdentity: snapshotInventory.files.get("capture-manifest.raw.enc"),
      keyring,
      maxArtifactBytes: policy.maxArtifactBytes,
    }, Math.min(policy.maxArtifactBytes, 64 * 1024 * 1024));
    let manifest;
    try {
      manifest = parseCanonicalJcs(manifestBytes, { maxBytes: Math.min(policy.maxArtifactBytes, 64 * 1024 * 1024) });
    } catch {
      throw new Error("raw_capture_manifest_invalid");
    }
    const shards = validateManifest(manifest, options.contract, captureSha256, keyring);
    const manifestBinding = sha256Hex(canonicalizeJcs({
      capture_sha256: captureSha256,
      schema: RAW_MANIFEST_SCHEMA,
    }));
    if (manifestAuthentication.artifactTypeHash !== manifestBinding) {
      throw new Error("raw_capture_manifest_authentication_failed");
    }
    for (const shard of shards) {
      const name = `${String(shard.shard_index).padStart(3, "0")}.raw.enc`;
      const authentication = authenticated.get(name);
      const receipt = authentication.receipt;
      if (authentication.artifactTypeHash !== shard.hashes.binding_sha256 ||
          receipt.artifact_sha256 !== shard.hashes.artifact_sha256 ||
          receipt.content_sha256 !== shard.hashes.content_sha256) {
        throw new Error("raw_capture_shard_authentication_failed");
      }
    }
    const capability = Object.freeze({
      capture_sha256: captureSha256,
      counts: Object.freeze({ ...manifest.counts }),
      encrypted_bytes: Number(sourceInventory.totalBytes),
      manifest_content_sha256: manifestReceipt.content_sha256,
      snapshot_directory: snapshotDirectory,
      snapshot_sha256: manifest.hashes.snapshot_sha256,
      status: RAW_STATUS,
    });
    CAPABILITIES.set(capability, {
      active: false,
      cleanupComplete: false,
      closed: false,
      consumedComplete: false,
      contract: options.contract,
      keyring,
      manifest,
      expectedAuthority: Object.freeze({
        counts: Object.freeze({
          columns: manifest.counts.columns,
          rows: manifest.counts.rows,
          tables: manifest.counts.shards,
          views_queried: manifest.counts.views_queried,
        }),
        input: Object.freeze({
          capture_sha256: captureSha256,
          manifest_artifact_sha256: options.detachedManifestArtifactSha256,
          manifest_content_sha256: manifestReceipt.content_sha256,
          snapshot_sha256: manifest.hashes.snapshot_sha256,
          status: RAW_STATUS,
        }),
      }),
      policy,
      shards,
      snapshotDirectory,
      snapshotInventory,
    });
    return capability;
  } catch (error) {
    if (snapshotDirectory) {
      try {
        await rm(snapshotDirectory, { force: true, recursive: true });
      } catch (cleanupError) {
        Object.defineProperty(error, "cleanupFailure", {
          configurable: false,
          enumerable: false,
          value: cleanupError,
          writable: false,
        });
      }
    }
    keyring.kek.fill(0);
    keyring.hmacKey.fill(0);
    throw error;
  }
}

export function issueAuthenticatedRawCaptureInputAuthority(capability) {
  const state = CAPABILITIES.get(capability);
  if (!state || state.closed || state.active || !state.consumedComplete) {
    throw new Error("raw_capture_capability_invalid");
  }
  const authority = Object.freeze({});
  INPUT_AUTHORITIES.set(authority, Object.freeze({
    authority: state.expectedAuthority,
    capability,
  }));
  return authority;
}

export function resolveAuthenticatedRawCaptureInputAuthority(authority) {
  const binding = INPUT_AUTHORITIES.get(authority);
  const state = binding && CAPABILITIES.get(binding.capability);
  if (!binding || !state || state.closed || state.expectedAuthority !== binding.authority) {
    throw new Error("raw_capture_input_authority_invalid");
  }
  return Object.freeze({
    counts: Object.freeze({ ...binding.authority.counts }),
    input: Object.freeze({ ...binding.authority.input }),
  });
}

async function* framedPayloads(chunks, maxFrameBytes) {
  const lengthBytes = Buffer.alloc(4);
  let lengthOffset = 0;
  let payload = null;
  let payloadOffset = 0;
  for await (const chunk of chunks) {
    let offset = 0;
    while (offset < chunk.length) {
      if (payload === null) {
        const copied = Math.min(4 - lengthOffset, chunk.length - offset);
        chunk.copy(lengthBytes, lengthOffset, offset, offset + copied);
        lengthOffset += copied;
        offset += copied;
        if (lengthOffset < 4) continue;
        const length = lengthBytes.readUInt32BE(0);
        if (length <= 0 || length > maxFrameBytes) {
          throw new Error("raw_capture_shard_frame_invalid");
        }
        payload = Buffer.allocUnsafe(length);
        payloadOffset = 0;
        lengthOffset = 0;
      }
      const copied = Math.min(payload.length - payloadOffset, chunk.length - offset);
      chunk.copy(payload, payloadOffset, offset, offset + copied);
      payloadOffset += copied;
      offset += copied;
      if (payloadOffset === payload.length) {
        const complete = payload;
        payload = null;
        payloadOffset = 0;
        yield complete;
      }
    }
  }
  if (lengthOffset !== 0 || payload !== null) throw new Error("raw_capture_shard_frame_invalid");
}

function validateShardHeader(header, table, shard, manifest) {
  exactPlainObject(header, [
    "capture_sha256", "contract_sha256", "fields", "frame", "schema", "shard_index",
    "snapshot_sha256", "status", "table", "table_sha256", "watermark",
  ], "raw_capture_shard_header_invalid");
  const expectedFields = table.fields.map((field) => ({
    name: field.name,
    nullable: field.nullable,
    pg_type: field.data_type,
  }));
  if (header.capture_sha256 !== manifest.capture_sha256 ||
      header.contract_sha256 !== manifest.hashes.contract_sha256 ||
      header.frame !== "HEADER" || header.schema !== RAW_SHARD_SCHEMA ||
      header.shard_index !== shard.shard_index || header.snapshot_sha256 !== manifest.hashes.snapshot_sha256 ||
      header.status !== RAW_STATUS || header.table !== table.name ||
      header.table_sha256 !== shard.hashes.table_sha256 ||
      !canonicalizeJcs(header.fields).equals(canonicalizeJcs(expectedFields)) ||
      !canonicalizeJcs(header.watermark).equals(canonicalizeJcs(manifest.watermark))) {
    throw new Error("raw_capture_shard_header_invalid");
  }
}

function validateTypedRow(bytes, table) {
  let row;
  try {
    row = parseCanonicalJcs(bytes, { maxBytes: 128 * 1024 * 1024 });
    exactPlainObject(row, ["schema", "table", "values"], "raw_capture_typed_row_invalid");
  } catch {
    throw new Error("raw_capture_typed_row_invalid");
  }
  if (row.schema !== TYPED_SCHEMA || row.table !== table.name || !Array.isArray(row.values) ||
      row.values.length !== table.fields.length) {
    throw new Error("raw_capture_typed_row_invalid");
  }
  for (const [index, field] of table.fields.entries()) {
    const value = row.values[index];
    exactPlainObject(value, ["name", "pg_type", "raw"], "raw_capture_typed_row_invalid");
    if (value.name !== field.name || value.pg_type !== field.data_type ||
        !(value.raw === null || typeof value.raw === "string") ||
        value.raw === null && !field.nullable) {
      throw new Error("raw_capture_typed_row_invalid");
    }
  }
}

export async function* iterateAuthenticatedRawCapture(capability) {
  const state = CAPABILITIES.get(capability);
  if (!state) throw new TypeError("raw_capture_capability_invalid");
  if (state.closed) throw new Error("raw_capture_capability_closed");
  if (state.consumedComplete) throw new Error("raw_capture_capability_consumed");
  if (state.active) throw new Error("raw_capture_capability_in_use");
  state.active = true;
  let totalRows = 0;
  try {
    for (const shard of state.shards) {
      const table = shard.table;
      const artifactPath = path.join(
        state.snapshotDirectory,
        `${String(shard.shard_index).padStart(3, "0")}.raw.enc`,
      );
      const expectedIdentity = state.snapshotInventory.files.get(path.basename(artifactPath));
      const payloads = framedPayloads(decryptArtifact({
        artifactPath,
        artifactTypeHash: shard.hashes.binding_sha256,
        expectedIdentity,
        keyring: state.keyring,
        maxArtifactBytes: state.policy.maxArtifactBytes,
      }), state.policy.maxFrameBytes);
      let headerSeen = false;
      let trailerSeen = false;
      let rows = 0;
      const rowHash = createHash("sha256");
      yield Object.freeze({ table: table.name, type: "TABLE_START" });
      for await (const bytes of payloads) {
        let parsed;
        try {
          parsed = parseCanonicalJcs(bytes, { maxBytes: state.policy.maxFrameBytes });
        } catch {
          throw new Error("raw_capture_shard_frame_invalid");
        }
        if (!headerSeen) {
          validateShardHeader(parsed, table, shard, state.manifest);
          headerSeen = true;
          continue;
        }
        if (parsed?.frame === "TRAILER") {
          exactPlainObject(parsed, ["frame", "row_count", "row_stream_sha256", "schema"], "raw_capture_shard_trailer_invalid");
          if (trailerSeen || parsed.schema !== RAW_SHARD_SCHEMA || parsed.row_count !== rows ||
              parsed.row_count !== shard.counts.rows || parsed.row_stream_sha256 !== rowHash.digest("hex")) {
            throw new Error("raw_capture_shard_trailer_invalid");
          }
          trailerSeen = true;
          continue;
        }
        if (trailerSeen) throw new Error("raw_capture_shard_frame_invalid");
        validateTypedRow(bytes, table);
        rowHash.update(Buffer.concat([(() => {
          const length = Buffer.alloc(4);
          length.writeUInt32BE(bytes.length);
          return length;
        })(), bytes]));
        rows += 1;
        totalRows += 1;
        if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(totalRows)) {
          throw new Error("raw_capture_row_count_overflow");
        }
        yield Object.freeze({ table: table.name, type: "ROW", typed_row_bytes: Buffer.from(bytes) });
      }
      if (!headerSeen || !trailerSeen || rows !== shard.counts.rows) {
        throw new Error("raw_capture_shard_trailer_invalid");
      }
      yield Object.freeze({ row_count: rows, table: table.name, type: "TABLE_END" });
    }
    if (totalRows !== state.manifest.counts.rows) throw new Error("raw_capture_row_count_mismatch");
    state.consumedComplete = true;
  } finally {
    state.active = false;
  }
}

export async function closeAuthenticatedRawCapture(capability) {
  const state = CAPABILITIES.get(capability);
  if (!state) throw new TypeError("raw_capture_capability_invalid");
  if (state.active) throw new Error("raw_capture_capability_in_use");
  if (state.cleanupComplete) return;
  if (!state.closed) {
    state.closed = true;
    state.keyring.kek.fill(0);
    state.keyring.hmacKey.fill(0);
  }
  await rm(state.snapshotDirectory, { force: true, recursive: true });
  state.cleanupComplete = true;
}
