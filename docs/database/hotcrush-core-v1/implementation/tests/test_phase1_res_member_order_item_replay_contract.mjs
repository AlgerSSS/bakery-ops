import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REPLAY_AUTHORITY,
  CATALOG_SUPPLEMENT_CONTRACT,
  IMPLEMENTATION_STATUS,
  PHYSICAL_BACKFILL_STATUS,
  REPORT211_CONTRACT,
  analyzeCatalogSupplementRawResponse,
  analyzeReport211RawResponse,
  buildCatalogSupplementRequest,
  buildReport211Request,
} from "../etl/res-replay/member-order-item-v1/index.mjs";

function cell(value) {
  return { displayValue: value === null ? "" : String(value), value };
}

function syntheticRow({
  businessDate = "2026-08-08",
  currency = "MYR",
  itemId,
  itemName,
  member = "true",
  netSales = "2.50",
  orderId,
  qty = "1.000",
  reversalOrder = "0",
  shopId = "406994127",
}) {
  return {
    D_businessDate: cell(businessDate),
    D_shopId: cell(shopId),
    D_currency: cell(currency),
    D_orderId: cell(orderId),
    D_posOrderId: cell(`POS_${orderId}`),
    D_itemId: cell(itemId),
    D_menuItemId: cell(`MENU_${itemName}`),
    D_itemName: cell(itemName),
    D_unitId: cell("SYNTH_UNIT_ID"),
    D_unit: cell("SYNTH_UNIT"),
    D_orderStatus: cell("20"),
    D_reversal_order: cell(reversalOrder),
    D_isMemberConsume: cell(member),
    D_openedTime: cell(`${businessDate} 09:00:00`),
    D_orderDishesTime: cell(`${businessDate} 09:01:00`),
    D_checkoutTime: cell(`${businessDate} 09:02:00`),
    M_Item_SUM_qty: cell(qty.startsWith("-") ? qty.slice(1) : qty),
    M_Item_SUM_netQty: cell(qty),
    M_Item_SUM_netSales: cell(netSales),
    M_Item_SUM_grossSales: cell(netSales.startsWith("-") ? netSales.slice(1) : netSales),
    M_Item_SUM_discountProm: cell("0.00"),
    M_Item_SUM_refundQty: cell(qty.startsWith("-") ? qty.slice(1) : "0.000"),
    M_Item_SUM_refundAmount: cell(netSales.startsWith("-") ? netSales.slice(1) : "0.00"),
  };
}

function rawResponse(rows, { total = rows.length, code = "000" } = {}) {
  return Buffer.from(JSON.stringify({
    code,
    data: { page: { total }, rows },
    msg: code === "000" ? "ok" : "synthetic failure",
  }));
}

function syntheticCatalogRow({ itemName, itemCode = `CODE_${itemName}` }) {
  return {
    D_itemName: cell(itemName),
    D_menuItemId: cell(`MENU_${itemName}`),
    D_itemCode: cell(itemCode),
    D_baseItemName: cell(`BASE_${itemName}`),
    D_category: cell("SYNTH_CATEGORY"),
    D_unitId: cell("SYNTH_UNIT_ID"),
    D_unit: cell("SYNTH_UNIT"),
    D_itemType: cell("SYNTH_ITEM_TYPE"),
  };
}

