import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeJcs, sha256Hex } from "../etl/lib/canonical.mjs";
import * as daily from "../etl/batches/daily-breakdown-v1/handler.mjs";
import * as hourly from "../etl/batches/hourly-sales-summary-v1/handler.mjs";
import * as itemHourly from "../etl/batches/item-hourly-sales-v1/handler.mjs";
import * as memberOrderItem from "../etl/batches/pos-member-order-item-v1/handler.mjs";
import * as memberDaily from "../etl/batches/pos-member-daily-v1/handler.mjs";
import * as cardTxn from "../etl/batches/pos-member-card-txn-v1/handler.mjs";

const LOCATION_ID = "23e9d2d4-f525-5e85-9e18-ad25aadb718c";
const BATCH_ID = "758664d3-e18d-51d0-8035-c811615389f4";
const LISTING_ID = "7c7d8100-8fc6-5c80-ae85-0969736fe572";

function sealSelfHash(value) {
  const body = { ...value };
  delete body.self_sha256;
  return { ...body, self_sha256: sha256Hex(canonicalizeJcs(body)) };
}

function resolutionArtifacts(handler, entries) {
  const authority = sealSelfHash({
    authority_mode: "SYNTHETIC_APPROVED_FIXTURE",
    base_contract_sha256: handler.BASE_CONTRACT_SHA256,
    entries,
    handler_id: handler.HANDLER_ID,
    schema: handler.RESOLUTION_AUTHORITY_SCHEMA,
  });
  const authorityBytes = canonicalizeJcs(authority);
  const pin = sealSelfHash({
    authority_file_sha256: sha256Hex(authorityBytes),
    authority_self_sha256: authority.self_sha256,
    base_contract_sha256: handler.BASE_CONTRACT_SHA256,
    external_anchor: "SYNTHETIC_TEST_FIXTURE",
    handler_id: handler.HANDLER_ID,
    schema: handler.RESOLUTION_PIN_SCHEMA,
    signature_status: "UNSIGNED",
  });
  return Object.freeze({
    authority: authorityBytes,
    pin: canonicalizeJcs(pin),
  });
}

function entryFor(handler, row, extra = {}) {
  return {
    source_key: handler.sourceOccurrenceKey(row),
    location_id: LOCATION_ID,
    pos_ingest_batch_id: BATCH_ID,
    ...extra,
  };
}

function valueMap(intent) {
  return Object.fromEntries(intent.values.map((entry) => [entry.column, entry]));
}

function onlyRoute(result) {
  assert.equal(result.routes.length, 1);
  return result.routes[0];
}

function targetValues(result, relation) {
  const route = onlyRoute(result);
  assert.equal(route.outcome, "TARGET");
  assert.equal(route.target_intents.length, 1);
  assert.equal(route.target_intents[0].relation, relation);
  return valueMap(route.target_intents[0]);
}

function dailyRow(overrides = {}) {
  return {
    date: "2026-08-08",
    dim_type: "payment",
    dim_value: "Cash",
    bill_count: null,
    net_sales: "123.45",
    ratio: "0.250000",
    ...overrides,
  };
}

function hourlyRow(overrides = {}) {
  return {
    id: "1",
    date: "2026-08-08",
    hour: "3",
    bill_count: "12",
    num_of_guests: "12",
    net_sales: "123.45",
    gross_sales: "130.00",
    avg_order_net_sales: "10.29",
    total_discount: "6.55",
    synced_at: "2026-08-09 00:03:00+08",
    ...overrides,
  };
}

function itemHourlyRow(overrides = {}) {
  return {
    id: "10",
    date: "2026-08-08",
    hour: "5",
    item_name: "Dark Chocolate Wellington",
    qty: "2",
    net_sales: "50.40",
    gross_sales: "56.00",
    synced_at: "2026-08-09 00:03:00+08",
    store: null,
    item_key: "1991027325256417283-7-33291",
    ...overrides,
  };
}

