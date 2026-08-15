import { canonicalizeJcs } from "../../lib/canonical.mjs";

import {
  CATALOG_SUPPLEMENT_CONTRACT,
  REPORT211_CONTRACT,
  REPORT211_PAGE_SIZE,
  assertBusinessDate,
  normalizeListingItemKeys,
} from "./contract.mjs";

const ROW_FIELDS = [...REPORT211_CONTRACT.select_fields].sort();
const CATALOG_ROW_FIELDS = [...CATALOG_SUPPLEMENT_CONTRACT.select_fields].sort();
const REVERSAL_CODES = new Set(["0", "1", "2", "3"]);
const ORDER_STATUS_CODES = new Set(["10", "20", "30"]);
const OPTIONAL_RAW_FIELDS = [
  "D_posOrderId",
  "D_menuItemId",
  "D_unitId",
  "D_unit",
  "D_openedTime",
  "D_orderDishesTime",
  "D_checkoutTime",
];
const MAX_RAW_BYTES = 64 * 1024 * 1024;
const MAX_SCAN_NODES = 2_000_000;
const MONEY_SCALE = 4;
const QUANTITY_SCALE = 4;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "address",
  "apikey",
  "authorization",
  "cookie",
  "customeremail",
  "customerid",
  "customername",
  "customerphone",
  "dcustomeremail",
  "dcustomername",
  "dcustomerphone",
  "email",
  "identitycode",
  "membercardno",
  "memberid",
  "membername",
  "memberphone",
  "mobile",
  "mobilenumber",
  "nric",
  "passport",
  "password",
  "phone",
  "refreshtoken",
  "secret",
  "setcookie",
  "sessiontoken",
  "token",
  "vulcantoken",
]);

function normalizeKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function scanObjectKeys(root) {
  let seen = 0;
  const pending = [root];
  while (pending.length) {
    const value = pending.pop();
    seen += 1;
    if (seen > MAX_SCAN_NODES) throw new Error("report_response_too_complex");
    if (!value || typeof value !== "object") continue;
    for (const key of Object.keys(value)) {
      if (DANGEROUS_KEYS.has(key)) throw new Error("forbidden_sensitive_key");
      if (SENSITIVE_KEYS.has(normalizeKey(key))) throw new Error("forbidden_sensitive_key");
      pending.push(value[key]);
    }
  }
}

function exactRowShape(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("report211_row_shape_mismatch");
  }
  const fields = Object.keys(row).sort();
  if (fields.length !== ROW_FIELDS.length || fields.some((field, index) => field !== ROW_FIELDS[index])) {
    throw new Error("report211_row_shape_mismatch");
  }
}

function exactCatalogRowShape(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("catalog_supplement_row_shape_mismatch");
  }
  const fields = Object.keys(row).sort();
  if (
    fields.length !== CATALOG_ROW_FIELDS.length ||
    fields.some((field, index) => field !== CATALOG_ROW_FIELDS[index])
  ) {
    throw new Error("catalog_supplement_row_shape_mismatch");
  }
}

function cellValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "value")) {
    return value.value;
  }
  return value;
}

function requiredText(row, name) {
  const value = cellValue(row[name]);
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > 256) {
    throw new Error(`invalid_report211_${name}`);
  }
  return value;
}

function nullableText(row, name) {
  const value = cellValue(row[name]);
  if (value === null) return null;
  if (typeof value !== "string" || value !== value.trim() || value.length > 256) {
    throw new Error(`invalid_report211_${name}`);
  }
  return value;
}

function rawText(row, name) {
  const value = cellValue(row[name]);
  if (value === null) return null;
  if (
    !new Set(["string", "number", "boolean"]).has(typeof value) ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  ) {
    throw new Error(`invalid_report211_${name}`);
  }
  const text = String(value);
  if (text.length > 512 || /[\r\n]/.test(text)) throw new Error(`invalid_report211_${name}`);
  return text;
}

function catalogRequiredText(row, name) {
  const text = rawText(row, name);
  if (text === null || text.length === 0 || text !== text.trim()) {
    throw new Error(`invalid_catalog_supplement_${name}`);
  }
  return text;
}

function normalizedCatalogSeedRow(row) {
  return Object.fromEntries(CATALOG_SUPPLEMENT_CONTRACT.select_fields.map((field) => [
    field,
    catalogRequiredText(row, field),
  ]));
}

