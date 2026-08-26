import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readVulcanTokenFromStorageState } from "../lib/storage-state-token.js";

function withState(value, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "res-token-"));
  const file = path.join(dir, "storageState.json");
  fs.writeFileSync(file, JSON.stringify(value));
  try {
    return run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("reads a plain vulcan token without opening a browser", () => {
  withState(
    {
      origins: [
        {
          origin: "https://bo.sea.restosuite.ai",
          localStorage: [{ name: "vulcan-Token", value: "x".repeat(40) }],
        },
      ],
    },
    (file) => assert.equal(readVulcanTokenFromStorageState(file), "x".repeat(40)),
  );
});

test("unwraps a JSON encoded token", () => {
  withState(
    {
      origins: [
        {
          origin: "https://bo.sea.restosuite.ai",
          localStorage: [
            { name: "vulcan-token", value: JSON.stringify({ token: "y".repeat(40) }) },
          ],
        },
      ],
    },
    (file) => assert.equal(readVulcanTokenFromStorageState(file), "y".repeat(40)),
  );
});

test("fails closed for a missing or short token", () => {
  withState({ origins: [] }, (file) =>
    assert.throws(
      () => readVulcanTokenFromStorageState(file),
      /does not contain a usable vulcan token/,
    ),
  );
});
