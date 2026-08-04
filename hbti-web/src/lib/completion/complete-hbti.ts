import { randomUUID } from "node:crypto";

import { z } from "zod";

import { reviewAlertPayload, sendAlert } from "@/lib/alert";
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
  UnrewardedCompletionRecord,
} from "@/lib/store/completion-store";

const metadataSchema = z.string().trim().min(1).max(32);
const STALE_LOCKED_MS = 90_000;
const PREPARED_READBACK_DELAY_MS = 5_000;
const PREPARED_REVIEW_AFTER_MS = 120_000;

const completeHbtiInputSchema = z.strictObject({
  phone: z.string().trim().min(1).max(32),
  expectedMemberId: z.string().trim().min(1).max(128),
  campaignVersion: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  answers: hbtiAnswersSchema,
  color: metadataSchema,
  gender: metadataSchema.optional(),
  age: metadataSchema.optional(),
});

const completionStatusInputSchema = z.strictObject({
  phone: z.string().trim().min(1).max(32),
  expectedMemberId: z.string().trim().min(1).max(128),
  campaignVersion: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
});

export interface CompleteHbtiInput {
  phone: string;
  expectedMemberId: string;
  campaignVersion: string;
  answers: HbtiAnswersInput;
  color: string;
  gender?: string;
  age?: string;
}

/**
 * 周边奖池。配置后，每次完成从池中按剩余库存加权抽一件，而不是发固定的那张券。
 *
 * 契约要求 draw 已经把库存扣掉了——所以从 draw 返回到 markPrepared 之间的任何失败，
 * 都必须调用 release 归还，否则那一件实物在账上被永久占住却从没发出去。
 */
export interface GiftPoolDependency {
  /** 抽一件并扣减库存；池子空了返回 null。 */
  draw(): Promise<{ templateName: string } | null>;
  /** 归还一件库存。 */
  release(templateName: string): Promise<void>;
}

export interface CompleteHbtiDependencies {
  store: CompletionStore;
  res: ResCouponAdapter;
  /** 未配置 gifts 时发的固定奖励；健康检查与对账也用它探活。 */
  couponTemplateName: string;
  /** 配置后改为从周边奖池抽取，忽略 couponTemplateName。 */
  gifts?: GiftPoolDependency;
  now?: () => Date;
}

export interface ReconcilePreparedDependencies {
  store: CompletionStore;
  res: Pick<ResCouponAdapter, "listUsableMatchingCoupons">;
  now?: () => Date;
}

export type GetHbtiCompletionStatusDependencies = ReconcilePreparedDependencies;

