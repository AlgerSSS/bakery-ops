#!/usr/bin/env node
// 一次性迁移：把 MongoDB 里既有的 HBTI 记录搬进 Postgres 的 hbti_completion。
//
// 为什么必须搬而不是让它自然过期：`completions` 里的每一行都是**防重复发券的幂等凭证**。
// 丢掉一条 issued，那个会员在同一期活动里再做一次 HBTI 就会拿到第二张实物券。
//
// 只搬 completions。auth_challenges（10 分钟）、auth_sessions（2 小时）、
// auth_rate_limits（最长 1 天）都是短命工作态，搬过来的价值是零——最坏情况是切换瞬间
// 正在答题的顾客需要重新登录一次。
//
// Mongo 侧严格只读。Postgres 侧幂等：ON CONFLICT DO NOTHING，重复跑不会覆盖已经迁过的行，
// 也不会覆盖切换之后新产生的记录。
//
// 用法：
//   node --env-file=.env.local scripts/migrate-mongo-to-postgres.mjs --dry-run
//   node --env-file=.env.local scripts/migrate-mongo-to-postgres.mjs --apply
//
// 需要 MONGODB_URI（旧库）与 DATABASE_URL（新库）同时在环境里。mongodb 只是 devDependency，
// 迁完就可以连同这个脚本一起删掉。
import { MongoClient } from "mongodb";
import postgres from "postgres";

const apply = process.argv.includes("--apply");
if (!apply && !process.argv.includes("--dry-run")) {
  console.error("必须显式指定 --dry-run 或 --apply。");
  process.exit(2);
}

const mongoUri = process.env.MONGODB_URI?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!mongoUri || !databaseUrl) {
  console.error("需要同时提供 MONGODB_URI 与 DATABASE_URL。");
  process.exit(2);
}

const RETENTION_MS = 548 * 24 * 60 * 60 * 1_000;
const DOCUMENT_ID = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63}):([a-f0-9]{64})$/;

const mongo = new MongoClient(mongoUri, { appName: "hbti-migration", maxPoolSize: 1 });
const sql = postgres(databaseUrl, { ssl: "require", max: 1, prepare: false, onnotice: () => {} });

try {
  await mongo.connect();
  const documents = await mongo
    .db("hotcrush_hbti")
    .collection("completions")
    .find({})
    .toArray();

  console.log(`Mongo completions：${documents.length} 条`);

  let migrated = 0;
  let skipped = 0;
  for (const document of documents) {
    const { _id, expiresAt, ...record } = document;
    const parts = DOCUMENT_ID.exec(String(_id));
    if (!parts) {
      console.warn(`跳过：_id 形状不认识 ${String(_id)}`);
      skipped += 1;
      continue;
    }
    const [, campaignVersion, memberHash] = parts;
    const processing = record.status === "processing" ? record : null;
    const prepared = processing?.phase === "prepared" ? processing : null;
    // issued / review 记录里没有 memberId（rewardContext 只存在于 prepared 态），
    // 所以它们只能迁走幂等锁本身，补不出 pos_member 画像。这是信息本来就不存在，
    // 不是迁移偷懒——历史手机号是 HMAC，反查不回会员。
    const memberId = prepared?.rewardContext?.memberId ?? null;

    console.log(
      `  ${campaignVersion}:${memberHash.slice(0, 8)}… status=${record.status}` +
        `${prepared ? " phase=prepared" : ""}${memberId ? ` member=${memberId}` : " member=-"}`,
    );

    if (!apply) {
      migrated += 1;
      continue;
    }

    const result = await sql`
      INSERT INTO hbti_completion (
        campaign_version, member_hash, member_id, status, phase, attempt_id,
        prepared_at, last_reconciled_at, record, expires_at
      ) VALUES (
        ${campaignVersion}, ${memberHash}, ${memberId},
        ${record.status}, ${processing?.phase ?? null}, ${processing?.attemptId ?? null},
        ${prepared?.preparedAt ?? null}, ${prepared?.lastReconciledAt ?? null},
        ${sql.json(record)},
        ${expiresAt instanceof Date ? expiresAt : new Date(Date.now() + RETENTION_MS)}
      )
      ON CONFLICT (campaign_version, member_hash) DO NOTHING
    `;
    if (result.count === 1) {
      migrated += 1;
    } else {
      // 目标已存在：可能是重跑，也可能是切换之后这个会员又完成了一次。
      // 两种情况都不该覆盖——新库的那一行更新。
      console.log("    已存在，保留 Postgres 侧现有记录");
      skipped += 1;
    }
  }

  console.log(
    `\n${apply ? "已迁移" : "将迁移"} ${migrated} 条，跳过 ${skipped} 条。`,
  );
  if (!apply) {
    console.log("这是 dry-run，没有写入任何东西。确认无误后加 --apply 重跑。");
  }
} finally {
  await mongo.close();
  await sql.end();
}
