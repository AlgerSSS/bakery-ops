import { createDecipheriv, createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { types as utilTypes } from "node:util";

import {
  closeReferenceEncryptedSorter,
  createReferenceEncryptedSorter,
  iterateReferenceEncryptedSorter,
  pushReferenceEncryptedSorter,
  referenceAnalyzeS0V2TypedRow,
  referenceBuildS0V2ContentDocument,
  referenceComputeS0V2GlobalRoots,
  referenceDomainHmac,
  referenceExpectedS0V2Token,
  referenceFrame,
  referenceJcs,
  sealReferenceEncryptedSorter,
} from "./s0-v2-reference-sort.mjs";

const MAGIC = Buffer.from("HOTCRUSH-AES256GCM-STREAM-V1\n", "ascii");
const STREAM_FORMAT = "hotcrush.aes256gcm-stream.v1";
const SCHEMA = "hotcrush.r6.s0.offline.v2";
const STATUS = "S0_ENCRYPTED_OFFLINE_VERIFIED_V2";
const FILE_SHA = "7ea542ef1e654b094628bbb97868b28a963879a4815740f7fa4f65c8c60d8587";
const JCS_SHA = "4fb6c9acb9decfe873f9e44e954e1af5d7a6d7fc1005e529979bb6a584cc814f";
const ADDENDUM_SHA = "0710ad32757c65ea655af3be0e885932c588a11ff9f7d073b8258e7ff1beaea7";
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_FRAME_BYTES = 128 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 17_179_869_184;
const TAG_BYTES = 16;
const DIGEST = /^[0-9a-f]{64}$/;
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REFERENCE_SORT_POLICY = Object.freeze({
  maxMemoryBytes: 8 * 1024 * 1024,
  maxMergePasses: 16,
  maxOpenRuns: 8,
  maxRecordBytes: 1024,
  maxRunBytes: 4 * 1024 * 1024,
});

function snapshotData(value, state = { nodes: 0, seen: new Set() }) {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (!value || typeof value !== "object" || Buffer.isBuffer(value) || value instanceof Date ||
      utilTypes.isProxy(value) || state.seen.has(value) || ++state.nodes > 100_000) {
    throw new TypeError("reference_contract_invalid");
  }
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) throw new TypeError("reference_contract_invalid");
        output.push(snapshotData(descriptor.value, state));
      }
      if (Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) ||
          Object.getOwnPropertySymbols(value).length !== 0) {
        throw new TypeError("reference_contract_invalid");
      }
      return output;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError("reference_contract_invalid");
    }
    const output = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor) || ["__proto__", "constructor", "prototype"].includes(key)) {
        throw new TypeError("reference_contract_invalid");
      }
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: snapshotData(descriptor.value, state),
        writable: true,
      });
    }
    return output;
  } finally {
    state.seen.delete(value);
  }
}

function exact(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(code);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]) ||
      Object.values(descriptors).some((descriptor) => !("value" in descriptor))) {
    throw new TypeError(code);
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) =>
    [key, descriptor.value]));
}

function parseJcs(bytes, maxBytes = MAX_FRAME_BYTES) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maxBytes) {
    throw new TypeError("reference_jcs_invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new TypeError("reference_jcs_invalid");
  }
  if (!referenceJcs(parsed).equals(bytes)) throw new TypeError("reference_jcs_invalid");
  return parsed;
}

function decode(value, length) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("reference_encoding_invalid");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value) {
    throw new TypeError("reference_encoding_invalid");
  }
  return bytes;
}

function b64Hex(value) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError("reference_digest_invalid");
  }
  return Buffer.from(value, "hex").toString("base64url");
}

function cloneKeys(input) {
  const value = exact(input, ["hmacKey", "hmacKeyId", "kek", "kekId"],
    "reference_keyring_invalid");
  if (!Buffer.isBuffer(value.kek) || value.kek.length !== 32 ||
      !Buffer.isBuffer(value.hmacKey) || value.hmacKey.length !== 32 ||
      typeof value.kekId !== "string" || typeof value.hmacKeyId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.kekId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.hmacKeyId) ||
      value.kek.equals(value.hmacKey)) {
    throw new TypeError("reference_keyring_invalid");
  }
  return {
    hmacKey: Buffer.from(value.hmacKey),
    hmacKeyId: value.hmacKeyId,
    kek: Buffer.from(value.kek),
    kekId: value.kekId,
  };
}