function decimalUnits(value, scale, fieldName) {
  const rawValue = cellValue(value);
  const text = typeof rawValue === "number" && Number.isFinite(rawValue)
    ? String(rawValue)
    : rawValue;
  if (typeof text !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
    throw new Error(`invalid_report211_${fieldName}`);
  }
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > scale || whole.length > 18) {
    throw new Error(`invalid_report211_${fieldName}`);
  }
  const units = BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
  return negative ? -units : units;
}

function formatUnits(units, scale) {
  if (units === 0n) return "0";
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale) || "0";
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function normalizedRow(row, businessDate) {
  exactRowShape(row);
  const rawMetrics = {
    discount_prom_units: decimalUnits(row.M_Item_SUM_discountProm, MONEY_SCALE, "discount_prom"),
    gross_sales_units: decimalUnits(row.M_Item_SUM_grossSales, MONEY_SCALE, "gross_sales"),
    gross_qty_units: decimalUnits(row.M_Item_SUM_qty, QUANTITY_SCALE, "gross_qty"),
    refund_amount_units: decimalUnits(row.M_Item_SUM_refundAmount, MONEY_SCALE, "refund_amount"),
    refund_qty_units: decimalUnits(row.M_Item_SUM_refundQty, QUANTITY_SCALE, "refund_qty"),
  };
  const orderStatus = requiredText(row, "D_orderStatus");
  if (!ORDER_STATUS_CODES.has(orderStatus)) throw new Error("unknown_order_status_code");
  const optionalRaw = Object.fromEntries(OPTIONAL_RAW_FIELDS.map((field) => [field, rawText(row, field)]));
  const normalized = {
    business_date: requiredText(row, "D_businessDate"),
    currency: requiredText(row, "D_currency"),
    is_member_consume: cellValue(row.D_isMemberConsume),
    item_id: requiredText(row, "D_itemId"),
    item_name: requiredText(row, "D_itemName"),
    order_id: requiredText(row, "D_orderId"),
    reversal_order: nullableText(row, "D_reversal_order"),
    shop_id: requiredText(row, "D_shopId"),
    qty_units: decimalUnits(row.M_Item_SUM_netQty, QUANTITY_SCALE, "net_qty"),
    net_sales_units: decimalUnits(row.M_Item_SUM_netSales, MONEY_SCALE, "net_sales"),
    raw_payload: {
      checkout_time: optionalRaw.D_checkoutTime,
      discount_prom: formatUnits(rawMetrics.discount_prom_units, MONEY_SCALE),
      gross_qty: formatUnits(rawMetrics.gross_qty_units, QUANTITY_SCALE),
      gross_sales: formatUnits(rawMetrics.gross_sales_units, MONEY_SCALE),
      menu_item_id: optionalRaw.D_menuItemId,
      opened_time: optionalRaw.D_openedTime,
      order_dishes_time: optionalRaw.D_orderDishesTime,
      order_status: orderStatus,
      pos_order_id: optionalRaw.D_posOrderId,
      refund_amount: formatUnits(rawMetrics.refund_amount_units, MONEY_SCALE),
      refund_qty: formatUnits(rawMetrics.refund_qty_units, QUANTITY_SCALE),
      unit: optionalRaw.D_unit,
      unit_id: optionalRaw.D_unitId,
    },
    quality_warning_fields: OPTIONAL_RAW_FIELDS.filter((field) =>
      optionalRaw[field] === null || optionalRaw[field] === ""
    ),
  };
  if (normalized.business_date !== businessDate) throw new Error("business_date_assertion_failed");
  if (normalized.currency !== REPORT211_CONTRACT.currency) throw new Error("currency_assertion_failed");
  if (normalized.shop_id !== REPORT211_CONTRACT.shop_id) throw new Error("shop_assertion_failed");
  if (!(normalized.is_member_consume === true || normalized.is_member_consume === "true")) {
    throw new Error("member_flag_assertion_failed");
  }
  if (normalized.reversal_order === null || !REVERSAL_CODES.has(normalized.reversal_order)) {
    throw new Error("unknown_reversal_order_code");
  }
  return normalized;
}

function parseTotal(value) {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("invalid_report_total");
  return number;
}

function distribution(aggregates) {
  const result = Object.create(null);
  for (const row of aggregates) {
    const key = String(row.source_row_count);
    result[key] = (result[key] ?? 0) + 1;
  }
  return { ...result };
}

