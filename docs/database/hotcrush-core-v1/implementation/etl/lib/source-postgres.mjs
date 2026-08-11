import { execFile as nodeExecFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { createRequire } from "node:module";

import { canonicalizeJcs, sha256Hex } from "./canonical.mjs";
import { validateMigrationContract } from "./contract.mjs";

const SOURCE_PROJECT_REF = "ecsgqcmwtjmcpzqytdqw";
const SOURCE_SCHEMA = "public";
const SOURCE_CURSOR_BATCH_SIZE = 128;
const SOURCE_CAPTURE_INCIDENT_BOUNDARY = "2026-08-11T02:19:36.332094Z";
const SUPABASE_ROOT_CA_2021_FINGERPRINT =
  "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";
// Public Supabase Root 2021 CA, frozen and fingerprint-checked before each connection.
const SUPABASE_ROOT_CA_2021 = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;
const SOURCE_DSN_KEYCHAIN = Object.freeze({
  account: "hotcrush-r6-migration",
  service: `com.hotcrush.r6-migration.source.${SOURCE_PROJECT_REF}.dsn.v1`,
});
const CONNECTOR_OPTIONS = Object.freeze({
  maxConnections: 1,
  sourceProjectRef: SOURCE_PROJECT_REF,
  tlsMode: "verify-full",
});
const TRANSACTION_OPTIONS = Object.freeze({
  deferrable: true,
  isolationLevel: "SERIALIZABLE",
  readOnly: true,
});
const SESSION_STATEMENTS = Object.freeze([
  Object.freeze(["DateStyle", "ISO, YMD", "SET LOCAL \"DateStyle\" = 'ISO, YMD'"]),
  Object.freeze(["IntervalStyle", "iso_8601", "SET LOCAL \"IntervalStyle\" = 'iso_8601'"]),
  Object.freeze(["TimeZone", "UTC", "SET LOCAL \"TimeZone\" = 'UTC'"]),
  Object.freeze(["bytea_output", "hex", "SET LOCAL \"bytea_output\" = 'hex'"]),
  Object.freeze(["extra_float_digits", "3", "SET LOCAL \"extra_float_digits\" = '3'"]),
]);
const CATALOG_SQL = `SELECT
  c.relname::text AS object_name,
  c.relkind::text AS relkind,
  a.attnum::text AS ordinal,
  a.attname::text AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  CASE WHEN a.attnotnull THEN 'f' ELSE 't' END AS nullable
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid
WHERE n.nspname = $1
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY c.relkind, c.relname, a.attnum`;
const CONSTRAINT_SQL = `SELECT
  c.relname::text AS table_name,
  con.conname::text AS constraint_name,
  con.contype::text AS constraint_type,
  key_column.ordinality::text AS ordinal,
  a.attname::text AS column_name,
  CASE WHEN con.convalidated THEN 't' ELSE 'f' END AS validated,
  CASE WHEN con.condeferrable THEN 't' ELSE 'f' END AS deferrable,
  CASE WHEN con.condeferred THEN 't' ELSE 'f' END AS initially_deferred,
  CASE WHEN i.indpred IS NULL AND i.indexprs IS NULL AND i.indisvalid AND i.indisready AND i.indislive
    THEN 'f' ELSE 't' END AS invalid_or_partial
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_index AS i ON i.indexrelid = con.conindid
JOIN LATERAL pg_catalog.unnest(con.conkey) WITH ORDINALITY AS key_column(attnum, ordinality) ON true
JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid AND a.attnum = key_column.attnum
WHERE n.nspname = $1
  AND con.contype IN ('p', 'u')
ORDER BY c.relname, con.conname, key_column.ordinality`;
const VIEW_DEFINITION_SQL = `SELECT
  c.relname::text AS view_name,
  pg_catalog.pg_get_viewdef(c.oid, true)::text AS definition
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND c.relkind = 'v'
ORDER BY c.relname`;
const RUNTIME_SQL = `SELECT
  pg_catalog.current_setting('server_version') AS server_version,
  pg_catalog.current_setting('transaction_isolation') AS isolation_level,
  pg_catalog.current_setting('transaction_read_only') AS read_only,
  pg_catalog.current_setting('transaction_deferrable') AS deferrable,
  pg_catalog.current_setting('DateStyle') AS date_style,
  pg_catalog.current_setting('IntervalStyle') AS interval_style,
  pg_catalog.current_setting('TimeZone') AS time_zone,
  pg_catalog.current_setting('bytea_output') AS bytea_output,
  pg_catalog.current_setting('extra_float_digits') AS extra_float_digits,
  pg_catalog.pg_current_wal_lsn()::text AS source_wal_lsn,
  pg_catalog.to_char(
    pg_catalog.transaction_timestamp(),
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  ) AS source_transaction_timestamp,
  pg_catalog.pg_current_snapshot()::text AS source_mvcc_snapshot,
  pg_catalog.current_database()::text AS source_database,
  CASE WHEN pg_catalog.pg_is_in_recovery() THEN 't' ELSE 'f' END
    AS source_is_in_recovery`;

function quoteIdentifier(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError("invalid_source_identifier");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCatalog(left, right) {
  return compare(left.relkind, right.relkind) ||
    compare(left.object_name, right.object_name) ||
    left.ordinal - right.ordinal;
}

function compareConstraint(left, right) {
  return compare(left.table_name, right.table_name) ||
    compare(left.constraint_name, right.constraint_name) ||
    left.ordinal - right.ordinal;
}

function exactObjectKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(code);
  }
}

