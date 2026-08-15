import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  open,
  readdir,
  rm,
  statfs,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { types as utilTypes } from "node:util";

import { canonicalizeJcs, parseCanonicalJcs } from "./canonical.mjs";
import {
  assertSafeArtifactDirectory,
  syncArtifactDirectory,
  writeStreamingEncryptedArtifact,
} from "./envelope-stream.mjs";
import { validateKeyring } from "./keys.mjs";
import { resolveAuthenticatedRawCaptureInputAuthority } from "./raw-capture-authenticated-reader.mjs";
import {
  buildS0V2ContentDocument,
  computeS0V2GlobalRoots,
  frameS0V2Value,
  S0_V2_SCHEMA,
  S0_V2_STATUS,
} from "./s0-v2-format.mjs";
import { verifyS0V2Candidate } from "../reference/s0-v2-reference-verifier.mjs";
import { S0_V2_ADDENDUM_SHA256 } from "../s0-v2-addendum-release.mjs";
import { resolveS0V2ConvertedTablesAuthority } from "../s0-v2-convert.mjs";

const FILE_SHA = "7ea542ef1e654b094628bbb97868b28a963879a4815740f7fa4f65c8c60d8587";
const JCS_SHA = "4fb6c9acb9decfe873f9e44e954e1af5d7a6d7fc1005e529979bb6a584cc814f";
const DIGEST = /^[0-9a-f]{64}$/;
const MAX_ARTIFACT_BYTES = 17_179_869_184;
const OUTPUT_RESERVE_BYTES = 1_073_741_824;
const MAX_ENVELOPE_OVERHEAD_BYTES = 16 * 1024 + 128;
const REFERENCE_SPILL_RECORD_BYTES = 1_056;
const REFERENCE_SPILL_CONCURRENT_COPIES = 3;

function exactInput(value) {
  const required = [
    "content", "contract", "directory", "filename", "inputAuthority", "keyring", "tables",
  ];
  const allowed = new Set([
    ...required, "conversionAuthority", "releaseSources", "statfsImpl", "testHooks",
  ]);
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError("s0_v2_writer_input_invalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  if (required.some((key) => !Object.hasOwn(descriptors, key)) ||
      actual.some((key) => !allowed.has(key)) ||
      Object.values(descriptors).some((descriptor) => !("value" in descriptor))) {
    throw new TypeError("s0_v2_writer_input_invalid");
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) =>
    [key, descriptor.value]));
}

function exactTestHooks(value) {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError("s0_v2_writer_input_invalid");
  }
  const allowed = new Set([
    "afterCandidateUnlink", "afterLink", "beforeCandidateUnlink", "beforeDirectorySync",
    "beforeFinalDirectorySync", "beforeLink", "beforeTemporaryRemove",
    "beforeUnpublishedCleanup",
  ]);
  const output = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!allowed.has(key) || !("value" in descriptor) || typeof descriptor.value !== "function" ||
        utilTypes.isProxy(descriptor.value)) {
      throw new TypeError("s0_v2_writer_input_invalid");
    }
    output[key] = descriptor.value;
  }
  return Object.freeze(output);
}

