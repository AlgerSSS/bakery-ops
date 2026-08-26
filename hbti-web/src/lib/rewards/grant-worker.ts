import { randomUUID } from "node:crypto";

import { getDb, type SqlRunner } from "@/lib/db/postgres";
import type { ResApiClient } from "@/lib/res/client";

interface ClaimedGrant {
  grantId: number;
  claimToken: string;
  memberId: string;
  templateId: string;
  templateName: string;
  phoneE164: string;
}

export interface RewardGrantSummary {
  claimed: number;
  issued: number;
  failed: number;
  ambiguous: number;
  staleQuarantined: number;
}

export async function processPendingRewardGrants(
  res: ResApiClient,
  limit = 20,
  sourceId?: string,
): Promise<RewardGrantSummary> {
  const sql = getDb();
  const staleQuarantined = await quarantineStaleClaims(sql);
  const summary: RewardGrantSummary = {
    claimed: 0,
    issued: 0,
    failed: 0,
    ambiguous: 0,
    staleQuarantined,
  };
  for (let index = 0; index < limit; index += 1) {
    const claim = await sql.begin((tx) => claimNextGrant(tx, sourceId));
    if (!claim) break;
    summary.claimed += 1;
    const outcome = await processClaim(sql, res, claim);
    summary[outcome] += 1;
  }
  return summary;
}

async function processClaim(
  sql: ReturnType<typeof getDb>,
  res: ResApiClient,
  claim: ClaimedGrant,
): Promise<"issued" | "failed" | "ambiguous"> {
  let member;
  let template;
  let before;
  try {
    member = await res.resolveMemberByPhone(claim.phoneE164);
    if (member.id !== claim.memberId) throw new Error("Reward member identity mismatch.");
    template = await res.resolveEnabledCouponTemplateByName(claim.templateName, 2201);
    if (template.id !== claim.templateId) throw new Error("Reward template identity mismatch.");
    before = await res.listUsableMatchingCoupons({ member, template });
    await markPrepared(sql, claim, before.map((coupon) => coupon.id));
  } catch (error) {
    await markFailed(sql, claim, error);
    return "failed";
  }

  let giveStatus: "accepted" | "rejected" | "ambiguous" = "ambiguous";
  try {
    giveStatus = (await res.giveCoupon({
      phoneE164: claim.phoneE164,
      member,
      template,
      quantity: 1,
      effectiveDays: 90,
      remark: `FRIEND-TOPUP-${claim.grantId}`,
    })).status;
  } catch {
    giveStatus = "ambiguous";
  }

  try {
    const after = await res.listUsableMatchingCoupons({ member, template });
    const baseline = new Set(before.map((coupon) => coupon.id));
    const added = after.filter((coupon) => !baseline.has(coupon.id));
    if (added.length === 1 && after.length === before.length + 1) {
      await markIssued(sql, claim, added[0].id);
      return "issued";
    }
    if (giveStatus === "rejected" && added.length === 0) {
      await markFailed(sql, claim, new Error("RES explicitly rejected coupon issuance."));
      return "failed";
    }
  } catch {
    // The mutation may already have crossed the RES boundary. Fall through to ambiguous.
  }
  await markAmbiguous(sql, claim, "coupon issuance readback was inconclusive");
  return "ambiguous";
}

