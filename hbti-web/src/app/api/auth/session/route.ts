import { NextResponse } from "next/server";

import { noStoreJson } from "@/lib/auth/http";
import { maskAuthPhone } from "@/lib/auth/phone";
import { readHbtiAuthSession } from "@/lib/auth/session";
import {
  clearHbtiSessionCookie,
  readHbtiSessionCookie,
} from "@/lib/auth/session-cookie";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const token = readHbtiSessionCookie(request);
  if (!token) {
    return noStoreJson({ authenticated: false });
  }

  try {
    const session = await readHbtiAuthSession(request);
    if (!session) {
      const response = noStoreJson({ authenticated: false });
      clearHbtiSessionCookie(response);
      return response;
    }
    return noStoreJson({
      authenticated: true,
      maskedPhone: maskAuthPhone(session.payload.identity),
      draftKey: session.draftKey,
    });
  } catch {
    return noStoreJson(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
