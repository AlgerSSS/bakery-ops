import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db/postgres";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getDb Vercel connection mode", () => {
  it.each([
    "postgres://postgres.project:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
    "postgresql://postgres.project:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
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
  ])("拒绝非固定 Supabase 交易池主机", (databaseUrl) => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("DATABASE_URL", databaseUrl);

    expect(() => getDb()).toThrow(
      "DATABASE_URL must use the verified Supabase transaction pooler host on Vercel.",
    );
  });
});