async function readExact(handle, length, position) {
  const output = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(output, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error("reference_artifact_truncated");
    offset += bytesRead;
  }
  return output;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

async function decryptPass({ artifactPath, expectedIdentity, keyring, onPlaintext }) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(artifactPath, flags);
  let dataKey;
  let operationError;
  let result;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 ||
        info.size <= MAGIC.length + 4 + TAG_BYTES || info.size > MAX_ARTIFACT_BYTES ||
        (typeof process.getuid === "function" && info.uid !== process.getuid()) ||
        expectedIdentity && !sameIdentity(expectedIdentity, info)) {
      throw new Error("reference_artifact_unsafe");
    }
    const artifactHash = createHash("sha256");
    const magic = await readExact(handle, MAGIC.length, 0);
    if (!magic.equals(MAGIC)) throw new Error("reference_artifact_magic_invalid");
    artifactHash.update(magic);
    const lengthBytes = await readExact(handle, 4, MAGIC.length);
    artifactHash.update(lengthBytes);
    const headerLength = lengthBytes.readUInt32BE();
    if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES) {
      throw new Error("reference_header_invalid");
    }
    const headerOffset = MAGIC.length + 4;
    const headerBytes = await readExact(handle, headerLength, headerOffset);
    artifactHash.update(headerBytes);
    const header = exact(parseJcs(headerBytes, MAX_HEADER_BYTES), [
      "alg", "artifact_type_sha256", "format", "hmac_key_id", "kek_id", "payload_iv",
      "wrap_iv", "wrap_tag", "wrapped_dek",
    ], "reference_header_invalid");
    if (header.alg !== "AES-256-GCM" || header.format !== STREAM_FORMAT ||
        !DIGEST.test(header.artifact_type_sha256) || header.hmac_key_id !== keyring.hmacKeyId ||
        header.kek_id !== keyring.kekId) {
      throw new Error("reference_header_invalid");
    }
    const descriptor = {
      alg: header.alg,
      artifact_type_sha256: header.artifact_type_sha256,
      format: header.format,
      hmac_key_id: header.hmac_key_id,
      kek_id: header.kek_id,
      payload_iv: header.payload_iv,
      wrap_iv: header.wrap_iv,
    };
    const unwrap = createDecipheriv("aes-256-gcm", keyring.kek, decode(header.wrap_iv, 12));
    unwrap.setAAD(referenceJcs(descriptor));
    unwrap.setAuthTag(decode(header.wrap_tag, TAG_BYTES));
    dataKey = Buffer.concat([unwrap.update(decode(header.wrapped_dek, 32)), unwrap.final()]);
    const payloadOffset = headerOffset + headerLength;
    const encryptedBytes = info.size - payloadOffset - TAG_BYTES;
    if (encryptedBytes < 0) throw new Error("reference_artifact_truncated");
    const authTag = await readExact(handle, TAG_BYTES, payloadOffset + encryptedBytes);
    const decipher = createDecipheriv("aes-256-gcm", dataKey, decode(header.payload_iv, 12));
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(authTag);
    let position = payloadOffset;
    let remaining = encryptedBytes;
    while (remaining > 0) {
      const length = Math.min(64 * 1024, remaining);
      const encrypted = await readExact(handle, length, position);
      artifactHash.update(encrypted);
      const plaintext = decipher.update(encrypted);
      if (plaintext.length > 0) await onPlaintext(plaintext);
      remaining -= length;
      position += length;
    }
    const final = decipher.final();
    if (final.length > 0) await onPlaintext(final);
    artifactHash.update(authTag);
    result = {
      artifactSha256: artifactHash.digest("hex"),
      artifactTypeSha256: header.artifact_type_sha256,
      identity: {
        ctimeMs: info.ctimeMs,
        dev: info.dev,
        ino: info.ino,
        mtimeMs: info.mtimeMs,
        size: info.size,
      },
    };
  } catch (error) {
    operationError = error;
  } finally {
    dataKey?.fill(0);
    try {
      await handle.close();
    } catch (closeError) {
      if (operationError) {
        Object.defineProperty(operationError, "closeFailure", {
          configurable: false,
          enumerable: false,
          value: closeError,
          writable: false,
        });
      } else {
        operationError = closeError;
      }
    }
  }
  if (operationError) throw operationError;
  return result;
}

