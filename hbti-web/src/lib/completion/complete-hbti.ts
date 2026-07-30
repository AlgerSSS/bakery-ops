import { createHmac, randomUUID } from "node:crypto";

import { z } from "zod";

import type { HbtiAnswersInput } from "@/lib/hbti/schema";
import { hbtiAnswersSchema } from "@/lib/hbti/schema";
import { scoreHbti } from "@/lib/hbti/scoring";
import type {
  GiveCouponResult,
  ResCouponAdapter,
  UsableCoupon,
} from "@/lib/res/contracts";
import type {
  CompletionRecord,
  CompletionReviewReason,
  CompletionStore,
  CompletionStoreKey,
  HbtiCompletionSnapshot,
  IssuedCompletionRecord,
  PreparedCompletionRecord,
  ReviewCompletionRecord,
} from "@/lib/store/completion-store";

const metadataSchema = z.string().trim().min(1).max(32);
const STALE_LOCKED_MS = 90_000;
const PREPARED_READBACK_DELAY_MS = 5_000;
const PREPARED_REVIEW_AFTER_MS = 120_000;

const completeHbtiInputSchema = z.strictObject({
  phone: z.string().trim().min(1).max(32),
  campaignVersion: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  answers: hbtiAnswersSchema,
  color: metadataSchema,
  gender: metadataSchema.optional(),
  age: metadataSchema.optional(),
});

export interface CompleteHbtiInput {
  phone: string;
  campaignVersion: string;
  answers: HbtiAnswersInput;
  color: string;
  gender?: string;
  age?: string;
}

export interface CompleteHbtiDependencies {
  store: CompletionStore;
  res: ResCouponAdapter;
  memberHashSecret: string | Uint8Array;
  couponTemplateName: string;
  now?: () => Date;
}

export interface ReconcilePreparedDependencies {
  store: CompletionStore;
  res: Pick<ResCouponAdapter, "listUsableMatchingCoupons">;
  now?: () => Date;
}

export type CompleteHbtiErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CONFIGURATION"
  | "STORE_UNAVAILABLE"
  | "RES_UNAVAILABLE";

export class CompleteHbtiError extends Error {
  readonly code: CompleteHbtiErrorCode;
  readonly retryable: boolean;

