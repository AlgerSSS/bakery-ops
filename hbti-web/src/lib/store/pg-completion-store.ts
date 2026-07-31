import { z } from "zod";

import type { HbtiCode } from "@/content/types";
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

const completionRecordSchema = z.union([
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
  z.strictObject({
    status: z.literal("review"),
    completion: completionSnapshotSchema,
    reason: z.enum([
      "ambiguous_give",
      "give_rejected",
      "readback_unavailable",
      "readback_mismatch",
      "stale_reconciliation",
    ]),
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
    if (rows.length === 1) return { acquired: true };

    const existing = await this.get(key);
    if (existing === null) {
      throw new Error("Completion lock disappeared during acquisition.");
    }
    return { acquired: false, record: existing };
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
  // 健康检查要证明「这张表真的能读」，不是「进程还活着」。
  await getDb()`SELECT 1 FROM pos_member LIMIT 1`;
}

/** 有 expires_at 的表；顺序无关，逐张有界删除。 */
const EXPIRING = [
  { table: "hbti_auth_token", col: "expires_at" },
  { table: "hbti_rate_limit", col: "expires_at" },
] as const;

/**
 * PG 没有 TTL 索引，过期行要自己清。正确性不依赖它——所有读路径都带 expires_at 过滤——
 * 所以只做有界删除，由每日 Cron 顺带调用。
 *
 * pos_member 上过期的完成记录**不删行**，只把 hbti_ 状态清空：那是会员主表，
 * 行的存在与否由 res_api 决定，不该被 HBTI 的保留期左右。
 */
export async function purgeExpired(
  runner: SqlRunner = getDb(),
  limitPerTable = 1_000,
): Promise<number> {
  let removed = 0;
  for (const { table, col } of EXPIRING) {
    const res = await runner`
      DELETE FROM ${runner(table)} WHERE ctid IN (
        SELECT ctid FROM ${runner(table)} WHERE ${runner(col)} <= now() LIMIT ${limitPerTable}
      )
    `;
    removed += res.count;
  }
  const cleared = await runner`
    UPDATE pos_member SET
      hbti_status = NULL, hbti_attempt_id = NULL, hbti_record = NULL, hbti_expires_at = NULL
    WHERE hbti_expires_at IS NOT NULL AND hbti_expires_at <= now()
  `;
  return removed + cleared.count;
}
