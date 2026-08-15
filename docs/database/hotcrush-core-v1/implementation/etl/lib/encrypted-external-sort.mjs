import {
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  rm,
  statfs,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { types as utilTypes } from "node:util";

import { canonicalizeJcs, parseCanonicalJcs, sha256Hex } from "./canonical.mjs";
import {
  assertSafeArtifactDirectory,
  verifyStreamingEncryptedArtifact,
  writeStreamingEncryptedArtifact,
} from "./envelope-stream.mjs";

const MAGIC = Buffer.from("HOTCRUSH-AES256GCM-STREAM-V1\n", "ascii");
const TAG_BYTES = 16;
const MAX_HEADER_BYTES = 16 * 1024;
const RUN_SCHEMA = "hotcrush.s0-v2.encrypted-sort-run.v1";
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const PREPARED = new WeakMap();

function attachCleanupFailure(error, cleanupError) {
  if (!Object.hasOwn(error, "cleanupFailure")) {
    Object.defineProperty(error, "cleanupFailure", {
      configurable: false,
      enumerable: false,
      value: cleanupError,
      writable: false,
    });
  }
}

function exactPlainObject(value, expected, code, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(code);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const allowed = new Set([...expected, ...optional]);
  if (expected.some((key) => !Object.hasOwn(descriptors, key)) ||
      actual.some((key) => !allowed.has(key)) ||
      Object.values(descriptors).some((descriptor) => !("value" in descriptor))) {
    throw new TypeError(code);
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function frameLength(bytes, maxFrameBytes) {
  if (bytes.length === 0 || bytes.length > maxFrameBytes) {
    throw new Error("s0_v2_sort_record_too_large");
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return length;
}

function validKey(value, keyKind) {
  return typeof value === "string" &&
    (keyKind === "LOWERCASE_UUID_V5" ? UUID_V5.test(value) : HEX_64.test(value));
}

function snapshotRecord(input, maxFrameBytes, keyKind) {
  const record = exactPlainObject(input, ["key", "value"], "s0_v2_sort_record_invalid");
  if (!validKey(record.key, keyKind) || !Buffer.isBuffer(record.value) ||
      record.value.length === 0 || record.value.length > maxFrameBytes) {
    throw new TypeError("s0_v2_sort_record_invalid");
  }
  return Object.freeze({ key: record.key, value: Buffer.from(record.value) });
}

function runPlaintext(records, maxFrameBytes) {
  return (async function* chunks() {
    for await (const record of records) {
      const header = canonicalizeJcs({
        key: record.key,
        schema: RUN_SCHEMA,
        value_bytes: record.value.length,
        value_sha256: sha256Hex(record.value),
      });
      yield frameLength(header, maxFrameBytes);
      yield header;
      yield frameLength(record.value, maxFrameBytes);
      yield record.value;
    }
  }());
}

function runRecordPlaintextBytes(record) {
  const header = canonicalizeJcs({
    key: record.key,
    schema: RUN_SCHEMA,
    value_bytes: record.value.length,
    value_sha256: sha256Hex(record.value),
  });
  return 4 + header.length + 4 + record.value.length;
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

function assertRunStat(info, maxArtifactBytes) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n ||
      (info.mode & 0o777n) !== 0o600n || info.size <= BigInt(MAGIC.length + 4 + TAG_BYTES) ||
      info.size > BigInt(maxArtifactBytes) ||
      (typeof process.getuid === "function" && info.uid !== BigInt(process.getuid()))) {
    throw new Error("s0_v2_sort_run_authentication_failed");
  }
}

async function openExpectedRun(run, flags, maxArtifactBytes) {
  const handle = await open(run.path, flags);
  try {
    const info = await handle.stat({ bigint: true });
    assertRunStat(info, maxArtifactBytes);
    if (!sameIdentity(statIdentity(info), run.identity)) {
      throw new Error("s0_v2_sort_run_authentication_failed");
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function readExact(handle, length, position) {
  const output = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(output, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error("s0_v2_sort_run_truncated");
    offset += bytesRead;
  }
  return output;
}

function decodeB64(value, length) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("s0_v2_sort_run_authentication_failed");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value) {
    throw new Error("s0_v2_sort_run_authentication_failed");
  }
  return bytes;
}

async function* decryptRunRecords(run, keyring, policy, maxArtifactBytes, keyKind) {
  await verifyStreamingEncryptedArtifact({
    expectedArtifactTypeHash: run.artifactTypeHash,
    keyring,
    maxBytes: maxArtifactBytes,
    openFileImpl: (_artifactPath, flags) => openExpectedRun(run, flags, maxArtifactBytes),
    path: run.path,
  }).then((receipt) => {
    if (receipt.artifact_sha256 !== run.artifactSha256) {
      throw new Error("s0_v2_sort_run_authentication_failed");
    }
  });
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await openExpectedRun(run, flags, maxArtifactBytes);
  let dek;
  let operationError;
  try {
    const info = await handle.stat();
    const magic = await readExact(handle, MAGIC.length, 0);
    if (!magic.equals(MAGIC)) throw new Error("s0_v2_sort_run_authentication_failed");
    const lengthBytes = await readExact(handle, 4, MAGIC.length);
    const headerLength = lengthBytes.readUInt32BE();
    if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES) {
      throw new Error("s0_v2_sort_run_authentication_failed");
    }
    const headerOffset = MAGIC.length + 4;
    const headerBytes = await readExact(handle, headerLength, headerOffset);
    const header = parseCanonicalJcs(headerBytes, { maxBytes: MAX_HEADER_BYTES });
    const headerValues = exactPlainObject(header, [
      "alg",
      "artifact_type_sha256",
      "format",
      "hmac_key_id",
      "kek_id",
      "payload_iv",
      "wrap_iv",
      "wrap_tag",
      "wrapped_dek",
    ], "s0_v2_sort_run_authentication_failed");
    if (headerValues.alg !== "AES-256-GCM" ||
        headerValues.format !== "hotcrush.aes256gcm-stream.v1" ||
        headerValues.artifact_type_sha256 !== run.artifactTypeHash ||
        headerValues.kek_id !== keyring.kekId || headerValues.hmac_key_id !== keyring.hmacKeyId) {
      throw new Error("s0_v2_sort_run_authentication_failed");
    }
    const descriptor = Object.fromEntries([
      "alg",
      "artifact_type_sha256",
      "format",
      "hmac_key_id",
      "kek_id",
      "payload_iv",
      "wrap_iv",
    ].map((key) => [key, headerValues[key]]));
    const unwrap = createDecipheriv("aes-256-gcm", keyring.kek, decodeB64(headerValues.wrap_iv, 12));
    unwrap.setAAD(canonicalizeJcs(descriptor));
    unwrap.setAuthTag(decodeB64(headerValues.wrap_tag, TAG_BYTES));
    dek = Buffer.concat([
      unwrap.update(decodeB64(headerValues.wrapped_dek, 32)),
      unwrap.final(),
    ]);
    const payloadOffset = headerOffset + headerLength;
    const ciphertextBytes = info.size - payloadOffset - TAG_BYTES;
    const tag = await readExact(handle, TAG_BYTES, payloadOffset + ciphertextBytes);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      dek,
      decodeB64(headerValues.payload_iv, 12),
    );
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(tag);
    let position = payloadOffset;
    let remaining = ciphertextBytes;
    const frameLengthBytes = Buffer.alloc(4);
    let lengthOffset = 0;
    let payload = null;
    let framePayloadOffset = 0;
    let recordHeader = null;

    function consume(bytes) {
      const records = [];
      let offset = 0;
      while (offset < bytes.length) {
        if (payload === null) {
          const copied = Math.min(4 - lengthOffset, bytes.length - offset);
          bytes.copy(frameLengthBytes, lengthOffset, offset, offset + copied);
          lengthOffset += copied;
          offset += copied;
          if (lengthOffset < 4) continue;
          const length = frameLengthBytes.readUInt32BE(0);
          if (length <= 0 || length > policy.maxFrameBytes) {
            throw new Error("s0_v2_sort_run_invalid");
          }
          payload = Buffer.allocUnsafe(length);
          framePayloadOffset = 0;
          lengthOffset = 0;
        }
        const copied = Math.min(payload.length - framePayloadOffset, bytes.length - offset);
        bytes.copy(payload, framePayloadOffset, offset, offset + copied);
        framePayloadOffset += copied;
        offset += copied;
        if (framePayloadOffset < payload.length) continue;
        const complete = payload;
        payload = null;
        framePayloadOffset = 0;
        if (recordHeader === null) {
          let parsed;
          try {
            parsed = parseCanonicalJcs(complete, { maxBytes: policy.maxFrameBytes });
            parsed = exactPlainObject(parsed, [
              "key",
              "schema",
              "value_bytes",
              "value_sha256",
            ], "s0_v2_sort_run_invalid");
          } catch {
            throw new Error("s0_v2_sort_run_invalid");
          }
          if (!validKey(parsed.key, keyKind) || parsed.schema !== RUN_SCHEMA ||
              !Number.isSafeInteger(parsed.value_bytes) || parsed.value_bytes <= 0 ||
              parsed.value_bytes > policy.maxFrameBytes ||
              typeof parsed.value_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(parsed.value_sha256)) {
            throw new Error("s0_v2_sort_run_invalid");
          }
          recordHeader = parsed;
        } else {
          if (complete.length !== recordHeader.value_bytes ||
              sha256Hex(complete) !== recordHeader.value_sha256) {
            throw new Error("s0_v2_sort_run_invalid");
          }
          records.push(Object.freeze({ key: recordHeader.key, value: complete }));
          recordHeader = null;
        }
      }
      return records;
    }

    while (remaining > 0) {
      const length = Math.min(64 * 1024, remaining);
      const ciphertext = await readExact(handle, length, position);
      for (const record of consume(decipher.update(ciphertext))) yield record;
      position += length;
      remaining -= length;
    }
    for (const record of consume(decipher.final())) yield record;
    if (lengthOffset !== 0 || payload !== null || recordHeader !== null) {
      throw new Error("s0_v2_sort_run_invalid");
    }
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    dek?.fill(0);
    try {
      await handle.close();
    } catch (cleanupError) {
      if (operationError) attachCleanupFailure(operationError, cleanupError);
      else throw cleanupError;
    }
  }
}

async function* mergeRunRecords(runs, keyring, policy, maxArtifactBytes, keyKind, duplicatePolicy) {
  const iterators = runs.map((run) =>
    decryptRunRecords(run, keyring, policy, maxArtifactBytes, keyKind)[Symbol.asyncIterator]());
  let previous = null;
  try {
    const current = await Promise.all(iterators.map((iterator) => iterator.next()));
    while (true) {
      let selected = -1;
      for (let index = 0; index < current.length; index += 1) {
        if (current[index].done) continue;
        if (selected === -1 || current[index].value.key < current[selected].value.key) selected = index;
      }
      if (selected === -1) return;
      const record = current[selected].value;
      if (record.key === previous && duplicatePolicy === "FAIL") {
        throw new Error("s0_v2_duplicate_occurrence_id");
      }
      previous = record.key;
      yield record;
      current[selected] = await iterators[selected].next();
    }
  } finally {
    await Promise.allSettled(iterators.map((iterator) => iterator.return?.()));
  }
}

function validatePolicy(input) {
  const policy = exactPlainObject(input, [
    "freeSpaceReserveBytes",
    "maxFrameBytes",
    "maxMemoryBytes",
    "maxMergePasses",
    "maxOpenRuns",
    "maxRunPlaintextBytes",
    "temporaryDiskMultiplier",
  ], "s0_v2_sort_policy_invalid", ["maxArtifactBytes"]);
  for (const key of Object.keys(policy)) {
    if (!Number.isSafeInteger(policy[key]) || policy[key] < 0) {
      throw new TypeError("s0_v2_sort_policy_invalid");
    }
  }
  // Initial runs retain the bounded record set, the caller's current source value, and
  // one cipher output buffer. Merge holds one decrypted value per input plus one cipher output.
  const initialResidentBytes = BigInt(policy.maxRunPlaintextBytes) +
    BigInt(policy.maxFrameBytes) * 2n;
  const mergeResidentBytes = BigInt(policy.maxOpenRuns + 1) * BigInt(policy.maxFrameBytes);
  if (policy.maxFrameBytes <= 0 || policy.maxMemoryBytes < policy.maxFrameBytes ||
      policy.maxMergePasses < 1 || policy.maxOpenRuns < 2 ||
      policy.maxRunPlaintextBytes <= 0 || policy.temporaryDiskMultiplier < 2 ||
      policy.maxRunPlaintextBytes > Math.floor(policy.maxMemoryBytes / 2) ||
      initialResidentBytes > BigInt(policy.maxMemoryBytes) ||
      mergeResidentBytes > BigInt(policy.maxMemoryBytes) ||
      policy.maxArtifactBytes !== undefined && policy.maxArtifactBytes <= policy.maxFrameBytes) {
    throw new TypeError("s0_v2_sort_policy_invalid");
  }
  return Object.freeze(policy);
}

function availableBytes(info) {
  const bavail = typeof info?.bavail === "bigint" ? info.bavail : BigInt(info?.bavail);
  const bsize = typeof info?.bsize === "bigint" ? info.bsize : BigInt(info?.bsize);
  if (bavail < 0n || bsize <= 0n) throw new Error("s0_v2_temporary_space_probe_failed");
  return bavail * bsize;
}

export async function prepareEncryptedExternalSort(input) {
  const options = exactPlainObject(input, [
    "estimatedInputBytes",
    "records",
    "resourcePolicy",
    "statfsImpl",
    "workDirectory",
  ], "s0_v2_sort_input_invalid", ["duplicatePolicy", "keyKind", "testHooks"]);
  const policy = validatePolicy(options.resourcePolicy);
  const duplicatePolicy = options.duplicatePolicy ?? "FAIL";
  const keyKind = options.keyKind ?? "LOWERCASE_UUID_V5";
  if (!Number.isSafeInteger(options.estimatedInputBytes) || options.estimatedInputBytes < 0 ||
      typeof options.workDirectory !== "string" || !path.isAbsolute(options.workDirectory) ||
      typeof options.statfsImpl !== "function" ||
      !options.records || typeof options.records[Symbol.asyncIterator] !== "function" ||
      !["ALLOW", "FAIL"].includes(duplicatePolicy) ||
      !["LOWERCASE_HEX_64", "LOWERCASE_UUID_V5"].includes(keyKind)) {
    throw new TypeError("s0_v2_sort_input_invalid");
  }
  const hooks = options.testHooks === undefined ? {} :
    exactPlainObject(options.testHooks, ["onRunSealed"], "s0_v2_sort_input_invalid");
  if (hooks.onRunSealed !== undefined && typeof hooks.onRunSealed !== "function") {
    throw new TypeError("s0_v2_sort_input_invalid");
  }
  await assertSafeArtifactDirectory(options.workDirectory);
  let free;
  try {
    free = availableBytes(await options.statfsImpl(options.workDirectory));
  } catch (error) {
    if (error?.message === "s0_v2_temporary_space_probe_failed") throw error;
    throw new Error("s0_v2_temporary_space_probe_failed");
  }
  const required = BigInt(options.estimatedInputBytes) * BigInt(policy.temporaryDiskMultiplier) +
    BigInt(policy.freeSpaceReserveBytes);
  if (free < required) throw new Error("s0_v2_insufficient_temporary_space");

  const ephemeralKek = randomBytes(32);
  const ephemeralHmac = randomBytes(32);
  const keyring = {
    kekId: "s0-v2-sort-ephemeral",
    kek: ephemeralKek,
    hmacKeyId: "s0-v2-sort-ephemeral-integrity",
    hmacKey: ephemeralHmac,
  };
  const sortDirectory = await mkdtemp(path.join(options.workDirectory, ".s0-v2-sort-"));
  let runOrdinal = 0;
  const maxArtifactBytes = Math.min(
    Number.MAX_SAFE_INTEGER,
    policy.maxArtifactBytes ??
      Math.max(policy.maxMemoryBytes, options.estimatedInputBytes * 4 + 1024 * 1024),
  );

  async function writeRun(records, level) {
    runOrdinal += 1;
    const runId = randomBytes(16).toString("hex");
    const artifactTypeHash = sha256Hex(canonicalizeJcs({
      level,
      run_id: runId,
      schema: RUN_SCHEMA,
    }));
    const receipt = await writeStreamingEncryptedArtifact({
      artifactTypeHash,
      directory: sortDirectory,
      filename: `run-${String(runOrdinal).padStart(8, "0")}.enc`,
      keyring,
      plaintextChunks: runPlaintext(records, policy.maxFrameBytes),
    });
    if (receipt.bytes > maxArtifactBytes) throw new Error("s0_v2_sort_run_too_large");
    const sealed = await lstat(receipt.path, { bigint: true });
    assertRunStat(sealed, maxArtifactBytes);
    const run = Object.freeze({
      artifactSha256: receipt.artifact_sha256,
      artifactTypeHash,
      identity: statIdentity(sealed),
      path: receipt.path,
    });
    await hooks.onRunSealed?.({
      artifactSha256: run.artifactSha256,
      level,
      path: run.path,
    });
    return run;
  }

  try {
    const runs = [];
    let chunk = [];
    let chunkBytes = 0;
    async function flushChunk() {
      if (chunk.length === 0) return;
      chunk.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
      for (let index = 1; index < chunk.length; index += 1) {
        if (duplicatePolicy === "FAIL" && chunk[index - 1].key === chunk[index].key) {
          throw new Error("s0_v2_duplicate_occurrence_id");
        }
      }
      runs.push(await writeRun(chunk, 0));
      chunk = [];
      chunkBytes = 0;
    }
    for await (const inputRecord of options.records) {
      const record = snapshotRecord(inputRecord, policy.maxFrameBytes, keyKind);
      const estimated = runRecordPlaintextBytes(record);
      if (estimated > policy.maxRunPlaintextBytes) {
        throw new Error("s0_v2_sort_record_exceeds_run_limit");
      }
      if (chunk.length > 0 && chunkBytes + estimated > policy.maxRunPlaintextBytes) await flushChunk();
      chunk.push(record);
      chunkBytes += estimated;
      if (chunkBytes > policy.maxMemoryBytes) throw new Error("s0_v2_sort_memory_limit");
    }
    await flushChunk();

    let currentRuns = runs;
    let level = 0;
    while (currentRuns.length > 1) {
      level += 1;
      if (level > policy.maxMergePasses) throw new Error("s0_v2_sort_merge_pass_limit");
      const nextRuns = [];
      for (let offset = 0; offset < currentRuns.length; offset += policy.maxOpenRuns) {
        const group = currentRuns.slice(offset, offset + policy.maxOpenRuns);
        const merged = await writeRun(
          mergeRunRecords(group, keyring, policy, maxArtifactBytes, keyKind, duplicatePolicy),
          level,
        );
        nextRuns.push(merged);
        for (const run of group) await unlink(run.path);
      }
      currentRuns = nextRuns;
    }
    const capability = Object.freeze({});
    PREPARED.set(capability, {
      active: false,
      cleanupComplete: false,
      closed: false,
      finalRun: currentRuns[0] ?? null,
      keyKind,
      keyring,
      maxArtifactBytes,
      policy,
      sortDirectory,
    });
    return capability;
  } catch (error) {
    ephemeralKek.fill(0);
    ephemeralHmac.fill(0);
    try {
      await rm(sortDirectory, { force: true, recursive: true });
    } catch (cleanupError) {
      attachCleanupFailure(error, cleanupError);
    }
    throw error;
  }
}

export async function* iteratePreparedEncryptedSort(capability) {
  const state = PREPARED.get(capability);
  if (!state) throw new TypeError("s0_v2_sort_capability_invalid");
  if (state.closed) throw new Error("s0_v2_sort_closed");
  if (state.active) throw new Error("s0_v2_sort_in_use");
  state.active = true;
  try {
    if (state.finalRun) {
      yield* decryptRunRecords(
        state.finalRun,
        state.keyring,
        state.policy,
        state.maxArtifactBytes,
        state.keyKind,
      );
    }
  } finally {
    state.active = false;
  }
}

export async function closePreparedEncryptedSort(capability) {
  const state = PREPARED.get(capability);
  if (!state) throw new TypeError("s0_v2_sort_capability_invalid");
  if (state.active) throw new Error("s0_v2_sort_in_use");
  if (state.cleanupComplete) return;
  if (!state.closed) {
    state.closed = true;
    state.keyring.kek.fill(0);
    state.keyring.hmacKey.fill(0);
  }
  await rm(state.sortDirectory, { force: true, recursive: true });
  state.cleanupComplete = true;
}

export async function* encryptedExternalSort(input) {
  const prepared = await prepareEncryptedExternalSort(input);
  let operationError;
  try {
    yield* iteratePreparedEncryptedSort(prepared);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await closePreparedEncryptedSort(prepared);
    } catch (cleanupError) {
      if (operationError) attachCleanupFailure(operationError, cleanupError);
      else throw cleanupError;
    }
  }
}

export function defaultEncryptedSortStatfs(directory) {
  return statfs(directory, { bigint: true });
}
