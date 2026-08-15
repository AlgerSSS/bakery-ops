import { createHash } from "node:crypto";

import {
  TYPED_SCHEMA,
  canonicalizeJcs,
  canonicalizeTypedRow,
  parseCanonicalJcs,
} from "./canonical.mjs";
import {
  SOURCE_ROW_NAMESPACE,
  domainHmac,
  uuidV5FromIdentityHmac,
} from "./identity.mjs";

export const S0_V2_SCHEMA = "hotcrush.r6.s0.offline.v2";
export const S0_V2_STATUS = "S0_ENCRYPTED_OFFLINE_VERIFIED_V2";
const MAX_FRAME_BYTES = 128 * 1024 * 1024;
const DIGEST = /^[0-9a-f]{64}$/;
const SOURCE_ROWS = new WeakMap();

function b64(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function frame(bytesInput) {
  const bytes = Buffer.from(bytesInput);
  if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) {
    throw new Error("s0_v2_frame_size_invalid");
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(code);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(code);
  }
}

function validateTable(table) {
  if (!table || typeof table !== "object" || typeof table.name !== "string" ||
      !Array.isArray(table.fields) || !table.identity ||
      !["PRIMARY_KEY", "UNIQUE_KEY", "FULL_ROW_MULTISET"].includes(table.identity.mode) ||
      !Array.isArray(table.identity.columns)) {
    throw new TypeError("s0_v2_table_contract_invalid");
  }
  const names = new Set();
  for (const field of table.fields) {
    if (!field || typeof field !== "object" || typeof field.name !== "string" ||
        typeof field.data_type !== "string" || typeof field.nullable !== "boolean" ||
        names.has(field.name)) {
      throw new TypeError("s0_v2_table_contract_invalid");
    }
    names.add(field.name);
  }
  if (table.identity.mode === "FULL_ROW_MULTISET") {
    if (table.identity.columns.length !== 0) throw new TypeError("s0_v2_table_contract_invalid");
  } else if (table.identity.columns.length === 0 ||
      table.identity.columns.some((name) => !names.has(name))) {
    throw new TypeError("s0_v2_table_contract_invalid");
  }
}

function parseTypedRow(table, bytesInput) {
  if (!(Buffer.isBuffer(bytesInput) || bytesInput instanceof Uint8Array)) {
    throw new TypeError("s0_v2_typed_row_invalid");
  }
  const bytes = Buffer.from(bytesInput);
  let parsed;
  try {
    parsed = parseCanonicalJcs(bytes, { maxBytes: MAX_FRAME_BYTES });
    exactKeys(parsed, ["schema", "table", "values"], "s0_v2_typed_row_invalid");
  } catch {
    throw new TypeError("s0_v2_typed_row_invalid");
  }
  if (parsed.schema !== TYPED_SCHEMA || parsed.table !== table.name ||
      !Array.isArray(parsed.values) || parsed.values.length !== table.fields.length) {
    throw new TypeError("s0_v2_typed_row_invalid");
  }
  for (const [index, field] of table.fields.entries()) {
    const value = parsed.values[index];
    try {
      exactKeys(value, ["name", "pg_type", "raw"], "s0_v2_typed_row_invalid");
    } catch {
      throw new TypeError("s0_v2_typed_row_invalid");
    }
    if (value.name !== field.name || value.pg_type !== field.data_type ||
        !(value.raw === null || typeof value.raw === "string")) {
      throw new TypeError("s0_v2_typed_row_invalid");
    }
    if (value.raw === null && !field.nullable) {
      throw new TypeError("s0_v2_source_not_null_violation");
    }
  }
  return { bytes, parsed };
}

function identityBytes(table, parsed) {
  if (table.identity.mode === "FULL_ROW_MULTISET") return canonicalizeJcs(parsed);
  const byName = new Map(parsed.values.map((value) => [value.name, value]));
  const identityFields = table.identity.columns.map((name) => {
    const field = byName.get(name);
    if (!field) throw new TypeError("s0_v2_identity_column_missing");
    if (field.raw === null) throw new TypeError("s0_v2_source_identity_null");
    return field;
  });
  return canonicalizeTypedRow(table.name, identityFields);
}

function uuidFromHmac(digest) {
  return uuidV5FromIdentityHmac(digest, SOURCE_ROW_NAMESPACE);
}

