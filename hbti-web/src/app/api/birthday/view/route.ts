import { NextResponse } from "next/server";

import { noStoreJson } from "@/lib/auth/http";
import { getDb } from "@/lib/db/postgres";
import {
  deriveLevelKey,
  memberLevelInfo,
  readBirthdayConfig,
} from "@/lib/birthday/config";
import { resolveBirthdayAuth } from "@/lib/birthday/resolve-auth";
import { listBirthdayOptions, pickupWindow } from "@/lib/birthday/eligibility";
import { readMemberBasics, readYearStats } from "@/lib/birthday/stats";
import { listReservations, readProfile } from "@/lib/birthday/store";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * 生日贺卡的唯一读接口：身份 + 会员基础信息 + 年度回顾 + 权益 + 已存资料与预约。
 * GET 只读；无身份时 401，前端据此展示「验证手机号进入」的兜底入口。
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const config = readBirthdayConfig();
    const auth = await resolveBirthdayAuth(request, config);
    if (auth.kind === "link_expired") {
      return noStoreJson({ error: "LINK_EXPIRED" }, { status: 410 });
    }
    if (auth.kind === "link_invalid") {
      return noStoreJson({ error: "LINK_INVALID" }, { status: 401 });
    }
    if (auth.kind === "none") {
      return noStoreJson({ error: "LOGIN_REQUIRED" }, { status: 401 });
    }

    const sql = getDb();
    const [basics, profile, reservations] = await Promise.all([
      readMemberBasics(sql, auth.memberId),
      readProfile(sql, auth.memberId),
      listReservations(sql, auth.memberId, config.campaignYear),
    ]);
    const stats = await readYearStats(sql, auth.memberId, config.campaignYear);

    const levelName = basics?.levelName ?? null;
    const pointBalance = basics?.pointBalance ?? null;
    // 等级按「今年实付消费」实时计算（用户 2026-08-15 定版），RES 等级名只作档案。
    const levelKey = deriveLevelKey(stats?.totalNetSales);
    const level = memberLevelInfo(levelKey);
    const annualSpend = stats?.totalNetSales ?? 0;
    const nextLevel = levelKey === "L4" ? null : memberLevelInfo(
      levelKey === "L1" ? "L2" : levelKey === "L2" ? "L3" : "L4",
    );
    const options = listBirthdayOptions(
      { levelName: levelKey, pointBalance },
      reservations.map((r) => ({ giftType: r.giftType, status: r.status })),
      config,
    );

    return noStoreJson({
      authenticated: true,
      via: auth.kind,
      displayName:
        auth.kind === "link" ? (auth.link.name ?? null) : null,
      maskedPhone:
        auth.kind === "session"
          ? auth.maskedPhone
          : (basics?.maskedPhone ?? null),
      member: {
        levelName,
        pointBalance,
        registeredOn: basics?.registeredOn ?? null,
        level: {
          key: level.key,
          nameZh: level.nameZh,
          nameEn: level.nameEn,
          annualSpend,
          next: nextLevel
            ? {
                key: nextLevel.key,
                nameZh: nextLevel.nameZh,
                threshold: nextLevel.annualThreshold,
                gap: Math.max(0, nextLevel.annualThreshold - annualSpend),
              }
            : null,
        },
      },
      stats,
      options,
      pickup: pickupWindow(config),
      profile,
      reservations,
      campaignYear: config.campaignYear,
    });
  } catch (error) {
    console.error("[birthday] view failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return noStoreJson({ error: "VIEW_FAILED" }, { status: 503 });
  }
}