function rawText(value, code) {
  if (!Buffer.isBuffer(value)) throw new TypeError(code);
  const text = value.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(value) || text.includes("\0")) throw new TypeError(code);
  return text;
}

function rawRow(row, length, code) {
  if (!Array.isArray(row) || row.length !== length) throw new TypeError(code);
  return row.map((value) => rawText(value, code));
}

function contractHash(contract) {
  return sha256Hex(canonicalizeJcs(contract));
}

function expectedCatalog(contract) {
  return [
    ...contract.source_tables.flatMap((table) => table.fields.map((field) => ({
      column_name: field.name,
      data_type: field.data_type,
      nullable: field.nullable,
      object_name: table.name,
      ordinal: field.ordinal,
      relkind: "r",
    }))),
    ...contract.registered_views.flatMap((view) => view.fields.map((field) => ({
      column_name: field.name,
      data_type: field.data_type,
      nullable: field.nullable,
      object_name: view.name,
      ordinal: field.ordinal,
      relkind: "v",
    }))),
  ].sort(compareCatalog);
}

function normalizeCatalogRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError("source_catalog_drift");
  return rows.map((row) => {
    const [objectName, relkind, ordinalText, columnName, dataType, nullableText] =
      rawRow(row, 6, "source_catalog_drift");
    if (!/^[1-9][0-9]*$/.test(ordinalText) || !["r", "p", "v", "m", "f"].includes(relkind) ||
        !["t", "f"].includes(nullableText)) {
      throw new TypeError("source_catalog_drift");
    }
    const ordinal = Number(ordinalText);
    if (!Number.isSafeInteger(ordinal)) throw new TypeError("source_catalog_drift");
    return {
      column_name: columnName,
      data_type: dataType,
      nullable: nullableText === "t",
      object_name: objectName,
      ordinal,
      relkind,
    };
  }).sort(compareCatalog);
}

function validateCatalog(contract, rows) {
  const actual = normalizeCatalogRows(rows);
  const expected = expectedCatalog(contract);
  if (!canonicalizeJcs(actual).equals(canonicalizeJcs(expected))) {
    throw new TypeError("source_catalog_drift");
  }
  const tableNames = new Set(actual.filter((entry) => entry.relkind === "r").map((entry) => entry.object_name));
  const tableFields = actual.filter((entry) => entry.relkind === "r").length;
  const viewNames = new Set(actual.filter((entry) => entry.relkind === "v").map((entry) => entry.object_name));
  if (tableNames.size !== 76 || tableFields !== 759 || viewNames.size !== 21 ||
      actual.some((entry) => !["r", "v"].includes(entry.relkind)) ||
      contract.registered_views.some((view) => view.export !== false)) {
    throw new TypeError("source_catalog_drift");
  }
  return actual;
}

function expectedConstraints(contract) {
  return contract.source_tables.flatMap((table) => {
    const constraints = [
      ...(table.identity.mode === "PRIMARY_KEY" ? [{
        columns: table.identity.columns,
        constraint_name: table.identity.constraint_name,
        constraint_type: "p",
      }] : []),
      ...table.observed_unique_constraints.map((unique) => ({
        ...unique,
        constraint_type: "u",
      })),
    ];
    return constraints.flatMap((constraint) => constraint.columns.map((columnName, index) => ({
      column_name: columnName,
      constraint_name: constraint.constraint_name,
      constraint_type: constraint.constraint_type,
      ordinal: index + 1,
      table_name: table.name,
    })));
  }).sort(compareConstraint);
}

