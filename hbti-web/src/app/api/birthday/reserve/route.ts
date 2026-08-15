import { NextResponse } from "next/server";
import { z } from "zod";

import { getJsonMutationRejection, noStoreJson } from "@/lib/auth/http";
import { getDb } from "@/lib/db/postgres";
import { deriveLevelKey, readBirthdayConfig } from "@/lib/birthday/config";
import { decideReservation, pickupWindow } from "@/lib/birthday/eligibility";
import { notifyStore } from "@/lib/birthday/notify";
import { resolveBirthdayAuth } from "@/lib/birthday/resolve-auth";
import { readAnnualSpend, readMemberBasics } from "@/lib/birthday/stats";
import {
  createReservation,
  listReservations,
  markReservationNotified,
  readProfile,
} from "@/lib/birthday/store";
import { readHbtiServerConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const maxDuration = 15;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const bodySchema = z.strictObject({
  linkToken: z.string().max(512).optional(),
  forWhom: z.enum(["self", "gift"]),
  giftType: z.enum(["free_basque", "points_450"]),
  recipientNote: z.string().trim().max(120).nullish(),
  pickupDate: z.string().regex(DATE_PATTERN),
  slot: z.enum(["noon", "night"]),
  memberNote: z.string().trim().max(300).nullish(),
});

/**
 * 生日礼预约。顺序：身份 → 资格（等级权益规则）→ 落库（唯一索引幂等）→ 通知门店。
 * 通知失败只影响 notify_status，不回滚预约：顾客的确认页不该被推送通道掀翻。
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { linkBaseUrl } = readHbtiServerConfig();
    const rejection = getJsonMutationRejection(request, linkBaseUrl);
    if (rejection) return rejection;

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const input = bodySchema.parse(rawBody);

    const config = readBirthdayConfig();
    const auth = await resolveBirthdayAuth(request, config, input.linkToken);
    if (auth.kind === "link_expired") {
      return noStoreJson({ error: "LINK_EXPIRED" }, { status: 410 });
    }
    if (auth.kind !== "link" && auth.kind !== "session") {
      return noStoreJson({ error: "LOGIN_REQUIRED" }, { status: 401 });
    }

    const window = pickupWindow(config);
    if (input.pickupDate < window.minDate || input.pickupDate > window.maxDate) {
      return noStoreJson(
        { error: "PICKUP_DATE_OUT_OF_RANGE", pickup: window },
        { status: 400 },
      );
    }
    if (input.forWhom === "gift" && !input.recipientNote) {
      return noStoreJson({ error: "RECIPIENT_REQUIRED" }, { status: 400 });
    }

    const sql = getDb();
    const [basics, existing, profile, annualSpend] = await Promise.all([
      readMemberBasics(sql, auth.memberId),
      listReservations(sql, auth.memberId, config.campaignYear),
      readProfile(sql, auth.memberId),
      readAnnualSpend(sql, auth.memberId, config.campaignYear),
    ]);
    // 等级按年累计实付消费实时计算（用户 2026-08-15 定版），与 view 接口同口径。
    const levelKey = deriveLevelKey(annualSpend);

    const decision = decideReservation(
      {
        levelName: levelKey,
        pointBalance: basics?.pointBalance ?? null,
      },
      existing.map((r) => ({ giftType: r.giftType, status: r.status })),
      { forWhom: input.forWhom, giftType: input.giftType },
      config,
    );
    if (!decision.ok) {
      const status = decision.denial === "INSUFFICIENT_POINTS" ? 403 : 409;
      return noStoreJson({ error: decision.denial }, { status });
    }

    const created = await createReservation(sql, {
      memberId: auth.memberId,
      campaignYear: config.campaignYear,
      giftType: input.giftType,
      forWhom: input.forWhom,
      recipientNote: input.forWhom === "gift" ? (input.recipientNote ?? null) : null,
      pickupDate: input.pickupDate,
      slot: input.slot,
      memberNote: input.memberNote ?? null,
      levelSnapshot: levelKey,
      pointsSnapshot: basics?.pointBalance ?? null,
    });
    if (!created.ok) {
      return noStoreJson({ error: created.reason }, { status: 409 });
    }

    // 门店通知：webhook 未配置时保持 notify_status='pending'，
    // 由 tokyo-01 上的生日通知 relay（scripts/birthday-notify.mjs）收编发送——
    // 通知通道部署在服务器上，Vercel 侧不配 BIRTHDAY_NOTIFY_WEBHOOK。
    let notifyOutcome: "sent" | "skipped" | "failed" | "pending" = "pending";
    if (config.notifyWebhook) {
      notifyOutcome = await notifyStore(config.notifyWebhook, {
        reservation: created.reservation,
        maskedPhone:
          auth.kind === "session" ? auth.maskedPhone : (basics?.maskedPhone ?? null),
        levelName: basics?.levelName ?? null,
        pointsSnapshot: basics?.pointBalance ?? null,
        allergies: profile?.allergies ?? null,
      });
      await markReservationNotified(sql, created.reservation.reservationId, notifyOutcome)
        .catch((error: unknown) => {
          console.error("[birthday] notify status update failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }

    const reservations = await listReservations(sql, auth.memberId, config.campaignYear);
    return noStoreJson({
      reserved: true,
      reservation: created.reservation,
      reservations,
      notified: notifyOutcome,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    console.error("[birthday] reserve failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return noStoreJson({ error: "RESERVE_FAILED" }, { status: 503 });
  }
}
