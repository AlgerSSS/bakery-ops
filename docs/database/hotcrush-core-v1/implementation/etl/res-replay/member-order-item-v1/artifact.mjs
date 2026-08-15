import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  readEncryptedArtifact,
  writeEncryptedArtifact,
} from "../../lib/envelope.mjs";
import {
  canonicalizeJcs,
  parseCanonicalJcs,
  sha256Hex,
} from "../../lib/canonical.mjs";

import {
  analyzeCatalogSupplementRawResponse,
  analyzeReport211RawResponse,
} from "./analysis.mjs";
import {
  DEFAULT_REPLAY_AUTHORITY,
  IMPLEMENTATION_STATUS,
  PHYSICAL_BACKFILL_STATUS,
  REPORT211_CONTRACT,
  assertReplayAuthority,
  buildCatalogSupplementRequest,
  buildReport211Request,
  normalizeListingItemKeys,
} from "./contract.mjs";

export const ARTIFACT_TYPE = "RES_REPORT211_MEMBER_ORDER_ITEM_RAW_REPLAY_V1";
const ARTIFACT_SCHEMA = "hotcrush.res.report211.member-order-item.encrypted-raw-replay.v1";
const DOCUMENT_KEYS = [
  "analysis",
  "approved_listing_item_keys",
  "artifact_type",
  "authority_probe_digest_sha256",
  "catalog_supplement",
  "execution_mode",
  "implementation_status",
  "line_identity",
  "physical_backfill_status",
  "raw_response_b64",
  "raw_response_sha256",
  "request_body_b64",
  "request_body_sha256",
  "schema",
  "source_parameters",
  "target_blockers",
  "watermark",
].sort();
const CATALOG_CAPTURE_KEYS = [
  "analysis",
  "raw_response_b64",
  "raw_response_sha256",
  "request_body_b64",
  "request_body_sha256",
  "source_parameters",
  "watermark",
].sort();
const LINE_IDENTITY_KEYS = [
  "assertion_fields",
  "fields",
  "source_row_count_semantics",
  "status",
].sort();
const TARGET_BLOCKER_CODES = new Set([
  "CATALOG_SUPPLEMENT_UNRESOLVED_LISTING_KEYS",
  "ZERO_QUANTITY_REQUIRES_QUARANTINE",
]);

function exactKeys(value, keys, error) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error(error);
  }
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function unb64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid_replay_base64");
  }
  const bytes = Buffer.from(value, "base64url");
  if (b64(bytes) !== value) throw new Error("invalid_replay_base64");
  return bytes;
}

function validateWatermark(watermark) {
  exactKeys(
    watermark,
    ["observed_at", "source_http_date", "source_request_id"],
    "invalid_replay_watermark",
  );
  if (
    typeof watermark.observed_at !== "string" ||
    Number.isNaN(Date.parse(watermark.observed_at)) ||
    new Date(watermark.observed_at).toISOString() !== watermark.observed_at
  ) {
    throw new Error("invalid_replay_watermark");
  }
  for (const key of ["source_http_date", "source_request_id"]) {
    const value = watermark[key];
    if (!(value === null || (
      typeof value === "string" && value.length > 0 && value.length <= 256 &&
      !/[\r\n]/.test(value)
    ))) {
      throw new Error("invalid_replay_watermark");
    }
  }
  return { ...watermark };
}

function normalizeTargetBlockers(value) {
  if (!Array.isArray(value)) throw new Error("invalid_replay_target_blockers");
  const normalized = [...new Set(value)].sort();
  if (
    normalized.length !== value.length ||
    normalized.some((blocker) => typeof blocker !== "string" || !TARGET_BLOCKER_CODES.has(blocker))
  ) {
    throw new Error("invalid_replay_target_blockers");
  }
  return normalized;
}

function capturedSource({ analysis, query, rawBody, watermark }) {
  const requestBytes = canonicalizeJcs(query.body);
  const rawBytes = Buffer.from(rawBody);
  return {
    analysis,
    raw_response_b64: b64(rawBytes),
    raw_response_sha256: sha256Hex(rawBytes),
    request_body_b64: b64(requestBytes),
    request_body_sha256: sha256Hex(requestBytes),
    source_parameters: { ...query.source_parameters },
    watermark: validateWatermark(watermark),
  };
}

