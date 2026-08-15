import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeJcs, sha256Hex } from "./canonical.mjs";
import { parseCsv } from "./csv.mjs";
import { buildTargetLoadPlan } from "./dag.mjs";
import { verifyMigrationContractRelease } from "../contract-release.mjs";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ETL_DIR = path.resolve(LIB_DIR, "..");
const IMPLEMENTATION_DIR = path.resolve(ETL_DIR, "..");
const CORE_DIR = path.resolve(IMPLEMENTATION_DIR, "..");
export const CONTRACT_PATH = path.join(ETL_DIR, "migration-contract.json");

const INPUTS = Object.freeze({
  current_field_matrix: {
    file: "current-field-to-target-matrix.csv",
    sha256: "3d2d58bb11247313b415d0aa93fb9540c8773b0f5910fc5d0e3cbc376da94ed6",
  },
  current_object_matrix: {
    file: "current-to-target-matrix.csv",
    sha256: "398a8a30e438fc6ec87002b13ba03c2f2fec9dcd1a7356964e1f7cd09848e97e",
  },
  current_schema_snapshot: {
    file: "evidence/current-schema-snapshot.json",
    sha256: "4019e91adaa9aff9a930f0d22670d53d3d848893d1ebca714287f61cab6557c5",
  },
  phase1_manifest: {
    file: "implementation/generated/phase1-ddl-manifest.json",
    sha256: "f03ebd6d66462d8720f85a59642769d4655cd6597343401dcf5f4dc62dd0dc66",
  },
  review_package_sha256: "6b863293c5aa3358c45c52468f614583f309ccb8a3ea717f3ad90ad76dfceaa0",
});

const CLASSES = Object.freeze({
  A: ["appointments", "cost_card_item", "cost_card_recipe", "cost_card_recipe_item", "daily_breakdown", "daily_review", "employee_events", "fact_hbti_response", "finance_labor_detail", "finance_material", "finance_order_base", "finance_revenue_daily", "finance_store", "holiday", "hourly_sales_summary", "offers", "pos_member_daily", "trials", "wa_outbound_queue"],
  R: ["cost_card_product_link", "daily_revenue", "finance_expense_raw", "finance_item_sales", "finance_pl_metrics", "finance_stock", "finance_stock_flow", "finance_supplier_orders", "finance_targets", "forecast_snapshot", "hbti_gift_stock", "item_hourly_sales", "job_openings", "pos_member_card_txn", "pos_member_order_item", "pos_product", "prompt_segment", "prompt_template", "screening_rules"],
  P: ["ai_call_log", "ai_daily_correction", "app_audit_log", "app_role", "app_user", "app_user_store_scope", "applications", "business_rule", "candidate_conversations", "chat_history", "context_event", "cost_card_item_price", "daily_push_log", "employees", "finance_cashflow", "finance_expense", "finance_orders", "finance_period_map", "item_waste", "ops_audit_log", "ops_store", "out_of_stock_record", "pos_member", "product", "product_alias", "schema_migrations", "session_state", "staff", "wa_send_log"],
  X: ["app_session", "app_user_role_pre083", "cost_card_item_name_lock", "cost_card_product_link_pre080", "finance_labor", "hbti_auth_token", "hbti_rate_limit", "item_last_sale"],
  B0: ["fact_shift"],
});

const SELECTED_UNIQUES = Object.freeze({
  daily_revenue: { constraint_name: "uk_daily_revenue_date_store", columns: ["date", "store"] },
  finance_revenue_daily: { constraint_name: "finance_revenue_daily_date_store_key", columns: ["date", "store"] },
  pos_member: { constraint_name: "uk_pos_member_store_member", columns: ["store", "member_id"] },
  pos_member_card_txn: { constraint_name: "uk_pos_member_card_txn", columns: ["store", "txn_id"] },
  pos_member_daily: { constraint_name: "uk_pos_member_daily", columns: ["date", "store"] },
});

