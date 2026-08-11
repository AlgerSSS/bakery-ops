import assert from "node:assert/strict";
import test from "node:test";

import { loadMigrationContract } from "../etl/lib/contract.mjs";
import { routeSourceRows } from "../etl/lib/router.mjs";

const HMAC_KEY = Buffer.alloc(32, 0x44);

function rowFor(table, suffix = "1") {
  return Object.fromEntries(
    table.fields.map((field) => [
      field.name,
      field.nullable ? null : `${field.name}-${suffix}`,
    ]),
  );
}

test("real A/R rows quarantine while the frozen handler registry is empty", async () => {
  const contract = await loadMigrationContract();
  const table = contract.source_tables.find((entry) => entry.name === "appointments");
  const ledger = routeSourceRows({
    contract,
    tableName: table.name,
    rows: [rowFor(table)],
    hmacKey: HMAC_KEY,
    runtimeHandlers: {},
    exclusionResolutions: [],
  });
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].outcome, "QUARANTINE");
  assert.equal(ledger[0].reason_code, "HANDLER_NOT_APPROVED");
  assert.equal(ledger[0].target_intents.length, 0);
});

test("P, X, and B0 fail closed; this release has no exclusion authority", async () => {
  const contract = await loadMigrationContract();
  for (const [tableName, reason] of [
    ["ai_call_log", "CLASS_PENDING_REVIEW"],
    ["app_session", "APPROVAL_MISSING"],
    ["fact_shift", "B0_UNEXPECTED_ROW"],
  ]) {
    const table = contract.source_tables.find((entry) => entry.name === tableName);
    const ledger = routeSourceRows({
      contract,
      tableName,
      rows: [rowFor(table)],
      hmacKey: HMAC_KEY,
      runtimeHandlers: {},
      exclusionResolutions: [],
    });
    assert.equal(ledger[0].outcome, "QUARANTINE");
    assert.equal(ledger[0].reason_code, reason);
    if (tableName === "app_session") {
      assert.equal(ledger[0].blocking_scope, "COMPLETENESS_ONLY");
    }
  }
  assert.deepEqual(contract.exclusion_authorities, []);
});

test("source identity is stable and FULL_ROW_MULTISET preserves duplicates", async () => {
  const contract = await loadMigrationContract();
  const table = contract.source_tables.find(
    (entry) => entry.name === "cost_card_product_link_pre080",
  );
  const duplicate = rowFor(table);
  const forward = routeSourceRows({
    contract,
    tableName: table.name,
    rows: [duplicate, duplicate],
    hmacKey: HMAC_KEY,
    runtimeHandlers: {},
    exclusionResolutions: [],
  });
  const reverse = routeSourceRows({
    contract,
    tableName: table.name,
    rows: [duplicate, duplicate].reverse(),
    hmacKey: HMAC_KEY,
    runtimeHandlers: {},
    exclusionResolutions: [],
  });
  assert.equal(forward.length, 2);
  assert.equal(new Set(forward.map((entry) => entry.source_row_id)).size, 2);
  assert.deepEqual(
    forward.map((entry) => entry.source_row_id).sort(),
    reverse.map((entry) => entry.source_row_id).sort(),
  );
});

test("duplicate keyed identities quarantine every conflicting occurrence", async () => {
  const contract = await loadMigrationContract();
  const table = contract.source_tables.find((entry) => entry.name === "appointments");
  const duplicate = rowFor(table);
  const ledger = routeSourceRows({
    contract,
    tableName: table.name,
    rows: [duplicate, { ...duplicate }],
    hmacKey: HMAC_KEY,
    runtimeHandlers: {},
    exclusionResolutions: [],
  });
  assert.ok(ledger.every((entry) => entry.outcome === "QUARANTINE"));
  assert.ok(ledger.every((entry) => entry.reason_code === "DUPLICATE_SOURCE_IDENTITY"));
});

test("routing conserves occurrences with exactly one outcome", async () => {
  const contract = await loadMigrationContract();
  let sourceCount = 0;
  let ledgerCount = 0;
  for (const table of contract.source_tables) {
    const rows = table.migration_class === "B0" ? [] : [rowFor(table)];
    sourceCount += rows.length;
    const ledger = routeSourceRows({
      contract,
      tableName: table.name,
      rows,
      hmacKey: HMAC_KEY,
      runtimeHandlers: {},
      exclusionResolutions: [],
    });
    ledgerCount += ledger.length;
    assert.ok(ledger.every((entry) =>
      ["TARGET", "QUARANTINE", "EXCLUSION"].includes(entry.outcome)
    ));
  }
  assert.equal(ledgerCount, sourceCount);
});