function occurrenceRecord({ identityHmac, occurrenceHmac, payloadHmac, rowId, table, typedRow }) {
  const occurrenceId = uuidFromHmac(occurrenceHmac);
  const token = Object.freeze({
    identity_hmac: b64(identityHmac),
    occurrence_id: occurrenceId,
    payload_hmac: b64(payloadHmac),
    row_id: rowId ?? occurrenceId,
    table: table.name,
  });
  return Object.freeze({
    identity_hmac_hex: identityHmac.toString("hex"),
    occurrence_hmac_hex: occurrenceHmac.toString("hex"),
    occurrence_id: occurrenceId,
    payload_hmac_hex: payloadHmac.toString("hex"),
    row_id: token.row_id,
    token,
    token_bytes: canonicalizeJcs(token),
    typed_row_bytes: typedRow,
  });
}

export function deriveS0V2SourceRow({ hmacKey, table, typedRow }) {
  validateTable(table);
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length !== 32) {
    throw new TypeError("s0_v2_source_row_input_invalid");
  }
  const validated = parseTypedRow(table, typedRow);
  const capability = Object.freeze({});
  SOURCE_ROWS.set(capability, Object.freeze({
    identityHmac: domainHmac(hmacKey, "source-identity:v1", identityBytes(table, validated.parsed)),
    payloadHmac: domainHmac(hmacKey, "source-payload:v1", validated.bytes),
    table: table.name,
    typedRow: validated.bytes,
  }));
  return capability;
}

export function materializeS0V2Occurrence({ hmacKey, occurrence, sourceRow, table }) {
  validateTable(table);
  const source = SOURCE_ROWS.get(sourceRow);
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length !== 32 || !source || source.table !== table.name) {
    throw new TypeError("s0_v2_occurrence_input_invalid");
  }
  if (table.identity.mode === "FULL_ROW_MULTISET") {
    if (!Number.isSafeInteger(occurrence) || occurrence < 0) {
      throw new TypeError("s0_v2_occurrence_input_invalid");
    }
    const occurrenceHmac = domainHmac(
      hmacKey,
      "source-multiset-occurrence:v2",
      canonicalizeJcs({
        occurrence,
        payload_hmac: b64(source.payloadHmac),
        table: table.name,
      }),
    );
    return occurrenceRecord({ ...source, occurrenceHmac, table });
  }
  if (occurrence !== undefined) throw new TypeError("s0_v2_occurrence_input_invalid");
  const rowId = uuidFromHmac(source.identityHmac);
  const occurrenceHmac = domainHmac(
    hmacKey,
    "source-keyed-occurrence:v2",
    canonicalizeJcs({
      identity_hmac: b64(source.identityHmac),
      payload_hmac: b64(source.payloadHmac),
      table: table.name,
    }),
  );
  return occurrenceRecord({ ...source, occurrenceHmac, rowId, table });
}

export function inspectS0V2SourceRow(sourceRow) {
  const source = SOURCE_ROWS.get(sourceRow);
  if (!source) throw new TypeError("s0_v2_source_row_capability_invalid");
  return Object.freeze({
    identity_hmac_hex: source.identityHmac.toString("hex"),
    payload_hmac_hex: source.payloadHmac.toString("hex"),
    table: source.table,
    typed_row_bytes: Buffer.from(source.typedRow),
  });
}

function streamEvidence({ domain, frames, hmacKey, rowCount, table }) {
  const hash = createHash("sha256");
  let bytes = 0;
  for (const value of frames) {
    hash.update(value);
    bytes += value.length;
    if (!Number.isSafeInteger(bytes)) throw new Error("s0_v2_stream_size_overflow");
  }
  const sha256 = hash.digest("hex");
  const root = domainHmac(hmacKey, domain, canonicalizeJcs({
    bytes,
    row_count: rowCount,
    sha256,
    table: table.name,
  }));
  return { bytes, root, sha256 };
}

