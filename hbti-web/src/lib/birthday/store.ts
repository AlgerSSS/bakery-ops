import type { SqlRunner } from "@/lib/db/postgres";

/**
 * 生日贺卡两张表的访问层。纪律与 pg-completion-store 一致：
 * zod 之外由 SQL CHECK 兜底，唯一索引承担幂等（免费巴斯克每年一份），
 * 应用层把唯一冲突翻译成业务结果而不是异常。
 */

export interface BirthdayProfile {
  birthdayMonth: number | null;
  birthdayDay: number | null;
  allergies: string | null;
  preferences: string | null;
  updatedAt: string;
}

export interface BirthdayProfileInput {
  birthdayMonth: number | null;
  birthdayDay: number | null;
  allergies: string | null;
  preferences: string | null;
}

export async function readProfile(
  sql: SqlRunner,
  memberId: string,
): Promise<BirthdayProfile | null> {
  const rows = await sql`
    SELECT birthday_month, birthday_day, allergies, preferences,
           updated_at AS "updatedAt"
      FROM public.mkt_birthday_profile
     WHERE member_id = ${memberId}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    birthdayMonth: row.birthday_month ?? null,
    birthdayDay: row.birthday_day ?? null,
    allergies: row.allergies ?? null,
    preferences: row.preferences ?? null,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function upsertProfile(
  sql: SqlRunner,
  memberId: string,
  input: BirthdayProfileInput,
): Promise<void> {
  await sql`
    INSERT INTO public.mkt_birthday_profile
      (member_id, birthday_month, birthday_day, allergies, preferences)
    VALUES
      (${memberId}, ${input.birthdayMonth}, ${input.birthdayDay},
       ${input.allergies}, ${input.preferences})
    ON CONFLICT (member_id) DO UPDATE SET
      birthday_month = excluded.birthday_month,
      birthday_day   = excluded.birthday_day,
      allergies      = excluded.allergies,
      preferences    = excluded.preferences,
      updated_at     = now()
  `;
}

export interface BirthdayReservation {
  reservationId: number;
  giftType: "free_basque" | "points_450";
  forWhom: "self" | "gift";
  recipientNote: string | null;
  pickupDate: string;
  slot: "noon" | "night";
  memberNote: string | null;
  status: "reserved" | "fulfilled" | "cancelled";
  createdAt: string;
}

interface ReservationRow {
  reservation_id: number;
  gift_type: "free_basque" | "points_450";
  for_whom: "self" | "gift";
  recipient_note: string | null;
  pickup_date: string;
  slot: "noon" | "night";
  member_note: string | null;
  status: "reserved" | "fulfilled" | "cancelled";
  created_at: string;
}

function mapReservation(row: ReservationRow): BirthdayReservation {
  return {
    reservationId: Number(row.reservation_id),
    giftType: row.gift_type,
    forWhom: row.for_whom,
    recipientNote: row.recipient_note,
    pickupDate: String(row.pickup_date),
    slot: row.slot,
    memberNote: row.member_note,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function listReservations(
  sql: SqlRunner,
  memberId: string,
  campaignYear: number,
): Promise<BirthdayReservation[]> {
  const rows = await sql`
    SELECT reservation_id, gift_type, for_whom, recipient_note,
           pickup_date::text, slot, member_note, status, created_at
      FROM public.mkt_birthday_reservation
     WHERE member_id = ${memberId} AND campaign_year = ${campaignYear}
     ORDER BY created_at DESC
     LIMIT 20
  `;
  return (rows as unknown as ReservationRow[]).map(mapReservation);
}

export interface CreateReservationInput {
  memberId: string;
  campaignYear: number;
  giftType: "free_basque" | "points_450";
  forWhom: "self" | "gift";
  recipientNote: string | null;
  pickupDate: string;
  slot: "noon" | "night";
  memberNote: string | null;
  levelSnapshot: string | null;
  pointsSnapshot: number | null;
}

export type CreateReservationResult =
  | { ok: true; reservation: BirthdayReservation }
  | { ok: false; reason: "FREE_BASQUE_ALREADY_CLAIMED" };

/** 唯一索引冲突 = 并发/重复提交下的第二份免费巴斯克，翻译成业务拒绝。 */
export async function createReservation(
  sql: SqlRunner,
  input: CreateReservationInput,
): Promise<CreateReservationResult> {
  try {
    const rows = await sql`
      INSERT INTO public.mkt_birthday_reservation
        (member_id, campaign_year, gift_type, for_whom, recipient_note,
         pickup_date, slot, member_note, level_snapshot, points_snapshot)
      VALUES
        (${input.memberId}, ${input.campaignYear}, ${input.giftType}, ${input.forWhom},
         ${input.recipientNote}, ${input.pickupDate}::date, ${input.slot},
         ${input.memberNote}, ${input.levelSnapshot}, ${input.pointsSnapshot})
      RETURNING reservation_id, gift_type, for_whom, recipient_note,
                pickup_date::text, slot, member_note, status, created_at
    `;
    return {
      ok: true,
      reservation: mapReservation((rows as unknown as ReservationRow[])[0]),
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "FREE_BASQUE_ALREADY_CLAIMED" };
    }
    throw error;
  }
}

export async function markReservationNotified(
  sql: SqlRunner,
  reservationId: number,
  outcome: "sent" | "skipped" | "failed",
): Promise<void> {
  await sql`
    UPDATE public.mkt_birthday_reservation
       SET notify_status = ${outcome}, updated_at = now()
     WHERE reservation_id = ${reservationId}
  `;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}
