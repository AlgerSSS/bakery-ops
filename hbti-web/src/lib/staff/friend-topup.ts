import type { SqlRunner } from "@/lib/db/postgres";

const MAX_PAIR_GAP_MS = 30 * 60_000;

interface CandidateRow {
  txn_id: string;
  store: string;
  txn_at: string;
  member_id: string;
  phone_e164: string;
  trade_amount: string | number;
}

export interface FriendTopupParticipant {
  memberId: string;
  maskedPhone: string;
  amount: number;
}

export interface FriendTopupGroupResult {
  groupId: string;
  participants: FriendTopupParticipant[];
  rewardStatus: "pending";
}

export function validateFriendTopupCandidates(
  rows: readonly CandidateRow[],
  phones: readonly string[],
): CandidateRow[] {
  const uniquePhones = new Set(phones);
  if (uniquePhones.size !== phones.length || phones.length < 2 || phones.length > 6) {
    throw new Error("FRIEND_GROUP_INVALID");
  }
  const grouped = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.phone_e164) ?? [];
    list.push(row);
    grouped.set(row.phone_e164, list);
  }
  const selected = phones.map((phone) => {
    const matches = grouped.get(phone) ?? [];
    if (matches.length !== 1) throw new Error("TOPUP_NOT_UNIQUE");
    return matches[0];
  });
  if (new Set(selected.map((row) => row.member_id)).size !== selected.length) {
    throw new Error("MEMBER_NOT_UNIQUE");
  }
  if (new Set(selected.map((row) => row.store)).size !== 1) {
    throw new Error("STORE_MISMATCH");
  }
  const times = selected.map((row) => new Date(row.txn_at).getTime());
  if (times.some((time) => !Number.isFinite(time))) throw new Error("TOPUP_TIME_INVALID");
  if (Math.max(...times) - Math.min(...times) > MAX_PAIR_GAP_MS) {
    throw new Error("TOPUP_TIME_MISMATCH");
  }
  for (const row of selected) {
    const amount = Number(row.trade_amount);
    if (!Number.isFinite(amount) || amount < 100) throw new Error("TOPUP_AMOUNT_INVALID");
  }
  return selected;
}

export async function createFriendTopupGroup(
  sql: SqlRunner,
  input: { phones: readonly string[]; staffId: string },
): Promise<FriendTopupGroupResult> {
  const rows = await sql`
    SELECT t.txn_id, t.store, t.txn_at, t.member_id,
           m.phone_e164, t.trade_amount
      FROM public.pos_member_card_txn t
      JOIN public.pos_member m
        ON m.store = t.store AND m.member_id = t.member_id
     WHERE m.phone_e164 = ANY(${input.phones}::text[])
       AND t.txn_type = 10
       AND t.trade_amount >= 100
       AND t.txn_at >= now() - interval '2 hours'
       AND t.business_date = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
       AND NOT EXISTS (
         SELECT 1
           FROM public.mkt_friend_topup_participant used
          WHERE used.topup_txn_id = t.txn_id
       )
     ORDER BY t.txn_at DESC
     FOR UPDATE OF t
  `;
  const selected = validateFriendTopupCandidates(
    rows as unknown as CandidateRow[],
    input.phones,
  );
  const template = readFriendCouponTemplate();
  const groupRows = await sql`
    INSERT INTO public.mkt_friend_topup_group (store, created_by)
    VALUES (${selected[0].store}, ${input.staffId})
    RETURNING group_id::text AS group_id
  `;
  if (groupRows.length !== 1) throw new Error("FRIEND_GROUP_CREATE_FAILED");
  const groupId = String(groupRows[0].group_id);

  const participants: FriendTopupParticipant[] = [];
  for (const row of selected) {
    const grantRows = await sql`
      INSERT INTO public.mkt_reward_grant
        (idempotency_key, member_id, benefit_code, period_key, source_type,
         source_id, res_template_id, res_template_name, context)
      VALUES
        (${`friend-topup:${row.store}:${row.txn_id}`}, ${row.member_id},
         'friend_topup_rm10', ${groupId}, 'friend_topup', ${groupId},
         ${template.id}, ${template.name},
         ${sql.json({ topupTxnId: row.txn_id, amount: Number(row.trade_amount) })})
      RETURNING grant_id
    `;
    if (grantRows.length !== 1) throw new Error("FRIEND_REWARD_CREATE_FAILED");
    await sql`
      INSERT INTO public.mkt_friend_topup_participant
        (group_id, member_id, topup_txn_id, topup_amount, reward_grant_id,
         status)
      VALUES
        (${groupId}::uuid, ${row.member_id}, ${row.txn_id},
         ${Number(row.trade_amount)}, ${grantRows[0].grant_id}, 'reward_pending')
    `;
    participants.push({
      memberId: row.member_id,
      maskedPhone: maskPhone(row.phone_e164),
      amount: Number(row.trade_amount),
    });
  }
  await sql`
    UPDATE public.mkt_friend_topup_group
       SET status = 'completed', completed_at = now()
     WHERE group_id = ${groupId}::uuid AND status = 'open'
  `;
  return { groupId, participants, rewardStatus: "pending" };
}

function readFriendCouponTemplate(): { id: string; name: string } {
  const id = process.env.FRIEND_TOPUP_COUPON_TEMPLATE_ID?.trim();
  const name = process.env.FRIEND_TOPUP_COUPON_TEMPLATE_NAME?.trim();
  if (!id || !/^\d{18,20}$/.test(id) || !name) {
    throw new Error("Friend top-up coupon template is not configured.");
  }
  return { id, name };
}

function maskPhone(phone: string): string {
  return `**** ${phone.slice(-4)}`;
}
