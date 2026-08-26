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
  status: BirthdayReservationStatus;
  pointsStatus: BirthdayPointsStatus;
  createdAt: string;
}

export type BirthdayReservationStatus =
  | "processing"
  | "reserved"
  | "fulfilled"
  | "cancelled"
  | "ambiguous";

export type BirthdayPointsStatus =
  | "not_applicable"
  | "claiming"
  | "deducted"
  | "refund_claimed"
  | "refunded"
  | "failed"
  | "ambiguous";

interface ReservationRow {
  reservation_id: number;
  gift_type: "free_basque" | "points_450";
  for_whom: "self" | "gift";
  recipient_note: string | null;
  pickup_date: string;
  slot: "noon" | "night";
  member_note: string | null;
  status: BirthdayReservationStatus;
  points_status?: BirthdayPointsStatus;
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
    pointsStatus:
      row.points_status ??
      (row.gift_type === "free_basque" ? "not_applicable" : "ambiguous"),
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
           pickup_date::text, slot, member_note, status, points_status, created_at
      FROM public.mkt_birthday_reservation
     WHERE member_id = ${memberId} AND campaign_year = ${campaignYear}
     ORDER BY created_at DESC
     LIMIT 20
  `;
  return (rows as unknown as ReservationRow[]).map(mapReservation);
}

export interface StaffBirthdayReservation extends BirthdayReservation {
  maskedPhone: string | null;
  levelSnapshot: string | null;
  pointsBefore: number | null;
}

interface StaffReservationRow extends ReservationRow {
  phone_e164: string | null;
  level_snapshot: string | null;
  points_before: number | null;
}

export async function listBirthdayFulfillmentQueue(
  sql: SqlRunner,
): Promise<StaffBirthdayReservation[]> {
  const rows = await sql`
    SELECT r.reservation_id, r.gift_type, r.for_whom, r.recipient_note,
           r.pickup_date::text, r.slot, r.member_note, r.status,
           r.points_status, r.created_at, r.level_snapshot, r.points_before,
           m.phone_e164
      FROM public.mkt_birthday_reservation r
      LEFT JOIN LATERAL (
        SELECT member.phone_e164
          FROM public.pos_member member
         WHERE member.member_id = r.member_id
         ORDER BY member.snapshot_date DESC
         LIMIT 1
      ) m ON true
     WHERE r.pickup_date BETWEEN
             (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - 1
             AND (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 30
       AND r.status IN ('processing','reserved','ambiguous')
     ORDER BY r.pickup_date, r.slot, r.created_at
     LIMIT 200
  `;
  return (rows as unknown as StaffReservationRow[]).map(mapStaffReservation);
}

export async function readBirthdayReservationForStaff(
  sql: SqlRunner,
  reservationId: number,
): Promise<(StaffBirthdayReservation & { phoneE164: string | null }) | null> {
  const rows = await sql`
    SELECT r.reservation_id, r.gift_type, r.for_whom, r.recipient_note,
           r.pickup_date::text, r.slot, r.member_note, r.status,
           r.points_status, r.created_at, r.level_snapshot, r.points_before,
           m.phone_e164
      FROM public.mkt_birthday_reservation r
      LEFT JOIN LATERAL (
        SELECT member.phone_e164
          FROM public.pos_member member
         WHERE member.member_id = r.member_id
         ORDER BY member.snapshot_date DESC
         LIMIT 1
      ) m ON true
     WHERE r.reservation_id = ${reservationId}
     LIMIT 1
  `;
  const row = (rows as unknown as StaffReservationRow[])[0];
  if (!row) return null;
  return {
    ...mapStaffReservation(row),
    phoneE164:
      typeof row.phone_e164 === "string" && /^\+[1-9]\d{7,14}$/.test(row.phone_e164)
        ? row.phone_e164
        : null,
  };
}

function mapStaffReservation(row: StaffReservationRow): StaffBirthdayReservation {
  return {
    ...mapReservation(row),
    maskedPhone:
      typeof row.phone_e164 === "string" && row.phone_e164.length >= 4
        ? `**** ${row.phone_e164.slice(-4)}`
        : null,
    levelSnapshot: row.level_snapshot ?? null,
    pointsBefore:
      row.points_before === null || row.points_before === undefined
        ? null
        : Number(row.points_before),
  };
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
  | { ok: false; reason: "BIRTHDAY_GIFT_ALREADY_CLAIMED" };

/** 唯一索引冲突 = 并发/重复提交下的第二份年度生日礼，翻译成业务拒绝。 */
export async function createReservation(
  sql: SqlRunner,
  input: CreateReservationInput,
): Promise<CreateReservationResult> {
  try {
    const rows = await sql`
      INSERT INTO public.mkt_birthday_reservation
        (member_id, campaign_year, gift_type, for_whom, recipient_note,
         pickup_date, slot, member_note, level_snapshot, points_snapshot,
         status, points_status)
      VALUES
        (${input.memberId}, ${input.campaignYear}, ${input.giftType}, ${input.forWhom},
         ${input.recipientNote}, ${input.pickupDate}::date, ${input.slot},
         ${input.memberNote}, ${input.levelSnapshot}, ${input.pointsSnapshot},
         ${input.giftType === "points_450" ? "processing" : "reserved"},
         ${input.giftType === "points_450" ? "claiming" : "not_applicable"})
      RETURNING reservation_id, gift_type, for_whom, recipient_note,
                pickup_date::text, slot, member_note, status, points_status, created_at
    `;
    return {
      ok: true,
      reservation: mapReservation((rows as unknown as ReservationRow[])[0]),
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "BIRTHDAY_GIFT_ALREADY_CLAIMED" };
    }
    throw error;
  }
}

export async function markPointsDeducted(
  sql: SqlRunner,
  reservationId: number,
  input: {
    reference: string;
    pointsBefore: number;
    pointsAfter: number;
  },
): Promise<void> {
  const rows = await sql`
    UPDATE public.mkt_birthday_reservation
       SET status = 'reserved',
           points_status = 'deducted',
           points_adjustment_ref = ${input.reference},
           points_before = ${input.pointsBefore},
           points_after = ${input.pointsAfter},
           updated_at = now()
     WHERE reservation_id = ${reservationId}
       AND gift_type = 'points_450'
       AND status = 'processing'
       AND points_status = 'claiming'
     RETURNING reservation_id
  `;
  assertTransition(rows, "point deduction");
}

export async function markPointsReservationRejected(
  sql: SqlRunner,
  reservationId: number,
  reason: string,
): Promise<void> {
  const rows = await sql`
    UPDATE public.mkt_birthday_reservation
       SET status = 'cancelled',
           points_status = 'failed',
           cancel_reason = ${reason},
           cancelled_at = now(),
           updated_at = now()
     WHERE reservation_id = ${reservationId}
       AND gift_type = 'points_450'
       AND status = 'processing'
       AND points_status = 'claiming'
     RETURNING reservation_id
  `;
  assertTransition(rows, "point rejection");
}

export async function markPointsReservationAmbiguous(
  sql: SqlRunner,
  reservationId: number,
  reference: string,
): Promise<void> {
  const rows = await sql`
    UPDATE public.mkt_birthday_reservation
       SET status = 'ambiguous',
           points_status = 'ambiguous',
           points_adjustment_ref = ${reference},
           updated_at = now()
     WHERE reservation_id = ${reservationId}
       AND gift_type = 'points_450'
       AND status = 'processing'
       AND points_status = 'claiming'
     RETURNING reservation_id
  `;
  assertTransition(rows, "ambiguous point deduction");
}

export async function markReservationFulfilled(
  sql: SqlRunner,
  reservationId: number,
  staffId: string,
  staffNote: string | null,
): Promise<void> {
  const rows = await sql`
    UPDATE public.mkt_birthday_reservation
       SET status = 'fulfilled',
           fulfilled_at = now(),
           fulfilled_by = ${staffId},
           staff_note = ${staffNote},
           updated_at = now()
     WHERE reservation_id = ${reservationId}
       AND status = 'reserved'
       AND (
         (gift_type = 'free_basque' AND points_status = 'not_applicable')
         OR (gift_type = 'points_450' AND points_status = 'deducted')
       )
     RETURNING reservation_id
  `;
  assertTransition(rows, "birthday fulfillment");
}

export type BeginCancellationResult =
  | { action: "cancelled" }
  | { action: "refund_required" };

export async function beginReservationCancellation(
  sql: SqlRunner,
  reservationId: number,
  staffId: string,
  reason: string,
): Promise<BeginCancellationResult> {
  const rows = await sql`
    UPDATE public.mkt_birthday_reservation
       SET status = CASE WHEN gift_type = 'points_450' THEN 'processing' ELSE 'cancelled' END,
           points_status = CASE WHEN gift_type = 'points_450' THEN 'refund_claimed' ELSE points_status END,
           cancelled_at = CASE WHEN gift_type = 'points_450' THEN NULL ELSE now() END,
           cancel_reason = ${reason},
           staff_note = ${"cancelled by " + staffId},
           updated_at = now()
     WHERE reservation_id = ${reservationId}
       AND status = 'reserved'
       AND (
         (gift_type = 'free_basque' AND points_status = 'not_applicable')
         OR (gift_type = 'points_450' AND points_status = 'deducted')
       )
     RETURNING gift_type
  `;
  assertTransition(rows, "birthday cancellation claim");
  return rows[0].gift_type === "points_450"
    ? { action: "refund_required" }
    : { action: "cancelled" };
}

export async function markPointsRefunded(
  sql: SqlRunner,
  reservationId: number,
  input: {
    reference: string;
    pointsBefore: number;
    pointsAfter: number;
  },
): Promise<void> {
  const rows = await sql`
    UPDATE public.mkt_birthday_reservation
       SET status = 'cancelled',
           points_status = 'refunded',
           points_refund_ref = ${input.reference},
           refund_points_before = ${input.pointsBefore},
           refund_points_after = ${input.pointsAfter},
           cancelled_at = now(),
           updated_at = now()
     WHERE reservation_id = ${reservationId}
       AND gift_type = 'points_450'
       AND status = 'processing'
       AND points_status = 'refund_claimed'
     RETURNING reservation_id
  `;
  assertTransition(rows, "point refund");
}

export async function markPointsRefundAmbiguous(
  sql: SqlRunner,
  reservationId: number,
  reference: string,
): Promise<void> {
  const rows = await sql`
    UPDATE public.mkt_birthday_reservation
       SET status = 'ambiguous',
           points_status = 'ambiguous',
           points_refund_ref = ${reference},
           updated_at = now()
     WHERE reservation_id = ${reservationId}
       AND gift_type = 'points_450'
       AND status = 'processing'
       AND points_status = 'refund_claimed'
     RETURNING reservation_id
  `;
  assertTransition(rows, "ambiguous point refund");
}

export async function restoreAfterRejectedPointsRefund(
  sql: SqlRunner,
  reservationId: number,
): Promise<void> {
  const rows = await sql`
    UPDATE public.mkt_birthday_reservation
       SET status = 'reserved',
           points_status = 'deducted',
           cancel_reason = NULL,
           staff_note = NULL,
           updated_at = now()
     WHERE reservation_id = ${reservationId}
       AND gift_type = 'points_450'
       AND status = 'processing'
       AND points_status = 'refund_claimed'
     RETURNING reservation_id
  `;
  assertTransition(rows, "rejected point refund restore");
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

function assertTransition(rows: readonly Record<string, unknown>[], label: string): void {
  if (rows.length !== 1) {
    throw new Error(`Birthday ${label} state transition was rejected.`);
  }
}