  constructor(
    code: CompleteHbtiErrorCode,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "CompleteHbtiError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type CompleteHbtiResult =
  | ({
      status: "issued";
      reward: IssuedCompletionRecord["reward"];
    } & HbtiCompletionSnapshot)
  | ({ status: "processing" } & HbtiCompletionSnapshot)
  | ({
      status: "review";
      reason: CompletionReviewReason;
    } & HbtiCompletionSnapshot);

export async function completeHbti(
  input: CompleteHbtiInput,
  dependencies: CompleteHbtiDependencies,
): Promise<CompleteHbtiResult> {
  const parsed = completeHbtiInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompleteHbtiError(
      "INVALID_INPUT",
      "Invalid completion request.",
      false,
    );
  }

  const couponTemplateName = dependencies.couponTemplateName.trim();
  if (
    couponTemplateName.length === 0 ||
    !hasHashSecret(dependencies.memberHashSecret)
  ) {
    throw new CompleteHbtiError(
      "INVALID_CONFIGURATION",
      "Completion service is not configured.",
      false,
    );
  }

  const phoneE164 = normalizeE164(parsed.data.phone);
  const score = scoreHbti(parsed.data.answers);
  const completion: HbtiCompletionSnapshot = {
    code: score.code,
    visitTime: score.visitTime,
    category: score.category,
    color: parsed.data.color,
    ...(parsed.data.gender ? { gender: parsed.data.gender } : {}),
    ...(parsed.data.age ? { age: parsed.data.age } : {}),
  };
  const key: CompletionStoreKey = {
    campaignVersion: parsed.data.campaignVersion,
    memberHash: createHmac("sha256", dependencies.memberHashSecret)
      .update(phoneE164, "utf8")
      .digest("hex"),
  };
  const now = dependencies.now ?? (() => new Date());
  const startedAt = safeIsoTimestamp(now);
  const attemptId = randomUUID();

  const existing = await getCompletion(dependencies.store, key);
  if (existing) {
    return handleExistingCompletion({
      record: existing,
      input: parsed.data,
      dependencies,
      key,
      now,
    });
  }

  const acquisition = await acquireCompletion(
    dependencies.store,
    key,
    attemptId,
    startedAt,
    completion,
  );
  if (!acquisition.acquired) {
    return handleExistingCompletion({
      record: acquisition.record,
      input: parsed.data,
      dependencies,
      key,
      now,
    });
  }

  let member;
  let template;
  let beforeCoupons: readonly UsableCoupon[];
  try {
    member = await dependencies.res.resolveMemberByPhone(phoneE164);
    template =
      await dependencies.res.resolveEnabledCouponTemplateByName(
        couponTemplateName,
      );
    beforeCoupons = await dependencies.res.listUsableMatchingCoupons({
      member,
      template,
    });
    assertCouponList(beforeCoupons);
  } catch {
    await clearLocked(dependencies.store, key, attemptId);
    throw new CompleteHbtiError(
      "RES_UNAVAILABLE",
      "Reward service is temporarily unavailable.",
      true,
    );
  }

  const prepared: PreparedCompletionRecord = {
    status: "processing",
    phase: "prepared",
    attemptId,
    startedAt,
    preparedAt: safeIsoTimestamp(now),
    completion,
    baselineCouponIds: beforeCoupons.map(({ id }) => id),
    rewardContext: {
      memberId: member.id,
      templateId: template.id,
      templateName: template.name,
    },
  };
  await markPrepared(dependencies.store, key, attemptId, prepared);

  let giveResult: GiveCouponResult;
  try {
    giveResult = await dependencies.res.giveCoupon({
      phoneE164,
      member,
      template,
      quantity: 1,
    });
    if (!isGiveResult(giveResult)) {
      giveResult = { status: "ambiguous" };
    }
  } catch {
    // Once the mutation request has crossed the adapter boundary, an unknown
    // failure is unsafe to retry blindly. Readback decides issued vs review.
    giveResult = { status: "ambiguous" };
  }

  let afterCoupons: readonly UsableCoupon[];
  try {
    afterCoupons = await dependencies.res.listUsableMatchingCoupons({
      member,
      template,
    });
    assertCouponList(afterCoupons);
  } catch {
    return resultFromRecord(prepared);
  }

  const beforeCount = beforeCoupons.length;
  const afterCount = afterCoupons.length;
  const newCouponIds = findNewCouponIds(beforeCoupons, afterCoupons);
  if (newCouponIds.length === 1) {
    const issued: IssuedCompletionRecord = {
      status: "issued",
      completion,
      reward: {
        couponTemplateName: template.name,
        newCouponId: newCouponIds[0],
        usableCouponCountBefore: beforeCount,
        usableCouponCountAfter: afterCount,
        confirmedAt: safeIsoTimestamp(now),
      },
    };

    return finalizeIssued(dependencies.store, key, attemptId, issued);
  }

  if (newCouponIds.length > 1) {
    return markForReview(
      dependencies.store,
      key,
      attemptId,
      completion,
      "readback_mismatch",
      safeIsoTimestamp(now),
    );
  }
  if (giveResult.status === "rejected") {
    return markForReview(
      dependencies.store,
      key,
      attemptId,
      completion,
      "give_rejected",
      safeIsoTimestamp(now),
    );
  }
  return resultFromRecord(prepared);
}

function normalizeE164(rawPhone: string): string {
  const compact = rawPhone.trim().replace(/[\s().-]/g, "");
  const normalized = compact.startsWith("00")
    ? `+${compact.slice(2)}`
    : compact;

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new CompleteHbtiError(
      "INVALID_INPUT",
      "Invalid completion request.",
      false,
    );
  }

  return normalized;
}

function hasHashSecret(secret: string | Uint8Array): boolean {
  return typeof secret === "string" ? secret.length > 0 : secret.byteLength > 0;
}

function safeIsoTimestamp(now: () => Date): string {
  return safeDate(now).toISOString();
}

function safeDate(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new CompleteHbtiError(
      "INVALID_CONFIGURATION",
      "Completion service is not configured.",
      false,
    );
  }
  return value;
}

