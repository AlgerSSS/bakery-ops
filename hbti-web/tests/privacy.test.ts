import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
]);

describe("repository privacy gate", () => {
  it("does not contain the authorized acceptance member's raw phone", () => {
    const forbiddenPhone = ["186", "3062", "6817"].join("");
    const files = [
      ...walk(join(process.cwd(), "src")),
      ...walk(join(process.cwd(), "tests")),
      ...walk(join(process.cwd(), "scripts")),
      join(process.cwd(), ".env.example"),
    ];
    const matches = files.filter((file) =>
      readFileSync(file, "utf8").includes(forbiddenPhone),
    );

    expect(matches).toEqual([]);
  });
});

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return walk(path);
    }
    const dot = entry.lastIndexOf(".");
    return dot >= 0 && TEXT_EXTENSIONS.has(entry.slice(dot))
      ? [path]
      : [];
  });
}