function memberOrderItemRow(overrides = {}) {
  return {
    order_id: "2086078328225419855",
    item_key: "1991027325256417283-7-33291",
    business_date: "2026-08-08",
    member_id: "81129",
    qty: "2.000",
    net_sales: "50.40",
    synced_at: "2026-08-09 00:03:00+08",
    ...overrides,
  };
}

function memberDailyRow(overrides = {}) {
  return {
    date: "2026-08-08",
    store: "吉隆坡Pavilion门店",
    new_member_count: "12",
    consumed_member_count: "186",
    recharged_member_count: "9",
    points_member_count: "142",
    member_consume_amount: "18000.00",
    total_consume_amount: "53680.00",
    member_consume_ratio: "0.3353",
    topup_cash: "800.00",
    topup_gift: "80.00",
    topup_face_value: "880.00",
    topup_count: "10",
    topup_refund: "-50.00",
    redeem_amount: "6250.00",
    redeem_cash: "5900.00",
    redeem_gift: "350.00",
    redeem_count: "128",
    consume_refund: "-50.00",
    adjust_net: "30000.00",
    card_payment_net: "6200.00",
    card_payment_ratio: "0.1155",
    net_stored_value_face: "24630.00",
    net_stored_value_cash: "850.00",
    balance_end_total: "48450.00",
    balance_end_cash: "40250.00",
    balance_end_gift: "8200.00",
    is_partial: "f",
    missing_sources: null,
    source: "member_flows+member_trends",
    fetched_at: "2026-08-09 00:03:00+08",
    topup_adjust_amount: "30000.00",
    adjust_correction: "0.00",
    topup_total: "30880.00",
    ...overrides,
  };
}

function cardTxnRow(overrides = {}) {
  return {
    txn_id: "txn_100150_88192",
    store: "吉隆坡Pavilion门店",
    pos_shop_id: "406994127",
    business_date: "2026-08-08",
    txn_at: "2026-08-08 15:00:00+08",
    member_id: "81129",
    card_no: "A1222",
    txn_type: "20",
    txn_type_label: "consume",
    money_amount: "100.00",
    gift_amount: "10.00",
    total_amount: "110.00",
    trade_amount: "110.00",
    before_money_balance: "220.00",
    after_money_balance: "120.00",
    before_gift_balance: "30.00",
    after_gift_balance: "20.00",
    point_delta: "-40",
    pos_order_no: "PAV-20260808-01892",
    order_id: "2086078328225419855",
    source_code: "CARD_CONSUME",
    source: "member_flows",
    fetched_at: "2026-08-09 00:03:00+08",
    ...overrides,
  };
}

const HANDLERS = [daily, hourly, itemHourly, memberOrderItem, memberDaily, cardTxn];

test("all six sidecars are independently sealed and remain dry-run only", () => {
  const ids = new Set();
  for (const handler of HANDLERS) {
    assert.equal(handler.RELEASE_STATUS, "TYPED_HANDLER_DRY_RUN_ONLY");
    assert.equal(handler.TARGET_WRITER_ACTIVATION, "NOT_ACTIVATED");
    assert.equal(handler.PHYSICAL_BACKFILL_STATUS, "PHYSICAL_BACKFILL_NOT_STARTED");
    assert.equal(handler.MAX_BATCH_ROWS, 100_000);
    assert.equal(handler.loadRelease().release.handler_id, handler.HANDLER_ID);
    assert.equal(handler.loadRelease().authority.resolution_authority.approved_real_entries, 0);
    assert.match(handler.loadRelease().pin.release_file_sha256, /^[0-9a-f]{64}$/);
    ids.add(handler.HANDLER_ID);
  }
  assert.equal(ids.size, 6);
});

