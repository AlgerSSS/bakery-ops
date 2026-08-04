// @vitest-environment node
//
// 三个 Postgres store 的集成测试。
//
// 为什么是集成测试而不是像 Mongo 时期那样用内存假集合：Mongo 的 store 是「对象操作」，
// 一个 Map 就能忠实模拟；PG 的 store 是「SQL 断言」，唯一能验证 `ON CONFLICT ... WHERE
// expires_at <= now()`、`NULLS FIRST`、CAS 判词这些真正承载正确性的东西的，只有真的 PG。
// 用假的 tagged template 去比对 SQL 字符串，测的是拼写不是行为。
//
// 隔离方式：整轮跑在一个事务里，迁移 063 也在这个事务里执行，结束强制回滚。
// 生产库不留任何痕迹——这也是 062 上线前采用的同一套做法。
//
// 没有 DATABASE_URL 时整组跳过，所以默认 `npm test` 不依赖网络；发布前必须带库跑一次。
import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PgAuthStore } from "@/lib/auth/pg-auth-store";
import type { SqlRunner } from "@/lib/db/postgres";
import { PgAuthRateLimiter } from "@/lib/rate-limit/auth-rate-limit";
import { bumpRateLimitBucket } from "@/lib/rate-limit/pg-rate-limit";
import {
  PgCompletionStore,
  deliverPendingReviewAlerts,
  purgeExpired,
} from "@/lib/store/pg-completion-store";
import type {
  CompletionStoreKey,
  HbtiCompletionSnapshot,
  IssuedCompletionRecord,
  LockedCompletionRecord,
  ReviewCompletionRecord,
  PreparedCompletionRecord,
  UnrewardedCompletionRecord,
} from "@/lib/store/completion-store";
import {
  drawGift,
  listGiftStock,
  releaseGift,
} from "@/lib/store/gift-pool";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const DATABASE_SSL =
  process.env.DATABASE_SSL?.trim() === "disable" ? false : "require";
const STORE = process.env.HBTI_MEMBER_STORE?.trim() || "吉隆坡Pavilion门店";
const AUTH_SECRET = "integration-auth-secret-".repeat(2);

const suite = DATABASE_URL ? describe : describe.skip;

const snapshot: HbtiCompletionSnapshot = {
  code: "ILBA",
  visitTime: "morning",
  category: "drink",
  color: "pistachio",
  gender: "prefer-not",
};

const identity = {
  countryCode: "60",
  isoCode: "MY",
  phone: "123456789",
  e164: "+60123456789",
} as const;

/** 每个用例一个互不相同的会员，避免同事务内互相踩到。 */
let seq = 0;
const nextKey = (): CompletionStoreKey => {
  seq += 1;
  return {
    campaignVersion: "itest",
    memberId: `91000000000000${String(10000 + seq).slice(-5)}`,
  };
};
// 会员 ID 用独立计数器：和 memberId 共用一个会让先取 ID、后取 key 的用例
// 撞上前一个用例已经建过画像的那个会员，断言就会看到多出来的历史行。
let memberSeq = 0;
const nextMemberId = () => {
  memberSeq += 1;
  return `90000000000000${String(10000 + memberSeq).slice(-5)}`;
};

const locked = (attemptId: string): LockedCompletionRecord => ({
  status: "processing",
  phase: "locked",
  attemptId,
  startedAt: new Date().toISOString(),
  completion: snapshot,
});

const prepared = (
  attemptId: string,
  memberId: string,
  overrides: Partial<PreparedCompletionRecord> = {},
): PreparedCompletionRecord => ({
  status: "processing",
  phase: "prepared",
  attemptId,
  startedAt: new Date().toISOString(),
  preparedAt: new Date().toISOString(),
  completion: snapshot,
  baselineCouponIds: ["c-1"],
  rewardContext: {
    memberId,
    templateId: "t-1",
    templateName: "Pistachio Green Jewel",
  },
  ...overrides,
});

