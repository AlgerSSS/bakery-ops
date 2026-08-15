import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { types as utilTypes } from "node:util";

import {
  canonicalizeJcs,
  canonicalizeTypedRow,
  parseCanonicalJcs,
  sha256Hex,
} from "../../lib/canonical.mjs";
import { uuidV5 } from "../../lib/identity.mjs";

export const BASE_CONTRACT_SHA256 =
  "7ea542ef1e654b094628bbb97868b28a963879a4815740f7fa4f65c8c60d8587";
export const RELEASE_STATUS = "TYPED_HANDLER_DRY_RUN_ONLY";
export const TARGET_WRITER_ACTIVATION = "NOT_ACTIVATED";
export const PHYSICAL_BACKFILL_STATUS = "PHYSICAL_BACKFILL_NOT_STARTED";
export const MAX_BATCH_ROWS = 100_000;
export const RESOLUTION_AUTHORITY_SCHEMA = "hotcrush.r6.pos-batch1-resolution-authority.v1";
export const RESOLUTION_PIN_SCHEMA = "hotcrush.r6.pos-batch1-resolution-pin.v1";

const STATIC_AUTHORITY_SCHEMA = "hotcrush.r6.pos-batch1-handler-authority.v1";
const RELEASE_SCHEMA = "hotcrush.r6.pos-batch1-handler-release.v1";
const RELEASE_PIN_SCHEMA = "hotcrush.r6.pos-batch1-handler-release-pin.v1";
const OUTPUT_SCHEMA = "hotcrush.r6.pos-batch1-dry-run-output.v1";
const SOURCE_SYSTEM_ID = "4dacf446-0060-57c4-90a9-ec8e784993b4";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function fail(code) {
  throw new TypeError(code);
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Buffer.isBuffer(value)) return false;
  if (utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotObject(value, code, { exactKeys = null } = {}) {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length !== 0) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  if (keys.some((key) => DANGEROUS_KEYS.has(key))) fail(code);
  if (exactKeys) {
    const actual = [...keys].sort(compare);
    const expected = [...exactKeys].sort(compare);
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  }
  const copy = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) fail(code);
    copy[key] = descriptor.value;
  }
  return copy;
}

function snapshotArray(value, code, maxLength = MAX_BATCH_ROWS) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  if (Object.getOwnPropertySymbols(value).length !== 0) fail(code);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) fail(code);
  const length = lengthDescriptor.value;
  if (length > maxLength) fail("SOURCE_CONTRACT_BREACH:SOURCE_BATCH_TOO_LARGE");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedNames = new Set(["length", ...Array.from({ length }, (_, index) => String(index))]);
  if (Object.keys(descriptors).some((key) => !expectedNames.has(key)) || Object.keys(descriptors).length !== length + 1) fail(code);
  const copy = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail(code);
    copy.push(descriptor.value);
  }
  return copy;
}

function snapshotData(value, seen = new Set(), depth = 0) {
  if (depth > 64) fail("BATCH_OUTPUT_DATA_ONLY_REQUIRED");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (!value || typeof value !== "object" || Buffer.isBuffer(value) || utilTypes.isProxy(value) || seen.has(value)) {
    fail("BATCH_OUTPUT_DATA_ONLY_REQUIRED");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = snapshotArray(value, "BATCH_OUTPUT_DATA_ONLY_REQUIRED", 1_000_000);
      return entries.map((entry) => snapshotData(entry, seen, depth + 1));
    }
    const object = snapshotObject(value, "BATCH_OUTPUT_DATA_ONLY_REQUIRED");
    const copy = {};
    for (const [key, child] of Object.entries(object)) copy[key] = snapshotData(child, seen, depth + 1);
    return copy;
  } finally {
    seen.delete(value);
  }
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || Buffer.isBuffer(value) || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function verifySelfHash(value, code) {
  if (!HASH_PATTERN.test(value.self_sha256 ?? "")) fail(code);
  const body = { ...value };
  delete body.self_sha256;
  if (sha256Hex(canonicalizeJcs(body)) !== value.self_sha256) fail(code);
}

