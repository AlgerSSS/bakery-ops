import type { NextResponse } from "next/server";

const PRODUCTION_SESSION_COOKIE = "__Host-hbti_session";
const LOCAL_SESSION_COOKIE = "hbti_session";
const RAW_SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function hbtiSessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? PRODUCTION_SESSION_COOKIE
    : LOCAL_SESSION_COOKIE;
}

export function readHbtiSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }
  const cookieName = hbtiSessionCookieName();
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === cookieName) {
      return RAW_SESSION_TOKEN.test(value) ? value : null;
    }
  }
  return null;
}

export function setHbtiSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
): void {
  if (!RAW_SESSION_TOKEN.test(token) || !Number.isFinite(expiresAt.getTime())) {
    throw new Error("Invalid HBTI session cookie.");
  }
  response.cookies.set(hbtiSessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearHbtiSessionCookie(response: NextResponse): void {
  response.cookies.set(hbtiSessionCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}
