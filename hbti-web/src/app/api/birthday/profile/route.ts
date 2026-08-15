import { NextResponse } from "next/server";
import { z } from "zod";

import { getJsonMutationRejection, noStoreJson } from "@/lib/auth/http";
import { getDb } from "@/lib/db/postgres";
import { readBirthdayConfig } from "@/lib/birthday/config";
import { resolveBirthdayAuth } from "@/lib/birthday/resolve-auth";
import { readProfile, upsertProfile } from "@/lib/birthday/store";
import { readHbtiServerConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const maxDuration = 15;

const MONTH_DAY_MAX: Record<number, number> = {
  1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
  7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
};

const bodySchema = z.strictObject({
  linkToken: z.string().max(512).optional(),
  birthdayMonth: z.number().int().min(1).max(12).nullable(),
  birthdayDay: z.number().int().min(1).max(31).nullable(),
  allergies: z.string().trim().max(300).nullable(),
  preferences: z.string().trim().max(300).nullable(),
});

/** 保存会员主动留下的资料（想记住的日期、过敏原、口味偏好）。一会员一行，幂等。 */
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

    if (
      (input.birthdayMonth === null) !== (input.birthdayDay === null) ||
      (input.birthdayMonth !== null &&
        input.birthdayDay !== null &&
        input.birthdayDay > (MONTH_DAY_MAX[input.birthdayMonth] ?? 31))
    ) {
      return noStoreJson({ error: "INVALID_DATE" }, { status: 400 });
    }

    const config = readBirthdayConfig();
    const auth = await resolveBirthdayAuth(request, config, input.linkToken);
    if (auth.kind === "link_expired") {
      return noStoreJson({ error: "LINK_EXPIRED" }, { status: 410 });
    }
    if (auth.kind !== "link" && auth.kind !== "session") {
      return noStoreJson({ error: "LOGIN_REQUIRED" }, { status: 401 });
    }

    const sql = getDb();
    await upsertProfile(sql, auth.memberId, {
      birthdayMonth: input.birthdayMonth,
      birthdayDay: input.birthdayDay,
      allergies: input.allergies,
      preferences: input.preferences,
    });
    const profile = await readProfile(sql, auth.memberId);
    return noStoreJson({ saved: true, profile });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    console.error("[birthday] profile save failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return noStoreJson({ error: "SAVE_FAILED" }, { status: 503 });
  }
}