function buildDocument({
  analysis,
  approvedListingItemKeys,
  authority,
  catalogSupplement,
  executionMode,
  query,
  rawBody,
  targetBlockers,
  watermark,
}) {
  const selectedAuthority = authority ?? DEFAULT_REPLAY_AUTHORITY;
  assertReplayAuthority(selectedAuthority, executionMode);
  const orderCapture = capturedSource({ analysis, query, rawBody, watermark });
  return {
    analysis: orderCapture.analysis,
    approved_listing_item_keys: normalizeListingItemKeys(approvedListingItemKeys),
    artifact_type: ARTIFACT_TYPE,
    authority_probe_digest_sha256: selectedAuthority.probe.canonical_row_digest_sha256,
    catalog_supplement: catalogSupplement === null
      ? null
      : capturedSource(catalogSupplement),
    execution_mode: executionMode,
    implementation_status: IMPLEMENTATION_STATUS,
    line_identity: {
      assertion_fields: [...REPORT211_CONTRACT.assertion_fields],
      fields: [...REPORT211_CONTRACT.composite_line_fields],
      source_row_count_semantics: "COUNT_DISTINCT_APPROVED_COMPOSITE_LINE_KEY",
      status: selectedAuthority.stable_line_identity.status,
    },
    physical_backfill_status: PHYSICAL_BACKFILL_STATUS,
    raw_response_b64: orderCapture.raw_response_b64,
    raw_response_sha256: orderCapture.raw_response_sha256,
    request_body_b64: orderCapture.request_body_b64,
    request_body_sha256: orderCapture.request_body_sha256,
    schema: ARTIFACT_SCHEMA,
    source_parameters: orderCapture.source_parameters,
    target_blockers: normalizeTargetBlockers(targetBlockers),
    watermark: orderCapture.watermark,
  };
}

async function existingNoop({ artifactPath, contentId, keyring, plaintext }) {
  const existing = await readEncryptedArtifact({
    path: artifactPath,
    keyring,
    expectedArtifactType: ARTIFACT_TYPE,
  });
  if (sha256Hex(existing) !== contentId || !existing.equals(plaintext)) {
    throw new Error("replay_artifact_content_conflict");
  }
  const encrypted = await readFile(artifactPath);
  return {
    artifact_path: artifactPath,
    artifact_sha256: sha256Hex(encrypted),
    bytes: encrypted.length,
    content_id: contentId,
    publication_status: "NOOP",
  };
}

export async function publishReplayArtifact({
  analysis,
  approvedListingItemKeys,
  authority,
  catalogSupplement,
  executionMode,
  keyring,
  outputDirectory,
  query,
  rawBody,
  targetBlockers,
  watermark,
}) {
  const document = buildDocument({
    analysis,
    approvedListingItemKeys,
    authority,
    catalogSupplement,
    executionMode,
    query,
    rawBody,
    targetBlockers,
    watermark,
  });
  const plaintext = canonicalizeJcs(document);
  const contentId = sha256Hex(plaintext);
  const filename = `report211-member-order-item-${query.source_parameters.business_date}-${contentId}.enc`;
  const artifactPath = path.join(outputDirectory, filename);
  try {
    const receipt = await writeEncryptedArtifact({
      artifactType: ARTIFACT_TYPE,
      contentId,
      directory: outputDirectory,
      filename,
      keyring,
      plaintext,
    });
    return {
      artifact_path: receipt.path,
      artifact_sha256: receipt.sha256,
      bytes: receipt.bytes,
      content_id: contentId,
      publication_status: "PUBLISHED",
    };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return existingNoop({ artifactPath, contentId, keyring, plaintext });
  }
}

function verifyCapturedSource({ capture, expectedQuery, missingItemKeys = null }) {
  exactKeys(capture, CATALOG_CAPTURE_KEYS, "invalid_catalog_supplement_capture");
  const rawResponse = unb64(capture.raw_response_b64);
  const requestBytes = unb64(capture.request_body_b64);
  if (
    sha256Hex(rawResponse) !== capture.raw_response_sha256 ||
    sha256Hex(requestBytes) !== capture.request_body_sha256
  ) {
    throw new Error("replay_inner_integrity_failed");
  }
  if (
    !requestBytes.equals(canonicalizeJcs(expectedQuery.body)) ||
    !canonicalizeJcs(capture.source_parameters).equals(
      canonicalizeJcs(expectedQuery.source_parameters),
    )
  ) {
    throw new Error("replay_request_contract_mismatch");
  }
  const analysis = analyzeCatalogSupplementRawResponse({
    businessDate: expectedQuery.source_parameters.business_date,
    missingItemKeys,
    rawBody: rawResponse,
  });
  if (!canonicalizeJcs(analysis).equals(canonicalizeJcs(capture.analysis))) {
    throw new Error("replay_analysis_integrity_failed");
  }
  return {
    analysis,
    raw_response: rawResponse,
    source_parameters: { ...capture.source_parameters },
    watermark: validateWatermark(capture.watermark),
  };
}