export function analyzeReport211RawResponse({ businessDate, rawBody } = {}) {
  const date = assertBusinessDate(businessDate);
  const bytes = Buffer.from(rawBody ?? []);
  if (bytes.length === 0 || bytes.length > MAX_RAW_BYTES) throw new Error("invalid_raw_response_size");
  let response;
  try {
    response = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("invalid_report_response_json");
  }
  scanObjectKeys(response);
  if (response?.code !== "000") throw new Error("report211_response_not_ok");
  const rows = response?.data?.rows;
  if (!Array.isArray(rows)) throw new Error("report211_rows_missing");
  const reportedTotal = parseTotal(response?.data?.page?.total ?? response?.data?.total);
  if (reportedTotal >= REPORT211_PAGE_SIZE) throw new Error("single_page_limit_exceeded");
  if (rows.length !== reportedTotal) throw new Error("report_total_mismatch");

  const distinctItemIds = new Set();
  const uniqueLines = new Map();
  let exactDuplicateResponseRows = 0;
  for (const rawRow of rows) {
    const row = normalizedRow(rawRow, date);
    distinctItemIds.add(row.item_id);
    const lineKey = canonicalizeJcs([
      row.shop_id,
      row.order_id,
      row.item_id,
      row.reversal_order,
    ]).toString("utf8");
    const payload = canonicalizeJcs({
      business_date: row.business_date,
      currency: row.currency,
      is_member_consume: row.is_member_consume === true ? "true" : row.is_member_consume,
      item_id: row.item_id,
      item_name: row.item_name,
      net_sales: formatUnits(row.net_sales_units, MONEY_SCALE),
      order_id: row.order_id,
      qty: formatUnits(row.qty_units, QUANTITY_SCALE),
      reversal_order: row.reversal_order,
      raw_payload: row.raw_payload,
      shop_id: row.shop_id,
    });
    const previous = uniqueLines.get(lineKey);
    if (previous) {
      if (!previous.payload.equals(payload)) throw new Error("candidate_line_identity_collision");
      exactDuplicateResponseRows += 1;
      continue;
    }
    uniqueLines.set(lineKey, { payload, row });
  }

  const groups = new Map();
  const qualityWarningCounts = Object.create(null);
  let directQty = 0n;
  let directNetSales = 0n;
  for (const { row } of uniqueLines.values()) {
    directQty += row.qty_units;
    directNetSales += row.net_sales_units;
    for (const field of row.quality_warning_fields) {
      qualityWarningCounts[field] = (qualityWarningCounts[field] ?? 0) + 1;
    }
    const groupKey = canonicalizeJcs([row.order_id, row.item_name]).toString("utf8");
    const group = groups.get(groupKey) ?? {
      net_qty_units: 0n,
      net_sales_units: 0n,
      source_item_key_snapshot: row.item_name,
      source_order_id: row.order_id,
      source_row_count: 0,
    };
    group.net_qty_units += row.qty_units;
    group.net_sales_units += row.net_sales_units;
    group.source_row_count += 1;
    groups.set(groupKey, group);
  }

  const aggregates = [...groups.values()].map((group) => ({
    net_qty: formatUnits(group.net_qty_units, QUANTITY_SCALE),
    net_sales: formatUnits(group.net_sales_units, MONEY_SCALE),
    source_item_key_snapshot: group.source_item_key_snapshot,
    source_order_id: group.source_order_id,
    source_row_count: group.source_row_count,
  })).sort((left, right) =>
    left.source_order_id.localeCompare(right.source_order_id) ||
    left.source_item_key_snapshot.localeCompare(right.source_item_key_snapshot)
  );

  let aggregateQty = 0n;
  let aggregateNetSales = 0n;
  let positiveGroups = 0;
  let negativeGroups = 0;
  let zeroGroups = 0;
  for (const group of groups.values()) {
    aggregateQty += group.net_qty_units;
    aggregateNetSales += group.net_sales_units;
    if (group.net_qty_units > 0n) positiveGroups += 1;
    else if (group.net_qty_units < 0n) negativeGroups += 1;
    else zeroGroups += 1;
  }
  const directTotals = {
    net_qty: formatUnits(directQty, QUANTITY_SCALE),
    net_sales: formatUnits(directNetSales, MONEY_SCALE),
  };
  const aggregateTotals = {
    net_qty: formatUnits(aggregateQty, QUANTITY_SCALE),
    net_sales: formatUnits(aggregateNetSales, MONEY_SCALE),
  };
  if (directTotals.net_qty !== aggregateTotals.net_qty || directTotals.net_sales !== aggregateTotals.net_sales) {
    throw new Error("aggregate_conservation_failed");
  }

  return {
    aggregate_totals: aggregateTotals,
    aggregates,
    direct_totals: directTotals,
    listing_item_keys: [...new Set(aggregates.map((row) => row.source_item_key_snapshot))].sort(),
    page_stats: {
      aggregate_group_count: aggregates.length,
      aggregate_source_row_count_distribution: distribution(aggregates),
      distinct_item_id_count: distinctItemIds.size,
      exact_duplicate_response_rows: exactDuplicateResponseRows,
      negative_quantity_groups: negativeGroups,
      page_no: 1,
      page_size: REPORT211_PAGE_SIZE,
      positive_quantity_groups: positiveGroups,
      quality_warning_counts: { ...qualityWarningCounts },
      reported_total: reportedTotal,
      response_row_count: rows.length,
      source_row_count: uniqueLines.size,
      zero_quantity_groups: zeroGroups,
    },
    target_blockers: zeroGroups ? ["ZERO_QUANTITY_REQUIRES_QUARANTINE"] : [],
  };
}

