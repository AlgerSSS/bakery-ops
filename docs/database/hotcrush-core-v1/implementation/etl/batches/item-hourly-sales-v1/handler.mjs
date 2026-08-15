import { createBatchHandler } from "./_runtime.mjs";

const SOURCE_FIELDS = Object.freeze([
  { data_type: "integer", name: "id", nullable: false },
  { data_type: "date", name: "date", nullable: false },
  { data_type: "integer", name: "hour", nullable: false },
  { data_type: "text", name: "item_name", nullable: false },
  { data_type: "integer", name: "qty", nullable: true },
  { data_type: "numeric(10,2)", name: "net_sales", nullable: true },
  { data_type: "numeric(10,2)", name: "gross_sales", nullable: true },
  { data_type: "timestamp with time zone", name: "synced_at", nullable: true },
  { data_type: "text", name: "store", nullable: true },
  { data_type: "text", name: "item_key", nullable: true },
].map(Object.freeze));

const FIELD_MAPPINGS = Object.freeze([
  ["item_sales_hour_id", null, "UUID_V5(location,hour_started_at,listing,batch)"],
  ["pos_ingest_batch_id", null, "PINNED_OCCURRENCE_AUTHORITY"],
  ["location_id", null, "PINNED_OCCURRENCE_AUTHORITY"],
  ["listing_id", "item_key", "PINNED_LISTING_AUTHORITY"],
  ["business_date", "date", "COPY_WIRE"],
  ["hour_started_at", "date+hour", "PINNED_CUTOFF_AND_UTC_OFFSET"],
  ["currency", null, "CONSTANT_MYR"],
  ["quantity", "qty", "COPY_WIRE"],
  ["gross_sales", "gross_sales", "COPY_WIRE"],
  ["discount_amount", null, "CONSTANT_NULL"],
  ["net_sales", "net_sales", "COPY_WIRE"],
  ["source_name_snapshot", "item_name", "COPY_WIRE"],
  ["created_at", null, "TARGET_TRANSACTION_TIMESTAMP"],
].map(([target_column, source_field, transform]) => Object.freeze({ source_field, target_column, transform })));

const config = Object.freeze({
  handlerId: "item_hourly_sales_to_pos_item_sales_hour_v1",
  sourceRelation: "item_hourly_sales",
  sourceFields: SOURCE_FIELDS,
  sourceIdentity: Object.freeze(["id"]),
  targetRelations: Object.freeze(["pos_item_sales_hour"]),
  resolutionFields: Object.freeze(["business_day_cutoff_hour", "listing_id", "location_id", "pos_ingest_batch_id", "utc_offset_minutes"]),
  fieldMappings: FIELD_MAPPINGS,
  evaluate(row, entry, h) {
    const blockers = [];
    if (!entry?.location_id) blockers.push("LOCATION_AUTHORITY_MISSING");
    if (!entry?.pos_ingest_batch_id) blockers.push("INGEST_BATCH_AUTHORITY_MISSING");
    if (row.item_key === null) blockers.push("LISTING_SOURCE_KEY_MISSING");
    if (!entry?.listing_id) blockers.push("LISTING_AUTHORITY_MISSING");
    if (!entry?.business_day_cutoff_hour || !entry?.utc_offset_minutes) blockers.push("BUSINESS_TIME_AUTHORITY_MISSING");
    const startedAt = entry ? h.hourStartedAt(row.date, row.hour, entry.business_day_cutoff_hour, entry.utc_offset_minutes) : null;
    if (entry?.business_day_cutoff_hour && entry?.utc_offset_minutes && startedAt === null) blockers.push("SOURCE_HOUR_OR_TIME_AUTHORITY_INVALID");
    if (
      row.qty === null || BigInt(row.qty) < 0n ||
      row.gross_sales === null || h.isNegative(row.gross_sales) ||
      row.net_sales === null
    ) blockers.push("TARGET_CHECK_VIOLATION");
    if (blockers.length > 0) return { blockers };
    const components = [entry.location_id, startedAt, entry.listing_id, entry.pos_ingest_batch_id];
    return {
      blockers,
      relation: "pos_item_sales_hour",
      target_identity_key: h.targetIdentity("pos_item_sales_hour", components),
      values: [
        h.typed("item_sales_hour_id", "uuid", h.deterministicUuid("hotcrush:pos_item_sales_hour:v1", components)),
        h.typed("pos_ingest_batch_id", "uuid", entry.pos_ingest_batch_id),
        h.typed("location_id", "uuid", entry.location_id),
        h.typed("listing_id", "uuid", entry.listing_id),
        h.typed("business_date", "date", row.date),
        h.typed("hour_started_at", "timestamptz", startedAt),
        h.typed("currency", "char(3)", "MYR"),
        h.typed("quantity", "numeric(18,4)", row.qty),
        h.typed("gross_sales", "numeric(18,4)", row.gross_sales),
        h.typed("discount_amount", "numeric(18,4)", null),
        h.typed("net_sales", "numeric(18,4)", row.net_sales),
        h.typed("source_name_snapshot", "text", row.item_name),
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
