import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdtemp, open, rm, unlink } from "node:fs/promises";
import path from "node:path";

const SCHEMA = "hotcrush.r6.s0.offline.v2";
const STATUS = "S0_ENCRYPTED_OFFLINE_VERIFIED_V2";
const TYPED_SCHEMA = "hotcrush.typed-jcs.v1";
const SOURCE_NAMESPACE = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";
const MAX_FRAME_BYTES = 128 * 1024 * 1024;
const HEX_32 = /^[0-9a-f]{64}$/;
const REFERENCE_SPILL_SCHEMA = "hotcrush.s0-v2.reference-encrypted-spill.v1";
const REFERENCE_SORTERS = new WeakMap();

function scalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) throw new TypeError("reference_jcs_invalid");
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("reference_jcs_invalid");
    }
  }
}

function serialize(value, seen = new Set()) {
  if (value === null) return "null";
  if (typeof value === "string") {
    scalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("reference_jcs_invalid");
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (!value || typeof value !== "object" || Buffer.isBuffer(value) || value instanceof Date ||
      seen.has(value)) {
    throw new TypeError("reference_jcs_invalid");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError("reference_jcs_invalid");
      }
      return `[${value.map((entry) => serialize(entry, seen)).join(",")}]`;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError("reference_jcs_invalid");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    for (const key of keys) {
      scalarString(key);
      if (["__proto__", "constructor", "prototype"].includes(key) ||
          !("value" in descriptors[key]) || descriptors[key].value === undefined ||
          typeof descriptors[key].value === "bigint") {
        throw new TypeError("reference_jcs_invalid");
      }
    }
    return `{${keys.map((key) =>
      `${JSON.stringify(key)}:${serialize(descriptors[key].value, seen)}`).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function jcs(value) {
  return Buffer.from(serialize(value), "utf8");
}

function parseJcs(bytesInput) {
  if (!Buffer.isBuffer(bytesInput) && !(bytesInput instanceof Uint8Array)) {
    throw new TypeError("reference_typed_row_invalid");
  }
  const bytes = Buffer.from(bytesInput);
  if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) {
    throw new TypeError("reference_typed_row_invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new TypeError("reference_typed_row_invalid");
  }
  if (!jcs(parsed).equals(bytes)) throw new TypeError("reference_typed_row_invalid");
  return { bytes, parsed };
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

function frame(bytesInput) {
  const bytes = Buffer.from(bytesInput);
  if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) {
    throw new TypeError("reference_frame_invalid");
  }
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length);
  return Buffer.concat([prefix, bytes]);
}

function hmac(key, domain, payload) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || typeof domain !== "string" || !domain) {
    throw new TypeError("reference_hmac_input_invalid");
  }
  return createHmac("sha256", key)
    .update(frame(Buffer.from(domain, "utf8")))
    .update(frame(Buffer.from(payload)))
    .digest();
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function uuidV5(nameDigest) {
  const namespace = Buffer.from(SOURCE_NAMESPACE.replaceAll("-", ""), "hex");
  const name = Buffer.from(`hmac-sha256:${nameDigest.toString("hex")}`, "ascii");
  const digest = createHash("sha1").update(namespace).update(name).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateTable(tableInput) {
  const table = exact(tableInput, [
    "default_outcome", "fields", "identity", "migration_class", "name",
    "observed_unique_constraints", "required_target_trust", "source_object_disposition",
  ], "reference_table_invalid");
  if (typeof table.name !== "string" || !Array.isArray(table.fields) ||
      !table.identity || typeof table.identity !== "object") {
    throw new TypeError("reference_table_invalid");
  }
  const identity = table.identity;
  if (!["PRIMARY_KEY", "UNIQUE_KEY", "FULL_ROW_MULTISET"].includes(identity.mode) ||
      !Array.isArray(identity.columns)) {
    throw new TypeError("reference_table_invalid");
  }
  const names = new Set();
  for (const field of table.fields) {
    if (!field || typeof field !== "object" || typeof field.name !== "string" ||
        typeof field.data_type !== "string" || typeof field.nullable !== "boolean" ||
        names.has(field.name)) {
      throw new TypeError("reference_table_invalid");
    }
    names.add(field.name);
  }
  if (identity.mode === "FULL_ROW_MULTISET" ? identity.columns.length !== 0 :
    identity.columns.length === 0 || identity.columns.some((name) => !names.has(name))) {
    throw new TypeError("reference_table_invalid");
  }
  return table;
}

function typed(table, input) {
  const { bytes, parsed } = parseJcs(input);
  const root = exact(parsed, ["schema", "table", "values"], "reference_typed_row_invalid");
  if (root.schema !== TYPED_SCHEMA || root.table !== table.name ||
      !Array.isArray(root.values) || root.values.length !== table.fields.length) {
    throw new TypeError("reference_typed_row_invalid");
  }
  for (const [index, field] of table.fields.entries()) {
    const value = exact(root.values[index], ["name", "pg_type", "raw"],
      "reference_typed_row_invalid");
    if (value.name !== field.name || value.pg_type !== field.data_type ||
        !(value.raw === null || typeof value.raw === "string") ||
        value.raw === null && !field.nullable) {
      throw new TypeError("reference_typed_row_invalid");
    }
  }
  return { bytes, parsed: root };
}

function identityPayload(table, row) {
  if (table.identity.mode === "FULL_ROW_MULTISET") return jcs(row);
  const values = new Map(row.values.map((value) => [value.name, value]));
  const selected = table.identity.columns.map((name) => {
    const value = values.get(name);
    if (!value || value.raw === null) throw new TypeError("reference_identity_invalid");
    return value;
  });
  return jcs({ schema: TYPED_SCHEMA, table: table.name, values: selected });
}

export function referenceAnalyzeS0V2TypedRow({ hmacKey, table: tableInput, typedRow }) {
  const table = validateTable(tableInput);
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length !== 32) {
    throw new TypeError("reference_row_analysis_invalid");
  }
  const row = typed(table, typedRow);
  const identityDigest = hmac(hmacKey, "source-identity:v1", identityPayload(table, row.parsed));
  const payloadDigest = hmac(hmacKey, "source-payload:v1", row.bytes);
  return Object.freeze({
    identity_hmac: b64(identityDigest),
    identity_hmac_hex: identityDigest.toString("hex"),
    payload_hmac: b64(payloadDigest),
    payload_hmac_hex: payloadDigest.toString("hex"),
  });
}

export function referenceExpectedS0V2Token({ analysis: analysisInput, hmacKey, occurrence, table: tableInput }) {
  const table = validateTable(tableInput);
  const analysis = exact(analysisInput, [
    "identity_hmac", "identity_hmac_hex", "payload_hmac", "payload_hmac_hex",
  ], "reference_token_input_invalid");
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length !== 32 ||
      !HEX_32.test(analysis.identity_hmac_hex) || !HEX_32.test(analysis.payload_hmac_hex)) {
    throw new TypeError("reference_token_input_invalid");
  }
  const identityDigest = Buffer.from(analysis.identity_hmac, "base64url");
  const payloadDigest = Buffer.from(analysis.payload_hmac, "base64url");
  if (identityDigest.length !== 32 || payloadDigest.length !== 32 ||
      b64(identityDigest) !== analysis.identity_hmac || b64(payloadDigest) !== analysis.payload_hmac ||
      identityDigest.toString("hex") !== analysis.identity_hmac_hex ||
      payloadDigest.toString("hex") !== analysis.payload_hmac_hex) {
    throw new TypeError("reference_token_input_invalid");
  }
  let occurrenceDigest;
  let rowId;
  if (table.identity.mode === "FULL_ROW_MULTISET") {
    if (!Number.isSafeInteger(occurrence) || occurrence < 0) {
      throw new TypeError("reference_token_input_invalid");
    }
    occurrenceDigest = hmac(hmacKey, "source-multiset-occurrence:v2", jcs({
      occurrence,
      payload_hmac: analysis.payload_hmac,
      table: table.name,
    }));
    rowId = uuidV5(occurrenceDigest);
  } else {
    if (occurrence !== undefined) throw new TypeError("reference_token_input_invalid");
    occurrenceDigest = hmac(hmacKey, "source-keyed-occurrence:v2", jcs({
      identity_hmac: analysis.identity_hmac,
      payload_hmac: analysis.payload_hmac,
      table: table.name,
    }));
    rowId = uuidV5(identityDigest);
  }
  const occurrenceId = uuidV5(occurrenceDigest);
  return Object.freeze({
    identity_hmac: analysis.identity_hmac,
    occurrence_id: occurrenceId,
    payload_hmac: analysis.payload_hmac,
    row_id: rowId,
    table: table.name,
  });
}

function makeRecord({ identityDigest, occurrenceDigest, payloadDigest, rowId, table, typedBytes }) {
  const occurrenceId = uuidV5(occurrenceDigest);
  const token = {
    identity_hmac: b64(identityDigest),
    occurrence_id: occurrenceId,
    payload_hmac: b64(payloadDigest),
    row_id: rowId ?? occurrenceId,
    table: table.name,
  };
  return Object.freeze({
    identity_hmac_hex: identityDigest.toString("hex"),
    occurrence_hmac_hex: occurrenceDigest.toString("hex"),
    occurrence_id: occurrenceId,
    payload_hmac_hex: payloadDigest.toString("hex"),
    row_id: token.row_id,
    token: Object.freeze(token),
    token_bytes: jcs(token),
    typed_row_bytes: Buffer.from(typedBytes),
  });
}

function evidence(domain, framedValues, key, table, rowCount) {
  const digest = createHash("sha256");
  let bytes = 0;
  for (const framed of framedValues) {
    digest.update(framed);
    bytes += framed.length;
    if (!Number.isSafeInteger(bytes)) throw new TypeError("reference_stream_invalid");
  }
  const sha256 = digest.digest("hex");
  const root = hmac(key, domain, jcs({ bytes, row_count: rowCount, sha256, table }));
  return { bytes, root, root_hex: root.toString("hex"), sha256 };
}

export function referenceBuildS0V2Table({ hmacKey, table: tableInput, typedRows }) {
  const table = validateTable(tableInput);
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length !== 32 || !Array.isArray(typedRows)) {
    throw new TypeError("reference_table_input_invalid");
  }
  const rows = [];
  for (let index = 0; index < typedRows.length; index += 1) {
    if (!Object.hasOwn(typedRows, index)) throw new TypeError("reference_table_input_invalid");
    const row = typed(table, typedRows[index]);
    rows.push({
      identityDigest: hmac(hmacKey, "source-identity:v1", identityPayload(table, row.parsed)),
      payloadDigest: hmac(hmacKey, "source-payload:v1", row.bytes),
      typedBytes: row.bytes,
    });
  }

  const records = [];
  if (table.identity.mode === "FULL_ROW_MULTISET") {
    const groups = new Map();
    for (const row of rows) {
      const key = row.payloadDigest.toString("hex");
      const group = groups.get(key);
      if (group) group.count += 1;
      else groups.set(key, { ...row, count: 1 });
    }
    for (const group of groups.values()) {
      for (let occurrence = 0; occurrence < group.count; occurrence += 1) {
        const occurrenceDigest = hmac(hmacKey, "source-multiset-occurrence:v2", jcs({
          occurrence,
          payload_hmac: b64(group.payloadDigest),
          table: table.name,
        }));
        records.push(makeRecord({ ...group, occurrenceDigest, table }));
      }
    }
  } else {
    const identities = new Set();
    for (const row of rows) {
      const identityHex = row.identityDigest.toString("hex");
      if (identities.has(identityHex)) throw new Error("reference_duplicate_identity");
      identities.add(identityHex);
      const occurrenceDigest = hmac(hmacKey, "source-keyed-occurrence:v2", jcs({
        identity_hmac: b64(row.identityDigest),
        payload_hmac: b64(row.payloadDigest),
        table: table.name,
      }));
      records.push(makeRecord({
        ...row,
        occurrenceDigest,
        rowId: uuidV5(row.identityDigest),
        table,
      }));
    }
  }
  records.sort((left, right) => left.occurrence_id < right.occurrence_id ? -1 :
    left.occurrence_id > right.occurrence_id ? 1 : 0);
  const data = evidence("s0-table-data-stream:v2",
    records.map((record) => frame(record.typed_row_bytes)), hmacKey, table.name, records.length);
  const occurrences = evidence("s0-table-occurrences:v2",
    records.map((record) => frame(record.token_bytes)), hmacKey, table.name, records.length);
  const tableRoot = hmac(hmacKey, "s0-table-root:v2", jcs({
    identity_mode: table.identity.mode,
    row_count: records.length,
    table: table.name,
    table_data_stream_root: b64(data.root),
    table_occurrences_root: b64(occurrences.root),
  }));
  return Object.freeze({
    data_frames: Object.freeze(records.map((record) => frame(record.typed_row_bytes))),
    identity_mode: table.identity.mode,
    occurrence_frames: Object.freeze(records.map((record) => frame(record.token_bytes))),
    records: Object.freeze(records),
    row_count: records.length,
    streams: Object.freeze({
      data: Object.freeze({ bytes: data.bytes, root_hex: data.root_hex, sha256: data.sha256 }),
      occurrences: Object.freeze({
        bytes: occurrences.bytes,
        root_hex: occurrences.root_hex,
        sha256: occurrences.sha256,
      }),
    }),
    table: table.name,
    table_root_hex: tableRoot.toString("hex"),
  });
}

function digest(value) {
  if (typeof value !== "string" || !HEX_32.test(value)) {
    throw new TypeError("reference_digest_invalid");
  }
}

function orderedTables(tables) {
  if (!Array.isArray(tables)) throw new TypeError("reference_tables_invalid");
  const ordered = [...tables].sort((left, right) => left.table < right.table ? -1 :
    left.table > right.table ? 1 : 0);
  for (let index = 0; index < ordered.length; index += 1) {
    const table = ordered[index];
    if (!table || typeof table.table !== "string" || !Number.isSafeInteger(table.row_count) ||
        table.row_count < 0 || !table.streams ||
        index > 0 && ordered[index - 1].table === table.table) {
      throw new TypeError("reference_tables_invalid");
    }
    digest(table.streams.data.root_hex);
    digest(table.streams.occurrences.root_hex);
    digest(table.table_root_hex);
  }
  return ordered;
}

export function referenceComputeS0V2GlobalRoots({
  baseContractFileSha256,
  baseContractJcsSha256,
  hmacKey,
  tables,
}) {
  digest(baseContractFileSha256);
  digest(baseContractJcsSha256);
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length !== 32) {
    throw new TypeError("reference_global_input_invalid");
  }
  const ordered = orderedTables(tables);
  const dataDocument = {
    base_contract_file_sha256: baseContractFileSha256,
    base_contract_jcs_sha256: baseContractJcsSha256,
    schema: SCHEMA,
    tables: ordered.map((table) => ({
      row_count: table.row_count,
      table: table.table,
      table_data_stream_root: b64(Buffer.from(table.streams.data.root_hex, "hex")),
    })),
  };
  const occurrenceDocument = {
    base_contract_file_sha256: baseContractFileSha256,
    base_contract_jcs_sha256: baseContractJcsSha256,
    schema: SCHEMA,
    tables: ordered.map((table) => ({
      row_count: table.row_count,
      table: table.table,
      table_occurrences_root: b64(Buffer.from(table.streams.occurrences.root_hex, "hex")),
    })),
  };
  const dataRoot = hmac(hmacKey, "s0-data-root:v2", jcs(dataDocument));
  const occurrenceRoot = hmac(hmacKey, "s0-occurrence-set-root:v2", jcs(occurrenceDocument));
  return Object.freeze({
    data_document: Object.freeze(dataDocument),
    data_root: b64(dataRoot),
    data_root_hex: dataRoot.toString("hex"),
    occurrence_document: Object.freeze(occurrenceDocument),
    occurrence_set_root: b64(occurrenceRoot),
    occurrence_set_root_hex: occurrenceRoot.toString("hex"),
  });
}

export function referenceBuildS0V2ContentDocument({
  addendumSha256,
  baseContractFileSha256,
  baseContractJcsSha256,
  counts,
  hmacKey,
  hmacKeyId,
  input,
  roots,
  tables,
}) {
  for (const value of [addendumSha256, baseContractFileSha256, baseContractJcsSha256]) digest(value);
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length !== 32 ||
      typeof hmacKeyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(hmacKeyId)) {
    throw new TypeError("reference_content_input_invalid");
  }
  const countValues = exact(counts, ["columns", "rows", "tables", "views_queried"],
    "reference_content_input_invalid");
  const inputValues = exact(input, [
    "capture_sha256", "manifest_artifact_sha256", "manifest_content_sha256",
    "snapshot_sha256", "status",
  ], "reference_content_input_invalid");
  if (![countValues.columns, countValues.rows, countValues.tables, countValues.views_queried]
    .every((value) => Number.isSafeInteger(value) && value >= 0) ||
      countValues.tables !== tables.length || inputValues.status !== "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY") {
    throw new TypeError("reference_content_input_invalid");
  }
  for (const value of [inputValues.capture_sha256, inputValues.manifest_artifact_sha256,
    inputValues.manifest_content_sha256, inputValues.snapshot_sha256]) digest(value);
  digest(roots.data_root_hex);
  digest(roots.occurrence_set_root_hex);
  const ordered = orderedTables(tables);
  const document = {
    addendum_sha256: addendumSha256,
    base_contract_bytes: 663164,
    base_contract_file_sha256: baseContractFileSha256,
    base_contract_jcs_sha256: baseContractJcsSha256,
    catchup_allowed: false,
    counts: { ...countValues },
    data_root: roots.data_root,
    hmac_key_id: hmacKeyId,
    input: { ...inputValues },
    occurrence_set_root: roots.occurrence_set_root,
    release_status: "PHYSICAL_BACKFILL_NOT_STARTED",
    routing_allowed: false,
    schema: SCHEMA,
    status: STATUS,
    table_roots: ordered.map((table) => ({
      row_count: table.row_count,
      table: table.table,
      table_root: b64(Buffer.from(table.table_root_hex, "hex")),
    })),
    target_load_allowed: false,
  };
  const root = hmac(hmacKey, "s0-content-root:v2", jcs(document));
  return Object.freeze({
    content_root: b64(root),
    content_root_hex: root.toString("hex"),
    document: Object.freeze(document),
  });
}

function referenceSortPolicy(input) {
  const value = exact(input, [
    "maxMemoryBytes", "maxMergePasses", "maxOpenRuns", "maxRecordBytes", "maxRunBytes",
  ], "reference_sort_policy_invalid");
  if (!Object.values(value).every((item) => Number.isSafeInteger(item) && item > 0) ||
      value.maxOpenRuns < 2 || value.maxMergePasses < 1 ||
      value.maxRecordBytes > 64 * 1024 ||
      value.maxRunBytes > Math.floor(value.maxMemoryBytes / 2) ||
      BigInt(value.maxOpenRuns + 2) * BigInt(value.maxRecordBytes) * 3n >
        BigInt(value.maxMemoryBytes)) {
    throw new TypeError("reference_sort_policy_invalid");
  }
  return Object.freeze(value);
}

function referenceSortRecord(input, maxRecordBytes) {
  const value = exact(input, ["key", "value"], "reference_sort_record_invalid");
  if (typeof value.key !== "string" || typeof value.value !== "string" ||
      value.key.length === 0 || value.key.length > 256 || value.value.length > 256 ||
      !/^[0-9a-f:-]+$/.test(value.key) || !/^[0-9a-f-]*$/.test(value.value)) {
    throw new TypeError("reference_sort_record_invalid");
  }
  const bytes = jcs(value);
  if (bytes.length > maxRecordBytes) throw new Error("reference_sort_record_too_large");
  return Object.freeze({ bytes, key: value.key, value: value.value });
}

function compareReferenceRecords(left, right) {
  if (left.key !== right.key) return left.key < right.key ? -1 : 1;
  if (left.value !== right.value) return left.value < right.value ? -1 : 1;
  return 0;
}

async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes.subarray(offset));
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      throw new Error("reference_sort_write_failed");
    }
    offset += bytesWritten;
  }
}

async function readExactAt(handle, length, position, allowEof = false) {
  const output = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(output, offset, length - offset, position + offset);
    if (bytesRead === 0) {
      if (allowEof && offset === 0) return null;
      throw new Error("reference_sort_run_truncated");
    }
    offset += bytesRead;
  }
  return output;
}

function referenceRunIdentity(info) {
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

function sameReferenceRunIdentity(left, right) {
  return ["ctimeNs", "dev", "ino", "mode", "mtimeNs", "nlink", "size", "uid"]
    .every((key) => left[key] === right[key]);
}

function assertReferenceRun(info) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.size <= 0n ||
      (info.mode & 0o777n) !== 0o600n ||
      (typeof process.getuid === "function" && info.uid !== BigInt(process.getuid()))) {
    throw new Error("reference_sort_run_unsafe");
  }
}

async function* readReferenceRun(run, state) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(run.path, flags);
  let position = 0;
  let ordinal = 0;
  let previous = null;
  let operationError;
  try {
    const info = await handle.stat({ bigint: true });
    assertReferenceRun(info);
    if (!sameReferenceRunIdentity(referenceRunIdentity(info), run.identity)) {
      throw new Error("reference_sort_run_drift");
    }
    while (position < Number(info.size)) {
      const encodedLength = await readExactAt(handle, 4, position, true);
      if (encodedLength === null) break;
      position += 4;
      const length = encodedLength.readUInt32BE(0);
      if (length <= 28 || length > state.policy.maxRecordBytes + 28) {
        throw new Error("reference_sort_run_invalid");
      }
      const body = await readExactAt(handle, length, position);
      position += length;
      const iv = body.subarray(0, 12);
      const ciphertext = body.subarray(12, body.length - 16);
      const tag = body.subarray(body.length - 16);
      const aad = jcs({
        ordinal,
        run_id: run.id,
        schema: REFERENCE_SPILL_SCHEMA,
      });
      const decipher = createDecipheriv("aes-256-gcm", state.key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      let parsed;
      try {
        parsed = JSON.parse(plaintext.toString("utf8"));
      } catch {
        throw new Error("reference_sort_run_invalid");
      }
      if (!jcs(parsed).equals(plaintext)) throw new Error("reference_sort_run_invalid");
      const record = referenceSortRecord(parsed, state.policy.maxRecordBytes);
      if (previous && compareReferenceRecords(previous, record) > 0) {
        throw new Error("reference_sort_run_invalid");
      }
      previous = record;
      ordinal += 1;
      yield record;
    }
    if (position !== Number(info.size) || ordinal !== run.records) {
      throw new Error("reference_sort_run_invalid");
    }
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (!operationError) throw error;
    }
  }
}

async function* mergeReferenceRuns(runs, state) {
  const iterators = runs.map((run) => readReferenceRun(run, state)[Symbol.asyncIterator]());
  try {
    const current = await Promise.all(iterators.map((iterator) => iterator.next()));
    while (true) {
      let selected = -1;
      for (let index = 0; index < current.length; index += 1) {
        if (current[index].done) continue;
        if (selected === -1 ||
            compareReferenceRecords(current[index].value, current[selected].value) < 0) {
          selected = index;
        }
      }
      if (selected === -1) return;
      yield current[selected].value;
      current[selected] = await iterators[selected].next();
    }
  } finally {
    await Promise.allSettled(iterators.map((iterator) => iterator.return?.()));
  }
}

async function writeReferenceRun(state, records) {
  state.runOrdinal += 1;
  const id = randomBytes(16).toString("hex");
  const runPath = path.join(
    state.directory,
    `run-${String(state.runOrdinal).padStart(8, "0")}.enc`,
  );
  const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY |
    (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(runPath, flags, 0o600);
  let ordinal = 0;
  let operationError;
  try {
    for await (const record of records) {
      const plaintext = record.bytes ?? jcs({ key: record.key, value: record.value });
      if (plaintext.length > state.policy.maxRecordBytes) {
        throw new Error("reference_sort_record_too_large");
      }
      const iv = randomBytes(12);
      const aad = jcs({ ordinal, run_id: id, schema: REFERENCE_SPILL_SCHEMA });
      const cipher = createCipheriv("aes-256-gcm", state.key, iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      const length = Buffer.alloc(4);
      length.writeUInt32BE(iv.length + ciphertext.length + tag.length);
      await writeAll(handle, length);
      await writeAll(handle, iv);
      await writeAll(handle, ciphertext);
      await writeAll(handle, tag);
      ordinal += 1;
    }
    await handle.sync();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (!operationError) throw error;
    }
  }
  const info = await lstat(runPath, { bigint: true });
  assertReferenceRun(info);
  return Object.freeze({
    id,
    identity: referenceRunIdentity(info),
    path: runPath,
    records: ordinal,
  });
}

export async function createReferenceEncryptedSorter(input) {
  const value = exact(input, ["policy", "workDirectory"], "reference_sort_input_invalid");
  const policy = referenceSortPolicy(value.policy);
  if (typeof value.workDirectory !== "string" || !path.isAbsolute(value.workDirectory)) {
    throw new TypeError("reference_sort_input_invalid");
  }
  const parent = await lstat(value.workDirectory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && parent.uid !== process.getuid())) {
    throw new Error("reference_sort_directory_unsafe");
  }
  const directory = await mkdtemp(path.join(value.workDirectory, ".s0-v2-reference-sort-"));
  await chmod(directory, 0o700);
  const capability = Object.freeze({});
  REFERENCE_SORTERS.set(capability, {
    active: false,
    closed: false,
    directory,
    finalRun: null,
    key: randomBytes(32),
    pending: [],
    pendingBytes: 0,
    policy,
    runOrdinal: 0,
    runs: [],
    sealed: false,
  });
  return capability;
}

async function flushReferenceSorter(state) {
  if (state.pending.length === 0) return;
  state.pending.sort(compareReferenceRecords);
  const records = state.pending;
  state.pending = [];
  state.pendingBytes = 0;
  state.runs.push(await writeReferenceRun(state, (async function* values() {
    for (const record of records) yield record;
  }())));
}

export async function pushReferenceEncryptedSorter(capability, input) {
  const state = REFERENCE_SORTERS.get(capability);
  if (!state || state.closed || state.sealed || state.active) {
    throw new Error("reference_sort_state_invalid");
  }
  const record = referenceSortRecord(input, state.policy.maxRecordBytes);
  const resident = record.bytes.length + Buffer.byteLength(record.key, "utf8") * 2 +
    Buffer.byteLength(record.value, "utf8") * 2 + 256;
  if (resident > state.policy.maxRunBytes) throw new Error("reference_sort_record_too_large");
  if (state.pending.length > 0 && state.pendingBytes + resident > state.policy.maxRunBytes) {
    await flushReferenceSorter(state);
  }
  state.pending.push(record);
  state.pendingBytes += resident;
  if (state.pendingBytes + state.policy.maxRecordBytes * 2 > state.policy.maxMemoryBytes) {
    throw new Error("reference_sort_memory_limit");
  }
}

export async function sealReferenceEncryptedSorter(capability) {
  const state = REFERENCE_SORTERS.get(capability);
  if (!state || state.closed || state.sealed || state.active) {
    throw new Error("reference_sort_state_invalid");
  }
  await flushReferenceSorter(state);
  let runs = state.runs;
  let pass = 0;
  while (runs.length > 1) {
    pass += 1;
    if (pass > state.policy.maxMergePasses) throw new Error("reference_sort_merge_limit");
    const next = [];
    for (let offset = 0; offset < runs.length; offset += state.policy.maxOpenRuns) {
      const group = runs.slice(offset, offset + state.policy.maxOpenRuns);
      next.push(await writeReferenceRun(state, mergeReferenceRuns(group, state)));
      for (const run of group) await unlink(run.path);
    }
    runs = next;
  }
  state.runs = runs;
  state.finalRun = runs[0] ?? null;
  state.sealed = true;
}

export async function* iterateReferenceEncryptedSorter(capability) {
  const state = REFERENCE_SORTERS.get(capability);
  if (!state || state.closed || !state.sealed || state.active) {
    throw new Error("reference_sort_state_invalid");
  }
  state.active = true;
  try {
    if (state.finalRun) yield* readReferenceRun(state.finalRun, state);
  } finally {
    state.active = false;
  }
}

export async function closeReferenceEncryptedSorter(capability) {
  const state = REFERENCE_SORTERS.get(capability);
  if (!state || state.active) throw new Error("reference_sort_state_invalid");
  if (state.closed) return;
  state.key.fill(0);
  await rm(state.directory, { force: true, recursive: true });
  state.closed = true;
}

export {
  frame as referenceFrame,
  hmac as referenceDomainHmac,
  jcs as referenceJcs,
};
