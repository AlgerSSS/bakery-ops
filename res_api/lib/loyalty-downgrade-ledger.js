import { randomUUID } from "node:crypto";

import { LOYALTY_LEVELS } from "./loyalty-levels.js";

export const LOYALTY_DOWNGRADE_LEDGER_TABLE =
  "public.mkt_loyalty_level_change_ledger";
export const DEFAULT_STALE_CLAIM_MS = 15 * 60 * 1000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const levelIndexById = new Map(
  LOYALTY_LEVELS.map((level, index) => [level.resLevelId, index]),
);

function string(value) {
  return String(value ?? "").trim();
}

function plainDate(value, label) {
  const text = string(value);
  if (!DATE_RE.test(text)) throw new TypeError(`${label} must use YYYY-MM-DD.`);
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError(`${label} is not a valid calendar date.`);
  }
  return text;
}

function safeError(value) {
  return string(value).replace(/[\r\n\t]+/g, " ").slice(0, 500) || null;
}

function dateText(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

function downgradeLedgerFacts(plan, context) {
  const recalculationDate = plainDate(context?.asOfDate, "asOfDate");
  const windowFrom = plainDate(context?.windowFrom, "windowFrom");
  const windowTo = plainDate(context?.windowTo, "windowTo");
  if (Number(recalculationDate.slice(-2)) !== 1) {
    throw new Error("A downgrade ledger claim is allowed only on month day 1.");
  }
  if (windowFrom > windowTo) {
    throw new Error("The downgrade ledger window is invalid.");
  }
  if (plan?.policyAction !== "downgrade_one_level") {
    throw new Error("Only an eligible one-level downgrade may claim the ledger.");
  }
  const cardId = string(plan.cardId);
  const fromLevelId = string(plan.currentLevelId);
  const targetLevelId = string(plan.targetLevelId);
  const fromIndex = levelIndexById.get(fromLevelId);
  const targetIndex = levelIndexById.get(targetLevelId);
  if (!cardId || fromIndex === undefined || targetIndex !== fromIndex - 1) {
    throw new Error("The downgrade ledger accepts exactly one known level step.");
  }
  return {
    cardId,
    recalculationDate,
    action: "downgrade",
    windowFrom,
    windowTo,
    fromLevelId,
    targetLevelId,
  };
}

export function buildDowngradeLedgerClaim(
  plan,
  context,
  { claimToken, noticeId } = {},
) {
  const facts = downgradeLedgerFacts(plan, context);
  const token = string(claimToken || randomUUID());
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    throw new Error("The downgrade claim token must be a UUID v4.");
  }
  const deliveredNoticeId = Number(noticeId);
  if (!Number.isSafeInteger(deliveredNoticeId) || deliveredNoticeId < 1) {
    throw new Error("A delivered RES SMS notice ID is required to claim a downgrade.");
  }
  return {
    ...facts,
    noticeId: deliveredNoticeId,
    claimToken: token,
  };
}

export async function requireDeliveredDowngradeNotice(sql, plan, context) {
  const facts = downgradeLedgerFacts(plan, context);
  const [notice] = await sql`
    SELECT *
    FROM public.mkt_loyalty_downgrade_notice
    WHERE card_id = ${facts.cardId}
      AND recalculation_date = ${facts.recalculationDate}::date
      AND notice_date = ${facts.recalculationDate}::date - 7
      AND action = ${facts.action}
      AND from_level_id = ${facts.fromLevelId}
      AND target_level_id = ${facts.targetLevelId}
      AND delivery_channel = 'res_sms'
      AND status = 'delivered'
      AND provider_message_id IS NOT NULL
      AND delivered_at IS NOT NULL
      AND (delivered_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date = notice_date
  `;
  if (!notice) {
    throw new Error(
      "Downgrade refused: no matching RES SMS notice was confirmed delivered exactly seven days earlier.",
    );
  }
  return notice;
}

function sameClaimFacts(entry, claim) {
  return (
    string(entry?.card_id) === claim.cardId &&
    Number(entry?.notice_id) === claim.noticeId &&
    dateText(entry?.recalculation_date) === claim.recalculationDate &&
    string(entry?.action) === claim.action &&
    dateText(entry?.window_from) === claim.windowFrom &&
    dateText(entry?.window_to) === claim.windowTo &&
    string(entry?.from_level_id) === claim.fromLevelId &&
    string(entry?.target_level_id) === claim.targetLevelId
  );
}

