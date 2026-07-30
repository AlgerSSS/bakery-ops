import { NextResponse } from "next/server";
import { z } from "zod";

import {
  MemberLinkError,
  verifyMemberLinkToken,
} from "@/lib/member-link/crypto";
import { memberLinkTokenSchema } from "@/lib/member-link/schema";
import { consumeTokenRateLimit } from "@/lib/rate-limit/mongo-rate-limit";
import {
  isTrustedRequestOrigin,
  readHbtiServerConfig,
} from "@/lib/server-config";

export const runtime = "nodejs";

const requestSchema = z.strictObject({
  token: memberLinkTokenSchema,
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const input = requestSchema.parse(await request.json());
    const config = readHbtiServerConfig();
    if (!isTrustedRequestOrigin(request, config.linkBaseUrl)) {
      return noStoreJson(
        { valid: false, error: "INVALID_ORIGIN" },
        { status: 403 },
      );
    }
    const memberLink = verifyMemberLinkToken({
      token: input.token,
      secret: config.linkSecret,
      expectedCampaignVersion: config.campaignVersion,
    });
    const rateLimit = await consumeTokenRateLimit({
      scope: "session",
      token: input.token,
      limit: 30,
      windowMs: 60_000,
    });
    if (!rateLimit.allowed) {
      return noStoreJson(
        { valid: false, error: "RATE_LIMITED" },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    return noStoreJson({
      valid: true,
      expiresAt: memberLink.expiresAt,
    });
  } catch (error) {
    if (error instanceof MemberLinkError && error.code === "EXPIRED") {
      return noStoreJson(
        { valid: false, error: "LINK_EXPIRED" },
        { status: 410 },
      );
    }
    if (error instanceof MemberLinkError || error instanceof z.ZodError) {
      return noStoreJson(
        { valid: false, error: "INVALID_LINK" },
        { status: 400 },
      );
    }
    return noStoreJson(
      { valid: false, error: "SERVICE_UNAVAILABLE" },
      { status: 503 },
    );
  }
}

function noStoreJson(
  body: unknown,
  init?: ResponseInit,
): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