export async function verifyMemberOrderItemReplayArtifact({ artifactPath, keyring }) {
  const plaintext = await readEncryptedArtifact({
    path: artifactPath,
    keyring,
    expectedArtifactType: ARTIFACT_TYPE,
  });
  const document = parseCanonicalJcs(plaintext);
  exactKeys(document, DOCUMENT_KEYS, "invalid_replay_document");
  exactKeys(document.line_identity, LINE_IDENTITY_KEYS, "invalid_replay_document");
  assertReplayAuthority(DEFAULT_REPLAY_AUTHORITY, document.execution_mode);
  if (
    document.schema !== ARTIFACT_SCHEMA ||
    document.artifact_type !== ARTIFACT_TYPE ||
    document.implementation_status !== IMPLEMENTATION_STATUS ||
    document.physical_backfill_status !== PHYSICAL_BACKFILL_STATUS ||
    document.authority_probe_digest_sha256 !==
      DEFAULT_REPLAY_AUTHORITY.probe.canonical_row_digest_sha256 ||
    !new Set(["SYNTHETIC_FIXTURE", "LIVE_READ_ONLY"]).has(document.execution_mode) ||
    document.line_identity.status !== "APPROVED_FULL_HISTORY_PROBE" ||
    document.line_identity.source_row_count_semantics !==
      "COUNT_DISTINCT_APPROVED_COMPOSITE_LINE_KEY" ||
    !canonicalizeJcs(document.line_identity.fields).equals(
      canonicalizeJcs(REPORT211_CONTRACT.composite_line_fields),
    ) ||
    !canonicalizeJcs(document.line_identity.assertion_fields).equals(
      canonicalizeJcs(REPORT211_CONTRACT.assertion_fields),
    )
  ) {
    throw new Error("invalid_replay_document");
  }
  const approvedListingItemKeys = normalizeListingItemKeys(document.approved_listing_item_keys);
  if (!canonicalizeJcs(approvedListingItemKeys).equals(
    canonicalizeJcs(document.approved_listing_item_keys),
  )) {
    throw new Error("invalid_replay_document");
  }
  const targetBlockers = normalizeTargetBlockers(document.target_blockers);
  if (!canonicalizeJcs(targetBlockers).equals(canonicalizeJcs(document.target_blockers))) {
    throw new Error("invalid_replay_document");
  }

  const watermark = validateWatermark(document.watermark);
  const rawResponse = unb64(document.raw_response_b64);
  const requestBytes = unb64(document.request_body_b64);
  if (
    sha256Hex(rawResponse) !== document.raw_response_sha256 ||
    sha256Hex(requestBytes) !== document.request_body_sha256
  ) {
    throw new Error("replay_inner_integrity_failed");
  }
  const expectedQuery = buildReport211Request({
    businessDate: document.source_parameters?.business_date,
  });
  if (
    !requestBytes.equals(canonicalizeJcs(expectedQuery.body)) ||
    !canonicalizeJcs(document.source_parameters).equals(
      canonicalizeJcs(expectedQuery.source_parameters),
    )
  ) {
    throw new Error("replay_request_contract_mismatch");
  }
  const analysis = analyzeReport211RawResponse({
    businessDate: expectedQuery.source_parameters.business_date,
    rawBody: rawResponse,
  });
  if (!canonicalizeJcs(analysis).equals(canonicalizeJcs(document.analysis))) {
    throw new Error("replay_analysis_integrity_failed");
  }

  const approved = new Set(approvedListingItemKeys);
  const missingItemKeys = analysis.listing_item_keys.filter((key) => !approved.has(key));
  let catalogSupplement = null;
  if (missingItemKeys.length === 0) {
    if (document.catalog_supplement !== null) throw new Error("unexpected_catalog_supplement");
  } else {
    if (document.catalog_supplement === null) throw new Error("missing_catalog_supplement");
    catalogSupplement = verifyCapturedSource({
      capture: document.catalog_supplement,
      expectedQuery: buildCatalogSupplementRequest({
        businessDate: expectedQuery.source_parameters.business_date,
      }),
      missingItemKeys,
    });
  }
  const expectedBlockers = normalizeTargetBlockers([
    ...analysis.target_blockers,
    ...(catalogSupplement?.analysis.target_blockers ?? []),
  ]);
  if (!canonicalizeJcs(expectedBlockers).equals(canonicalizeJcs(targetBlockers))) {
    throw new Error("replay_target_blocker_integrity_failed");
  }
  return {
    analysis,
    artifact_type: ARTIFACT_TYPE,
    catalog_supplement: catalogSupplement,
    execution_mode: document.execution_mode,
    raw_response: rawResponse,
    source_parameters: { ...document.source_parameters },
    target_blockers: targetBlockers,
    watermark,
  };
}

export async function assertSafeReplayOutputDirectory(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    throw new Error("unsafe_replay_output_directory");
  }
  const info = await lstat(directory);
  if (
    !info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  ) {
    throw new Error("unsafe_replay_output_directory");
  }
}
