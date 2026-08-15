import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ARTIFACT_TYPE,
  DEFAULT_REPLAY_AUTHORITY,
  runMemberOrderItemReplay,
  verifyMemberOrderItemReplayArtifact,
} from "../etl/res-replay/member-order-item-v1/index.mjs";

const KEYRING = Object.freeze({
  hmacKey: Buffer.alloc(32, 0x42),
  hmacKeyId: "synthetic-report211-hmac-v1",
  kek: Buffer.alloc(32, 0x24),
  kekId: "synthetic-report211-kek-v1",
});

function cell(value) {
  return { displayValue: value === null ? "" : String(value), value };
}

function row({ itemId, itemName, orderId, qty = "1.000", netSales = "3.50", reversal = "0" }) {
  return {
    D_businessDate: cell("2026-08-08"),
    D_shopId: cell("406994127"),
    D_currency: cell("MYR"),
    D_orderId: cell(orderId),
    D_posOrderId: cell(`POS_${orderId}`),
    D_itemId: cell(itemId),
    D_menuItemId: cell(`MENU_${itemName}`),
    D_itemName: cell(itemName),
    D_unitId: cell("SYNTH_UNIT_ID"),
    D_unit: cell("SYNTH_UNIT"),
    D_orderStatus: cell("20"),
    D_reversal_order: cell(reversal),
    D_isMemberConsume: cell("true"),
    D_openedTime: cell("2026-08-08 09:00:00"),
    D_orderDishesTime: cell("2026-08-08 09:01:00"),
    D_checkoutTime: cell("2026-08-08 09:02:00"),
    M_Item_SUM_qty: cell(qty.startsWith("-") ? qty.slice(1) : qty),
    M_Item_SUM_netQty: cell(qty),
    M_Item_SUM_netSales: cell(netSales),
    M_Item_SUM_grossSales: cell(netSales.startsWith("-") ? netSales.slice(1) : netSales),
    M_Item_SUM_discountProm: cell("0.00"),
    M_Item_SUM_refundQty: cell(qty.startsWith("-") ? qty.slice(1) : "0.000"),
    M_Item_SUM_refundAmount: cell(netSales.startsWith("-") ? netSales.slice(1) : "0.00"),
  };
}

function catalogRow({
  itemName,
  menuItemId = `MENU_${itemName}`,
  itemCode = `CODE_${itemName}`,
}) {
  return {
    D_itemName: cell(itemName),
    D_menuItemId: cell(menuItemId),
    D_itemCode: cell(itemCode),
    D_baseItemName: cell(`BASE_${itemName}`),
    D_category: cell("SYNTH_CATEGORY"),
    D_unitId: cell("SYNTH_UNIT_ID"),
    D_unit: cell("SYNTH_UNIT"),
    D_itemType: cell("SYNTH_ITEM_TYPE"),
  };
}

function responseBody(rows) {
  return Buffer.from(JSON.stringify({
    code: "000",
    data: { page: { total: rows.length }, rows },
    msg: "ok",
  }));
}

function fixtureBody() {
  return Buffer.from(JSON.stringify({
    code: "000",
    data: {
      page: { total: 3 },
      rows: [
        row({ itemId: "SYNTH_LINE_A", itemName: "SYNTH_ITEM_A", orderId: "SYNTH_ORDER_A" }),
        row({ itemId: "SYNTH_LINE_B", itemName: "SYNTH_ITEM_A", orderId: "SYNTH_ORDER_A" }),
        row({
          itemId: "SYNTH_LINE_C",
          itemName: "SYNTH_ITEM_B",
          netSales: "0.00",
          orderId: "SYNTH_ORDER_B",
          qty: "0.000",
        }),
      ],
    },
    msg: "ok",
  }));
}

function syntheticTransport(rawBody, calls) {
  return Object.freeze({
    kind: "SYNTHETIC_REPORT211_TRANSPORT_V1",
    async fetchSinglePage({ endpoint, requestBody }) {
      calls.push({ endpoint, requestBody });
      return {
        httpStatus: 200,
        rawBody: Buffer.from(rawBody),
        watermark: {
          observed_at: "2026-08-11T00:00:00.000Z",
          source_http_date: "Tue, 11 Aug 2026 00:00:00 GMT",
          source_request_id: "SYNTHETIC_REQUEST_ID",
        },
      };
    },
  });
}