export function analyzeCatalogSupplementRawResponse({
  businessDate,
  missingItemKeys,
  rawBody,
} = {}) {
  assertBusinessDate(businessDate);
  const requestedMissingItemKeys = normalizeListingItemKeys(missingItemKeys);
  const missing = new Set(requestedMissingItemKeys);
  const bytes = Buffer.from(rawBody ?? []);
  if (bytes.length === 0 || bytes.length > MAX_RAW_BYTES) throw new Error("invalid_raw_response_size");
  let response;
  try {
    response = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("invalid_report_response_json");
  }
  scanObjectKeys(response);
  if (response?.code !== "000") throw new Error("catalog_supplement_response_not_ok");
  const rows = response?.data?.rows;
  if (!Array.isArray(rows)) throw new Error("catalog_supplement_rows_missing");
  const reportedTotal = parseTotal(response?.data?.page?.total ?? response?.data?.total);
  if (reportedTotal >= REPORT211_PAGE_SIZE) throw new Error("single_page_limit_exceeded");
  if (rows.length !== reportedTotal) throw new Error("report_total_mismatch");

  const candidates = new Map();
  const invalidItemKeys = new Set();
  let selectedResponseRows = 0;
  let unrelatedResponseRows = 0;
  for (const rawRow of rows) {
    exactCatalogRowShape(rawRow);
    const itemName = requiredText(rawRow, "D_itemName");
    if (!missing.has(itemName)) {
      unrelatedResponseRows += 1;
      continue;
    }
    selectedResponseRows += 1;
    let seedRow;
    try {
      seedRow = normalizedCatalogSeedRow(rawRow);
    } catch (error) {
      if (!String(error?.message).startsWith("invalid_catalog_supplement_")) throw error;
      invalidItemKeys.add(itemName);
      continue;
    }
    const digest = canonicalizeJcs(seedRow).toString("utf8");
    const byDigest = candidates.get(itemName) ?? new Map();
    const existing = byDigest.get(digest);
    byDigest.set(digest, {
      count: (existing?.count ?? 0) + 1,
      row: seedRow,
    });
    candidates.set(itemName, byDigest);
  }

  const conflictingItemKeys = [];
  const resolvedItemKeys = [];
  const seedRows = [];
  const unresolvedItemKeys = [];
  let exactDuplicateSelectedRows = 0;
  for (const itemKey of requestedMissingItemKeys) {
    const byDigest = candidates.get(itemKey);
    if (invalidItemKeys.has(itemKey) || !byDigest || byDigest.size !== 1) {
      unresolvedItemKeys.push(itemKey);
      if (byDigest?.size > 1) conflictingItemKeys.push(itemKey);
      continue;
    }
    const [{ count, row }] = [...byDigest.values()];
    exactDuplicateSelectedRows += count - 1;
    resolvedItemKeys.push(itemKey);
    seedRows.push(row);
  }

  return {
    conflicting_item_keys: conflictingItemKeys,
    invalid_item_keys: [...invalidItemKeys].sort(),
    page_stats: {
      exact_duplicate_selected_rows: exactDuplicateSelectedRows,
      page_no: 1,
      page_size: REPORT211_PAGE_SIZE,
      reported_total: reportedTotal,
      response_row_count: rows.length,
      selected_response_row_count: selectedResponseRows,
      selected_seed_row_count: seedRows.length,
      unrelated_response_row_count: unrelatedResponseRows,
    },
    requested_missing_item_keys: requestedMissingItemKeys,
    resolved_item_keys: resolvedItemKeys,
    seed_rows: seedRows,
    target_blockers: unresolvedItemKeys.length
      ? ["CATALOG_SUPPLEMENT_UNRESOLVED_LISTING_KEYS"]
      : [],
    unresolved_item_keys: unresolvedItemKeys,
  };
}
