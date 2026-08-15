import { createBatchHandler } from "./_runtime.mjs";

const SOURCE_FIELDS = Object.freeze([
  { data_type: "date", name: "date", nullable: false },
  { data_type: "text", name: "store", nullable: false },
  { data_type: "integer", name: "new_member_count", nullable: true },
  { data_type: "integer", name: "consumed_member_count", nullable: true },
  { data_type: "integer", name: "recharged_member_count", nullable: true },
  { data_type: "integer", name: "points_member_count", nullable: true },
  { data_type: "numeric(14,2)", name: "member_consume_amount", nullable: true },
  { data_type: "numeric(14,2)", name: "total_consume_amount", nullable: true },
  { data_type: "numeric(8,4)", name: "member_consume_ratio", nullable: true },
  { data_type: "numeric(14,2)", name: "topup_cash", nullable: true },
  { data_type: "numeric(14,2)", name: "topup_gift", nullable: true },
  { data_type: "numeric(14,2)", name: "topup_face_value", nullable: true },
  { data_type: "integer", name: "topup_count", nullable: true },
  { data_type: "numeric(14,2)", name: "topup_refund", nullable: true },
  { data_type: "numeric(14,2)", name: "redeem_amount", nullable: true },
  { data_type: "numeric(14,2)", name: "redeem_cash", nullable: true },
  { data_type: "numeric(14,2)", name: "redeem_gift", nullable: true },
  { data_type: "integer", name: "redeem_count", nullable: true },
  { data_type: "numeric(14,2)", name: "consume_refund", nullable: true },
  { data_type: "numeric(14,2)", name: "adjust_net", nullable: true },
  { data_type: "numeric(14,2)", name: "card_payment_net", nullable: true },
  { data_type: "numeric(8,4)", name: "card_payment_ratio", nullable: true },
  { data_type: "numeric(14,2)", name: "net_stored_value_face", nullable: true },
  { data_type: "numeric(14,2)", name: "net_stored_value_cash", nullable: true },
  { data_type: "numeric(14,2)", name: "balance_end_total", nullable: true },
  { data_type: "numeric(14,2)", name: "balance_end_cash", nullable: true },
  { data_type: "numeric(14,2)", name: "balance_end_gift", nullable: true },
  { data_type: "boolean", name: "is_partial", nullable: false },
  { data_type: "text[]", name: "missing_sources", nullable: true },
  { data_type: "text", name: "source", nullable: true },
  { data_type: "timestamp with time zone", name: "fetched_at", nullable: false },
  { data_type: "numeric(14,2)", name: "topup_adjust_amount", nullable: true },
  { data_type: "numeric(14,2)", name: "adjust_correction", nullable: true },
  { data_type: "numeric(14,2)", name: "topup_total", nullable: true },
].map(Object.freeze));

const DIRECT = Object.freeze([
  ["new_member_count", "new_member_count", "integer"],
  ["consumed_member_count", "consumed_member_count", "integer"],
  ["recharged_member_count", "recharged_member_count", "integer"],
  ["points_member_count", "points_member_count", "integer"],
  ["member_sales", "member_consume_amount", "numeric(18,4)"],
  ["total_consume_amount", "total_consume_amount", "numeric(18,4)"],
  ["topup_cash", "topup_cash", "numeric(18,4)"],
  ["topup_gift", "topup_gift", "numeric(18,4)"],
  ["topup_face_value", "topup_face_value", "numeric(18,4)"],
  ["topup_count", "topup_count", "integer"],
  ["topup_refund", "topup_refund", "numeric(18,4)"],
  ["redeem_amount", "redeem_amount", "numeric(18,4)"],
  ["redeem_cash", "redeem_cash", "numeric(18,4)"],
  ["redeem_gift", "redeem_gift", "numeric(18,4)"],
  ["redeem_count", "redeem_count", "integer"],
  ["consume_refund", "consume_refund", "numeric(18,4)"],
  ["adjust_net", "adjust_net", "numeric(18,4)"],
  ["topup_adjust_amount", "topup_adjust_amount", "numeric(18,4)"],
  ["adjust_correction", "adjust_correction", "numeric(18,4)"],
  ["stored_value_cash_net", "net_stored_value_cash", "numeric(18,4)"],
  ["balance_end_total", "balance_end_total", "numeric(18,4)"],
  ["balance_end_cash", "balance_end_cash", "numeric(18,4)"],
  ["balance_end_gift", "balance_end_gift", "numeric(18,4)"],
]);