function snapshotData(value, state = { nodes: 0, seen: new Set() }) {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (!value || typeof value !== "object" || Buffer.isBuffer(value) || value instanceof Date ||
      utilTypes.isProxy(value) || state.seen.has(value) || ++state.nodes > 100_000) {
    throw new TypeError("s0_v2_writer_input_invalid");
  }
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) throw new TypeError("s0_v2_writer_input_invalid");
        output.push(snapshotData(descriptor.value, state));
      }
      if (Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) ||
          Object.getOwnPropertySymbols(value).length !== 0) {
        throw new TypeError("s0_v2_writer_input_invalid");
      }
      return output;
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError("s0_v2_writer_input_invalid");
    }
    const output = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor) || ["__proto__", "constructor", "prototype"].includes(key)) {
        throw new TypeError("s0_v2_writer_input_invalid");
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

function snapshotTables(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) ||
      Object.getOwnPropertySymbols(value).length !== 0 ||
      Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) {
    throw new TypeError("s0_v2_writer_tables_invalid");
  }
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    const table = descriptor?.value;
    if (!descriptor || !("value" in descriptor) || !table || typeof table !== "object" ||
        Array.isArray(table) || utilTypes.isProxy(table) ||
        Object.getPrototypeOf(table) !== Object.prototype ||
        Object.getOwnPropertySymbols(table).length !== 0) {
      throw new TypeError("s0_v2_writer_tables_invalid");
    }
    const descriptors = Object.getOwnPropertyDescriptors(table);
    const required = ["identity_mode", "records", "row_count", "streams", "table", "table_root_hex"];
    const allowed = new Set([...required, "data_frames", "occurrence_frames"]);
    if (required.some((key) => !Object.hasOwn(descriptors, key)) ||
        Object.keys(descriptors).some((key) => !allowed.has(key)) ||
        Object.values(descriptors).some((item) => !("value" in item))) {
      throw new TypeError("s0_v2_writer_tables_invalid");
    }
    let records = descriptors.records.value;
    if (Array.isArray(records)) {
      if (utilTypes.isProxy(records) || Object.getOwnPropertySymbols(records).length !== 0 ||
          Object.keys(records).some((key) => !/^(0|[1-9][0-9]*)$/.test(key) ||
            Number(key) >= records.length)) {
        throw new TypeError("s0_v2_writer_tables_invalid");
      }
      const cloned = [];
      for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
        const recordDescriptor = Object.getOwnPropertyDescriptor(records, String(recordIndex));
        if (!recordDescriptor || !("value" in recordDescriptor)) {
          throw new TypeError("s0_v2_writer_tables_invalid");
        }
        cloned.push(recordDescriptor.value);
      }
      records = Object.freeze(cloned);
    } else if (typeof records !== "function" || utilTypes.isProxy(records)) {
      throw new TypeError("s0_v2_writer_tables_invalid");
    }
    output.push(Object.freeze({
      identity_mode: descriptors.identity_mode.value,
      records,
      row_count: descriptors.row_count.value,
      streams: snapshotData(descriptors.streams.value),
      table: descriptors.table.value,
      table_root_hex: descriptors.table_root_hex.value,
    }));
  }
  return Object.freeze(output);
}

function snapshotRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError("s0_v2_writer_record_invalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const required = ["occurrence_id", "row_id", "token", "token_bytes", "typed_row_bytes"];
  const allowed = new Set([
    ...required, "identity_hmac_hex", "occurrence_hmac_hex", "payload_hmac_hex",
  ]);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) ||
      Object.keys(descriptors).some((key) => !allowed.has(key)) ||
      Object.values(descriptors).some((item) => !("value" in item)) ||
      !Buffer.isBuffer(descriptors.token_bytes.value) ||
      !Buffer.isBuffer(descriptors.typed_row_bytes.value)) {
    throw new TypeError("s0_v2_writer_record_invalid");
  }
  return Object.freeze({
    occurrence_id: descriptors.occurrence_id.value,
    row_id: descriptors.row_id.value,
    token: snapshotData(descriptors.token.value),
    token_bytes: Buffer.from(descriptors.token_bytes.value),
    typed_row_bytes: Buffer.from(descriptors.typed_row_bytes.value),
  });
}

function safeFilename(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/.test(value) &&
    path.basename(value) === value && !value.includes("..") && !value.includes("\0");
}

function b64Hex(value, code) {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(code);
  return Buffer.from(value, "hex").toString("base64url");
}