test("release status and final full-history line-key authority stay explicit", () => {
  assert.equal(IMPLEMENTATION_STATUS, "IMPLEMENTED_NOT_EXECUTED");
  assert.equal(PHYSICAL_BACKFILL_STATUS, "PHYSICAL_BACKFILL_NOT_STARTED");
  assert.deepEqual(
    DEFAULT_REPLAY_AUTHORITY.stable_line_identity.fields,
    ["D_shopId", "D_orderId", "D_itemId", "D_reversal_order"],
  );
  assert.equal(DEFAULT_REPLAY_AUTHORITY.stable_line_identity.status, "APPROVED_FULL_HISTORY_PROBE");
  assert.equal(DEFAULT_REPLAY_AUTHORITY.stable_line_identity.d_item_id_alone_approved, false);
  assert.equal(DEFAULT_REPLAY_AUTHORITY.execution.status, "NOT_APPROVED_NOT_EXECUTED");
  assert.deepEqual(DEFAULT_REPLAY_AUTHORITY.probe.range, ["2026-01-01", "2026-08-08"]);
  assert.equal(DEFAULT_REPLAY_AUTHORITY.probe.response_rows, 46_662);
  assert.equal(DEFAULT_REPLAY_AUTHORITY.probe.distinct_composite_line_keys, 46_662);
  assert.equal(DEFAULT_REPLAY_AUTHORITY.probe.distinct_composite_conflicts, 0);
  assert.equal(DEFAULT_REPLAY_AUTHORITY.probe.composite_null_rows, 0);
  assert.equal(DEFAULT_REPLAY_AUTHORITY.probe.aggregate_groups, 44_484);
  assert.deepEqual(DEFAULT_REPLAY_AUTHORITY.probe.aggregate_source_row_count_distribution, {
    "1": 42_660,
    "2": 1_573,
    "3": 179,
    "4": 60,
    "5": 5,
    "6": 5,
    "12": 2,
  });
  assert.deepEqual(DEFAULT_REPLAY_AUTHORITY.probe.quantity_groups, {
    negative: 485,
    positive: 43_997,
    zero: 2,
  });
  assert.deepEqual(DEFAULT_REPLAY_AUTHORITY.probe.positive_only_totals, {
    net_qty: "55974",
    net_sales: "438756.90",
  });
  assert.deepEqual(DEFAULT_REPLAY_AUTHORITY.probe.all_quantity_totals, {
    net_qty: "55331",
    net_sales: "433247.43",
  });
  assert.deepEqual(DEFAULT_REPLAY_AUTHORITY.probe.legacy_omission_delta, {
    net_qty: "-643",
    net_sales: "-5509.47",
  });
  assert.deepEqual(DEFAULT_REPLAY_AUTHORITY.probe.missing_current_product_listing, {
    raw_rows: 3,
    source_item_keys: 2,
  });
  assert.equal(
    DEFAULT_REPLAY_AUTHORITY.probe.canonical_row_digest_sha256,
    "2dcffa1fad936678d3ddc460d1d7289c23615d5cc2b4c39c8229ad961f0a20b0",
  );
});

test("query is one fixed read-only daily page and requests the raw stable line fields", () => {
  const query = buildReport211Request({ businessDate: "2026-08-08" });
  assert.equal(query.endpoint, "https://bo.sea.restosuite.ai/api/report/data/queryData");
  assert.equal(query.body.reportId, "211");
  assert.deepEqual(query.body.page, { pageNo: 1, pageSize: 2_000 });
  assert.deepEqual(query.body.selectFields, [
    "D_businessDate", "D_shopId", "D_currency", "D_orderId", "D_posOrderId",
    "D_itemId", "D_menuItemId", "D_itemName", "D_unitId", "D_unit",
    "D_orderStatus", "D_reversal_order", "D_isMemberConsume", "D_openedTime",
    "D_orderDishesTime", "D_checkoutTime", "M_Item_SUM_qty", "M_Item_SUM_netQty",
    "M_Item_SUM_netSales", "M_Item_SUM_grossSales", "M_Item_SUM_discountProm",
    "M_Item_SUM_refundQty", "M_Item_SUM_refundAmount",
  ]);
  assert.deepEqual(query.body.selectFields, REPORT211_CONTRACT.select_fields);
  assert.ok(query.body.selectFields.includes("D_itemId"));
  assert.ok(query.body.selectFields.includes("D_reversal_order"));
  assert.equal(query.body.selectFields.some((name) => /phone|customerName|email/i.test(name)), false);
  assert.deepEqual(query.body.filters, [
    { fieldName: "D_businessDate", filterType: "RANGE", filterValue: ["2026-08-08", "2026-08-08"] },
    { fieldName: "D_currency", filterType: "EQ", filterValue: ["MYR"] },
    { fieldName: "D_shopId", filterType: "IN", filterValue: ["406994127"] },
    { fieldName: "D_isMemberConsume", filterType: "IN", filterValue: ["true"] },
  ]);
  assert.throws(() => buildReport211Request({ businessDate: "2026-02-30" }), /invalid_business_date/);
});

test("catalog supplement is a separate complete daily query with local exact-key filtering only", () => {
  const query = buildCatalogSupplementRequest({ businessDate: "2026-08-08" });
  assert.deepEqual(query.body.selectFields, [
    "D_itemName", "D_menuItemId", "D_itemCode", "D_baseItemName",
    "D_category", "D_unitId", "D_unit", "D_itemType",
  ]);
  assert.deepEqual(query.body.selectFields, CATALOG_SUPPLEMENT_CONTRACT.select_fields);
  assert.deepEqual(query.body.page, { pageNo: 1, pageSize: 2_000 });
  assert.equal(query.body.filters.some((filter) => filter.fieldName === "D_itemName"), false);
  assert.deepEqual(query.body.filters, [
    { fieldName: "D_businessDate", filterType: "RANGE", filterValue: ["2026-08-08", "2026-08-08"] },
    { fieldName: "D_currency", filterType: "EQ", filterValue: ["MYR"] },
    { fieldName: "D_shopId", filterType: "IN", filterValue: ["406994127"] },
    { fieldName: "D_isMemberConsume", filterType: "IN", filterValue: ["true"] },
  ]);
});

