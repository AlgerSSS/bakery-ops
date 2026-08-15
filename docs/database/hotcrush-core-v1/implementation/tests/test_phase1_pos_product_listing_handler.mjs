import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeJcs, sha256Hex } from "../etl/lib/canonical.mjs";
import {
  BASE_CONTRACT_SHA256,
  HANDLER_ID,
  PHYSICAL_BACKFILL_STATUS,
  RELEASE_STATUS,
  SOURCE_SYSTEM_ID,
  TARGET_WRITER_ACTIVATION,
  buildListingId,
  loadPosProductListingRelease,
  recomputePosProductListingBatchRoot,
  transformPosProductListingBatch,
  verifyPosProductListingBatch,
  verifyPosProductListingReleaseArtifacts,
} from "../etl/batches/pos-product-listing-v1/handler.mjs";

const TARGET_COLUMNS = [
  "listing_id",
  "source_system_id",
  "location_id",
  "source_organization_id",
  "source_item_id",
  "source_item_key",
  "source_organization_type_code",
  "source_menu_item_code",
  "source_name",
  "source_name_en",
  "source_name_zh",
  "source_category",
  "source_category_id",
  "source_category_en",
  "source_category_zh",
  "source_specification",
  "current_price",
  "currency",
  "source_cost_card_id",
  "source_cost_spec_id",
  "source_has_cost_card",
  "source_total_cost",
  "source_theoretical_cost",
  "source_status_code",
  "display_name_override",
  "display_category_override",
  "is_active",
  "first_seen_at",
  "last_seen_at",
  "created_at",
  "updated_at",
];

function sourceRow(overrides = {}) {
  return {
    item_key: "1991027325256417283-7-33291",
    item_id: "33291",
    org_id: "1991027325256417283",
    org_type: "7",
    menu_item_code: "MI-003291",
    name_en: "Dark Chocolate Wellington",
    name_zh: "黑巧惠灵顿",
    category_id: "cat-8",
    category_en: "Bakery",
    category_zh: "烘焙",
    spec: "1 piece",
    sales_price: "28.0000",
    res_cost_card_id: "res-cc-33291",
    res_spec_id: "res-spec-8",
    has_cost_card: "t",
    res_total_cost: "9.650000",
    res_theoretical_cost: "9.420000",
    res_status: "1",
    first_seen_at: "2026-01-03 00:00:00+00",
    synced_at: "2026-08-11 02:19:36.332094+00",
    name_zh_display: null,
    category_display: "Wellington",
    ...overrides,
  };
}

function valueMap(intent) {
  return Object.fromEntries(intent.values.map((entry) => [entry.column, entry]));
}

function targetRoute(result, itemKey = "1991027325256417283-7-33291") {
  return result.routes.find((route) => route.source_item_key === itemKey);
}

function listingIntent(route) {
  assert.equal(route.target_intents.length, 1);
  assert.equal(route.target_intents[0].relation, "pos_product_listing");
  return route.target_intents[0];
}

function walk(value, visit) {
  visit(value);
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) walk(child, visit);
  }
}

function resealPublicRoots(result) {
  const forged = JSON.parse(JSON.stringify(result));
  forged.route_root_sha256 = sha256Hex(canonicalizeJcs(forged.routes));
  forged.target_intent_root_sha256 = sha256Hex(canonicalizeJcs({
    listing_intents: forged.routes.flatMap((route) => route.target_intents),
    seed_intent: forged.seed_intent,
  }));
  const body = { ...forged };
  delete body.canonical_root_sha256;
  forged.canonical_root_sha256 = sha256Hex(canonicalizeJcs(body));
  return forged;
}

function sealSelfHash(value) {
  const body = { ...value };
  delete body.self_sha256;
  return {
    ...body,
    self_sha256: sha256Hex(canonicalizeJcs(body)),
  };
}