function validateConstraints(contract, rows) {
  if (!Array.isArray(rows)) throw new TypeError("source_constraint_drift");
  const actual = rows.map((row) => {
    const [
      tableName,
      constraintName,
      constraintType,
      ordinalText,
      columnName,
      validated,
      deferrable,
      initiallyDeferred,
      invalidOrPartial,
    ] = rawRow(row, 9, "source_constraint_drift");
    if (!/^[1-9][0-9]*$/.test(ordinalText) || !["p", "u"].includes(constraintType) ||
        validated !== "t" || deferrable !== "f" || initiallyDeferred !== "f" ||
        invalidOrPartial !== "f") {
      throw new TypeError("source_constraint_drift");
    }
    const ordinal = Number(ordinalText);
    if (!Number.isSafeInteger(ordinal)) throw new TypeError("source_constraint_drift");
    return {
      column_name: columnName,
      constraint_name: constraintName,
      constraint_type: constraintType,
      ordinal,
      table_name: tableName,
    };
  }).sort(compareConstraint);
  if (!canonicalizeJcs(actual).equals(canonicalizeJcs(expectedConstraints(contract)))) {
    throw new TypeError("source_constraint_drift");
  }
  return actual;
}

function validateViewDefinitions(contract, rows) {
  if (!Array.isArray(rows)) throw new TypeError("source_view_definition_drift");
  const actual = rows.map((row) => {
    const [name, definition] = rawRow(row, 2, "source_view_definition_drift");
    return {
      definition_sha256: sha256Hex(Buffer.from(definition, "utf8")),
      name,
    };
  }).sort((left, right) => compare(left.name, right.name));
  const expected = contract.registered_views.map((view) => ({
    definition_sha256: view.definition_sha256,
    name: view.name,
  })).sort((left, right) => compare(left.name, right.name));
  if (actual.length !== 21 || !canonicalizeJcs(actual).equals(canonicalizeJcs(expected))) {
    throw new TypeError("source_view_definition_drift");
  }
  return actual;
}

export function validateSourceMvccSnapshot(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 * 1024) {
    throw new TypeError("source_runtime_drift");
  }
  const parts = value.split(":");
  if (parts.length !== 3) throw new TypeError("source_runtime_drift");
  const canonicalXid = /^(?:0|[1-9][0-9]*)$/;
  if (!canonicalXid.test(parts[0]) || !canonicalXid.test(parts[1])) {
    throw new TypeError("source_runtime_drift");
  }
  const xipTokens = parts[2] === "" ? [] : parts[2].split(",");
  if (xipTokens.length > 100_000 || xipTokens.some((token) => !canonicalXid.test(token))) {
    throw new TypeError("source_runtime_drift");
  }
  try {
    const maxXid = (1n << 64n) - 1n;
    const xmin = BigInt(parts[0]);
    const xmax = BigInt(parts[1]);
    const xip = xipTokens.map((token) => BigInt(token));
    if (xmin > maxXid || xmax > maxXid || xmin > xmax ||
        xip.some((xid, index) => xid > maxXid || xid < xmin || xid >= xmax ||
          (index > 0 && xid <= xip[index - 1]))) {
      throw new TypeError("source_runtime_drift");
    }
  } catch {
    throw new TypeError("source_runtime_drift");
  }
  return value;
}