test("daily payment maps exactly; dining remains quarantined even with synthetic authority", () => {
  const row = dailyRow();
  const artifacts = resolutionArtifacts(daily, [entryFor(daily, row)]);
  const result = daily.transformBatch([row], artifacts);
  const values = targetValues(result, "pos_daily_breakdown");
  assert.deepEqual(Object.keys(values), [
    "daily_breakdown_id", "pos_ingest_batch_id", "location_id", "business_date",
    "dimension_type", "dimension_value", "quantity", "quantity_unit", "gross_sales",
    "net_sales", "currency", "created_at",
  ]);
  assert.equal(values.business_date.raw, row.date);
  assert.equal(values.dimension_type.raw, "PAYMENT_METHOD");
  assert.equal(values.dimension_value.raw, "Cash");
  assert.equal(values.quantity.kind, "NULL");
  assert.equal(values.quantity_unit.kind, "NULL");
  assert.equal(values.gross_sales.kind, "NULL");
  assert.equal(values.net_sales.raw, "123.45");
  assert.equal(values.currency.raw, "MYR");
  assert.ok(!Object.hasOwn(values, "ratio"));

  const diningRow = dailyRow({ dim_type: "dining", dim_value: "Dine In", bill_count: "30", net_sales: null });
  const dining = daily.transformBatch(
    [diningRow],
    resolutionArtifacts(daily, [entryFor(daily, diningRow)]),
  );
  assert.equal(onlyRoute(dining).outcome, "QUARANTINE");
  assert.ok(onlyRoute(dining).reason_codes.includes("DINING_SOURCE_SEMANTICS_INVALID"));
  assert.deepEqual(onlyRoute(dining).target_intents, []);
});

test("hourly source facts preserve wire text and use only the pinned cutoff/offset fixture", () => {
  const row = hourlyRow();
  const artifacts = resolutionArtifacts(hourly, [entryFor(hourly, row, {
    business_day_cutoff_hour: "4",
    utc_offset_minutes: "480",
  })]);
  const result = hourly.transformBatch([row], artifacts);
  const values = targetValues(result, "pos_sales_hour");
  assert.deepEqual(Object.keys(values), [
    "sales_hour_id", "pos_ingest_batch_id", "location_id", "business_date",
    "hour_started_at", "currency", "gross_sales", "discount_amount", "net_sales",
    "order_count", "source_guest_count", "created_at",
  ]);
  assert.equal(values.business_date.raw, "2026-08-08");
  assert.equal(values.hour_started_at.raw, "2026-08-09T03:00:00+08:00");
  assert.equal(values.gross_sales.raw, "130.00");
  assert.equal(values.discount_amount.raw, "6.55");
  assert.equal(values.net_sales.raw, "123.45");
  assert.equal(values.order_count.raw, "12");
  assert.equal(values.source_guest_count.raw, "12");
  assert.ok(!Object.hasOwn(values, "avg_order_net_sales"));
  assert.ok(!Object.hasOwn(values, "synced_at"));
});

test("item-hourly maps an approved listing and quarantines null keys and target CHECK violations", () => {
  const row = itemHourlyRow();
  const artifacts = resolutionArtifacts(itemHourly, [entryFor(itemHourly, row, {
    business_day_cutoff_hour: "4",
    listing_id: LISTING_ID,
    utc_offset_minutes: "480",
  })]);
  const result = itemHourly.transformBatch([row], artifacts);
  const values = targetValues(result, "pos_item_sales_hour");
  assert.deepEqual(Object.keys(values), [
    "item_sales_hour_id", "pos_ingest_batch_id", "location_id", "listing_id",
    "business_date", "hour_started_at", "currency", "quantity", "gross_sales",
    "discount_amount", "net_sales", "source_name_snapshot", "created_at",
  ]);
  assert.equal(values.listing_id.raw, LISTING_ID);
  assert.equal(values.hour_started_at.raw, "2026-08-08T05:00:00+08:00");
  assert.equal(values.quantity.raw, "2");
  assert.equal(values.discount_amount.kind, "NULL");
  assert.equal(values.source_name_snapshot.raw, row.item_name);

  for (const bad of [
    itemHourlyRow({ id: "11", item_key: null }),
    itemHourlyRow({ id: "12", qty: "-1" }),
    itemHourlyRow({ id: "13", gross_sales: "-0.01" }),
  ]) {
    const badArtifacts = resolutionArtifacts(itemHourly, [entryFor(itemHourly, bad, {
      business_day_cutoff_hour: "4",
      listing_id: LISTING_ID,
      utc_offset_minutes: "480",
    })]);
    const route = onlyRoute(itemHourly.transformBatch([bad], badArtifacts));
    assert.equal(route.outcome, "QUARANTINE");
    assert.equal(route.target_intents.length, 0);
  }
});

