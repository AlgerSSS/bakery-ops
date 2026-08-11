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
export const HANDLER_ID = "pos_product_to_pos_product_listing_v1";
export const RELEASE_STATUS = "TYPED_HANDLER_DRY_RUN_ONLY";
export const PHYSICAL_BACKFILL_STATUS = "PHYSICAL_BACKFILL_NOT_STARTED";
export const TARGET_WRITER_ACTIVATION = "NOT_ACTIVATED";
export const SOURCE_SYSTEM_ID = "4dacf446-0060-57c4-90a9-ec8e784993b4";
export const MAX_BATCH_ROWS = 100_000;

const AUTHORITY_SCHEMA = "hotcrush.r6.typed-handler-authority.v1";
const RELEASE_SCHEMA = "hotcrush.r6.typed-handler-release.v1";
const RELEASE_PIN_SCHEMA = "hotcrush.r6.typed-handler-release-pin.v1";
const OUTPUT_SCHEMA = "hotcrush.r6.pos-product-listing-intents.v1";
const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const SOURCE_SYSTEM_NAME = "hotcrush:source-system:res_pos";
const LISTING_DOMAIN = "hotcrush:pos_product_listing:v1";
const TRANSACTION_TIMESTAMP_OPCODE = "TARGET_TRANSACTION_TIMESTAMP";
const AUTHORITY_FILENAME = "authority.json";
const RELEASE_FILENAME = "release.json";
const RELEASE_PIN_FILENAME = "release-pin.json";
const HANDLER_FILENAME = "handler.mjs";
const HERE = new URL("./", import.meta.url);

const SOURCE_FIELDS = Object.freeze([
  Object.freeze({ data_type: "text", name: "item_key", nullable: false }),
  Object.freeze({ data_type: "text", name: "item_id", nullable: false }),
  Object.freeze({ data_type: "text", name: "org_id", nullable: false }),
  Object.freeze({ data_type: "smallint", name: "org_type", nullable: false }),
  Object.freeze({ data_type: "text", name: "menu_item_code", nullable: true }),
  Object.freeze({ data_type: "text", name: "name_en", nullable: false }),
  Object.freeze({ data_type: "text", name: "name_zh", nullable: true }),
  Object.freeze({ data_type: "text", name: "category_id", nullable: true }),
  Object.freeze({ data_type: "text", name: "category_en", nullable: true }),
  Object.freeze({ data_type: "text", name: "category_zh", nullable: true }),
  Object.freeze({ data_type: "text", name: "spec", nullable: true }),
  Object.freeze({ data_type: "numeric(12,4)", name: "sales_price", nullable: true }),
  Object.freeze({ data_type: "text", name: "res_cost_card_id", nullable: true }),
  Object.freeze({ data_type: "text", name: "res_spec_id", nullable: true }),
  Object.freeze({ data_type: "boolean", name: "has_cost_card", nullable: false }),
  Object.freeze({ data_type: "numeric(14,6)", name: "res_total_cost", nullable: true }),
  Object.freeze({ data_type: "numeric(14,6)", name: "res_theoretical_cost", nullable: true }),
  Object.freeze({ data_type: "smallint", name: "res_status", nullable: true }),
  Object.freeze({ data_type: "timestamp with time zone", name: "first_seen_at", nullable: false }),
  Object.freeze({ data_type: "timestamp with time zone", name: "synced_at", nullable: false }),
  Object.freeze({ data_type: "text", name: "name_zh_display", nullable: true }),
  Object.freeze({ data_type: "text", name: "category_display", nullable: true }),
]);

