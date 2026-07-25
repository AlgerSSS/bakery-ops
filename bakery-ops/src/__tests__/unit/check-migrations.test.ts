import { describe, it, expect } from "vitest";

import { parseMigrationFiles, diffMigrations } from "../../../scripts/check-migrations";

describe("parseMigrationFiles", () => {
  it("parses NNN_name.sql into version/name and keeps the filename", () => {
    expect(parseMigrationFiles(["019_manager_review.sql"])).toEqual([
      { version: 19, name: "manager_review", filename: "019_manager_review.sql" },
    ]);
  });

  it("ignores files that do not match NNN_name.sql", () => {
    expect(
      parseMigrationFiles(["SCHEMA-OPTIMIZATION.md", "notes.txt", "001_core_tables.sql.bak"]),
    ).toEqual([]);
  });

  it("sorts by version ascending regardless of input order", () => {
    const result = parseMigrationFiles([
      "010_consolidate_missing_tables.sql",
      "002_kol_tables.sql",
      "001_core_tables.sql",
    ]);
    expect(result.map((f) => f.version)).toEqual([1, 2, 10]);
  });
});

describe("diffMigrations", () => {
  const dir = parseMigrationFiles([
    "001_core_tables.sql",
    "002_kol_tables.sql",
    "003_supply_chain_tables.sql",
  ]);

  it("reports no differences when directory and table agree", () => {
    expect(diffMigrations(dir, [1, 2, 3])).toEqual({ unrecorded: [], unknownRecorded: [] });
  });

  it("reports directory migrations missing from the table", () => {
    const { unrecorded, unknownRecorded } = diffMigrations(dir, [1]);
    expect(unrecorded.map((f) => f.version)).toEqual([2, 3]);
    expect(unknownRecorded).toEqual([]);
  });

  it("reports recorded versions that have no file in the directory", () => {
    const { unrecorded, unknownRecorded } = diffMigrations(dir, [1, 2, 3, 99]);
    expect(unrecorded).toEqual([]);
    expect(unknownRecorded).toEqual([99]);
  });

  it("dedupes and sorts unknown recorded versions", () => {
    const { unknownRecorded } = diffMigrations(dir, [99, 5, 99, 1]);
    expect(unknownRecorded).toEqual([5, 99]);
  });

  it("handles an empty schema_migrations table (fresh 020)", () => {
    const { unrecorded } = diffMigrations(dir, []);
    expect(unrecorded.map((f) => f.version)).toEqual([1, 2, 3]);
  });
});
