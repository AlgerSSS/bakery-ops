import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadMigrationContract } from "../etl/lib/contract.mjs";
import { canonicalizeJcs, sha256Hex } from "../etl/lib/canonical.mjs";
import { writeEncryptedArtifact } from "../etl/lib/envelope.mjs";
import { domainHmac } from "../etl/lib/identity.mjs";
import { createEncryptedS0, openEncryptedS0 } from "../etl/lib/s0.mjs";
import {
  MemoryTargetAdapter,
  executeSyntheticMigration,
  openEncryptedRouteLedger,
} from "../etl/lib/executor.mjs";

const KEYRING = {
  kekId: "fixture-kek-v1",
  kek: Buffer.alloc(32, 0x55),
  hmacKeyId: "fixture-hmac-v1",
  hmacKey: Buffer.alloc(32, 0x66),
};

function captureMetadata(contract, watermark = "fixture-lsn") {
  return {
    deferrable: true,
    isolation_level: "SERIALIZABLE",
    locked_tables: contract.source_tables.map((table) => table.name),
    read_only: true,
    schema_revalidated_after_lock: true,
    server_version: "17.6",
    session_settings: contract.source_capture_contract.session_settings,
    snapshot_token_hmac: Buffer.alloc(32, 0x77).toString("base64url"),
    source_project_ref: contract.source_capture_contract.source_project_ref,
    source_watermark: watermark,
  };
}

function rowFor(table, suffix = "1") {
  return Object.fromEntries(table.fields.map((field) => [
    field.name,
    field.nullable ? null : `${field.name}-${suffix}`,
  ]));
}

test("S0 capture is logically deterministic, encrypted, and covers all 76 tables", async () => {
  const contract = await loadMigrationContract();
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-s0-"));
  const tableRows = Object.fromEntries(contract.source_tables.map((table) => [
    table.name,
    table.name === "appointments"
      ? [rowFor(table, "1"), rowFor(table, "2")]
      : table.migration_class === "B0" ? [] : [rowFor(table)],
  ]));
  const reverseOrderedRows = structuredClone(tableRows);
  reverseOrderedRows.appointments.reverse();
  const metadata = captureMetadata(contract);
  const first = await createEncryptedS0({
    fixtureMode: true,
    contract,
    tableRows: reverseOrderedRows,
    metadata,
    keyring: KEYRING,
    directory,
    filename: "first.s0.enc",
  });
  const second = await createEncryptedS0({
    fixtureMode: true,
    contract,
    tableRows,
    metadata,
    keyring: KEYRING,
    directory,
    filename: "second.s0.enc",
  });
  assert.equal(first.content_root, second.content_root);
  assert.equal(first.data_root, second.data_root);
  assert.notEqual(first.capture_id, second.capture_id);
  assert.notDeepEqual(await readFile(first.path), await readFile(second.path));
  const opened = await openEncryptedS0({ path: first.path, keyring: KEYRING, contract });
  assert.equal(Object.keys(opened.tables).length, 76);
  assert.equal(opened.manifest.source_table_fields, 759);
});

test("validate/transform/load/reconcile are fail-closed and same S0 load is zero DML", async () => {
  const contract = await loadMigrationContract();
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-executor-"));
  const tableRows = Object.fromEntries(contract.source_tables.map((table) => [
    table.name,
    table.name === "appointments" ? [rowFor(table)] : [],
  ]));
  const s0 = await createEncryptedS0({
    fixtureMode: true,
    contract,
    tableRows,
    metadata: captureMetadata(contract),
    keyring: KEYRING,
    directory,
    filename: "snapshot.s0.enc",
  });

  const validated = await executeSyntheticMigration({
    mode: "validate",
    contract,
    s0Path: s0.path,
    keyring: KEYRING,
  });
  assert.equal(validated.status, "SYNTHETIC_VALIDATED");

  const transformed = await executeSyntheticMigration({
    mode: "transform",
    contract,
    s0Path: s0.path,
    keyring: KEYRING,
    directory,
    outputFilename: "routes.enc",
    runtimeHandlers: {},
    exclusionResolutions: [],
  });
  assert.equal(transformed.counts.QUARANTINE, 1);
  assert.equal(transformed.counts.TARGET, 0);

  const adapter = new MemoryTargetAdapter({
    expectedCatalogFingerprint: contract.target_catalog_invariant.expected_catalog_fingerprint,
  });
  const firstLoad = await executeSyntheticMigration({
    mode: "load",
    contract,
    routeArtifactPath: transformed.path,
    s0Path: s0.path,
    keyring: KEYRING,
    targetAdapter: adapter,
  });
  assert.equal(firstLoad.status, "SYNTHETIC_PARTIAL");
  assert.equal(firstLoad.dml_count, 0);
  const secondLoad = await executeSyntheticMigration({
    mode: "load",
    contract,
    routeArtifactPath: transformed.path,
    s0Path: s0.path,
    keyring: KEYRING,
    targetAdapter: adapter,
  });
  assert.equal(secondLoad.status, "SYNTHETIC_NOOP");
  assert.equal(secondLoad.dml_count, 0);

  const reconciled = await executeSyntheticMigration({
    mode: "reconcile",
    contract,
    s0Path: s0.path,
    routeArtifactPath: transformed.path,
    keyring: KEYRING,
    targetAdapter: adapter,
  });
  assert.equal(reconciled.status, "SYNTHETIC_RECONCILED_PARTIAL_OR_EMPTY");
  assert.equal(reconciled.completion_blockers, 1);
  assert.equal(reconciled.source_occurrences, reconciled.routed_occurrences);
});