const FIELD_MAPPINGS = Object.freeze([
  ["listing_id", "uuid", null, "DERIVE_LISTING_UUID_V5"],
  ["source_system_id", "uuid", null, "CONSTANT_SOURCE_SYSTEM_ID"],
  ["location_id", "uuid", null, "CONSTANT_NULL"],
  ["source_organization_id", "text", "org_id", "COPY_WIRE"],
  ["source_item_id", "text", "item_id", "COPY_WIRE"],
  ["source_item_key", "text", "item_key", "COPY_WIRE"],
  ["source_organization_type_code", "smallint", "org_type", "COPY_WIRE"],
  ["source_menu_item_code", "text", "menu_item_code", "COPY_WIRE"],
  ["source_name", "text", "name_en", "COPY_WIRE"],
  ["source_name_en", "text", "name_en", "COPY_WIRE"],
  ["source_name_zh", "text", "name_zh", "COPY_WIRE"],
  ["source_category", "text", "category_en", "COPY_WIRE"],
  ["source_category_id", "text", "category_id", "COPY_WIRE"],
  ["source_category_en", "text", "category_en", "COPY_WIRE"],
  ["source_category_zh", "text", "category_zh", "COPY_WIRE"],
  ["source_specification", "text", "spec", "COPY_WIRE"],
  ["current_price", "numeric(18,4)", "sales_price", "COPY_WIRE"],
  ["currency", "char(3)", null, "CONSTANT_CURRENCY"],
  ["source_cost_card_id", "text", "res_cost_card_id", "COPY_WIRE"],
  ["source_cost_spec_id", "text", "res_spec_id", "COPY_WIRE"],
  ["source_has_cost_card", "boolean", "has_cost_card", "BOOLEAN_WIRE_TO_TARGET"],
  ["source_total_cost", "numeric(18,6)", "res_total_cost", "COPY_WIRE"],
  ["source_theoretical_cost", "numeric(18,6)", "res_theoretical_cost", "COPY_WIRE"],
  ["source_status_code", "smallint", "res_status", "COPY_WIRE"],
  ["display_name_override", "text", "name_zh_display", "COPY_WIRE"],
  ["display_category_override", "text", "category_display", "COPY_WIRE"],
  ["is_active", "boolean", "res_status", "STATUS_ONE_TO_TRUE"],
  ["first_seen_at", "timestamptz", "first_seen_at", "COPY_WIRE"],
  ["last_seen_at", "timestamptz", "synced_at", "COPY_WIRE"],
  ["created_at", "timestamptz", null, "TARGET_TRANSACTION_TIMESTAMP"],
  ["updated_at", "timestamptz", null, "TARGET_TRANSACTION_TIMESTAMP"],
].map(([target_column, target_type, source_field, transform]) => Object.freeze({
  source_field,
  target_column,
  target_type,
  transform,
})));

const APPROVED_ORGANIZATIONS = Object.freeze([
  "1990716608733069315",
  "1991027325256417283",
]);

const AUTHORITY_KEYS = Object.freeze([
  "approved_source_organization_ids",
  "base_contract_sha256",
  "currency",
  "field_mappings",
  "handler_id",
  "listing_identity",
  "physical_backfill_status",
  "release_status",
  "schema",
  "self_sha256",
  "source_fields",
  "source_system",
  "target_relation_allowlist",
  "target_writer_activation",
]);
const RELEASE_KEYS = Object.freeze([
  "authority_file",
  "authority_file_sha256",
  "authority_self_sha256",
  "base_contract_sha256",
  "handler_file",
  "handler_file_sha256",
  "handler_id",
  "physical_backfill_status",
  "release_status",
  "schema",
  "self_sha256",
  "target_writer_activation",
]);
const RELEASE_PIN_KEYS = Object.freeze([
  "base_contract_sha256",
  "external_anchor",
  "handler_id",
  "release_file",
  "release_file_sha256",
  "release_self_sha256",
  "schema",
  "self_sha256",
  "signature_status",
]);
const OUTPUT_KEYS = Object.freeze([
  "authority_file_sha256",
  "base_contract_sha256",
  "canonical_root_sha256",
  "counts",
  "handler_file_sha256",
  "handler_id",
  "physical_backfill_status",
  "release_self_sha256",
  "release_file_sha256",
  "release_pin_self_sha256",
  "release_status",
  "route_root_sha256",
  "routes",
  "schema",
  "seed_intent",
  "source_occurrences",
  "target_intent_root_sha256",
  "target_writer_activation",
]);
const REASON_ORDER = Object.freeze([
  "SOURCE_BOOLEAN_INVALID",
  "SOURCE_COST_CARD_INVARIANT",
  "SOURCE_IDENTITY_COMPONENT_INVALID",
  "SOURCE_ITEM_KEY_COMPONENT_MISMATCH",
  "SOURCE_NAME_INVALID",
  "SOURCE_NUMERIC_INVALID",
  "SOURCE_ORGANIZATION_NOT_APPROVED",
  "SOURCE_ORGANIZATION_TYPE_INVALID",
  "SOURCE_STATUS_UNMAPPED",
  "SOURCE_TIMESTAMP_INVALID",
  "SOURCE_TIMESTAMP_ORDER_INVALID",
  "TARGET_IDENTITY_GROUP_COLLISION",
  "TARGET_LISTING_ID_COLLISION",
]);

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(code);
  const actual = Object.keys(value).sort(compare);
  const wanted = [...expected].sort(compare);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(code);
  }
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value) || Buffer.isBuffer(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function bodyWithoutSelfHash(value) {
  const body = { ...value };
  delete body.self_sha256;
  return body;
}

function expectedAuthorityBody() {
  return {
    approved_source_organization_ids: [...APPROVED_ORGANIZATIONS],
    base_contract_sha256: BASE_CONTRACT_SHA256,
    currency: "MYR",
    field_mappings: FIELD_MAPPINGS.map((entry) => ({ ...entry })),
    handler_id: HANDLER_ID,
    listing_identity: {
      domain: LISTING_DOMAIN,
      framing: "U32BE_LENGTH_PREFIX_EACH_UTF8_COMPONENT",
      namespace: SOURCE_SYSTEM_ID,
      test_vector: {
        listing_id: "bfa07530-1a0b-5020-8168-baa112ff7aa3",
        source_item_id: "33291",
        source_organization_id: "1991027325256417283",
      },
    },
    physical_backfill_status: PHYSICAL_BACKFILL_STATUS,
    release_status: RELEASE_STATUS,
    schema: AUTHORITY_SCHEMA,
    source_fields: SOURCE_FIELDS.map((entry) => ({ ...entry })),
    source_system: {
      authoritative_scope: "RES/POS商品目录、销售与会员来源事实",
      owner_project: "res_api",
      source_code: "res_pos",
      source_name: "Restosuite POS",
      source_system_id: SOURCE_SYSTEM_ID,
      source_type: "API",
      status: "ACTIVE",
      uuid_derivation: {
        name: SOURCE_SYSTEM_NAME,
        namespace: DNS_NAMESPACE,
      },
    },
    target_relation_allowlist: ["app_source_system", "pos_product_listing"],
    target_writer_activation: TARGET_WRITER_ACTIVATION,
  };
}

function parseCanonicalArtifact(bytes, code) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 256 * 1024) {
    throw new TypeError(code);
  }
  try {
    return parseCanonicalJcs(bytes, { maxBytes: 256 * 1024 });
  } catch {
    throw new TypeError(code);
  }
}

