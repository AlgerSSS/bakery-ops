import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { types as utilTypes } from "node:util";

import { canonicalizeJcs, parseCanonicalJcs } from "./lib/canonical.mjs";
import { assertSafeArtifactDirectory } from "./lib/envelope-stream.mjs";
import {
  closePreparedEncryptedSort,
  defaultEncryptedSortStatfs,
  iteratePreparedEncryptedSort,
  prepareEncryptedExternalSort,
} from "./lib/encrypted-external-sort.mjs";
import { domainHmac } from "./lib/identity.mjs";
import { validateKeyring } from "./lib/keys.mjs";
import {
  closeAuthenticatedRawCapture,
  issueAuthenticatedRawCaptureInputAuthority,
  iterateAuthenticatedRawCapture,
  openAuthenticatedRawCapture,
} from "./lib/raw-capture-authenticated-reader.mjs";
import {
  buildS0V2ContentDocument,
  computeS0V2GlobalRoots,
  deriveS0V2SourceRow,
  frameS0V2Value,
  inspectS0V2SourceRow,
  materializeS0V2Occurrence,
} from "./lib/s0-v2-format.mjs";
import { writeVerifiedS0V2Candidate } from "./lib/s0-v2-writer.mjs";
import {
  S0_V2_ADDENDUM_SHA256,
  loadS0V2ContractAddendum,
} from "./s0-v2-addendum-release.mjs";

const FILE_SHA = "7ea542ef1e654b094628bbb97868b28a963879a4815740f7fa4f65c8c60d8587";
const JCS_SHA = "4fb6c9acb9decfe873f9e44e954e1af5d7a6d7fc1005e529979bb6a584cc814f";
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONVERTED_TABLE_AUTHORITIES = new WeakMap();

function snapshotData(value, state = { nodes: 0, seen: new Set() }) {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (!value || typeof value !== "object" || Buffer.isBuffer(value) || value instanceof Date ||
      utilTypes.isProxy(value) || state.seen.has(value) || ++state.nodes > 100_000) {
    throw new TypeError("s0_v2_converter_contract_invalid");
  }
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError("s0_v2_converter_contract_invalid");
        output.push(snapshotData(Object.getOwnPropertyDescriptor(value, String(index))?.value, state));
      }
      if (Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) ||
          Object.getOwnPropertySymbols(value).length !== 0) {
        throw new TypeError("s0_v2_converter_contract_invalid");
      }
      return output;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError("s0_v2_converter_contract_invalid");
    }
    const output = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor) || ["__proto__", "constructor", "prototype"].includes(key)) {
        throw new TypeError("s0_v2_converter_contract_invalid");
      }
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: snapshotData(descriptor.value, state),
        writable: true,
      });
    }
    return output;
  } finally {
    state.seen.delete(value);
  }
}

function exact(value, keys, code, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(code);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const allowed = new Set([...keys, ...optional]);
  if (keys.some((key) => !Object.hasOwn(descriptors, key)) ||
      actual.some((key) => !allowed.has(key)) ||
      Object.values(descriptors).some((descriptor) => !("value" in descriptor))) {
    throw new TypeError(code);
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) =>
    [key, descriptor.value]));
}

function convertedRowsCommitment(tables) {
  return createHash("sha256").update(canonicalizeJcs(tables.map((table) => ({
    data_stream_bytes: table.streams.data.bytes,
    data_stream_sha256: table.streams.data.sha256,
    occurrence_stream_bytes: table.streams.occurrences.bytes,
    occurrence_stream_sha256: table.streams.occurrences.sha256,
    row_count: table.row_count,
    table: table.table,
    table_root_hex: table.table_root_hex,
  })))).digest("hex");
}

function issueConvertedTablesAuthority({
  content,
  contract,
  directory,
  filename,
  inputAuthority,
  tables,
}) {
  const authority = Object.freeze({});
  CONVERTED_TABLE_AUTHORITIES.set(authority, {
    content,
    contract,
    convertedRowsCommitmentSha256: convertedRowsCommitment(tables),
    directory,
    filename,
    inputAuthority,
    tables,
    used: false,
  });
  return authority;
}

export function resolveS0V2ConvertedTablesAuthority(authority) {
  const state = CONVERTED_TABLE_AUTHORITIES.get(authority);
  if (!state || state.used) throw new Error("s0_v2_writer_conversion_authority_invalid");
  state.used = true;
  return Object.freeze({
    content: state.content,
    contract: state.contract,
    converted_rows_commitment_sha256: state.convertedRowsCommitmentSha256,
    directory: state.directory,
    filename: state.filename,
    inputAuthority: state.inputAuthority,
    tables: state.tables,
  });
}

