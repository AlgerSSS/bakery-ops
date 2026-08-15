import { createBatchHandler } from "./_runtime.mjs";

const SOURCE_FIELDS = Object.freeze([
  { data_type: "text", name: "txn_id", nullable: false },
  { data_type: "text", name: "store", nullable: false },
  { data_type: "text", name: "pos_shop_id", nullable: true },
  { data_type: "date", name: "business_date", nullable: false },
  { data_type: "timestamp with time zone", name: "txn_at", nullable: true },
  { data_type: "text", name: "member_id", nullable: true },
  { data_type: "text", name: "card_no", nullable: true },
  { data_type: "smallint", name: "txn_type", nullable: false },
  { data_type: "text", name: "txn_type_label", nullable: false },
  { data_type: "numeric(14,2)", name: "money_amount", nullable: true },
  { data_type: "numeric(14,2)", name: "gift_amount", nullable: true },
  { data_type: "numeric(14,2)", name: "total_amount", nullable: true },
  { data_type: "numeric(14,2)", name: "trade_amount", nullable: true },
  { data_type: "numeric(14,2)", name: "before_money_balance", nullable: true },
  { data_type: "numeric(14,2)", name: "after_money_balance", nullable: true },
  { data_type: "numeric(14,2)", name: "before_gift_balance", nullable: true },
  { data_type: "numeric(14,2)", name: "after_gift_balance", nullable: true },
  { data_type: "integer", name: "point_delta", nullable: true },
  { data_type: "text", name: "pos_order_no", nullable: true },
  { data_type: "text", name: "order_id", nullable: true },
  { data_type: "text", name: "source_code", nullable: true },
  { data_type: "text", name: "source", nullable: false },
  { data_type: "timestamp with time zone", name: "fetched_at", nullable: false },
].map(Object.freeze));

const TRANSACTION_TYPES = Object.freeze({
  "10": Object.freeze({ label: "topup", target: "TOP_UP" }),
  "20": Object.freeze({ label: "consume", target: "CONSUME" }),
  "30": Object.freeze({ label: "topup_refund", target: "TOP_UP_REFUND" }),
  "40": Object.freeze({ label: "consume_refund", target: "CONSUME_REFUND" }),
  "50": Object.freeze({ label: "adjust_increase", target: "ADJUST_UP" }),
  "60": Object.freeze({ label: "adjust_decrease", target: "ADJUST_DOWN" }),
});
const LABEL_CODES = Object.freeze(Object.fromEntries(Object.entries(TRANSACTION_TYPES).map(([code, value]) => [value.label, code])));

const FIELD_MAPPINGS = Object.freeze([
  ["member_card_transaction_id", null, "UUID_V5(source_system,location,source_transaction_id)"],
  ["member_id", null, "CONSTANT_NULL_UNRESOLVED_STABLE_FK"],
  ["source_member_id", "member_id", "COPY_WIRE"],
  ["member_card_id", null, "CONSTANT_NULL_UNRESOLVED_STABLE_FK"],
  ["source_card_id", "card_no", "COPY_WIRE"],
  ["source_system_id", null, "CONSTANT_RES_POS_SOURCE_SYSTEM"],
  ["location_id", null, "PINNED_OCCURRENCE_AUTHORITY"],
  ["pos_ingest_batch_id", null, "PINNED_OCCURRENCE_AUTHORITY"],
  ["source_transaction_id", "txn_id", "COPY_WIRE"],
  ["source_transaction_type_code", "txn_type", "COPY_WIRE"],
  ["source_transaction_type_label", "txn_type_label", "COPY_WIRE"],
  ["transaction_type", "txn_type+txn_type_label", "EXPLICIT_PAIR_MAP_OR_UNKNOWN"],
  ["occurred_at", "txn_at", "COPY_WIRE"],
  ["business_date", "business_date", "COPY_WIRE"],
  ["cash_amount", "money_amount", "COPY_WIRE"],
  ["gift_amount", "gift_amount", "COPY_WIRE"],
  ["total_amount", "total_amount", "COPY_WIRE"],
  ["trade_amount", "trade_amount", "COPY_WIRE"],
  ["before_money_balance", "before_money_balance", "COPY_WIRE"],
  ["after_money_balance", "after_money_balance", "COPY_WIRE"],
  ["before_gift_balance", "before_gift_balance", "COPY_WIRE"],
  ["after_gift_balance", "after_gift_balance", "COPY_WIRE"],
  ["point_delta", "point_delta", "COPY_WIRE"],
  ["currency", null, "CONSTANT_MYR"],
  ["order_id", null, "CONSTANT_NULL_UNRESOLVED_STABLE_FK"],
  ["source_pos_order_no", "pos_order_no", "COPY_WIRE"],
  ["source_order_id", "order_id", "COPY_WIRE"],
  ["source_code", "source_code", "COPY_WIRE"],
  ["created_at", null, "TARGET_TRANSACTION_TIMESTAMP"],
].map(([target_column, source_field, transform]) => Object.freeze({ source_field, target_column, transform })));