test("legacy member-order-item is all-quarantine pending raw Report211 recapture", () => {
  const row = memberOrderItemRow();
  const result = memberOrderItem.transformBatch([row]);
  const route = onlyRoute(result);
  assert.deepEqual(result.counts, { QUARANTINE: 1, TARGET: 0 });
  assert.equal(result.seed_intent, null);
  assert.equal(route.outcome, "QUARANTINE");
  assert.deepEqual(route.reason_codes, [
    "SOURCE_ROW_COUNT_UNAVAILABLE",
    "RAW_RES_RECAPTURE_REQUIRED",
  ]);
  assert.deepEqual(route.target_intents, []);
  assert.equal(memberOrderItem.loadRelease().authority.target_write_blocker, "SOURCE_ROW_COUNT_UNAVAILABLE");
  assert.equal(memberOrderItem.loadRelease().authority.remediation_blocker, "RAW_RES_RECAPTURE_REQUIRED");
});

test("member daily stores only irreducible source measures and never copies derived ratios/net values", () => {
  const row = memberDailyRow();
  const artifacts = resolutionArtifacts(memberDaily, [entryFor(memberDaily, row)]);
  const result = memberDaily.transformBatch([row], artifacts);
  const values = targetValues(result, "pos_member_daily_metric");
  assert.equal(values.business_date.raw, row.date);
  assert.equal(values.member_sales.raw, row.member_consume_amount);
  assert.equal(values.total_consume_amount.raw, row.total_consume_amount);
  assert.equal(values.stored_value_cash_net.raw, row.net_stored_value_cash);
  assert.equal(values.topup_adjust_amount.raw, row.topup_adjust_amount);
  assert.equal(values.adjust_correction.raw, row.adjust_correction);
  assert.equal(values.currency.raw, "MYR");
  for (const omitted of [
    "member_consume_ratio", "card_payment_net", "card_payment_ratio",
    "net_stored_value_face", "topup_total", "is_partial", "missing_sources",
    "source", "fetched_at",
  ]) {
    assert.ok(!Object.hasOwn(values, omitted));
  }
});

test("card transaction preserves source IDs/amounts and standardizes only the proven code+label pairs", () => {
  const row = cardTxnRow();
  const artifacts = resolutionArtifacts(cardTxn, [entryFor(cardTxn, row)]);
  const result = cardTxn.transformBatch([row], artifacts);
  const values = targetValues(result, "pos_member_card_transaction");
  assert.equal(values.member_id.kind, "NULL");
  assert.equal(values.source_member_id.raw, row.member_id);
  assert.equal(values.member_card_id.kind, "NULL");
  assert.equal(values.source_card_id.raw, row.card_no);
  assert.equal(values.source_transaction_type_code.raw, "20");
  assert.equal(values.source_transaction_type_label.raw, "consume");
  assert.equal(values.transaction_type.raw, "CONSUME");
  assert.equal(values.occurred_at.raw, row.txn_at);
  assert.equal(values.cash_amount.raw, row.money_amount);
  assert.equal(values.source_order_id.raw, row.order_id);
  assert.equal(values.order_id.kind, "NULL");
  assert.ok(!Object.hasOwn(values, "source"));
  assert.ok(!Object.hasOwn(values, "fetched_at"));

  const unknown = cardTxnRow({ txn_id: "txn-unknown", txn_type: "99", txn_type_label: "unknown" });
  const unknownResult = cardTxn.transformBatch(
    [unknown],
    resolutionArtifacts(cardTxn, [entryFor(cardTxn, unknown)]),
  );
  assert.equal(onlyRoute(unknownResult).outcome, "TARGET");
  assert.deepEqual(onlyRoute(unknownResult).reason_codes, ["TRANSACTION_TYPE_UNKNOWN"]);
  assert.equal(targetValues(unknownResult, "pos_member_card_transaction").transaction_type.raw, "UNKNOWN");
});