function resealReleaseChain(artifactBytes, mutateAuthority) {
  let authority = JSON.parse(artifactBytes.authority.toString("utf8"));
  mutateAuthority(authority);
  authority = sealSelfHash(authority);
  const authorityBytes = canonicalizeJcs(authority);

  let release = JSON.parse(artifactBytes.release.toString("utf8"));
  release.authority_file_sha256 = sha256Hex(authorityBytes);
  release.authority_self_sha256 = authority.self_sha256;
  release = sealSelfHash(release);
  const releaseBytes = canonicalizeJcs(release);

  let pin = JSON.parse(artifactBytes.pin.toString("utf8"));
  pin.release_file_sha256 = sha256Hex(releaseBytes);
  pin.release_self_sha256 = release.self_sha256;
  pin = sealSelfHash(pin);

  return {
    ...artifactBytes,
    authority: authorityBytes,
    pin: canonicalizeJcs(pin),
    release: releaseBytes,
  };
}

test("the independently sealed release binds the approved authority and UUID vectors", () => {
  const release = loadPosProductListingRelease();
  assert.equal(BASE_CONTRACT_SHA256, "7ea542ef1e654b094628bbb97868b28a963879a4815740f7fa4f65c8c60d8587");
  assert.equal(HANDLER_ID, "pos_product_to_pos_product_listing_v1");
  assert.equal(RELEASE_STATUS, "TYPED_HANDLER_DRY_RUN_ONLY");
  assert.equal(PHYSICAL_BACKFILL_STATUS, "PHYSICAL_BACKFILL_NOT_STARTED");
  assert.equal(TARGET_WRITER_ACTIVATION, "NOT_ACTIVATED");
  assert.equal(SOURCE_SYSTEM_ID, "4dacf446-0060-57c4-90a9-ec8e784993b4");
  assert.equal(release.authority.source_system.source_code, "res_pos");
  assert.equal(release.authority.source_system.source_name, "Restosuite POS");
  assert.equal(release.authority.source_system.source_type, "API");
  assert.equal(release.authority.source_system.owner_project, "res_api");
  assert.equal(
    release.authority.source_system.authoritative_scope,
    "RES/POS商品目录、销售与会员来源事实",
  );
  assert.equal(release.authority.source_system.status, "ACTIVE");
  assert.match(release.pin.release_file_sha256, /^[0-9a-f]{64}$/);
  assert.equal(release.pin.external_anchor, "SOURCE_CONTROL_COMMIT");
  assert.equal(release.pin.signature_status, "UNSIGNED");
  assert.deepEqual(release.authority.target_relation_allowlist, [
    "app_source_system",
    "pos_product_listing",
  ]);
  assert.equal(
    buildListingId("1991027325256417283", "33291"),
    "bfa07530-1a0b-5020-8168-baa112ff7aa3",
  );
});