export function buildS0V2Table({ hmacKey, table, typedRows }) {
  validateTable(table);
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length !== 32 || !Array.isArray(typedRows)) {
    throw new TypeError("s0_v2_table_input_invalid");
  }
  for (let index = 0; index < typedRows.length; index += 1) {
    if (!Object.hasOwn(typedRows, index)) throw new TypeError("s0_v2_table_input_invalid");
  }
  const base = typedRows.map((typedRow) => {
    const sourceRow = deriveS0V2SourceRow({ hmacKey, table, typedRow });
    return { sourceRow, state: SOURCE_ROWS.get(sourceRow) };
  });

  const records = [];
  if (table.identity.mode === "FULL_ROW_MULTISET") {
    const groups = new Map();
    for (const entry of base) {
      const key = entry.state.payloadHmac.toString("hex");
      if (!groups.has(key)) groups.set(key, { ...entry, count: 0 });
      groups.get(key).count += 1;
    }
    for (const group of groups.values()) {
      for (let occurrence = 0; occurrence < group.count; occurrence += 1) {
        records.push(materializeS0V2Occurrence({ hmacKey, occurrence, sourceRow: group.sourceRow, table }));
      }
    }
  } else {
    const identities = new Set();
    for (const entry of base) {
      const identityKey = entry.state.identityHmac.toString("hex");
      if (identities.has(identityKey)) throw new Error("s0_v2_duplicate_source_identity");
      identities.add(identityKey);
      records.push(materializeS0V2Occurrence({ hmacKey, sourceRow: entry.sourceRow, table }));
    }
  }
  records.sort((left, right) => left.occurrence_id < right.occurrence_id ? -1 :
    left.occurrence_id > right.occurrence_id ? 1 : 0);

  const dataFrames = records.map((record) => frame(record.typed_row_bytes));
  const occurrenceFrames = records.map((record) => frame(record.token_bytes));
  const data = streamEvidence({
    domain: "s0-table-data-stream:v2",
    frames: dataFrames,
    hmacKey,
    rowCount: records.length,
    table,
  });
  const occurrences = streamEvidence({
    domain: "s0-table-occurrences:v2",
    frames: occurrenceFrames,
    hmacKey,
    rowCount: records.length,
    table,
  });
  const tableRoot = domainHmac(hmacKey, "s0-table-root:v2", canonicalizeJcs({
    identity_mode: table.identity.mode,
    row_count: records.length,
    table: table.name,
    table_data_stream_root: b64(data.root),
    table_occurrences_root: b64(occurrences.root),
  }));
  return Object.freeze({
    data_frames: Object.freeze(dataFrames),
    identity_mode: table.identity.mode,
    occurrence_frames: Object.freeze(occurrenceFrames),
    records: Object.freeze(records),
    row_count: records.length,
    streams: Object.freeze({
      data: Object.freeze({ bytes: data.bytes, root_hex: data.root.toString("hex"), sha256: data.sha256 }),
      occurrences: Object.freeze({
        bytes: occurrences.bytes,
        root_hex: occurrences.root.toString("hex"),
        sha256: occurrences.sha256,
      }),
    }),
    table: table.name,
    table_root_hex: tableRoot.toString("hex"),
  });
}

function assertDigest(value, code) {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(code);
}

function sortedUniqueTables(tables) {
  if (!Array.isArray(tables)) throw new TypeError("s0_v2_tables_invalid");
  const sorted = [...tables].sort((left, right) => left.table < right.table ? -1 :
    left.table > right.table ? 1 : 0);
  for (const [index, table] of sorted.entries()) {
    if (!table || typeof table.table !== "string" || !Number.isSafeInteger(table.row_count) ||
        table.row_count < 0 || !table.streams ||
        index > 0 && sorted[index - 1].table === table.table) {
      throw new TypeError("s0_v2_tables_invalid");
    }
    assertDigest(table.streams.data.root_hex, "s0_v2_tables_invalid");
    assertDigest(table.streams.occurrences.root_hex, "s0_v2_tables_invalid");
    assertDigest(table.table_root_hex, "s0_v2_tables_invalid");
  }
  return sorted;
}