async function claimNextGrant(
  sql: SqlRunner,
  sourceId?: string,
): Promise<ClaimedGrant | null> {
  const claimToken = randomUUID();
  const rows = await sql`
    WITH candidate AS (
      SELECT queued.grant_id
        FROM public.mkt_reward_grant queued
       WHERE (
         queued.status = 'pending'
         OR (${sourceId ?? null}::text IS NULL AND queued.status = 'failed')
       )
         AND queued.benefit_code = 'friend_topup_rm10'
         AND queued.attempt_count < 3
         AND (${sourceId ?? null}::text IS NULL OR queued.source_id = ${sourceId ?? null})
         AND 1 = (
           SELECT COUNT(DISTINCT member.phone_e164)
             FROM public.pos_member member
            WHERE member.member_id = queued.member_id
              AND member.phone_e164 IS NOT NULL
         )
       ORDER BY queued.created_at, queued.grant_id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
    )
    UPDATE public.mkt_reward_grant grant
       SET status = 'claimed', claim_token = ${claimToken}::uuid,
           claimed_at = now(), attempt_count = attempt_count + 1,
           last_error = NULL, updated_at = now()
      FROM candidate
     WHERE grant.grant_id = candidate.grant_id
     RETURNING grant.grant_id, grant.member_id, grant.res_template_id,
               grant.res_template_name
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  const phoneRows = await sql`
    SELECT phone_e164, max(snapshot_date) AS latest_snapshot
      FROM public.pos_member
     WHERE member_id = ${row.member_id}
       AND phone_e164 IS NOT NULL
     GROUP BY phone_e164
     ORDER BY latest_snapshot DESC
     LIMIT 2
  `;
  if (phoneRows.length !== 1 || !/^\+[1-9]\d{7,14}$/.test(String(phoneRows[0].phone_e164))) {
    throw new Error("Reward member phone resolution was not unique.");
  }
  return {
    grantId: Number(row.grant_id),
    claimToken,
    memberId: String(row.member_id),
    templateId: String(row.res_template_id),
    templateName: String(row.res_template_name),
    phoneE164: String(phoneRows[0].phone_e164),
  };
}

async function markPrepared(
  sql: SqlRunner,
  claim: ClaimedGrant,
  baselineCouponIds: readonly string[],
): Promise<void> {
  const rows = await sql`
    UPDATE public.mkt_reward_grant
       SET context = context || ${sql.json({ baselineCouponIds, phase: "prepared" })},
           updated_at = now()
     WHERE grant_id = ${claim.grantId}
       AND status = 'claimed' AND claim_token = ${claim.claimToken}::uuid
     RETURNING grant_id
  `;
  assertCas(rows, "prepare");
}

async function markIssued(
  sql: ReturnType<typeof getDb>,
  claim: ClaimedGrant,
  couponId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    const rows = await tx`
      UPDATE public.mkt_reward_grant
         SET status = 'issued', res_coupon_id = ${couponId}, issued_at = now(),
             claim_token = NULL, updated_at = now()
       WHERE grant_id = ${claim.grantId}
         AND status = 'claimed' AND claim_token = ${claim.claimToken}::uuid
       RETURNING grant_id
    `;
    assertCas(rows, "issue");
    await tx`
      UPDATE public.mkt_friend_topup_participant
         SET status = 'rewarded', updated_at = now()
       WHERE reward_grant_id = ${claim.grantId} AND status = 'reward_pending'
    `;
  });
}

async function markFailed(sql: SqlRunner, claim: ClaimedGrant, error: unknown): Promise<void> {
  const rows = await sql`
    UPDATE public.mkt_reward_grant
       SET status = 'failed', claim_token = NULL, claimed_at = NULL,
           last_error = ${safeError(error)}, updated_at = now()
     WHERE grant_id = ${claim.grantId}
       AND status = 'claimed' AND claim_token = ${claim.claimToken}::uuid
     RETURNING grant_id
  `;
  assertCas(rows, "fail");
}

async function markAmbiguous(
  sql: SqlRunner,
  claim: ClaimedGrant,
  message: string,
): Promise<void> {
  const rows = await sql`
    UPDATE public.mkt_reward_grant
       SET status = 'ambiguous', last_error = ${message}, updated_at = now()
     WHERE grant_id = ${claim.grantId}
       AND status = 'claimed' AND claim_token = ${claim.claimToken}::uuid
     RETURNING grant_id
  `;
  assertCas(rows, "mark ambiguous");
}

async function quarantineStaleClaims(sql: SqlRunner): Promise<number> {
  const rows = await sql`
    UPDATE public.mkt_reward_grant
       SET status = 'ambiguous',
           last_error = 'stale claim requires coupon readback',
           updated_at = now()
     WHERE status = 'claimed' AND claimed_at < now() - interval '5 minutes'
     RETURNING grant_id
  `;
  return rows.length;
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function assertCas(rows: readonly Record<string, unknown>[], action: string): void {
  if (rows.length !== 1) throw new Error(`Reward grant ${action} CAS failed.`);
}