const FULL_ROW_MULTISET = new Set(["app_user_role_pre083", "cost_card_product_link_pre080"]);
const ROOT_KEYS = [
  "approved_exclusion_reason_codes", "artifact_policy", "contract_version", "counts",
  "declared_transform_registry", "execution_handlers", "execution_opcodes",
  "exclusion_authorities", "inputs", "registered_views", "release_status",
  "source_capture_contract", "source_tables", "target_catalog_invariant", "target_load_plan",
];
const TABLE_KEYS = [
  "default_outcome", "fields", "identity", "migration_class", "name",
  "observed_unique_constraints", "required_target_trust", "source_object_disposition",
];
const FIELD_KEYS = [
  "data_type", "declared_transform_code", "execution_handler_id", "execution_status",
  "mapping_basis", "name", "nullable", "ordinal", "risk", "target_reference_evidence",
];
const VIEW_KEYS = ["definition_sha256", "export", "fields", "name"];
const VIEW_FIELD_KEYS = ["data_type", "forbidden_view_disposition", "name", "nullable", "ordinal"];
const REGISTRY_KEYS = ["code", "code_sha256", "execution_status"];
const INPUT_KEYS = [
  "current_field_matrix", "current_object_matrix", "current_schema_snapshot",
  "declared_transform_registry_sha256", "phase1_catalog_fingerprint", "phase1_manifest",
  "phase1_payload_sha256", "review_package_sha256", "source_field_contract_sha256",
  "source_identity_contract_sha256", "source_key_registry_sha256",
  "target_active_foreign_keys_sha256", "target_load_plan_sha256", "view_registry_sha256",
];

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertExactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(code);
  const actual = Object.keys(value).sort(compare);
  const expected = [...keys].sort(compare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(code);
  }
}

function constraintColumns(definition) {
  const match = /^(?:PRIMARY KEY|UNIQUE(?: NULLS (?:NOT )?DISTINCT)?) \((.*)\)$/.exec(definition);
  if (!match) throw new TypeError("unsupported_source_key_definition");
  return match[1].split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
}

function classFor(name) {
  const matches = Object.entries(CLASSES).filter(([, names]) => names.includes(name));
  if (matches.length !== 1) throw new TypeError("source_class_partition_error");
  return matches[0][0];
}

async function readBound(relativePath, expectedHash) {
  const bytes = await readFile(path.join(CORE_DIR, relativePath));
  if (sha256Hex(bytes) !== expectedHash) throw new TypeError(`input_hash_mismatch:${relativePath}`);
  return bytes;
}

function makeIdentity(tableName, constraints) {
  const primary = constraints.find((entry) =>
    entry.table_name === tableName && entry.constraint_type === "primary_key"
  );
  if (primary) {
    return {
      columns: constraintColumns(primary.definition),
      constraint_name: primary.constraint_name,
      mode: "PRIMARY_KEY",
    };
  }
  if (SELECTED_UNIQUES[tableName]) {
    const selected = SELECTED_UNIQUES[tableName];
    const actual = constraints.find((entry) =>
      entry.table_name === tableName && entry.constraint_name === selected.constraint_name &&
      entry.constraint_type === "unique"
    );
    if (!actual || canonicalizeJcs(constraintColumns(actual.definition)).toString() !== canonicalizeJcs(selected.columns).toString()) {
      throw new TypeError("selected_unique_identity_drift");
    }
    return { mode: "UNIQUE_KEY", ...selected };
  }
  if (FULL_ROW_MULTISET.has(tableName)) return { columns: [], mode: "FULL_ROW_MULTISET" };
  throw new TypeError("missing_source_row_identity");
}

function sourceDefault(migrationClass) {
  if (migrationClass === "A" || migrationClass === "R") return "QUARANTINE_UNTIL_HANDLER_APPROVED";
  if (migrationClass === "X") return "QUARANTINE_UNTIL_EXCLUSION_APPROVED";
  if (migrationClass === "B0") return "BLOCK_IF_ANY_ROW";
  return "QUARANTINE_PENDING_REVIEW";
}

