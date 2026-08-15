import { validateKeyring } from "../../lib/keys.mjs";

import {
  analyzeCatalogSupplementRawResponse,
  analyzeReport211RawResponse,
} from "./analysis.mjs";
import {
  assertSafeReplayOutputDirectory,
  publishReplayArtifact,
} from "./artifact.mjs";
import {
  DEFAULT_REPLAY_AUTHORITY,
  IMPLEMENTATION_STATUS,
  PHYSICAL_BACKFILL_STATUS,
  assertReplayAuthority,
  buildCatalogSupplementRequest,
  buildReport211Request,
  normalizeListingItemKeys,
} from "./contract.mjs";

function assertTransport(transport, mode) {
  const expectedKind = mode === "SYNTHETIC_FIXTURE"
    ? "SYNTHETIC_REPORT211_TRANSPORT_V1"
    : "REPORT211_READ_ONLY_TRANSPORT_V1";
  if (
    !transport || transport.kind !== expectedKind ||
    typeof transport.fetchSinglePage !== "function"
  ) {
    throw new Error("invalid_replay_transport");
  }
}

function assertTransportResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("invalid_replay_transport_result");
  }
  const keys = Object.keys(result).sort();
  const expected = ["httpStatus", "rawBody", "watermark"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("invalid_replay_transport_result");
  }
  if (result.httpStatus !== 200 || !Buffer.isBuffer(result.rawBody)) {
    throw new Error("report211_transport_failed");
  }
}

function snapshotTransportResult(result) {
  assertTransportResult(result);
  return {
    rawBody: Buffer.from(result.rawBody),
    watermark: { ...result.watermark },
  };
}

export async function runMemberOrderItemReplay(options = {}) {
  const mode = options.mode;
  const authority = options.authority ?? DEFAULT_REPLAY_AUTHORITY;
  assertReplayAuthority(authority, mode);
  assertTransport(options.transport, mode);
  const approvedListingItemKeys = normalizeListingItemKeys(options.approvedListingItemKeys);
  const query = buildReport211Request({ businessDate: options.businessDate });
  await assertSafeReplayOutputDirectory(options.outputDirectory);
  const keyring = validateKeyring(options.keyring);
  try {
    const result = snapshotTransportResult(await options.transport.fetchSinglePage({
      endpoint: query.endpoint,
      purpose: "ORDER_LINES",
      requestBody: query.body,
    }));
    const analysis = analyzeReport211RawResponse({
      businessDate: query.source_parameters.business_date,
      rawBody: result.rawBody,
    });
    const approved = new Set(approvedListingItemKeys);
    const missingItemKeys = analysis.listing_item_keys.filter((key) => !approved.has(key));
    let catalogSupplement = null;
    if (missingItemKeys.length > 0) {
      const catalogQuery = buildCatalogSupplementRequest({
        businessDate: query.source_parameters.business_date,
      });
      const catalogResult = snapshotTransportResult(await options.transport.fetchSinglePage({
        endpoint: catalogQuery.endpoint,
        purpose: "CATALOG_SUPPLEMENT",
        requestBody: catalogQuery.body,
      }));
      catalogSupplement = {
        analysis: analyzeCatalogSupplementRawResponse({
          businessDate: query.source_parameters.business_date,
          missingItemKeys,
          rawBody: catalogResult.rawBody,
        }),
        query: catalogQuery,
        rawBody: catalogResult.rawBody,
        watermark: catalogResult.watermark,
      };
    }
    const targetBlockers = [...new Set([
      ...analysis.target_blockers,
      ...(catalogSupplement?.analysis.target_blockers ?? []),
    ])].sort();
    const publication = await publishReplayArtifact({
      analysis,
      approvedListingItemKeys,
      authority,
      catalogSupplement,
      executionMode: mode,
      keyring,
      outputDirectory: options.outputDirectory,
      query,
      rawBody: result.rawBody,
      targetBlockers,
      watermark: result.watermark,
    });
    return {
      aggregate_group_count: analysis.page_stats.aggregate_group_count,
      artifact_path: publication.artifact_path,
      artifact_sha256: publication.artifact_sha256,
      content_id: publication.content_id,
      catalog_seed_row_count: catalogSupplement?.analysis.page_stats.selected_seed_row_count ?? 0,
      catalog_supplement_response_row_count:
        catalogSupplement?.analysis.page_stats.response_row_count ?? 0,
      exact_duplicate_response_rows: analysis.page_stats.exact_duplicate_response_rows,
      implementation_status: IMPLEMENTATION_STATUS,
      negative_quantity_groups: analysis.page_stats.negative_quantity_groups,
      physical_backfill_status: PHYSICAL_BACKFILL_STATUS,
      publication_status: publication.publication_status,
      reported_total: analysis.page_stats.reported_total,
      response_row_count: analysis.page_stats.response_row_count,
      source_row_count: analysis.page_stats.source_row_count,
      target_blockers: targetBlockers,
      unresolved_listing_item_key_count:
        catalogSupplement?.analysis.unresolved_item_keys.length ?? 0,
      zero_quantity_groups: analysis.page_stats.zero_quantity_groups,
    };
  } finally {
    keyring.kek.fill(0);
    keyring.hmacKey.fill(0);
  }
}
