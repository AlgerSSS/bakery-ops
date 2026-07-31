import type {
  CategoryAnswer,
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
  | "stale_reconciliation";

export interface ReviewCompletionRecord {
  status: "review";
  completion: HbtiCompletionSnapshot;
  reason: CompletionReviewReason;
  markedAt: string;
}

export type CompletionRecord =
  | ProcessingCompletionRecord
  | IssuedCompletionRecord
  | ReviewCompletionRecord;

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
  acquireProcessing(
    key: CompletionStoreKey,
    record: ProcessingCompletionRecord,
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
  clearLocked(key: CompletionStoreKey, attemptId: string): Promise<boolean>;
}
