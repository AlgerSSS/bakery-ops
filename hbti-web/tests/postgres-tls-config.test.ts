import { afterEach, describe, expect, it, vi } from "vitest";

const postgresMock = vi.hoisted(() =>
  vi.fn((_url: string, options: { ssl: { ca: string; rejectUnauthorized: boolean } }) => {
    void options;
    return { kind: "sql-client" };
  }),
);

vi.mock("postgres", () => ({ default: postgresMock }));

import { getDb } from "@/lib/db/postgres";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getDb TLS configuration", () => {
  it("以 Supabase 自签根为信任锚并强制校验证书", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://postgres.project:secret@aws-1-us-east-1.pooler.supabase.com:6543/postgres",
    );

    expect(getDb()).toEqual({ kind: "sql-client" });
    const [, options] = postgresMock.mock.calls[0];
    expect(options).toMatchObject({ prepare: false });
    // "require" = 加密但不验证证书（可被冒充）；"verify-full" = 直接连不上
    // （Supabase 的根不在公共 CA 库里）。只有显式带上那张根才两头都成立。
    expect(options.ssl.rejectUnauthorized).toBe(true);
    expect(options.ssl.ca).toContain("BEGIN CERTIFICATE");
  });
});
