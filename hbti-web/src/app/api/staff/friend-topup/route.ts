import { z } from "zod";

import { getJsonMutationRejection, noStoreJson } from "@/lib/auth/http";
import { getDb } from "@/lib/db/postgres";
import { readHbtiServerConfig } from "@/lib/server-config";
import { createResApiClientFromEnv } from "@/lib/res/client";
import { processPendingRewardGrants } from "@/lib/rewards/grant-worker";
import { createFriendTopupGroup } from "@/lib/staff/friend-topup";
import { readStaffSession } from "@/lib/staff/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.strictObject({
  phones: z.array(z.string().regex(/^\+[1-9]\d{7,14}$/)).min(2).max(6),
});

export async function POST(request: Request) {
  try {
    const rejection = getJsonMutationRejection(
      request,
      readHbtiServerConfig().linkBaseUrl,
    );
    if (rejection) return rejection;
    const session = readStaffSession(request);
    if (!session) return noStoreJson({ error: "STAFF_LOGIN_REQUIRED" }, { status: 401 });
    const input = bodySchema.parse(await request.json());
    const result = await getDb().begin((sql) =>
      createFriendTopupGroup(sql, {
        phones: input.phones,
        staffId: session.staffId,
      }),
    );
    try {
      const issuance = await processPendingRewardGrants(
        createResApiClientFromEnv(AbortSignal.timeout(45_000)),
        result.participants.length,
        result.groupId,
      );
      const issuedNow = issuance.issued === result.participants.length;
      return noStoreJson(
        { created: true, ...result, rewardStatus: issuedNow ? "issued" : "pending", issuance },
        issuedNow ? undefined : { status: 202 },
      );
    } catch (error) {
      console.error("[staff] friend rewards remain queued", {
        groupId: result.groupId,
        message: error instanceof Error ? error.message : String(error),
      });
      return noStoreJson(
        { created: true, ...result, rewardStatus: "pending" },
        { status: 202 },
      );
    }
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const code = error instanceof Error ? error.message : "";
    if (
      [
        "FRIEND_GROUP_INVALID",
        "TOPUP_NOT_UNIQUE",
        "MEMBER_NOT_UNIQUE",
        "STORE_MISMATCH",
        "TOPUP_TIME_INVALID",
        "TOPUP_TIME_MISMATCH",
        "TOPUP_AMOUNT_INVALID",
      ].includes(code)
    ) {
      return noStoreJson({ error: code }, { status: 409 });
    }
    if ((error as { code?: unknown })?.code === "23505") {
      return noStoreJson({ error: "TOPUP_ALREADY_REWARDED" }, { status: 409 });
    }
    console.error("[staff] friend top-up registration failed", {
      message: code || String(error),
    });
    return noStoreJson({ error: "FRIEND_TOPUP_FAILED" }, { status: 503 });
  }
}
