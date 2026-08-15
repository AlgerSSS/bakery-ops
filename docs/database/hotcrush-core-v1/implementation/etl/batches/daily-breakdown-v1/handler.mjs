import { createBatchHandler } from "./_runtime.mjs";

const SOURCE_FIELDS = Object.freeze([
  { data_type: "date", name: "date", nullable: false },
  { data_type: "text", name: "dim_type", nullable: false },
  { data_type: "text", name: "dim_value", nullable: false },
  { data_type: "integer", name: "bill_count", nullable: true },
  { data_type: "numeric", name: "net_sales", nullable: true },
  { data_type: "numeric", name: "ratio", nullable: true },
].map(Object.freeze));

const FIELD_MAPPINGS = Object.freeze([
  ["daily_breakdown_id", null, "UUID_V5(location,date,type,value,batch)"],
  ["pos_ingest_batch_id", null, "PINNED_OCCURRENCE_AUTHORITY"],
  ["location_id", null, "PINNED_OCCURRENCE_AUTHORITY"],
  ["business_date", "date", "COPY_WIRE"],
  ["dimension_type", "dim_type", "payment_TO_PAYMENT_METHOD"],
  ["dimension_value", "dim_value", "COPY_WIRE"],
  ["quantity", null, "CONSTANT_NULL"],
  ["quantity_unit", null, "CONSTANT_NULL"],
  ["gross_sales", null, "CONSTANT_NULL"],
  ["net_sales", "net_sales", "COPY_WIRE"],
  ["currency", null, "CONSTANT_MYR"],
  ["created_at", null, "TARGET_TRANSACTION_TIMESTAMP"],
].map(([target_column, source_field, transform]) => Object.freeze({ source_field, target_column, transform })));

const config = Object.freeze({
  handlerId: "daily_breakdown_to_pos_daily_breakdown_v1",
  sourceRelation: "daily_breakdown",
  sourceFields: SOURCE_FIELDS,
  sourceIdentity: Object.freeze(["date", "dim_type", "dim_value"]),
  targetRelations: Object.freeze(["pos_daily_breakdown"]),
  resolutionFields: Object.freeze(["location_id", "pos_ingest_batch_id"]),
  fieldMappings: FIELD_MAPPINGS,
  evaluate(row, entry, h) {
    const blockers = [];
    if (row.dim_type === "dining") blockers.push("DINING_SOURCE_SEMANTICS_INVALID");
    else if (row.dim_type !== "payment") blockers.push("SOURCE_DIMENSION_TYPE_UNSUPPORTED");
    if (!entry?.location_id) blockers.push("LOCATION_AUTHORITY_MISSING");
    if (!entry?.pos_ingest_batch_id) blockers.push("INGEST_BATCH_AUTHORITY_MISSING");
    if (row.dim_type === "payment" && row.net_sales === null) blockers.push("TARGET_NOT_NULL_VIOLATION");
    if (blockers.length > 0) return { blockers };
    const components = [entry.location_id, row.date, "PAYMENT_METHOD", row.dim_value, entry.pos_ingest_batch_id];
    return {
      blockers,
      relation: "pos_daily_breakdown",
      target_identity_key: h.targetIdentity("pos_daily_breakdown", components),
      values: [
        h.typed("daily_breakdown_id", "uuid", h.deterministicUuid("hotcrush:pos_daily_breakdown:v1", components)),
        h.typed("pos_ingest_batch_id", "uuid", entry.pos_ingest_batch_id),
        h.typed("location_id", "uuid", entry.location_id),
        h.typed("business_date", "date", row.date),
        h.typed("dimension_type", "text", "PAYMENT_METHOD"),
        h.typed("dimension_value", "text", row.dim_value),
        h.typed("quantity", "numeric(18,4)", null),
        h.typed("quantity_unit", "text", null),
        h.typed("gross_sales", "numeric(18,4)", null),
        h.typed("net_sales", "numeric(18,4)", row.net_sales),
        h.typed("currency", "char(3)", "MYR"),
        h.opcode("created_at", "timestamptz"),
      ],
    };
  },
});

const api = createBatchHandler(config, import.meta.url);

export const {
  BASE_CONTRACT_SHA256,
  HANDLER_ID,
  MAX_BATCH_ROWS,
  PHYSICAL_BACKFILL_STATUS,
  RELEASE_STATUS,
  RESOLUTION_AUTHORITY_SCHEMA,
  RESOLUTION_PIN_SCHEMA,
  TARGET_WRITER_ACTIVATION,
  expectedAuthority,
  loadRelease,
  recomputeBatchRoot,
  sourceOccurrenceKey,
  transformBatch,
  transformChunks,
  verifyBatch,
  verifyChunks,
  verifyReleaseArtifacts,
} = api;
