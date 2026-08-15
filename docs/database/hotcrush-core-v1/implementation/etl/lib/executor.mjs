import { canonicalizeJcs, parseCanonicalJcs, sha256Hex } from "./canonical.mjs";
import { domainHmac } from "./identity.mjs";
import { readEncryptedArtifact, writeEncryptedArtifact } from "./envelope.mjs";
import { validateKeyring } from "./keys.mjs";
import { routeSourceRows } from "./router.mjs";
import { openEncryptedS0 } from "./s0.mjs";

const ROUTE_SCHEMA = "hotcrush.r6.route-ledger.synthetic-scaffold.v1";
const MEMORY_ADAPTER_BRAND = Symbol("hotcrush.synthetic-memory-target-adapter");
const MEMORY_ADAPTER_INSTANCES = new WeakSet();
const PHYSICAL_STATUS = "PHYSICAL_BACKFILL_NOT_STARTED";
const ROUTE_PAYLOAD_KEYS = ["counts", "logical", "route_content_root", "tables"];
const ROUTE_LOGICAL_KEYS = [
  "contract_sha256", "routes", "s0_content_root", "s0_data_root",
  "s0_occurrence_set_root", "schema",
];
const ROUTE_KEYS = [
  "blocking_scope", "hmac_key_id", "outcome", "reason_code", "source_identity_hmac",
  "source_occurrence_id", "source_payload_hmac", "source_row_id", "source_table", "target_intents",
];
const ROUTE_TABLE_KEYS = [
  "counts", "route_root", "source_occurrence_set_root", "source_occurrences", "table",
];

function snapshotSyntheticOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("synthetic_options_data_only");
  }
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("synthetic_options_data_only");
  }
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const snapshot = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") throw new TypeError("synthetic_options_data_only");
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, "value") || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError("synthetic_options_data_only");
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function contractHash(contract) {
  return sha256Hex(canonicalizeJcs(contract));
}

function exactKeys(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(code);
  }
}

