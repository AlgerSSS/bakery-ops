import { NextResponse } from "next/server";
import { z } from "zod";

import { getJsonMutationRejection, noStoreJson } from "@/lib/auth/http";
import { createAuthStoreFromEnv } from "@/lib/auth/pg-auth-store";
import {
  clearHbtiSessionCookie,
  readHbtiSessionCookie,
} from "@/lib/auth/session-cookie";
import { readHbtiServerConfig } from "@/lib/server-config";

export const runtime = "nodejs";

const requestSchema = z.strictObject({});

export async function POST(request: Request): Promise<NextResponse> {
  let response: NextResponse;
  try {
    const config = readHbtiServerConfig();
    const rejection = getJsonMutationRejection(
      request,
      config.linkBaseUrl,
    );
    if (rejection) {
      return rejection;
    }
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      response = noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 });
      clearHbtiSessionCookie(response);
      return response;
    }
    requestSchema.parse(rawBody);

    const token = readHbtiSessionCookie(request);
    if (token) {
      await (await createAuthStoreFromEnv()).deleteSession(token);
    }
    response = noStoreJson({ authenticated: false });
  } catch (error) {
    response =
      error instanceof z.ZodError
        ? noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 })
        : noStoreJson(
            { error: "SERVICE_UNAVAILABLE" },
            { status: 503 },
          );
  }
  clearHbtiSessionCookie(response);
  return response;
}
