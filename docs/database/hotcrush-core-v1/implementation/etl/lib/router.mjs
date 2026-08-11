import { canonicalizeJcs, canonicalizeTypedRow, typedRowFromContract } from "./canonical.mjs";
import {
  domainHmac,
  SOURCE_ROW_NAMESPACE,
  uuidV5FromIdentityHmac,
} from "./identity.mjs";

function b64(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function fieldMap(table) {
  return new Map(table.fields.map((field) => [field.name, field]));
}

function identityBytes(table, row) {
  if (table.identity.mode === "FULL_ROW_MULTISET") return typedRowFromContract(table, row);
  const fields = fieldMap(table);
  return canonicalizeTypedRow(table.name, table.identity.columns.map((name) => {
    const field = fields.get(name);
    if (!field) throw new TypeError("identity_column_missing");
    const raw = row[name];
    if (raw === null) throw new TypeError("source_identity_null");
    if (typeof raw !== "string") throw new TypeError("source_value_not_wire_text");
    return { name, pg_type: field.data_type, raw };
  }));
}

function makeBaseEntries(table, rows, hmacKey) {
  const entries = rows.map((row, sourceIndex) => {
    const payloadBytes = typedRowFromContract(table, row);
    const payloadHmac = domainHmac(hmacKey, "source-payload:v1", payloadBytes);
    let identityHmac;
    let identityError = null;
    try {
      identityHmac = domainHmac(hmacKey, "source-identity:v1", identityBytes(table, row));
    } catch (error) {
      if (error?.message !== "source_identity_null") throw error;
      identityError = "SOURCE_IDENTITY_NULL";
      identityHmac = domainHmac(
        hmacKey,
        "invalid-source-identity:v1",
        Buffer.concat([payloadHmac, Buffer.from(String(sourceIndex), "ascii")]),
      );
    }
    return { identityError, identityHmac, payloadHmac, row, sourceIndex };
  });

  if (table.identity.mode === "FULL_ROW_MULTISET") {
    const groups = new Map();
    for (const entry of entries) {
      const key = b64(entry.payloadHmac);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    for (const group of groups.values()) {
      group.sort((left, right) => left.sourceIndex - right.sourceIndex);
      group.forEach((entry, occurrence) => {
        const occurrenceBytes = canonicalizeJcs({
          occurrence,
          payload_hmac: b64(entry.payloadHmac),
          table: table.name,
        });
        const occurrenceHmac = domainHmac(hmacKey, "source-multiset-occurrence:v1", occurrenceBytes);
        entry.sourceRowId = uuidV5FromIdentityHmac(occurrenceHmac, SOURCE_ROW_NAMESPACE);
        entry.sourceOccurrenceId = entry.sourceRowId;
      });
    }
  } else {
    const identityCounts = new Map();
    for (const entry of entries) {
      const key = b64(entry.identityHmac);
      identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
      entry.sourceRowId = uuidV5FromIdentityHmac(entry.identityHmac, SOURCE_ROW_NAMESPACE);
    }
    for (const entry of entries) {
      entry.duplicateIdentity = identityCounts.get(b64(entry.identityHmac)) > 1;
      const occurrenceHmac = domainHmac(
        hmacKey,
        "source-keyed-occurrence:v1",
        canonicalizeJcs({
          identity_hmac: b64(entry.identityHmac),
          payload_hmac: b64(entry.payloadHmac),
          source_index: entry.sourceIndex,
        }),
      );
      entry.sourceOccurrenceId = uuidV5FromIdentityHmac(occurrenceHmac, SOURCE_ROW_NAMESPACE);
    }
  }
  return entries.sort((left, right) =>
    left.sourceOccurrenceId < right.sourceOccurrenceId ? -1 : 1
  );
}

export function sourceOccurrenceTokens({ table, rows, hmacKey }) {
  return makeBaseEntries(table, rows, hmacKey).map((entry) => ({
    source_identity_hmac: b64(entry.identityHmac),
    source_occurrence_id: entry.sourceOccurrenceId,
    source_payload_hmac: b64(entry.payloadHmac),
    source_row_id: entry.sourceRowId,
  }));
}

function quarantineReason(table, entry) {
  if (entry.identityError) return { code: entry.identityError, scope: "ROW" };
  if (entry.duplicateIdentity) return { code: "DUPLICATE_SOURCE_IDENTITY", scope: "ROW" };
  if (table.migration_class === "B0") return { code: "B0_UNEXPECTED_ROW", scope: "PHYSICAL_BACKFILL" };
  if (table.migration_class === "X") return { code: "APPROVAL_MISSING", scope: "COMPLETENESS_ONLY" };
  if (table.migration_class === "P") return { code: "CLASS_PENDING_REVIEW", scope: "COMPLETENESS_ONLY" };
  return { code: "HANDLER_NOT_APPROVED", scope: "PHYSICAL_BACKFILL" };
}

export function routeSourceRows({
  contract,
  tableName,
  rows,
  hmacKey,
  hmacKeyId = "UNSPECIFIED_TEST_KEY",
  runtimeHandlers = {},
  exclusionResolutions = [],
}) {
  const table = contract.source_tables.find((candidate) => candidate.name === tableName);
  if (!table || !Array.isArray(rows)) throw new TypeError("invalid_route_input");
  if (Object.keys(contract.execution_handlers).length !== 0 || Object.keys(runtimeHandlers).length !== 0) {
    throw new TypeError("runtime_handler_not_bound_to_frozen_contract");
  }
  if (exclusionResolutions.length !== 0 || contract.exclusion_authorities.length !== 0) {
    throw new TypeError("exclusion_authority_not_frozen");
  }
  return makeBaseEntries(table, rows, hmacKey).map((entry) => {
    const reason = quarantineReason(table, entry);
    return {
      blocking_scope: reason.scope,
      hmac_key_id: hmacKeyId,
      outcome: "QUARANTINE",
      reason_code: reason.code,
      source_identity_hmac: b64(entry.identityHmac),
      source_occurrence_id: entry.sourceOccurrenceId,
      source_payload_hmac: b64(entry.payloadHmac),
      source_row_id: entry.sourceRowId,
      source_table: table.name,
      target_intents: [],
    };
  });
}