test("catalog supplement resolves exact local keys, blocks conflicts, and never paginates", () => {
  const analysis = analyzeCatalogSupplementRawResponse({
    businessDate: "2026-08-08",
    missingItemKeys: ["SYNTH_MISSING_ITEM"],
    rawBody: rawResponse([
      syntheticCatalogRow({ itemName: "SYNTH_MISSING_ITEM" }),
      syntheticCatalogRow({ itemName: "SYNTH_UNRELATED_ITEM" }),
    ]),
  });
  assert.deepEqual(analysis.resolved_item_keys, ["SYNTH_MISSING_ITEM"]);
  assert.deepEqual(analysis.unresolved_item_keys, []);
  assert.equal(analysis.page_stats.response_row_count, 2);
  assert.equal(analysis.page_stats.selected_seed_row_count, 1);
  assert.equal(analysis.page_stats.unrelated_response_row_count, 1);
  assert.equal(Object.hasOwn(analysis.page_stats, "source_row_count"), false);

  const conflicted = analyzeCatalogSupplementRawResponse({
    businessDate: "2026-08-08",
    missingItemKeys: ["SYNTH_MISSING_ITEM"],
    rawBody: rawResponse([
      syntheticCatalogRow({ itemName: "SYNTH_MISSING_ITEM", itemCode: "SYNTH_CODE_A" }),
      syntheticCatalogRow({ itemName: "SYNTH_MISSING_ITEM", itemCode: "SYNTH_CODE_B" }),
    ]),
  });
  assert.deepEqual(conflicted.conflicting_item_keys, ["SYNTH_MISSING_ITEM"]);
  assert.deepEqual(conflicted.seed_rows, []);
  assert.deepEqual(conflicted.target_blockers, [
    "CATALOG_SUPPLEMENT_UNRESOLVED_LISTING_KEYS",
  ]);
  assert.throws(() => analyzeCatalogSupplementRawResponse({
    businessDate: "2026-08-08",
    missingItemKeys: ["SYNTH_MISSING_ITEM"],
    rawBody: rawResponse([syntheticCatalogRow({ itemName: "SYNTH_MISSING_ITEM" })], {
      total: 2_000,
    }),
  }), /single_page_limit_exceeded/);
});

test("the synthetic 72-line daily shape retains all D_itemId rows and aggregates to 69 order-item groups", () => {
  const rows = [];
  for (let index = 0; index < 72; index += 1) {
    const group = index < 69 ? index : index - 69;
    rows.push(syntheticRow({
      itemId: `SYNTH_LINE_${String(index).padStart(3, "0")}`,
      itemName: `SYNTH_ITEM_${String(group).padStart(3, "0")}`,
      netSales: index % 2 ? "2.25" : "1.75",
      orderId: `SYNTH_ORDER_${String(group).padStart(3, "0")}`,
      qty: index % 2 ? "0.500" : "1.000",
    }));
  }
  const analysis = analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse(rows),
  });
  assert.equal(analysis.page_stats.response_row_count, 72);
  assert.equal(analysis.page_stats.distinct_item_id_count, 72);
  assert.equal(analysis.page_stats.source_row_count, 72);
  assert.equal(analysis.page_stats.aggregate_group_count, 69);
  assert.equal(analysis.page_stats.exact_duplicate_response_rows, 0);
  assert.deepEqual(analysis.direct_totals, analysis.aggregate_totals);
  assert.equal(
    analysis.aggregates.reduce((sum, row) => sum + row.source_row_count, 0),
    72,
  );
});