function isDigest(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function routeCounts(routes) {
  const counts = { EXCLUSION: 0, QUARANTINE: 0, TARGET: 0 };
  for (const route of routes) {
    if (!Object.hasOwn(counts, route.outcome)) throw new TypeError("invalid_route_outcome");
    counts[route.outcome] += 1;
  }
  return counts;
}

async function transform({
  contract,
  s0Path,
  keyring,
  directory,
  outputFilename,
  runtimeHandlers,
  exclusionResolutions,
}) {
  const s0 = await openEncryptedS0({ path: s0Path, keyring, contract });
  const byTable = Object.fromEntries(contract.source_tables.map((table) => [
    table.name,
    routeSourceRows({
      contract,
      exclusionResolutions,
      hmacKey: keyring.hmacKey,
      hmacKeyId: keyring.hmacKeyId,
      rows: s0.tables[table.name],
      runtimeHandlers,
      tableName: table.name,
    }),
  ]));
  const routes = Object.values(byTable).flat()
    .sort((left, right) => left.source_occurrence_id < right.source_occurrence_id ? -1 : 1);
  const sourceOccurrences = Object.values(s0.tables).reduce((sum, rows) => sum + rows.length, 0);
  if (routes.length !== sourceOccurrences || new Set(routes.map((route) => route.source_occurrence_id)).size !== routes.length) {
    throw new TypeError("route_conservation_violation");
  }
  const logical = {
    contract_sha256: contractHash(contract),
    routes,
    s0_content_root: s0.content_root,
    s0_data_root: s0.data_root,
    s0_occurrence_set_root: s0.manifest.occurrence_set_root,
    schema: ROUTE_SCHEMA,
  };
  const routeContentRoot = domainHmac(
    keyring.hmacKey,
    "route-content-root:v1",
    canonicalizeJcs(logical),
  ).toString("base64url");
  const payload = {
    counts: routeCounts(routes),
    logical,
    route_content_root: routeContentRoot,
    tables: contract.source_tables.map((table) => ({
      counts: routeCounts(byTable[table.name]),
      route_root: domainHmac(
        keyring.hmacKey,
        "route-table-root:v1",
        canonicalizeJcs({ routes: byTable[table.name], table: table.name }),
      ).toString("base64url"),
      source_occurrence_set_root: domainHmac(
        keyring.hmacKey,
        "s0-table-occurrences:v1",
        canonicalizeJcs({
          occurrence_tokens: byTable[table.name].map((route) => ({
            source_identity_hmac: route.source_identity_hmac,
            source_occurrence_id: route.source_occurrence_id,
            source_payload_hmac: route.source_payload_hmac,
            source_row_id: route.source_row_id,
          })),
          table: table.name,
        }),
      ).toString("base64url"),
      source_occurrences: s0.tables[table.name].length,
      table: table.name,
    })),
  };
  const plaintext = canonicalizeJcs(payload);
  const receipt = await writeEncryptedArtifact({
    artifactType: "R6_ROUTE_LEDGER",
    contentId: sha256Hex(plaintext),
    directory,
    filename: outputFilename,
    keyring,
    plaintext,
  });
  return { ...receipt, counts: payload.counts, route_content_root: routeContentRoot };
}

async function openRoutes({ path, keyring, contract }) {
  const plaintext = await readEncryptedArtifact({
    expectedArtifactType: "R6_ROUTE_LEDGER",
    path,
    keyring,
  });
  const payload = parseCanonicalJcs(plaintext);
  exactKeys(payload, ROUTE_PAYLOAD_KEYS, "route_payload_shape_mismatch");
  exactKeys(payload.logical, ROUTE_LOGICAL_KEYS, "route_logical_shape_mismatch");
  if (payload?.logical?.schema !== ROUTE_SCHEMA || payload.logical.contract_sha256 !== contractHash(contract)) {
    throw new TypeError("route_contract_mismatch");
  }
  const expectedRoot = domainHmac(
    keyring.hmacKey,
    "route-content-root:v1",
    canonicalizeJcs(payload.logical),
  ).toString("base64url");
  if (expectedRoot !== payload.route_content_root) throw new TypeError("route_content_root_mismatch");
  const routes = payload.logical.routes;
  if (!Array.isArray(routes) || new Set(routes.map((route) => route.source_occurrence_id)).size !== routes.length) {
    throw new TypeError("route_conservation_violation");
  }
  const sourceTableNames = new Set(contract.source_tables.map((table) => table.name));
  for (const route of routes) {
    exactKeys(route, ROUTE_KEYS, "route_entry_shape_mismatch");
    if (
      route.hmac_key_id !== keyring.hmacKeyId || !isDigest(route.source_identity_hmac) ||
      !isDigest(route.source_payload_hmac) || !Array.isArray(route.target_intents) ||
      !sourceTableNames.has(route.source_table) ||
      !["EXCLUSION", "QUARANTINE", "TARGET"].includes(route.outcome) ||
      !/^[0-9a-f-]{36}$/.test(route.source_row_id) || !/^[0-9a-f-]{36}$/.test(route.source_occurrence_id)
    ) {
      throw new TypeError("route_entry_shape_mismatch");
    }
  }
  if (canonicalizeJcs(routeCounts(routes)).toString() !== canonicalizeJcs(payload.counts).toString()) {
    throw new TypeError("route_count_mismatch");
  }
  if (!Array.isArray(payload.tables) || payload.tables.length !== 76) throw new TypeError("route_table_manifest_mismatch");
  if (new Set(payload.tables.map((entry) => entry.table)).size !== 76 ||
      payload.tables.reduce((sum, entry) => sum + entry.source_occurrences, 0) !== routes.length) {
    throw new TypeError("route_table_manifest_mismatch");
  }
  for (const table of contract.source_tables) {
    const manifest = payload.tables.find((entry) => entry.table === table.name);
    exactKeys(manifest, ROUTE_TABLE_KEYS, "route_table_manifest_mismatch");
    const tableRoutes = routes.filter((route) => route.source_table === table.name);
    if (!manifest || manifest.source_occurrences !== tableRoutes.length ||
        canonicalizeJcs(manifest.counts).toString() !== canonicalizeJcs(routeCounts(tableRoutes)).toString()) {
      throw new TypeError("route_table_manifest_mismatch");
    }
    const expectedRoot = domainHmac(
      keyring.hmacKey,
      "route-table-root:v1",
      canonicalizeJcs({ routes: tableRoutes, table: table.name }),
    ).toString("base64url");
    if (manifest.route_root !== expectedRoot) throw new TypeError("route_table_manifest_mismatch");
    const expectedOccurrenceRoot = domainHmac(
      keyring.hmacKey,
      "s0-table-occurrences:v1",
      canonicalizeJcs({
        occurrence_tokens: tableRoutes.map((route) => ({
          source_identity_hmac: route.source_identity_hmac,
          source_occurrence_id: route.source_occurrence_id,
          source_payload_hmac: route.source_payload_hmac,
          source_row_id: route.source_row_id,
        })),
        table: table.name,
      }),
    ).toString("base64url");
    if (manifest.source_occurrence_set_root !== expectedOccurrenceRoot) {
      throw new TypeError("route_table_manifest_mismatch");
    }
  }
  return payload;
}

export class MemoryTargetAdapter {
  constructor({ expectedCatalogFingerprint }) {
    this.catalogFingerprint = expectedCatalogFingerprint;
    this.schemaDdlCount = 0;
    this.dmlCount = 0;
    this.appliedContentRoots = new Map();
    Object.defineProperty(this, MEMORY_ADAPTER_BRAND, { value: true });
    MEMORY_ADAPTER_INSTANCES.add(this);
    Object.freeze(this);
  }

  applyRouteLedger(payload) {
    const contentRoot = payload.logical.s0_content_root;
    const prior = this.appliedContentRoots.get(contentRoot);
    if (prior) {
      if (prior !== payload.route_content_root) throw new TypeError("same_s0_route_drift");
      return { completion_blockers: Math.max(1, payload.counts.QUARANTINE), dml_count: 0, status: "SYNTHETIC_NOOP" };
    }
    if (payload.counts.TARGET !== 0) throw new TypeError("production_target_handler_not_implemented");
    this.appliedContentRoots.set(contentRoot, payload.route_content_root);
    return {
      completion_blockers: Math.max(1, payload.counts.QUARANTINE),
      dml_count: 0,
      status: "SYNTHETIC_PARTIAL",
    };
  }
}
Object.freeze(MemoryTargetAdapter.prototype);

function assertSyntheticAdapter(adapter) {
  if (
    !MEMORY_ADAPTER_INSTANCES.has(adapter) ||
    Object.getPrototypeOf(adapter) !== MemoryTargetAdapter.prototype ||
    adapter[MEMORY_ADAPTER_BRAND] !== true ||
    adapter.applyRouteLedger !== MemoryTargetAdapter.prototype.applyRouteLedger
  ) {
    throw new TypeError("synthetic_adapter_required");
  }
}

export async function executeSyntheticMigration(options) {
  options = snapshotSyntheticOptions(options);
  const mode = options.mode;
  if (options.contract?.release_status !== PHYSICAL_STATUS) {
    throw new TypeError("physical_backfill_release_not_frozen");
  }
  if (!["catchup", "load", "reconcile", "transform", "validate"].includes(mode)) {
    throw new TypeError("unsupported_etl_mode");
  }
  if (options.targetAdapter !== undefined) assertSyntheticAdapter(options.targetAdapter);
  if (mode === "catchup") {
    throw new TypeError("catchup_not_implemented");
  }
  const keyring = validateKeyring(options.keyring);
  if (mode === "validate") {
    const s0 = await openEncryptedS0({ path: options.s0Path, keyring, contract: options.contract });
    return {
      content_root: s0.content_root,
      physical_backfill_status: PHYSICAL_STATUS,
      status: "SYNTHETIC_VALIDATED",
    };
  }
  if (mode === "transform") {
    return {
      ...await transform({ ...options, keyring }),
      physical_backfill_status: PHYSICAL_STATUS,
      status: "SYNTHETIC_TRANSFORMED_PARTIAL",
    };
  }
  assertSyntheticAdapter(options.targetAdapter);
  if (
      options.targetAdapter.catalogFingerprint !== options.contract.target_catalog_invariant.expected_catalog_fingerprint ||
      options.targetAdapter.schemaDdlCount !== 0) {
    throw new TypeError("target_catalog_invariant_failed");
  }
  const routes = await openRoutes({
    path: options.routeArtifactPath,
    keyring,
    contract: options.contract,
  });
  if (mode === "load") {
    const s0 = await openEncryptedS0({ path: options.s0Path, keyring, contract: options.contract });
    if (
      routes.logical.s0_content_root !== s0.content_root ||
      routes.logical.s0_data_root !== s0.data_root ||
      routes.logical.s0_occurrence_set_root !== s0.manifest.occurrence_set_root
    ) {
      throw new TypeError("load_s0_binding_mismatch");
    }
    for (const table of options.contract.source_tables) {
      const routeTable = routes.tables.find((entry) => entry.table === table.name);
      const s0Table = s0.manifest.tables.find((entry) => entry.table === table.name);
      if (
        !routeTable || !s0Table || routeTable.source_occurrences !== s0Table.row_count ||
        routeTable.source_occurrence_set_root !== s0Table.source_occurrence_set_root
      ) {
        throw new TypeError("load_route_conservation_violation");
      }
    }
    const result = MemoryTargetAdapter.prototype.applyRouteLedger.call(
      options.targetAdapter,
      routes,
    );
    return {
      ...result,
      load_components: options.contract.target_load_plan.components.length,
      load_waves: options.contract.target_load_plan.metrics.waves,
      physical_backfill_status: PHYSICAL_STATUS,
    };
  }
  const s0 = await openEncryptedS0({ path: options.s0Path, keyring, contract: options.contract });
  if (routes.logical.s0_content_root !== s0.content_root) throw new TypeError("reconcile_s0_mismatch");
  const sourceOccurrences = Object.values(s0.tables).reduce((sum, rows) => sum + rows.length, 0);
  if (sourceOccurrences !== routes.logical.routes.length) throw new TypeError("route_conservation_violation");
  for (const table of options.contract.source_tables) {
    const sourceCount = s0.tables[table.name].length;
    const routedCount = routes.logical.routes.filter((route) => route.source_table === table.name).length;
    if (sourceCount !== routedCount) throw new TypeError("route_table_conservation_violation");
  }
  return {
    completion_blockers: Math.max(1, routes.counts.QUARANTINE),
    physical_backfill_status: PHYSICAL_STATUS,
    routed_occurrences: routes.logical.routes.length,
    source_occurrences: sourceOccurrences,
    status: "SYNTHETIC_RECONCILED_PARTIAL_OR_EMPTY",
  };
}

export { openRoutes as openEncryptedRouteLedger, ROUTE_SCHEMA };