function parseArtifact(bytes, canonicalCode) {
  if (!Buffer.isBuffer(bytes)) fail(canonicalCode);
  try {
    return parseCanonicalJcs(Buffer.from(bytes));
  } catch {
    fail(canonicalCode);
  }
}

function equalCanonical(left, right) {
  return canonicalizeJcs(left).equals(canonicalizeJcs(right));
}

function validateDate(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === raw;
}

function validateInteger(raw, min, max) {
  if (!/^-?(0|[1-9]\d*)$/.test(raw)) return false;
  try {
    const parsed = BigInt(raw);
    return parsed >= BigInt(min) && parsed <= BigInt(max);
  } catch {
    return false;
  }
}

function validateNumeric(raw, precision = null, scale = null) {
  const match = /^-?(0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw);
  if (!match) return false;
  const fraction = match[2] ?? "";
  if (scale !== null && fraction.length > scale) return false;
  if (precision !== null) {
    const integerDigits = match[1].replace(/^0+/, "").length || 1;
    if (integerDigits + fraction.length > precision) return false;
  }
  return true;
}

function validateTimestamp(raw) {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(raw);
  if (!match || !validateDate(match[1])) return false;
  return Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60;
}

function validateWire(field, raw) {
  if (raw === null) return field.nullable;
  if (typeof raw !== "string") return false;
  const type = field.data_type;
  if (type === "date") return validateDate(raw);
  if (type === "integer") return validateInteger(raw, -2147483648, 2147483647);
  if (type === "smallint") return validateInteger(raw, -32768, 32767);
  if (type === "boolean") return raw === "t" || raw === "f" || raw === "true" || raw === "false";
  if (type === "timestamp with time zone") return validateTimestamp(raw);
  const numeric = /^numeric(?:\((\d+),(\d+)\))?$/.exec(type);
  if (numeric) return validateNumeric(raw, numeric[1] ? Number(numeric[1]) : null, numeric[2] ? Number(numeric[2]) : null);
  return type === "text" || type === "text[]";
}

function snapshotRow(input, config) {
  if (!isPlainObject(input)) fail("SOURCE_CONTRACT_BREACH:SOURCE_ROW_DATA_ONLY_REQUIRED");
  if (Object.getOwnPropertySymbols(input).length !== 0) fail("SOURCE_CONTRACT_BREACH:SOURCE_ROW_SHAPE_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const actual = Object.keys(descriptors).sort(compare);
  const expected = config.sourceFields.map((field) => field.name).sort(compare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("SOURCE_CONTRACT_BREACH:SOURCE_ROW_SHAPE_MISMATCH");
  }
  const row = Object.create(null);
  for (const key of actual) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) fail("SOURCE_CONTRACT_BREACH:SOURCE_ROW_DATA_ONLY_REQUIRED");
    row[key] = descriptor.value;
  }
  for (const field of config.sourceFields) {
    const raw = row[field.name];
    if (raw === null && !field.nullable) fail(`SOURCE_CONTRACT_BREACH:SOURCE_NOT_NULL_VIOLATION:${field.name}`);
    if (!(raw === null || typeof raw === "string")) fail(`SOURCE_CONTRACT_BREACH:SOURCE_VALUE_NOT_WIRE_TEXT:${field.name}`);
    if (raw !== null && !validateWire(field, raw)) fail(`SOURCE_CONTRACT_BREACH:SOURCE_TYPE_VIOLATION:${field.name}`);
  }
  return Object.freeze({ ...row });
}

function typedPayload(row, config) {
  return canonicalizeTypedRow(config.sourceRelation, config.sourceFields.map((field) => ({
    name: field.name,
    pg_type: field.data_type,
    raw: row[field.name],
  })));
}

function sourceKeyForRow(row, config) {
  return sha256Hex(canonicalizeJcs({
    identity: config.sourceIdentity.map((field) => row[field]),
    relation: config.sourceRelation,
  }));
}