function frameParser(onFrame) {
  const lengthBytes = Buffer.alloc(4);
  let lengthOffset = 0;
  let payload = null;
  let payloadOffset = 0;
  return {
    async finish() {
      if (lengthOffset !== 0 || payload !== null) throw new Error("reference_frame_truncated");
    },
    async push(bytes) {
      let offset = 0;
      while (offset < bytes.length) {
        if (payload === null) {
          const copied = Math.min(4 - lengthOffset, bytes.length - offset);
          bytes.copy(lengthBytes, lengthOffset, offset, offset + copied);
          lengthOffset += copied;
          offset += copied;
          if (lengthOffset < 4) continue;
          const length = lengthBytes.readUInt32BE(0);
          if (length <= 0 || length > MAX_FRAME_BYTES) throw new Error("reference_frame_invalid");
          payload = Buffer.allocUnsafe(length);
          payloadOffset = 0;
          lengthOffset = 0;
        }
        const copied = Math.min(payload.length - payloadOffset, bytes.length - offset);
        bytes.copy(payload, payloadOffset, offset, offset + copied);
        payloadOffset += copied;
        offset += copied;
        if (payloadOffset === payload.length) {
          const complete = payload;
          payload = null;
          payloadOffset = 0;
          await onFrame(complete);
        }
      }
    },
  };
}

function tableEndValue(table) {
  return {
    frame: "TABLE_END",
    row_count: table.row_count,
    schema: SCHEMA,
    streams: {
      data: {
        bytes: table.streams.data.bytes,
        root: b64Hex(table.streams.data.root_hex),
        sha256: table.streams.data.sha256,
      },
      occurrences: {
        bytes: table.streams.occurrences.bytes,
        root: b64Hex(table.streams.occurrences.root_hex),
        sha256: table.streams.occurrences.sha256,
      },
    },
    table: table.table,
    table_root: b64Hex(table.table_root_hex),
  };
}

function exactContract(contractInput) {
  const contract = snapshotData(contractInput);
  if (!contract || typeof contract !== "object" || !Array.isArray(contract.source_tables) ||
      contract.source_tables.length !== 76 || contract.counts?.source_tables !== 76 ||
      contract.counts?.source_table_fields !== 759) {
    throw new TypeError("reference_contract_invalid");
  }
  const names = new Set();
  for (const table of contract.source_tables) {
    if (!table || typeof table.name !== "string" || names.has(table.name) ||
        !Array.isArray(table.fields) || !Array.isArray(table.identity?.columns)) {
      throw new TypeError("reference_contract_invalid");
    }
    names.add(table.name);
  }
  if (createHash("sha256").update(referenceJcs(contract)).digest("hex") !== JCS_SHA) {
    throw new TypeError("reference_contract_invalid");
  }
  return contract;
}

