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

export const sql = new Proxy({} as ReturnType<typeof postgres>, {
  get(_target, prop, receiver) {
    return Reflect.get(getSQL(), prop, receiver);
  },
  apply(_target, thisArg, args) {
    return Reflect.apply(getSQL() as unknown as (...a: unknown[]) => unknown, thisArg, args);
  },
});

export async function query<T = Record<string, unknown>>(
  sqlStr: string,
  params?: unknown[]
): Promise<T[]> {
  const db = getSQL();
  if (params && params.length > 0) {
    const pgSql = sqlStr.includes("$1") ? sqlStr : sqlStr.replace(/\?/g, (() => { let i = 0; return () => `$${++i}`; })());
    const result = await db.unsafe(pgSql, params as (string | number | boolean | null)[]);
    return result as unknown as T[];
  }
  const result = await db.unsafe(sqlStr);
  return result as unknown as T[];
}

export async function execute(
  sqlStr: string,
  params?: unknown[]
): Promise<{ affectedRows: number; insertId: number }> {
  const db = getSQL();
  let result;
  if (params && params.length > 0) {
    const pgSql = sqlStr.includes("$1") ? sqlStr : sqlStr.replace(/\?/g, (() => { let i = 0; return () => `$${++i}`; })());
    result = await db.unsafe(pgSql, params as (string | number | boolean | null)[]);
  } else {
    result = await db.unsafe(sqlStr);
  }
  return { affectedRows: result.count ?? 0, insertId: 0 };
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
        const pgSql = sqlStr.includes("$1") ? sqlStr : sqlStr.replace(/\?/g, (() => { let i = 0; return () => `$${++i}`; })());
        const result = await txSql.unsafe(pgSql, params as (string | number | boolean | null)[]);
        return result as unknown as R[];
      }
      const result = await txSql.unsafe(sqlStr);
      return result as unknown as R[];
    };

    const txExecute = async (
      sqlStr: string,
      params?: unknown[]
    ): Promise<{ affectedRows: number; insertId: number }> => {
      if (params && params.length > 0) {
        const pgSql = sqlStr.includes("$1") ? sqlStr : sqlStr.replace(/\?/g, (() => { let i = 0; return () => `$${++i}`; })());
        const result = await txSql.unsafe(pgSql, params as (string | number | boolean | null)[]);
        return { affectedRows: result.count ?? 0, insertId: 0 };
      }
      const result = await txSql.unsafe(sqlStr);
      return { affectedRows: result.count ?? 0, insertId: 0 };
    };

    return await fn({ query: txQuery, execute: txExecute });
  }) as T;
}