test("one eligible typed row produces an exact seed and all 31 listing fields", () => {
  const result = transformPosProductListingBatch([sourceRow()]);
  assert.equal(result.release_status, RELEASE_STATUS);
  assert.equal(result.physical_backfill_status, PHYSICAL_BACKFILL_STATUS);
  assert.equal(result.target_writer_activation, TARGET_WRITER_ACTIVATION);
  assert.deepEqual(result.counts, { QUARANTINE: 0, TARGET: 1 });
  assert.equal(result.seed_intent.relation, "app_source_system");
  assert.equal(result.seed_intent.operation, "ENSURE_EXACT");
  const seed = valueMap(result.seed_intent);
  assert.deepEqual(Object.keys(seed), [
    "source_system_id",
    "source_code",
    "source_name",
    "source_type",
    "owner_project",
    "authoritative_scope",
    "status",
    "created_at",
    "updated_at",
  ]);
  assert.equal(seed.source_system_id.raw, SOURCE_SYSTEM_ID);
  assert.equal(seed.created_at.kind, "OPCODE");
  assert.equal(seed.created_at.raw, "TARGET_TRANSACTION_TIMESTAMP");
  assert.equal(seed.updated_at.raw, "TARGET_TRANSACTION_TIMESTAMP");

  const route = targetRoute(result);
  assert.equal(route.outcome, "TARGET");
  assert.deepEqual(route.reason_codes, ["UNRESOLVED_SOURCE_ORGANIZATION"]);
  assert.equal(route.blocking_scope, "DOWNSTREAM_LOCATION_ACTIVATION");
  const intent = listingIntent(route);
  assert.equal(intent.operation, "ENSURE_EXACT");
  assert.deepEqual(intent.values.map((entry) => entry.column), TARGET_COLUMNS);
  const values = valueMap(intent);
  assert.equal(values.listing_id.raw, "bfa07530-1a0b-5020-8168-baa112ff7aa3");
  assert.equal(values.source_system_id.raw, SOURCE_SYSTEM_ID);
  assert.equal(values.location_id.kind, "NULL");
  assert.equal(values.location_id.raw, null);
  assert.equal(values.source_name.raw, "Dark Chocolate Wellington");
  assert.equal(values.source_name_en.raw, "Dark Chocolate Wellington");
  assert.equal(values.source_category.raw, "Bakery");
  assert.equal(values.source_category_en.raw, "Bakery");
  assert.equal(values.current_price.raw, "28.0000");
  assert.equal(values.source_total_cost.raw, "9.650000");
  assert.equal(values.source_theoretical_cost.raw, "9.420000");
  assert.equal(values.currency.raw, "MYR");
  assert.equal(values.source_has_cost_card.raw, "true");
  assert.equal(values.source_status_code.raw, "1");
  assert.equal(values.is_active.raw, "true");
  assert.equal(values.first_seen_at.raw, "2026-01-03 00:00:00+00");
  assert.equal(values.last_seen_at.raw, "2026-08-11 02:19:36.332094+00");
  assert.equal(values.created_at.kind, "OPCODE");
  assert.equal(values.created_at.raw, "TARGET_TRANSACTION_TIMESTAMP");
  assert.equal(values.updated_at.raw, "TARGET_TRANSACTION_TIMESTAMP");
  assert.ok(result.routes.every((entry) =>
    entry.target_intents.every((target) =>
      ["app_source_system", "pos_product_listing"].includes(target.relation)
    )
  ));
});

test("approved organizations are explicit and an unknown organization quarantines", () => {
  const otherApproved = sourceRow({
    item_key: "1990716608733069315-1-101",
    item_id: "101",
    org_id: "1990716608733069315",
    org_type: "1",
  });
  const unknown = sourceRow({
    item_key: "9999999999999999999-1-102",
    item_id: "102",
    org_id: "9999999999999999999",
    org_type: "1",
  });
  const result = transformPosProductListingBatch([otherApproved, unknown]);
  assert.deepEqual(result.counts, { QUARANTINE: 1, TARGET: 1 });
  assert.equal(targetRoute(result, otherApproved.item_key).outcome, "TARGET");
  const route = targetRoute(result, unknown.item_key);
  assert.equal(route.outcome, "QUARANTINE");
  assert.deepEqual(route.reason_codes, ["SOURCE_ORGANIZATION_NOT_APPROVED"]);
  assert.equal(route.target_intents.length, 0);
});

test("component mismatch and every row in a target identity collision are quarantined", () => {
  const mismatch = sourceRow({ item_key: "1991027325256417283-1-33291" });
  const collisionA = sourceRow({
    item_key: "1991027325256417283-7-A",
    item_id: "same-item",
  });
  const collisionB = sourceRow({
    item_key: "1991027325256417283-1-B",
    item_id: "same-item",
    org_type: "1",
  });
  const result = transformPosProductListingBatch([mismatch, collisionA, collisionB]);
  assert.equal(result.counts.TARGET, 0);
  assert.equal(result.counts.QUARANTINE, 3);
  assert.ok(targetRoute(result, mismatch.item_key).reason_codes.includes(
    "SOURCE_ITEM_KEY_COMPONENT_MISMATCH",
  ));
  for (const row of [collisionA, collisionB]) {
    assert.ok(targetRoute(result, row.item_key).reason_codes.includes(
      "TARGET_IDENTITY_GROUP_COLLISION",
    ));
  }
});