function sameBytes(left, right) {
  return canonicalizeJcs(left).equals(canonicalizeJcs(right));
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

function orderedTables(contract, tables) {
  if (!contract || typeof contract !== "object" || !Array.isArray(contract.source_tables) ||
      contract.source_tables.length !== 76 || contract.counts?.source_tables !== 76 ||
      contract.counts?.source_table_fields !== 759 || !Array.isArray(tables) ||
      tables.length !== 76) {
    throw new TypeError("s0_v2_writer_contract_invalid");
  }
  if (createHash("sha256").update(canonicalizeJcs(contract)).digest("hex") !== JCS_SHA) {
    throw new TypeError("s0_v2_writer_contract_invalid");
  }
  const byName = new Map();
  for (const table of tables) {
    if (!table || typeof table.table !== "string" || byName.has(table.table)) {
      throw new TypeError("s0_v2_writer_tables_invalid");
    }
    byName.set(table.table, table);
  }
  const ordered = contract.source_tables.map((table) => {
    const built = byName.get(table.name);
    if (!built || built.identity_mode !== table.identity.mode ||
        !Number.isSafeInteger(built.row_count) || built.row_count < 0 ||
        !(Array.isArray(built.records) || typeof built.records === "function") ||
        Array.isArray(built.records) && built.records.length !== built.row_count ||
        !built.streams?.data || !built.streams?.occurrences) {
      throw new TypeError("s0_v2_writer_tables_invalid");
    }
    return { built, source: table };
  });
  if (ordered.some(({ source }) => !byName.has(source.name)) || byName.size !== ordered.length) {
    throw new TypeError("s0_v2_writer_tables_invalid");
  }
  return ordered;
}

function validateAndRebuildContent(content, contract, expectedInput, tables, keyring) {
  if (!content || typeof content !== "object" || typeof content.content_root !== "string" ||
      typeof content.content_root_hex !== "string" || !content.document ||
      content.content_root !== b64Hex(content.content_root_hex, "s0_v2_writer_content_invalid")) {
    throw new TypeError("s0_v2_writer_content_invalid");
  }
  const roots = computeS0V2GlobalRoots({
    baseContractFileSha256: FILE_SHA,
    baseContractJcsSha256: JCS_SHA,
    hmacKey: keyring.hmacKey,
    tables,
  });
  const rowCount = tables.reduce((total, table) => {
    if (!Number.isSafeInteger(total + table.row_count)) {
      throw new TypeError("s0_v2_writer_content_invalid");
    }
    return total + table.row_count;
  }, 0);
  const expectedCounts = {
    columns: contract.counts.source_table_fields,
    rows: rowCount,
    tables: contract.counts.source_tables,
    views_queried: 0,
  };
  const expected = buildS0V2ContentDocument({
    addendumSha256: S0_V2_ADDENDUM_SHA256,
    baseContractFileSha256: FILE_SHA,
    baseContractJcsSha256: JCS_SHA,
    counts: expectedCounts,
    hmacKey: keyring.hmacKey,
    hmacKeyId: keyring.hmacKeyId,
    input: expectedInput,
    roots,
    tables,
  });
  if (content.document.addendum_sha256 !== S0_V2_ADDENDUM_SHA256 ||
      !sameBytes(expected.document, content.document) ||
      expected.content_root !== content.content_root ||
      expected.content_root_hex !== content.content_root_hex) {
    throw new TypeError("s0_v2_writer_content_invalid");
  }
  return { counts: expectedCounts, expected, roots };
}

function artifactType(contentRoot) {
  const binding = {
    content_root: contentRoot,
    schema: S0_V2_SCHEMA,
    status: S0_V2_STATUS,
  };
  return createHash("sha256").update(canonicalizeJcs(binding)).digest("hex");
}

async function recoverExistingPublication({
  content,
  contract,
  counts,
  directory,
  directoryIdentity,
  expectedInput,
  finalPath,
  filename,
  keyring,
}) {
  const namespaceEntries = await candidateNamespaceEntries(directory);
  let existing;
  try {
    existing = await hashExistingArtifact(finalPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (namespaceEntries.length > 0) throw new Error("PUBLISH_PRELINK_RESIDUE_BLOCKED");
      return null;
    }
    throw new Error("DESTINATION_CONFLICT");
  }
  const residues = await matchingPublishResidues(
    directory,
    filename,
    existing.artifactSha256,
  );
  if (residues.length !== namespaceEntries.length ||
      existing.nlink > 1n && residues.length === 0) {
    throw new Error("PUBLISH_OUTCOME_UNKNOWN");
  }
  try {
    for (const residue of residues) await rm(residue, { force: true, recursive: true });
    if ((await candidateNamespaceEntries(directory)).length !== 0) {
      throw new Error("PUBLISH_OUTCOME_UNKNOWN");
    }
    const final = await lstat(finalPath, { bigint: true });
    if (!final.isFile() || final.isSymbolicLink() || final.nlink !== 1n ||
        (final.mode & 0o777n) !== 0o600n || final.dev !== existing.identity.dev ||
        final.ino !== existing.identity.ino || final.size !== existing.identity.size ||
        (typeof process.getuid === "function" && final.uid !== BigInt(process.getuid()))) {
      throw new Error("PUBLISH_OUTCOME_UNKNOWN");
    }
    const currentDirectory = await assertSafeArtifactDirectory(directory);
    if (currentDirectory.dev !== directoryIdentity.dev || currentDirectory.ino !== directoryIdentity.ino) {
      throw new Error("PUBLISH_OUTCOME_UNKNOWN");
    }
    await syncArtifactDirectory(directory);
  } catch {
    throw new Error("PUBLISH_OUTCOME_UNKNOWN");
  }
  let verified;
  try {
    verified = await verifyS0V2Candidate({
      contract,
      expectedAddendumSha256: S0_V2_ADDENDUM_SHA256,
      expectedArtifactSha256: existing.artifactSha256,
      expectedInput,
      keyring,
      path: finalPath,
      workDirectory: directory,
    });
  } catch {
    throw new Error("DESTINATION_CONFLICT");
  }
  if (verified.content_root !== content.content_root ||
      !sameBytes(verified.counts, counts)) {
    throw new Error("DESTINATION_CONFLICT");
  }
  const receipt = publicReceipt(
    counts,
    existing.artifactSha256,
    verified.artifact_type_sha256,
  );
  return publicationResult(residues.length > 0 ? "RECOVERED_PUBLISHED" : "NOOP", receipt);
}

function parseInner(bytes, code) {
  try {
    return parseCanonicalJcs(bytes, { maxBytes: 128 * 1024 * 1024 });
  } catch {
    throw new TypeError(code);
  }
}

function plaintextFrames({ artifactTypeSha256, content, ordered, roots, counts }) {
  return (async function* frames() {
    yield frameS0V2Value(canonicalizeJcs({
      artifact_type_sha256: artifactTypeSha256,
      content_document: content.document,
      content_root: content.content_root,
      frame: "HEADER",
      schema: S0_V2_SCHEMA,
    }));
    for (const { built, source } of ordered) {
      yield frameS0V2Value(canonicalizeJcs({
        frame: "TABLE_START",
        identity_columns: [...source.identity.columns],
        identity_mode: source.identity.mode,
        schema: S0_V2_SCHEMA,
        table: source.name,
      }));
      let previous = null;
      let rowCount = 0;
      const records = typeof built.records === "function" ? built.records() : built.records;
      if (!records || utilTypes.isProxy(records) || typeof records[Symbol.asyncIterator] !== "function" &&
          typeof records[Symbol.iterator] !== "function") {
        throw new TypeError("s0_v2_writer_records_invalid");
      }
      for await (const inputRecord of records) {
        const record = snapshotRecord(inputRecord);
        if (!record || typeof record.occurrence_id !== "string" ||
            previous !== null && record.occurrence_id <= previous) {
          throw new TypeError("s0_v2_writer_record_order_invalid");
        }
        previous = record.occurrence_id;
        rowCount += 1;
        if (!Number.isSafeInteger(rowCount) || rowCount > built.row_count) {
          throw new TypeError("s0_v2_writer_record_count_invalid");
        }
        const occurrenceToken = parseInner(record.token_bytes, "s0_v2_writer_token_invalid");
        const typedRow = parseInner(record.typed_row_bytes, "s0_v2_writer_typed_row_invalid");
        if (!sameBytes(occurrenceToken, record.token) ||
            occurrenceToken.occurrence_id !== record.occurrence_id ||
            occurrenceToken.table !== source.name || typedRow.table !== source.name) {
          throw new TypeError("s0_v2_writer_record_invalid");
        }
        yield frameS0V2Value(canonicalizeJcs({
          frame: "ROW",
          occurrence_token: occurrenceToken,
          schema: S0_V2_SCHEMA,
          typed_row: typedRow,
        }));
      }
      if (rowCount !== built.row_count) throw new TypeError("s0_v2_writer_record_count_invalid");
      yield frameS0V2Value(canonicalizeJcs({
        frame: "TABLE_END",
        row_count: built.row_count,
        schema: S0_V2_SCHEMA,
        streams: {
          data: {
            bytes: built.streams.data.bytes,
            root: b64Hex(built.streams.data.root_hex, "s0_v2_writer_stream_invalid"),
            sha256: built.streams.data.sha256,
          },
          occurrences: {
            bytes: built.streams.occurrences.bytes,
            root: b64Hex(built.streams.occurrences.root_hex, "s0_v2_writer_stream_invalid"),
            sha256: built.streams.occurrences.sha256,
          },
        },
        table: source.name,
        table_root: b64Hex(built.table_root_hex, "s0_v2_writer_table_root_invalid"),
      }));
    }
    yield frameS0V2Value(canonicalizeJcs({
      artifact_type_sha256: artifactTypeSha256,
      content_root: content.content_root,
      counts,
      data_root: roots.data_root,
      frame: "TRAILER",
      occurrence_set_root: roots.occurrence_set_root,
      schema: S0_V2_SCHEMA,
      status: S0_V2_STATUS,
    }));
  }());
}

export async function* boundedS0V2Plaintext(chunks, maxBytes) {
  if (!chunks || typeof chunks[Symbol.asyncIterator] !== "function" ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("s0_v2_plaintext_budget_invalid");
  }
  let bytes = 0;
  for await (const input of chunks) {
    if (!(Buffer.isBuffer(input) || input instanceof Uint8Array)) {
      throw new TypeError("s0_v2_plaintext_budget_invalid");
    }
    const chunk = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    if (chunk.length > maxBytes - bytes) throw new Error("s0_v2_artifact_too_large");
    bytes += chunk.length;
    yield chunk;
  }
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

function requiredOutputBytes(tables) {
  const maxTableRows = tables.reduce((maximum, table) =>
    Math.max(maximum, table.row_count), 0);
  // A spill record is u32 length + 12-byte IV + <=1024 ciphertext + 16-byte tag.
  // Three simultaneous copies cover the retained observed run plus old/new expected merge runs.
  const referenceSpillBytes = BigInt(maxTableRows) * BigInt(REFERENCE_SPILL_RECORD_BYTES) *
    BigInt(REFERENCE_SPILL_CONCURRENT_COPIES);
  return BigInt(MAX_ARTIFACT_BYTES) + BigInt(OUTPUT_RESERVE_BYTES) + referenceSpillBytes;
}

function publicReceipt(counts, artifactSha256, artifactTypeSha256) {
  return Object.freeze({
    counts: Object.freeze({ ...counts }),
    hashes: Object.freeze({
      artifact_sha256: artifactSha256,
      artifact_type_sha256: artifactTypeSha256,
    }),
    schema: S0_V2_SCHEMA,
    status: S0_V2_STATUS,
  });
}

function publicationResult(publicationOutcome, receipt) {
  return Object.freeze({ publication_outcome: publicationOutcome, receipt });
}

async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes.subarray(offset));
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      throw new Error("s0_v2_publish_journal_write_failed");
    }
    offset += bytesWritten;
  }
}