function snapshotArtifactBytes(artifacts) {
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts) ||
      utilTypes.isProxy(artifacts)) {
    throw new TypeError("RELEASE_ARTIFACT_INPUT_INVALID");
  }
  const descriptors = Object.getOwnPropertyDescriptors(artifacts);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string") || keys.length !== 4 ||
      !["authority", "handler", "pin", "release"].every((key) => keys.includes(key))) {
    throw new TypeError("RELEASE_ARTIFACT_INPUT_INVALID");
  }
  const snapshot = {};
  for (const key of ["authority", "handler", "pin", "release"]) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, "value") || descriptor.get !== undefined || descriptor.set !== undefined ||
        !Buffer.isBuffer(descriptor.value)) {
      throw new TypeError("RELEASE_ARTIFACT_INPUT_INVALID");
    }
    snapshot[key] = Buffer.from(descriptor.value);
  }
  return snapshot;
}

function selfHash(value) {
  return sha256Hex(canonicalizeJcs(bodyWithoutSelfHash(value)));
}

export function verifyPosProductListingReleaseArtifacts(artifactInput) {
  const artifacts = snapshotArtifactBytes(artifactInput);
  const authority = parseCanonicalArtifact(artifacts.authority, "AUTHORITY_CANONICAL_JSON_REQUIRED");
  const pin = parseCanonicalArtifact(artifacts.pin, "RELEASE_PIN_JSON_REQUIRED");
  const release = parseCanonicalArtifact(artifacts.release, "RELEASE_CANONICAL_JSON_REQUIRED");
  exactKeys(authority, AUTHORITY_KEYS, "AUTHORITY_SHAPE_MISMATCH");
  exactKeys(pin, RELEASE_PIN_KEYS, "RELEASE_PIN_SHAPE_MISMATCH");
  exactKeys(release, RELEASE_KEYS, "RELEASE_SHAPE_MISMATCH");
  if (!/^[0-9a-f]{64}$/.test(authority.self_sha256) || selfHash(authority) !== authority.self_sha256) {
    throw new TypeError("AUTHORITY_SELF_HASH_MISMATCH");
  }
  if (!canonicalizeJcs(bodyWithoutSelfHash(authority)).equals(canonicalizeJcs(expectedAuthorityBody()))) {
    throw new TypeError("AUTHORITY_SEMANTIC_MISMATCH");
  }
  if (uuidV5(DNS_NAMESPACE, Buffer.from(SOURCE_SYSTEM_NAME, "utf8")) !== SOURCE_SYSTEM_ID ||
      buildListingId("1991027325256417283", "33291") !==
        authority.listing_identity.test_vector.listing_id) {
    throw new TypeError("AUTHORITY_UUID_VECTOR_MISMATCH");
  }
  if (!/^[0-9a-f]{64}$/.test(release.self_sha256) || selfHash(release) !== release.self_sha256) {
    throw new TypeError("RELEASE_SELF_HASH_MISMATCH");
  }
  if (!/^[0-9a-f]{64}$/.test(pin.self_sha256) || selfHash(pin) !== pin.self_sha256) {
    throw new TypeError("RELEASE_PIN_SELF_HASH_MISMATCH");
  }
  if (pin.schema !== RELEASE_PIN_SCHEMA || pin.handler_id !== HANDLER_ID ||
      pin.base_contract_sha256 !== BASE_CONTRACT_SHA256 ||
      pin.external_anchor !== "SOURCE_CONTROL_COMMIT" || pin.signature_status !== "UNSIGNED" ||
      pin.release_file !== RELEASE_FILENAME || pin.release_self_sha256 !== release.self_sha256) {
    throw new TypeError("RELEASE_PIN_SEMANTIC_MISMATCH");
  }
  if (pin.release_file_sha256 !== sha256Hex(artifacts.release)) {
    throw new TypeError("RELEASE_FILE_HASH_MISMATCH");
  }
  if (release.schema !== RELEASE_SCHEMA || release.handler_id !== HANDLER_ID ||
      release.base_contract_sha256 !== BASE_CONTRACT_SHA256 ||
      release.release_status !== RELEASE_STATUS ||
      release.physical_backfill_status !== PHYSICAL_BACKFILL_STATUS ||
      release.target_writer_activation !== TARGET_WRITER_ACTIVATION ||
      release.authority_file !== AUTHORITY_FILENAME || release.handler_file !== HANDLER_FILENAME) {
    throw new TypeError("RELEASE_SEMANTIC_MISMATCH");
  }
  const authorityFileSha256 = sha256Hex(artifacts.authority);
  if (release.authority_file_sha256 !== authorityFileSha256 ||
      release.authority_self_sha256 !== authority.self_sha256) {
    throw new TypeError("AUTHORITY_FILE_HASH_MISMATCH");
  }
  if (release.handler_file_sha256 !== sha256Hex(artifacts.handler)) {
    throw new TypeError("HANDLER_FILE_HASH_MISMATCH");
  }
  return true;
}

