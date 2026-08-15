import { readFileSync } from "node:fs";

export const IMPLEMENTATION_STATUS = "IMPLEMENTED_NOT_EXECUTED";
export const PHYSICAL_BACKFILL_STATUS = "PHYSICAL_BACKFILL_NOT_STARTED";
export const REPORT211_ENDPOINT = "https://bo.sea.restosuite.ai/api/report/data/queryData";
export const REPORT211_PAGE_SIZE = 2_000;

const SELECT_FIELDS = [
  "D_businessDate",
  "D_shopId",
  "D_currency",
  "D_orderId",
  "D_posOrderId",
  "D_itemId",
  "D_menuItemId",
  "D_itemName",
  "D_unitId",
  "D_unit",
  "D_orderStatus",
  "D_reversal_order",
  "D_isMemberConsume",
  "D_openedTime",
  "D_orderDishesTime",
  "D_checkoutTime",
  "M_Item_SUM_qty",
  "M_Item_SUM_netQty",
  "M_Item_SUM_netSales",
  "M_Item_SUM_grossSales",
  "M_Item_SUM_discountProm",
  "M_Item_SUM_refundQty",
  "M_Item_SUM_refundAmount",
];

const COMPOSITE_LINE_FIELDS = ["D_shopId", "D_orderId", "D_itemId", "D_reversal_order"];
const ASSERTION_FIELDS = ["D_businessDate", "D_currency", "D_isMemberConsume"];
const CATALOG_SUPPLEMENT_FIELDS = [
  "D_itemName",
  "D_menuItemId",
  "D_itemCode",
  "D_baseItemName",
  "D_category",
  "D_unitId",
  "D_unit",
  "D_itemType",
];

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const REPORT211_CONTRACT = deepFreeze({
  report_id: "211",
  endpoint: REPORT211_ENDPOINT,
  shop_id: "406994127",
  currency: "MYR",
  member_only: true,
  time_zone: "Asia/Kuala_Lumpur",
  page_no: 1,
  page_size: REPORT211_PAGE_SIZE,
  select_fields: SELECT_FIELDS,
  composite_line_fields: COMPOSITE_LINE_FIELDS,
  assertion_fields: ASSERTION_FIELDS,
});

export const CATALOG_SUPPLEMENT_CONTRACT = deepFreeze({
  report_id: "211",
  endpoint: REPORT211_ENDPOINT,
  page_no: 1,
  page_size: REPORT211_PAGE_SIZE,
  select_fields: CATALOG_SUPPLEMENT_FIELDS,
  filter_missing_item_keys_in_api: false,
  local_join_field: "D_itemName",
});

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function validateFrozenAuthority(authority) {
  if (
    !authority || authority.schema !== "hotcrush.res.report211.member-order-item.replay-authority.v1" ||
    authority.stable_line_identity?.status !== "APPROVED_FULL_HISTORY_PROBE" ||
    !sameArray(authority.stable_line_identity?.fields, COMPOSITE_LINE_FIELDS) ||
    !sameArray(authority.stable_line_identity?.assertion_fields, ASSERTION_FIELDS) ||
    authority.stable_line_identity?.d_item_id_alone_approved !== false ||
    authority.probe?.response_rows !== 46_662 ||
    authority.probe?.distinct_composite_line_keys !== 46_662 ||
    authority.probe?.distinct_composite_conflicts !== 0 ||
    authority.probe?.composite_null_rows !== 0 ||
    authority.probe?.canonical_row_digest_sha256 !==
      "2dcffa1fad936678d3ddc460d1d7289c23615d5cc2b4c39c8229ad961f0a20b0" ||
    authority.execution?.database_writes_allowed !== false
  ) {
    throw new Error("invalid_replay_authority");
  }
  return authority;
}

export const DEFAULT_REPLAY_AUTHORITY = deepFreeze(validateFrozenAuthority(
  JSON.parse(readFileSync(new URL("./authority.json", import.meta.url), "utf8")),
));

export function assertBusinessDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("invalid_business_date");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("invalid_business_date");
  }
  return value;
}