test("organization type preserves every canonical signed smallint without inventing an enum", () => {
  for (const orgType of ["-32768", "-1", "0", "32767"]) {
    const row = sourceRow({
      item_key: `1991027325256417283-${orgType}-33291`,
      org_type: orgType,
    });
    const result = transformPosProductListingBatch([row]);
    assert.equal(targetRoute(result, row.item_key).outcome, "TARGET");
    assert.equal(
      valueMap(listingIntent(targetRoute(result, row.item_key))).source_organization_type_code.raw,
      orgType,
    );
  }
  for (const orgType of ["-32769", "32768", "+1", "-0", "01"]) {
    const row = sourceRow({
      item_key: `1991027325256417283-${orgType}-33291`,
      org_type: orgType,
    });
    const route = targetRoute(transformPosProductListingBatch([row]), row.item_key);
    assert.equal(route.outcome, "QUARANTINE");
    assert.ok(route.reason_codes.includes("SOURCE_ORGANIZATION_TYPE_INVALID"));
  }
});

test("source identity components must be exact non-empty trimmed text", () => {
  for (const overrides of [
    { item_id: "", item_key: "1991027325256417283-7-" },
    { item_id: " 33291 ", item_key: "1991027325256417283-7- 33291 " },
    { org_id: "", item_key: "-7-33291" },
    { org_id: " 1991027325256417283 ", item_key: " 1991027325256417283 -7-33291" },
  ]) {
    const row = sourceRow(overrides);
    const route = targetRoute(transformPosProductListingBatch([row]), row.item_key);
    assert.equal(route.outcome, "QUARANTINE");
    assert.ok(route.reason_codes.includes("SOURCE_IDENTITY_COMPONENT_INVALID"));
  }
});

test("only source status 1 maps active; other and NULL statuses quarantine", () => {
  for (const status of ["0", "2", null]) {
    const row = sourceRow({ res_status: status });
    const result = transformPosProductListingBatch([row]);
    const route = targetRoute(result);
    assert.equal(route.outcome, "QUARANTINE");
    assert.deepEqual(route.reason_codes, ["SOURCE_STATUS_UNMAPPED"]);
    assert.equal(route.target_intents.length, 0);
  }
});

test("source primary-key and NOT NULL contract breaches hard fail the whole batch", () => {
  const duplicate = sourceRow();
  assert.throws(
    () => transformPosProductListingBatch([duplicate, { ...duplicate }]),
    /SOURCE_CONTRACT_BREACH:SOURCE_PRIMARY_KEY_DUPLICATE/,
  );
  assert.throws(
    () => transformPosProductListingBatch([sourceRow({ item_id: null })]),
    /SOURCE_CONTRACT_BREACH:SOURCE_NOT_NULL_VIOLATION:item_id/,
  );
  assert.throws(
    () => transformPosProductListingBatch([{ ...sourceRow(), unexpected: "x" }]),
    /SOURCE_CONTRACT_BREACH:SOURCE_ROW_SHAPE_MISMATCH/,
  );
});

