import { z } from "zod";

import { reviewAlertPayload, sendAlert } from "@/lib/alert";

import type { HbtiAnswers, HbtiCode } from "@/content/types";
import { getDb, memberStore, type SqlRunner } from "@/lib/db/postgres";
import type {
  CompletionAcquisition,
  CompletionRecord,
  CompletionStore,
  CompletionStoreKey,
  IssuedCompletionRecord,
  PreparedCompletionRecord,
  ProcessingCompletionRecord,
  ReviewCompletionRecord,
  UnrewardedCompletionRecord,
} from "@/lib/store/completion-store";

/**
 * HBTI 的完成记录**就存在会员主表 pos_member 上**（迁移 066）。
 *
 * 063 当初把它拆成独立的 hbti_completion，理由是「幂等锁是操作状态，不是会员信息」。
 * 那是实现细节压过了数据模型：一行一个会员一期活动，这本来就是会员数据。
 * 锁怎么实现，不该决定这条业务事实存在哪张表。
 *
 * 键因此从 HMAC(手机号) 换成 member_id ——行本身就是会员，同时补掉一个洞：
 * 会员换号之后哈希会变，同一期活动可以再领一次券（RES 有 qryChangePhoneLog，这不是假想）。
 *
 * 原子性靠单行的条件 UPDATE：
 *   | Mongo                        | 现在                                        |
 *   |------------------------------|---------------------------------------------|
 *   | insertOne 撞 11000            | INSERT ... ON CONFLICT DO UPDATE WHERE 无返回行 |
 *   | replaceOne 的 matchedCount    | UPDATE ... WHERE <CAS 判词> 的 count          |
 *   | TTL 索引自动删除               | 读路径带 hbti_expires_at > now()              |
 *
 * ⚠ 这张表的另一个写者是 ~/hot/res_api 的每晚会员同步。两边靠**列集不相交**共存：
 * 它写 mapMember() 的 26 列，这里只碰 hbti_ 开头的列。改任何一边前先看两个仓库的 AGENTS.md。
 */

const hbtiCodeSchema = z
  .string()
  .regex(/^[IH][LS][BD][AT]$/) as z.ZodType<HbtiCode>;

const completionSnapshotSchema = z.strictObject({
  code: hbtiCodeSchema,
  visitTime: z.enum(["morning", "night"]),
  category: z.enum(["drink", "dessert", "bakery"]),
  color: z.string().trim().min(1).max(32),
  gender: z.string().trim().min(1).max(32).optional(),
  age: z.string().trim().min(1).max(32).optional(),
});

const reviewReasonSchema = z.enum([
  "ambiguous_give",
  "give_rejected",
  "readback_unavailable",
  "readback_mismatch",
  "stale_reconciliation",
  "inventory_release_ambiguous",
]);

const reviewAlertSchema = z.strictObject({
  status: z.enum(["pending", "delivering", "sent"]),
  lastAttemptAt: z.string().min(1).optional(),
});

/**
 * 历史 review 行缺失处置线索时的填充值。
 *
 * 用可辨认的哨兵而不是空字符串:运营看到 `legacy-unknown` 会知道
 * 「这条是老记录,线索当初就没存」,看到空值则会以为是抽奖没发生。
 * UUID 哨兵是全零,格式上仍满足 attemptId 的 uuid 约束。
 */
const LEGACY_REVIEW_UNKNOWN = "legacy-unknown";
const LEGACY_REVIEW_SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * 出库时唯一的校验。导出是为了让 completion-record-schema.test.ts 能逐个状态验往返——
 * 少一支分支的话 tsc 是不会响的（get() 把 parse 的结果直接当成 CompletionRecord 返回，
 * 更窄的联合类型照样可赋值），只有那个测试会响。
 */
