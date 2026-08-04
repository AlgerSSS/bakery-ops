import { afterEach, describe, expect, it, vi } from "vitest";

const postgresMock = vi.hoisted(() => vi.fn(() => ({ kind: "sql-client" })));

vi.mock("postgres", () => ({ default: postgresMock }));

import { getDb } from "@/lib/db/postgres";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getDb TLS configuration", () => {
  it("authenticates the pinned Supabase pooler certificate", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://postgres.project:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
    );

    expect(getDb()).toEqual({ kind: "sql-client" });
    expect(postgresMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        prepare: false,
        ssl: "verify-full",
      }),
    );
  });
});
