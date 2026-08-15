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
  const expectedOrigins = [expectedOrigin, ...readExtraOrigins()].filter(
    (value) => value.length > 0,
  );
  if (
    !origin ||
    !isExpectedOrigin(request, origin, expectedOrigins) ||
    (secFetchSite !== null && secFetchSite !== "same-origin")
  ) {
    return noStoreJson({ error: "INVALID_ORIGIN" }, { status: 403 });
  }

  return null;
}

/**
 * 同一套应用被部署到多个自有域名时（hbti-test.hotcrush.net 与
 * birthday.hotcrush.net），额外的允许来源。逗号分隔的完整 origin，
 * 与 HBTI_LINK_BASE_URL 取并集。
 */
function readExtraOrigins(): string[] {
  const raw = process.env.HBTI_EXTRA_ORIGINS ?? "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
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
  expectedOrigins: string[],
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
  // 请求自身的主机必须在允许名单里，且 Origin 头必须与它一致
  // （浏览器对同源 fetch 本来就会带上与页面一致的 Origin）。
  if (expectedOrigins.includes(requestOrigin) && requestOrigin === parsedOrigin) {
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
