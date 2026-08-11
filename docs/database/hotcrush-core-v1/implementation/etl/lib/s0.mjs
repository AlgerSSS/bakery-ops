import { randomUUID } from "node:crypto";

import {
  canonicalizeJcs,
  parseCanonicalJcs,
  sha256Hex,
  typedRowFromContract,
} from "./canonical.mjs";
import { domainHmac } from "./identity.mjs";
import { readEncryptedArtifact, writeEncryptedArtifact } from "./envelope.mjs";
import { validateKeyring } from "./keys.mjs";
import { sourceOccurrenceTokens } from "./router.mjs";

const S0_SCHEMA = "hotcrush.r6.s0.synthetic-scaffold.v1";
const METADATA_KEYS = [
  "deferrable", "isolation_level", "locked_tables", "read_only",
  "schema_revalidated_after_lock", "server_version", "session_settings",
  "snapshot_token_hmac", "source_project_ref", "source_watermark",
];
const PAYLOAD_KEYS = ["capture_id", "content_root", "data", "data_root", "manifest", "snapshot_descriptor"];
const DATA_KEYS = ["contract_sha256", "schema", "tables"];
const MANIFEST_KEYS = [
  "captured_rows", "occurrence_set_root", "source_table_fields", "source_tables",
  "streaming_status", "tables",
];
const SNAPSHOT_DESCRIPTOR_KEYS = ["capture_contract", "data_root", "occurrence_set_root"];
const TABLE_MANIFEST_KEYS = [
  "identity_columns", "identity_mode", "row_count", "source_occurrence_set_root",
  "table", "table_root",
];

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      canonicalizeJcs(Object.keys(value).sort(compare)).toString() !==
        canonicalizeJcs([...expected].sort(compare)).toString()) {
    throw new TypeError(code);
  }
}