export async function buildMigrationContract() {
  const [snapshotBytes, fieldMatrixBytes, objectMatrixBytes, phaseManifestBytes] = await Promise.all([
    readBound(INPUTS.current_schema_snapshot.file, INPUTS.current_schema_snapshot.sha256),
    readBound(INPUTS.current_field_matrix.file, INPUTS.current_field_matrix.sha256),
    readBound(INPUTS.current_object_matrix.file, INPUTS.current_object_matrix.sha256),
    readBound(INPUTS.phase1_manifest.file, INPUTS.phase1_manifest.sha256),
  ]);
  const snapshot = JSON.parse(snapshotBytes);
  const fieldRows = parseCsv(fieldMatrixBytes.toString("utf8"));
  const objectRows = parseCsv(objectMatrixBytes.toString("utf8"));
  const phaseManifest = JSON.parse(phaseManifestBytes);
  const objectByName = new Map(objectRows.map((row) => [row.current_object, row]));
  const matrixByField = new Map(fieldRows.map((row) => [
    `${row.current_object_type}\0${row.current_object}\0${row.current_field}`,
    row,
  ]));
  if (matrixByField.size !== 939) throw new TypeError("field_matrix_not_bijective");

  const tableNames = snapshot.objects.filter((entry) => entry.object_type === "table")
    .map((entry) => entry.object_name).sort(compare);
  const viewNames = snapshot.objects.filter((entry) => entry.object_type === "view")
    .map((entry) => entry.object_name).sort(compare);
  const sourceTables = tableNames.map((name) => {
    const migrationClass = classFor(name);
    const fields = snapshot.columns.filter((column) => column.object_name === name)
      .sort((left, right) => left.ordinal_position - right.ordinal_position)
      .map((column) => {
        const matrix = matrixByField.get(`table\0${name}\0${column.column_name}`);
        if (!matrix || matrix.implementation_status !== "DESIGN_EXPLICIT_NOT_EXECUTED") {
          throw new TypeError("source_field_contract_missing");
        }
        return {
          data_type: column.data_type,
          declared_transform_code: matrix.field_disposition,
          execution_handler_id: null,
          execution_status: "NOT_APPROVED",
          mapping_basis: matrix.mapping_basis,
          name: column.column_name,
          nullable: column.is_nullable,
          ordinal: column.ordinal_position,
          risk: matrix.risk,
          target_reference_evidence: matrix.target_field_or_disposition,
        };
      });
    const observedUniques = snapshot.constraints.filter((constraint) =>
      constraint.table_name === name && constraint.constraint_type === "unique"
    ).map((constraint) => ({
      columns: constraintColumns(constraint.definition),
      constraint_name: constraint.constraint_name,
    })).sort((left, right) => compare(left.constraint_name, right.constraint_name));
    return {
      default_outcome: sourceDefault(migrationClass),
      fields,
      identity: makeIdentity(name, snapshot.constraints),
      migration_class: migrationClass,
      name,
      observed_unique_constraints: observedUniques,
      required_target_trust: migrationClass === "R" ? "LOW_TRUST_REVIEW" : null,
      source_object_disposition: objectByName.get(name)?.disposition ?? null,
    };
  });
  const registeredViews = viewNames.map((name) => {
    const definition = snapshot.views.find((view) => view.view_name === name)?.definition;
    if (typeof definition !== "string") throw new TypeError("view_definition_missing");
    return {
      definition_sha256: sha256Hex(Buffer.from(definition, "utf8")),
      export: false,
      fields: snapshot.columns.filter((column) => column.object_name === name)
        .sort((left, right) => left.ordinal_position - right.ordinal_position)
        .map((column) => {
          const matrix = matrixByField.get(`view\0${name}\0${column.column_name}`);
          if (!matrix || matrix.field_disposition !== "DERIVE_READ_MODEL_NOT_MIGRATE") {
            throw new TypeError("view_registry_drift");
          }
          return {
            data_type: column.data_type,
            forbidden_view_disposition: matrix.field_disposition,
            name: column.column_name,
            nullable: column.is_nullable,
            ordinal: column.ordinal_position,
          };
        }),
      name,
    };
  });
  const declaredCodes = [...new Set(sourceTables.flatMap((table) =>
    table.fields.map((field) => field.declared_transform_code)
  ))].sort(compare);
  const targetLoadPlan = buildTargetLoadPlan(phaseManifest);
  const identityContractSha256 = sha256Hex(canonicalizeJcs(sourceTables.map((table) => ({
    identity: table.identity,
    table: table.name,
  }))));
  const sourceFieldContractSha256 = sha256Hex(canonicalizeJcs(sourceTables.map((table) => ({
    fields: table.fields,
    table: table.name,
  }))));
  const sourceKeyRegistrySha256 = sha256Hex(canonicalizeJcs(sourceTables.map((table) => ({
    identity: table.identity,
    observed_unique_constraints: table.observed_unique_constraints,
    table: table.name,
  }))));
  const viewRegistrySha256 = sha256Hex(canonicalizeJcs(registeredViews));
  const declaredRegistrySha256 = sha256Hex(canonicalizeJcs(declaredCodes));
  const targetLoadPlanSha256 = sha256Hex(canonicalizeJcs(targetLoadPlan));
  const contract = {
    approved_exclusion_reason_codes: [],
    artifact_policy: {
      encrypted_only: true,
      envelope: "hotcrush.aes256gcm-envelope.v1",
      key_provider: "MACOS_KEYCHAIN_READ_ONLY",
      plaintext_file_persistence: false,
      production_streaming_status: "NOT_IMPLEMENTED",
      typed_encoding: "hotcrush.typed-jcs.v1",
    },
    contract_version: "R6_PHASE1_ETL_CONTRACT_V1",
    counts: {
      source_tables: sourceTables.length,
      source_table_fields: sourceTables.reduce((sum, table) => sum + table.fields.length, 0),
      registered_views: registeredViews.length,
      registered_view_fields: registeredViews.reduce((sum, view) => sum + view.fields.length, 0),
      primary_key_identities: sourceTables.filter((table) => table.identity.mode === "PRIMARY_KEY").length,
      unique_key_identities: sourceTables.filter((table) => table.identity.mode === "UNIQUE_KEY").length,
      full_row_multiset_identities: sourceTables.filter((table) => table.identity.mode === "FULL_ROW_MULTISET").length,
      disposition_A: CLASSES.A.length,
      disposition_R: CLASSES.R.length,
      disposition_P: CLASSES.P.length,
      disposition_X: CLASSES.X.length,
      disposition_B0: CLASSES.B0.length,
      physical_declared_transform_codes: declaredCodes.length,
      forbidden_view_dispositions: 1,
      target_tables: phaseManifest.counts.tables,
      declared_target_foreign_keys: phaseManifest.counts.foreign_keys + 2,
      active_target_foreign_keys: phaseManifest.counts.foreign_keys,
      deferred_target_foreign_keys: 2,
    },
    declared_transform_registry: declaredCodes.map((code) => ({
      code,
      code_sha256: sha256Hex(Buffer.from(code, "utf8")),
      execution_status: "EVIDENCE_ONLY_NOT_EXECUTABLE",
    })),
    execution_handlers: {},
    execution_opcodes: [
      "EXCLUDE_APPROVED_RESOLUTION",
      "QUARANTINE_FAIL_CLOSED",
      "TARGET_APPROVED_HANDLER",
    ],
    exclusion_authorities: [],
    inputs: {
      ...INPUTS,
      phase1_catalog_fingerprint: "a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea",
      declared_transform_registry_sha256: declaredRegistrySha256,
      source_identity_contract_sha256: identityContractSha256,
      source_field_contract_sha256: sourceFieldContractSha256,
      source_key_registry_sha256: sourceKeyRegistrySha256,
      target_active_foreign_keys_sha256: phaseManifest.contract_hashes.active_foreign_keys_sha256,
      target_load_plan_sha256: targetLoadPlanSha256,
      phase1_payload_sha256: phaseManifest.payload.sha256,
      view_registry_sha256: viewRegistrySha256,
    },
    registered_views: registeredViews,
    release_status: "PHYSICAL_BACKFILL_NOT_STARTED",
    source_capture_contract: {
      allowed_source_relkind: "r",
      explicit_projected_columns: 759,
      expected_postgresql_version: "17.6",
      forbid_view_queries: true,
      isolation_level: "SERIALIZABLE",
      lock_mode: "ACCESS SHARE",
      lock_order: tableNames,
      read_only: true,
      revalidate_schema_after_lock: true,
      session_settings: {
        DateStyle: "ISO, YMD",
        IntervalStyle: "iso_8601",
        TimeZone: "UTC",
        bytea_output: "hex",
        extra_float_digits: "3",
      },
      source_close_before_target_connect: true,
      source_project_ref: "ecsgqcmwtjmcpzqytdqw",
      target_project_ref: "tmmkknnkcptunxbfjxqn",
      tls_mode: "verify-full",
      transaction_deferrable: true,
      writes_to_source: false,
    },
    source_tables: sourceTables,
    target_catalog_invariant: {
      expected_catalog_fingerprint: "a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea",
      expected_extensions: ["btree_gist", "citext", "pgcrypto"],
      expected_public_views: 0,
      etl_ddl_delta: 0,
      forbidden_statement_classes: [
        "ALTER", "CALL", "COMMENT", "CREATE", "DO", "DROP", "GRANT", "REVOKE", "TRUNCATE",
      ],
      forbidden_ddl_operations: [
        "ALTER_EXTENSION", "ALTER_VIEW", "CREATE_EXTENSION", "CREATE_VIEW", "DROP_EXTENSION", "DROP_VIEW",
      ],
    },
    target_load_plan: targetLoadPlan,
  };
  validateMigrationContract(contract);
  return contract;
}

