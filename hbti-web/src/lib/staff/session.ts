import { createHmac, timingSafeEqual } from "node:crypto";

import type { NextResponse } from "next/server";

const COOKIE_PRODUCTION = "__Host-hbti_staff";
const COOKIE_LOCAL = "hbti_staff";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface StaffSession {
  staffId: string;
  expiresAt: number;
}

interface SessionPayload {
  v: 1;
  sid: string;
  exp: number;
}

export function verifyStaffAccessCode(candidate: string): boolean {
  const expected = requireAccessCode();
  const left = Buffer.from(candidate, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createStaffSessionToken(
  staffId: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): { token: string; session: StaffSession } {
  const normalized = normalizeStaffId(staffId);
  const payload: SessionPayload = {
    v: 1,
    sid: normalized,
    exp: nowSeconds + SESSION_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    token: `${body}.${sign(body)}`,
    session: { staffId: normalized, expiresAt: payload.exp },
  };
}

export function readStaffSession(
  request: Request,
  nowSeconds = Math.floor(Date.now() / 1_000),
): StaffSession | null {
  const token = readCookie(request, cookieName());
  if (!token) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra || !safeEqual(signature, sign(body))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (
      parsed.v !== 1 ||
      typeof parsed.sid !== "string" ||
      normalizeStaffId(parsed.sid) !== parsed.sid ||
      !Number.isSafeInteger(parsed.exp) ||
      (parsed.exp as number) <= nowSeconds
    ) {
      return null;
    }
    return { staffId: parsed.sid, expiresAt: parsed.exp as number };
  } catch {
    return null;
  }
}

export function setStaffSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: number,
): void {
  response.cookies.set(cookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(expiresAt * 1_000),
  });
}

export function clearStaffSessionCookie(response: NextResponse): void {
  response.cookies.set(cookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}

export function staffSessionSigningSecret(): string {
  const secret = process.env.STAFF_REWARDS_SESSION_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("STAFF_REWARDS_SESSION_SECRET must contain at least 32 bytes.");
  }
  return secret;
}

function requireAccessCode(): string {
  const code = process.env.STAFF_REWARDS_ACCESS_CODE?.trim();
  if (!code || Buffer.byteLength(code, "utf8") < 12) {
    throw new Error("STAFF_REWARDS_ACCESS_CODE must contain at least 12 bytes.");
  }
  return code;
}

function normalizeStaffId(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 2 ||
    normalized.length > 40 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("Invalid staff identifier.");
  }
  return normalized;
}

function sign(body: string): string {
  return createHmac("sha256", staffSessionSigningSecret())
    .update("hbti-staff:v1:", "utf8")
    .update(body, "utf8")
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieName(): string {
  return process.env.NODE_ENV === "production" ? COOKIE_PRODUCTION : COOKIE_LOCAL;
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    return value.length <= 1_024 ? value : null;
  }
  return null;
}
