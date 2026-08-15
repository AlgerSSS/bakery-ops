import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalizeJcs, sha256Hex } from "../etl/lib/canonical.mjs";
import {
  S0_V2_ADDENDUM_PATH,
  S0_V2_ADDENDUM_SHA256,
  S0_V2_RELEASE,
  loadS0V2ContractAddendum,
} from "../etl/s0-v2-addendum-release.mjs";

const BASE_CONTRACT_PATH = new URL("../etl/migration-contract.json", import.meta.url);

test("S0 v2 addendum is canonical, pinned to both base-contract byte universes, and remains offline-only", async () => {
  const [addendumBytes, baseBytes] = await Promise.all([
    readFile(S0_V2_ADDENDUM_PATH),
    readFile(BASE_CONTRACT_PATH),
  ]);
  const addendum = JSON.parse(addendumBytes);
  const base = JSON.parse(baseBytes);

  assert.equal(addendumBytes.equals(canonicalizeJcs(addendum)), true);
  assert.equal(sha256Hex(addendumBytes), S0_V2_ADDENDUM_SHA256);
  assert.equal(baseBytes.length, 663_164);
  assert.equal(sha256Hex(baseBytes), "7ea542ef1e654b094628bbb97868b28a963879a4815740f7fa4f65c8c60d8587");
  assert.equal(canonicalizeJcs(base).length, 459_065);
  assert.equal(
    sha256Hex(canonicalizeJcs(base)),
    "4fb6c9acb9decfe873f9e44e954e1af5d7a6d7fc1005e529979bb6a584cc814f",
  );

  assert.deepEqual(addendum.base_contract, {
    canonical_jcs_bytes: 459_065,
    canonical_jcs_sha256: "4fb6c9acb9decfe873f9e44e954e1af5d7a6d7fc1005e529979bb6a584cc814f",
    file_bytes: 663_164,
    file_sha256: "7ea542ef1e654b094628bbb97868b28a963879a4815740f7fa4f65c8c60d8587",
  });
  assert.deepEqual(addendum.identity.multiset_tables, [
    "app_user_role_pre083",
    "cost_card_product_link_pre080",
  ]);
  assert.equal(addendum.counts.keyed_tables, 74);
  assert.equal(addendum.counts.source_tables, 76);
  assert.equal(addendum.counts.source_table_fields, 759);
  assert.equal(addendum.input.exact_encrypted_files, 77);
  assert.equal(addendum.output.status, "S0_ENCRYPTED_OFFLINE_VERIFIED_V2");
  assert.equal(addendum.output.release_status, "PHYSICAL_BACKFILL_NOT_STARTED");
  assert.equal(addendum.output.routing_allowed, false);
  assert.equal(addendum.output.target_load_allowed, false);
  assert.equal(addendum.output.catchup_allowed, false);
  assert.equal(addendum.artifact_policy.plaintext_file_persistence, "FORBIDDEN");
  assert.equal(addendum.artifact_policy.candidate_publish_gate, "INDEPENDENT_REFERENCE_VERIFIER_PASS");
  assert.equal(
    addendum.artifact_policy.candidate_publish,
    "ATOMIC_LINK_NO_REPLACE_AFTER_REFERENCE_PASS",
  );
  assert.equal(addendum.resource_policy.free_space_preflight, "FAIL_BEFORE_SIDE_EFFECTS");
  assert.equal(addendum.resource_policy.max_artifact_bytes, 16 * 1024 ** 3);
  assert.equal(addendum.resource_policy.reference_spill_concurrent_copies, 3);
  assert.equal(addendum.resource_policy.reference_spill_record_bytes, 1024 + 4 + 12 + 16);
  assert.ok(addendum.resource_policy.temporary_disk_multiplier >= 3);
  assert.ok(addendum.resource_policy.free_space_reserve_bytes >= 256 * 1024 * 1024);
  assert.ok(addendum.resource_policy.max_memory_bytes >= addendum.resource_policy.max_frame_bytes);
  assert.ok(
    addendum.resource_policy.max_run_plaintext_bytes >=
      addendum.resource_policy.max_frame_bytes + 64 * 1024,
  );
  assert.ok(
    addendum.resource_policy.max_run_plaintext_bytes <=
      Math.floor(addendum.resource_policy.max_memory_bytes / 2),
  );
  assert.ok(addendum.resource_policy.max_open_runs >= 2);
  assert.ok(addendum.resource_policy.max_merge_passes >= 2);

  assert.deepEqual(S0_V2_RELEASE, {
    authority_anchor: "SOURCE_CONTROL_COMMIT_REQUIRED",
    physical_backfill_status: "PHYSICAL_BACKFILL_NOT_STARTED",
    routing_activation: "NOT_ACTIVATED",
    signature_status: "UNSIGNED",
    status: "S0_V2_OFFLINE_CONVERTER_ONLY",
    target_writer_activation: "NOT_ACTIVATED",
  });
  const loaded = await loadS0V2ContractAddendum();
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.base_contract), true);
});

test("S0 v2 release rejects pretty, duplicate-key, altered, and independently resealed addenda", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-addendum-"));
  try {
    const original = await readFile(S0_V2_ADDENDUM_PATH);
    const parsed = JSON.parse(original);
    const cases = [
      Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, "utf8"),
      Buffer.from(original.toString("utf8").replace(
        /^\{/,
        '{"schema":"hotcrush.r6.s0-contract-addendum.v2",',
      )),
      canonicalizeJcs({ ...parsed, counts: { ...parsed.counts, keyed_tables: 73 } }),
    ];
    for (const [index, bytes] of cases.entries()) {
      const candidate = path.join(directory, `candidate-${index}.json`);
      await writeFile(candidate, bytes, { mode: 0o600 });
      await assert.rejects(
        loadS0V2ContractAddendum({ addendumPath: candidate }),
        /s0_v2_addendum_(?:noncanonical|pin_mismatch)/,
      );
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