function resourcePolicies(addendum) {
  const value = addendum.resource_policy;
  return Object.freeze({
    reader: Object.freeze({
      freeSpaceReserveBytes: value.free_space_reserve_bytes,
      maxArtifactBytes: value.max_artifact_bytes,
      maxFrameBytes: value.max_frame_bytes,
      temporaryDiskMultiplier: value.temporary_disk_multiplier,
    }),
    sort: Object.freeze({
      freeSpaceReserveBytes: value.free_space_reserve_bytes,
      maxArtifactBytes: value.max_artifact_bytes,
      maxFrameBytes: value.max_frame_bytes,
      maxMemoryBytes: value.max_memory_bytes,
      maxMergePasses: value.max_merge_passes,
      maxOpenRuns: value.max_open_runs,
      maxRunPlaintextBytes: value.max_run_plaintext_bytes,
      temporaryDiskMultiplier: value.temporary_disk_multiplier,
    }),
  });
}

function outputAvailableBytes(info) {
  try {
    const bavail = typeof info?.bavail === "bigint" ? info.bavail : BigInt(info?.bavail);
    const bsize = typeof info?.bsize === "bigint" ? info.bsize : BigInt(info?.bsize);
    if (bavail < 0n || bsize <= 0n) throw new Error();
    return bavail * bsize;
  } catch {
    throw new Error("s0_v2_output_space_probe_failed");
  }
}

async function assertNoPrelinkCandidateResidue(directory, filename) {
  const entries = await readdir(directory, { withFileTypes: true });
  if (!entries.some((entry) => entry.name.startsWith(".s0-v2-candidate-"))) return;
  try {
    await lstat(path.join(directory, filename));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("PUBLISH_PRELINK_RESIDUE_BLOCKED");
    throw error;
  }
}

function encodeOccurrence(record, maxFrameBytes) {
  const token = Buffer.from(record.token_bytes);
  const typed = Buffer.from(record.typed_row_bytes);
  if (token.length === 0 || token.length > 0xffff_ffff || typed.length === 0 ||
      token.length + typed.length + 4 > maxFrameBytes) {
    throw new Error("s0_v2_occurrence_record_too_large");
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(token.length);
  return Buffer.concat([length, token, typed]);
}

function decodeOccurrence(value, table, maxFrameBytes) {
  if (!Buffer.isBuffer(value) || value.length <= 4 || value.length > maxFrameBytes) {
    throw new Error("s0_v2_occurrence_record_invalid");
  }
  const tokenLength = value.readUInt32BE(0);
  if (tokenLength <= 0 || tokenLength >= value.length - 4) {
    throw new Error("s0_v2_occurrence_record_invalid");
  }
  const tokenBytes = Buffer.from(value.subarray(4, 4 + tokenLength));
  const typedRowBytes = Buffer.from(value.subarray(4 + tokenLength));
  let token;
  try {
    token = parseCanonicalJcs(tokenBytes, { maxBytes: maxFrameBytes });
    token = exact(token, ["identity_hmac", "occurrence_id", "payload_hmac", "row_id", "table"],
      "s0_v2_occurrence_record_invalid");
  } catch {
    throw new Error("s0_v2_occurrence_record_invalid");
  }
  if (token.table !== table.name || !UUID_V5.test(token.occurrence_id) ||
      !UUID_V5.test(token.row_id)) {
    throw new Error("s0_v2_occurrence_record_invalid");
  }
  for (const value of [token.identity_hmac, token.payload_hmac]) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error("s0_v2_occurrence_record_invalid");
    }
    const bytes = Buffer.from(value, "base64url");
    if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
      throw new Error("s0_v2_occurrence_record_invalid");
    }
  }
  return Object.freeze({
    occurrence_id: token.occurrence_id,
    row_id: token.row_id,
    token: Object.freeze(token),
    token_bytes: tokenBytes,
    typed_row_bytes: typedRowBytes,
  });
}

async function* decodedRecords(prepared, table, maxFrameBytes) {
  for await (const sorted of iteratePreparedEncryptedSort(prepared)) {
    const record = decodeOccurrence(sorted.value, table, maxFrameBytes);
    if (record.occurrence_id !== sorted.key) throw new Error("s0_v2_occurrence_sort_key_mismatch");
    yield record;
  }
}

