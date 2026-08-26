import { NextResponse } from "next/server";
import { z } from "zod";

import { getJsonMutationRejection, noStoreJson } from "@/lib/auth/http";
import { readHbtiAuthSession } from "@/lib/auth/session";
import {
  InvalidMemberEmailError,
  saveMemberEmail,
} from "@/lib/member/email-store";
import { readHbtiServerConfig } from "@/lib/server-config";

export const runtime = "nodejs";

const requestSchema = z.strictObject({
  email: z.string(),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const config = readHbtiServerConfig();
    const rejection = getJsonMutationRejection(request, config.linkBaseUrl);
    if (rejection) return rejection;

    const session = await readHbtiAuthSession(request);
    if (!session) {
      return noStoreJson(
        { error: "AUTHENTICATION_REQUIRED" },
        { status: 401 },
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const input = requestSchema.parse(rawBody);
    await saveMemberEmail(session.payload.memberId, input.email);

    // 邮箱是 PII，不在响应里回显；页面只需要知道门槛已经满足。
    return noStoreJson({ emailCollected: true });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof InvalidMemberEmailError) {
      return noStoreJson({ error: "INVALID_EMAIL" }, { status: 400 });
    }
    return noStoreJson({ error: "SERVICE_UNAVAILABLE" }, { status: 503 });
  }
}