function snapshotChunks(input, config) {
  const chunks = snapshotArray(input, "SOURCE_CONTRACT_BREACH:SOURCE_CHUNKS_DATA_ONLY_REQUIRED", MAX_BATCH_ROWS);
  const rows = [];
  for (const chunk of chunks) {
    const entries = snapshotArray(chunk, "SOURCE_CONTRACT_BREACH:SOURCE_BATCH_DATA_ONLY_REQUIRED", MAX_BATCH_ROWS);
    if (rows.length + entries.length > MAX_BATCH_ROWS) fail("SOURCE_CONTRACT_BREACH:SOURCE_BATCH_TOO_LARGE");
    for (const entry of entries) rows.push(snapshotRow(entry, config));
  }
  const occurrences = rows.map((row) => ({
    row,
    source_key: sourceKeyForRow(row, config),
    source_payload_sha256: sha256Hex(typedPayload(row, config)),
  }));
  const seen = new Set();
  for (const occurrence of occurrences) {
    if (seen.has(occurrence.source_key)) fail("SOURCE_CONTRACT_BREACH:SOURCE_PRIMARY_KEY_DUPLICATE");
    seen.add(occurrence.source_key);
  }
  occurrences.sort((left, right) => compare(left.source_key, right.source_key));
  return occurrences;
}

function snapshotResolutionArtifacts(input) {
  if (input === undefined || input === null) return null;
  const object = snapshotObject(input, "RESOLUTION_ARTIFACTS_DATA_ONLY_REQUIRED", { exactKeys: ["authority", "pin"] });
  if (!Buffer.isBuffer(object.authority) || !Buffer.isBuffer(object.pin)) fail("RESOLUTION_ARTIFACTS_BUFFER_REQUIRED");
  return { authority: Buffer.from(object.authority), pin: Buffer.from(object.pin) };
}

function loadResolution(input, config) {
  const bytes = snapshotResolutionArtifacts(input);
  if (!bytes) return { entries: new Map(), authority_file_sha256: null, authority_self_sha256: null, pin_file_sha256: null, pin_self_sha256: null };
  const authority = parseArtifact(bytes.authority, "RESOLUTION_AUTHORITY_CANONICAL_JSON_REQUIRED");
  const pin = parseArtifact(bytes.pin, "RESOLUTION_PIN_CANONICAL_JSON_REQUIRED");
  verifySelfHash(authority, "RESOLUTION_AUTHORITY_SELF_HASH_MISMATCH");
  verifySelfHash(pin, "RESOLUTION_PIN_SELF_HASH_MISMATCH");
  const authorityKeys = ["authority_mode", "base_contract_sha256", "entries", "handler_id", "schema", "self_sha256"];
  snapshotObject(authority, "RESOLUTION_AUTHORITY_SHAPE_MISMATCH", { exactKeys: authorityKeys });
  if (
    authority.schema !== RESOLUTION_AUTHORITY_SCHEMA ||
    authority.authority_mode !== "SYNTHETIC_APPROVED_FIXTURE" ||
    authority.base_contract_sha256 !== BASE_CONTRACT_SHA256 ||
    authority.handler_id !== config.handlerId
  ) fail("RESOLUTION_AUTHORITY_SEMANTICS_MISMATCH");
  const entries = snapshotArray(authority.entries, "RESOLUTION_AUTHORITY_ENTRIES_DATA_ONLY_REQUIRED", MAX_BATCH_ROWS);
  const allowed = new Set(["source_key", ...config.resolutionFields]);
  const bySource = new Map();
  for (const candidate of entries) {
    const entry = snapshotObject(candidate, "RESOLUTION_AUTHORITY_ENTRY_DATA_ONLY_REQUIRED");
    const keys = Object.keys(entry);
    if (keys.some((key) => !allowed.has(key)) || !HASH_PATTERN.test(entry.source_key ?? "") || bySource.has(entry.source_key)) {
      fail("RESOLUTION_AUTHORITY_ENTRY_INVALID");
    }
    for (const key of keys) if (typeof entry[key] !== "string") fail("RESOLUTION_AUTHORITY_ENTRY_INVALID");
    for (const uuidField of ["location_id", "pos_ingest_batch_id", "listing_id"]) {
      if (Object.hasOwn(entry, uuidField) && !UUID_PATTERN.test(entry[uuidField])) fail("RESOLUTION_AUTHORITY_ENTRY_INVALID");
    }
    bySource.set(entry.source_key, Object.freeze({ ...entry }));
  }
  const pinKeys = ["authority_file_sha256", "authority_self_sha256", "base_contract_sha256", "external_anchor", "handler_id", "schema", "self_sha256", "signature_status"];
  snapshotObject(pin, "RESOLUTION_PIN_SHAPE_MISMATCH", { exactKeys: pinKeys });
  if (
    pin.schema !== RESOLUTION_PIN_SCHEMA ||
    pin.authority_file_sha256 !== sha256Hex(bytes.authority) ||
    pin.authority_self_sha256 !== authority.self_sha256 ||
    pin.base_contract_sha256 !== BASE_CONTRACT_SHA256 ||
    pin.external_anchor !== "SYNTHETIC_TEST_FIXTURE" ||
    pin.handler_id !== config.handlerId ||
    pin.signature_status !== "UNSIGNED"
  ) fail("RESOLUTION_PIN_SEMANTICS_MISMATCH");
  return {
    entries: bySource,
    authority_file_sha256: sha256Hex(bytes.authority),
    authority_self_sha256: authority.self_sha256,
    pin_file_sha256: sha256Hex(bytes.pin),
    pin_self_sha256: pin.self_sha256,
  };
}