async function summarizeTable({ hmacKey, prepared, table, maxFrameBytes }) {
  const dataHash = createHash("sha256");
  const occurrenceHash = createHash("sha256");
  let dataBytes = 0;
  let occurrenceBytes = 0;
  let rowCount = 0;
  for await (const record of decodedRecords(prepared, table, maxFrameBytes)) {
    const dataFrame = frameS0V2Value(record.typed_row_bytes);
    const occurrenceFrame = frameS0V2Value(record.token_bytes);
    dataHash.update(dataFrame);
    occurrenceHash.update(occurrenceFrame);
    dataBytes += dataFrame.length;
    occurrenceBytes += occurrenceFrame.length;
    rowCount += 1;
    if (![dataBytes, occurrenceBytes, rowCount].every(Number.isSafeInteger)) {
      throw new Error("s0_v2_table_stream_size_overflow");
    }
  }
  const dataSha = dataHash.digest("hex");
  const occurrenceSha = occurrenceHash.digest("hex");
  const dataRoot = domainHmac(hmacKey, "s0-table-data-stream:v2", canonicalizeJcs({
    bytes: dataBytes,
    row_count: rowCount,
    sha256: dataSha,
    table: table.name,
  }));
  const occurrenceRoot = domainHmac(hmacKey, "s0-table-occurrences:v2", canonicalizeJcs({
    bytes: occurrenceBytes,
    row_count: rowCount,
    sha256: occurrenceSha,
    table: table.name,
  }));
  const tableRoot = domainHmac(hmacKey, "s0-table-root:v2", canonicalizeJcs({
    identity_mode: table.identity.mode,
    row_count: rowCount,
    table: table.name,
    table_data_stream_root: dataRoot.toString("base64url"),
    table_occurrences_root: occurrenceRoot.toString("base64url"),
  }));
  return Object.freeze({
    identity_mode: table.identity.mode,
    records: () => decodedRecords(prepared, table, maxFrameBytes),
    row_count: rowCount,
    streams: Object.freeze({
      data: Object.freeze({ bytes: dataBytes, root_hex: dataRoot.toString("hex"), sha256: dataSha }),
      occurrences: Object.freeze({
        bytes: occurrenceBytes,
        root_hex: occurrenceRoot.toString("hex"),
        sha256: occurrenceSha,
      }),
    }),
    table: table.name,
    table_root_hex: tableRoot.toString("hex"),
  });
}

function sourceSortRecords(rawIterator, table, hmacKey) {
  return (async function* records() {
    const start = await rawIterator.next();
    if (start.done || start.value.type !== "TABLE_START" || start.value.table !== table.name) {
      throw new Error("s0_v2_raw_table_sequence_invalid");
    }
    let rows = 0;
    while (true) {
      const event = await rawIterator.next();
      if (event.done) throw new Error("s0_v2_raw_table_sequence_invalid");
      if (event.value.type === "TABLE_END") {
        if (event.value.table !== table.name || event.value.row_count !== rows) {
          throw new Error("s0_v2_raw_table_count_mismatch");
        }
        return;
      }
      if (event.value.type !== "ROW" || event.value.table !== table.name ||
          !Buffer.isBuffer(event.value.typed_row_bytes)) {
        throw new Error("s0_v2_raw_table_sequence_invalid");
      }
      const sourceRow = deriveS0V2SourceRow({
        hmacKey,
        table,
        typedRow: event.value.typed_row_bytes,
      });
      const inspected = inspectS0V2SourceRow(sourceRow);
      rows += 1;
      if (!Number.isSafeInteger(rows)) throw new Error("s0_v2_raw_table_count_overflow");
      yield {
        key: table.identity.mode === "FULL_ROW_MULTISET"
          ? inspected.payload_hmac_hex
          : inspected.identity_hmac_hex,
        value: inspected.typed_row_bytes,
      };
    }
  }());
}

function occurrenceSortRecords(first, table, hmacKey, maxFrameBytes) {
  return (async function* records() {
    let previousKey = null;
    let previousTyped = null;
    let ordinal = 0;
    for await (const sorted of iteratePreparedEncryptedSort(first)) {
      if (table.identity.mode !== "FULL_ROW_MULTISET" && sorted.key === previousKey) {
        throw new Error("s0_v2_duplicate_source_identity");
      }
      if (table.identity.mode === "FULL_ROW_MULTISET") {
        if (sorted.key === previousKey) {
          if (!previousTyped.equals(sorted.value)) throw new Error("s0_v2_payload_hmac_collision");
          ordinal += 1;
          if (!Number.isSafeInteger(ordinal)) throw new Error("s0_v2_multiset_ordinal_overflow");
        } else {
          ordinal = 0;
        }
      }
      const sourceRow = deriveS0V2SourceRow({ hmacKey, table, typedRow: sorted.value });
      const inspected = inspectS0V2SourceRow(sourceRow);
      const expectedKey = table.identity.mode === "FULL_ROW_MULTISET"
        ? inspected.payload_hmac_hex
        : inspected.identity_hmac_hex;
      if (expectedKey !== sorted.key) throw new Error("s0_v2_source_sort_key_mismatch");
      const occurrence = materializeS0V2Occurrence({
        hmacKey,
        ...(table.identity.mode === "FULL_ROW_MULTISET" ? { occurrence: ordinal } : {}),
        sourceRow,
        table,
      });
      previousKey = sorted.key;
      previousTyped = Buffer.from(sorted.value);
      yield {
        key: occurrence.occurrence_id,
        value: encodeOccurrence(occurrence, maxFrameBytes),
      };
    }
  }());
}