export function downgradeLedgerDecision(
  entry,
  observedLevelId,
  claim,
  { now = new Date(), staleClaimMs = DEFAULT_STALE_CLAIM_MS } = {},
) {
  if (!entry) return { action: "claim" };
  const observed = string(observedLevelId);
  const status = string(entry.status);
  const ledgerFrom = string(entry.from_level_id);
  const ledgerTarget = string(entry.target_level_id);

  if (observed === ledgerTarget) {
    return status === "applied"
      ? { action: "prevent", reason: "already_applied" }
      : { action: "finalize_and_prevent", reason: "target_observed" };
  }
  if (status === "applied") {
    return { action: "prevent", reason: "applied_ledger_live_level_changed" };
  }
  if (status === "ambiguous") {
    return { action: "prevent", reason: "ambiguous_fail_closed" };
  }
  if (observed !== ledgerFrom) {
    return { action: "mark_ambiguous", reason: "unexpected_live_level" };
  }
  if (!sameClaimFacts(entry, claim)) {
    return { action: "conflict", reason: "ledger_facts_do_not_match_plan" };
  }
  if (status === "failed") return { action: "reclaim", reason: "retry_failed" };
  if (status !== "claimed") {
    return { action: "conflict", reason: "unknown_ledger_status" };
  }
  const updatedAt = new Date(entry.updated_at).getTime();
  const staleBefore = now.getTime() - staleClaimMs;
  if (!Number.isFinite(updatedAt)) {
    return { action: "conflict", reason: "invalid_claim_timestamp" };
  }
  return updatedAt <= staleBefore
    ? { action: "reclaim", reason: "stale_claim" }
    : { action: "prevent", reason: "fresh_claim_in_progress" };
}

export async function assertDowngradeLedgerSchema(sql) {
  const [row] = await sql`
    SELECT
      to_regclass('public.mkt_loyalty_level_change_ledger')::text AS table_name,
      to_regclass('public.mkt_loyalty_downgrade_notice')::text AS notice_table_name,
      EXISTS (
        SELECT 1
        FROM public.schema_migrations
        WHERE version = 112 AND name = 'loyalty_level_change_ledger'
      ) AS migration_recorded,
      EXISTS (
        SELECT 1
        FROM public.schema_migrations
        WHERE version = 113 AND name = 'loyalty_downgrade_notice_gate'
      ) AS notice_migration_recorded,
      EXISTS (
        SELECT 1
        FROM pg_attribute
        WHERE attrelid = 'public.mkt_loyalty_level_change_ledger'::regclass
          AND attname = 'notice_id'
          AND attnotnull
          AND NOT attisdropped
      ) AS notice_id_required
  `;
  if (
    !["mkt_loyalty_level_change_ledger", "public.mkt_loyalty_level_change_ledger"].includes(
      row?.table_name,
    ) ||
    !["mkt_loyalty_downgrade_notice", "public.mkt_loyalty_downgrade_notice"].includes(
      row?.notice_table_name,
    ) ||
    row?.migration_recorded !== true ||
    row?.notice_migration_recorded !== true ||
    row?.notice_id_required !== true
  ) {
    throw new Error(
      "Loyalty downgrade ledger migrations 112 and 113 are not fully installed.",
    );
  }
}

export async function claimDowngradeLedger(sql, claim) {
  const [inserted] = await sql`
    INSERT INTO public.mkt_loyalty_level_change_ledger (
      notice_id,
      card_id,
      recalculation_date,
      action,
      window_from,
      window_to,
      from_level_id,
      target_level_id,
      status,
      claim_token
    ) VALUES (
      ${claim.noticeId},
      ${claim.cardId},
      ${claim.recalculationDate}::date,
      ${claim.action},
      ${claim.windowFrom}::date,
      ${claim.windowTo}::date,
      ${claim.fromLevelId},
      ${claim.targetLevelId},
      'claimed',
      ${claim.claimToken}::uuid
    )
    ON CONFLICT (card_id, recalculation_date, action) DO NOTHING
    RETURNING *
  `;
  if (inserted) return { acquired: true, entry: inserted };
  const [existing] = await sql`
    SELECT *
    FROM public.mkt_loyalty_level_change_ledger
    WHERE card_id = ${claim.cardId}
      AND recalculation_date = ${claim.recalculationDate}::date
      AND action = ${claim.action}
  `;
  if (!existing) {
    throw new Error("The downgrade ledger conflict row could not be read back.");
  }
  return { acquired: false, entry: existing };
}

