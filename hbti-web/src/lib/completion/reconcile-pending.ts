import {
  reconcilePreparedCompletion,
  type CompleteHbtiResult,
} from "@/lib/completion/complete-hbti";
import type { ResCouponAdapter } from "@/lib/res/contracts";
import type {
  CompletionStore,
  CompletionStoreKey,
  PreparedCompletionRecord,
} from "@/lib/store/completion-store";

const ACTIVE_PREPARED_GRACE_MS = 15_000;
const MAX_RECONCILIATION_BATCH = 20;

interface PreparedCompletionSource extends CompletionStore {
  listPreparedBefore(
    preparedBefore: string,
    limit: number,
  ): Promise<
    Array<{
      key: CompletionStoreKey;
      record: PreparedCompletionRecord;
    }>
  >;
  touchPrepared(
    key: CompletionStoreKey,
    attemptId: string,
    reconciledAt: string,
  ): Promise<void>;
}

export interface ReconciliationSummary {
  scanned: number;
  issued: number;
  processing: number;
  review: number;
  errors: number;
}

export async function reconcilePendingCompletions({
  store,
  res,
  now = () => new Date(),
}: {
  store: PreparedCompletionSource;
  res: Pick<ResCouponAdapter, "listUsableMatchingCoupons">;
  now?: () => Date;
}): Promise<ReconciliationSummary> {
  const current = now();
  if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
    throw new Error("Invalid reconciliation clock.");
  }
  const preparedBefore = new Date(
    current.getTime() - ACTIVE_PREPARED_GRACE_MS,
  ).toISOString();
  const entries = await store.listPreparedBefore(
    preparedBefore,
    MAX_RECONCILIATION_BATCH,
  );
  const reconciledAt = current.toISOString();
  const outcomes = await Promise.all(
    entries.map(async ({ key, record }) => {
      let outcome: CompleteHbtiResult | null = null;
      try {
        outcome = await reconcilePreparedCompletion({
          key,
          record,
          dependencies: { store, res, now: () => current },
        });
      } catch {
        outcome = null;
      }
      if (outcome === null || outcome.status === "processing") {
        try {
          await store.touchPrepared(
            key,
            record.attemptId,
            reconciledAt,
          );
        } catch {
          return null;
        }
      }
      return outcome;
    }),
  );

  return summarize(outcomes);
}

function summarize(
  outcomes: Array<CompleteHbtiResult | null>,
): ReconciliationSummary {
  const summary: ReconciliationSummary = {
    scanned: outcomes.length,
    issued: 0,
    processing: 0,
    review: 0,
    errors: 0,
  };
  for (const outcome of outcomes) {
    if (outcome === null) {
      summary.errors += 1;
    } else if (outcome.status === "unrewarded") {
      // 对账只扫 prepared 记录，而 unrewarded 早在 markPrepared 之前就定下了，
      // 到不了这里。真出现就是状态机有问题——记成 error 让 cron 报 503。
      // 原来的 summary[status] += 1 遇到未知状态会算出 NaN，序列化成 null 悄悄咽掉。
      summary.errors += 1;
    } else {
      summary[outcome.status] += 1;
    }
  }
  return summary;
}