export const completionRecordSchema = z.union([
  z.strictObject({
    status: z.literal("processing"),
    phase: z.literal("locked"),
    attemptId: z.string().uuid(),
    startedAt: z.string().min(1),
    completion: completionSnapshotSchema,
  }),
  z.strictObject({
    status: z.literal("processing"),
    phase: z.literal("prepared"),
    attemptId: z.string().uuid(),
    startedAt: z.string().min(1),
    preparedAt: z.string().min(1),
    lastReconciledAt: z.string().min(1).optional(),
    completion: completionSnapshotSchema,
    baselineCouponIds: z.array(z.string().min(1)).readonly(),
    rewardContext: z.strictObject({
      memberId: z.string().min(1),
      templateId: z.string().min(1),
      templateName: z.string().min(1),
    }),
  }),
  z.strictObject({
    status: z.literal("issued"),
    completion: completionSnapshotSchema,
    reward: z.strictObject({
      couponTemplateName: z.string().min(1),
      newCouponId: z.string().min(1),
      usableCouponCountBefore: z.number().int().min(0),
      usableCouponCountAfter: z.number().int().min(0),
      confirmedAt: z.string().min(1),
    }),
  }),
  // review 的当前形态：处置线索与可重试告警状态都必填。
  z.strictObject({
    status: z.literal("review"),
    completion: completionSnapshotSchema,
    reason: reviewReasonSchema,
    markedAt: z.string().min(1),
    attemptId: z.string().uuid(),
    baselineCouponIds: z.array(z.string().min(1)).readonly(),
    rewardContext: z.strictObject({
      memberId: z.string().min(1),
      templateId: z.string().min(1),
      templateName: z.string().min(1),
    }),
    alert: reviewAlertSchema,
  }),
  // 处置线索修复后、持久告警加入前写下的 review：线索完整，但没有 alert。
  z
    .strictObject({
      status: z.literal("review"),
      completion: completionSnapshotSchema,
      reason: reviewReasonSchema,
      markedAt: z.string().min(1),
      attemptId: z.string().uuid(),
      baselineCouponIds: z.array(z.string().min(1)).readonly(),
      rewardContext: z.strictObject({
        memberId: z.string().min(1),
        templateId: z.string().min(1),
        templateName: z.string().min(1),
      }),
    })
    .transform((legacy) => ({
      ...legacy,
      alert: { status: "pending" as const },
    })),
  // 最早的四字段 review：同时补处置线索哨兵与待发送告警。
  z
    .strictObject({
      status: z.literal("review"),
      completion: completionSnapshotSchema,
      reason: reviewReasonSchema,
      markedAt: z.string().min(1),
    })
    .transform((legacy) => ({
      ...legacy,
      attemptId: LEGACY_REVIEW_SENTINEL_UUID,
      baselineCouponIds: [] as readonly string[],
      rewardContext: {
        memberId: LEGACY_REVIEW_UNKNOWN,
        templateId: LEGACY_REVIEW_UNKNOWN,
        templateName: LEGACY_REVIEW_UNKNOWN,
      },
      alert: { status: "pending" as const },
    })),
  z.strictObject({
    status: z.literal("unrewarded"),
    completion: completionSnapshotSchema,
    markedAt: z.string().min(1),
  }),
]);

/** 应用侧保留期，与 Mongo 时期的 TTL 一致。 */
const RETENTION_MS = 548 * 24 * 60 * 60 * 1_000;

export interface PreparedCompletionEntry {
  key: CompletionStoreKey;
  record: PreparedCompletionRecord;
}

function assertKey(key: CompletionStoreKey): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(key.campaignVersion) ||
    !/^[0-9]{1,32}$/.test(key.memberId)
  ) {
    throw new Error("Invalid completion-store key.");
  }
}

/**
 * `CompletionRecord` 是判别联合，没有索引签名，不满足 postgres.js 的 `JSONValue`
 * 结构约束——但每一支都是纯 JSON（Zod strictObject 已排除函数与不可序列化值）。
 * 断言只绕类型形状，不放松运行时校验：读回来仍由 completionRecordSchema 全量解析。
 */
function jsonRecord(sql: SqlRunner, record: CompletionRecord) {
  return sql.json(record as unknown as Parameters<SqlRunner["json"]>[0]);
}

/** 画像列：答完题就该有，与发券成不成功无关。 */
function profileOf(record: CompletionRecord) {
  const c = record.completion;
  return {
    code: c.code,
    visitTime: c.visitTime,
    category: c.category,
    color: c.color,
    gender: c.gender ?? null,
    age: c.age ?? null,
  };
}

export class PgCompletionStore implements CompletionStore {
  constructor(private readonly sql: SqlRunner) {}