function isDigest(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function contractHash(contract) {
  return sha256Hex(canonicalizeJcs(contract));
}

function validateMetadata(contract, metadata) {
  if (!metadata || typeof metadata !== "object") throw new TypeError("invalid_s0_metadata");
  const keys = Object.keys(metadata).sort(compare);
  if (canonicalizeJcs(keys).toString() !== canonicalizeJcs([...METADATA_KEYS].sort(compare)).toString()) {
    throw new TypeError("invalid_s0_metadata");
  }
  if (
    metadata.isolation_level !== "SERIALIZABLE" || metadata.read_only !== true ||
    metadata.deferrable !== true || !isDigest(metadata.snapshot_token_hmac) ||
    typeof metadata.source_watermark !== "string" ||
    metadata.schema_revalidated_after_lock !== true ||
    metadata.server_version !== contract.source_capture_contract.expected_postgresql_version ||
    metadata.source_project_ref !== contract.source_capture_contract.source_project_ref ||
    canonicalizeJcs(metadata.session_settings).toString() !==
      canonicalizeJcs(contract.source_capture_contract.session_settings).toString()
  ) {
    throw new TypeError("invalid_s0_metadata");
  }
  const expected = contract.source_capture_contract.lock_order;
  if (!Array.isArray(metadata.locked_tables) ||
      canonicalizeJcs(metadata.locked_tables).toString() !== canonicalizeJcs(expected).toString()) {
    throw new TypeError("s0_lock_set_mismatch");
  }
}

function stableTables(contract, tableRows, hmacKey) {
  const names = Object.keys(tableRows).sort(compare);
  const expected = contract.source_tables.map((table) => table.name).sort(compare);
  if (canonicalizeJcs(names).toString() !== canonicalizeJcs(expected).toString()) {
    throw new TypeError("s0_table_set_mismatch");
  }
  return Object.fromEntries(contract.source_tables.map((table) => {
    const rows = tableRows[table.name];
    if (!Array.isArray(rows)) throw new TypeError("s0_table_rows_invalid");
    const keyed = rows.map((row) => {
      const canonical = typedRowFromContract(table, row);
      return {
        key: domainHmac(hmacKey, "s0-row-order:v1", canonical).toString("base64url"),
        row,
      };
    }).sort((left, right) => compare(left.key, right.key));
    return [table.name, keyed.map((entry) => entry.row)];
  }));
}

function dataContent(contract, tables) {
  return {
    contract_sha256: contractHash(contract),
    schema: S0_SCHEMA,
    tables,
  };
}

function tableManifest(contract, tables, hmacKey) {
  return contract.source_tables.map((table) => {
    const occurrenceTokens = sourceOccurrenceTokens({
      hmacKey,
      rows: tables[table.name],
      table,
    });
    return {
      identity_columns: [...table.identity.columns],
      identity_mode: table.identity.mode,
      row_count: tables[table.name].length,
      source_occurrence_set_root: domainHmac(
        hmacKey,
        "s0-table-occurrences:v1",
        canonicalizeJcs({ occurrence_tokens: occurrenceTokens, table: table.name }),
      ).toString("base64url"),
      table: table.name,
      table_root: domainHmac(
        hmacKey,
        "s0-table-root:v1",
        canonicalizeJcs({ rows: tables[table.name], table: table.name }),
      ).toString("base64url"),
    };
  });
}

export async function createEncryptedS0({
  contract,
  fixtureMode,
  tableRows,
  metadata,
  keyring: keyringInput,
  directory,
  filename,
}) {
  if (fixtureMode !== true || contract.release_status !== "PHYSICAL_BACKFILL_NOT_STARTED") {
    throw new TypeError("synthetic_s0_fixture_mode_required");
  }
  const keyring = validateKeyring(keyringInput);
  validateMetadata(contract, metadata);
  const tables = stableTables(contract, tableRows, keyring.hmacKey);
  const data = dataContent(contract, tables);
  const dataRoot = domainHmac(
    keyring.hmacKey,
    "s0-data-root:v1",
    canonicalizeJcs(data),
  ).toString("base64url");
  const tableManifests = tableManifest(contract, tables, keyring.hmacKey);
  const occurrenceSetRoot = domainHmac(
    keyring.hmacKey,
    "s0-occurrence-set-root:v1",
    canonicalizeJcs(tableManifests),
  ).toString("base64url");
  const snapshotDescriptor = {
    capture_contract: metadata,
    data_root: dataRoot,
    occurrence_set_root: occurrenceSetRoot,
  };
  const contentRoot = domainHmac(
    keyring.hmacKey,
    "s0-content-root:v1",
    canonicalizeJcs(snapshotDescriptor),
  ).toString("base64url");
  const captureId = randomUUID();
  const payload = {
    capture_id: captureId,
    content_root: contentRoot,
    data,
    data_root: dataRoot,
    manifest: {
      captured_rows: Object.values(tables).reduce((sum, rows) => sum + rows.length, 0),
      occurrence_set_root: occurrenceSetRoot,
      source_table_fields: contract.counts.source_table_fields,
      source_tables: contract.counts.source_tables,
      streaming_status: "SYNTHETIC_SCAFFOLD_ONLY",
      tables: tableManifests,
    },
    snapshot_descriptor: snapshotDescriptor,
  };
  const plaintext = canonicalizeJcs(payload);
  const receipt = await writeEncryptedArtifact({
    artifactType: "R6_S0",
    contentId: sha256Hex(plaintext),
    directory,
    filename,
    keyring,
    plaintext,
  });
  return { ...receipt, capture_id: captureId, content_root: contentRoot, data_root: dataRoot };
}

export async function openEncryptedS0({ path, keyring: keyringInput, contract }) {
  const keyring = validateKeyring(keyringInput);
  const plaintext = await readEncryptedArtifact({
    expectedArtifactType: "R6_S0",
    path,
    keyring,
  });
  const payload = parseCanonicalJcs(plaintext);
  exactKeys(payload, PAYLOAD_KEYS, "s0_payload_shape_mismatch");
  exactKeys(payload.data, DATA_KEYS, "s0_data_shape_mismatch");
  exactKeys(payload.manifest, MANIFEST_KEYS, "s0_manifest_shape_mismatch");
  exactKeys(payload.snapshot_descriptor, SNAPSHOT_DESCRIPTOR_KEYS, "s0_snapshot_descriptor_shape_mismatch");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.capture_id) ||
      !isDigest(payload.content_root) || !isDigest(payload.data_root)) {
    throw new TypeError("s0_identifier_shape_mismatch");
  }
  if (!payload || payload.data?.schema !== S0_SCHEMA || payload.data.contract_sha256 !== contractHash(contract)) {
    throw new TypeError("s0_contract_mismatch");
  }
  validateMetadata(contract, payload.snapshot_descriptor?.capture_contract);
  const recomputedDataRoot = domainHmac(
    keyring.hmacKey,
    "s0-data-root:v1",
    canonicalizeJcs(payload.data),
  ).toString("base64url");
  if (payload.data_root !== recomputedDataRoot || payload.snapshot_descriptor.data_root !== recomputedDataRoot) {
    throw new TypeError("s0_data_root_mismatch");
  }
  const tables = payload.data.tables;
  const normalizedTables = stableTables(contract, tables, keyring.hmacKey);
  if (!canonicalizeJcs(normalizedTables).equals(canonicalizeJcs(tables))) {
    throw new TypeError("s0_row_order_not_canonical");
  }
  const expectedTables = tableManifest(contract, tables, keyring.hmacKey);
  const expectedOccurrences = domainHmac(
    keyring.hmacKey,
    "s0-occurrence-set-root:v1",
    canonicalizeJcs(expectedTables),
  ).toString("base64url");
  if (
    payload.manifest.tables.some((entry) => {
      try { exactKeys(entry, TABLE_MANIFEST_KEYS, "s0_table_manifest_shape_mismatch"); return false; }
      catch { return true; }
    }) ||
    canonicalizeJcs(payload.manifest.tables).toString() !== canonicalizeJcs(expectedTables).toString() ||
    payload.manifest.occurrence_set_root !== expectedOccurrences ||
    payload.snapshot_descriptor.occurrence_set_root !== expectedOccurrences ||
    payload.manifest.source_tables !== 76 || payload.manifest.source_table_fields !== 759 ||
    payload.manifest.captured_rows !== expectedTables.reduce((sum, table) => sum + table.row_count, 0) ||
    payload.manifest.streaming_status !== "SYNTHETIC_SCAFFOLD_ONLY"
  ) {
    throw new TypeError("s0_manifest_mismatch");
  }
  const expectedRoot = domainHmac(
    keyring.hmacKey,
    "s0-content-root:v1",
    canonicalizeJcs(payload.snapshot_descriptor),
  ).toString("base64url");
  if (payload.content_root !== expectedRoot) throw new TypeError("s0_content_root_mismatch");
  return {
    capture_id: payload.capture_id,
    content_root: payload.content_root,
    data_root: payload.data_root,
    manifest: payload.manifest,
    snapshot_descriptor: payload.snapshot_descriptor,
    tables,
  };
}

export { S0_SCHEMA };