function snapshotLoadOptions(options) {
  if (options === undefined) return Object.freeze({ includeArtifactBytes: false });
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      utilTypes.isProxy(options) || Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError("RELEASE_LOAD_OPTIONS_DATA_ONLY_REQUIRED");
  }
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string") || keys.length > 1 ||
      keys.some((key) => key !== "includeArtifactBytes")) {
    throw new TypeError("RELEASE_LOAD_OPTIONS_DATA_ONLY_REQUIRED");
  }
  if (descriptors.includeArtifactBytes &&
      (!Object.hasOwn(descriptors.includeArtifactBytes, "value") ||
       typeof descriptors.includeArtifactBytes.value !== "boolean")) {
    throw new TypeError("RELEASE_LOAD_OPTIONS_DATA_ONLY_REQUIRED");
  }
  return Object.freeze({ includeArtifactBytes: descriptors.includeArtifactBytes?.value ?? false });
}

export function loadPosProductListingRelease(options) {
  const { includeArtifactBytes } = snapshotLoadOptions(options);
  const artifactBytes = {
    authority: readFileSync(new URL(AUTHORITY_FILENAME, HERE)),
    handler: readFileSync(fileURLToPath(import.meta.url)),
    pin: readFileSync(new URL(RELEASE_PIN_FILENAME, HERE)),
    release: readFileSync(new URL(RELEASE_FILENAME, HERE)),
  };
  verifyPosProductListingReleaseArtifacts(artifactBytes);
  const authority = parseCanonicalArtifact(artifactBytes.authority, "AUTHORITY_CANONICAL_JSON_REQUIRED");
  const pin = parseCanonicalArtifact(artifactBytes.pin, "RELEASE_PIN_JSON_REQUIRED");
  const release = parseCanonicalArtifact(artifactBytes.release, "RELEASE_CANONICAL_JSON_REQUIRED");
  const result = {
    authority: deepFreeze(authority),
    pin: deepFreeze(pin),
    release: deepFreeze(release),
  };
  if (includeArtifactBytes) {
    result.artifact_bytes = Object.freeze({
      authority: Buffer.from(artifactBytes.authority),
      handler: Buffer.from(artifactBytes.handler),
      pin: Buffer.from(artifactBytes.pin),
      release: Buffer.from(artifactBytes.release),
    });
  }
  return Object.freeze(result);
}