function validateRuntime(contract, rows) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new TypeError("source_runtime_drift");
  const values = rawRow(rows[0], 14, "source_runtime_drift");
  const [
    serverVersion,
    isolationLevel,
    readOnly,
    deferrable,
    dateStyle,
    intervalStyle,
    timeZone,
    byteaOutput,
    extraFloatDigits,
    sourceWalLsn,
    sourceTransactionTimestamp,
    sourceMvccSnapshot,
    sourceDatabase,
    sourceIsInRecovery,
  ] = values;
  const expectedSettings = contract.source_capture_contract.session_settings;
  if (serverVersion !== contract.source_capture_contract.expected_postgresql_version ||
      isolationLevel !== "serializable" || readOnly !== "on" || deferrable !== "on" ||
      dateStyle !== expectedSettings.DateStyle || intervalStyle !== expectedSettings.IntervalStyle ||
      timeZone !== expectedSettings.TimeZone || byteaOutput !== expectedSettings.bytea_output ||
      extraFloatDigits !== expectedSettings.extra_float_digits ||
      sourceDatabase !== "postgres" || sourceIsInRecovery !== "f" ||
      !/^[0-9A-F]+\/[0-9A-F]+$/.test(sourceWalLsn) ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/.test(
        sourceTransactionTimestamp,
      )) {
    throw new TypeError("source_runtime_drift");
  }
  if (sourceTransactionTimestamp <= SOURCE_CAPTURE_INCIDENT_BOUNDARY) {
    throw new TypeError("source_capture_predates_incident_boundary");
  }
  validateSourceMvccSnapshot(sourceMvccSnapshot);
  return Object.freeze({
    server_version: serverVersion,
    session_settings: Object.freeze({
      DateStyle: dateStyle,
      IntervalStyle: intervalStyle,
      TimeZone: timeZone,
      bytea_output: byteaOutput,
      extra_float_digits: extraFloatDigits,
    }),
    source_watermark: Object.freeze({
      source_transaction_timestamp: sourceTransactionTimestamp,
      wal_lsn: sourceWalLsn,
    }),
    source_mvcc_snapshot: sourceMvccSnapshot,
    source_database: sourceDatabase,
    source_is_in_recovery: false,
  });
}

function lockStatement(contract) {
  const relations = contract.source_capture_contract.lock_order.map((tableName) =>
    `${quoteIdentifier(SOURCE_SCHEMA)}.${quoteIdentifier(tableName)}`
  );
  return `LOCK TABLE ${relations.join(", ")} IN ACCESS SHARE MODE`;
}

function tableSelect(table) {
  const projected = table.fields.map((field) => quoteIdentifier(field.name));
  const orderFields = table.identity.mode === "FULL_ROW_MULTISET"
    ? table.fields.map((field) => field.name)
    : table.identity.columns;
  if (projected.length === 0 || orderFields.length === 0) {
    throw new TypeError("source_projection_contract_invalid");
  }
  const ordered = orderFields.map((field) => `${quoteIdentifier(field)} ASC NULLS FIRST`);
  return `SELECT ${projected.join(", ")}\n` +
    `FROM ${quoteIdentifier(SOURCE_SCHEMA)}.${quoteIdentifier(table.name)}\n` +
    `ORDER BY ${ordered.join(", ")}`;
}

function checkedRawRows(stream, expectedColumns, completion) {
  return (async function* rows() {
    for await (const batch of stream) {
      if (!Array.isArray(batch)) throw new TypeError("source_cursor_batch_invalid");
      for (const row of batch) {
        if (!Array.isArray(row) || row.length !== expectedColumns ||
            row.some((value) => value !== null && !Buffer.isBuffer(value))) {
          throw new TypeError("source_cursor_row_invalid");
        }
        yield row;
      }
    }
    completion.done = true;
  }());
}

