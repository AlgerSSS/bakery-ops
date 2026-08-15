import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { types as utilTypes } from "node:util";

import {
  canonicalizeJcs,
  parseCanonicalJcs,
  sha256Hex,
} from "./lib/canonical.mjs";

const ETL_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const S0_V2_ADDENDUM_PATH = path.join(ETL_DIRECTORY, "s0-v2-contract-addendum.json");
const BASE_CONTRACT_PATH = path.join(ETL_DIRECTORY, "migration-contract.json");

export const S0_V2_ADDENDUM_SHA256 =
  "0710ad32757c65ea655af3be0e885932c588a11ff9f7d073b8258e7ff1beaea7";

export const S0_V2_RELEASE = Object.freeze({
  authority_anchor: "SOURCE_CONTROL_COMMIT_REQUIRED",
  physical_backfill_status: "PHYSICAL_BACKFILL_NOT_STARTED",
  routing_activation: "NOT_ACTIVATED",
  signature_status: "UNSIGNED",
  status: "S0_V2_OFFLINE_CONVERTER_ONLY",
  target_writer_activation: "NOT_ACTIVATED",
});

const BASE_PIN = Object.freeze({
  canonical_jcs_bytes: 459_065,
  canonical_jcs_sha256: "4fb6c9acb9decfe873f9e44e954e1af5d7a6d7fc1005e529979bb6a584cc814f",
  file_bytes: 663_164,
  file_sha256: "7ea542ef1e654b094628bbb97868b28a963879a4815740f7fa4f65c8c60d8587",
});

function exactDataOptions(value) {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError("s0_v2_addendum_options_invalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set(["addendumPath", "baseContractPath"]);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowed.has(key) || !("value" in descriptor)) {
      throw new TypeError("s0_v2_addendum_options_invalid");
    }
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
  ));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function parseBaseContract(bytes) {
  let contract;
  try {
    contract = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("s0_v2_base_contract_pin_mismatch");
  }
  const canonical = canonicalizeJcs(contract);
  if (bytes.length !== BASE_PIN.file_bytes || sha256Hex(bytes) !== BASE_PIN.file_sha256 ||
      canonical.length !== BASE_PIN.canonical_jcs_bytes ||
      sha256Hex(canonical) !== BASE_PIN.canonical_jcs_sha256) {
    throw new Error("s0_v2_base_contract_pin_mismatch");
  }
  return contract;
}

function validateSemanticPins(addendum, contract) {
  if (!canonicalizeJcs(addendum.base_contract).equals(canonicalizeJcs(BASE_PIN)) ||
      addendum.schema !== "hotcrush.r6.s0-contract-addendum.v2" ||
      addendum.counts?.source_tables !== 76 ||
      addendum.counts?.source_table_fields !== 759 ||
      addendum.counts?.keyed_tables !== 74 ||
      addendum.counts?.multiset_tables !== 2 ||
      addendum.input?.exact_encrypted_files !== 77 ||
      addendum.artifact_policy?.candidate_publish !==
        "ATOMIC_LINK_NO_REPLACE_AFTER_REFERENCE_PASS" ||
      addendum.resource_policy?.max_frame_bytes !== 134_217_728 ||
      addendum.resource_policy?.max_run_plaintext_bytes !== 134_283_264 ||
      addendum.resource_policy?.reference_spill_concurrent_copies !== 3 ||
      addendum.resource_policy?.reference_spill_record_bytes !== 1_056 ||
      addendum.output?.status !== "S0_ENCRYPTED_OFFLINE_VERIFIED_V2" ||
      addendum.output?.release_status !== "PHYSICAL_BACKFILL_NOT_STARTED" ||
      addendum.output?.routing_allowed !== false ||
      addendum.output?.target_load_allowed !== false ||
      addendum.output?.catchup_allowed !== false) {
    throw new Error("s0_v2_addendum_pin_mismatch");
  }
  const multiset = contract.source_tables
    .filter((table) => table.identity.mode === "FULL_ROW_MULTISET")
    .map((table) => table.name)
    .sort();
  const keyedCount = contract.source_tables.length - multiset.length;
  if (contract.release_status !== "PHYSICAL_BACKFILL_NOT_STARTED" ||
      contract.counts?.source_tables !== 76 ||
      contract.counts?.source_table_fields !== 759 ||
      keyedCount !== 74 ||
      canonicalizeJcs(multiset).toString("utf8") !==
        canonicalizeJcs(addendum.identity?.multiset_tables).toString("utf8")) {
    throw new Error("s0_v2_base_contract_semantic_mismatch");
  }
}

export async function loadS0V2ContractAddendum(optionsInput) {
  const options = exactDataOptions(optionsInput);
  const addendumPath = options.addendumPath ?? S0_V2_ADDENDUM_PATH;
  const baseContractPath = options.baseContractPath ?? BASE_CONTRACT_PATH;
  if (typeof addendumPath !== "string" || typeof baseContractPath !== "string") {
    throw new TypeError("s0_v2_addendum_options_invalid");
  }
  const [addendumBytes, baseBytes] = await Promise.all([
    readFile(addendumPath),
    readFile(baseContractPath),
  ]);
  let addendum;
  try {
    addendum = parseCanonicalJcs(addendumBytes, { maxBytes: 1024 * 1024 });
  } catch {
    throw new Error("s0_v2_addendum_noncanonical");
  }
  if (sha256Hex(addendumBytes) !== S0_V2_ADDENDUM_SHA256) {
    throw new Error("s0_v2_addendum_pin_mismatch");
  }
  const contract = parseBaseContract(baseBytes);
  validateSemanticPins(addendum, contract);
  return deepFreeze(addendum);
}