async function writePublishJournal(directory, filename, artifactSha256) {
  const journalPath = path.join(directory, "publish-pending.jcs");
  const bytes = canonicalizeJcs({
    artifact_sha256: artifactSha256,
    filename,
    frame: "PUBLISH_PENDING",
    schema: "hotcrush.r6.s0-publish-journal.v1",
  });
  const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY |
    (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(journalPath, flags, 0o600);
  try {
    await writeAll(handle, bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncArtifactDirectory(directory);
}

async function hashExistingArtifact(artifactPath) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(artifactPath, flags);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink < 1n || before.nlink > 2n ||
        (before.mode & 0o777n) !== 0o600n || before.size <= 0n ||
        before.size > BigInt(MAX_ARTIFACT_BYTES) ||
        (typeof process.getuid === "function" && before.uid !== BigInt(process.getuid()))) {
      throw new Error("s0_v2_existing_artifact_unsafe");
    }
    const digest = createHash("sha256");
    let position = 0n;
    while (position < before.size) {
      const length = Number(before.size - position > 64n * 1024n
        ? 64n * 1024n
        : before.size - position);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, Number(position));
      if (bytesRead !== length) throw new Error("s0_v2_existing_artifact_drift");
      digest.update(buffer);
      position += BigInt(bytesRead);
    }
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        before.mode !== after.mode || before.nlink !== after.nlink || before.uid !== after.uid) {
      throw new Error("s0_v2_existing_artifact_drift");
    }
    return Object.freeze({
      artifactSha256: digest.digest("hex"),
      identity: Object.freeze({ dev: before.dev, ino: before.ino, size: before.size }),
      nlink: before.nlink,
    });
  } finally {
    await handle.close();
  }
}

