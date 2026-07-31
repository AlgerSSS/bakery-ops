import type postgres from "postgres";
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
 * 幂等记录存在 `hbti_completion`（迁移 063）。
 *
 * 判别联合整体存进 `record` jsonb，读出后仍由下面这份 Zod 校验——与 Mongo 时期同一份契约，
 * 所以状态机语义零漂移。只有 CAS 判词和对账扫描真正用到的字段被提升成列。
 *
 * Mongo 语义到 PostgreSQL 的对应关系（每一条都是刻意的，不是顺手写的）：
 *
 * | Mongo                                   | PostgreSQL                                    |
 * |-----------------------------------------|-----------------------------------------------|
 * | `insertOne` 撞 11000                     | `INSERT ... ON CONFLICT` 未返回行               |
 * | `replaceOne(filter).matchedCount === 1` | `UPDATE ... WHERE <判词>` 的 `count === 1`      |
 * | `deleteOne(filter).deletedCount === 1`  | `DELETE ... WHERE <判词>` 的 `count === 1`      |
 * | TTL 索引到期自动删除                       | 读路径一律带 `expires_at > now()`                |
 *
 * 最后一条是唯一一处「PG 没有等价物、必须自己补」的地方：Mongo 的 TTL 索引会把过期锁删掉，
 * 于是下一次 acquire 能重新拿到。PG 不会，所以过期行必须在读时当作不存在、在 acquire 时可被顶替，
 * 否则一条 548 天前的锁会永久挡住这个会员。
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

interface CompletionRow {
  record: unknown;
}

/**
 * `CompletionRecord` 是判别联合，没有索引签名，所以不满足 postgres.js 的 `JSONValue`
 * 结构约束——但它每一支都是纯 JSON 数据（Zod 的 strictObject 已经排除了函数与不可序列化值）。
 * 这个断言只绕开类型形状，不放松任何运行时校验：读回来时仍由 completionRecordSchema 全量解析。
 */
function jsonRecord(
  sql: SqlRunner,
  record: CompletionRecord,
) {
  return sql.json(record as unknown as postgres.JSONValue);
}

function assertKey(key: CompletionStoreKey): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(key.campaignVersion) ||
    !/^[a-f0-9]{64}$/.test(key.memberHash)
  ) {
    throw new Error("Invalid completion-store key.");
  }
}

/**
 * 提升列必须与 record 一致，否则 CAS 判词会对着一份过期投影做决策。
 * member_id 在加锁那一刻通常还拿不到——`completeHbti` 先加锁再 `resolveMemberByPhone`——
 * 所以这里只在 prepared 之后才有值，写入时用 COALESCE 保证不会被后续状态清回 NULL。
 */
function projection(record: CompletionRecord) {
  const processing = record.status === "processing" ? record : null;
  const prepared =
    processing?.phase === "prepared" ? processing : null;
  return {
    status: record.status,
    phase: processing?.phase ?? null,
    attempt_id: processing?.attemptId ?? null,
    prepared_at: prepared?.preparedAt ?? null,
    last_reconciled_at: prepared?.lastReconciledAt ?? null,
    member_id: prepared?.rewardContext.memberId ?? null,
  };
}

export class PgCompletionStore implements CompletionStore {
  constructor(private readonly sql: SqlRunner) {}