export function validateMigrationContract(contract) {
  assertExactKeys(contract, ROOT_KEYS, "unknown_contract_field");
  if (contract.contract_version !== "R6_PHASE1_ETL_CONTRACT_V1" ||
      contract.release_status !== "PHYSICAL_BACKFILL_NOT_STARTED") {
    throw new TypeError("invalid_contract_release_state");
  }
  if (Object.keys(contract.execution_handlers).length !== 0) throw new TypeError("unapproved_execution_handler");
  if (contract.exclusion_authorities.length !== 0 || contract.approved_exclusion_reason_codes.length !== 0) {
    throw new TypeError("unapproved_exclusion_authority");
  }
  if (!canonicalizeJcs(contract.execution_opcodes).equals(canonicalizeJcs([
    "EXCLUDE_APPROVED_RESOLUTION", "QUARANTINE_FAIL_CLOSED", "TARGET_APPROVED_HANDLER",
  ]))) {
    throw new TypeError("execution_opcode_registry_drift");
  }
  const expectedArtifactPolicy = {
    encrypted_only: true,
    envelope: "hotcrush.aes256gcm-envelope.v1",
    key_provider: "MACOS_KEYCHAIN_READ_ONLY",
    plaintext_file_persistence: false,
    production_streaming_status: "NOT_IMPLEMENTED",
    typed_encoding: "hotcrush.typed-jcs.v1",
  };
  if (!canonicalizeJcs(contract.artifact_policy).equals(canonicalizeJcs(expectedArtifactPolicy))) {
    throw new TypeError("artifact_policy_drift");
  }
  const expectedCounts = {
    source_tables: 76, source_table_fields: 759, registered_views: 21, registered_view_fields: 180,
    primary_key_identities: 69, unique_key_identities: 5, full_row_multiset_identities: 2,
    disposition_A: 19, disposition_R: 19, disposition_P: 29, disposition_X: 8, disposition_B0: 1,
    physical_declared_transform_codes: 179, forbidden_view_dispositions: 1,
    target_tables: 100, declared_target_foreign_keys: 291,
    active_target_foreign_keys: 289, deferred_target_foreign_keys: 2,
  };
  if (!canonicalizeJcs(contract.counts).equals(canonicalizeJcs(expectedCounts))) {
    throw new TypeError("contract_count_drift");
  }
  const tables = contract.source_tables;
  if (new Set(tables.map((table) => table.name)).size !== 76) throw new TypeError("source_table_set_drift");
  const registry = new Set(contract.declared_transform_registry.map((entry) => entry.code));
  if (registry.size !== 179 || contract.declared_transform_registry.length !== 179) {
    throw new TypeError("declared_transform_registry_drift");
  }
  const expectedCapture = {
    allowed_source_relkind: "r",
    explicit_projected_columns: 759,
    expected_postgresql_version: "17.6",
    forbid_view_queries: true,
    isolation_level: "SERIALIZABLE",
    lock_mode: "ACCESS SHARE",
    lock_order: tables.map((table) => table.name).sort(compare),
    read_only: true,
    revalidate_schema_after_lock: true,
    session_settings: {
      DateStyle: "ISO, YMD", IntervalStyle: "iso_8601", TimeZone: "UTC",
      bytea_output: "hex", extra_float_digits: "3",
    },
    source_close_before_target_connect: true,
    source_project_ref: "ecsgqcmwtjmcpzqytdqw",
    target_project_ref: "tmmkknnkcptunxbfjxqn",
    tls_mode: "verify-full",
    transaction_deferrable: true,
    writes_to_source: false,
  };
  if (!canonicalizeJcs(contract.source_capture_contract).equals(canonicalizeJcs(expectedCapture))) {
    throw new TypeError("source_capture_contract_drift");
  }
  const expectedCatalog = {
    expected_catalog_fingerprint: "a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea",
    expected_extensions: ["btree_gist", "citext", "pgcrypto"],
    expected_public_views: 0,
    etl_ddl_delta: 0,
    forbidden_statement_classes: [
      "ALTER", "CALL", "COMMENT", "CREATE", "DO", "DROP", "GRANT", "REVOKE", "TRUNCATE",
    ],
    forbidden_ddl_operations: [
      "ALTER_EXTENSION", "ALTER_VIEW", "CREATE_EXTENSION", "CREATE_VIEW", "DROP_EXTENSION", "DROP_VIEW",
    ],
  };
  if (!canonicalizeJcs(contract.target_catalog_invariant).equals(canonicalizeJcs(expectedCatalog))) {
    throw new TypeError("target_catalog_invariant_drift");
  }
  for (const [name, binding] of Object.entries(INPUTS)) {
    if (typeof binding === "object" &&
        !canonicalizeJcs(contract.inputs[name]).equals(canonicalizeJcs(binding))) {
      throw new TypeError("input_binding_drift");
    }
    if (typeof binding === "string" && contract.inputs[name] !== binding) {
      throw new TypeError("input_binding_drift");
    }
  }
  assertExactKeys(contract.inputs, INPUT_KEYS, "unknown_input_binding");
  for (const name of [
    "declared_transform_registry_sha256", "source_field_contract_sha256",
    "source_identity_contract_sha256", "source_key_registry_sha256",
    "target_load_plan_sha256", "view_registry_sha256",
  ]) {
    if (!/^[0-9a-f]{64}$/.test(contract.inputs[name])) throw new TypeError("input_binding_drift");
  }
  if (
    contract.inputs.phase1_catalog_fingerprint !== "a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea" ||
    contract.inputs.phase1_payload_sha256 !== "0cdb26dbf255022997c3e167a28f12709b4c73c4ad75d364ed312ff37843176d" ||
    contract.inputs.target_active_foreign_keys_sha256 !== "de54225a4a1a9e20a5f3a199ed39f533eb7050aeb1ca4e18010dcc2b4c35446c"
  ) {
    throw new TypeError("input_binding_drift");
  }
  for (const [migrationClass, expectedNames] of Object.entries(CLASSES)) {
    const actual = tables.filter((table) => table.migration_class === migrationClass).map((table) => table.name).sort(compare);
    if (!canonicalizeJcs(actual).equals(canonicalizeJcs([...expectedNames].sort(compare)))) {
      throw new TypeError("source_class_partition_error");
    }
  }
  const allFields = [];
  for (const table of tables) {
    assertExactKeys(table, TABLE_KEYS, "unknown_source_table_contract_key");
    if (!Array.isArray(table.fields) || table.fields.length === 0) throw new TypeError("source_field_count_drift");
    const names = table.fields.map((field) => field.name);
    const ordinals = table.fields.map((field) => field.ordinal);
    if (new Set(names).size !== names.length ||
        ordinals.some((ordinal, index) => ordinal !== index + 1)) {
      throw new TypeError("source_field_ordinal_drift");
    }
    for (const field of table.fields) {
      assertExactKeys(field, FIELD_KEYS, "unknown_source_field_contract_key");
      if (!registry.has(field.declared_transform_code)) throw new TypeError("unknown_declared_transform_code");
      if (field.execution_handler_id !== null || field.execution_status !== "NOT_APPROVED") {
        throw new TypeError("unapproved_execution_handler");
      }
      if (typeof field.data_type !== "string" || typeof field.nullable !== "boolean") {
        throw new TypeError("source_field_contract_invalid");
      }
      allFields.push(field);
    }
    const identityKeys = table.identity.mode === "FULL_ROW_MULTISET"
      ? ["columns", "mode"] : ["columns", "constraint_name", "mode"];
    assertExactKeys(table.identity, identityKeys, "unknown_source_identity_contract_key");
    if (!Array.isArray(table.identity.columns) ||
        table.identity.columns.some((column) => !names.includes(column))) {
      throw new TypeError("source_identity_contract_drift");
    }
    for (const column of table.identity.columns) {
      if (table.fields.find((field) => field.name === column).nullable) {
        throw new TypeError("source_identity_nullable");
      }
    }
    if (!Array.isArray(table.observed_unique_constraints)) throw new TypeError("source_unique_registry_drift");
    for (const unique of table.observed_unique_constraints) {
      assertExactKeys(unique, ["columns", "constraint_name"], "unknown_source_unique_contract_key");
    }
  }
  if (allFields.length !== 759) throw new TypeError("source_field_count_drift");
  const sourceFieldSha = sha256Hex(canonicalizeJcs(tables.map((table) => ({
    fields: table.fields,
    table: table.name,
  }))));
  if (sourceFieldSha !== contract.inputs.source_field_contract_sha256) {
    throw new TypeError("source_field_contract_drift");
  }
  const identitySha = sha256Hex(canonicalizeJcs(tables.map((table) => ({
    identity: table.identity,
    table: table.name,
  }))));
  if (identitySha !== contract.inputs.source_identity_contract_sha256) {
    throw new TypeError("source_identity_contract_drift");
  }
  const sourceKeySha = sha256Hex(canonicalizeJcs(tables.map((table) => ({
    identity: table.identity,
    observed_unique_constraints: table.observed_unique_constraints,
    table: table.name,
  }))));
  if (sourceKeySha !== contract.inputs.source_key_registry_sha256) {
    throw new TypeError("source_key_registry_drift");
  }
  const identityCounts = Object.groupBy(tables, (table) => table.identity.mode);
  if (
    identityCounts.PRIMARY_KEY?.length !== 69 || identityCounts.UNIQUE_KEY?.length !== 5 ||
    identityCounts.FULL_ROW_MULTISET?.length !== 2
  ) {
    throw new TypeError("source_identity_contract_drift");
  }
  for (const [name, selected] of Object.entries(SELECTED_UNIQUES)) {
    const table = tables.find((candidate) => candidate.name === name);
    if (!table || table.identity.mode !== "UNIQUE_KEY" ||
        table.identity.constraint_name !== selected.constraint_name ||
        !canonicalizeJcs(table.identity.columns).equals(canonicalizeJcs(selected.columns))) {
      throw new TypeError("source_identity_contract_drift");
    }
  }
  const fullRows = tables.filter((table) => table.identity.mode === "FULL_ROW_MULTISET").map((table) => table.name).sort(compare);
  if (!canonicalizeJcs(fullRows).equals(canonicalizeJcs([...FULL_ROW_MULTISET].sort(compare)))) {
    throw new TypeError("source_identity_contract_drift");
  }
  for (const entry of contract.declared_transform_registry) {
    assertExactKeys(entry, REGISTRY_KEYS, "unknown_declared_transform_registry_key");
    if (entry.execution_status !== "EVIDENCE_ONLY_NOT_EXECUTABLE" ||
        entry.code_sha256 !== sha256Hex(Buffer.from(entry.code, "utf8"))) {
      throw new TypeError("declared_transform_registry_drift");
    }
  }
  if (sha256Hex(canonicalizeJcs([...registry].sort(compare))) !== contract.inputs.declared_transform_registry_sha256) {
    throw new TypeError("declared_transform_registry_drift");
  }
  let viewFieldCount = 0;
  for (const view of contract.registered_views) {
    assertExactKeys(view, VIEW_KEYS, "unknown_view_registry_key");
    if (view.export !== false || !/^[0-9a-f]{64}$/.test(view.definition_sha256)) {
      throw new TypeError("view_export_forbidden");
    }
    const names = new Set();
    view.fields.forEach((field, index) => {
      assertExactKeys(field, VIEW_FIELD_KEYS, "unknown_view_field_registry_key");
      if (field.ordinal !== index + 1 || names.has(field.name) ||
          field.forbidden_view_disposition !== "DERIVE_READ_MODEL_NOT_MIGRATE") {
        throw new TypeError("view_registry_drift");
      }
      names.add(field.name);
      viewFieldCount += 1;
    });
  }
  if (contract.registered_views.length !== 21 || viewFieldCount !== 180) throw new TypeError("view_registry_drift");
  if (new Set(contract.registered_views.map((view) => view.name)).size !== 21 ||
      sha256Hex(canonicalizeJcs(contract.registered_views)) !== contract.inputs.view_registry_sha256) {
    throw new TypeError("view_registry_drift");
  }

  const fkSemantic = contract.target_load_plan.active_foreign_keys.map((foreignKey) => ({
    columns: foreignKey.columns,
    fk_activation: foreignKey.fk_activation,
    match_type: foreignKey.match_type,
    ref_columns: foreignKey.ref_columns,
    ref_table: foreignKey.ref_table,
    table: foreignKey.table,
  })).sort((left, right) => compare(
    [left.table, left.columns.join("\0"), left.ref_table, left.ref_columns.join("\0"), left.fk_activation, left.match_type].join("\0"),
    [right.table, right.columns.join("\0"), right.ref_table, right.ref_columns.join("\0"), right.fk_activation, right.match_type].join("\0"),
  ));
  if (sha256Hex(canonicalizeJcs(fkSemantic)) !== contract.inputs.target_active_foreign_keys_sha256) {
    throw new TypeError("target_foreign_key_contract_drift");
  }
  const rebuiltPlan = buildTargetLoadPlan({
    foreign_keys: contract.target_load_plan.active_foreign_keys,
    tables: [...new Set(contract.target_load_plan.components.flatMap((component) => component.tables))]
      .sort(compare).map((name) => ({ name })),
  });
  if (!canonicalizeJcs(rebuiltPlan).equals(canonicalizeJcs(contract.target_load_plan))) {
    throw new TypeError("target_load_plan_drift");
  }
  if (sha256Hex(canonicalizeJcs(contract.target_load_plan)) !== contract.inputs.target_load_plan_sha256) {
    throw new TypeError("target_load_plan_drift");
  }
  const expectedMetrics = {
    nodes: 100, constraint_edges: 289, unique_table_pairs: 268, components: 99,
    condensed_edges: 251, cyclic_components: 10, intra_component_constraints: 12,
    waves: 8, wave_component_counts: [6, 16, 17, 33, 14, 7, 4, 2],
  };
  if (!canonicalizeJcs(contract.target_load_plan.metrics).equals(canonicalizeJcs(expectedMetrics))) {
    throw new TypeError("target_load_plan_drift");
  }
  return contract;
}

export async function loadMigrationContract() {
  const bytes = await readFile(CONTRACT_PATH);
  verifyMigrationContractRelease(bytes);
  const contract = JSON.parse(bytes);
  validateMigrationContract(contract);
  const rebuilt = await buildMigrationContract();
  if (!bytes.equals(migrationContractBytes(rebuilt))) throw new TypeError("migration_contract_not_frozen");
  return contract;
}

export function migrationContractBytes(contract) {
  validateMigrationContract(contract);
  return Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, "utf8");
}

export { CLASSES, INPUTS };
