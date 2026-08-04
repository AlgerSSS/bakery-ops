import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db/postgres";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getDb Vercel connection mode", () => {
  it.each([
    "postgres://postgres.project:secret@aws-1-us-east-1.pooler.supabase.com:5432/postgres",
    "postgresql://postgres.project:secret@aws-1-us-east-1.pooler.supabase.com:5432/postgres",
  ])("拒绝会让 Lambda 独占后端连接的 5432 地址", (databaseUrl) => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("DATABASE_URL", databaseUrl);

    expect(() => getDb()).toThrow(
      "DATABASE_URL must use Supabase transaction pooler port 6543 on Vercel.",
    );
  });

  it.each([
    "postgres://postgres.project:secret@attacker.example:6543/postgres",
    "postgres://postgres.project:secret@db.project.supabase.co:6543/postgres",
    // 后缀必须是真的域名边界，不能被 attacker 用同名后缀糊弄过去
    "postgres://postgres.project:secret@evil-pooler.supabase.com.attacker.example:6543/postgres",
  ])("拒绝不是 Supabase 连接池的主机", (databaseUrl) => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("DATABASE_URL", databaseUrl);

    expect(() => getDb()).toThrow(
      "DATABASE_URL must use the Supabase connection pooler host on Vercel.",
    );
  });
});
