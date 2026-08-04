import postgres from "postgres";

import { SUPABASE_ROOT_CA_2021 } from "@/lib/db/supabase-ca";

/**
 * 共享 Supabase 生产库的连接。这个库同时被财务站（Vercel）、~/hot/res_api 爬虫、
 * ~/hot/bakery-ops 和 Contabo 上的 Python 脚本使用——HBTI 是第五个消费方。
 *
 * 参数与财务站 api/_lib/db.js 保持一致，理由都不是"抄一份"：
 *
 * - `max: 1`：Vercel 每个并发调用是独立的函数实例，实例之间不共享连接池。这里再开大池
 *   只会让 Supabase 的连接数按实例数乘以池大小增长，先打满的是数据库不是应用。
 * - `prepare: false`：Supabase 的连接串走 pgbouncer 事务模式时不支持会话级 prepared
 *   statement，开着会在偶发的连接复用上抛 "prepared statement already exists"。
 * - 缓存在 globalThis 上：Next.js 开发模式的模块热替换会让模块级变量重新初始化，
 *   每次热更新泄漏一个连接。
 * - Vercel 只接受 `:6543`：Supabase 明确把 transaction pooler 定义为 serverless 入口。
 *   `:5432` 是 direct/session 模式，每个 Lambda 会独占一个后端连接；流量一上来就耗尽
 *   这个被多个系统共用的生产库连接数。这里 fail closed，避免配置错误静默上线。
 */
/**
 * 顶层连接与「已经在调用方事务里」两种情形都要支持。postgres.js 的 `TransactionSql`
 * 不继承 `Sql`（没有 `begin`，只有 `savepoint`），所以需要这个联合类型：
 * 生产用前者，集成测试把整轮断言关进一个可回滚事务时用后者。
 */
export type SqlRunner = postgres.Sql | postgres.TransactionSql;

const CLIENT_KEY = Symbol.for("hotcrush.hbti.postgres");

type GlobalWithClient = typeof globalThis & {
  [CLIENT_KEY]?: postgres.Sql;
};

const SUPABASE_POOLER_HOST_SUFFIX = ".pooler.supabase.com";

/**
 * Supabase 用自签根签发数据库证书，公共 CA 库里没有它。所以 `ssl: "require"`
 * 会静默降级成「加密但不校验证书」，而 `ssl: "verify-full"` 直接连不上。
 * 把那张根显式作为信任锚，才既校验链也校验主机名——见 `supabase-ca.ts` 的来源说明。
 */

export function getDb(): postgres.Sql {
  const scope = globalThis as GlobalWithClient;
  const cached = scope[CLIENT_KEY];
  if (cached) {
    return cached;
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required.");
  }

  let connectionUrl: URL;
  try {
    connectionUrl = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL is invalid.");
  }
  if (
    !["postgres:", "postgresql:"].includes(connectionUrl.protocol)
  ) {
    throw new Error("DATABASE_URL is invalid.");
  }
  if (process.env.VERCEL === "1") {
    if (!connectionUrl.hostname.endsWith(SUPABASE_POOLER_HOST_SUFFIX)) {
      throw new Error(
        "DATABASE_URL must use the Supabase connection pooler host on Vercel.",
      );
    }
    if (connectionUrl.port !== "6543") {
      throw new Error(
        "DATABASE_URL must use Supabase transaction pooler port 6543 on Vercel.",
      );
    }
  }

  const client = postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: { ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true },
    connection: { application_name: "hotcrush-hbti" },
    onnotice: () => {},
  });
  scope[CLIENT_KEY] = client;
  return client;
}

/**
 * `pos_member` 的主键是 (store, member_id)，store 是人可读的门店名。
 * 爬虫侧的同一个值在 ~/hot/res_api/sync-member.mjs 的 MEMBER_STORE 里，两边必须一致，
 * 否则 HBTI 会为同一个会员建出第二行，而不是补上画像。
 */
export function memberStore(): string {
  return process.env.HBTI_MEMBER_STORE?.trim() || "吉隆坡Pavilion门店";
}