export function buildReport211Request({ businessDate } = {}) {
  const date = assertBusinessDate(businessDate);
  const body = {
    reportId: REPORT211_CONTRACT.report_id,
    selectFields: [...REPORT211_CONTRACT.select_fields],
    metricsByDimQryV2: [],
    aggFilters: [],
    proportionProperty: { enable: false },
    dimAdditionalStrategy: [],
    filters: [
      { fieldName: "D_businessDate", filterType: "RANGE", filterValue: [date, date] },
      { fieldName: "D_currency", filterType: "EQ", filterValue: [REPORT211_CONTRACT.currency] },
      { fieldName: "D_shopId", filterType: "IN", filterValue: [REPORT211_CONTRACT.shop_id] },
      { fieldName: "D_isMemberConsume", filterType: "IN", filterValue: ["true"] },
    ],
    page: { pageNo: REPORT211_CONTRACT.page_no, pageSize: REPORT211_CONTRACT.page_size },
  };
  return deepFreeze({
    endpoint: REPORT211_CONTRACT.endpoint,
    body,
    source_parameters: {
      business_date: date,
      currency: REPORT211_CONTRACT.currency,
      member_only: REPORT211_CONTRACT.member_only,
      report_id: REPORT211_CONTRACT.report_id,
      shop_id: REPORT211_CONTRACT.shop_id,
      time_zone: REPORT211_CONTRACT.time_zone,
    },
  });
}

export function buildCatalogSupplementRequest({ businessDate } = {}) {
  const date = assertBusinessDate(businessDate);
  const body = {
    reportId: CATALOG_SUPPLEMENT_CONTRACT.report_id,
    selectFields: [...CATALOG_SUPPLEMENT_CONTRACT.select_fields],
    metricsByDimQryV2: [],
    aggFilters: [],
    proportionProperty: { enable: false },
    dimAdditionalStrategy: [],
    filters: [
      { fieldName: "D_businessDate", filterType: "RANGE", filterValue: [date, date] },
      { fieldName: "D_currency", filterType: "EQ", filterValue: [REPORT211_CONTRACT.currency] },
      { fieldName: "D_shopId", filterType: "IN", filterValue: [REPORT211_CONTRACT.shop_id] },
      { fieldName: "D_isMemberConsume", filterType: "IN", filterValue: ["true"] },
    ],
    page: {
      pageNo: CATALOG_SUPPLEMENT_CONTRACT.page_no,
      pageSize: CATALOG_SUPPLEMENT_CONTRACT.page_size,
    },
  };
  return deepFreeze({
    endpoint: CATALOG_SUPPLEMENT_CONTRACT.endpoint,
    body,
    source_parameters: {
      business_date: date,
      currency: REPORT211_CONTRACT.currency,
      member_only: REPORT211_CONTRACT.member_only,
      purpose: "CATALOG_SUPPLEMENT",
      report_id: CATALOG_SUPPLEMENT_CONTRACT.report_id,
      shop_id: REPORT211_CONTRACT.shop_id,
      time_zone: REPORT211_CONTRACT.time_zone,
    },
  });
}

export function assertReplayAuthority(authority, mode) {
  if (!mode) throw new Error("explicit_replay_mode_required");
  if (!new Set(["SYNTHETIC_FIXTURE", "LIVE_READ_ONLY"]).has(mode)) {
    throw new Error("invalid_replay_mode");
  }
  const selectedAuthority = validateFrozenAuthority(authority ?? DEFAULT_REPLAY_AUTHORITY);
  if (mode === "LIVE_READ_ONLY") {
    if (selectedAuthority !== DEFAULT_REPLAY_AUTHORITY) {
      throw new Error("live_replay_authority_override_forbidden");
    }
    if (
      DEFAULT_REPLAY_AUTHORITY.execution.status !== "APPROVED_READ_ONLY_REPLAY" ||
      DEFAULT_REPLAY_AUTHORITY.execution.live_read_only_replay_approved !== true
    ) {
      throw new Error("live_replay_not_approved");
    }
  }
}

export function normalizeListingItemKeys(value) {
  if (!Array.isArray(value)) throw new Error("invalid_listing_item_keys");
  const normalized = [];
  const seen = new Set();
  for (const key of value) {
    if (
      typeof key !== "string" || key.length === 0 || key !== key.trim() ||
      key.length > 256 || seen.has(key)
    ) {
      throw new Error("invalid_listing_item_keys");
    }
    seen.add(key);
    normalized.push(key);
  }
  return normalized.sort();
}