  async get(key: CompletionStoreKey): Promise<CompletionRecord | null> {
    assertKey(key);
    const rows = await this.sql<{ hbti_record: unknown }[]>`
      SELECT hbti_record FROM pos_member
      WHERE store = ${memberStore()} AND member_id = ${key.memberId}
        AND hbti_status IS NOT NULL
        AND hbti_campaign_version = ${key.campaignVersion}
        AND hbti_expires_at > now()
    `;
    if (rows.length === 0) return null;
    return completionRecordSchema.parse(rows[0].hbti_record);
  }

  async acquireProcessing(
    key: CompletionStoreKey,
    record: ProcessingCompletionRecord,
    answers?: Readonly<HbtiAnswers>,
  ): Promise<CompletionAcquisition> {
    assertKey(key);
    const p = profileOf(record);
    // 会员行可能还不存在（OTP 当场注册、爬虫今晚才会抓到），所以是 INSERT-or-lock。
    // WHERE 判词就是「锁是空的」：没做过、已过期、或那是上一期活动的记录。
    // 抢不到锁时 WHERE 不成立、不返回行——等价于 Mongo 的 insertOne 撞 11000。
    const rows = await this.sql`
      INSERT INTO pos_member AS m (
        member_id, store,
        hbti_status, hbti_attempt_id, hbti_record, hbti_expires_at,
        hbti_campaign_version, hbti_code, hbti_visit_time, hbti_category,
        hbti_color, hbti_gender, hbti_age, hbti_completed_at
      ) VALUES (
        ${key.memberId}, ${memberStore()},
        ${record.status}, ${record.attemptId}, ${jsonRecord(this.sql, record)},
        ${new Date(Date.now() + RETENTION_MS)},
        ${key.campaignVersion}, ${p.code}, ${p.visitTime}, ${p.category},
        ${p.color}, ${p.gender}, ${p.age}, now()
      )
      ON CONFLICT ON CONSTRAINT uk_pos_member_store_member DO UPDATE SET
        hbti_status           = EXCLUDED.hbti_status,
        hbti_attempt_id       = EXCLUDED.hbti_attempt_id,
        hbti_record           = EXCLUDED.hbti_record,
        hbti_expires_at       = EXCLUDED.hbti_expires_at,
        hbti_campaign_version = EXCLUDED.hbti_campaign_version,
        hbti_code             = EXCLUDED.hbti_code,
        hbti_visit_time       = EXCLUDED.hbti_visit_time,
        hbti_category         = EXCLUDED.hbti_category,
        hbti_color            = EXCLUDED.hbti_color,
        hbti_gender           = EXCLUDED.hbti_gender,
        hbti_age              = EXCLUDED.hbti_age,
        hbti_completed_at     = EXCLUDED.hbti_completed_at
      WHERE m.hbti_status IS NULL
         OR m.hbti_expires_at <= now()
         OR m.hbti_campaign_version IS DISTINCT FROM ${key.campaignVersion}
      RETURNING 1 AS acquired
    `;
    if (rows.length === 1) {
      // 抢到锁 = 本期第一次。题目级答案与 hbti_completed_at 同一时刻落库。
      await this.recordAnswers(key, record, answers);
      return { acquired: true };
    }

    const existing = await this.get(key);
    if (existing === null) {
      throw new Error("Completion lock disappeared during acquisition.");
    }
    return { acquired: false, record: existing };
  }