test("numeric facts stay decimal wire text and invalid, non-finite, or negative values quarantine", () => {
  for (const [field, value] of [
    ["sales_price", "NaN"],
    ["sales_price", "Infinity"],
    ["sales_price", "1e3"],
    ["sales_price", "-0.0001"],
    ["res_total_cost", "-1.000000"],
    ["res_theoretical_cost", "+1.0"],
  ]) {
    const result = transformPosProductListingBatch([sourceRow({ [field]: value })]);
    const route = targetRoute(result);
    assert.equal(route.outcome, "QUARANTINE");
    assert.ok(route.reason_codes.includes("SOURCE_NUMERIC_INVALID"));
  }
  const valid = transformPosProductListingBatch([sourceRow({
    sales_price: "99999999.9999",
    res_total_cost: null,
    res_theoretical_cost: "99999999.999999",
  })]);
  const values = valueMap(listingIntent(targetRoute(valid)));
  assert.equal(values.current_price.raw, "99999999.9999");
  assert.equal(values.source_total_cost.raw, null);
  assert.equal(values.source_theoretical_cost.raw, "99999999.999999");
  walk(listingIntent(targetRoute(valid)).values, (value) => {
    assert.notEqual(typeof value, "number");
    assert.equal(value instanceof Date, false);
  });

  for (const [field, value] of [
    ["sales_price", "123456789"],
    ["sales_price", "1234567890123"],
    ["res_total_cost", "123456789"],
    ["res_theoretical_cost", "1234567890123"],
  ]) {
    const route = targetRoute(transformPosProductListingBatch([sourceRow({ [field]: value })]));
    assert.equal(route.outcome, "QUARANTINE");
    assert.ok(route.reason_codes.includes("SOURCE_NUMERIC_INVALID"));
  }
});

test("name, cost-card, boolean, and timestamp guards quarantine without inventing values", () => {
  for (const [overrides, reason] of [
    [{ name_en: " padded " }, "SOURCE_NAME_INVALID"],
    [{ name_en: "" }, "SOURCE_NAME_INVALID"],
    [{ has_cost_card: "t", res_cost_card_id: null }, "SOURCE_COST_CARD_INVARIANT"],
    [{ has_cost_card: "t", res_cost_card_id: "   " }, "SOURCE_COST_CARD_INVARIANT"],
    [{ has_cost_card: "yes" }, "SOURCE_BOOLEAN_INVALID"],
    [{ first_seen_at: "2026-02-30 00:00:00+00" }, "SOURCE_TIMESTAMP_INVALID"],
    [{ first_seen_at: "2026-08-12 00:00:00+00" }, "SOURCE_TIMESTAMP_ORDER_INVALID"],
  ]) {
    const result = transformPosProductListingBatch([sourceRow(overrides)]);
    const route = targetRoute(result);
    assert.equal(route.outcome, "QUARANTINE");
    assert.ok(route.reason_codes.includes(reason));
    assert.equal(route.target_intents.length, 0);
  }
});

test("output is deterministic, immutable, closed-shape, and independently root-verifiable", () => {
  const firstRow = sourceRow();
  const secondRow = sourceRow({
    item_key: "1990716608733069315-1-101",
    item_id: "101",
    org_id: "1990716608733069315",
    org_type: "1",
    has_cost_card: "f",
    res_cost_card_id: null,
  });
  const forward = transformPosProductListingBatch([firstRow, secondRow]);
  const reverse = transformPosProductListingBatch([secondRow, firstRow]);
  assert.deepEqual(forward, reverse);
  assert.equal(recomputePosProductListingBatchRoot(forward), forward.canonical_root_sha256);
  assert.equal(verifyPosProductListingBatch([firstRow, secondRow], forward), true);
  assert.throws(() => {
    forward.routes.push({});
  }, TypeError);
  assert.throws(() => {
    forward.routes[0].outcome = "QUARANTINE";
  }, TypeError);
  firstRow.name_en = "mutated after transform";
  assert.equal(valueMap(listingIntent(targetRoute(forward))).source_name.raw, "Dark Chocolate Wellington");

  const forged = JSON.parse(JSON.stringify(forward));
  forged.routes[0].outcome = "QUARANTINE";
  assert.throws(
    () => verifyPosProductListingBatch([sourceRow(), secondRow], forged),
    /BATCH_OUTPUT_MISMATCH/,
  );
  forged.extra = "not allowed";
  assert.throws(() => recomputePosProductListingBatchRoot(forged), /BATCH_SHAPE_MISMATCH/);
});

