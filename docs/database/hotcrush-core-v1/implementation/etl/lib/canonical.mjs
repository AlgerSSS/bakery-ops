import { createHash } from "node:crypto";

const TYPED_SCHEMA = "hotcrush.typed-jcs.v1";

function assertUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("lone_surrogate");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("lone_surrogate");
    }
  }
}

function serialize(value, seen) {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new TypeError("unsupported_jcs_value");
    }
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value !== "object" || value instanceof Date || Buffer.isBuffer(value)) {
    throw new TypeError("unsupported_jcs_value");
  }
  if (seen.has(value)) throw new TypeError("unsupported_jcs_value");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError("unsupported_jcs_value");
      }
      return `[${value.map((entry) => serialize(entry, seen)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("unsupported_jcs_value");
    }
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      assertUnicodeScalarString(key);
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        throw new TypeError("unsupported_jcs_value");
      }
      if (value[key] === undefined || typeof value[key] === "bigint") {
        throw new TypeError("unsupported_jcs_value");
      }
    }
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key], seen)}`).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalizeJcs(value) {
  return Buffer.from(serialize(value, new Set()), "utf8");
}

export function parseCanonicalJcs(bytes, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const input = Buffer.from(bytes);
  if (input.length === 0 || input.length > maxBytes) throw new TypeError("invalid_canonical_jcs");
  let parsed;
  try {
    parsed = JSON.parse(input.toString("utf8"));
  } catch {
    throw new TypeError("invalid_canonical_jcs");
  }
  const canonical = canonicalizeJcs(parsed);
  if (!canonical.equals(input)) throw new TypeError("noncanonical_jcs");
  return parsed;
}

export function canonicalizeTypedRow(tableName, fields) {
  if (typeof tableName !== "string" || !Array.isArray(fields)) {
    throw new TypeError("invalid_typed_row");
  }
  const names = new Set();
  const values = fields.map((field) => {
    if (
      field === null || typeof field !== "object" ||
      typeof field.name !== "string" || typeof field.pg_type !== "string" ||
      !(field.raw === null || typeof field.raw === "string") || names.has(field.name)
    ) {
      throw new TypeError("invalid_typed_row");
    }
    names.add(field.name);
    return { name: field.name, pg_type: field.pg_type, raw: field.raw };
  });
  return canonicalizeJcs({ schema: TYPED_SCHEMA, table: tableName, values });
}

export function typedRowFromContract(table, row) {
  if (!table || !Array.isArray(table.fields) || row === null || typeof row !== "object") {
    throw new TypeError("invalid_source_row");
  }
  const expected = new Set(table.fields.map((field) => field.name));
  const actual = Object.keys(row);
  if (actual.length !== expected.size || actual.some((name) => !expected.has(name))) {
    throw new TypeError("source_row_shape_mismatch");
  }
  return canonicalizeTypedRow(table.name, table.fields.map((field) => {
    const raw = row[field.name];
    if (!(raw === null || typeof raw === "string")) throw new TypeError("source_value_not_wire_text");
    if (raw === null && !field.nullable) throw new TypeError("source_not_null_violation");
    return { name: field.name, pg_type: field.data_type, raw };
  }));
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export { TYPED_SCHEMA };