function frame(value) {
  if (typeof value !== "string") throw new TypeError("LISTING_ID_INPUT_INVALID");
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > 0xffffffff) throw new TypeError("LISTING_ID_INPUT_INVALID");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

export function buildListingId(sourceOrganizationId, sourceItemId) {
  return uuidV5(SOURCE_SYSTEM_ID, Buffer.concat([
    frame(LISTING_DOMAIN),
    frame(sourceOrganizationId),
    frame(sourceItemId),
  ]));
}

function snapshotBatchRows(input) {
  if (!Array.isArray(input) || utilTypes.isProxy(input) ||
      Object.getPrototypeOf(input) !== Array.prototype) {
    throw new TypeError("SOURCE_CONTRACT_BREACH:SOURCE_BATCH_DATA_ONLY_REQUIRED");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    throw new TypeError("SOURCE_CONTRACT_BREACH:SOURCE_BATCH_DATA_ONLY_REQUIRED");
  }
  const length = lengthDescriptor.value;
  if (length > MAX_BATCH_ROWS) {
    throw new TypeError("SOURCE_CONTRACT_BREACH:SOURCE_BATCH_TOO_LARGE");
  }
  const expectedKeys = ["length", ...Array.from({ length }, (_unused, index) => String(index))];
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string") || keys.length !== expectedKeys.length ||
      expectedKeys.some((key) => !keys.includes(key))) {
    throw new TypeError("SOURCE_CONTRACT_BREACH:SOURCE_BATCH_DATA_ONLY_REQUIRED");
  }
  const rows = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!Object.hasOwn(descriptor, "value") || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError("SOURCE_CONTRACT_BREACH:SOURCE_BATCH_DATA_ONLY_REQUIRED");
    }
    rows.push(snapshotRow(descriptor.value));
  }
  const identities = new Set();
  for (const row of rows) {
    if (identities.has(row.item_key)) {
      throw new TypeError("SOURCE_CONTRACT_BREACH:SOURCE_PRIMARY_KEY_DUPLICATE");
    }
    identities.add(row.item_key);
  }
  return rows;
}

function snapshotRow(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      utilTypes.isProxy(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new TypeError("SOURCE_CONTRACT_BREACH:SOURCE_ROW_DATA_ONLY_REQUIRED");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  const expected = SOURCE_FIELDS.map((field) => field.name);
  if (keys.some((key) => typeof key !== "string") || keys.length !== expected.length ||
      expected.some((key) => !keys.includes(key))) {
    throw new TypeError("SOURCE_CONTRACT_BREACH:SOURCE_ROW_SHAPE_MISMATCH");
  }
  const row = Object.create(null);
  for (const field of SOURCE_FIELDS) {
    const descriptor = descriptors[field.name];
    if (!Object.hasOwn(descriptor, "value") || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError("SOURCE_CONTRACT_BREACH:SOURCE_ROW_DATA_ONLY_REQUIRED");
    }
    const raw = descriptor.value;
    if (!(raw === null || typeof raw === "string")) {
      throw new TypeError(`SOURCE_CONTRACT_BREACH:SOURCE_WIRE_VALUE_INVALID:${field.name}`);
    }
    if (raw === null && !field.nullable) {
      throw new TypeError(`SOURCE_CONTRACT_BREACH:SOURCE_NOT_NULL_VIOLATION:${field.name}`);
    }
    if (typeof raw === "string" && raw.includes("\0")) {
      throw new TypeError(`SOURCE_CONTRACT_BREACH:SOURCE_WIRE_VALUE_INVALID:${field.name}`);
    }
    row[field.name] = raw;
  }
  canonicalizeJcs(row);
  return Object.freeze(row);
}

function validCanonicalSignedSmallint(raw) {
  if (raw === "0") return true;
  const match = /^(-?)([1-9][0-9]*)$/.exec(raw);
  if (!match) return false;
  const negative = match[1] === "-";
  const magnitude = match[2];
  const limit = negative ? "32768" : "32767";
  return magnitude.length < limit.length ||
    (magnitude.length === limit.length && magnitude <= limit);
}

function validNonnegativeDecimal(raw, precision, scale) {
  if (raw === null) return true;
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(raw);
  if (!match) return false;
  const fraction = match[2] ?? "";
  const integerDigits = match[1].length;
  return integerDigits <= precision - scale &&
    fraction.length <= scale &&
    integerDigits + fraction.length <= precision;
}

function parseTimestamp(raw) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2})(?::?(\d{2}))?)$/.exec(raw);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map((value) => BigInt(value));
  const fraction = BigInt((match[7] ?? "").padEnd(6, "0"));
  const zone = match[8];
  const offsetHour = zone === "Z" ? 0n : BigInt(match[10]);
  const offsetMinute = zone === "Z" ? 0n : BigInt(match[11] ?? "0");
  if (year < 1n || month < 1n || month > 12n || hour > 23n || minute > 59n || second > 59n ||
      offsetHour > 15n || offsetMinute > 59n) return null;
  const leap = year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
  const monthLengths = new Map([
    [1n, 31n], [2n, leap ? 29n : 28n], [3n, 31n], [4n, 30n], [5n, 31n], [6n, 30n],
    [7n, 31n], [8n, 31n], [9n, 30n], [10n, 31n], [11n, 30n], [12n, 31n],
  ]);
  if (day < 1n || day > monthLengths.get(month)) return null;
  const adjustedYear = month <= 2n ? year - 1n : year;
  const era = adjustedYear / 400n;
  const yearOfEra = adjustedYear - era * 400n;
  const adjustedMonth = month + (month > 2n ? -3n : 9n);
  const dayOfYear = (153n * adjustedMonth + 2n) / 5n + day - 1n;
  const dayOfEra = yearOfEra * 365n + yearOfEra / 4n - yearOfEra / 100n + dayOfYear;
  const days = era * 146097n + dayOfEra - 719468n;
  const offset = (offsetHour * 60n + offsetMinute) * 60n * (match[9] === "-" ? -1n : 1n);
  return ((days * 86400n + hour * 3600n + minute * 60n + second - offset) * 1000000n) + fraction;
}