export function computeS0V2GlobalRoots({
  baseContractFileSha256,
  baseContractJcsSha256,
  hmacKey,
  tables,
}) {
  assertDigest(baseContractFileSha256, "s0_v2_global_input_invalid");
  assertDigest(baseContractJcsSha256, "s0_v2_global_input_invalid");
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length !== 32) {
    throw new TypeError("s0_v2_global_input_invalid");
  }
  const ordered = sortedUniqueTables(tables);
  const dataDocument = {
    base_contract_file_sha256: baseContractFileSha256,
    base_contract_jcs_sha256: baseContractJcsSha256,
    schema: S0_V2_SCHEMA,
    tables: ordered.map((table) => ({
      row_count: table.row_count,
      table: table.table,
      table_data_stream_root: b64(Buffer.from(table.streams.data.root_hex, "hex")),
    })),
  };
  const occurrenceDocument = {
    base_contract_file_sha256: baseContractFileSha256,
    base_contract_jcs_sha256: baseContractJcsSha256,
    schema: S0_V2_SCHEMA,
    tables: ordered.map((table) => ({
      row_count: table.row_count,
      table: table.table,
      table_occurrences_root: b64(Buffer.from(table.streams.occurrences.root_hex, "hex")),
    })),
  };
  const dataRoot = domainHmac(hmacKey, "s0-data-root:v2", canonicalizeJcs(dataDocument));
  const occurrenceRoot = domainHmac(
    hmacKey,
    "s0-occurrence-set-root:v2",
    canonicalizeJcs(occurrenceDocument),
  );
  return Object.freeze({
    data_document: Object.freeze(dataDocument),
    data_root: b64(dataRoot),
    data_root_hex: dataRoot.toString("hex"),
    occurrence_document: Object.freeze(occurrenceDocument),
    occurrence_set_root: b64(occurrenceRoot),
    occurrence_set_root_hex: occurrenceRoot.toString("hex"),
  });
}

export function buildS0V2ContentDocument({
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
  for (const value of [addendumSha256, baseContractFileSha256, baseContractJcsSha256]) {
    assertDigest(value, "s0_v2_content_input_invalid");
  }
  if (!Buffer.isBuffer(hmacKey) || hmacKey.length !== 32 ||
      typeof hmacKeyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(hmacKeyId)) {
    throw new TypeError("s0_v2_content_input_invalid");
  }
  exactKeys(counts, ["columns", "rows", "tables", "views_queried"], "s0_v2_content_input_invalid");
  exactKeys(input, [
    "capture_sha256",
    "manifest_artifact_sha256",
    "manifest_content_sha256",
    "snapshot_sha256",
    "status",
  ], "s0_v2_content_input_invalid");
  for (const value of [
    input.capture_sha256,
    input.manifest_artifact_sha256,
    input.manifest_content_sha256,
    input.snapshot_sha256,
  ]) assertDigest(value, "s0_v2_content_input_invalid");
  if (input.status !== "RAW_ENCRYPTED_SOURCE_CAPTURE_ONLY" ||
      ![counts.columns, counts.rows, counts.tables, counts.views_queried]
        .every((value) => Number.isSafeInteger(value) && value >= 0) ||
      counts.tables !== tables.length) {
    throw new TypeError("s0_v2_content_input_invalid");
  }
  assertDigest(roots.data_root_hex, "s0_v2_content_input_invalid");
  assertDigest(roots.occurrence_set_root_hex, "s0_v2_content_input_invalid");
  const ordered = sortedUniqueTables(tables);
  const document = {
    addendum_sha256: addendumSha256,
    base_contract_bytes: 663_164,
    base_contract_file_sha256: baseContractFileSha256,
    base_contract_jcs_sha256: baseContractJcsSha256,
    catchup_allowed: false,
    counts: { ...counts },
    data_root: roots.data_root,
    hmac_key_id: hmacKeyId,
    input: { ...input },
    occurrence_set_root: roots.occurrence_set_root,
    release_status: "PHYSICAL_BACKFILL_NOT_STARTED",
    routing_allowed: false,
    schema: S0_V2_SCHEMA,
    status: S0_V2_STATUS,
    table_roots: ordered.map((table) => ({
      row_count: table.row_count,
      table: table.table,
      table_root: b64(Buffer.from(table.table_root_hex, "hex")),
    })),
    target_load_allowed: false,
  };
  const contentRoot = domainHmac(hmacKey, "s0-content-root:v2", canonicalizeJcs(document));
  return Object.freeze({
    content_root: b64(contentRoot),
    content_root_hex: contentRoot.toString("hex"),
    document: Object.freeze(document),
  });
}

export { frame as frameS0V2Value };