  /**
   * 题目级答案落库。只在抢锁成功那一刻写一次。
   *
   * 刻意不与抢锁合成一条 CTE：合成后本表的任何故障（迁移没上、约束撞、盘满）
   * 都会回滚抢锁，把「答案存不下」升级成「券发不出」。postgres.js 无显式 begin 时
   * 每条语句自成事务，所以抢锁先提交、答案后写，失败方向是安全的（丢答案不丢券）。
   *
   * 幂等：抢锁成功本身就是「本期第一次」的证明。剩余重复只来自 clearLocked 之后的重试
   * （stale locked 90 秒），用 1 小时窗口 + answers 相等的 NOT EXISTS 挡掉——
   * 顾客改了答案再来照样记新行。
   *
   * 与 CAS 的关系：本方法不读也不写 hbti_status / hbti_attempt_id / hbti_record，
   * 所以 markPrepared / markIssued / markReview / markUnrewarded 的
   * `WHERE hbti_attempt_id = $1` 判词完全不受影响。
   */
  private async recordAnswers(
    key: CompletionStoreKey,
    record: ProcessingCompletionRecord,
    answers: Readonly<HbtiAnswers> | undefined,
  ): Promise<void> {
    if (!answers) return;
    const p = profileOf(record);
    const store = memberStore();
    const json = this.sql.json(
      answers as unknown as Parameters<SqlRunner["json"]>[0],
    );
    try {
      await this.sql`
        INSERT INTO fact_hbti_response (
          store, member_id, campaign_version, answered_at, attempt_id,
          answers, hbti_code, visit_time, category, color, gender, age
        )
        SELECT ${store}, ${key.memberId}, ${key.campaignVersion}, clock_timestamp(),
               ${record.attemptId}, ${json}, ${p.code}, ${p.visitTime},
               ${p.category}, ${p.color}, ${p.gender}, ${p.age}
        WHERE NOT EXISTS (
          SELECT 1 FROM fact_hbti_response f
           WHERE f.store = ${store}
             AND f.member_id = ${key.memberId}
             AND f.campaign_version = ${key.campaignVersion}
             AND f.answered_at > clock_timestamp() - interval '1 hour'
             AND f.answers = ${json}
        )
      `;
    } catch (error) {
      // 只告警，不抛。抛出去会被 acquireCompletion 的 catch 转成 STORE_UNAVAILABLE(503)，
      // 顾客答完 13 题却拿不到券——代价不对等。
      // 代价：迁移 300 没上线时这里静默失败，所以 checkCompletionStoreFromEnv 必须探活这张表。
      console.error("[HBTI answers] persist failed", {
        memberId: key.memberId,
        campaignVersion: key.campaignVersion,
        attemptId: record.attemptId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  async markPrepared(
    key: CompletionStoreKey,
    attemptId: string,
    record: PreparedCompletionRecord,
  ): Promise<void> {
    assertKey(key);
    const updated = await this.write(this.sql, key, attemptId, record, "locked");
    if (updated !== 1) throw new Error("Completion lock ownership changed.");
  }

  async markIssued(
    key: CompletionStoreKey,
    attemptId: string,
    record: IssuedCompletionRecord,
  ): Promise<void> {
    assertKey(key);
    const updated = await this.write(this.sql, key, attemptId, record, null);
    if (updated !== 1) throw new Error("Completion was not in the processing state.");
  }

  async markReview(
    key: CompletionStoreKey,
    attemptId: string,
    record: ReviewCompletionRecord,
  ): Promise<void> {
    assertKey(key);
    const updated = await this.write(this.sql, key, attemptId, record, null);
    if (updated !== 1) throw new Error("Completion was not in the processing state.");
  }

  async markReviewAlertSent(
    key: CompletionStoreKey,
    attemptId: string,
    sentAt: string,
  ): Promise<void> {
    assertKey(key);
    if (!Number.isFinite(Date.parse(sentAt))) {
      throw new Error("Invalid review alert timestamp.");
    }
    const updated = await this.sql`
      UPDATE pos_member
      SET hbti_record = jsonb_set(
        hbti_record,
        '{alert}',
        jsonb_build_object('status', 'sent', 'lastAttemptAt', ${sentAt}::text),
        true
      )
      WHERE store = ${memberStore()} AND member_id = ${key.memberId}
        AND hbti_campaign_version = ${key.campaignVersion}
        AND hbti_status = 'review'
        AND hbti_record->>'attemptId' = ${attemptId}
    `;
    if (updated.count !== 1) {
      throw new Error("Review alert record no longer exists.");
    }
  }

  async markUnrewarded(
    key: CompletionStoreKey,
    attemptId: string,
    record: UnrewardedCompletionRecord,
  ): Promise<void> {
    assertKey(key);
    const updated = await this.write(this.sql, key, attemptId, record, null);
    if (updated !== 1) throw new Error("Completion was not in the processing state.");
  }

  async clearLocked(key: CompletionStoreKey, attemptId: string): Promise<boolean> {
    assertKey(key);
    // 只清锁，**不删会员行，也不擦画像**——顾客答过题是既成事实，
    // 发券前的失败不该把它抹掉（这也是它长在会员表上之后必须想清楚的一点）。
    const res = await this.sql`
      UPDATE pos_member SET
        hbti_status = NULL, hbti_attempt_id = NULL,
        hbti_record = NULL, hbti_expires_at = NULL
      WHERE store = ${memberStore()} AND member_id = ${key.memberId}
        AND hbti_campaign_version = ${key.campaignVersion}
        AND hbti_status = 'processing'
        AND hbti_record->>'phase' = 'locked'
        AND hbti_attempt_id = ${attemptId}
    `;
    return res.count === 1;
  }

  async listPreparedBefore(
    preparedBefore: string,
    limit: number,
  ): Promise<PreparedCompletionEntry[]> {
    if (
      !Number.isFinite(Date.parse(preparedBefore)) ||
      !Number.isInteger(limit) || limit < 1 || limit > 50
    ) {
      throw new Error("Invalid prepared-completion query.");
    }
    // NULLS FIRST 不是风格：Mongo 的 sort 把缺失字段排最前，PG 默认 NULLS LAST 会让
    // 从未对过账的记录永远沉在队尾、轮不到补偿。
    const rows = await this.sql<
      { member_id: string; hbti_campaign_version: string; hbti_record: unknown }[]
    >`
      SELECT member_id, hbti_campaign_version, hbti_record
      FROM pos_member
      WHERE hbti_status = 'processing'
        AND hbti_record->>'phase' = 'prepared'
        AND hbti_record->>'preparedAt' <= ${preparedBefore}
        AND hbti_expires_at > now()
      ORDER BY hbti_record->>'lastReconciledAt' ASC NULLS FIRST,
               hbti_record->>'preparedAt' ASC
      LIMIT ${limit}
    `;
    return rows.map((row) => {
      const record = completionRecordSchema.parse(row.hbti_record);
      if (record.status !== "processing" || record.phase !== "prepared") {
        throw new Error("Prepared completion query returned another state.");
      }
      return {
        key: { campaignVersion: row.hbti_campaign_version, memberId: row.member_id },
        record,
      };
    });
  }

  async touchPrepared(
    key: CompletionStoreKey,
    attemptId: string,
    reconciledAt: string,
  ): Promise<void> {
    assertKey(key);
    if (!Number.isFinite(Date.parse(reconciledAt))) {
      throw new Error("Invalid prepared reconciliation timestamp.");
    }
    await this.sql`
      UPDATE pos_member SET
        hbti_record = jsonb_set(hbti_record, '{lastReconciledAt}', ${this.sql.json(reconciledAt)})
      WHERE store = ${memberStore()} AND member_id = ${key.memberId}
        AND hbti_campaign_version = ${key.campaignVersion}
        AND hbti_status = 'processing'
        AND hbti_record->>'phase' = 'prepared'
        AND hbti_attempt_id = ${attemptId}
    `;
  }

  /** 所有状态转移共用的 CAS。requiredPhase 为 null 表示只要求仍在 processing。 */
  private async write(
    sql: SqlRunner,
    key: CompletionStoreKey,
    attemptId: string,
    record: CompletionRecord,
    requiredPhase: "locked" | null,
  ): Promise<number> {
    const p = profileOf(record);
    const processing = record.status === "processing";
    const res = await sql`
      UPDATE pos_member SET
        hbti_status       = ${record.status},
        hbti_attempt_id   = ${processing ? attemptId : null},
        hbti_record       = ${jsonRecord(sql, record)},
        hbti_expires_at   = ${new Date(Date.now() + RETENTION_MS)},
        hbti_code         = ${p.code},
        hbti_visit_time   = ${p.visitTime},
        hbti_category     = ${p.category},
        hbti_color        = ${p.color},
        hbti_gender       = ${p.gender},
        hbti_age          = ${p.age}
      WHERE store = ${memberStore()} AND member_id = ${key.memberId}
        AND hbti_campaign_version = ${key.campaignVersion}
        AND hbti_status = 'processing'
        AND hbti_attempt_id = ${attemptId}
        AND hbti_expires_at > now()
        ${requiredPhase === null ? sql`` : sql`AND hbti_record->>'phase' = ${requiredPhase}`}
    `;
    return res.count;
  }
}

export async function createCompletionStoreFromEnv(): Promise<PgCompletionStore> {
  return new PgCompletionStore(getDb());
}

export async function checkCompletionStoreFromEnv(): Promise<void> {
  // 健康检查要证明「这两张表真的能读」，不是「进程还活着」。
  // fact_hbti_response 必须在列：recordAnswers 是 catch-and-log，
  // 迁移 300 没上线时它一声不响地丢答案，只有这里能把它变成 /api/health 503。
  await getDb()`SELECT 1 FROM pos_member LIMIT 1`;
  await getDb()`SELECT 1 FROM fact_hbti_response LIMIT 1`;
}

/**
 * 重试没有成功送达的 review 告警。
 *
 * 告警状态和 review 同在 hbti_record 里，所以终态落库即拥有一个 pending 告警，
 * 不存在「状态写成了、进程却在 enqueue 前被杀」的窗口。claim 用单条 UPDATE +
 * SKIP LOCKED；函数在发送后、标 sent 前被杀时，十分钟后可重新认领，语义是 at-least-once。
 */
export async function deliverPendingReviewAlerts(
  runner: SqlRunner = getDb(),
  limit = 20,
): Promise<{ claimed: number; sent: number }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Invalid review alert limit.");
  }

  const rows = await runner`
    WITH candidates AS (
      SELECT ctid
      FROM pos_member
      WHERE store = ${memberStore()}
        AND hbti_status = 'review'
        AND (
          COALESCE(hbti_record #>> '{alert,status}', 'pending') = 'pending'
          OR (
            hbti_record #>> '{alert,status}' = 'delivering'
            AND COALESCE(
              (hbti_record #>> '{alert,lastAttemptAt}')::timestamptz,
              '-infinity'::timestamptz
            ) <= now() - interval '10 minutes'
          )
        )
      ORDER BY hbti_completed_at NULLS FIRST
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE pos_member AS member
    SET hbti_record = jsonb_set(
      CASE
        WHEN member.hbti_record ? 'attemptId' THEN member.hbti_record
        ELSE member.hbti_record || jsonb_build_object(
          'attemptId', ${LEGACY_REVIEW_SENTINEL_UUID}::text,
          'baselineCouponIds', jsonb_build_array(),
          'rewardContext', jsonb_build_object(
            'memberId', member.member_id,
            'templateId', ${LEGACY_REVIEW_UNKNOWN}::text,
            'templateName', ${LEGACY_REVIEW_UNKNOWN}::text
          )
        )
      END,
      '{alert}',
      jsonb_build_object('status', 'delivering', 'lastAttemptAt', now()::text),
      true
    )
    FROM candidates
    WHERE member.ctid = candidates.ctid
    RETURNING
      member.member_id,
      member.hbti_campaign_version,
      member.hbti_record
  `;

  const outcomes = await Promise.allSettled(
    rows.map(async (row) => {
      const parsed = completionRecordSchema.parse(row.hbti_record);
      if (parsed.status !== "review") {
        throw new Error("Claimed alert is not a review record.");
      }
      const attemptId = parsed.attemptId;
      const record: ReviewCompletionRecord = parsed;
      const outcome = await sendAlert(reviewAlertPayload(record));
      const nextStatus = outcome === "sent" ? "sent" : "pending";
      const finalRecord: ReviewCompletionRecord = {
        ...record,
        alert: {
          status: nextStatus,
          lastAttemptAt: new Date().toISOString(),
        },
      };
      const updated = await runner<{ hbti_record: unknown }[]>`
        UPDATE pos_member
        SET hbti_record = ${jsonRecord(runner, finalRecord)}
        WHERE store = ${memberStore()}
          AND member_id = ${String(row.member_id)}
          AND hbti_campaign_version = ${String(row.hbti_campaign_version)}
          AND hbti_status = 'review'
          AND hbti_record->>'attemptId' = ${attemptId}
          AND hbti_record #>> '{alert,status}' = 'delivering'
        RETURNING hbti_record
      `;
      if (updated.length !== 1) {
        console.error("[HBTI review alert] claim changed before outcome persisted", {
          memberId: String(row.member_id),
          attemptId,
        });
        return false;
      }

      const persisted = completionRecordSchema.parse(updated[0].hbti_record);
      if (
        persisted.status !== "review" ||
        persisted.alert.status !== nextStatus
      ) {
        throw new Error(
          `Review alert outcome was not persisted: expected ${nextStatus}.`,
        );
      }
      return outcome === "sent";
    }),
  );

  const failed = outcomes.find(
    (outcome): outcome is PromiseRejectedResult =>
      outcome.status === "rejected",
  );
  if (failed) {
    throw failed.reason;
  }
  return {
    claimed: rows.length,
    sent: outcomes.filter(
      (outcome) => outcome.status === "fulfilled" && outcome.value,
    ).length,
  };
}

/**
 * 有 expires_at 的表；顺序无关，逐张有界删除。
 *
 * ⚠️ fact_hbti_response 不在此列，也永远不要加进来：它是永久事实不是带 TTL 的操作行，
 * 而且它没有 expires_at 列，加进来会直接 42703。
 */
const EXPIRING = [
  { table: "hbti_auth_token", col: "expires_at" },
  { table: "hbti_rate_limit", col: "expires_at" },
] as const;

/**
 * PG 没有 TTL 索引，过期行要自己清。正确性不依赖它——所有读路径都带 expires_at 过滤——
 * 所以清理只求「跟得上」，不求「一次清干净」。
 *
 * pos_member 上过期的完成记录**不删行**，只把 hbti_ 状态清空：那是会员主表，
 * 行的存在与否由 res_api 决定，不该被 HBTI 的保留期左右。
 *
 * ── 为什么从「每表固定 1000 行」改成「按时间预算循环」 ──
 * 一次 OTP 请求产生 4 个限流桶 + 1 个 challenge = 5 行，而 Cron 每天只跑一次。
 * 固定 1000 行/表意味着日均只撑得住约 200 次 OTP，超过就单调积压——
 * 表和索引一起长大，而读路径的 expires_at 过滤要扫的死行越来越多。
 * 实测(2026-08-03)两张表 100% 的行都已过期却仍留在库里，说明这个上限当时就已经不够。
 *
 * 每轮每个来源只处理一批，避免第一张表用完整个预算、让后两处永久饥饿。
 * 每条查询还会在剩余预算耗尽时主动 cancel；`SKIP LOCKED` 避免等住 res_api 正在写的会员行。
 *
 * pos_member 的清空同样要有界。它原来是一条无 LIMIT 的 UPDATE：
 * 活动结束后大批记录同时到期时，一次 Cron 就会扫全表、锁住大量会员行，
 * 而这张表 res_api 也在写。
 */
const PURGE_BATCH = 1_000;
const PURGE_BUDGET_MS = 10_000;

async function runPurgeQuery<T>(
  query: PromiseLike<T> & { cancel(): void },
  deadline: number,
): Promise<T> {
  const timer = setTimeout(
    () => query.cancel(),
    Math.max(1, deadline - Date.now()),
  );
  try {
    return await query;
  } finally {
    clearTimeout(timer);
  }
}

export async function purgeExpired(
  runner: SqlRunner = getDb(),
  budgetMs = PURGE_BUDGET_MS,
): Promise<number> {
  const deadline = Date.now() + budgetMs;
  const sources = [
    ...EXPIRING.map((source) => ({ kind: "delete" as const, ...source })),
    { kind: "member" as const },
  ].map((source) => ({ ...source, active: true }));
  let activeSources = sources.length;
  let removed = 0;

  // Round-robin：每轮每个仍有积压的来源各拿一批，谁也不能独占每日预算。
  while (activeSources > 0 && Date.now() < deadline) {
    for (const source of sources) {
      if (!source.active || Date.now() >= deadline) {
        continue;
      }

      const result =
        source.kind === "delete"
          ? await runPurgeQuery(
              runner`
                DELETE FROM ${runner(source.table)} WHERE ctid IN (
                  SELECT ctid FROM ${runner(source.table)}
                   WHERE ${runner(source.col)} <= now()
                   LIMIT ${PURGE_BATCH}
                   FOR UPDATE SKIP LOCKED
                )
              `,
              deadline,
            )
          : await runPurgeQuery(
              runner`
                UPDATE pos_member SET
                  hbti_status = NULL, hbti_attempt_id = NULL,
                  hbti_record = NULL, hbti_expires_at = NULL
                WHERE ctid IN (
                  SELECT ctid FROM pos_member
                   WHERE hbti_expires_at IS NOT NULL AND hbti_expires_at <= now()
                   LIMIT ${PURGE_BATCH}
                   FOR UPDATE SKIP LOCKED
                )
              `,
              deadline,
            );

      removed += result.count;
      if (result.count < PURGE_BATCH) {
        source.active = false;
        activeSources -= 1;
      }
    }
  }

  return removed;
}
