import type { Candidate } from "./types";
import { logger } from "../../shared/logger";

/**
 * 跨站候选人去重
 * 基于 name + location 的模糊匹配
 */
export function deduplicateCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Map<string, Candidate>();

  for (const c of candidates) {
    const key = normalizeKey(c);
    if (!seen.has(key)) {
      seen.set(key, c);
    }
  }

  const deduped = Array.from(seen.values());
  const removed = candidates.length - deduped.length;
  if (removed > 0) {
    logger.info(`Deduplication: removed ${removed} duplicates from ${candidates.length}`);
  }
  return deduped;
}

function normalizeKey(c: Candidate): string {
  const name = c.name.toLowerCase().replace(/\s+/g, " ").trim();
  const loc = (c.location || "").toLowerCase().trim();
  return `${name}|${loc}`;
}
