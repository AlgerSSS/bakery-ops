import { createBatchHandler } from "./_runtime.mjs";

const SOURCE_FIELDS = Object.freeze([
  { data_type: "text", name: "order_id", nullable: false },
  { data_type: "text", name: "item_key", nullable: false },
  { data_type: "date", name: "business_date", nullable: false },
  { data_type: "text", name: "member_id", nullable: true },
  { data_type: "numeric(12,3)", name: "qty", nullable: false },
  { data_type: "numeric(14,2)", name: "net_sales", nullable: false },
  { data_type: "timestamp with time zone", name: "synced_at", nullable: false },
].map(Object.freeze));

const FIELD_MAPPINGS = Object.freeze([
  { source_field: "order_id", target_column: "pos_order.source_order_id", transform: "BLOCKED_PENDING_RAW_RES_RECAPTURE" },
  { source_field: "item_key", target_column: "pos_order_item.source_item_key_snapshot", transform: "BLOCKED_PENDING_RAW_RES_RECAPTURE" },
  { source_field: "qty", target_column: "pos_order_item.quantity", transform: "BLOCKED_PENDING_RAW_RES_RECAPTURE" },
  { source_field: "net_sales", target_column: "pos_order_item.net_sales", transform: "BLOCKED_PENDING_RAW_RES_RECAPTURE" },
  { source_field: null, target_column: "pos_order_item.source_row_count", transform: "UNAVAILABLE_PRE_SUM_RAW_ROW_COUNT" },
]);

const config = Object.freeze({
  handlerId: "pos_member_order_item_legacy_aggregate_blocker_v1",
  sourceRelation: "pos_member_order_item",
  sourceFields: SOURCE_FIELDS,
  sourceIdentity: Object.freeze(["order_id", "item_key"]),
  targetRelations: Object.freeze(["pos_order", "pos_order_item"]),
  resolutionFields: Object.freeze([]),
  fieldMappings: FIELD_MAPPINGS,
  targetWriteBlocker: "SOURCE_ROW_COUNT_UNAVAILABLE",
  remediationBlocker: "RAW_RES_RECAPTURE_REQUIRED",
  evaluate() {
    return {
      blockers: ["SOURCE_ROW_COUNT_UNAVAILABLE", "RAW_RES_RECAPTURE_REQUIRED"],
    };
  },
});

const api = createBatchHandler(config, import.meta.url);
export const {
  BASE_CONTRACT_SHA256, HANDLER_ID, MAX_BATCH_ROWS, PHYSICAL_BACKFILL_STATUS,
  RELEASE_STATUS, RESOLUTION_AUTHORITY_SCHEMA, RESOLUTION_PIN_SCHEMA,
  TARGET_WRITER_ACTIVATION, expectedAuthority, loadRelease, recomputeBatchRoot, sourceOccurrenceKey,
  transformBatch, transformChunks, verifyBatch, verifyChunks, verifyReleaseArtifacts,
} = api;