test("default and live modes stop before transport; the package bundles no DB, Keychain, browser, or live fetch adapter", async () => {
  let calls = 0;
  const transport = {
    kind: "SYNTHETIC_REPORT211_TRANSPORT_V1",
    async fetchSinglePage() { calls += 1; throw new Error("must_not_run"); },
  };
  await assert.rejects(
    runMemberOrderItemReplay({ transport }),
    /explicit_replay_mode_required/,
  );
  await assert.rejects(
    runMemberOrderItemReplay({ mode: "LIVE_READ_ONLY", transport }),
    /live_replay_not_approved/,
  );
  const fabricatedApproval = structuredClone(DEFAULT_REPLAY_AUTHORITY);
  fabricatedApproval.execution.status = "APPROVED_READ_ONLY_REPLAY";
  fabricatedApproval.execution.live_read_only_replay_approved = true;
  await assert.rejects(
    runMemberOrderItemReplay({
      authority: fabricatedApproval,
      mode: "LIVE_READ_ONLY",
      transport,
    }),
    /live_replay_authority_override_forbidden/,
  );
  assert.equal(calls, 0);

  const packageDirectory = new URL("../etl/res-replay/member-order-item-v1/", import.meta.url);
  const sourceNames = (await readdir(packageDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name);
  const source = (await Promise.all(sourceNames.map((name) => readFile(new URL(name, packageDirectory), "utf8")))).join("\n");
  assert.doesNotMatch(source, /\bpostgres\b|DATABASE_URL|supabase|playwright|storageState|\/usr\/bin\/security/);
  assert.doesNotMatch(source, /globalThis\.fetch|\bfetch\s*\(/);
});

test("missing listing keys trigger one independent complete catalog capture without changing order source_row_count", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "hc-report211-replay-catalog-"));
  const orderRawBody = responseBody([
    row({ itemId: "SYNTH_LINE_A", itemName: "SYNTH_APPROVED_ITEM", orderId: "SYNTH_ORDER_A" }),
    row({ itemId: "SYNTH_LINE_B", itemName: "SYNTH_MISSING_ITEM", orderId: "SYNTH_ORDER_B" }),
  ]);
  const catalogRawBody = responseBody([
    catalogRow({ itemName: "SYNTH_MISSING_ITEM" }),
    catalogRow({ itemName: "SYNTH_UNRELATED_ITEM" }),
  ]);
  const calls = [];
  const transport = Object.freeze({
    kind: "SYNTHETIC_REPORT211_TRANSPORT_V1",
    async fetchSinglePage({ endpoint, purpose, requestBody }) {
      calls.push({ endpoint, purpose, requestBody });
      return {
        httpStatus: 200,
        rawBody: Buffer.from(purpose === "ORDER_LINES" ? orderRawBody : catalogRawBody),
        watermark: {
          observed_at: "2026-08-11T00:00:00.000Z",
          source_http_date: "Tue, 11 Aug 2026 00:00:00 GMT",
          source_request_id: `SYNTHETIC_${purpose}_REQUEST_ID`,
        },
      };
    },
  });
  const receipt = await runMemberOrderItemReplay({
    authority: DEFAULT_REPLAY_AUTHORITY,
    businessDate: "2026-08-08",
    keyring: KEYRING,
    mode: "SYNTHETIC_FIXTURE",
    outputDirectory,
    approvedListingItemKeys: ["SYNTH_APPROVED_ITEM"],
    transport,
  });

  assert.deepEqual(calls.map((call) => call.purpose), ["ORDER_LINES", "CATALOG_SUPPLEMENT"]);
  assert.equal(calls[1].requestBody.filters.some((filter) => filter.fieldName === "D_itemName"), false);
  assert.deepEqual(calls[1].requestBody.page, { pageNo: 1, pageSize: 2_000 });
  assert.equal(receipt.source_row_count, 2);
  assert.equal(receipt.catalog_supplement_response_row_count, 2);
  assert.equal(receipt.catalog_seed_row_count, 1);
  assert.equal(receipt.unresolved_listing_item_key_count, 0);
  assert.deepEqual(receipt.target_blockers, []);

  const ciphertext = await readFile(receipt.artifact_path);
  for (const marker of ["SYNTH_MISSING_ITEM", "SYNTHETIC_CATALOG_SUPPLEMENT_REQUEST_ID"]) {
    assert.equal(ciphertext.includes(Buffer.from(marker)), false);
    assert.equal(JSON.stringify(receipt).includes(marker), false);
  }
  const verified = await verifyMemberOrderItemReplayArtifact({
    artifactPath: receipt.artifact_path,
    keyring: KEYRING,
  });
  assert.equal(verified.analysis.page_stats.source_row_count, 2);
  assert.equal(verified.catalog_supplement.raw_response.equals(catalogRawBody), true);
  assert.equal(verified.catalog_supplement.analysis.page_stats.response_row_count, 2);
  assert.equal(verified.catalog_supplement.analysis.page_stats.selected_seed_row_count, 1);
  assert.deepEqual(verified.catalog_supplement.analysis.resolved_item_keys, ["SYNTH_MISSING_ITEM"]);
  assert.deepEqual(verified.target_blockers, []);
});