function typed(column, pgType, raw) {
  if (raw === null) return { column, kind: "NULL", pg_type: pgType, raw: null };
  if (typeof raw !== "string") fail("INTERNAL_TARGET_WIRE_TEXT_REQUIRED");
  return { column, kind: "WIRE", pg_type: pgType, raw };
}

function opcode(column, pgType, operation = "TARGET_TRANSACTION_TIMESTAMP") {
  return { column, kind: "OPCODE", opcode: operation, pg_type: pgType };
}

function deterministicUuid(domain, components) {
  return uuidV5(SOURCE_SYSTEM_ID, canonicalizeJcs({ components, domain }));
}

function targetIdentity(relation, components) {
  return sha256Hex(canonicalizeJcs({ components, relation }));
}

function isNegative(raw) {
  return raw.startsWith("-") && /[1-9]/.test(raw);
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function hourStartedAt(date, hourRaw, cutoffRaw, offsetRaw) {
  if (!validateInteger(hourRaw, 0, 23) || !validateInteger(cutoffRaw, 0, 23) || !validateInteger(offsetRaw, -720, 840)) return null;
  const hour = Number(hourRaw);
  const cutoff = Number(cutoffRaw);
  const offset = Number(offsetRaw);
  const localDate = hour < cutoff ? addDays(date, 1) : date;
  const sign = offset < 0 ? "-" : "+";
  const absolute = Math.abs(offset);
  const offsetText = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return `${localDate}T${String(hour).padStart(2, "0")}:00:00${offsetText}`;
}

function decimalUnits(raw, scale = 4) {
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = unsigned.split(".");
  const units = BigInt(whole) * (10n ** BigInt(scale)) + BigInt((fraction + "0".repeat(scale)).slice(0, scale));
  return negative ? -units : units;
}

function uniqueReasons(reasons) {
  return [...new Set(reasons)];
}

function expectedAuthority(config) {
  const body = {
    base_contract_sha256: BASE_CONTRACT_SHA256,
    field_mappings: config.fieldMappings,
    handler_id: config.handlerId,
    identity_derivation: {
      framing: "JCS_DOMAIN_AND_COMPONENTS",
      namespace: SOURCE_SYSTEM_ID,
    },
    physical_backfill_status: PHYSICAL_BACKFILL_STATUS,
    release_status: RELEASE_STATUS,
    remediation_blocker: config.remediationBlocker ?? null,
    resolution_authority: {
      approved_real_entries: 0,
      injection_mode: "CANONICAL_PINNED_PER_OCCURRENCE",
      schema: RESOLUTION_AUTHORITY_SCHEMA,
    },
    schema: STATIC_AUTHORITY_SCHEMA,
    source_fields: config.sourceFields,
    source_identity: config.sourceIdentity,
    source_relation: config.sourceRelation,
    target_relation_allowlist: ["app_source_system", ...config.targetRelations],
    target_write_blocker: config.targetWriteBlocker ?? null,
    target_writer_activation: TARGET_WRITER_ACTIVATION,
  };
  return { ...body, self_sha256: sha256Hex(canonicalizeJcs(body)) };
}

function artifactPath(moduleUrl, filename) {
  return fileURLToPath(new URL(filename, moduleUrl));
}

export function createBatchHandler(config, moduleUrl) {
  const files = Object.freeze({
    authority: artifactPath(moduleUrl, "authority.json"),
    handler: artifactPath(moduleUrl, "handler.mjs"),
    pin: artifactPath(moduleUrl, "release-pin.json"),
    release: artifactPath(moduleUrl, "release.json"),
    runtime: artifactPath(moduleUrl, "_runtime.mjs"),
  });

  function verifyReleaseArtifacts(input) {
    const artifacts = snapshotObject(input, "RELEASE_ARTIFACTS_DATA_ONLY_REQUIRED", {
      exactKeys: ["authority", "handler", "pin", "release", "runtime"],
    });
    for (const key of Object.keys(artifacts)) if (!Buffer.isBuffer(artifacts[key])) fail("RELEASE_ARTIFACT_BUFFER_REQUIRED");
    const authority = parseArtifact(artifacts.authority, "AUTHORITY_CANONICAL_JSON_REQUIRED");
    const release = parseArtifact(artifacts.release, "RELEASE_CANONICAL_JSON_REQUIRED");
    const pin = parseArtifact(artifacts.pin, "RELEASE_PIN_CANONICAL_JSON_REQUIRED");
    verifySelfHash(authority, "AUTHORITY_SELF_HASH_MISMATCH");
    verifySelfHash(release, "RELEASE_SELF_HASH_MISMATCH");
    verifySelfHash(pin, "RELEASE_PIN_SELF_HASH_MISMATCH");
    if (!equalCanonical(authority, expectedAuthority(config))) fail("AUTHORITY_SEMANTICS_MISMATCH");
    const expectedReleaseBody = {
      authority_file: "authority.json",
      authority_file_sha256: sha256Hex(artifacts.authority),
      authority_self_sha256: authority.self_sha256,
      base_contract_sha256: BASE_CONTRACT_SHA256,
      handler_file: "handler.mjs",
      handler_file_sha256: sha256Hex(artifacts.handler),
      handler_id: config.handlerId,
      physical_backfill_status: PHYSICAL_BACKFILL_STATUS,
      release_status: RELEASE_STATUS,
      runtime_file: "_runtime.mjs",
      runtime_file_sha256: sha256Hex(artifacts.runtime),
      schema: RELEASE_SCHEMA,
      target_writer_activation: TARGET_WRITER_ACTIVATION,
    };
    const expectedRelease = { ...expectedReleaseBody, self_sha256: sha256Hex(canonicalizeJcs(expectedReleaseBody)) };
    if (!equalCanonical(release, expectedRelease)) {
      if (release.handler_file_sha256 !== expectedRelease.handler_file_sha256) fail("HANDLER_FILE_HASH_MISMATCH");
      if (release.runtime_file_sha256 !== expectedRelease.runtime_file_sha256) fail("RUNTIME_FILE_HASH_MISMATCH");
      fail("RELEASE_SEMANTICS_MISMATCH");
    }
    const expectedPinBody = {
      base_contract_sha256: BASE_CONTRACT_SHA256,
      external_anchor: "OFFLINE_REVIEW_ONLY_NOT_AN_ACTIVATION_SIGNATURE",
      handler_id: config.handlerId,
      release_file: "release.json",
      release_file_sha256: sha256Hex(artifacts.release),
      release_self_sha256: release.self_sha256,
      schema: RELEASE_PIN_SCHEMA,
      signature_status: "UNSIGNED",
    };
    const expectedPin = { ...expectedPinBody, self_sha256: sha256Hex(canonicalizeJcs(expectedPinBody)) };
    if (!equalCanonical(pin, expectedPin)) fail("RELEASE_PIN_SEMANTICS_MISMATCH");
    return true;
  }

  function loadRelease(options = undefined) {
    let includeArtifactBytes = false;
    if (options !== undefined) {
      const copy = snapshotObject(options, "LOAD_RELEASE_OPTIONS_DATA_ONLY_REQUIRED", { exactKeys: ["includeArtifactBytes"] });
      if (typeof copy.includeArtifactBytes !== "boolean") fail("LOAD_RELEASE_OPTIONS_INVALID");
      includeArtifactBytes = copy.includeArtifactBytes;
    }
    const artifactBytes = {
      authority: readFileSync(files.authority),
      handler: readFileSync(files.handler),
      pin: readFileSync(files.pin),
      release: readFileSync(files.release),
      runtime: readFileSync(files.runtime),
    };
    verifyReleaseArtifacts(artifactBytes);
    const loaded = {
      authority: parseCanonicalJcs(artifactBytes.authority),
      pin: parseCanonicalJcs(artifactBytes.pin),
      release: parseCanonicalJcs(artifactBytes.release),
    };
    if (includeArtifactBytes) loaded.artifact_bytes = Object.fromEntries(Object.entries(artifactBytes).map(([key, value]) => [key, Buffer.from(value)]));
    return loaded;
  }

  function sourceOccurrenceKey(input) {
    return sourceKeyForRow(snapshotRow(input, config), config);
  }

  const helpers = Object.freeze({
    decimalUnits,
    deterministicUuid,
    hourStartedAt,
    isNegative,
    opcode,
    sourceSystemId: SOURCE_SYSTEM_ID,
    targetIdentity,
    typed,
  });

  function buildOutput(occurrences, resolution) {
    const release = loadRelease();
    let routes = occurrences.map((occurrence) => {
      const entry = resolution.entries.get(occurrence.source_key) ?? null;
      const decision = config.evaluate(occurrence.row, entry, helpers);
      const blockers = uniqueReasons(decision.blockers ?? []);
      const warnings = uniqueReasons(decision.warnings ?? []);
      let outcome = blockers.length === 0 ? "TARGET" : "QUARANTINE";
      let targetIntents = [];
      let targetIdentityKey = null;
      if (outcome === "TARGET") {
        targetIdentityKey = decision.target_identity_key;
        targetIntents = [{ operation: "INSERT", relation: decision.relation, values: decision.values }];
      }
      return {
        outcome,
        reason_codes: [...blockers, ...warnings],
        source_key: occurrence.source_key,
        source_payload_sha256: occurrence.source_payload_sha256,
        target_identity_key: targetIdentityKey,
        target_intents: targetIntents,
      };
    });
    const targetGroups = new Map();
    for (const route of routes) {
      if (route.outcome !== "TARGET") continue;
      const members = targetGroups.get(route.target_identity_key) ?? [];
      members.push(route.source_key);
      targetGroups.set(route.target_identity_key, members);
    }
    const collisions = new Set([...targetGroups.values()].filter((members) => members.length > 1).flat());
    routes = routes.map((route) => collisions.has(route.source_key) ? {
      ...route,
      outcome: "QUARANTINE",
      reason_codes: uniqueReasons([...route.reason_codes, "TARGET_IDENTITY_COLLISION"]),
      target_intents: [],
    } : route);
    const targetCount = routes.filter((route) => route.outcome === "TARGET").length;
    const seedIntent = targetCount === 0 ? null : {
      operation: "UPSERT",
      relation: "app_source_system",
      values: [
        typed("source_system_id", "uuid", SOURCE_SYSTEM_ID),
        typed("source_code", "text", "res_pos"),
        typed("source_name", "text", "Restosuite POS"),
        typed("source_type", "text", "API"),
        typed("owner_project", "text", "res_api"),
        typed("authoritative_scope", "text", "RES/POS source facts"),
        typed("status", "text", "ACTIVE"),
        opcode("created_at", "timestamptz"),
        opcode("updated_at", "timestamptz"),
      ],
    };
    const sourceOccurrences = occurrences.map(({ source_key, source_payload_sha256 }) => ({ source_key, source_payload_sha256 }));
    const output = {
      authority_file_sha256: release.release.authority_file_sha256,
      base_contract_sha256: BASE_CONTRACT_SHA256,
      counts: { QUARANTINE: routes.length - targetCount, TARGET: targetCount },
      handler_file_sha256: release.release.handler_file_sha256,
      handler_id: config.handlerId,
      physical_backfill_status: PHYSICAL_BACKFILL_STATUS,
      release_file_sha256: release.pin.release_file_sha256,
      release_pin_self_sha256: release.pin.self_sha256,
      release_self_sha256: release.release.self_sha256,
      release_status: RELEASE_STATUS,
      resolution_authority_file_sha256: resolution.authority_file_sha256,
      resolution_authority_self_sha256: resolution.authority_self_sha256,
      resolution_pin_file_sha256: resolution.pin_file_sha256,
      resolution_pin_self_sha256: resolution.pin_self_sha256,
      route_root_sha256: sha256Hex(canonicalizeJcs(routes)),
      routes,
      runtime_file_sha256: release.release.runtime_file_sha256,
      schema: OUTPUT_SCHEMA,
      seed_intent: seedIntent,
      source_occurrences: sourceOccurrences,
      source_root_sha256: sha256Hex(canonicalizeJcs({ source_occurrences: sourceOccurrences })),
      target_intent_root_sha256: sha256Hex(canonicalizeJcs({
        seed_intent: seedIntent,
        target_intents: routes.flatMap((route) => route.target_intents),
      })),
      target_writer_activation: TARGET_WRITER_ACTIVATION,
    };
    output.canonical_root_sha256 = sha256Hex(canonicalizeJcs(output));
    return deepFreeze(snapshotData(output));
  }

  function transformChunks(chunks, resolutionArtifacts = undefined) {
    const occurrences = snapshotChunks(chunks, config);
    const resolution = loadResolution(resolutionArtifacts, config);
    return buildOutput(occurrences, resolution);
  }

  function transformBatch(rows, resolutionArtifacts = undefined) {
    if (utilTypes.isProxy(rows)) fail("SOURCE_CONTRACT_BREACH:SOURCE_BATCH_DATA_ONLY_REQUIRED");
    if (Array.isArray(rows)) {
      const length = Object.getOwnPropertyDescriptor(rows, "length")?.value;
      if (typeof length === "number" && length > MAX_BATCH_ROWS) fail("SOURCE_CONTRACT_BREACH:SOURCE_BATCH_TOO_LARGE");
    }
    return transformChunks([rows], resolutionArtifacts);
  }

  function recomputeBatchRoot(output) {
    const body = snapshotData(output);
    delete body.canonical_root_sha256;
    return sha256Hex(canonicalizeJcs(body));
  }

  function verifyChunks(chunks, output, resolutionArtifacts = undefined) {
    const actual = snapshotData(output);
    const rebuilt = transformChunks(chunks, resolutionArtifacts);
    if (!canonicalizeJcs(actual).equals(canonicalizeJcs(rebuilt))) fail("BATCH_OUTPUT_MISMATCH");
    if (recomputeBatchRoot(actual) !== actual.canonical_root_sha256) fail("BATCH_CANONICAL_ROOT_MISMATCH");
    return true;
  }

  function verifyBatch(rows, output, resolutionArtifacts = undefined) {
    return verifyChunks([rows], output, resolutionArtifacts);
  }

  return Object.freeze({
    BASE_CONTRACT_SHA256,
    HANDLER_ID: config.handlerId,
    MAX_BATCH_ROWS,
    PHYSICAL_BACKFILL_STATUS,
    RELEASE_STATUS,
    RESOLUTION_AUTHORITY_SCHEMA,
    RESOLUTION_PIN_SCHEMA,
    TARGET_WRITER_ACTIVATION,
    expectedAuthority: () => expectedAuthority(config),
    loadRelease,
    recomputeBatchRoot,
    sourceOccurrenceKey,
    transformBatch,
    transformChunks,
    verifyBatch,
    verifyChunks,
    verifyReleaseArtifacts,
  });
}