async function handleExistingCompletion({
  record,
  input,
  dependencies,
  key,
  now,
}: {
  record: CompletionRecord;
  input: CompleteHbtiInput;
  dependencies: CompleteHbtiDependencies;
  key: CompletionStoreKey;
  now: () => Date;
}): Promise<CompleteHbtiResult> {
  if (record.status !== "processing") {
    return resultFromRecord(record);
  }

  if (record.phase === "locked") {
    const ageMs = safeDate(now).getTime() - Date.parse(record.startedAt);
    if (!Number.isFinite(ageMs) || ageMs < STALE_LOCKED_MS) {
      return resultFromRecord(record);
    }
    const cleared = await clearLocked(
      dependencies.store,
      key,
      record.attemptId,
    );
    if (!cleared) {
      const current = await getCompletion(dependencies.store, key);
      return resultFromRecord(current ?? record);
    }
    return completeHbti(input, dependencies);
  }

  const preparedAgeMs =
    safeDate(now).getTime() - Date.parse(record.preparedAt);
  if (
    !Number.isFinite(preparedAgeMs) ||
    preparedAgeMs < PREPARED_READBACK_DELAY_MS
  ) {
    return resultFromRecord(record);
  }

  return reconcilePreparedCompletion({
    record,
    dependencies: {
      store: dependencies.store,
      res: dependencies.res,
      now,
    },
    key,
  });
}

export async function reconcilePreparedCompletion({
  record,
  dependencies,
  key,
}: {
  record: PreparedCompletionRecord;
  dependencies: ReconcilePreparedDependencies;
  key: CompletionStoreKey;
}): Promise<CompleteHbtiResult> {
  const now = dependencies.now ?? (() => new Date());
  const preparedAgeMs =
    safeDate(now).getTime() - Date.parse(record.preparedAt);
  const shouldEscalate =
    Number.isFinite(preparedAgeMs) &&
    preparedAgeMs >= PREPARED_REVIEW_AFTER_MS;
  let currentCoupons: readonly UsableCoupon[];
  try {
    const member = { id: record.rewardContext.memberId };
    const template = {
      id: record.rewardContext.templateId,
      name: record.rewardContext.templateName,
    };
    currentCoupons = await dependencies.res.listUsableMatchingCoupons({
      member,
      template,
    });
    assertCouponList(currentCoupons);
  } catch {
    if (!shouldEscalate) {
      return resultFromRecord(record);
    }
    return markForReview(
      dependencies.store,
      key,
      record.attemptId,
      record.completion,
      "readback_unavailable",
      safeIsoTimestamp(now),
    );
  }

  const baselineCoupons = record.baselineCouponIds.map((id) => ({ id }));
  const newCouponIds = findNewCouponIds(
    baselineCoupons,
    currentCoupons,
  );
  if (newCouponIds.length === 1) {
    const issued: IssuedCompletionRecord = {
      status: "issued",
      completion: record.completion,
      reward: {
        couponTemplateName: record.rewardContext.templateName,
        newCouponId: newCouponIds[0],
        usableCouponCountBefore: baselineCoupons.length,
        usableCouponCountAfter: currentCoupons.length,
        confirmedAt: safeIsoTimestamp(now),
      },
    };
    return finalizeIssued(
      dependencies.store,
      key,
      record.attemptId,
      issued,
    );
  }

  if (newCouponIds.length > 1) {
    return markForReview(
      dependencies.store,
      key,
      record.attemptId,
      record.completion,
      "readback_mismatch",
      safeIsoTimestamp(now),
    );
  }
  if (!shouldEscalate) {
    return resultFromRecord(record);
  }
  return markForReview(
    dependencies.store,
    key,
    record.attemptId,
    record.completion,
    "stale_reconciliation",
    safeIsoTimestamp(now),
  );
}

async function getCompletion(
  store: CompletionStore,
  key: CompletionStoreKey,
): Promise<CompletionRecord | null> {
  try {
    return await store.get(key);
  } catch {
    throw new CompleteHbtiError(
      "STORE_UNAVAILABLE",
      "Completion service is temporarily unavailable.",
      true,
    );
  }
}