export async function reclaimDowngradeLedger(
  sql,
  entry,
  claim,
  { staleClaimMs = DEFAULT_STALE_CLAIM_MS, now = new Date() } = {},
) {
  const staleBefore = new Date(now.getTime() - staleClaimMs);
  const [reclaimed] = await sql`
    UPDATE public.mkt_loyalty_level_change_ledger
    SET
      status = 'claimed',
      claim_token = ${claim.claimToken}::uuid,
      attempt_count = attempt_count + 1,
      last_error = NULL,
      updated_at = now(),
      applied_at = NULL
    WHERE ledger_id = ${entry.ledger_id}
      AND (
        status = 'failed'
        OR (status = 'claimed' AND updated_at <= ${staleBefore})
      )
      AND notice_id = ${claim.noticeId}
      AND card_id = ${claim.cardId}
      AND recalculation_date = ${claim.recalculationDate}::date
      AND action = ${claim.action}
      AND window_from = ${claim.windowFrom}::date
      AND window_to = ${claim.windowTo}::date
      AND from_level_id = ${claim.fromLevelId}
      AND target_level_id = ${claim.targetLevelId}
    RETURNING *
  `;
  return reclaimed || null;
}

export async function markDowngradeLedgerApplied(sql, entry, claimToken) {
  const [applied] = await sql`
    UPDATE public.mkt_loyalty_level_change_ledger
    SET status = 'applied', applied_at = now(), updated_at = now(), last_error = NULL
    WHERE ledger_id = ${entry.ledger_id}
      AND status = 'claimed'
      AND claim_token = ${claimToken}::uuid
    RETURNING *
  `;
  if (!applied) {
    throw new Error("The downgrade ledger claim could not be marked applied.");
  }
  return applied;
}

export async function reconcileObservedDowngradeApplied(sql, entry) {
  if (entry.status === "applied") return entry;
  const [applied] = await sql`
    UPDATE public.mkt_loyalty_level_change_ledger
    SET status = 'applied', applied_at = now(), updated_at = now(), last_error = NULL
    WHERE ledger_id = ${entry.ledger_id}
      AND status IN ('claimed', 'failed', 'ambiguous', 'applied')
    RETURNING *
  `;
  if (!applied) {
    throw new Error("Observed downgrade could not be reconciled into the ledger.");
  }
  return applied;
}

export async function markDowngradeLedgerFailed(
  sql,
  entry,
  claimToken,
  reason,
) {
  const [failed] = await sql`
    UPDATE public.mkt_loyalty_level_change_ledger
    SET status = 'failed', updated_at = now(), applied_at = NULL,
        last_error = ${safeError(reason)}
    WHERE ledger_id = ${entry.ledger_id}
      AND status = 'claimed'
      AND claim_token = ${claimToken}::uuid
    RETURNING *
  `;
  if (!failed) {
    throw new Error("The downgrade ledger claim could not be marked failed.");
  }
  return failed;
}

export async function markDowngradeLedgerAmbiguous(
  sql,
  entry,
  reason,
  { claimToken = null } = {},
) {
  const token = claimToken ? string(claimToken) : null;
  const [ambiguous] = token
    ? await sql`
        UPDATE public.mkt_loyalty_level_change_ledger
        SET status = 'ambiguous', updated_at = now(), applied_at = NULL,
            last_error = ${safeError(reason)}
        WHERE ledger_id = ${entry.ledger_id}
          AND status = 'claimed'
          AND claim_token = ${token}::uuid
        RETURNING *
      `
    : await sql`
        UPDATE public.mkt_loyalty_level_change_ledger
        SET status = 'ambiguous', updated_at = now(), applied_at = NULL,
            last_error = ${safeError(reason)}
        WHERE ledger_id = ${entry.ledger_id}
          AND status IN ('claimed', 'failed')
        RETURNING *
      `;
  if (!ambiguous) {
    throw new Error("The downgrade ledger could not be marked ambiguous.");
  }
  return ambiguous;
}