test("without a separately pinned occurrence authority every location-dependent target is quarantined", () => {
  for (const [handler, row] of [
    [daily, dailyRow()],
    [hourly, hourlyRow()],
    [itemHourly, itemHourlyRow()],
    [memberDaily, memberDailyRow()],
    [cardTxn, cardTxnRow()],
  ]) {
    const result = handler.transformBatch([row]);
    const route = onlyRoute(result);
    assert.equal(route.outcome, "QUARANTINE");
    assert.ok(route.reason_codes.includes("LOCATION_AUTHORITY_MISSING"));
    assert.deepEqual(route.target_intents, []);
    assert.equal(result.seed_intent, null);
  }
});

test("source, route, intent, and canonical roots are deterministic and independently rebuilt", () => {
  const row = dailyRow();
  const artifacts = resolutionArtifacts(daily, [entryFor(daily, row)]);
  const result = daily.transformBatch([row], artifacts);
  for (const field of [
    "source_root_sha256", "route_root_sha256", "target_intent_root_sha256", "canonical_root_sha256",
  ]) assert.match(result[field], /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.routes), true);
  assert.equal(Object.isFrozen(result.routes[0].target_intents[0].values), true);
  assert.equal(daily.recomputeBatchRoot(result), result.canonical_root_sha256);
  assert.equal(daily.verifyBatch([row], result, artifacts), true);

  const forged = JSON.parse(JSON.stringify(result));
  valueMap(forged.routes[0].target_intents[0]).currency.raw = "USD";
  forged.route_root_sha256 = sha256Hex(canonicalizeJcs(forged.routes));
  forged.target_intent_root_sha256 = sha256Hex(canonicalizeJcs({
    seed_intent: forged.seed_intent,
    target_intents: forged.routes.flatMap((route) => route.target_intents),
  }));
  const body = { ...forged };
  delete body.canonical_root_sha256;
  forged.canonical_root_sha256 = sha256Hex(canonicalizeJcs(body));
  assert.throws(() => daily.verifyBatch([row], forged, artifacts), /BATCH_OUTPUT_MISMATCH/);
});

test("cross-chunk source duplicates hard fail and target collisions quarantine every occurrence", () => {
  const duplicate = hourlyRow();
  assert.throws(
    () => hourly.transformChunks([[duplicate], [{ ...duplicate }]]),
    /SOURCE_CONTRACT_BREACH:SOURCE_PRIMARY_KEY_DUPLICATE/,
  );

  const first = hourlyRow({ id: "1" });
  const second = hourlyRow({ id: "2" });
  const artifacts = resolutionArtifacts(hourly, [first, second].map((row) => entryFor(hourly, row, {
    business_day_cutoff_hour: "4",
    utc_offset_minutes: "480",
  })));
  const result = hourly.transformChunks([[first], [second]], artifacts);
  assert.deepEqual(result.counts, { QUARANTINE: 2, TARGET: 0 });
  assert.ok(result.routes.every((route) => route.reason_codes.includes("TARGET_IDENTITY_COLLISION")));
  assert.equal(hourly.verifyChunks([[second], [first]], result, artifacts), true);
});