function rowReasons(row) {
  const reasons = new Set();
  if (!validCanonicalSignedSmallint(row.org_type)) {
    reasons.add("SOURCE_ORGANIZATION_TYPE_INVALID");
  }
  if (row.org_id.length === 0 || row.org_id.trim() !== row.org_id ||
      row.item_id.length === 0 || row.item_id.trim() !== row.item_id) {
    reasons.add("SOURCE_IDENTITY_COMPONENT_INVALID");
  }
  const expectedItemKey = `${row.org_id}-${row.org_type}-${row.item_id}`;
  if (row.item_key !== expectedItemKey) reasons.add("SOURCE_ITEM_KEY_COMPONENT_MISMATCH");
  if (row.name_en.length === 0 || row.name_en.trim() !== row.name_en) {
    reasons.add("SOURCE_NAME_INVALID");
  }
  if (!validNonnegativeDecimal(row.sales_price, 12, 4) ||
      !validNonnegativeDecimal(row.res_total_cost, 14, 6) ||
      !validNonnegativeDecimal(row.res_theoretical_cost, 14, 6)) {
    reasons.add("SOURCE_NUMERIC_INVALID");
  }
  if (!["t", "f"].includes(row.has_cost_card)) {
    reasons.add("SOURCE_BOOLEAN_INVALID");
  } else if (row.has_cost_card === "t" &&
      (row.res_cost_card_id === null || row.res_cost_card_id.trim().length === 0)) {
    reasons.add("SOURCE_COST_CARD_INVARIANT");
  }
  if (row.res_status !== "1") reasons.add("SOURCE_STATUS_UNMAPPED");
  if (!APPROVED_ORGANIZATIONS.includes(row.org_id)) {
    reasons.add("SOURCE_ORGANIZATION_NOT_APPROVED");
  }
  const first = parseTimestamp(row.first_seen_at);
  const last = parseTimestamp(row.synced_at);
  if (first === null || last === null) {
    reasons.add("SOURCE_TIMESTAMP_INVALID");
  } else if (first > last) {
    reasons.add("SOURCE_TIMESTAMP_ORDER_INVALID");
  }
  return reasons;
}

function addGroupCollisionReasons(rows, reasonsByItemKey) {
  const targetIdentityGroups = new Map();
  const listingIdGroups = new Map();
  for (const row of rows) {
    const identity = `${row.org_id.length}:${row.org_id}${row.item_id.length}:${row.item_id}`;
    if (!targetIdentityGroups.has(identity)) targetIdentityGroups.set(identity, []);
    targetIdentityGroups.get(identity).push(row.item_key);
    const listingId = buildListingId(row.org_id, row.item_id);
    if (!listingIdGroups.has(listingId)) listingIdGroups.set(listingId, []);
    listingIdGroups.get(listingId).push(row.item_key);
  }
  for (const itemKeys of targetIdentityGroups.values()) {
    if (itemKeys.length > 1) {
      for (const itemKey of itemKeys) reasonsByItemKey.get(itemKey).add("TARGET_IDENTITY_GROUP_COLLISION");
    }
  }
  for (const itemKeys of listingIdGroups.values()) {
    if (itemKeys.length > 1 && new Set(itemKeys).size > 1) {
      for (const itemKey of itemKeys) reasonsByItemKey.get(itemKey).add("TARGET_LISTING_ID_COLLISION");
    }
  }
}