test("D_itemId reuse across cancellation orders remains two source lines and negative quantity is not dropped", () => {
  const rows = [
    syntheticRow({
      itemId: "SYNTH_REUSED_ITEM_ID",
      itemName: "SYNTH_REFUNDABLE_ITEM",
      netSales: "12.3456",
      orderId: "SYNTH_ORIGINAL_ORDER",
      qty: "1.0001",
      reversalOrder: "3",
    }),
    syntheticRow({
      itemId: "SYNTH_REUSED_ITEM_ID",
      itemName: "SYNTH_REFUNDABLE_ITEM",
      netSales: "-12.3456",
      orderId: "SYNTH_REVERSAL_ORDER",
      qty: "-1.0001",
      reversalOrder: "1",
    }),
  ];
  const analysis = analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse(rows),
  });
  assert.equal(analysis.page_stats.distinct_item_id_count, 1);
  assert.equal(analysis.page_stats.source_row_count, 2);
  assert.equal(analysis.page_stats.positive_quantity_groups, 1);
  assert.equal(analysis.page_stats.negative_quantity_groups, 1);
  assert.equal(analysis.page_stats.zero_quantity_groups, 0);
  assert.deepEqual(analysis.direct_totals, { net_qty: "0", net_sales: "0" });
});

test("duplicates are not summed twice, while the observed 4,457-row deep-page shape is rejected", () => {
  const uniqueRows = Array.from({ length: 1_500 }, (_, index) => syntheticRow({
    itemId: `SYNTH_DEEP_LINE_${index}`,
    itemName: `SYNTH_DEEP_ITEM_${index}`,
    netSales: "1.00",
    orderId: `SYNTH_DEEP_ORDER_${index}`,
    qty: "1.000",
  }));
  const rows = [...uniqueRows, ...uniqueRows.slice(0, 400).map((row) => structuredClone(row))];
  const analysis = analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse(rows),
  });
  assert.equal(analysis.page_stats.response_row_count, 1_900);
  assert.equal(analysis.page_stats.exact_duplicate_response_rows, 400);
  assert.equal(analysis.page_stats.source_row_count, 1_500);
  assert.equal(analysis.page_stats.aggregate_group_count, 1_500);
  assert.deepEqual(analysis.direct_totals, { net_qty: "1500", net_sales: "1500" });
  const collision = structuredClone(uniqueRows[0]);
  collision.M_Item_SUM_netSales = cell("9.00");
  assert.throws(() => analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse([uniqueRows[0], collision]),
  }), /candidate_line_identity_collision/);
  assert.throws(() => analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse([uniqueRows[0]], { total: 4_457 }),
  }), /single_page_limit_exceeded/);
});

test("single-page, row-shape, PII, stable-key, reversal, and zero-quantity boundaries fail closed", () => {
  const valid = syntheticRow({
    itemId: "SYNTH_LINE",
    itemName: "SYNTH_ITEM",
    orderId: "SYNTH_ORDER",
  });
  assert.throws(() => analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse([valid], { total: 2 }),
  }), /report_total_mismatch/);
  assert.throws(() => analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse([valid], { total: 2_000 }),
  }), /single_page_limit_exceeded/);

  const pii = structuredClone(valid);
  pii.D_customerPhone = cell("SYNTHETIC_PHONE_MARKER");
  assert.throws(() => analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse([pii]),
  }), /forbidden_sensitive_key/);

  const missingItemId = structuredClone(valid);
  delete missingItemId.D_itemId;
  assert.throws(() => analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse([missingItemId]),
  }), /report211_row_shape_mismatch/);

  const badReversal = structuredClone(valid);
  badReversal.D_reversal_order = cell("9");
  assert.throws(() => analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse([badReversal]),
  }), /unknown_reversal_order_code/);

  const badStatus = structuredClone(valid);
  badStatus.D_orderStatus = cell("99");
  assert.throws(() => analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse([badStatus]),
  }), /unknown_order_status_code/);

  const nullMetric = structuredClone(valid);
  nullMetric.M_Item_SUM_refundAmount = cell(null);
  assert.throws(() => analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse([nullMetric]),
  }), /invalid_report211_refund_amount/);

  const optionalNulls = structuredClone(valid);
  optionalNulls.D_posOrderId = cell(null);
  optionalNulls.D_orderDishesTime = cell(null);
  optionalNulls.D_unit = cell("");
  const optionalAnalysis = analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse([optionalNulls]),
  });
  assert.deepEqual(optionalAnalysis.page_stats.quality_warning_counts, {
    D_orderDishesTime: 1,
    D_posOrderId: 1,
    D_unit: 1,
  });

  const zero = structuredClone(valid);
  zero.M_Item_SUM_netQty = cell("0.000");
  const zeroAnalysis = analyzeReport211RawResponse({
    businessDate: "2026-08-08",
    rawBody: rawResponse([zero]),
  });
  assert.equal(zeroAnalysis.page_stats.zero_quantity_groups, 1);
  assert.deepEqual(zeroAnalysis.target_blockers, ["ZERO_QUANTITY_REQUIRES_QUARANTINE"]);
});