test("source-contract breaches hard fail; semantic/target issues quarantine only their occurrences", () => {
  assert.throws(
    () => daily.transformBatch([{ ...dailyRow(), extra: "x" }]),
    /SOURCE_CONTRACT_BREACH:SOURCE_ROW_SHAPE_MISMATCH/,
  );
  assert.throws(
    () => daily.transformBatch([dailyRow({ date: null })]),
    /SOURCE_CONTRACT_BREACH:SOURCE_NOT_NULL_VIOLATION:date/,
  );
  assert.throws(
    () => daily.transformBatch([dailyRow(), { ...dailyRow() }]),
    /SOURCE_CONTRACT_BREACH:SOURCE_PRIMARY_KEY_DUPLICATE/,
  );

  for (const [handler, good, bad, reason] of [
    [hourly, hourlyRow({ id: "1" }), hourlyRow({ id: "2", bill_count: "-1" }), "TARGET_CHECK_VIOLATION"],
    [memberDaily, memberDailyRow({ date: "2026-08-08" }), memberDailyRow({ date: "2026-08-09", topup_count: "-1" }), "TARGET_CHECK_VIOLATION"],
    [cardTxn, cardTxnRow({ txn_id: "good" }), cardTxnRow({ txn_id: "bad", txn_type_label: "topup" }), "SOURCE_TRANSACTION_TYPE_MISMATCH"],
  ]) {
    const rows = [good, bad];
    const entries = rows.map((row) => entryFor(handler, row, handler === hourly ? {
      business_day_cutoff_hour: "4",
      utc_offset_minutes: "480",
    } : {}));
    const result = handler.transformBatch(rows, resolutionArtifacts(handler, entries));
    assert.deepEqual(result.counts, { QUARANTINE: 1, TARGET: 1 });
    const badRoute = result.routes.find((route) => route.source_key === handler.sourceOccurrenceKey(bad));
    assert.ok(badRoute.reason_codes.includes(reason));
  }
});

test("proxy/accessor/symbol/sparse/prototype drift is rejected without executing hostile getters", () => {
  let reads = 0;
  const accessor = dailyRow();
  Object.defineProperty(accessor, "dim_value", {
    enumerable: true,
    get() {
      reads += 1;
      return "Cash";
    },
  });
  assert.throws(
    () => daily.transformBatch([accessor]),
    /SOURCE_CONTRACT_BREACH:SOURCE_ROW_DATA_ONLY_REQUIRED/,
  );
  assert.equal(reads, 0);
  assert.throws(
    () => daily.transformBatch(new Proxy([dailyRow()], {})),
    /SOURCE_CONTRACT_BREACH:SOURCE_BATCH_DATA_ONLY_REQUIRED/,
  );
  const symbolRow = dailyRow();
  symbolRow[Symbol("hidden")] = "x";
  assert.throws(
    () => daily.transformBatch([symbolRow]),
    /SOURCE_CONTRACT_BREACH:SOURCE_ROW_SHAPE_MISMATCH/,
  );
  const sparse = [];
  sparse.length = 1;
  assert.throws(
    () => daily.transformBatch(sparse),
    /SOURCE_CONTRACT_BREACH:SOURCE_BATCH_DATA_ONLY_REQUIRED/,
  );
  const prototype = dailyRow();
  Object.setPrototypeOf(prototype, { polluted: true });
  assert.throws(
    () => daily.transformBatch([prototype]),
    /SOURCE_CONTRACT_BREACH:SOURCE_ROW_DATA_ONLY_REQUIRED/,
  );

  const oversized = [];
  oversized.length = 100_001;
  assert.throws(
    () => daily.transformBatch(oversized),
    /SOURCE_CONTRACT_BREACH:SOURCE_BATCH_TOO_LARGE/,
  );
});

test("release and injected authority hashes fail closed", () => {
  const loaded = daily.loadRelease({ includeArtifactBytes: true });
  assert.equal(daily.verifyReleaseArtifacts(loaded.artifact_bytes), true);
  assert.throws(
    () => daily.verifyReleaseArtifacts({
      ...loaded.artifact_bytes,
      handler: Buffer.concat([loaded.artifact_bytes.handler, Buffer.from("\n// drift")]),
    }),
    /HANDLER_FILE_HASH_MISMATCH/,
  );

  const row = dailyRow();
  const artifacts = resolutionArtifacts(daily, [entryFor(daily, row)]);
  const forged = {
    ...artifacts,
    authority: Buffer.concat([artifacts.authority, Buffer.from("\n")]),
  };
  assert.throws(
    () => daily.transformBatch([row], forged),
    /RESOLUTION_AUTHORITY_CANONICAL_JSON_REQUIRED/,
  );
});