function wireValue(column, pgType, raw) {
  return Object.freeze({ column, kind: raw === null ? "NULL" : "WIRE_TEXT", pg_type: pgType, raw });
}

function opcodeValue(column, pgType) {
  return Object.freeze({ column, kind: "OPCODE", pg_type: pgType, raw: TRANSACTION_TIMESTAMP_OPCODE });
}

function seedIntent(authority) {
  const source = authority.source_system;
  return Object.freeze({
    operation: "ENSURE_EXACT",
    relation: "app_source_system",
    values: Object.freeze([
      wireValue("source_system_id", "uuid", source.source_system_id),
      wireValue("source_code", "text", source.source_code),
      wireValue("source_name", "text", source.source_name),
      wireValue("source_type", "text", source.source_type),
      wireValue("owner_project", "text", source.owner_project),
      wireValue("authoritative_scope", "text", source.authoritative_scope),
      wireValue("status", "text", source.status),
      opcodeValue("created_at", "timestamptz"),
      opcodeValue("updated_at", "timestamptz"),
    ]),
  });
}

function mappedRaw(mapping, row, authority) {
  switch (mapping.transform) {
    case "COPY_WIRE": return row[mapping.source_field];
    case "DERIVE_LISTING_UUID_V5": return buildListingId(row.org_id, row.item_id);
    case "CONSTANT_SOURCE_SYSTEM_ID": return authority.source_system.source_system_id;
    case "CONSTANT_NULL": return null;
    case "CONSTANT_CURRENCY": return authority.currency;
    case "BOOLEAN_WIRE_TO_TARGET": return row.has_cost_card === "t" ? "true" : "false";
    case "STATUS_ONE_TO_TRUE": return "true";
    default: throw new TypeError("AUTHORITY_TRANSFORM_UNSUPPORTED");
  }
}

function listingTargetIntent(row, authority) {
  return Object.freeze({
    operation: "ENSURE_EXACT",
    relation: "pos_product_listing",
    values: Object.freeze(authority.field_mappings.map((mapping) =>
      mapping.transform === "TARGET_TRANSACTION_TIMESTAMP"
        ? opcodeValue(mapping.target_column, mapping.target_type)
        : wireValue(mapping.target_column, mapping.target_type, mappedRaw(mapping, row, authority))
    )),
  });
}

function payloadSha256(row) {
  return sha256Hex(canonicalizeTypedRow("pos_product", SOURCE_FIELDS.map((field) => ({
    name: field.name,
    pg_type: field.data_type,
    raw: row[field.name],
  }))));
}

function sortedReasons(reasons) {
  return [...reasons].sort((left, right) => REASON_ORDER.indexOf(left) - REASON_ORDER.indexOf(right));
}

function targetIntentRoot(seed, routes) {
  return sha256Hex(canonicalizeJcs({
    listing_intents: routes.flatMap((route) => route.target_intents),
    seed_intent: seed,
  }));
}

function outputBody(output) {
  const body = { ...output };
  delete body.canonical_root_sha256;
  return body;
}

function snapshotOutputData(value, seen = new Set(), depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError("BATCH_OUTPUT_DATA_ONLY_REQUIRED");
    }
    return value;
  }
  if (!value || typeof value !== "object" || utilTypes.isProxy(value) || Buffer.isBuffer(value) ||
      utilTypes.isDate(value) || depth > 128 || seen.has(value)) {
    throw new TypeError("BATCH_OUTPUT_DATA_ONLY_REQUIRED");
  }

  seen.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) {
      throw new TypeError("BATCH_OUTPUT_DATA_ONLY_REQUIRED");
    }

    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError("BATCH_OUTPUT_DATA_ONLY_REQUIRED");
      }
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
          lengthDescriptor.value > MAX_BATCH_ROWS || keys.length !== lengthDescriptor.value + 1) {
        throw new TypeError("BATCH_OUTPUT_DATA_ONLY_REQUIRED");
      }
      const snapshot = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.get !== undefined ||
            descriptor.set !== undefined || descriptor.enumerable !== true) {
          throw new TypeError("BATCH_OUTPUT_DATA_ONLY_REQUIRED");
        }
        snapshot.push(snapshotOutputData(descriptor.value, seen, depth + 1));
      }
      return Object.freeze(snapshot);
    }

    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError("BATCH_OUTPUT_DATA_ONLY_REQUIRED");
    }
    const snapshot = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, "value") || descriptor.get !== undefined ||
          descriptor.set !== undefined || descriptor.enumerable !== true) {
        throw new TypeError("BATCH_OUTPUT_DATA_ONLY_REQUIRED");
      }
      snapshot[key] = snapshotOutputData(descriptor.value, seen, depth + 1);
    }
    return Object.freeze(snapshot);
  } finally {
    seen.delete(value);
  }
}