async function readPublishJournal(journalPath) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(journalPath, flags);
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n ||
        (info.mode & 0o777n) !== 0o600n || info.size <= 0n || info.size > 4096n ||
        (typeof process.getuid === "function" && info.uid !== BigInt(process.getuid()))) {
      throw new Error("s0_v2_publish_journal_invalid");
    }
    const bytes = Buffer.alloc(Number(info.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error("s0_v2_publish_journal_invalid");
      offset += bytesRead;
    }
    const journal = parseCanonicalJcs(bytes, { maxBytes: 4096 });
    const keys = Object.keys(journal).sort();
    if (keys.join(",") !== "artifact_sha256,filename,frame,schema" ||
        journal.frame !== "PUBLISH_PENDING" ||
        journal.schema !== "hotcrush.r6.s0-publish-journal.v1" ||
        !DIGEST.test(journal.artifact_sha256) || !safeFilename(journal.filename)) {
      throw new Error("s0_v2_publish_journal_invalid");
    }
    return journal;
  } finally {
    await handle.close();
  }
}

async function matchingPublishResidues(directory, filename, artifactSha256) {
  const residues = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.name.startsWith(".s0-v2-candidate-") || !entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    const candidateDirectory = path.join(directory, entry.name);
    const info = await lstat(candidateDirectory);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
        (typeof process.getuid === "function" && info.uid !== process.getuid())) {
      continue;
    }
    try {
      const journal = await readPublishJournal(path.join(candidateDirectory, "publish-pending.jcs"));
      if (journal.filename === filename && journal.artifact_sha256 === artifactSha256) {
        residues.push(candidateDirectory);
      }
    } catch {
      // An unrelated or incomplete private candidate is never treated as recovery authority.
    }
  }
  return residues;
}

