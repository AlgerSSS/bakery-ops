import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  void request;
  return noStoreJson(
    { valid: false, error: "INVITATION_LINK_RETIRED" },
    { status: 410 },
  );
}

function noStoreJson(
  body: unknown,
  init?: ResponseInit,
): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
