import { NextResponse } from "next/server";

import { noStoreJson } from "@/lib/auth/http";
import { readHbtiAuthSession } from "@/lib/auth/session";
import {
  CompleteHbtiError,
  getHbtiCompletionStatus,
} from "@/lib/completion/complete-hbti";
import { createResApiClientFromEnv } from "@/lib/res/client";
import {
  isTrustedRequestOrigin,
  readHbtiServerConfig,
} from "@/lib/server-config";
import { createCompletionStoreFromEnv } from "@/lib/store/pg-completion-store";

import { publicCompletionPayload } from "../route";

export const runtime = "nodejs";
export const maxDuration = 30;
const RES_DEADLINE_MS = 20_000;

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const resDeadline = AbortSignal.timeout(RES_DEADLINE_MS);
    const config = readHbtiServerConfig();
    if (!isTrustedRequestOrigin(request, config.linkBaseUrl)) {
      return noStoreJson(
        { error: "INVALID_ORIGIN", retryable: false },
        { status: 403 },
      );
    }
    const session = await readHbtiAuthSession(request);
    if (!session) {
      return noStoreJson(
        { error: "AUTHENTICATION_REQUIRED", retryable: false },
        { status: 401 },
      );
    }

    const result = await getHbtiCompletionStatus(
      {
        phone: session.payload.identity.e164,
        expectedMemberId: session.payload.memberId,
        campaignVersion: config.campaignVersion,
      },
      {
        store: await createCompletionStoreFromEnv(),
        res: createResApiClientFromEnv(resDeadline),
      },
    );
    if (!result) {
      return noStoreJson(
        { status: "not_found", retryable: true },
        { status: 404 },
      );
    }

    return noStoreJson(
      publicCompletionPayload(result, config.memberWalletUrl),
      result.status === "issued" || result.status === "unrewarded"
        ? { status: 200 }
        : { status: 202 },
    );
  } catch (error) {
    if (error instanceof CompleteHbtiError) {
      const status =
        error.code === "INVALID_INPUT"
          ? 400
          : error.code === "INVALID_CONFIGURATION"
            ? 500
            : 503;
      return noStoreJson(
        { error: error.code, retryable: error.retryable },
        { status },
      );
    }
    return noStoreJson(
      { error: "SERVICE_UNAVAILABLE", retryable: true },
      { status: 503 },
    );
  }
}