async function transformTable({
  encryptedBytes,
  hmacKey,
  rawIterator,
  resourcePolicy,
  statfsImpl,
  table,
  workDirectory,
}) {
  const first = await prepareEncryptedExternalSort({
    duplicatePolicy: "ALLOW",
    estimatedInputBytes: encryptedBytes,
    keyKind: "LOWERCASE_HEX_64",
    records: sourceSortRecords(rawIterator, table, hmacKey),
    resourcePolicy,
    statfsImpl,
    workDirectory,
  });
  let second;
  let operationError;
  try {
    second = await prepareEncryptedExternalSort({
      duplicatePolicy: "FAIL",
      estimatedInputBytes: Math.min(Number.MAX_SAFE_INTEGER, encryptedBytes * 2),
      keyKind: "LOWERCASE_UUID_V5",
      records: occurrenceSortRecords(first, table, hmacKey, resourcePolicy.maxFrameBytes),
      resourcePolicy,
      statfsImpl,
      workDirectory,
    });
  } catch (error) {
    operationError = error;
  } finally {
    try {
      await closePreparedEncryptedSort(first);
    } catch (cleanupError) {
      if (operationError) attachCleanupFailure(operationError, cleanupError);
      else operationError = cleanupError;
    }
  }
  if (operationError) {
    if (second) {
      try {
        await closePreparedEncryptedSort(second);
      } catch (cleanupError) {
        attachCleanupFailure(operationError, cleanupError);
      }
    }
    throw operationError;
  }
  return second;
}

function attachCleanupFailure(error, cleanupError) {
  if (!Object.hasOwn(error, "cleanupFailure")) {
    Object.defineProperty(error, "cleanupFailure", {
      configurable: false,
      enumerable: false,
      value: cleanupError,
      writable: false,
    });
  }
}

