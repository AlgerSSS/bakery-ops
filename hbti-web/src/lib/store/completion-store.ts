import type {
  CategoryAnswer,
  HbtiAnswers,
  HbtiCode,
  VisitTimeAnswer,
} from "@/content/types";

export interface CompletionStoreKey {
  campaignVersion: string;
  /**
   * RES 的 customerId，同时也是 pos_member 的主键之一。
   *
   * 066 之前这里是 HMAC(手机号)。换成 member_id 有两个理由：完成记录收进了 pos_member，
   * 行本身就是会员；而且 HMAC(手机号) 有个洞——会员换号（RES 有 qryChangePhoneLog，
   * 说明这是真实场景）之后哈希就变了，同一期活动可以再领一次券。
   */
  memberId: string;
}

export interface HbtiCompletionSnapshot {
  code: HbtiCode;
  visitTime: VisitTimeAnswer;
  category: CategoryAnswer;
  color: string;
  gender?: string;
  age?: string;
}

export interface CompletionRewardReceipt {
  couponTemplateName: string;
  newCouponId: string;
  usableCouponCountBefore: number;
  usableCouponCountAfter: number;
  confirmedAt: string;
}

interface ProcessingCompletionBase {
  status: "processing";
  attemptId: string;
  startedAt: string;
  completion: HbtiCompletionSnapshot;
}

export interface LockedCompletionRecord extends ProcessingCompletionBase {
  phase: "locked";
}

export interface PreparedCompletionRecord extends ProcessingCompletionBase {
  phase: "prepared";
  preparedAt: string;
  lastReconciledAt?: string;
  baselineCouponIds: readonly string[];
  rewardContext: {
    memberId: string;
    templateId: string;
    templateName: string;
  };
}

export type ProcessingCompletionRecord =
  | LockedCompletionRecord
  | PreparedCompletionRecord;

export interface IssuedCompletionRecord {
  status: "issued";
  completion: HbtiCompletionSnapshot;
  reward: CompletionRewardReceipt;
}

export type CompletionReviewReason =
  | "ambiguous_give"
  | "give_rejected"
  | "readback_unavailable"
  | "readback_mismatch"
  | "stale_reconciliation"
  | "inventory_release_ambiguous";

export interface CompletionReviewAlert {
  status: "pending" | "delivering" | "sent";
  lastAttemptAt?: string;
}

/**
 * 需要人工处置的终态。
 *
 * `rewardContext` 与 `baselineCouponIds` 是**处置线索，不是冗余**：
 * 进入 review 时库存已经扣掉、RES 那边可能已经发出券，运营必须能回答两个问题——
 * 「该查哪张券」(memberId + 基线券 ID，用差集找出新增的那张)
 * 「该归还哪件库存」(templateName)。
 *
 * 早期版本这里只有 completion/reason/markedAt，而 `write()` 是整体替换 hbti_record，
 * 于是 prepared 阶段攒下的线索在标记 review 的那一刻全部消失，库存被永久占住且无从查起。
 *
 * **必填，不要改成可选。** 五个 markForReview 调用点全部在 prepared 建立之后
 * （初次路径有 prepared，对账路径有 record），信息一定拿得到；设成可选只会让
 * 同一个丢线索的 bug 重新变得合法。历史上写下的四字段行由
 * pg-completion-store 的 legacy 读取分支兼容，不靠弱化这里的写入类型。
 */
export interface ReviewCompletionRecord {
  status: "review";
  completion: HbtiCompletionSnapshot;
  reason: CompletionReviewReason;
  markedAt: string;
  attemptId: string;
  baselineCouponIds: readonly string[];
  rewardContext: {
    memberId: string;
    templateId: string;
    templateName: string;
  };
  alert: CompletionReviewAlert;
}

/**
 * 答完题了，但周边已经发完，没有券可发。
 *
 * 这是**成功的终态**，不是失败：顾客的面包人格照常出，只是柜台没有小礼物了。
 * 之所以不复用 `issued`——publicCompletionPayload 对 issued 会无保护地读
 * `reward.couponTemplateName`，一个没有 reward 的 issued 记录会让整条响应崩掉。
 *
 * ⚠ 新增终态时，pg-completion-store 里的 completionRecordSchema 必须同步加一支。
 * 那个 zod union 是出库时唯一的校验，而 get() 直接把 parse 结果断言成 CompletionRecord——
 * 只加 TS 分支、不加 zod 分支的话编译完全通过，线上才炸，而且因为保留期是 548 天，
 * 那个会员会永久 503，再也看不到自己的结果。
 */
export interface UnrewardedCompletionRecord {
  status: "unrewarded";
  completion: HbtiCompletionSnapshot;
  markedAt: string;
}

export type CompletionRecord =
  | ProcessingCompletionRecord
  | IssuedCompletionRecord
  | ReviewCompletionRecord
  | UnrewardedCompletionRecord;

export type CompletionAcquisition =
  | { acquired: true }
  | { acquired: false; record: CompletionRecord };

/**
 * Durable campaign/member idempotency boundary.
 *
 * `acquireProcessing` must implement an atomic create-if-absent operation.
 * `clearLocked` must remove only the pre-mutation locked phase; it must never
 * erase a concurrently transitioned prepared, issued or review record.
 */
export interface CompletionStore {
  get(key: CompletionStoreKey): Promise<CompletionRecord | null>;
  /**
   * `answers` 是 13 道题的原始作答，只写 fact_hbti_response，**绝不进 hbti_record**：
   * completionSnapshotSchema 是 z.strictObject，多一个字段会让该会员此后每一次读取
   * 都 parse 失败，而保留期是 548 天。
   * 设成可选是为了让内存假 store 不必实现它；代价是漏传时 tsc 不响，靠集成测试兜。
   */
  acquireProcessing(
    key: CompletionStoreKey,
    record: ProcessingCompletionRecord,
    answers?: Readonly<HbtiAnswers>,
  ): Promise<CompletionAcquisition>;
  markPrepared(
    key: CompletionStoreKey,
    attemptId: string,
    record: PreparedCompletionRecord,
  ): Promise<void>;
  markIssued(
    key: CompletionStoreKey,
    attemptId: string,
    record: IssuedCompletionRecord,
  ): Promise<void>;
  markReview(
    key: CompletionStoreKey,
    attemptId: string,
    record: ReviewCompletionRecord,
  ): Promise<void>;
  markReviewAlertSent?(
    key: CompletionStoreKey,
    attemptId: string,
    sentAt: string,
  ): Promise<void>;
  markUnrewarded(
    key: CompletionStoreKey,
    attemptId: string,
    record: UnrewardedCompletionRecord,
  ): Promise<void>;
  clearLocked(key: CompletionStoreKey, attemptId: string): Promise<boolean>;
}