test("catchup is registered but blocked until a real ordered-watermark protocol exists", async () => {
  const contract = await loadMigrationContract();
  const adapter = new MemoryTargetAdapter({
    expectedCatalogFingerprint: contract.target_catalog_invariant.expected_catalog_fingerprint,
  });
  await assert.rejects(
    executeSyntheticMigration({
      mode: "catchup",
      contract,
      targetAdapter: adapter,
      fromWatermark: "same",
      toWatermark: "same",
    }),
    /catchup_not_implemented/,
  );
  assert.equal(adapter.catalogFingerprint, contract.target_catalog_invariant.expected_catalog_fingerprint);
  assert.equal(adapter.schemaDdlCount, 0);
});

test("synthetic executor rejects duck-typed adapters and cannot accept a database handle", async () => {
  const contract = await loadMigrationContract();
  await assert.rejects(
    executeSyntheticMigration({
      mode: "catchup",
      contract,
      targetAdapter: {
        applyRouteLedger() { throw new Error("must_not_run"); },
        catalogFingerprint: contract.target_catalog_invariant.expected_catalog_fingerprint,
        schemaDdlCount: 0,
      },
    }),
    /synthetic_adapter_required/,
  );
  class EvilAdapter extends MemoryTargetAdapter {
    applyRouteLedger() { throw new Error("must_not_run"); }
  }
  await assert.rejects(
    executeSyntheticMigration({
      mode: "catchup",
      contract,
      targetAdapter: new EvilAdapter({
        expectedCatalogFingerprint: contract.target_catalog_invariant.expected_catalog_fingerprint,
      }),
    }),
    /synthetic_adapter_required/,
  );
  const real = new MemoryTargetAdapter({
    expectedCatalogFingerprint: contract.target_catalog_invariant.expected_catalog_fingerprint,
  });
  assert.throws(
    () => Object.defineProperty(real, "applyRouteLedger", { value: () => ({ dml_count: 999 }) }),
    TypeError,
  );
  assert.throws(
    () => Object.defineProperty(MemoryTargetAdapter.prototype, "applyRouteLedger", {
      value: () => ({ dml_count: 999 }),
    }),
    TypeError,
  );
  let reads = 0;
  const statefulProxy = new Proxy(real, {
    get(target, property, receiver) {
      if (property === "applyRouteLedger") {
        reads += 1;
        if (reads > 1) return () => ({ dml_count: 999, status: "SUBSTITUTED" });
      }
      return Reflect.get(target, property, receiver);
    },
  });
  await assert.rejects(
    executeSyntheticMigration({
      mode: "catchup",
      contract,
      targetAdapter: statefulProxy,
    }),
    /synthetic_adapter_required/,
  );

  let accessorReads = 0;
  const accessorOptions = { mode: "catchup", contract };
  Object.defineProperty(accessorOptions, "targetAdapter", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return real;
    },
  });
  await assert.rejects(
    executeSyntheticMigration(accessorOptions),
    /synthetic_options_data_only/,
  );
  assert.equal(accessorReads, 0);
});

