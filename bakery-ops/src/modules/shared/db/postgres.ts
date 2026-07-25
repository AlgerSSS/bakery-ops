import postgres from "postgres";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env") });

let _sql: ReturnType<typeof postgres> | null = null;

export function getSQL(): ReturnType<typeof postgres> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    _sql = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return _sql;
}

/**
 * Convert MySQL-style `?` placeholders to Postgres positional `$1..$n`.
 * If the SQL already contains "$1" it is returned unchanged (note: only
 * "$1" is checked, not "$2"+ — intentional, do not "fix").
 * SQL 内禁止出现字面量 ?（会被误当作占位符替换）。
 */
export function toPositional(sqlStr: string): string {
  return sqlStr.includes("$1") ? sqlStr : sqlStr.replace(/\?/g, (() => { let i = 0; return () => `$${++i}`; })());
}

export async function query<T = Record<string, unknown>>(
  sqlStr: string,
  params?: unknown[]
): Promise<T[]> {
  const db = getSQL();
  if (params && params.length > 0) {
    const pgSql = toPositional(sqlStr);
    const result = await db.unsafe(pgSql, params as (string | number | boolean | null)[]);
    return result as unknown as T[];
  }
  const result = await db.unsafe(sqlStr);
  return result as unknown as T[];
}

export async function execute(
  sqlStr: string,
  params?: unknown[]
): Promise<{ affectedRows: number }> {
  const db = getSQL();
  let result;
  if (params && params.length > 0) {
    const pgSql = toPositional(sqlStr);
    result = await db.unsafe(pgSql, params as (string | number | boolean | null)[]);
  } else {
    result = await db.unsafe(sqlStr);
  }
  return { affectedRows: result.count ?? 0 };
}

export async function withTransaction<T>(
  fn: (tx: { query: typeof query; execute: typeof execute }) => Promise<T>
): Promise<T> {
  const db = getSQL();
  return await db.begin(async (txSql) => {
    const txQuery = async <R = Record<string, unknown>>(
      sqlStr: string,
      params?: unknown[]
    ): Promise<R[]> => {
      if (params && params.length > 0) {
        const pgSql = toPositional(sqlStr);
        const result = await txSql.unsafe(pgSql, params as (string | number | boolean | null)[]);
        return result as unknown as R[];
      }
      const result = await txSql.unsafe(sqlStr);
      return result as unknown as R[];
    };

    const txExecute = async (
      sqlStr: string,
      params?: unknown[]
    ): Promise<{ affectedRows: number }> => {
      if (params && params.length > 0) {
        const pgSql = toPositional(sqlStr);
        const result = await txSql.unsafe(pgSql, params as (string | number | boolean | null)[]);
        return { affectedRows: result.count ?? 0 };
      }
      const result = await txSql.unsafe(sqlStr);
      return { affectedRows: result.count ?? 0 };
    };

    return await fn({ query: txQuery, execute: txExecute });
  }) as T;
}