async function candidateNamespaceEntries(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.name.startsWith(".s0-v2-candidate-"));
}

export async function writeVerifiedS0V2Candidate(input) {
  const options = exactInput(input);
  const content = snapshotData(options.content);
  const contract = snapshotData(options.contract);
  const directory = options.directory;
  const filename = options.filename;
  const keyringInput = options.keyring;
  const inputAuthority = snapshotData(
    resolveAuthenticatedRawCaptureInputAuthority(options.inputAuthority),
  );
  const expectedInput = inputAuthority.input;
  const releaseSources = options.releaseSources;
  const statfsImpl = options.statfsImpl ?? statfs;
  const testHooks = exactTestHooks(options.testHooks);
  const tables = snapshotTables(options.tables);
  if (!safeFilename(filename) || releaseSources !== undefined &&
      (typeof releaseSources !== "function" || utilTypes.isProxy(releaseSources)) ||
      typeof statfsImpl !== "function") {
    throw new TypeError("s0_v2_writer_input_invalid");
  }
  const directoryIdentity = await assertSafeArtifactDirectory(directory);
  const ordered = orderedTables(contract, tables);
  const keyring = validateKeyring(keyringInput);
  let temporaryDirectory;
  let published = false;
  let operationError;
  const finalPath = path.join(directory, filename);
  try {
    const rebuilt = validateAndRebuildContent(content, contract, expectedInput, tables, keyring);
    if (!sameBytes(rebuilt.counts, inputAuthority.counts)) {
      throw new TypeError("s0_v2_writer_content_invalid");
    }
    const conversionAuthority = resolveS0V2ConvertedTablesAuthority(options.conversionAuthority);
    if (conversionAuthority.content !== options.content ||
        conversionAuthority.contract !== options.contract ||
        conversionAuthority.directory !== directory || conversionAuthority.filename !== filename ||
        conversionAuthority.inputAuthority !== options.inputAuthority ||
        conversionAuthority.tables !== options.tables ||
        conversionAuthority.converted_rows_commitment_sha256 !== convertedRowsCommitment(tables)) {
      throw new Error("s0_v2_writer_conversion_authority_invalid");
    }
    const artifactTypeSha256 = artifactType(content.content_root);
    const recovered = await recoverExistingPublication({
      content,
      contract,
      counts: rebuilt.counts,
      directory,
      directoryIdentity,
      expectedInput,
      finalPath,
      filename,
      keyring,
    });
    if (recovered) {
      await releaseSources?.();
      return recovered;
    }
    const freeBytes = outputAvailableBytes(await statfsImpl(directory));
    if (freeBytes < requiredOutputBytes(tables)) {
      throw new Error("s0_v2_insufficient_output_space");
    }
    temporaryDirectory = await mkdtemp(path.join(directory, ".s0-v2-candidate-"));
    await chmod(temporaryDirectory, 0o700);
    const candidateName = "candidate.enc";
    const candidate = await writeStreamingEncryptedArtifact({
      artifactTypeHash: artifactTypeSha256,
      directory: temporaryDirectory,
      filename: candidateName,
      keyring,
      plaintextChunks: boundedS0V2Plaintext(
        plaintextFrames({
          artifactTypeSha256,
          content,
          counts: rebuilt.counts,
          ordered,
          roots: rebuilt.roots,
        }),
        MAX_ARTIFACT_BYTES - MAX_ENVELOPE_OVERHEAD_BYTES,
      ),
    });
    if (candidate.bytes > MAX_ARTIFACT_BYTES) throw new Error("s0_v2_artifact_too_large");
    await releaseSources?.();
    const verified = await verifyS0V2Candidate({
      contract,
      expectedAddendumSha256: S0_V2_ADDENDUM_SHA256,
      expectedArtifactSha256: candidate.artifact_sha256,
      expectedInput,
      keyring,
      path: candidate.path,
      workDirectory: temporaryDirectory,
    });
    if (!verified || verified.artifact_type_sha256 !== artifactTypeSha256 ||
        verified.content_root !== content.content_root ||
        !sameBytes(verified.counts, rebuilt.counts)) {
      throw new Error("s0_v2_reference_result_mismatch");
    }
    const currentDirectory = await assertSafeArtifactDirectory(directory);
    if (currentDirectory.dev !== directoryIdentity.dev || currentDirectory.ino !== directoryIdentity.ino) {
      throw new Error("unsafe_artifact_directory");
    }
    const candidateInfo = await lstat(candidate.path);
    if (!candidateInfo.isFile() || candidateInfo.isSymbolicLink() || candidateInfo.nlink !== 1 ||
        (candidateInfo.mode & 0o777) !== 0o600 || candidateInfo.size !== candidate.bytes ||
        (typeof process.getuid === "function" && candidateInfo.uid !== process.getuid())) {
      throw new Error("s0_v2_candidate_invalid");
    }
    const receipt = publicReceipt(rebuilt.counts, candidate.artifact_sha256, artifactTypeSha256);
    await writePublishJournal(temporaryDirectory, filename, candidate.artifact_sha256);
    await testHooks.beforeLink?.();
    await link(candidate.path, finalPath);
    published = true;
    await testHooks.afterLink?.();
    await testHooks.beforeCandidateUnlink?.();
    await unlink(candidate.path);
    await testHooks.afterCandidateUnlink?.();
    const final = await lstat(finalPath, { bigint: true });
    if (!final.isFile() || final.isSymbolicLink() || final.nlink !== 1n ||
        (final.mode & 0o777n) !== 0o600n || final.dev !== BigInt(candidateInfo.dev) ||
        final.ino !== BigInt(candidateInfo.ino) || final.size !== BigInt(candidate.bytes) ||
        (typeof process.getuid === "function" && final.uid !== BigInt(process.getuid()))) {
      throw new Error("s0_v2_published_artifact_invalid");
    }
    await testHooks.beforeDirectorySync?.();
    await syncArtifactDirectory(directory);
    await testHooks.beforeTemporaryRemove?.();
    await rm(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = undefined;
    await testHooks.beforeFinalDirectorySync?.();
    await syncArtifactDirectory(directory);
    return publicationResult("PUBLISHED", receipt);
  } catch (error) {
    operationError = published ? new Error("PUBLISH_OUTCOME_UNKNOWN") : error;
    throw operationError;
  } finally {
    keyring.kek.fill(0);
    keyring.hmacKey.fill(0);
    if (temporaryDirectory && !published) {
      try {
        await testHooks.beforeUnpublishedCleanup?.();
        await rm(temporaryDirectory, { force: true, recursive: true });
      } catch (cleanupError) {
        if (!published && operationError && !Object.hasOwn(operationError, "cleanupFailure")) {
          Object.defineProperty(operationError, "cleanupFailure", {
            configurable: false,
            enumerable: false,
            value: cleanupError,
            writable: false,
          });
        } else if (!published && !operationError) {
          throw cleanupError;
        }
      }
    }
  }
}