test("synthetic executor snapshots proxy options before adapter validation", async () => {
  const contract = await loadMigrationContract();
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-options-proxy-"));
  const tableRows = Object.fromEntries(contract.source_tables.map((table) => [
    table.name,
    table.name === "appointments" ? [rowFor(table)] : [],
  ]));
  const s0 = await createEncryptedS0({
    fixtureMode: true,
    contract,
    tableRows,
    metadata: captureMetadata(contract),
    keyring: KEYRING,
    directory,
    filename: "snapshot.s0.enc",
  });
  const transformed = await executeSyntheticMigration({
    mode: "transform",
    contract,
    s0Path: s0.path,
    keyring: KEYRING,
    directory,
    outputFilename: "routes.enc",
    runtimeHandlers: {},
    exclusionResolutions: [],
  });
  const adapter = new MemoryTargetAdapter({
    expectedCatalogFingerprint: contract.target_catalog_invariant.expected_catalog_fingerprint,
  });
  await executeSyntheticMigration({
    mode: "load",
    contract,
    routeArtifactPath: transformed.path,
    s0Path: s0.path,
    keyring: KEYRING,
    targetAdapter: adapter,
  });

  let adapterReads = 0;
  let substitutedStateReads = 0;
  const substitutedAdapter = {
    get appliedContentRoots() {
      substitutedStateReads += 1;
      return new Map();
    },
  };
  const proxiedOptions = new Proxy({
    mode: "load",
    contract,
    routeArtifactPath: transformed.path,
    s0Path: s0.path,
    keyring: KEYRING,
    targetAdapter: adapter,
  }, {
    get(target, property, receiver) {
      if (property === "targetAdapter") {
        adapterReads += 1;
        return adapterReads > 5 ? substitutedAdapter : adapter;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const result = await executeSyntheticMigration(proxiedOptions);
  assert.equal(result.status, "SYNTHETIC_NOOP");
  assert.equal(adapterReads, 0);
  assert.equal(substitutedStateReads, 0);
});

test("load rejects a self-consistent route artifact that omits an S0 occurrence", async () => {
  const contract = await loadMigrationContract();
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-omission-"));
  const tableRows = Object.fromEntries(contract.source_tables.map((table) => [
    table.name,
    table.name === "appointments" ? [rowFor(table)] : [],
  ]));
  const s0 = await createEncryptedS0({
    fixtureMode: true,
    contract,
    tableRows,
    metadata: captureMetadata(contract),
    keyring: KEYRING,
    directory,
    filename: "snapshot.s0.enc",
  });
  const transformed = await executeSyntheticMigration({
    mode: "transform",
    contract,
    s0Path: s0.path,
    keyring: KEYRING,
    directory,
    outputFilename: "routes.enc",
    runtimeHandlers: {},
    exclusionResolutions: [],
  });
  const forged = await openEncryptedRouteLedger({
    path: transformed.path,
    keyring: KEYRING,
    contract,
  });
  forged.logical.routes = [];
  forged.counts = { EXCLUSION: 0, QUARANTINE: 0, TARGET: 0 };
  const appointment = forged.tables.find((entry) => entry.table === "appointments");
  appointment.counts = { EXCLUSION: 0, QUARANTINE: 0, TARGET: 0 };
  appointment.source_occurrences = 0;
  appointment.route_root = domainHmac(
    KEYRING.hmacKey,
    "route-table-root:v1",
    canonicalizeJcs({ routes: [], table: "appointments" }),
  ).toString("base64url");
  appointment.source_occurrence_set_root = domainHmac(
    KEYRING.hmacKey,
    "s0-table-occurrences:v1",
    canonicalizeJcs({ occurrence_tokens: [], table: "appointments" }),
  ).toString("base64url");
  forged.route_content_root = domainHmac(
    KEYRING.hmacKey,
    "route-content-root:v1",
    canonicalizeJcs(forged.logical),
  ).toString("base64url");
  const plaintext = canonicalizeJcs(forged);
  const forgedArtifact = await writeEncryptedArtifact({
    artifactType: "R6_ROUTE_LEDGER",
    contentId: sha256Hex(plaintext),
    directory,
    filename: "forged-routes.enc",
    keyring: KEYRING,
    plaintext,
  });
  const adapter = new MemoryTargetAdapter({
    expectedCatalogFingerprint: contract.target_catalog_invariant.expected_catalog_fingerprint,
  });
  await assert.rejects(
    executeSyntheticMigration({
      mode: "load",
      contract,
      routeArtifactPath: forgedArtifact.path,
      s0Path: s0.path,
      keyring: KEYRING,
      targetAdapter: adapter,
    }),
    /load_route_conservation_violation/,
  );
});
