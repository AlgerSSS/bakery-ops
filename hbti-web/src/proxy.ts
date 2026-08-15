import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 按域名分发（Next 16 的 proxy 约定，即旧 middleware）：birthday.hotcrush.net
 * 上的页面请求重写到 /birthday 体验，hbti-test.hotcrush.net 保持原样。
 *
 * - /api/* 不重写：OTP 登录、健康检查等接口是两个域名共享的；
 * - birthday 域名上除 /t/<token> 外的页面路径都落到 /birthday 落地页；
 * - /birthday 路径本身在 hbti 域名也可达，方便门店预览与验收。
 */

const BIRTHDAY_HOST = "birthday.hotcrush.net";

export function proxy(request: NextRequest): NextResponse {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  if (host !== BIRTHDAY_HOST) {
    return NextResponse.next();
  }
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/birthday") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.png"
  ) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = "/birthday" + (pathname === "/" ? "" : pathname);
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