test("an incomplete selected catalog seed is encrypted but keeps its listing group blocked", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "hc-report211-replay-catalog-blocked-"));
  const orderRawBody = responseBody([
    row({ itemId: "SYNTH_LINE", itemName: "SYNTH_MISSING_ITEM", orderId: "SYNTH_ORDER" }),
  ]);
  const incomplete = catalogRow({ itemName: "SYNTH_MISSING_ITEM" });
  incomplete.D_menuItemId = cell(null);
  const catalogRawBody = responseBody([incomplete]);
  const transport = Object.freeze({
    kind: "SYNTHETIC_REPORT211_TRANSPORT_V1",
    async fetchSinglePage({ purpose }) {
      return {
        httpStatus: 200,
        rawBody: Buffer.from(purpose === "ORDER_LINES" ? orderRawBody : catalogRawBody),
        watermark: {
          observed_at: "2026-08-11T00:00:00.000Z",
          source_http_date: null,
          source_request_id: `SYNTHETIC_${purpose}_REQUEST_ID`,
        },
      };
    },
  });
  const receipt = await runMemberOrderItemReplay({
    authority: DEFAULT_REPLAY_AUTHORITY,
    businessDate: "2026-08-08",
    keyring: KEYRING,
    mode: "SYNTHETIC_FIXTURE",
    outputDirectory,
    approvedListingItemKeys: [],
    transport,
  });
  assert.equal(receipt.source_row_count, 1);
  assert.equal(receipt.catalog_seed_row_count, 0);
  assert.equal(receipt.unresolved_listing_item_key_count, 1);
  assert.deepEqual(receipt.target_blockers, ["CATALOG_SUPPLEMENT_UNRESOLVED_LISTING_KEYS"]);

  const verified = await verifyMemberOrderItemReplayArtifact({
    artifactPath: receipt.artifact_path,
    keyring: KEYRING,
  });
  assert.equal(verified.catalog_supplement.raw_response.equals(catalogRawBody), true);
  assert.deepEqual(verified.catalog_supplement.analysis.invalid_item_keys, ["SYNTH_MISSING_ITEM"]);
  assert.deepEqual(verified.catalog_supplement.analysis.seed_rows, []);
  assert.deepEqual(verified.target_blockers, ["CATALOG_SUPPLEMENT_UNRESOLVED_LISTING_KEYS"]);
});

