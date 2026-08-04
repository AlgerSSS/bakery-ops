import { describe, expect, it, vi } from "vitest";

import type { SqlRunner } from "@/lib/db/postgres";
import { purgeExpired } from "@/lib/store/pg-completion-store";

interface Identifier {
  identifier: string;
}

function completedQuery(count: number) {
  return Object.assign(Promise.resolve({ count }), { cancel: vi.fn() });
}
describe("purgeExpired", () => {
  it("按轮询顺序给三个过期来源各清一批，前一张表不能独占预算", async () => {
    const counts: Record<string, number[]> = {
      hbti_auth_token: [1_000, 0],
      hbti_rate_limit: [1_000, 0],
      pos_member: [1_000, 0],
    };
    const order: string[] = [];

    const fakeRunner = ((
      first: TemplateStringsArray | string,
      ...values: unknown[]
    ) => {
      if (typeof first === "string") {
        return { identifier: first } satisfies Identifier;
      }
      const sqlText = first.join(" ");
      const table = sqlText.includes("UPDATE pos_member")
        ? "pos_member"
        : (values.find(
            (value): value is Identifier =>
              typeof value === "object" &&
              value !== null &&
              "identifier" in value,
          )?.identifier ?? "unknown");
      order.push(table);
      return completedQuery(counts[table]?.shift() ?? 0);
    }) as unknown as SqlRunner;

    await expect(purgeExpired(fakeRunner, 10_000)).resolves.toBe(3_000);
    expect(order).toEqual([
      "hbti_auth_token",
      "hbti_rate_limit",
      "pos_member",
      "hbti_auth_token",
      "hbti_rate_limit",
      "pos_member",
    ]);
  });
});
