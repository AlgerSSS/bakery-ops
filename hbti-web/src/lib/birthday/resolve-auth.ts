import { maskAuthPhone } from "@/lib/auth/phone";
import { readHbtiAuthSession } from "@/lib/auth/session";
import {
  verifyBirthdayLinkToken,
  type BirthdayLinkPayload,
} from "@/lib/birthday/link-token";
import type { BirthdayConfig } from "@/lib/birthday/config";

/**
 * 生日贺卡的两种身份来源：
 *   link    —— 店家推送的签名链接（顾客点开即识别，免登录）；
 *   session —— 短信验证码登录后的 HBTI 会话（链接丢失/转发时的兜底）。
 * 两者只解决「你是谁」，预约资格由 eligibility 按等级另行判定。
 */

export type BirthdayAuth =
  | { kind: "link"; memberId: string; link: BirthdayLinkPayload }
  | { kind: "session"; memberId: string; maskedPhone: string | null }
  | { kind: "none" }
  | { kind: "link_expired" }
  | { kind: "link_invalid" };

export async function resolveBirthdayAuth(
  request: Request,
  config: BirthdayConfig,
  linkToken?: string | null,
): Promise<BirthdayAuth> {
  const token = linkToken ?? new URL(request.url).searchParams.get("t");
  if (token) {
    const result = verifyBirthdayLinkToken(token, config.linkSecret);
    if (result.ok) {
      return { kind: "link", memberId: result.payload.mid, link: result.payload };
    }
    return {
      kind: result.reason === "expired" ? "link_expired" : "link_invalid",
    };
  }

  const session = await readHbtiAuthSession(request);
  if (session) {
    return {
      kind: "session",
      memberId: session.payload.memberId,
      maskedPhone: maskAuthPhone(session.payload.identity),
    };
  }
  return { kind: "none" };
}
