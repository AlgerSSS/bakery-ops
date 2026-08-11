import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_PATH,
  loadMigrationContract,
  validateMigrationContract,
} from "../etl/lib/contract.mjs";
import {
  MIGRATION_CONTRACT_RELEASE,
  verifyMigrationContractRelease,
} from "../etl/contract-release.mjs";
import { buildTargetLoadPlan } from "../etl/lib/dag.mjs";

const IMPLEMENTATION_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ETL_DIR = path.join(IMPLEMENTATION_DIR, "etl");

test("frozen migration contract covers the exact current source surface", async () => {
  const contract = await loadMigrationContract();

  assert.equal(contract.release_status, "PHYSICAL_BACKFILL_NOT_STARTED");

  assert.deepEqual(contract.counts, {
    source_tables: 76,
    source_table_fields: 759,
    registered_views: 21,
    registered_view_fields: 180,
    primary_key_identities: 69,
    unique_key_identities: 5,
    full_row_multiset_identities: 2,
    disposition_A: 19,
    disposition_R: 19,
    disposition_P: 29,
    disposition_X: 8,
    disposition_B0: 1,
    physical_declared_transform_codes: 179,
    forbidden_view_dispositions: 1,
    target_tables: 100,
    declared_target_foreign_keys: 291,
    active_target_foreign_keys: 289,
    deferred_target_foreign_keys: 2,
  });
  assert.equal(
    contract.source_tables.reduce((sum, table) => sum + table.fields.length, 0),
    759,
  );
  assert.equal(
    contract.registered_views.reduce((sum, view) => sum + view.fields.length, 0),
    180,
  );
  assert.ok(contract.registered_views.every((view) => view.export === false));

  const classes = Object.groupBy(contract.source_tables, (table) => table.migration_class);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(classes).map(([key, tables]) => [key, tables.length]),
    ),
    { A: 19, B0: 1, P: 29, R: 19, X: 8 },
  );
  assert.deepEqual(contract.execution_handlers, {});
  assert.ok(contract.source_tables.every((table) =>
    table.fields.every((field) =>
      field.execution_handler_id === null &&
      field.execution_status === "NOT_APPROVED" &&
      typeof field.declared_transform_code === "string"
    ),
  ));

  const identityModes = Object.groupBy(
    contract.source_tables,
    (table) => table.identity.mode,
  );
  assert.equal(identityModes.PRIMARY_KEY.length, 69);
  assert.equal(identityModes.UNIQUE_KEY.length, 5);
  assert.equal(identityModes.FULL_ROW_MULTISET.length, 2);
  assert.deepEqual(
    identityModes.FULL_ROW_MULTISET.map((table) => table.name).sort(),
    ["app_user_role_pre083", "cost_card_product_link_pre080"],
  );
  assert.deepEqual(
    contract.source_tables.find((table) => table.name === "daily_revenue").identity,
    {
      mode: "UNIQUE_KEY",
      constraint_name: "uk_daily_revenue_date_store",
      columns: ["date", "store"],
    },
  );
});

test("declared transform codes are frozen evidence and never executable opcodes", async () => {
  const contract = await loadMigrationContract();
  const declaredCodes = new Set(
    contract.source_tables.flatMap((table) =>
      table.fields.map((field) => field.declared_transform_code),
    ),
  );
  const registeredDeclaredCodes = new Set(
    contract.declared_transform_registry.map((entry) => entry.code),
  );
  assert.deepEqual(registeredDeclaredCodes, declaredCodes);
  assert.equal(registeredDeclaredCodes.size, 179);
  assert.ok(
    contract.registered_views.every((view) =>
      view.fields.every((field) =>
        field.forbidden_view_disposition === "DERIVE_READ_MODEL_NOT_MIGRATE"
      ),
    ),
  );

  const mutated = structuredClone(contract);
  mutated.source_tables[0].fields[0].declared_transform_code = "UNKNOWN_AUTO_COPY";
  assert.throws(
    () => validateMigrationContract(mutated),
    /unknown_declared_transform_code/,
  );

  const auto = structuredClone(contract);
  auto.source_tables[0].fields[0].execution_handler_id = "PASS_THROUGH";
  auto.source_tables[0].fields[0].execution_status = "APPROVED";
  assert.throws(() => validateMigrationContract(auto), /unapproved_execution_handler/);
});