// 库在新加坡的 Supabase 上，单次往返几百毫秒，一个用例里十几条语句很容易越过 vitest
// 默认的 5 秒。超时会把外层事务留在半开状态，后面每个用例都跟着超时，看起来像一片崩塌。
suite("Postgres 三个 store（真库 · 事务内 · 结束回滚）", { timeout: 30_000 }, () => {
  let root: postgres.Sql;
  let tx: SqlRunner;
  let release: () => void;
  let finished: Promise<unknown>;
  let store: PgCompletionStore;
  let auth: PgAuthStore;

  beforeAll(async () => {
    root = postgres(DATABASE_URL as string, {
      ssl: DATABASE_SSL,
      max: 1,
      prepare: false,
      onnotice: () => {},
    });
    // 事务在一个 Promise 上挂住，测试全程共用它；afterAll 里抛出以强制回滚。
    let open!: (value: SqlRunner) => void;
    const ready = new Promise<SqlRunner>((resolve) => {
      open = resolve;
    });
    const stop = new Promise<void>((resolve) => {
      release = resolve;
    });
    finished = root
      .begin(async (transaction) => {
        open(transaction);
        await stop;
        throw new Error("__rollback__");
      })
      .catch((error: Error) => {
        if (error.message !== "__rollback__") {
          throw error;
        }
      });
    tx = await ready;
    store = new PgCompletionStore(tx);
    auth = new PgAuthStore(tx, AUTH_SECRET);
  }, 60_000);

  afterAll(async () => {
    release?.();
    await finished;
    // 回滚必须是真的：测试写进去的行一条都不能留下。
    const leftoverMembers = await root`
      SELECT count(*)::int AS n FROM pos_member WHERE member_id LIKE '91%'`;
    expect(leftoverMembers[0].n).toBe(0);
    const leftoverTokens = await root`
      SELECT count(*)::int AS n FROM hbti_auth_token WHERE expires_at < now() - interval '365 days'`;
    expect(leftoverTokens[0].n).toBe(0);
    await root.end();
  }, 60_000);

  describe("PgCompletionStore 幂等锁", () => {
    it("首个加锁者胜出，第二个拿到既有记录而不是覆盖它", async () => {
      const key = nextKey();
      const first = await store.acquireProcessing(key, locked(randomUUID()));
      expect(first.acquired).toBe(true);

      const second = await store.acquireProcessing(key, locked(randomUUID()));
      expect(second.acquired).toBe(false);
      if (second.acquired) throw new Error("unreachable");
      expect(second.record.status).toBe("processing");
    });

    it("record 原样往返，判别联合不丢字段", async () => {
      const key = nextKey();
      const record = locked(randomUUID());
      await store.acquireProcessing(key, record);
      expect(await store.get(key)).toEqual(record);
    });

    it("过期的锁可以被顶替——这是 Mongo TTL 删除的等价物", async () => {
      const key = nextKey();
      await store.acquireProcessing(key, locked(randomUUID()));
      await tx`
        UPDATE pos_member SET hbti_expires_at = now() - interval '1 day'
        WHERE hbti_campaign_version = ${key.campaignVersion} AND member_id = ${key.memberId}`;

      expect(await store.get(key)).toBeNull();
      const retaken = await store.acquireProcessing(key, locked(randomUUID()));
      expect(retaken.acquired).toBe(true);
    });

    it("markPrepared 只认持锁的 attemptId", async () => {
      const key = nextKey();
      const attemptId = randomUUID();
      await store.acquireProcessing(key, locked(attemptId));

      const intruder = randomUUID();
      await expect(
        store.markPrepared(key, intruder, prepared(intruder, nextMemberId())),
      ).rejects.toThrow("Completion lock ownership changed.");

      await expect(
        store.markPrepared(key, attemptId, prepared(attemptId, nextMemberId())),
      ).resolves.toBeUndefined();
    });

    it("clearLocked 只清自己那把 locked 锁，不碰已经 prepared 的记录", async () => {
      const key = nextKey();
      const attemptId = randomUUID();
      await store.acquireProcessing(key, locked(attemptId));
      expect(await store.clearLocked(key, randomUUID())).toBe(false);

      await store.markPrepared(key, attemptId, prepared(attemptId, nextMemberId()));
      expect(await store.clearLocked(key, attemptId)).toBe(false);
      expect(await store.get(key)).not.toBeNull();
    });

    it("markIssued 要求仍在 processing，且成功后不可重复终结", async () => {
      const key = nextKey();
      const attemptId = randomUUID();
      const memberId = nextMemberId();
      await store.acquireProcessing(key, locked(attemptId));
      await store.markPrepared(key, attemptId, prepared(attemptId, memberId));

      const issued: IssuedCompletionRecord = {
        status: "issued",
        completion: snapshot,
        reward: {
          couponTemplateName: "Pistachio Green Jewel",
          newCouponId: "coupon-1",
          usableCouponCountBefore: 1,
          usableCouponCountAfter: 2,
          confirmedAt: new Date().toISOString(),
        },
      };
      await store.markIssued(key, attemptId, issued);
      expect(await store.get(key)).toEqual(issued);

      await expect(store.markIssued(key, attemptId, issued)).rejects.toThrow(
        "Completion was not in the processing state.",
      );
    });

    it("失败的 review 告警保持 pending，下一轮可重试并标 sent", async () => {
      const key = nextKey();
      const attemptId = randomUUID();
      await store.acquireProcessing(key, locked(attemptId));
      const preparedRecord = prepared(attemptId, key.memberId);
      await store.markPrepared(key, attemptId, preparedRecord);
      const review: ReviewCompletionRecord = {
        status: "review",
        completion: snapshot,
        reason: "readback_mismatch",
        markedAt: new Date().toISOString(),
        attemptId,
        baselineCouponIds: preparedRecord.baselineCouponIds,
        rewardContext: preparedRecord.rewardContext,
        alert: { status: "pending" },
      };
      await store.markReview(key, attemptId, review);

      vi.stubEnv("ALERT_WEBHOOK", "https://alerts.example.test/hbti");
      const fetchMock = vi.spyOn(globalThis, "fetch");
      try {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
        await expect(deliverPendingReviewAlerts(tx)).resolves.toEqual({
          claimed: 1,
          sent: 0,
        });
        await expect(store.get(key)).resolves.toMatchObject({
          status: "review",
          alert: { status: "pending" },
        });

        fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
        await expect(deliverPendingReviewAlerts(tx)).resolves.toEqual({
          claimed: 1,
          sent: 1,
        });
        await expect(store.get(key)).resolves.toMatchObject({
          status: "review",
          alert: { status: "sent" },
        });
      } finally {
        fetchMock.mockRestore();
        vi.unstubAllEnvs();
      }
    });

    it("认领并持久升级最早的四字段 review 后再发送告警", async () => {
      const key = nextKey();
      const attemptId = randomUUID();
      await store.acquireProcessing(key, locked(attemptId));
      const preparedRecord = prepared(attemptId, key.memberId);
      await store.markPrepared(key, attemptId, preparedRecord);
      await store.markReview(key, attemptId, {
        status: "review",
        completion: snapshot,
        reason: "give_rejected",
        markedAt: new Date().toISOString(),
        attemptId,
        baselineCouponIds: preparedRecord.baselineCouponIds,
        rewardContext: preparedRecord.rewardContext,
        alert: { status: "pending" },
      });
      const legacy = {
        status: "review",
        completion: snapshot,
        reason: "give_rejected",
        markedAt: new Date().toISOString(),
      };
      await tx`
        UPDATE pos_member
        SET hbti_record = ${tx.json(legacy as unknown as Parameters<typeof tx.json>[0])}
        WHERE store = ${STORE}
          AND member_id = ${key.memberId}
          AND hbti_campaign_version = ${key.campaignVersion}
      `;

      vi.stubEnv("ALERT_WEBHOOK", "https://alerts.example.test/hbti");
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));
      try {
        await expect(deliverPendingReviewAlerts(tx)).resolves.toEqual({
          claimed: 1,
          sent: 1,
        });
        await expect(store.get(key)).resolves.toMatchObject({
          status: "review",
          attemptId: "00000000-0000-0000-0000-000000000000",
          rewardContext: {
            memberId: key.memberId,
            templateId: "legacy-unknown",
            templateName: "legacy-unknown",
          },
          alert: { status: "sent" },
        });
      } finally {
        fetchMock.mockRestore();
        vi.unstubAllEnvs();
      }
    });

    it("对账扫描把从未对过账的排在最前（NULLS FIRST），并遵守 limit", async () => {
      const older = nextKey();
      const olderAttempt = randomUUID();
      await store.acquireProcessing(older, locked(olderAttempt));
      await store.markPrepared(
        older,
        olderAttempt,
        prepared(olderAttempt, nextMemberId(), {
          preparedAt: "2026-01-01T00:00:00.000Z",
          lastReconciledAt: "2026-06-01T00:00:00.000Z",
        }),
      );

      const never = nextKey();
      const neverAttempt = randomUUID();
      await store.acquireProcessing(never, locked(neverAttempt));
      await store.markPrepared(
        never,
        neverAttempt,
        prepared(neverAttempt, nextMemberId(), {
          preparedAt: "2026-02-01T00:00:00.000Z",
        }),
      );

      const scanned = await store.listPreparedBefore(
        "2026-07-01T00:00:00.000Z",
        50,
      );
      const hashes = scanned.map((entry) => entry.key.memberId);
      expect(hashes.indexOf(never.memberId)).toBeLessThan(
        hashes.indexOf(older.memberId),
      );
      expect(await store.listPreparedBefore("2026-07-01T00:00:00.000Z", 1))
        .toHaveLength(1);
    });

    it("touchPrepared 同时更新提升列与 record，两者不许漂移", async () => {
      const key = nextKey();
      const attemptId = randomUUID();
      await store.acquireProcessing(key, locked(attemptId));
      await store.markPrepared(key, attemptId, prepared(attemptId, nextMemberId()));

      const reconciledAt = "2026-07-31T00:00:00.000Z";
      await store.touchPrepared(key, attemptId, reconciledAt);

      const record = await store.get(key);
      expect(record).toMatchObject({ lastReconciledAt: reconciledAt });
      const row = await tx`
        SELECT hbti_record->>'lastReconciledAt' AS last_reconciled_at FROM pos_member
        WHERE hbti_campaign_version = ${key.campaignVersion} AND member_id = ${key.memberId}`;
      expect(new Date(row[0].last_reconciled_at).toISOString()).toBe(reconciledAt);
    });

    it("拒绝形状不对的键，不把它拼进 SQL", async () => {
      await expect(
        store.get({ campaignVersion: "v1", memberId: "nope" }),
      ).rejects.toThrow("Invalid completion-store key.");
      await expect(
        store.get({ campaignVersion: "bad version!", memberId: "a".repeat(64) }),
      ).rejects.toThrow("Invalid completion-store key.");
    });
  });

  describe("pos_member 画像投影", () => {
    it("会员还没进 POS 快照时也能建行，snapshot_date 留 NULL", async () => {
      const key = nextKey();
      const attemptId = randomUUID();
      const memberId = key.memberId;
      await store.acquireProcessing(key, locked(attemptId));
      await store.markPrepared(key, attemptId, prepared(attemptId, memberId));

      const rows = await tx`
        SELECT snapshot_date, hbti_code, hbti_color, hbti_gender, hbti_age,
               hbti_campaign_version, hbti_completed_at
        FROM pos_member WHERE store = ${STORE} AND member_id = ${memberId}`;
      expect(rows).toHaveLength(1);
      expect(rows[0].snapshot_date).toBeNull();
      expect(rows[0].hbti_code).toBe("ILBA");
      expect(rows[0].hbti_color).toBe("pistachio");
      expect(rows[0].hbti_gender).toBe("prefer-not");
      // 顾客跳过的可选题必须留空，不能用占位值冒充
      expect(rows[0].hbti_age).toBeNull();
      expect(rows[0].hbti_completed_at).not.toBeNull();
    });

    it("当晚爬虫 upsert 覆盖 POS 那批列，画像原样存活", async () => {
      const key = nextKey();
      const attemptId = randomUUID();
      const memberId = key.memberId;
      await store.acquireProcessing(key, locked(attemptId));
      await store.markPrepared(key, attemptId, prepared(attemptId, memberId));

      // 逐字照搬 res_api/sync-member.mjs 的写法：ON CONFLICT ON CONSTRAINT + 只更新自己的列
      await tx`
        INSERT INTO pos_member (member_id, store, has_profile, card_count, point_balance, snapshot_date)
        VALUES (${memberId}, ${STORE}, true, 1, 42, current_date)
        ON CONFLICT ON CONSTRAINT uk_pos_member_store_member DO UPDATE SET
          has_profile = excluded.has_profile, card_count = excluded.card_count,
          point_balance = excluded.point_balance, snapshot_date = excluded.snapshot_date,
          fetched_at = now()`;

      const rows = await tx`
        SELECT hbti_code, hbti_color, point_balance, snapshot_date
        FROM pos_member WHERE store = ${STORE} AND member_id = ${memberId}`;
      expect(rows[0].hbti_code).toBe("ILBA");
      expect(rows[0].hbti_color).toBe("pistachio");
      expect(rows[0].point_balance).toBe(42);
      expect(rows[0].snapshot_date).not.toBeNull();
    });

    it("第二期活动覆盖成最新画像，会员仍只有一行", async () => {
      const memberId = nextKey().memberId;
      const first = { campaignVersion: "itest", memberId };
      const firstAttempt = randomUUID();
      await store.acquireProcessing(first, locked(firstAttempt));
      await store.markPrepared(first, firstAttempt, prepared(firstAttempt, memberId));

      const second = { campaignVersion: "itest2", memberId };
      const secondAttempt = randomUUID();
      await store.acquireProcessing(second, locked(secondAttempt));
      await store.markPrepared(second, secondAttempt, {
        ...prepared(secondAttempt, memberId),
        completion: { ...snapshot, code: "HSDT", color: "cocoa" },
      });

      const rows = await tx`
        SELECT hbti_campaign_version, hbti_code, hbti_color
        FROM pos_member WHERE store = ${STORE} AND member_id = ${memberId}`;
      expect(rows[0].hbti_campaign_version).toBe("itest2");
      expect(rows[0].hbti_code).toBe("HSDT");

      // 收进会员表之后一行一个会员：只保留最新一期，逐期历史不再留存。
      // 这是 066 的明确取舍，不是丢数据的 bug。
      const single = await tx`
        SELECT count(*)::int AS n FROM pos_member WHERE member_id = ${memberId}`;
      expect(single[0].n).toBe(1);
    });
  });

  describe("PgAuthStore", () => {
    it("挑战自增尝试次数并占用 pending 态，5 次后拒绝", async () => {
      const created = await auth.createChallenge({
        guestToken: "guest",
        deviceId: "device",
        identity,
      });

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const begun = await auth.beginAttempt(created.token);
        expect(begun?.attempts).toBe(attempt);
        expect(begun?.payload.identity.e164).toBe(identity.e164);
        // 占用中不能再开一次——并发两个请求各拿一次尝试次数会让 5 次上限失效
        expect(await auth.beginAttempt(created.token)).toBeNull();
        expect(await auth.releaseAttempt(created.token)).toBe(attempt < 5);
      }
      expect(await auth.beginAttempt(created.token)).toBeNull();
    });

    it("markConflict 把验证过的码写回密文，且要求仍是自己读到的那一版", async () => {
      const created = await auth.createChallenge({
        guestToken: "guest",
        deviceId: "device",
        identity,
      });
      await auth.beginAttempt(created.token);
      expect(await auth.markConflict(created.token, "123456")).toBe(true);

      const reopened = await auth.beginAttempt(created.token);
      expect(reopened?.payload.verifiedCode).toBe("123456");
      // 已经不在 verifying 之外的态上，重复标记必须失败
      expect(await auth.consumeChallenge(created.token)).toBe(true);
      expect(await auth.markConflict(created.token, "123456")).toBe(false);
    });

    it("过期挑战一律当作不存在", async () => {
      const created = await auth.createChallenge({
        guestToken: "guest",
        deviceId: "device",
        identity,
      });
      await tx`
        UPDATE hbti_auth_token SET expires_at = now() - interval '1 minute'`;
      expect(await auth.beginAttempt(created.token)).toBeNull();
    });

    it("会话可创建、读取、删除，draftKey 对同一会员稳定", async () => {
      const payload = { resToken: "res-token", memberId: "2082777414026694664", identity };
      const created = await auth.createSession(payload);
      const loaded = await auth.getSession(created.token);
      expect(loaded?.payload).toEqual(payload);
      expect(loaded?.draftKey).toBe(created.draftKey);

      expect(await auth.deleteSession(created.token)).toBe(true);
      expect(await auth.getSession(created.token)).toBeNull();
    });

    it("密文被改过就解不出来，返回 null 而不是抛裸错", async () => {
      const created = await auth.createSession({
        resToken: "res-token",
        memberId: "2082777414026694664",
        identity,
      });
      await tx`
        UPDATE hbti_auth_token
           SET payload = jsonb_set(payload, '{ciphertext}', '"dGFtcGVyZWQ"')`;
      expect(await auth.getSession(created.token)).toBeNull();
    });

    it("库里存的是令牌哈希与密文，翻不出手机号明文", async () => {
      await auth.createSession({
        resToken: "res-token",
        memberId: "2082777414026694664",
        identity,
      });
      const rows = await tx`SELECT token_hash, payload::text AS payload FROM hbti_auth_token`;
      for (const row of rows) {
        expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(row.payload).not.toContain(identity.e164);
        expect(row.payload).not.toContain("res-token");
      }
    });
  });

  describe("限流", () => {
    it("计数器自增是单语句原子的，并发不会各读各的旧值", async () => {
      const bucket = `itest:${randomUUID()}`;
      const expires = new Date(Date.now() + 60_000);
      const counts = await Promise.all(
        Array.from({ length: 5 }, () => bumpRateLimitBucket(tx, bucket, expires)),
      );
      expect([...counts].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    });

    it("发码限流：同一手机号一分钟一条，超出给出重试秒数", async () => {
      const limiter = new PgAuthRateLimiter(tx, AUTH_SECRET);
      const input = {
        phoneE164: "+60123450001",
        ipAddress: "203.0.113.9",
        now: Date.parse("2026-07-30T10:01:00.000Z"),
      };
      expect((await limiter.consumeOtpRequest(input)).allowed).toBe(true);
      const denied = await limiter.consumeOtpRequest(input);
      expect(denied.allowed).toBe(false);
      expect(denied.retryAfterSeconds).toBeGreaterThan(0);

      // 下一分钟窗口重新放行
      const nextWindow = await limiter.consumeOtpRequest({
        ...input,
        now: input.now + 60_000,
      });
      expect(nextWindow.allowed).toBe(true);
    });

    it("分钟门禁拒绝的重复请求不消耗受害者的每日发送额度", async () => {
      const limiter = new PgAuthRateLimiter(tx, AUTH_SECRET);
      const input = {
        phoneE164: "+60123450003",
        ipAddress: "203.0.113.11",
        now: Date.parse("2026-07-30T12:00:00.000Z"),
      };

      const first = await limiter.consumeOtpRequest(input);
      expect(first).toMatchObject({
        allowed: true,
        phoneAttemptsToday: 1,
      });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(limiter.consumeOtpRequest(input)).resolves.toMatchObject({
          allowed: false,
          phoneAttemptsToday: 0,
        });
      }

      const nextMinute = await limiter.consumeOtpRequest({
        ...input,
        now: input.now + 60_000,
      });
      expect(nextMinute).toMatchObject({
        allowed: true,
        phoneAttemptsToday: 2,
      });
    });

    it("发码限流只落主体的 HMAC，不落手机号或 IP 明文", async () => {
      const limiter = new PgAuthRateLimiter(tx, AUTH_SECRET);
      await limiter.consumeOtpRequest({
        phoneE164: "+60123450002",
        ipAddress: "203.0.113.10",
        now: Date.parse("2026-07-30T11:00:00.000Z"),
      });
      const rows = await tx`SELECT bucket FROM hbti_rate_limit`;
      for (const row of rows) {
        expect(row.bucket).not.toContain("60123450002");
        expect(row.bucket).not.toContain("203.0.113.10");
      }
    });
  });

  describe("purgeExpired（替代 Mongo 的 TTL 索引）", () => {
    it("只删过期行，未过期的一行不碰", async () => {
      const live = nextKey();
      await store.acquireProcessing(live, locked(randomUUID()));
      const stale = nextKey();
      await store.acquireProcessing(stale, locked(randomUUID()));
      await tx`
        UPDATE pos_member SET hbti_expires_at = now() - interval '1 day'
        WHERE hbti_campaign_version = ${stale.campaignVersion} AND member_id = ${stale.memberId}`;

      await tx`INSERT INTO hbti_rate_limit (bucket, count, expires_at)
               VALUES ('purge-stale', 1, now() - interval '1 hour'),
                      ('purge-live', 1, now() + interval '1 hour')`;
      await tx`INSERT INTO hbti_auth_token (token_hash, kind, payload, expires_at)
               VALUES (${"f".repeat(64)}, 'session', '{}'::jsonb, now() - interval '1 hour')`;

      const removed = await purgeExpired(tx);
      expect(removed).toBeGreaterThanOrEqual(3);

      expect(await store.get(live)).not.toBeNull();
      const survivors = await tx`SELECT bucket FROM hbti_rate_limit WHERE bucket LIKE 'purge-%'`;
      expect(survivors.map((row) => row.bucket)).toEqual(["purge-live"]);
      const sessions = await tx`
        SELECT count(*)::int AS n FROM hbti_auth_token WHERE token_hash = ${"f".repeat(64)}`;
      expect(sessions[0].n).toBe(0);
      // purgeExpired 对 pos_member 是「清空 hbti_ 状态」，不是删行——
      // 那是会员主表，行的存亡由 res_api 决定，不该被 HBTI 的保留期左右。
      const staleRows = await tx`
        SELECT hbti_status FROM pos_member
        WHERE hbti_campaign_version = ${stale.campaignVersion} AND member_id = ${stale.memberId}`;
      expect(staleRows[0]?.hbti_status ?? null).toBeNull();
    });
  });

  describe("周边奖池（hbti_gift_stock）", () => {
    // 和上面同理：加权抽取、FOR UPDATE、CHECK 约束这些真正承载正确性的东西只有真库能验。
    //
    // 每个用例再套一层 savepoint 并强制回滚，有两个原因：
    // 一是这些用例要改全表库存（缩放、停用），不隔离就会互相污染；
    // 二是「超发被拦下」那条会真的触发一次约束违规，而 PG 里一个报错就会把整个事务打成
    // aborted，后面每一条都变成 "current transaction is aborted"，看起来像全面崩塌。
    const onStock = async (body: (sp: SqlRunner) => Promise<void>) => {
      class Rollback extends Error {}
      try {
        await (tx as postgres.TransactionSql).savepoint(async (sp) => {
          await body(sp);
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
    };

    it("抽取扣库存，归还加回来", async () => {
      await onStock(async (sp) => {
        const before = await listGiftStock(sp);
        const total = before.reduce((sum, row) => sum + row.remaining, 0);
        expect(total).toBeGreaterThan(0);

        const draw = await drawGift(sp);
        expect(draw).not.toBeNull();
        const drawn = draw as NonNullable<typeof draw>;

        const mid = await listGiftStock(sp);
        expect(
          mid.find((r) => r.templateName === drawn.templateName)?.remaining,
        ).toBe(drawn.remainingAfter);
        expect(mid.reduce((s, r) => s + r.remaining, 0)).toBe(total - 1);

        await releaseGift(drawn.templateName, sp);
        const after = await listGiftStock(sp);
        expect(after.reduce((s, r) => s + r.remaining, 0)).toBe(total);
      });
    });

    it("抽干奖池得到的恰好是库存清单，之后一直返回 null", async () => {
      await onStock(async (sp) => {
        // 缩到 11 件（一件 3 份、其余各 1 份）。验证的不变量和抽干全池完全相同——
        // 每项抽出次数 == 库存、归零后离池、池空返回 null——但库在新加坡，
        // 一次抽取两个往返，按真实的 1376 件跑要几十分钟，必然超时。
        // 保留一件 3 份是为了证明「同一品项可以被抽中多次」，不只是每项一次。
        await sp`
          UPDATE hbti_gift_stock
             SET issued_count = 0,
                 initial_stock = CASE
                   WHEN template_name = (SELECT min(template_name) FROM hbti_gift_stock)
                   THEN 3 ELSE 1 END,
                 is_active = TRUE`;
        const target = await listGiftStock(sp);
        const expected = Object.fromEntries(
          target
            .filter((r) => r.isActive)
            .map((r) => [r.templateName, r.remaining]),
        );
        const totalTarget = Object.values(expected).reduce((a, b) => a + b, 0);

        const tally: Record<string, number> = {};
        for (let i = 0; i < totalTarget; i += 1) {
          const draw = await drawGift(sp);
          expect(draw, `第 ${i + 1} 次抽取意外落空`).not.toBeNull();
          const name = (draw as NonNullable<typeof draw>).templateName;
          tally[name] = (tally[name] ?? 0) + 1;
        }

        // 每个品项抽出的次数必须恰好等于它的库存：多了是超发，少了说明归零的品项还留在池中。
        expect(tally).toEqual(expected);
        expect(await drawGift(sp)).toBeNull();
        expect(await drawGift(sp)).toBeNull();
      });
    });

    it("停用的品项抽不到", async () => {
      await onStock(async (sp) => {
        const [first] = await listGiftStock(sp);
        await sp`UPDATE hbti_gift_stock SET is_active = FALSE
                  WHERE template_name <> ${first.templateName}`;

        for (let i = 0; i < 5; i += 1) {
          expect((await drawGift(sp))?.templateName).toBe(first.templateName);
        }
      });
    });

    it("not_oversold 挡住超发——代码算错也发不出多余的一份", async () => {
      await onStock(async (sp) => {
        const [row] = await listGiftStock(sp);
        // 再套一层内层 savepoint：违规一旦发生，连接就进入 aborted 状态，
        // 必须就地 ROLLBACK TO SAVEPOINT 才能继续用。
        await expect(
          (sp as postgres.TransactionSql).savepoint(
            (inner) =>
              inner`UPDATE hbti_gift_stock SET issued_count = initial_stock + 1
                     WHERE template_name = ${row.templateName}`,
          ),
        ).rejects.toThrow(/not_oversold/);

        // 拦下之后事务仍然可用，库存也没被改动。
        const after = await listGiftStock(sp);
        expect(
          after.find((r) => r.templateName === row.templateName)?.issuedCount,
        ).toBe(row.issuedCount);
      });
    });

    it("重复归还不会把已发数做成负数", async () => {
      await onStock(async (sp) => {
        const [row] = await listGiftStock(sp);
        await releaseGift(row.templateName, sp);
        await releaseGift(row.templateName, sp);
        const target = (await listGiftStock(sp)).find(
          (r) => r.templateName === row.templateName,
        );
        expect(target?.issuedCount).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("markUnrewarded（迁移 078 放开的新终态）", () => {
    it("落库、通过所有 CHECK、并能被 zod 原样读回", async () => {
      const key = nextKey();
      const attemptId = randomUUID();
      expect(
        (await store.acquireProcessing(key, locked(attemptId))).acquired,
      ).toBe(true);

      const record: UnrewardedCompletionRecord = {
        status: "unrewarded",
        completion: snapshot,
        markedAt: new Date().toISOString(),
      };
      await store.markUnrewarded(key, attemptId, record);

      // 读回这步同时验证了 completionRecordSchema 的 unrewarded 分支——少了它这里抛 ZodError。
      expect(await store.get(key)).toEqual(record);

      const rows = await tx`
        SELECT hbti_status, hbti_attempt_id, hbti_record->>'status' AS rec_status,
               hbti_code, hbti_completed_at
          FROM pos_member
         WHERE store = ${STORE} AND member_id = ${key.memberId}`;
      // ck_pos_member_hbti_status：078 之前这一行根本写不进去。
      expect(rows[0].hbti_status).toBe("unrewarded");
      // ck_pos_member_hbti_record_shape：JSON 里的 status 必须等于列。
      expect(rows[0].rec_status).toBe("unrewarded");
      // ck_pos_member_hbti_attempt_shape：非 processing 状态不得留 attempt_id。
      expect(rows[0].hbti_attempt_id).toBeNull();
      // 画像列照常写——答完题就该有，与发没发券无关。
      expect(rows[0].hbti_code).toBe(snapshot.code);
      expect(rows[0].hbti_completed_at).not.toBeNull();
    });

    it("终态挡住同一会员本期活动内的第二次参与", async () => {
      const key = nextKey();
      const attemptId = randomUUID();
      await store.acquireProcessing(key, locked(attemptId));
      await store.markUnrewarded(key, attemptId, {
        status: "unrewarded",
        completion: snapshot,
        markedAt: new Date().toISOString(),
      });

      const again = await store.acquireProcessing(key, locked(randomUUID()));
      expect(again.acquired).toBe(false);
      expect(again).toMatchObject({ record: { status: "unrewarded" } });
    });

    it("不会覆盖已经发过券的记录", async () => {
      const key = nextKey();
      const attemptId = randomUUID();
      await store.acquireProcessing(key, locked(attemptId));
      await store.markIssued(key, attemptId, {
        status: "issued",
        completion: snapshot,
        reward: {
          couponTemplateName: "HBTI Gift · White Pencil",
          newCouponId: "coupon-x",
          usableCouponCountBefore: 0,
          usableCouponCountAfter: 1,
          confirmedAt: new Date().toISOString(),
        },
      });

      await expect(
        store.markUnrewarded(key, attemptId, {
          status: "unrewarded",
          completion: snapshot,
          markedAt: new Date().toISOString(),
        }),
      ).rejects.toThrow();
      expect(await store.get(key)).toMatchObject({ status: "issued" });
    });

    it("cron 对账不会把 unrewarded 记录扫进来", async () => {
      const key = nextKey();
      const attemptId = randomUUID();
      await store.acquireProcessing(key, locked(attemptId));
      await store.markUnrewarded(key, attemptId, {
        status: "unrewarded",
        completion: snapshot,
        markedAt: new Date().toISOString(),
      });

      const pending = await store.listPreparedBefore(
        new Date(Date.now() + 60_000).toISOString(),
        50,
      );
      expect(pending.some((e) => e.key.memberId === key.memberId)).toBe(false);
    });
  });
});