test("public roots cannot bless forged seed or 31-field target semantics", () => {
  const rows = [sourceRow()];
  const mutations = [
    (forged) => {
      valueMap(forged.seed_intent).source_code.raw = "forged_pos";
    },
    (forged) => {
      valueMap(forged.seed_intent).source_system_id.raw =
        "00000000-0000-0000-0000-000000000001";
    },
    (forged) => {
      valueMap(forged.routes[0].target_intents[0]).currency.raw = "USD";
    },
    (forged) => {
      valueMap(forged.routes[0].target_intents[0]).source_system_id.raw =
        "00000000-0000-0000-0000-000000000001";
    },
    (forged) => {
      valueMap(forged.routes[0].target_intents[0]).listing_id.raw =
        "00000000-0000-5000-8000-000000000001";
    },
    (forged) => {
      valueMap(forged.routes[0].target_intents[0]).source_item_key.raw =
        "1991027325256417283-7-forged";
    },
    (forged) => {
      forged.routes[0].source_payload_sha256 = "0".repeat(64);
    },
  ];
  for (const mutate of mutations) {
    const forged = JSON.parse(JSON.stringify(transformPosProductListingBatch(rows)));
    mutate(forged);
    assert.throws(
      () => verifyPosProductListingBatch(rows, resealPublicRoots(forged)),
      /BATCH_OUTPUT_MISMATCH/,
    );
  }
});

test("verification re-derives every route from the original source rows", () => {
  const validRows = [sourceRow()];
  const fakeQuarantine = JSON.parse(JSON.stringify(transformPosProductListingBatch(validRows)));
  fakeQuarantine.routes[0].blocking_scope = "PHYSICAL_BACKFILL";
  fakeQuarantine.routes[0].outcome = "QUARANTINE";
  fakeQuarantine.routes[0].reason_codes = ["SOURCE_NAME_INVALID"];
  fakeQuarantine.routes[0].target_intents = [];
  fakeQuarantine.counts = { QUARANTINE: 1, TARGET: 0 };
  assert.throws(
    () => verifyPosProductListingBatch(validRows, resealPublicRoots(fakeQuarantine)),
    /BATCH_OUTPUT_MISMATCH/,
  );

  const invalidRows = [sourceRow({ name_en: " padded " })];
  for (const mutate of [
    (forged) => { forged.routes[0].reason_codes = ["SOURCE_BOOLEAN_INVALID"]; },
    (forged) => { forged.routes[0].source_payload_sha256 = "f".repeat(64); },
  ]) {
    const forged = JSON.parse(JSON.stringify(transformPosProductListingBatch(invalidRows)));
    mutate(forged);
    assert.throws(
      () => verifyPosProductListingBatch(invalidRows, resealPublicRoots(forged)),
      /BATCH_OUTPUT_MISMATCH/,
    );
  }

  const collisionRows = [
    sourceRow({ item_key: "1991027325256417283-7-A", item_id: "same-item" }),
    sourceRow({ item_key: "1991027325256417283-1-B", item_id: "same-item", org_type: "1" }),
  ];
  const collisionResult = transformPosProductListingBatch(collisionRows);
  assert.ok(collisionResult.routes.every((route) => route.outcome === "QUARANTINE"));
  const forgedCollision = JSON.parse(JSON.stringify(collisionResult));
  forgedCollision.routes[0].reason_codes = [];
  assert.throws(
    () => verifyPosProductListingBatch(collisionRows, resealPublicRoots(forgedCollision)),
    /BATCH_OUTPUT_MISMATCH/,
  );
});