async function acquireCompletion(
  store: CompletionStore,
  key: CompletionStoreKey,
  attemptId: string,
  startedAt: string,
  completion: HbtiCompletionSnapshot,
) {
  try {
    return await store.acquireProcessing(key, {
      status: "processing",
      phase: "locked",
      attemptId,
      startedAt,
      completion,
    });
  } catch {
    throw new CompleteHbtiError(
      "STORE_UNAVAILABLE",
      "Completion service is temporarily unavailable.",
      true,
    );
  }
}

async function markPrepared(
  store: CompletionStore,
  key: CompletionStoreKey,
  attemptId: string,
  record: PreparedCompletionRecord,
): Promise<void> {
  try {
    await store.markPrepared(key, attemptId, record);
  } catch {
    throw new CompleteHbtiError(
      "STORE_UNAVAILABLE",
      "Completion service is temporarily unavailable.",
      true,
    );
  }
}

async function clearLocked(
  store: CompletionStore,
  key: CompletionStoreKey,
  attemptId: string,
): Promise<boolean> {
  try {
    return await store.clearLocked(key, attemptId);
  } catch {
    throw new CompleteHbtiError(
      "STORE_UNAVAILABLE",
      "Completion service is temporarily unavailable.",
      true,
    );
  }
}

async function finalizeIssued(
  store: CompletionStore,
  key: CompletionStoreKey,
  attemptId: string,
  issued: IssuedCompletionRecord,
): Promise<CompleteHbtiResult> {
  try {
    await store.markIssued(key, attemptId, issued);
    return resultFromRecord(issued);
  } catch {
    const current = await getCompletion(store, key);
    if (current?.status === "issued" || current?.status === "review") {
      return resultFromRecord(current);
    }
    throw new CompleteHbtiError(
      "STORE_UNAVAILABLE",
      "Completion service is temporarily unavailable.",
      true,
    );
  }
}

async function markForReview(
  store: CompletionStore,
  key: CompletionStoreKey,
  attemptId: string,
  completion: HbtiCompletionSnapshot,
  reason: CompletionReviewReason,
  markedAt: string,
): Promise<CompleteHbtiResult> {
  const review: ReviewCompletionRecord = {
    status: "review",
    completion,
    reason,
    markedAt,
  };
  try {
    await store.markReview(key, attemptId, review);
  } catch {
    const current = await getCompletion(store, key);
    if (current?.status === "issued" || current?.status === "review") {
      return resultFromRecord(current);
    }
    throw new CompleteHbtiError(
      "STORE_UNAVAILABLE",
      "Completion service is temporarily unavailable.",
      true,
    );
  }
  return resultFromRecord(review);
}

function resultFromRecord(record: CompletionRecord): CompleteHbtiResult {
  switch (record.status) {
    case "issued":
      return {
        status: "issued",
        ...record.completion,
        reward: record.reward,
      };
    case "review":
      return {
        status: "review",
        ...record.completion,
        reason: record.reason,
      };
    case "processing":
      return {
        status: "processing",
        ...record.completion,
      };
  }
}

function assertCouponList(
  coupons: readonly UsableCoupon[],
): asserts coupons is readonly UsableCoupon[] {
  if (
    !Array.isArray(coupons) ||
    coupons.some(
      (coupon) =>
        typeof coupon !== "object" ||
        coupon === null ||
        typeof coupon.id !== "string" ||
        coupon.id.length === 0,
    )
  ) {
    throw new Error("Invalid coupon readback.");
  }
  if (new Set(coupons.map(({ id }) => id)).size !== coupons.length) {
    throw new Error("Invalid coupon readback.");
  }
}

function findNewCouponIds(
  beforeCoupons: readonly UsableCoupon[],
  afterCoupons: readonly UsableCoupon[],
): string[] {
  const beforeCouponIds = new Set(beforeCoupons.map(({ id }) => id));
  return afterCoupons
    .map(({ id }) => id)
    .filter((id) => !beforeCouponIds.has(id));
}

function isGiveResult(value: GiveCouponResult): value is GiveCouponResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value.status === "accepted" ||
      value.status === "rejected" ||
      value.status === "ambiguous")
  );
}