export async function captureSourceSnapshot({
  contract,
  createConnector,
  onTable,
}) {
  validateMigrationContract(contract);
  if (typeof createConnector !== "function" || typeof onTable !== "function") {
    throw new TypeError("source_capture_callback_required");
  }
  const captureContract = contract.source_capture_contract;
  if (captureContract.source_project_ref !== SOURCE_PROJECT_REF ||
      captureContract.tls_mode !== "verify-full" ||
      captureContract.expected_postgresql_version !== "17.6" ||
      captureContract.isolation_level !== "SERIALIZABLE" ||
      captureContract.read_only !== true || captureContract.transaction_deferrable !== true ||
      captureContract.lock_mode !== "ACCESS SHARE" || captureContract.forbid_view_queries !== true ||
      captureContract.writes_to_source !== false || captureContract.lock_order.length !== 76) {
    throw new TypeError("source_capture_contract_drift");
  }
  let connector;
  let operationError;
  let result;
  try {
    connector = await createConnector({ ...CONNECTOR_OPTIONS });
    if (!connector || typeof connector.transactionScope !== "function" ||
        typeof connector.close !== "function") {
      throw new TypeError("invalid_source_connector");
    }
    result = await connector.transactionScope({ ...TRANSACTION_OPTIONS }, async (transaction) => {
      if (!transaction || typeof transaction.query !== "function" || typeof transaction.stream !== "function") {
        throw new TypeError("invalid_source_transaction");
      }
      for (const [name, expected, sql] of SESSION_STATEMENTS) {
        if (captureContract.session_settings[name] !== expected) {
          throw new TypeError("source_capture_contract_drift");
        }
        await transaction.query(sql, []);
      }
      await transaction.query(lockStatement(contract), []);
      const catalog = validateCatalog(
        contract,
        await transaction.query(CATALOG_SQL, [SOURCE_SCHEMA]),
      );
      const constraints = validateConstraints(
        contract,
        await transaction.query(CONSTRAINT_SQL, [SOURCE_SCHEMA]),
      );
      const viewDefinitions = validateViewDefinitions(
        contract,
        await transaction.query(VIEW_DEFINITION_SQL, [SOURCE_SCHEMA]),
      );
      const runtime = validateRuntime(contract, await transaction.query(RUNTIME_SQL, []));
      const logicalContractHash = contractHash(contract);
      const catalogSha256 = sha256Hex(canonicalizeJcs({
        columns: catalog,
        constraints,
        view_definitions: viewDefinitions,
      }));
      const snapshotDescriptor = {
        catalog_sha256: catalogSha256,
        contract_sha256: logicalContractHash,
        deferrable: true,
        isolation_level: "SERIALIZABLE",
        read_only: true,
        server_version: runtime.server_version,
        session_settings: runtime.session_settings,
        source_database: runtime.source_database,
        source_is_in_recovery: runtime.source_is_in_recovery,
        source_mvcc_snapshot: runtime.source_mvcc_snapshot,
        source_project_ref: SOURCE_PROJECT_REF,
        source_watermark: runtime.source_watermark,
      };
      const snapshotSha256 = sha256Hex(canonicalizeJcs(snapshotDescriptor));
      const tableResults = [];
      for (const table of contract.source_tables) {
        const completion = { done: false };
        const sourceRows = transaction.stream(tableSelect(table), [], SOURCE_CURSOR_BATCH_SIZE);
        const rows = checkedRawRows(sourceRows, table.fields.length, completion);
        const tableResult = await onTable(Object.freeze({
          contractSha256: logicalContractHash,
          rows,
          snapshotSha256,
          table,
          watermark: runtime.source_watermark,
        }));
        if (!completion.done) throw new Error("source_cursor_not_fully_consumed");
        tableResults.push(tableResult);
      }
      return Object.freeze({
        catalogSha256,
        contractSha256: logicalContractHash,
        sourceDatabase: runtime.source_database,
        sourceIsInRecovery: runtime.source_is_in_recovery,
        mvccSnapshot: runtime.source_mvcc_snapshot,
        snapshotSha256,
        tableResults: Object.freeze(tableResults),
        watermark: runtime.source_watermark,
      });
    });
  } catch (error) {
    operationError = error;
  }
  let closeError;
  if (connector) {
    try {
      await connector.close();
    } catch {
      closeError = new Error("source_close_failed");
    }
  }
  if (operationError) throw operationError;
  if (closeError) throw closeError;
  return result;
}

function decodeUrlComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("source_dsn_rejected");
  }
}

function validateSourceDsn(dsn) {
  if (typeof dsn !== "string" || dsn.length === 0 || dsn.length > 8192 || /[\r\n\0]/.test(dsn)) {
    throw new Error("source_dsn_rejected");
  }
  let parsed;
  try {
    parsed = new URL(dsn);
  } catch {
    throw new Error("source_dsn_rejected");
  }
  const username = decodeUrlComponent(parsed.username);
  const password = decodeUrlComponent(parsed.password);
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const parameters = [...parsed.searchParams.entries()];
  const direct = hostname === `db.${SOURCE_PROJECT_REF}.supabase.co` && username === "postgres";
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname) &&
    username === `postgres.${SOURCE_PROJECT_REF}`;
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("source_dsn_rejected");
  }
  if (!password || /[\r\n\0]/.test(username) || /[\r\n\0]/.test(password) ||
      parsed.port !== "5432" || parsed.pathname !== "/postgres" || parsed.hash ||
      hostname.includes(",") || username.includes(",") || !(direct || pooler) ||
      parameters.length !== 1 || parameters[0][0] !== "sslmode" || parameters[0][1] !== "verify-full") {
    throw new Error("source_dsn_rejected");
  }
  return Object.freeze({ hostname });
}

