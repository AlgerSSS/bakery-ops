import { NextResponse } from "next/server";

export function getJsonMutationRejection(
  request: Request,
  expectedOrigin: string,
): NextResponse | null {
  const contentType = request.headers.get("content-type");
  if (
    !contentType ||
    contentType.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json"
  ) {
    return noStoreJson(
      { error: "UNSUPPORTED_MEDIA_TYPE" },
      { status: 415 },
    );
  }

  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (
    !origin ||
    !isExpectedOrigin(request, origin, expectedOrigin) ||
    (secFetchSite !== null && secFetchSite !== "same-origin")
  ) {
    return noStoreJson({ error: "INVALID_ORIGIN" }, { status: 403 });
  }

  return null;
}

export function noStoreJson(
  body: unknown,
  init?: ResponseInit,
): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function isExpectedOrigin(
  request: Request,
  origin: string,
  expectedOrigin: string,
): boolean {
  let requestOrigin: string;
  let parsedOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
    parsedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }
  if (parsedOrigin !== origin) {
    return false;
  }
  if (requestOrigin === expectedOrigin && parsedOrigin === expectedOrigin) {
    return true;
  }
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  const requestUrl = new URL(request.url);
  return (
    (requestUrl.hostname === "localhost" ||
      requestUrl.hostname === "127.0.0.1") &&
    (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") &&
    origin === requestOrigin
  );
}