test("verification snapshots output without invoking accessors and rejects non-data drift", () => {
  const rows = [sourceRow()];
  const result = transformPosProductListingBatch(rows);

  assert.throws(
    () => verifyPosProductListingBatch(result),
    /SOURCE_CONTRACT_BREACH:SOURCE_BATCH_DATA_ONLY_REQUIRED/,
  );

  let sourceGetterReads = 0;
  const sourceAccessor = sourceRow();
  Object.defineProperty(sourceAccessor, "name_en", {
    enumerable: true,
    get() {
      sourceGetterReads += 1;
      return "stateful source";
    },
  });
  assert.throws(
    () => verifyPosProductListingBatch([sourceAccessor], result),
    /SOURCE_CONTRACT_BREACH:SOURCE_ROW_DATA_ONLY_REQUIRED/,
  );
  assert.equal(sourceGetterReads, 0);

  let proxyReads = 0;
  const proxy = new Proxy(result, {
    get(target, property, receiver) {
      proxyReads += 1;
      return Reflect.get(target, property, receiver);
    },
    getPrototypeOf(target) {
      proxyReads += 1;
      return Reflect.getPrototypeOf(target);
    },
  });
  assert.throws(
    () => verifyPosProductListingBatch(rows, proxy),
    /BATCH_OUTPUT_DATA_ONLY_REQUIRED/,
  );
  assert.equal(proxyReads, 0);

  let getterReads = 0;
  const accessor = JSON.parse(JSON.stringify(result));
  Object.defineProperty(accessor.routes[0], "reason_codes", {
    enumerable: true,
    get() {
      getterReads += 1;
      return ["UNRESOLVED_SOURCE_ORGANIZATION"];
    },
  });
  assert.throws(
    () => verifyPosProductListingBatch(rows, accessor),
    /BATCH_OUTPUT_DATA_ONLY_REQUIRED/,
  );
  assert.equal(getterReads, 0);

  const symbolDrift = JSON.parse(JSON.stringify(result));
  symbolDrift[Symbol("hidden")] = "drift";
  assert.throws(
    () => verifyPosProductListingBatch(rows, symbolDrift),
    /BATCH_OUTPUT_DATA_ONLY_REQUIRED/,
  );

  const sparse = JSON.parse(JSON.stringify(result));
  sparse.routes = new Array(result.routes.length);
  assert.throws(
    () => verifyPosProductListingBatch(rows, sparse),
    /BATCH_OUTPUT_DATA_ONLY_REQUIRED/,
  );

  const prototypeDrift = JSON.parse(JSON.stringify(result));
  Object.setPrototypeOf(prototypeDrift.routes[0], { drift: true });
  assert.throws(
    () => verifyPosProductListingBatch(rows, prototypeDrift),
    /BATCH_OUTPUT_DATA_ONLY_REQUIRED/,
  );
});

test("accessors and non-data input shapes are rejected without evaluating getters", () => {
  let reads = 0;
  const row = sourceRow();
  Object.defineProperty(row, "name_en", {
    enumerable: true,
    get() {
      reads += 1;
      return "getter value";
    },
  });
  assert.throws(
    () => transformPosProductListingBatch([row]),
    /SOURCE_CONTRACT_BREACH:SOURCE_ROW_DATA_ONLY_REQUIRED/,
  );
  assert.equal(reads, 0);
  const sparse = [];
  sparse.length = 1;
  assert.throws(
    () => transformPosProductListingBatch(sparse),
    /SOURCE_CONTRACT_BREACH:SOURCE_BATCH_DATA_ONLY_REQUIRED/,
  );
  assert.throws(
    () => transformPosProductListingBatch(new Proxy([sourceRow()], {})),
    /SOURCE_CONTRACT_BREACH:SOURCE_BATCH_DATA_ONLY_REQUIRED/,
  );
  assert.throws(
    () => transformPosProductListingBatch([new Proxy(sourceRow(), {})]),
    /SOURCE_CONTRACT_BREACH:SOURCE_ROW_DATA_ONLY_REQUIRED/,
  );
  assert.throws(
    () => loadPosProductListingRelease(new Proxy({ includeArtifactBytes: false }, {})),
    /RELEASE_LOAD_OPTIONS_DATA_ONLY_REQUIRED/,
  );

  for (const length of [100_001, 4_294_967_295]) {
    const oversizedSparse = [];
    oversizedSparse.length = length;
    assert.throws(
      () => transformPosProductListingBatch(oversizedSparse),
      /SOURCE_CONTRACT_BREACH:SOURCE_BATCH_TOO_LARGE/,
    );
  }
});