export async function convertRawCaptureToS0V2(input) {
  const options = exact(input, [
    "captureDirectory", "contract", "detachedManifestArtifactSha256", "directory", "filename",
    "keyring", "snapshotParent", "workDirectory",
  ], "s0_v2_converter_input_invalid", ["statfsImpl", "testHooks"]);
  const statfsImpl = options.statfsImpl ?? defaultEncryptedSortStatfs;
  if (![options.captureDirectory, options.directory, options.snapshotParent, options.workDirectory]
    .every((value) => typeof value === "string" && path.isAbsolute(value)) ||
      typeof options.filename !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/.test(options.filename) ||
      path.basename(options.filename) !== options.filename || options.filename.includes("..") ||
      typeof options.detachedManifestArtifactSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(options.detachedManifestArtifactSha256) ||
      typeof statfsImpl !== "function") {
    throw new TypeError("s0_v2_converter_input_invalid");
  }
  const capturePath = path.resolve(options.captureDirectory);
  for (const writablePath of [options.directory, options.snapshotParent, options.workDirectory]) {
    const relative = path.relative(capturePath, path.resolve(writablePath));
    if (relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative)) {
      throw new TypeError("s0_v2_converter_input_invalid");
    }
  }
  const addendum = await loadS0V2ContractAddendum();
  const policies = resourcePolicies(addendum);
  await assertSafeArtifactDirectory(options.directory);
  let outputFree;
  try {
    outputFree = outputAvailableBytes(await statfsImpl(options.directory));
  } catch (error) {
    if (error?.message === "s0_v2_output_space_probe_failed") throw error;
    throw new Error("s0_v2_output_space_probe_failed");
  }
  const requiredOutputBytes = BigInt(addendum.resource_policy.max_artifact_bytes) +
    BigInt(addendum.resource_policy.free_space_reserve_bytes);
  if (outputFree < requiredOutputBytes) throw new Error("s0_v2_insufficient_output_space");
  await assertNoPrelinkCandidateResidue(options.directory, options.filename);
  const contract = snapshotData(options.contract);
  if (createHash("sha256").update(canonicalizeJcs(contract)).digest("hex") !== JCS_SHA) {
    throw new TypeError("s0_v2_converter_contract_invalid");
  }
  const keyring = validateKeyring(options.keyring);
  const prepared = [];
  let capability;
  let rawIterator;
  let receipt;
  let operationError;
  let sourcesReleased = false;
  async function releaseSources() {
    if (sourcesReleased) return;
    let releaseError;
    try {
      await rawIterator?.return?.();
    } catch (error) {
      releaseError = error;
    }
    const cleanupResults = await Promise.allSettled([
      ...prepared.map((item) => closePreparedEncryptedSort(item)),
      ...(capability ? [closeAuthenticatedRawCapture(capability)] : []),
    ]);
    for (const result of cleanupResults) {
      if (result.status !== "rejected") continue;
      if (!releaseError) releaseError = result.reason;
      else attachCleanupFailure(releaseError, result.reason);
    }
    if (releaseError) throw releaseError;
    sourcesReleased = true;
  }
  try {
    capability = await openAuthenticatedRawCapture({
      captureDirectory: options.captureDirectory,
      contract,
      detachedManifestArtifactSha256: options.detachedManifestArtifactSha256,
      keyring,
      resourcePolicy: policies.reader,
      snapshotParent: options.snapshotParent,
      statfsImpl,
    });
    if (!Number.isSafeInteger(capability.encrypted_bytes) || capability.encrypted_bytes <= 0 ||
        capability.counts.shards !== 76 || capability.counts.columns !== 759 ||
        capability.counts.views_queried !== 0) {
      throw new Error("s0_v2_authenticated_capture_invalid");
    }
    rawIterator = iterateAuthenticatedRawCapture(capability)[Symbol.asyncIterator]();
    const tables = [];
    let rows = 0;
    for (const table of contract.source_tables) {
      const sorted = await transformTable({
        encryptedBytes: capability.encrypted_bytes,
        hmacKey: keyring.hmacKey,
        rawIterator,
        resourcePolicy: policies.sort,
        statfsImpl,
        table,
        workDirectory: options.workDirectory,
      });
      prepared.push(sorted);
      const built = await summarizeTable({
        hmacKey: keyring.hmacKey,
        maxFrameBytes: policies.sort.maxFrameBytes,
        prepared: sorted,
        table,
      });
      rows += built.row_count;
      if (!Number.isSafeInteger(rows)) throw new Error("s0_v2_row_count_overflow");
      tables.push(built);
    }
    const end = await rawIterator.next();
    if (!end.done || rows !== capability.counts.rows) throw new Error("s0_v2_raw_row_count_mismatch");
    const convertedTables = Object.freeze(tables);
    const roots = computeS0V2GlobalRoots({
      baseContractFileSha256: FILE_SHA,
      baseContractJcsSha256: JCS_SHA,
      hmacKey: keyring.hmacKey,
      tables: convertedTables,
    });
    const counts = { columns: 759, rows, tables: 76, views_queried: 0 };
    const content = buildS0V2ContentDocument({
      addendumSha256: S0_V2_ADDENDUM_SHA256,
      baseContractFileSha256: FILE_SHA,
      baseContractJcsSha256: JCS_SHA,
      counts,
      hmacKey: keyring.hmacKey,
      hmacKeyId: keyring.hmacKeyId,
      input: {
        capture_sha256: capability.capture_sha256,
        manifest_artifact_sha256: options.detachedManifestArtifactSha256,
        manifest_content_sha256: capability.manifest_content_sha256,
        snapshot_sha256: capability.snapshot_sha256,
        status: capability.status,
      },
      roots,
      tables: convertedTables,
    });
    const inputAuthority = issueAuthenticatedRawCaptureInputAuthority(capability);
    const conversionAuthority = issueConvertedTablesAuthority({
      content,
      contract,
      directory: options.directory,
      filename: options.filename,
      inputAuthority,
      tables: convertedTables,
    });
    receipt = await writeVerifiedS0V2Candidate({
      content,
      contract,
      conversionAuthority,
      directory: options.directory,
      filename: options.filename,
      inputAuthority,
      keyring,
      releaseSources,
      statfsImpl,
      tables: convertedTables,
      ...(options.testHooks === undefined ? {} : { testHooks: options.testHooks }),
    });
  } catch (error) {
    operationError = error;
  } finally {
    try {
      await releaseSources();
    } catch (cleanupError) {
      if (operationError) attachCleanupFailure(operationError, cleanupError);
      else operationError = cleanupError;
    }
    keyring.kek.fill(0);
    keyring.hmacKey.fill(0);
  }
  if (operationError) throw operationError;
  return receipt;
}