export type CompleteHbtiErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CONFIGURATION"
  | "MEMBER_IDENTITY_MISMATCH"
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
    } & HbtiCompletionSnapshot)
  // 周边发完了。仍然是成功：面包人格照常返回，只是没有券。
  | ({ status: "unrewarded" } & HbtiCompletionSnapshot);

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
    couponTemplateName.length === 0
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
  const key = createCompletionKey({
    campaignVersion: parsed.data.campaignVersion,
    memberId: parsed.data.expectedMemberId,
  });
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
  // 抽中之后、markPrepared 之前的每一条失败路径都要靠它归还库存。
  //
  // ⚠ 已知取舍：这个变量只活在进程内存里。drawGift 的扣减是自己一个事务、立即提交的，
  // 而记下「谁抽走了这一件」要等到 markPrepared。中间隔着两次 RES 网络调用，进程若在
  // 这个窗口里被杀（函数超时、部署重启），那一件就永久对不上账——库存少一件，实物还在抽屉里。
  //
  // 为什么不改成把抽中的券名先写进 locked 记录、再靠过期锁去归还：那样会引入**双重归还**。
  // 本地失败路径已经归还过一次，若归还与清锁之间又崩了，过期锁的恢复逻辑会再归还一次，
  // issued_count 被减到低于真实发出量，池子以为还有货——于是发出比实物更多的券。
  // 也就是说，天真的修法把「少发」（东西还在店里，手工加回来即可）换成了「超发」
  // （顾客拿着券到柜台却没有实物）。要真正修好，得让清锁与归还在同一个事务里完成，
  // 那需要把 CompletionStore 与奖池的边界打通——不是这次改动该做的。
  //
  // 现在这版失败方向是安全的。对账用：
  //   SELECT SUM(issued_count) FROM hbti_gift_stock;   -- 池子认为发出去多少
  //   SELECT COUNT(*) FROM pos_member WHERE hbti_status = 'issued'
  //     AND hbti_campaign_version = '<本期>';           -- 真正发成功多少
  // 前者持续大于后者、且差值在涨，就是这个窗口在漏，按差值把 issued_count 调回去即可。
  let drawnTemplateName: string | null = null;
  try {
    member = await dependencies.res.resolveMemberByPhone(phoneE164);
    if (
      parsed.data.expectedMemberId &&
      member.id !== parsed.data.expectedMemberId
    ) {
      await clearLocked(dependencies.store, key, attemptId);
      throw new CompleteHbtiError(
        "MEMBER_IDENTITY_MISMATCH",
        "Verified member identity does not match the reward account.",
        false,
      );
    }
    // 抽奖排在会员校验之后：RES 查询是最常见的中断点，先过了这一关再动库存，
    // 能省掉大量「扣了再还」的往返。
    let selection: RewardSelection;
    try {
      selection = await selectReward(dependencies.gifts);
    } catch (error) {
      await clearLocked(dependencies.store, key, attemptId);
      throw error;
    }
    if (selection.kind === "sold-out") {
      // 周边发完了。这不是错误：把锁直接转成终态，顾客照样拿到自己的面包人格，
      // 只是结果页会告诉他们小礼物已经领完。
      return markUnrewarded(
        dependencies.store,
        key,
        attemptId,
        completion,
        safeIsoTimestamp(now),
      );
    }
    drawnTemplateName =
      selection.kind === "drawn" ? selection.templateName : null;
    template =
      await dependencies.res.resolveEnabledCouponTemplateByName(
        drawnTemplateName ?? couponTemplateName,
      );
    beforeCoupons = await dependencies.res.listUsableMatchingCoupons({
      member,
      template,
    });
    assertCouponList(beforeCoupons);
  } catch (error) {
    if (error instanceof CompleteHbtiError) {
      // 抛到这里的都已经自己清过锁；抽奖失败时也还没扣到库存。
      throw error;
    }
    const released = await releaseReward(
      dependencies.gifts,
      drawnTemplateName,
    );
    if (!released && drawnTemplateName) {
      return markForReview(
        dependencies.store,
        key,
        {
          attemptId,
          completion,
          baselineCouponIds: [],
          rewardContext: {
            memberId: key.memberId,
            templateId: "unresolved-before-prepared",
            templateName: drawnTemplateName,
          },
        },
        "inventory_release_ambiguous",
        safeIsoTimestamp(now),
      );
    }
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
  // 这一步落库后，抽中的券名就写进了 rewardContext.templateName：后续所有重试
  // 都从记录里读它，不会再抽第二次。落库失败则必须把库存还回去。
  try {
    await markPrepared(dependencies.store, key, attemptId, prepared);
  } catch (error) {
    const released = await releaseReward(
      dependencies.gifts,
      drawnTemplateName,
    );
    if (!released) {
      return markForReview(
        dependencies.store,
        key,
        prepared,
        "inventory_release_ambiguous",
        safeIsoTimestamp(now),
      );
    }
    throw error;
  }

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
  if (
    newCouponIds.length === 1 &&
    afterCount === beforeCount + 1
  ) {
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

  if (newCouponIds.length > 0) {
    return markForReview(
      dependencies.store,
      key,
      prepared,
      "readback_mismatch",
      safeIsoTimestamp(now),
    );
  }
  if (giveResult.status === "rejected") {
    return markForReview(
      dependencies.store,
      key,
      prepared,
      "give_rejected",
      safeIsoTimestamp(now),
    );
  }
  return resultFromRecord(prepared);
}

export async function getHbtiCompletionStatus(
  input: {
    phone: string;
    expectedMemberId: string;
    campaignVersion: string;
  },
  dependencies: GetHbtiCompletionStatusDependencies,
): Promise<CompleteHbtiResult | null> {
  const parsed = completionStatusInputSchema.safeParse(input);
  if (
    !parsed.success
  ) {
    throw new CompleteHbtiError(
      "INVALID_INPUT",
      "Invalid completion status request.",
      false,
    );
  }

  // 键已改用 member_id，但手机号格式仍要校验：非法输入应当在这里被拒，
  // 而不是带着脏数据继续往下走。normalizeE164 校验失败会抛 INVALID_INPUT。
  normalizeE164(parsed.data.phone);
  const key = createCompletionKey({
    campaignVersion: parsed.data.campaignVersion,
    memberId: parsed.data.expectedMemberId,
  });
  const record = await getCompletion(dependencies.store, key);
  if (!record) {
    return null;
  }
  if (record.status === "processing" && record.phase === "prepared") {
    const now = dependencies.now ?? (() => new Date());
    const preparedAgeMs =
      safeDate(now).getTime() - Date.parse(record.preparedAt);
    if (
      Number.isFinite(preparedAgeMs) &&
      preparedAgeMs >= PREPARED_READBACK_DELAY_MS
    ) {
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
  }
  return resultFromRecord(record);
}

function createCompletionKey({
  campaignVersion,
  memberId,
}: {
  campaignVersion: string;
  memberId: string;
}): CompletionStoreKey {
  return { campaignVersion, memberId };
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
      record,
      "readback_unavailable",
      safeIsoTimestamp(now),
    );
  }

  const baselineCoupons = record.baselineCouponIds.map((id) => ({ id }));
  const newCouponIds = findNewCouponIds(
    baselineCoupons,
    currentCoupons,
  );
  if (
    newCouponIds.length === 1 &&
    currentCoupons.length === baselineCoupons.length + 1
  ) {
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

  if (newCouponIds.length > 0) {
    return markForReview(
      dependencies.store,
      key,
      record,
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
    record,
    "stale_reconciliation",
    safeIsoTimestamp(now),
  );
}

type RewardSelection =
  | { kind: "fixed" }
  | { kind: "drawn"; templateName: string }
  | { kind: "sold-out" };

/**
 * 决定这次完成该发什么。`drawn` 意味着库存**已经扣掉了**，调用方必须在后续失败时归还。
 *
 * 只有「库存表本身读不动」才算错误；「读得动，但一件不剩」是正常的业务终局，
 * 交给调用方走 unrewarded 终态。把这两件事分开是关键：一次连接抖动若被当成发完，
 * 顾客就白白丢了一件本来还有货的周边。
 */
async function selectReward(
  gifts: GiftPoolDependency | undefined,
): Promise<RewardSelection> {
  if (!gifts) {
    return { kind: "fixed" };
  }

  let draw: { templateName: string } | null;
  try {
    draw = await gifts.draw();
  } catch {
    throw new CompleteHbtiError(
      "STORE_UNAVAILABLE",
      "Completion service is temporarily unavailable.",
      true,
    );
  }

  return draw
    ? { kind: "drawn", templateName: draw.templateName }
    : { kind: "sold-out" };
}

/**
 * 归还一件抽中但没发出去的库存。
 *
 * 失败不抛出，因为调用方本来就在处理另一个错误；但返回 false，强制调用方把完成记录
 * 转成 durable review。归还失败可能是「UPDATE 已提交、响应断了」的结果未知，
 * 所以绝不能自动再减一次 issued_count：必须按本期 issued 完成数和 gift_stock 对账。
 */
async function releaseReward(
  gifts: GiftPoolDependency | undefined,
  templateName: string | null,
): Promise<boolean> {
  if (!gifts || !templateName) {
    return true;
  }
  try {
    await gifts.release(templateName);
    return true;
  } catch {
    return false;
  }
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

/**
 * 标记为需要人工处置。
 *
 * 参数收的是整条 `prepared` 记录而不是散装字段:review 必须带齐
 * attemptId / baselineCouponIds / rewardContext,而这三样只在 prepared 里有。
 * 让调用方自己挑字段传的话,漏传一个 tsc 也未必拦得住;收整条记录则由类型系统保证
 * 「能标 review 就一定有线索」。
 *
 * 这些线索是运营唯一的抓手:库存此刻已经扣掉、RES 那边可能已经发出券,
 * 没有 templateName 不知道该归还哪件,没有 memberId + 基线券 ID 不知道该查哪张券。
 */
async function markForReview(
  store: CompletionStore,
  key: CompletionStoreKey,
  prepared: Pick<
    PreparedCompletionRecord,
    "attemptId" | "completion" | "baselineCouponIds" | "rewardContext"
  >,
  reason: CompletionReviewReason,
  markedAt: string,
): Promise<CompleteHbtiResult> {
  const review: ReviewCompletionRecord = {
    status: "review",
    completion: prepared.completion,
    reason,
    markedAt,
    attemptId: prepared.attemptId,
    baselineCouponIds: prepared.baselineCouponIds,
    rewardContext: prepared.rewardContext,
    // 告警状态与 review 一起原子写进同一个 hbti_record；即时发送失败时 Cron 会重试。
    alert: { status: "pending" },
  };
  try {
    await store.markReview(key, prepared.attemptId, review);
  } catch {
    let current: CompletionRecord | null = null;
    try {
      current = await getCompletion(store, key);
    } catch {
      // 状态写入和确认读取都失败时，仍继续走独立 webhook 兜底。
    }
    if (current?.status === "review") {
      await deliverReviewAlert(store, key, current);
      return resultFromRecord(current);
    }
    if (current?.status === "issued") {
      return resultFromRecord(current);
    }
    // 状态没能落库时仍发一次 best-effort 告警；不能让数据库故障把唯一线索也吞掉。
    await sendAlert(reviewAlertPayload(review));
    throw new CompleteHbtiError(
      "STORE_UNAVAILABLE",
      "Completion service is temporarily unavailable.",
      true,
    );
  }

  await deliverReviewAlert(store, key, review);
  return resultFromRecord(review);
}

async function deliverReviewAlert(
  store: CompletionStore,
  key: CompletionStoreKey,
  review: ReviewCompletionRecord,
): Promise<void> {
  const outcome = await sendAlert(reviewAlertPayload(review));
  if (outcome !== "sent") {
    return;
  }
  if (!store.markReviewAlertSent) {
    return;
  }
  try {
    await store.markReviewAlertSent(
      key,
      review.attemptId,
      safeIsoTimestamp(() => new Date()),
    );
  } catch (error) {
    // webhook 已成功，只是 sent 标记失败：留 pending 让 Cron 至少重试一次，比漏报安全。
    console.error("HBTI review alert delivery marker failed", {
      attemptId: review.attemptId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * 把锁转成「完成但无券」终态。
 *
 * 用的是和 markIssued/markReview 同一条 CAS：仍要求本次 attempt 持有锁，
 * 所以并发的另一个请求不会把它覆盖掉。落库后 acquireProcessing 的闸门
 * （hbti_status IS NULL OR 已过期 OR 换了活动版本）就会挡住同一会员的第二次参与——
 * 他们不会因为「这次没抽到」而反复重试直到补货。
 */
async function markUnrewarded(
  store: CompletionStore,
  key: CompletionStoreKey,
  attemptId: string,
  completion: HbtiCompletionSnapshot,
  markedAt: string,
): Promise<CompleteHbtiResult> {
  const record: UnrewardedCompletionRecord = {
    status: "unrewarded",
    completion,
    markedAt,
  };
  try {
    await store.markUnrewarded(key, attemptId, record);
  } catch {
    const current = await getCompletion(store, key);
    if (current && current.status !== "processing") {
      return resultFromRecord(current);
    }
    throw new CompleteHbtiError(
      "STORE_UNAVAILABLE",
      "Completion service is temporarily unavailable.",
      true,
    );
  }
  return resultFromRecord(record);
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
    case "unrewarded":
      return {
        status: "unrewarded",
        ...record.completion,
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