function verifierState(
  contract,
  expectedAddendumSha256,
  expectedInput,
  keyring,
  streamArtifactType,
  workDirectory,
) {
  let phase = "HEADER";
  let tableIndex = 0;
  let current = null;
  let header = null;
  let trailer = null;
  const tables = [];
  let totalRows = 0;

  async function start(value) {
    const table = contract.source_tables[tableIndex];
    const actual = exact(value, ["frame", "identity_columns", "identity_mode", "schema", "table"],
      "reference_table_start_invalid");
    const expected = {
      frame: "TABLE_START",
      identity_columns: table.identity.columns,
      identity_mode: table.identity.mode,
      schema: SCHEMA,
      table: table.name,
    };
    if (!referenceJcs(actual).equals(referenceJcs(expected))) {
      throw new Error("reference_table_start_invalid");
    }
    current = {
      dataBytes: 0,
      dataHash: createHash("sha256"),
      identitySorter: await createReferenceEncryptedSorter({
        policy: REFERENCE_SORT_POLICY,
        workDirectory,
      }),
      occurrenceBytes: 0,
      occurrenceHash: createHash("sha256"),
      previous: null,
      rows: 0,
      table,
    };
    phase = "ROWS";
  }

  async function row(value) {
    const outer = exact(value, ["frame", "occurrence_token", "schema", "typed_row"],
      "reference_row_invalid");
    if (outer.frame !== "ROW" || outer.schema !== SCHEMA) throw new Error("reference_row_invalid");
    const token = exact(outer.occurrence_token, [
      "identity_hmac", "occurrence_id", "payload_hmac", "row_id", "table",
    ], "reference_row_invalid");
    const typedRow = exact(outer.typed_row, ["schema", "table", "values"], "reference_row_invalid");
    if (token.table !== current.table.name || typedRow.table !== current.table.name ||
        typedRow.schema !== "hotcrush.typed-jcs.v1" || !Array.isArray(typedRow.values) ||
        !UUID_V5.test(token.occurrence_id) || !UUID_V5.test(token.row_id) ||
        decode(token.identity_hmac, 32).length !== 32 || decode(token.payload_hmac, 32).length !== 32 ||
        current.previous !== null && token.occurrence_id <= current.previous) {
      throw new Error("reference_row_invalid");
    }
    const typedBytes = referenceJcs(typedRow);
    const tokenBytes = referenceJcs(token);
    const analysis = referenceAnalyzeS0V2TypedRow({
      hmacKey: keyring.hmacKey,
      table: current.table,
      typedRow: typedBytes,
    });
    if (current.table.identity.mode === "FULL_ROW_MULTISET") {
      if (token.identity_hmac !== analysis.identity_hmac ||
          token.payload_hmac !== analysis.payload_hmac || token.row_id !== token.occurrence_id) {
        throw new Error("reference_row_invalid");
      }
      await pushReferenceEncryptedSorter(current.identitySorter, {
        key: `${analysis.payload_hmac_hex}:${token.occurrence_id}`,
        value: analysis.identity_hmac_hex,
      });
    } else {
      const expectedToken = referenceExpectedS0V2Token({
        analysis,
        hmacKey: keyring.hmacKey,
        table: current.table,
      });
      if (!referenceJcs(token).equals(referenceJcs(expectedToken))) {
        throw new Error("reference_row_invalid");
      }
      await pushReferenceEncryptedSorter(current.identitySorter, {
        key: analysis.identity_hmac_hex,
        value: token.row_id,
      });
    }
    const dataFrame = referenceFrame(typedBytes);
    const occurrenceFrame = referenceFrame(tokenBytes);
    current.dataHash.update(dataFrame);
    current.occurrenceHash.update(occurrenceFrame);
    current.dataBytes += dataFrame.length;
    current.occurrenceBytes += occurrenceFrame.length;
    current.rows += 1;
    if (![current.dataBytes, current.occurrenceBytes, current.rows].every(Number.isSafeInteger)) {
      throw new Error("reference_count_invalid");
    }
    current.previous = token.occurrence_id;
  }

  async function validateIdentitySorter(tableState) {
    let expectedSorter;
    let operationError;
    try {
      await sealReferenceEncryptedSorter(tableState.identitySorter);
      if (tableState.table.identity.mode !== "FULL_ROW_MULTISET") {
        let previousIdentity = null;
        for await (const record of iterateReferenceEncryptedSorter(tableState.identitySorter)) {
          if (record.key === previousIdentity) throw new Error("reference_duplicate_identity");
          previousIdentity = record.key;
        }
        return;
      }
      expectedSorter = await createReferenceEncryptedSorter({
        policy: REFERENCE_SORT_POLICY,
        workDirectory,
      });
      let payloadHex = null;
      let identityHex = null;
      let groupRows = 0;
      async function emitExpectedGroup() {
        if (payloadHex === null) return;
        const analysis = {
          identity_hmac: Buffer.from(identityHex, "hex").toString("base64url"),
          identity_hmac_hex: identityHex,
          payload_hmac: Buffer.from(payloadHex, "hex").toString("base64url"),
          payload_hmac_hex: payloadHex,
        };
        for (let occurrence = 0; occurrence < groupRows; occurrence += 1) {
          const expectedToken = referenceExpectedS0V2Token({
            analysis,
            hmacKey: keyring.hmacKey,
            occurrence,
            table: tableState.table,
          });
          await pushReferenceEncryptedSorter(expectedSorter, {
            key: `${payloadHex}:${expectedToken.occurrence_id}`,
            value: identityHex,
          });
        }
      }
      for await (const record of iterateReferenceEncryptedSorter(tableState.identitySorter)) {
        const recordPayload = record.key.slice(0, 64);
        if (record.key[64] !== ":" || !DIGEST.test(recordPayload) ||
            !UUID_V5.test(record.key.slice(65)) || !DIGEST.test(record.value)) {
          throw new Error("reference_multiset_occurrence_invalid");
        }
        if (recordPayload !== payloadHex) {
          await emitExpectedGroup();
          payloadHex = recordPayload;
          identityHex = record.value;
          groupRows = 0;
        } else if (record.value !== identityHex) {
          throw new Error("reference_multiset_occurrence_invalid");
        }
        groupRows += 1;
        if (!Number.isSafeInteger(groupRows)) throw new Error("reference_count_invalid");
      }
      await emitExpectedGroup();
      await sealReferenceEncryptedSorter(expectedSorter);
      const observed = iterateReferenceEncryptedSorter(tableState.identitySorter)[Symbol.asyncIterator]();
      const expected = iterateReferenceEncryptedSorter(expectedSorter)[Symbol.asyncIterator]();
      try {
        while (true) {
          const [left, right] = await Promise.all([observed.next(), expected.next()]);
          if (left.done || right.done) {
            if (left.done !== right.done) throw new Error("reference_multiset_occurrence_invalid");
            break;
          }
          if (left.value.key !== right.value.key || left.value.value !== right.value.value) {
            throw new Error("reference_multiset_occurrence_invalid");
          }
        }
      } finally {
        await Promise.allSettled([observed.return?.(), expected.return?.()]);
      }
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      const cleanup = await Promise.allSettled([
        closeReferenceEncryptedSorter(tableState.identitySorter),
        ...(expectedSorter ? [closeReferenceEncryptedSorter(expectedSorter)] : []),
      ]);
      const cleanupFailure = cleanup.find((result) => result.status === "rejected");
      if (cleanupFailure && !operationError) throw cleanupFailure.reason;
    }
  }

  async function end(value) {
    const actual = exact(value, ["frame", "row_count", "schema", "streams", "table", "table_root"],
      "reference_table_end_invalid");
    await validateIdentitySorter(current);
    const dataSha = current.dataHash.digest("hex");
    const occurrenceSha = current.occurrenceHash.digest("hex");
    const dataRoot = referenceDomainHmac(
      keyring.hmacKey,
      "s0-table-data-stream:v2",
      referenceJcs({
        bytes: current.dataBytes,
        row_count: current.rows,
        sha256: dataSha,
        table: current.table.name,
      }),
    );
    const occurrenceRoot = referenceDomainHmac(
      keyring.hmacKey,
      "s0-table-occurrences:v2",
      referenceJcs({
        bytes: current.occurrenceBytes,
        row_count: current.rows,
        sha256: occurrenceSha,
        table: current.table.name,
      }),
    );
    const tableRoot = referenceDomainHmac(keyring.hmacKey, "s0-table-root:v2", referenceJcs({
      identity_mode: current.table.identity.mode,
      row_count: current.rows,
      table: current.table.name,
      table_data_stream_root: dataRoot.toString("base64url"),
      table_occurrences_root: occurrenceRoot.toString("base64url"),
    }));
    const built = Object.freeze({
      identity_mode: current.table.identity.mode,
      row_count: current.rows,
      streams: Object.freeze({
        data: Object.freeze({
          bytes: current.dataBytes,
          root_hex: dataRoot.toString("hex"),
          sha256: dataSha,
        }),
        occurrences: Object.freeze({
          bytes: current.occurrenceBytes,
          root_hex: occurrenceRoot.toString("hex"),
          sha256: occurrenceSha,
        }),
      }),
      table: current.table.name,
      table_root_hex: tableRoot.toString("hex"),
    });
    if (!referenceJcs(actual).equals(referenceJcs(tableEndValue(built)))) {
      throw new Error("reference_table_end_invalid");
    }
    tables.push(built);
    totalRows += built.row_count;
    if (!Number.isSafeInteger(totalRows)) throw new Error("reference_count_invalid");
    current = null;
    tableIndex += 1;
    phase = tableIndex === contract.source_tables.length ? "TRAILER" : "TABLE_START";
  }

  function finish(value) {
    trailer = exact(value, [
      "artifact_type_sha256", "content_root", "counts", "data_root", "frame",
      "occurrence_set_root", "schema", "status",
    ], "reference_trailer_invalid");
    if (trailer.frame !== "TRAILER" || trailer.schema !== SCHEMA || trailer.status !== STATUS) {
      throw new Error("reference_trailer_invalid");
    }
    phase = "EOF";
  }

  return {
    async accept(bytes) {
      const value = parseJcs(bytes);
      if (phase === "HEADER") {
        header = exact(value, [
          "artifact_type_sha256", "content_document", "content_root", "frame", "schema",
        ], "reference_s0_header_invalid");
        if (header.frame !== "HEADER" || header.schema !== SCHEMA ||
            header.artifact_type_sha256 !== streamArtifactType) {
          throw new Error("reference_s0_header_invalid");
        }
        phase = "TABLE_START";
      } else if (phase === "TABLE_START") await start(value);
      else if (phase === "ROWS" && value?.frame === "ROW") await row(value);
      else if (phase === "ROWS" && value?.frame === "TABLE_END") await end(value);
      else if (phase === "TRAILER") finish(value);
      else throw new Error("reference_frame_sequence_invalid");
    },
    complete() {
      if (phase !== "EOF" || tableIndex !== 76 || !header || !trailer) {
        throw new Error("reference_frame_sequence_invalid");
      }
      const roots = referenceComputeS0V2GlobalRoots({
        baseContractFileSha256: FILE_SHA,
        baseContractJcsSha256: JCS_SHA,
        hmacKey: keyring.hmacKey,
        tables,
      });
      const counts = { columns: 759, rows: totalRows, tables: 76, views_queried: 0 };
      const content = referenceBuildS0V2ContentDocument({
        addendumSha256: expectedAddendumSha256,
        baseContractFileSha256: FILE_SHA,
        baseContractJcsSha256: JCS_SHA,
        counts,
        hmacKey: keyring.hmacKey,
        hmacKeyId: keyring.hmacKeyId,
        input: expectedInput,
        roots,
        tables,
      });
      const binding = { content_root: content.content_root, schema: SCHEMA, status: STATUS };
      const artifactTypeSha256 = createHash("sha256").update(referenceJcs(binding)).digest("hex");
      const expectedTrailer = {
        artifact_type_sha256: artifactTypeSha256,
        content_root: content.content_root,
        counts,
        data_root: roots.data_root,
        frame: "TRAILER",
        occurrence_set_root: roots.occurrence_set_root,
        schema: SCHEMA,
        status: STATUS,
      };
      if (expectedAddendumSha256 !== content.document.addendum_sha256 ||
          !referenceJcs(header.content_document).equals(referenceJcs(content.document)) ||
          header.content_root !== content.content_root ||
          header.artifact_type_sha256 !== artifactTypeSha256 ||
          streamArtifactType !== artifactTypeSha256 ||
          !referenceJcs(trailer).equals(referenceJcs(expectedTrailer))) {
        throw new Error("reference_content_mismatch");
      }
      return Object.freeze({
        artifact_type_sha256: artifactTypeSha256,
        content_root: content.content_root,
        counts: Object.freeze(counts),
      });
    },
    async close() {
      if (current?.identitySorter) await closeReferenceEncryptedSorter(current.identitySorter);
      current = null;
    },
  };
}