const config = Object.freeze({
  handlerId: "pos_member_card_txn_to_pos_member_card_transaction_v1",
  sourceRelation: "pos_member_card_txn",
  sourceFields: SOURCE_FIELDS,
  sourceIdentity: Object.freeze(["store", "txn_id"]),
  targetRelations: Object.freeze(["pos_member_card_transaction"]),
  resolutionFields: Object.freeze(["location_id", "pos_ingest_batch_id"]),
  fieldMappings: FIELD_MAPPINGS,
  evaluate(row, entry, h) {
    const blockers = [];
    const warnings = [];
    if (!entry?.location_id) blockers.push("LOCATION_AUTHORITY_MISSING");
    if (!entry?.pos_ingest_batch_id) blockers.push("INGEST_BATCH_AUTHORITY_MISSING");
    if (row.member_id === null && row.card_no === null) blockers.push("TARGET_CHECK_VIOLATION");
    const known = TRANSACTION_TYPES[row.txn_type];
    let targetType = "UNKNOWN";
    if (known) {
      if (known.label !== row.txn_type_label) blockers.push("SOURCE_TRANSACTION_TYPE_MISMATCH");
      else targetType = known.target;
    } else if (Object.hasOwn(LABEL_CODES, row.txn_type_label)) {
      blockers.push("SOURCE_TRANSACTION_TYPE_MISMATCH");
    } else {
      warnings.push("TRANSACTION_TYPE_UNKNOWN");
    }
    if (blockers.length > 0) return { blockers, warnings };
    const components = [h.sourceSystemId, entry.location_id, row.txn_id];
    return {
      blockers,
      warnings,
      relation: "pos_member_card_transaction",
      target_identity_key: h.targetIdentity("pos_member_card_transaction", components),
      values: [
        h.typed("member_card_transaction_id", "uuid", h.deterministicUuid("hotcrush:pos_member_card_transaction:v1", components)),
        h.typed("member_id", "uuid", null),
        h.typed("source_member_id", "text", row.member_id),
        h.typed("member_card_id", "uuid", null),
        h.typed("source_card_id", "text", row.card_no),
        h.typed("source_system_id", "uuid", h.sourceSystemId),
        h.typed("location_id", "uuid", entry.location_id),
        h.typed("pos_ingest_batch_id", "uuid", entry.pos_ingest_batch_id),
        h.typed("source_transaction_id", "text", row.txn_id),
        h.typed("source_transaction_type_code", "smallint", row.txn_type),
        h.typed("source_transaction_type_label", "text", row.txn_type_label),
        h.typed("transaction_type", "text", targetType),
        h.typed("occurred_at", "timestamptz", row.txn_at),
        h.typed("business_date", "date", row.business_date),
        h.typed("cash_amount", "numeric(18,4)", row.money_amount),
        h.typed("gift_amount", "numeric(18,4)", row.gift_amount),
        h.typed("total_amount", "numeric(18,4)", row.total_amount),
        h.typed("trade_amount", "numeric(18,4)", row.trade_amount),
        h.typed("before_money_balance", "numeric(18,4)", row.before_money_balance),
        h.typed("after_money_balance", "numeric(18,4)", row.after_money_balance),
        h.typed("before_gift_balance", "numeric(18,4)", row.before_gift_balance),
        h.typed("after_gift_balance", "numeric(18,4)", row.after_gift_balance),
        h.typed("point_delta", "integer", row.point_delta),
        h.typed("currency", "char(3)", "MYR"),
        h.typed("order_id", "uuid", null),
        h.typed("source_pos_order_no", "text", row.pos_order_no),
        h.typed("source_order_id", "text", row.order_id),
        h.typed("source_code", "text", row.source_code),
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
