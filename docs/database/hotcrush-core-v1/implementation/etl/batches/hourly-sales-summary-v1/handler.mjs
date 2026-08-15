import { createBatchHandler } from "./_runtime.mjs";

const SOURCE_FIELDS = Object.freeze([
  { data_type: "integer", name: "id", nullable: false },
  { data_type: "date", name: "date", nullable: false },
  { data_type: "integer", name: "hour", nullable: false },
  { data_type: "integer", name: "bill_count", nullable: true },
  { data_type: "integer", name: "num_of_guests", nullable: true },
  { data_type: "numeric(12,2)", name: "net_sales", nullable: true },
  { data_type: "numeric(12,2)", name: "gross_sales", nullable: true },
  { data_type: "numeric(10,2)", name: "avg_order_net_sales", nullable: true },
  { data_type: "numeric(10,2)", name: "total_discount", nullable: true },
  { data_type: "timestamp with time zone", name: "synced_at", nullable: true },
].map(Object.freeze));

const FIELD_MAPPINGS = Object.freeze([
  ["sales_hour_id", null, "UUID_V5(location,hour_started_at,batch)"],
  ["pos_ingest_batch_id", null, "PINNED_OCCURRENCE_AUTHORITY"],
  ["location_id", null, "PINNED_OCCURRENCE_AUTHORITY"],
  ["business_date", "date", "COPY_WIRE"],
  ["hour_started_at", "date+hour", "PINNED_CUTOFF_AND_UTC_OFFSET"],
  ["currency", null, "CONSTANT_MYR"],
  ["gross_sales", "gross_sales", "COPY_WIRE"],
  ["discount_amount", "total_discount", "COPY_WIRE"],
  ["net_sales", "net_sales", "COPY_WIRE"],
  ["order_count", "bill_count", "COPY_WIRE"],
  ["source_guest_count", "num_of_guests", "COPY_WIRE"],
  ["created_at", null, "TARGET_TRANSACTION_TIMESTAMP"],
].map(([target_column, source_field, transform]) => Object.freeze({ source_field, target_column, transform })));

const config = Object.freeze({
  handlerId: "hourly_sales_summary_to_pos_sales_hour_v1",
  sourceRelation: "hourly_sales_summary",
  sourceFields: SOURCE_FIELDS,
  sourceIdentity: Object.freeze(["id"]),
  targetRelations: Object.freeze(["pos_sales_hour"]),
  resolutionFields: Object.freeze(["business_day_cutoff_hour", "location_id", "pos_ingest_batch_id", "utc_offset_minutes"]),
  fieldMappings: FIELD_MAPPINGS,
  evaluate(row, entry, h) {
    const blockers = [];
    if (!entry?.location_id) blockers.push("LOCATION_AUTHORITY_MISSING");
    if (!entry?.pos_ingest_batch_id) blockers.push("INGEST_BATCH_AUTHORITY_MISSING");
    if (!entry?.business_day_cutoff_hour || !entry?.utc_offset_minutes) blockers.push("BUSINESS_TIME_AUTHORITY_MISSING");
    const startedAt = entry ? h.hourStartedAt(row.date, row.hour, entry.business_day_cutoff_hour, entry.utc_offset_minutes) : null;
    if (entry?.business_day_cutoff_hour && entry?.utc_offset_minutes && startedAt === null) blockers.push("SOURCE_HOUR_OR_TIME_AUTHORITY_INVALID");
    if (
      row.bill_count === null || BigInt(row.bill_count) < 0n ||
      (row.num_of_guests !== null && BigInt(row.num_of_guests) < 0n) ||
      row.gross_sales === null || row.net_sales === null ||
      (row.total_discount !== null && h.isNegative(row.total_discount))
    ) blockers.push("TARGET_CHECK_VIOLATION");
    if (blockers.length > 0) return { blockers };
    const components = [entry.location_id, startedAt, entry.pos_ingest_batch_id];
    return {
      blockers,
      relation: "pos_sales_hour",
      target_identity_key: h.targetIdentity("pos_sales_hour", components),
      values: [
        h.typed("sales_hour_id", "uuid", h.deterministicUuid("hotcrush:pos_sales_hour:v1", components)),
        h.typed("pos_ingest_batch_id", "uuid", entry.pos_ingest_batch_id),
        h.typed("location_id", "uuid", entry.location_id),
        h.typed("business_date", "date", row.date),
        h.typed("hour_started_at", "timestamptz", startedAt),
        h.typed("currency", "char(3)", "MYR"),
        h.typed("gross_sales", "numeric(18,4)", row.gross_sales),
        h.typed("discount_amount", "numeric(18,4)", row.total_discount),
        h.typed("net_sales", "numeric(18,4)", row.net_sales),
        h.typed("order_count", "integer", row.bill_count),
        h.typed("source_guest_count", "integer", row.num_of_guests),
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