function snapshotBatchOutput(output) {
  return snapshotOutputData(output);
}

function assertOutputTopShape(output) {
  exactKeys(output, OUTPUT_KEYS, "BATCH_SHAPE_MISMATCH");
}

export function recomputePosProductListingBatchRoot(output) {
  const snapshot = snapshotBatchOutput(output);
  assertOutputTopShape(snapshot);
  return sha256Hex(canonicalizeJcs(outputBody(snapshot)));
}

function buildPosProductListingBatch(snapshottedRows, loaded) {
  const rows = [...snapshottedRows].sort((left, right) => compare(left.item_key, right.item_key));
  const reasonsByItemKey = new Map(rows.map((row) => [row.item_key, rowReasons(row)]));
  addGroupCollisionReasons(rows, reasonsByItemKey);
  const routes = rows.map((row) => {
    const reasons = sortedReasons(reasonsByItemKey.get(row.item_key));
    if (reasons.length > 0) {
      return Object.freeze({
        blocking_scope: "PHYSICAL_BACKFILL",
        outcome: "QUARANTINE",
        reason_codes: Object.freeze(reasons),
        source_item_key: row.item_key,
        source_payload_sha256: payloadSha256(row),
        target_intents: Object.freeze([]),
      });
    }
    return Object.freeze({
      blocking_scope: "DOWNSTREAM_LOCATION_ACTIVATION",
      outcome: "TARGET",
      reason_codes: Object.freeze(["UNRESOLVED_SOURCE_ORGANIZATION"]),
      source_item_key: row.item_key,
      source_payload_sha256: payloadSha256(row),
      target_intents: Object.freeze([listingTargetIntent(row, loaded.authority)]),
    });
  });
  const frozenRoutes = Object.freeze(routes);
  const seed = seedIntent(loaded.authority);
  const targetCount = routes.filter((route) => route.outcome === "TARGET").length;
  const partial = {
    authority_file_sha256: loaded.release.authority_file_sha256,
    base_contract_sha256: BASE_CONTRACT_SHA256,
    counts: {
      QUARANTINE: routes.length - targetCount,
      TARGET: targetCount,
    },
    handler_file_sha256: loaded.release.handler_file_sha256,
    handler_id: HANDLER_ID,
    physical_backfill_status: PHYSICAL_BACKFILL_STATUS,
    release_self_sha256: loaded.release.self_sha256,
    release_file_sha256: loaded.pin.release_file_sha256,
    release_pin_self_sha256: loaded.pin.self_sha256,
    release_status: RELEASE_STATUS,
    route_root_sha256: sha256Hex(canonicalizeJcs(routes)),
    routes: frozenRoutes,
    schema: OUTPUT_SCHEMA,
    seed_intent: seed,
    source_occurrences: routes.length,
    target_intent_root_sha256: targetIntentRoot(seed, routes),
    target_writer_activation: TARGET_WRITER_ACTIVATION,
  };
  const output = {
    ...partial,
    canonical_root_sha256: sha256Hex(canonicalizeJcs(partial)),
  };
  return deepFreeze(output);
}

export function verifyPosProductListingBatch(inputRows, output) {
  const rows = snapshotBatchRows(inputRows);
  const outputSnapshot = snapshotBatchOutput(output);
  const expected = buildPosProductListingBatch(rows, loadPosProductListingRelease());
  if (!canonicalizeJcs(outputSnapshot).equals(canonicalizeJcs(expected))) {
    throw new TypeError("BATCH_OUTPUT_MISMATCH");
  }
  return true;
}

export function transformPosProductListingBatch(inputRows) {
  const rows = snapshotBatchRows(inputRows);
  return buildPosProductListingBatch(rows, loadPosProductListingRelease());
}