test("nested contract mutations fail closed instead of preserving only top-level counts", async () => {
  const contract = await loadMigrationContract();
  const deletedField = structuredClone(contract);
  deletedField.source_tables[0].fields.pop();
  assert.throws(() => validateMigrationContract(deletedField), /source_field_count_drift/);

  const unknown = structuredClone(contract);
  unknown.source_tables[0].fields[0].surprise = true;
  assert.throws(() => validateMigrationContract(unknown), /unknown_source_field_contract_key/);

  const identityDrift = structuredClone(contract);
  const dailyRevenue = identityDrift.source_tables.find((table) => table.name === "daily_revenue");
  dailyRevenue.identity.columns = ["date"];
  dailyRevenue.identity.constraint_name = "uk_daily_revenue_date";
  assert.throws(() => validateMigrationContract(identityDrift), /source_identity_contract_drift/);

  const registryDrift = structuredClone(contract);
  registryDrift.declared_transform_registry[0].code_sha256 = "0".repeat(64);
  assert.throws(() => validateMigrationContract(registryDrift), /declared_transform_registry_drift/);
});

test("ETL is schema-neutral and freezes the existing Phase1 catalog", async () => {
  const contract = await loadMigrationContract();
  assert.deepEqual(contract.target_catalog_invariant, {
    expected_catalog_fingerprint: "a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea",
    expected_extensions: ["btree_gist", "citext", "pgcrypto"],
    expected_public_views: 0,
    etl_ddl_delta: 0,
    forbidden_statement_classes: [
      "ALTER",
      "CALL",
      "COMMENT",
      "CREATE",
      "DO",
      "DROP",
      "GRANT",
      "REVOKE",
      "TRUNCATE",
    ],
    forbidden_ddl_operations: [
      "ALTER_EXTENSION",
      "ALTER_VIEW",
      "CREATE_EXTENSION",
      "CREATE_VIEW",
      "DROP_EXTENSION",
      "DROP_VIEW",
    ],
  });
});

test("target load plan is the deterministic SCC DAG derived from compiler output", async () => {
  const contract = await loadMigrationContract();
  assert.deepEqual(contract.target_load_plan.metrics, {
    nodes: 100,
    constraint_edges: 289,
    unique_table_pairs: 268,
    components: 99,
    condensed_edges: 251,
    cyclic_components: 10,
    intra_component_constraints: 12,
    waves: 8,
    wave_component_counts: [6, 16, 17, 33, 14, 7, 4, 2],
  });
  assert.equal(contract.target_load_plan.active_foreign_keys.length, 289);
  assert.ok(contract.target_load_plan.active_foreign_keys.every((foreignKey) =>
    foreignKey.fk_activation === "WITH_TABLE" &&
    foreignKey.match_type === "SIMPLE" &&
    foreignKey.deferrable === true &&
    foreignKey.initially === "IMMEDIATE"
  ));
  assert.deepEqual(
    contract.target_load_plan.components
      .filter((component) => component.cyclic)
      .map((component) => component.tables.join("+"))
      .sort(),
    [
      "app_unit",
      "app_user+hr_person",
      "finance_import_batch",
      "hr_offer",
      "ops_location",
      "ops_production_plan_line",
      "ops_production_plan_version",
      "pos_ingest_batch",
      "pos_member",
      "scm_supplier_item",
    ],
  );
  for (const component of contract.target_load_plan.components) {
    for (const parentId of component.parent_components) {
      const parent = contract.target_load_plan.components.find(
        (candidate) => candidate.component_id === parentId,
      );
      assert.ok(parent.wave < component.wave);
    }
  }
  const phaseManifest = JSON.parse(await readFile(path.join(
    IMPLEMENTATION_DIR,
    "generated",
    "phase1-ddl-manifest.json",
  )));
  assert.deepEqual(
    buildTargetLoadPlan({
      ...phaseManifest,
      foreign_keys: [...phaseManifest.foreign_keys].reverse(),
      tables: [...phaseManifest.tables].reverse(),
    }),
    contract.target_load_plan,
  );
});

test("contract regeneration is byte deterministic and check mode is clean", async () => {
  const result = spawnSync(
    process.execPath,
    [path.join(ETL_DIR, "build-contract.mjs"), "--check"],
    { cwd: ETL_DIR, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const raw = await readFile(CONTRACT_PATH);
  assert.equal(raw.length, MIGRATION_CONTRACT_RELEASE.bytes);
  verifyMigrationContractRelease(raw);
  assert.equal(raw.at(-1), 0x0a);
  assert.equal(raw.includes(Buffer.from("captured_rows")), false);
});
