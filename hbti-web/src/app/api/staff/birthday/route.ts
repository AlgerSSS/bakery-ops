import { z } from "zod";

import { getJsonMutationRejection, noStoreJson } from "@/lib/auth/http";
import {
  beginReservationCancellation,
  listBirthdayFulfillmentQueue,
  markPointsRefundAmbiguous,
  markPointsRefunded,
  markReservationFulfilled,
  readBirthdayReservationForStaff,
  restoreAfterRejectedPointsRefund,
} from "@/lib/birthday/store";
import { getDb } from "@/lib/db/postgres";
import { createResApiClientFromEnv } from "@/lib/res/client";
import { readHbtiServerConfig } from "@/lib/server-config";
import { readStaffSession } from "@/lib/staff/session";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("fulfill"),
    reservationId: z.number().int().positive(),
    staffNote: z.string().trim().max(300).nullish(),
  }),
  z.strictObject({
    action: z.literal("cancel"),
    reservationId: z.number().int().positive(),
    reason: z.string().trim().min(3).max(300),
  }),
]);

export async function GET(request: Request) {
  const session = readStaffSession(request);
  if (!session) return noStoreJson({ error: "STAFF_LOGIN_REQUIRED" }, { status: 401 });
  try {
    return noStoreJson({
      staffId: session.staffId,
      reservations: await listBirthdayFulfillmentQueue(getDb()),
    });
  } catch (error) {
    console.error("[staff] birthday queue failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return noStoreJson({ error: "BIRTHDAY_QUEUE_FAILED" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const rejection = getJsonMutationRejection(
      request,
      readHbtiServerConfig().linkBaseUrl,
    );
    if (rejection) return rejection;
    const session = readStaffSession(request);
    if (!session) return noStoreJson({ error: "STAFF_LOGIN_REQUIRED" }, { status: 401 });
    const input = bodySchema.parse(await request.json());
    const sql = getDb();
    const reservation = await readBirthdayReservationForStaff(sql, input.reservationId);
    if (!reservation) return noStoreJson({ error: "RESERVATION_NOT_FOUND" }, { status: 404 });

    if (input.action === "fulfill") {
      await markReservationFulfilled(
        sql,
        input.reservationId,
        session.staffId,
        input.staffNote ?? null,
      );
      return noStoreJson({ fulfilled: true });
    }

    const claim = await beginReservationCancellation(
      sql,
      input.reservationId,
      session.staffId,
      input.reason,
    );
    if (claim.action === "cancelled") return noStoreJson({ cancelled: true });
    if (!reservation.phoneE164) {
      await markPointsRefundAmbiguous(sql, input.reservationId, `BIRTHDAY-REFUND-${input.reservationId}`);
      return noStoreJson({ error: "MEMBER_PHONE_UNAVAILABLE", reconciliation: true }, { status: 409 });
    }

    const reference = `BIRTHDAY-REFUND-${input.reservationId}`;
    try {
      const adjusted = await createResApiClientFromEnv(
        AbortSignal.timeout(24_000),
      ).adjustMemberPoints({
        phoneE164: reservation.phoneE164,
        points: 450,
        direction: "increase",
        reference,
      });
      if (adjusted.status === "rejected") {
        await restoreAfterRejectedPointsRefund(sql, input.reservationId);
        return noStoreJson({ error: "POINT_REFUND_REJECTED" }, { status: 409 });
      }
      await markPointsRefunded(sql, input.reservationId, adjusted);
      return noStoreJson({ cancelled: true, pointsRefunded: 450 });
    } catch (error) {
      await markPointsRefundAmbiguous(sql, input.reservationId, reference);
      console.error("[staff] point refund requires reconciliation", {
        reservationId: input.reservationId,
        message: error instanceof Error ? error.message : String(error),
      });
      return noStoreJson(
        { error: "POINT_REFUND_UNCONFIRMED", reconciliation: true },
        { status: 202 },
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    console.error("[staff] birthday action failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return noStoreJson({ error: "BIRTHDAY_ACTION_FAILED" }, { status: 409 });
  }
}