test("authority and release reject mutation, unknown keys, and stale handler pins", () => {
  const artifacts = loadPosProductListingRelease({ includeArtifactBytes: true });
  assert.equal(verifyPosProductListingReleaseArtifacts(artifacts.artifact_bytes), true);

  for (const name of ["authority", "release", "pin"]) {
    assert.deepEqual(
      artifacts.artifact_bytes[name],
      canonicalizeJcs(JSON.parse(artifacts.artifact_bytes[name].toString("utf8"))),
    );
  }

  const prettyRelease = Buffer.from(JSON.stringify(
    JSON.parse(artifacts.artifact_bytes.release.toString("utf8")),
    null,
    2,
  ));
  assert.throws(
    () => verifyPosProductListingReleaseArtifacts({
      ...artifacts.artifact_bytes,
      release: prettyRelease,
    }),
    /RELEASE_CANONICAL_JSON_REQUIRED/,
  );

  const authorityText = artifacts.artifact_bytes.authority.toString("utf8");
  const duplicateKeyAuthority = Buffer.from(`{"currency":"MYR",${authorityText.slice(1)}`);
  assert.throws(
    () => verifyPosProductListingReleaseArtifacts({
      ...artifacts.artifact_bytes,
      authority: duplicateKeyAuthority,
    }),
    /AUTHORITY_CANONICAL_JSON_REQUIRED/,
  );

  assert.throws(
    () => verifyPosProductListingReleaseArtifacts(resealReleaseChain(
      artifacts.artifact_bytes,
      (authority) => { authority.currency = "USD"; },
    )),
    /AUTHORITY_SEMANTIC_MISMATCH/,
  );

  const authority = JSON.parse(artifacts.artifact_bytes.authority.toString("utf8"));
  authority.currency = "USD";
  assert.throws(
    () => verifyPosProductListingReleaseArtifacts({
      ...artifacts.artifact_bytes,
      authority: Buffer.from(JSON.stringify(authority)),
    }),
    /AUTHORITY_(?:SELF_HASH|FILE_HASH)_MISMATCH/,
  );

  const release = JSON.parse(artifacts.artifact_bytes.release.toString("utf8"));
  release.unapproved = true;
  assert.throws(
    () => verifyPosProductListingReleaseArtifacts({
      ...artifacts.artifact_bytes,
      release: Buffer.from(JSON.stringify(release)),
    }),
    /RELEASE_SHAPE_MISMATCH/,
  );

  assert.throws(
    () => verifyPosProductListingReleaseArtifacts({
      ...artifacts.artifact_bytes,
      release: Buffer.concat([artifacts.artifact_bytes.release, Buffer.from("\n")]),
    }),
    /RELEASE_CANONICAL_JSON_REQUIRED/,
  );

  const pin = JSON.parse(artifacts.artifact_bytes.pin.toString("utf8"));
  pin.unapproved = true;
  assert.throws(
    () => verifyPosProductListingReleaseArtifacts({
      ...artifacts.artifact_bytes,
      pin: Buffer.from(JSON.stringify(pin)),
    }),
    /RELEASE_PIN_SHAPE_MISMATCH/,
  );

  assert.throws(
    () => verifyPosProductListingReleaseArtifacts({
      ...artifacts.artifact_bytes,
      handler: Buffer.concat([artifacts.artifact_bytes.handler, Buffer.from("\n// drift")]),
    }),
    /HANDLER_FILE_HASH_MISMATCH/,
  );
});
