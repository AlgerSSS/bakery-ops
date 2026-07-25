import { describe, it, expect } from "vitest";

import { toPositional } from "@/modules/shared/db/postgres";

describe("toPositional", () => {
  it("replaces a single ? with $1", () => {
    expect(toPositional("SELECT * FROM users WHERE id = ?")).toBe(
      "SELECT * FROM users WHERE id = $1"
    );
  });

  it("numbers multiple ? placeholders sequentially", () => {
    expect(
      toPositional("INSERT INTO t (a, b, c) VALUES (?, ?, ?)")
    ).toBe("INSERT INTO t (a, b, c) VALUES ($1, $2, $3)");
  });

  it("returns SQL unchanged when it has no placeholders", () => {
    expect(toPositional("SELECT 1")).toBe("SELECT 1");
  });

  it("skips conversion entirely when SQL already contains $1", () => {
    const sql = "SELECT * FROM t WHERE a = $1 AND b = ?";
    expect(toPositional(sql)).toBe(sql);
  });

  it("quirk lock: only $1 is checked — SQL with $2 but no $1 still gets ? replaced", () => {
    // Intentional existing behavior: the guard is `includes("$1")`, not any $n.
    expect(toPositional("SELECT * FROM t WHERE a = $2 AND b = ?")).toBe(
      "SELECT * FROM t WHERE a = $2 AND b = $1"
    );
  });
});