export async function verifyS0V2Candidate(input) {
  let keyring;
  let state;
  let result;
  let operationError;
  try {
    const options = exact(input, [
      "contract", "expectedAddendumSha256", "expectedArtifactSha256", "expectedInput",
      "keyring", "path", "workDirectory",
    ], "reference_input_invalid");
    const contractInput = options.contract;
    const expectedAddendumSha256 = options.expectedAddendumSha256;
    const expectedArtifactSha256 = options.expectedArtifactSha256;
    const expectedInput = snapshotData(options.expectedInput);
    const keyringInput = options.keyring;
    const artifactPath = options.path;
    if (typeof artifactPath !== "string" || expectedAddendumSha256 !== ADDENDUM_SHA ||
        !DIGEST.test(expectedArtifactSha256) || typeof options.workDirectory !== "string" ||
        !path.isAbsolute(options.workDirectory)) {
      throw new TypeError("reference_input_invalid");
    }
    const contract = exactContract(contractInput);
    keyring = cloneKeys(keyringInput);
    const first = await decryptPass({
      artifactPath,
      keyring,
      onPlaintext: async () => {},
    });
    if (first.artifactSha256 !== expectedArtifactSha256) {
      throw new Error("reference_artifact_hash_mismatch");
    }
    state = verifierState(
      contract,
      expectedAddendumSha256,
      expectedInput,
      keyring,
      first.artifactTypeSha256,
      options.workDirectory,
    );
    const parser = frameParser((bytes) => state.accept(bytes));
    const second = await decryptPass({
      artifactPath,
      expectedIdentity: first.identity,
      keyring,
      onPlaintext: (bytes) => parser.push(bytes),
    });
    await parser.finish();
    if (second.artifactSha256 !== first.artifactSha256 ||
        second.artifactTypeSha256 !== first.artifactTypeSha256) {
      throw new Error("reference_artifact_drift");
    }
    result = state.complete();
  } catch {
    operationError = new Error("s0_v2_reference_verification_failed");
  } finally {
    try {
      await state?.close();
    } catch {
      if (!operationError) operationError = new Error("s0_v2_reference_verification_failed");
    }
    keyring?.kek.fill(0);
    keyring?.hmacKey.fill(0);
  }
  if (operationError) throw operationError;
  return result;
}