  private atomically<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
    const sql = this.sql;
    return "begin" in sql
      ? (sql.begin((tx) => fn(tx)) as Promise<T>)
      : (sql.savepoint((tx) => fn(tx)) as Promise<T>);
  }

  async get(key: CompletionStoreKey): Promise<CompletionRecord | null> {
    assertKey(key);
    const rows = await this.sql<CompletionRow[]>`
      SELECT record FROM hbti_completion
      WHERE campaign_version = ${key.campaignVersion}
        AND member_hash = ${key.memberHash}
        AND expires_at > now()
    `;
    if (rows.length === 0) {
      return null;
    }
    return completionRecordSchema.parse(rows[0].record);
  }

  async acquireProcessing(
    key: CompletionStoreKey,
    record: ProcessingCompletionRecord,
  ): Promise<CompletionAcquisition> {
    assertKey(key);
    const fields = projection(record);
    // `DO UPDATE ... WHERE expires_at <= now()` 是 Mongo TTL 删除后重新 insert 的等价物：
    // 活锁撞上时 WHERE 不成立、不返回行；过期锁则被原子顶替。
    const rows = await this.sql`
      INSERT INTO hbti_completion (
        campaign_version, member_hash, member_id, status, phase, attempt_id,
        prepared_at, last_reconciled_at, record, expires_at
      ) VALUES (
        ${key.campaignVersion}, ${key.memberHash}, ${fields.member_id},
        ${fields.status}, ${fields.phase}, ${fields.attempt_id},
        ${fields.prepared_at}, ${fields.last_reconciled_at},
        ${jsonRecord(this.sql, record)}, ${new Date(Date.now() + RETENTION_MS)}
      )
      ON CONFLICT (campaign_version, member_hash) DO UPDATE SET
        member_id          = EXCLUDED.member_id,
        status             = EXCLUDED.status,
        phase              = EXCLUDED.phase,
        attempt_id         = EXCLUDED.attempt_id,
        prepared_at        = EXCLUDED.prepared_at,
        last_reconciled_at = EXCLUDED.last_reconciled_at,
        record             = EXCLUDED.record,
        expires_at         = EXCLUDED.expires_at,
        updated_at         = now()
      WHERE hbti_completion.expires_at <= now()
      RETURNING 1 AS acquired
    `;
    if (rows.length === 1) {
      return { acquired: true };
    }

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
    // 状态转移与会员画像必须同一个事务：只落其中一半，会出现「券发出去了但会员表查不到这个人做过
    // HBTI」，或者反过来。两者是同一个事实的两个投影。
    await this.atomically(async (tx) => {
      const updated = await this.write(tx, key, attemptId, record, "locked");
      if (updated !== 1) {
        throw new Error("Completion lock ownership changed.");
      }
      await writeMemberProfile(tx, {
        memberId: record.rewardContext.memberId,
        campaignVersion: key.campaignVersion,
        completion: record.completion,
        completedAt: record.preparedAt,
      });
    });
  }

  async markIssued(
    key: CompletionStoreKey,
    attemptId: string,
    record: IssuedCompletionRecord,
  ): Promise<void> {
    assertKey(key);
    const updated = await this.write(this.sql, key, attemptId, record, null);
    if (updated !== 1) {
      throw new Error("Completion was not in the processing state.");
    }
  }

  async markReview(
    key: CompletionStoreKey,
    attemptId: string,
    record: ReviewCompletionRecord,
  ): Promise<void> {
    assertKey(key);
    const updated = await this.write(this.sql, key, attemptId, record, null);
    if (updated !== 1) {
      throw new Error("Completion was not in the processing state.");
    }
  }

  async clearLocked(
    key: CompletionStoreKey,
    attemptId: string,
  ): Promise<boolean> {
    assertKey(key);
    const result = await this.sql`
      DELETE FROM hbti_completion
      WHERE campaign_version = ${key.campaignVersion}
        AND member_hash = ${key.memberHash}
        AND status = 'processing'
        AND phase = 'locked'
        AND attempt_id = ${attemptId}
    `;
    return result.count === 1;
  }

  async listPreparedBefore(
    preparedBefore: string,
    limit: number,
  ): Promise<PreparedCompletionEntry[]> {
    if (
      !Number.isFinite(Date.parse(preparedBefore)) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    ) {
      throw new Error("Invalid prepared-completion query.");
    }
    // NULLS FIRST 不是风格选择：Mongo 的 sort 把缺失字段排在最前，PG 默认 NULLS LAST 会让
    // 从未对过账的记录沉到队尾、永远轮不到补偿。
    const rows = await this.sql<
      { campaign_version: string; member_hash: string; record: unknown }[]
    >`
      SELECT campaign_version, member_hash, record
      FROM hbti_completion
      WHERE status = 'processing'
        AND phase = 'prepared'
        AND prepared_at <= ${preparedBefore}
        AND expires_at > now()
      ORDER BY last_reconciled_at ASC NULLS FIRST, prepared_at ASC
      LIMIT ${limit}
    `;

    return rows.map((row) => {
      const record = completionRecordSchema.parse(row.record);
      if (record.status !== "processing" || record.phase !== "prepared") {
        throw new Error("Prepared completion query returned another state.");
      }
      return {
        key: {
          campaignVersion: row.campaign_version,
          memberHash: row.member_hash,
        },
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
      UPDATE hbti_completion SET
        last_reconciled_at = ${reconciledAt},
        record = jsonb_set(record, '{lastReconciledAt}', ${
          this.sql.json(reconciledAt)
        }),
        updated_at = now()
      WHERE campaign_version = ${key.campaignVersion}
        AND member_hash = ${key.memberHash}
        AND status = 'processing'
        AND phase = 'prepared'
        AND attempt_id = ${attemptId}
    `;
  }

  /**
   * 所有状态转移共用的 CAS 写入。`requiredPhase` 为 null 表示只要求仍在 processing
   * （对应 Mongo 的 `{status:'processing', attemptId}` 过滤器）。
   */
  private async write(
    sql: SqlRunner,
    key: CompletionStoreKey,
    attemptId: string,
    record: CompletionRecord,
    requiredPhase: "locked" | null,
  ): Promise<number> {
    const fields = projection(record);
    const result = await sql`
      UPDATE hbti_completion SET
        member_id          = COALESCE(${fields.member_id}, hbti_completion.member_id),
        status             = ${fields.status},
        phase              = ${fields.phase},
        attempt_id         = ${fields.attempt_id},
        prepared_at        = ${fields.prepared_at},
        last_reconciled_at = ${fields.last_reconciled_at},
        record             = ${jsonRecord(sql, record)},
        expires_at         = ${new Date(Date.now() + RETENTION_MS)},
        updated_at         = now()
      WHERE campaign_version = ${key.campaignVersion}
        AND member_hash = ${key.memberHash}
        AND status = 'processing'
        AND attempt_id = ${attemptId}
        AND expires_at > now()
        ${requiredPhase === null ? sql`` : sql`AND phase = ${requiredPhase}`}
    `;
    return result.count;
  }
}

/**
 * 把画像写到 `pos_member` 的 hbti_ 八列上（迁移 063）。
 *
 * 顾客走 OTP 当场注册的会员，在当晚 23:00 爬虫跑之前根本不在 pos_member 里，所以这里必须是
 * INSERT-or-UPDATE 而不是纯 UPDATE。新建的行 `snapshot_date` 留 NULL——那正是「POS 快照还没
 * 见过这个会员」的诚实表示，当晚爬虫 upsert 会补齐 POS 那 26 列。
 *
 * ⚠ 只碰 hbti_ 开头的列。这张表的另一个写者是 ~/hot/res_api，两边靠列集不相交共存。
 */
async function writeMemberProfile(
  sql: SqlRunner,
  input: {
    memberId: string;
    campaignVersion: string;
    completion: {
      code: string;
      visitTime: string;
      category: string;
      color: string;
      gender?: string;
      age?: string;
    };
    completedAt: string;
  },
): Promise<void> {
  if (!/^[0-9]{1,32}$/.test(input.memberId)) {
    // RES 的 customerId 实测全是 19 位纯数字。形状不对说明上游变了，
    // 与其往会员主表写一行对不上的数据，不如让画像缺失、由 hbti_completion 留证。
    return;
  }
  await sql`
    INSERT INTO pos_member (
      member_id, store,
      hbti_campaign_version, hbti_code, hbti_visit_time, hbti_category,
      hbti_color, hbti_gender, hbti_age, hbti_completed_at
    ) VALUES (
      ${input.memberId}, ${memberStore()},
      ${input.campaignVersion}, ${input.completion.code},
      ${input.completion.visitTime}, ${input.completion.category},
      ${input.completion.color}, ${input.completion.gender ?? null},
      ${input.completion.age ?? null}, ${input.completedAt}
    )
    ON CONFLICT ON CONSTRAINT uk_pos_member_store_member DO UPDATE SET
      hbti_campaign_version = EXCLUDED.hbti_campaign_version,
      hbti_code             = EXCLUDED.hbti_code,
      hbti_visit_time       = EXCLUDED.hbti_visit_time,
      hbti_category         = EXCLUDED.hbti_category,
      hbti_color            = EXCLUDED.hbti_color,
      hbti_gender           = EXCLUDED.hbti_gender,
      hbti_age              = EXCLUDED.hbti_age,
      hbti_completed_at     = EXCLUDED.hbti_completed_at
  `;
}

export async function createCompletionStoreFromEnv(): Promise<PgCompletionStore> {
  return new PgCompletionStore(getDb());
}

export async function checkCompletionStoreFromEnv(): Promise<void> {
  // 健康检查要证明「这张表真的能读」，不是「进程还活着」。
  await getDb()`SELECT 1 FROM hbti_completion LIMIT 1`;
}

/**
 * PG 没有 TTL 索引，过期行要自己清。正确性不依赖它——所有读路径都带 `expires_at > now()`
 * ——所以这里只做有界删除，由每日 Cron 顺带调用，失败不影响对账本身。
 */
export async function purgeExpired(limitPerTable = 1_000): Promise<number> {
  const sql = getDb();
  let removed = 0;
  for (const table of [
    sql`hbti_completion`,
    sql`hbti_auth_challenge`,
    sql`hbti_auth_session`,
    sql`hbti_rate_limit`,
  ]) {
    const result = await sql`
      DELETE FROM ${table} WHERE ctid IN (
        SELECT ctid FROM ${table} WHERE expires_at <= now() LIMIT ${limitPerTable}
      )
    `;
    removed += result.count;
  }
  return removed;
}