function loadBundledPostgresDriver() {
  try {
    const requireFromBakery = createRequire(
      new URL("../../../../../../bakery-ops/package.json", import.meta.url),
    );
    return requireFromBakery("postgres");
  } catch {
    throw new Error("source_driver_unavailable");
  }
}

function validatedSupabaseRootCa(now = Date.now()) {
  let certificate;
  try {
    certificate = new X509Certificate(SUPABASE_ROOT_CA_2021);
  } catch {
    throw new Error("source_tls_ca_invalid");
  }
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  let selfSignatureValid = false;
  try {
    selfSignatureValid = certificate.verify(certificate.publicKey);
  } catch {
    throw new Error("source_tls_ca_invalid");
  }
  if (certificate.fingerprint256 !== SUPABASE_ROOT_CA_2021_FINGERPRINT ||
      certificate.ca !== true || certificate.subject !== certificate.issuer ||
      selfSignatureValid !== true ||
      !Number.isFinite(validFrom) || !Number.isFinite(validTo) ||
      now < validFrom || now >= validTo) {
    throw new Error("source_tls_ca_invalid");
  }
  return SUPABASE_ROOT_CA_2021;
}

function sameTransactionOptions(options) {
  try {
    exactObjectKeys(options, Object.keys(TRANSACTION_OPTIONS), "invalid_source_transaction_options");
  } catch {
    return false;
  }
  return options.deferrable === true && options.isolationLevel === "SERIALIZABLE" &&
    options.readOnly === true;
}

export function createPostgresJsSourceConnector({
  dsn,
  postgresFactory = loadBundledPostgresDriver(),
}) {
  const { hostname } = validateSourceDsn(dsn);
  if (typeof postgresFactory !== "function") throw new TypeError("invalid_postgres_factory");
  const ca = validatedSupabaseRootCa();
  const sql = postgresFactory(dsn, {
    connect_timeout: 10,
    connection: { application_name: "hotcrush-r6-raw-source-capture" },
    fetch_types: false,
    idle_timeout: 0,
    max: 1,
    max_lifetime: 0,
    prepare: false,
    ssl: {
      ca,
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      servername: hostname,
    },
  });
  let closed = false;
  return Object.freeze({
    async close() {
      if (closed) return;
      closed = true;
      await sql.end({ timeout: 5 });
    },
    async transactionScope(options, callback) {
      if (closed) throw new Error("source_connection_closed");
      if (!sameTransactionOptions(options) || typeof callback !== "function") {
        throw new TypeError("invalid_source_transaction_options");
      }
      return sql.begin(
        "ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE",
        async (transaction) => callback(Object.freeze({
          async query(statement, parameters = []) {
            if (typeof statement !== "string" || !Array.isArray(parameters)) {
              throw new TypeError("invalid_source_query");
            }
            return transaction.unsafe(statement, parameters, { prepare: false }).raw();
          },
          stream(statement, parameters = [], batchSize) {
            if (typeof statement !== "string" || !Array.isArray(parameters) ||
                batchSize !== SOURCE_CURSOR_BATCH_SIZE) {
              throw new TypeError("invalid_source_stream");
            }
            return transaction.unsafe(statement, parameters, { prepare: false }).raw().cursor(batchSize);
          },
        })),
      );
    },
  });
}

export function loadSourceDsnFromMacOSKeychain({ execFileImpl = nodeExecFile } = {}) {
  return new Promise((resolve, reject) => {
    const argumentsList = [
      "find-generic-password",
      "-a", SOURCE_DSN_KEYCHAIN.account,
      "-s", SOURCE_DSN_KEYCHAIN.service,
      "-w",
    ];
    execFileImpl(
      "/usr/bin/security",
      argumentsList,
      { encoding: "utf8", maxBuffer: 16 * 1024, shell: false, timeout: 10_000 },
      (error, stdout) => {
        if (error) return reject(new Error("source_dsn_keychain_read_failed"));
        const dsn = String(stdout).trim();
        try {
          validateSourceDsn(dsn);
          resolve(dsn);
        } catch {
          reject(new Error("source_dsn_keychain_read_failed"));
        }
      },
    );
  });
}

export {
  SOURCE_CURSOR_BATCH_SIZE,
  SOURCE_CAPTURE_INCIDENT_BOUNDARY,
  SOURCE_DSN_KEYCHAIN,
  SOURCE_PROJECT_REF,
  SUPABASE_ROOT_CA_2021,
  SUPABASE_ROOT_CA_2021_FINGERPRINT,
};
