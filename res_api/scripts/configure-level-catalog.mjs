#!/usr/bin/env node

import "dotenv/config";
import crypto from "node:crypto";

import {
  assertOk,
  exitCodeFor,
  openAuthedPage,
} from "../lib/report-client.js";
import {
  assertSafeL1RenameBaseline,
  buildLevelNamePayload,
  L1_LEGACY_NAME,
  L1_LEVEL_ID,
  L1_TARGET_NAME,
  levelMatchesRenamedTarget,
  stableLevelProjection,
} from "../lib/level-catalog-config.js";

const CONFIRMATION = "SEE_YOU_OFTEN_LEVEL_NAMES_V1";
const DETAILS_PATH = "/crm/memberSystem/web/levelProgram/level/details";
const MODIFY_PATH = "/crm/memberSystem/web/levelProgram/level/modify";

function usage() {
  return [
    "Usage:",
    "  npm run level-catalog:configure",
    `  npm run level-catalog:configure -- --apply --confirm=${CONFIRMATION}`,
    "",
    `Default mode is read-only. Apply mode renames only ${L1_LEGACY_NAME}`,
    `to ${L1_TARGET_NAME}, verifies the readback, and rolls back on failure.`,
  ].join("\n");
}

function parseArgs(argv) {
  if (argv.includes("--help")) return { help: true, apply: false };
  const known = new Set(["--apply", `--confirm=${CONFIRMATION}`]);
  const unknown = argv.find((arg) => !known.has(arg));
  if (unknown) throw new Error(`Unknown argument: ${unknown}`);
  const apply = argv.includes("--apply");
  if (apply && !argv.includes(`--confirm=${CONFIRMATION}`)) {
    throw new Error("Apply mode requires the exact confirmation phrase.");
  }
  return { help: false, apply };
}

const fingerprint = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function fetchLevel(session) {
  return assertOk(
    await session.call(DETAILS_PATH, { id: L1_LEVEL_ID }),
    "L1 level details",
  ).data;
}

async function readback(session, predicate) {
  let latest;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    latest = await fetchLevel(session);
    if (predicate(latest)) return latest;
    await session.page.waitForTimeout(500);
  }
  return latest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const session = await openAuthedPage({
    storageState: process.env.RES_STORAGE_STATE || "storageState.json",
    warmupPath: "/card-level",
    log: () => {},
  });
  try {
    const before = await fetchLevel(session);
    const alreadyTarget = before.name === L1_TARGET_NAME;
    const summary = {
      mode: args.apply ? "apply" : "read-only-preview",
      before: before.name,
      target: L1_TARGET_NAME,
      alreadyTarget,
    };
    if (!args.apply || alreadyTarget) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    assertSafeL1RenameBaseline(before);
    const target = buildLevelNamePayload(before, L1_TARGET_NAME);
    const rollback = buildLevelNamePayload(before, L1_LEGACY_NAME);
    const immediatelyBeforeWrite = await fetchLevel(session);
    if (
      fingerprint(stableLevelProjection(immediatelyBeforeWrite)) !==
      fingerprint(stableLevelProjection(before))
    ) {
      throw new Error("L1 changed concurrently; refusing mutation.");
    }

    assertOk(await session.call(MODIFY_PATH, target), "rename L1");
    const after = await readback(session, (level) =>
      levelMatchesRenamedTarget(level, before),
    );
    if (levelMatchesRenamedTarget(after, before)) {
      console.log(
        JSON.stringify(
          { ...summary, applied: true, rolledBack: false, after: after.name },
          null,
          2,
        ),
      );
      return;
    }

    let rollbackError;
    try {
      assertOk(await session.call(MODIFY_PATH, rollback), "rollback L1 name");
      const restored = await readback(
        session,
        (level) =>
          JSON.stringify(stableLevelProjection(level)) ===
          JSON.stringify(stableLevelProjection(before)),
      );
      if (
        JSON.stringify(stableLevelProjection(restored)) !==
        JSON.stringify(stableLevelProjection(before))
      ) {
        throw new Error("L1 rollback readback mismatch.");
      }
    } catch (error) {
      rollbackError = error;
    }
    if (rollbackError) {
      throw new Error(
        `L1 rename verification failed and rollback could not be verified: ${rollbackError.message}`,
      );
    }
    throw new Error("L1 rename verification failed; the original name was restored.");
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = exitCodeFor(error);
});