const FIELD_MAPPINGS = Object.freeze([
  { source_field: null, target_column: "member_daily_metric_id", transform: "UUID_V5(location,date,batch)" },
  { source_field: null, target_column: "location_id", transform: "PINNED_OCCURRENCE_AUTHORITY" },
  { source_field: null, target_column: "pos_ingest_batch_id", transform: "PINNED_OCCURRENCE_AUTHORITY" },
  { source_field: "date", target_column: "business_date", transform: "COPY_WIRE" },
  ...DIRECT.map(([target_column, source_field]) => ({ source_field, target_column, transform: "COPY_WIRE" })),
  { source_field: null, target_column: "currency", transform: "CONSTANT_MYR" },
  { source_field: null, target_column: "created_at", transform: "TARGET_TRANSACTION_TIMESTAMP" },
]);

const config = Object.freeze({
  handlerId: "pos_member_daily_to_pos_member_daily_metric_v1",
  sourceRelation: "pos_member_daily",
  sourceFields: SOURCE_FIELDS,
  sourceIdentity: Object.freeze(["date", "store"]),
  targetRelations: Object.freeze(["pos_member_daily_metric"]),
  resolutionFields: Object.freeze(["location_id", "pos_ingest_batch_id"]),
  fieldMappings: FIELD_MAPPINGS,
  evaluate(row, entry, h) {
    const blockers = [];
    if (!entry?.location_id) blockers.push("LOCATION_AUTHORITY_MISSING");
    if (!entry?.pos_ingest_batch_id) blockers.push("INGEST_BATCH_AUTHORITY_MISSING");
    if (row.is_partial === "t" || row.is_partial === "true" || row.missing_sources !== null) blockers.push("PARTIAL_SOURCE_FACTS");
    for (const field of ["new_member_count", "consumed_member_count", "recharged_member_count", "points_member_count", "topup_count", "redeem_count"]) {
      if (row[field] !== null && BigInt(row[field]) < 0n) blockers.push("TARGET_CHECK_VIOLATION");
    }
    if (row.adjust_net !== null && row.topup_adjust_amount !== null && row.adjust_correction !== null) {
      const delta = h.decimalUnits(row.topup_adjust_amount) + h.decimalUnits(row.adjust_correction) - h.decimalUnits(row.adjust_net);
      if (delta < -100n || delta > 100n) blockers.push("SOURCE_ADJUST_SPLIT_MISMATCH");
    }
    if (blockers.length > 0) return { blockers };
    const components = [entry.location_id, row.date, entry.pos_ingest_batch_id];
    return {
      blockers,
      relation: "pos_member_daily_metric",
      target_identity_key: h.targetIdentity("pos_member_daily_metric", components),
      values: [
        h.typed("member_daily_metric_id", "uuid", h.deterministicUuid("hotcrush:pos_member_daily_metric:v1", components)),
        h.typed("location_id", "uuid", entry.location_id),
        h.typed("pos_ingest_batch_id", "uuid", entry.pos_ingest_batch_id),
        h.typed("business_date", "date", row.date),
        ...DIRECT.map(([target, source, type]) => h.typed(target, type, row[source])),
        h.typed("currency", "char(3)", "MYR"),
        h.opcode("created_at", "timestamptz"),
      ],
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