test("encrypted raw response publishes once and three identical synthetic runs are idempotent", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "hc-report211-replay-"));
  const calls = [];
  const transport = syntheticTransport(fixtureBody(), calls);
  const runs = [];
  for (let index = 0; index < 3; index += 1) {
    runs.push(await runMemberOrderItemReplay({
      authority: DEFAULT_REPLAY_AUTHORITY,
      businessDate: "2026-08-08",
      keyring: KEYRING,
      mode: "SYNTHETIC_FIXTURE",
      outputDirectory,
      approvedListingItemKeys: ["SYNTH_ITEM_A", "SYNTH_ITEM_B"],
      transport,
    }));
  }
  assert.equal(calls.length, 3);
  assert.deepEqual(runs.map((run) => run.publication_status), ["PUBLISHED", "NOOP", "NOOP"]);
  assert.equal(new Set(runs.map((run) => run.artifact_sha256)).size, 1);
  assert.equal(new Set(runs.map((run) => run.artifact_path)).size, 1);
  assert.equal(runs[0].implementation_status, "IMPLEMENTED_NOT_EXECUTED");
  assert.equal(runs[0].physical_backfill_status, "PHYSICAL_BACKFILL_NOT_STARTED");
  assert.equal(runs[0].source_row_count, 3);
  assert.equal(runs[0].zero_quantity_groups, 1);
  assert.deepEqual(runs[0].target_blockers, ["ZERO_QUANTITY_REQUIRES_QUARANTINE"]);

  const names = await readdir(outputDirectory);
  assert.equal(names.length, 1);
  assert.match(names[0], /^report211-member-order-item-2026-08-08-[0-9a-f]{64}\.enc$/);
  assert.equal((await stat(runs[0].artifact_path)).mode & 0o777, 0o600);
  const ciphertext = await readFile(runs[0].artifact_path);
  for (const marker of ["SYNTH_ORDER_A", "SYNTH_ITEM_A", "SYNTHETIC_REQUEST_ID"]) {
    assert.equal(ciphertext.includes(Buffer.from(marker)), false);
    assert.equal(JSON.stringify(runs[0]).includes(marker), false);
  }

  const verified = await verifyMemberOrderItemReplayArtifact({
    artifactPath: runs[0].artifact_path,
    keyring: KEYRING,
  });
  assert.equal(verified.artifact_type, ARTIFACT_TYPE);
  assert.equal(verified.raw_response.equals(fixtureBody()), true);
  assert.equal(verified.analysis.page_stats.response_row_count, 3);
  assert.equal(verified.analysis.page_stats.aggregate_group_count, 2);
  assert.equal(verified.analysis.page_stats.source_row_count, 3);
  assert.deepEqual(verified.analysis.target_blockers, ["ZERO_QUANTITY_REQUIRES_QUARANTINE"]);

  const tamperedPath = path.join(outputDirectory, "tampered.enc");
  const tampered = Buffer.from(ciphertext);
  tampered[tampered.length - 1] ^= 1;
  await writeFile(tamperedPath, tampered, { mode: 0o600 });
  await assert.rejects(
    verifyMemberOrderItemReplayArtifact({ artifactPath: tamperedPath, keyring: KEYRING }),
    /envelope_authentication_failed/,
  );
});

test("a sensitive unexpected response key leaves no artifact", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "hc-report211-replay-pii-"));
  const unsafeRow = row({ itemId: "SYNTH_LINE", itemName: "SYNTH_ITEM", orderId: "SYNTH_ORDER" });
  unsafeRow.D_customerPhone = cell("SYNTHETIC_PHONE_MARKER");
  const rawBody = Buffer.from(JSON.stringify({
    code: "000",
    data: { page: { total: 1 }, rows: [unsafeRow] },
    msg: "ok",
  }));
  await assert.rejects(
    runMemberOrderItemReplay({
      authority: DEFAULT_REPLAY_AUTHORITY,
      businessDate: "2026-08-08",
      keyring: KEYRING,
      mode: "SYNTHETIC_FIXTURE",
      outputDirectory,
      approvedListingItemKeys: ["SYNTH_ITEM"],
      transport: syntheticTransport(rawBody, []),
    }),
    /forbidden_sensitive_key/,
  );
  assert.deepEqual(await readdir(outputDirectory), []);
});
