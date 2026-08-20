#!/usr/bin/env node

import "dotenv/config";
import crypto from "node:crypto";

import {
  assertOk,
  exitCodeFor,
  openAuthedPage,
} from "../lib/report-client.js";
import {
  assertSafeLevelProgramBaseline,
  buildLevelProgramRollback,
  buildLevelProgramTarget,
  levelProgramMatchesTarget,
  summarizeLevelProgram,
} from "../lib/level-program-config.js";

const CARD_PROGRAM_ID = "1991044916737863680";
const LEVEL_PROGRAM_ID = "1998685858366095366";
const CONFIRMATION = "SEE_YOU_OFTEN_GROWTH_V1";
const DETAILS_PATH = "/crm/memberSystem/web/levelProgram/details";
const MODIFY_PATH = "/crm/memberSystem/web/levelProgram/modify";

function usage() {
  return [
    "Usage:",
    "  npm run level-program:configure",
    `  npm run level-program:configure -- --apply --confirm=${CONFIRMATION}`,
    "",
    "Default mode is read-only. Apply mode changes only the audited purchase",
    "growth rule from RM0.01 = 1 growth to RM1 = 1 growth, verifies the",
    "readback, and restores the original rule if verification fails.",
  ].join("\n");
}

function parseArgs(argv) {
  if (argv.includes("--help")) return { help: true, apply: false };
  const known = new Set(["--apply", `--confirm=${CONFIRMATION}`]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  const apply = argv.includes("--apply");
  if (apply && !argv.includes(`--confirm=${CONFIRMATION}`)) {
    throw new Error("Apply mode requires the exact confirmation phrase.");
  }
  return { help: false, apply };
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function fetchDetails(session) {
  return assertOk(
    await session.call(DETAILS_PATH, {
      cardProgramId: CARD_PROGRAM_ID,
      memberProgramId: "",
    }),
    "level program details",
  ).data;
}

async function readback(session, predicate) {
  let latest;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    latest = await fetchDetails(session);
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
    const before = await fetchDetails(session);
    const target = buildLevelProgramTarget(before);
    const summary = {
      mode: args.apply ? "apply" : "read-only-preview",
      before: summarizeLevelProgram(before),
      target: summarizeLevelProgram({ ...before, ...target }),
      alreadyTarget: levelProgramMatchesTarget(before),
    };
    if (!args.apply || summary.alreadyTarget) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    assertSafeLevelProgramBaseline(before, {
      levelProgramId: LEVEL_PROGRAM_ID,
      cardProgramId: CARD_PROGRAM_ID,
    });
    const rollback = buildLevelProgramRollback(before);
    const immediatelyBeforeWrite = await fetchDetails(session);
    if (fingerprint(immediatelyBeforeWrite) !== fingerprint(before)) {
      throw new Error("Level program changed concurrently; refusing mutation.");
    }

    assertOk(await session.call(MODIFY_PATH, target), "update level program");
    const after = await readback(session, levelProgramMatchesTarget);
    if (levelProgramMatchesTarget(after)) {
      console.log(
        JSON.stringify(
          {
            ...summary,
            applied: true,
            rolledBack: false,
            after: summarizeLevelProgram(after),
          },
          null,
          2,
        ),
      );
      return;
    }

    let rollbackError;
    try {
      assertOk(await session.call(MODIFY_PATH, rollback), "rollback level program");
      const restored = await readback(session, (program) => {
        try {
          assertSafeLevelProgramBaseline(program, {
            levelProgramId: LEVEL_PROGRAM_ID,
            cardProgramId: CARD_PROGRAM_ID,
          });
          return true;
        } catch {
          return false;
        }
      });
      assertSafeLevelProgramBaseline(restored, {
        levelProgramId: LEVEL_PROGRAM_ID,
        cardProgramId: CARD_PROGRAM_ID,
      });
    } catch (error) {
      rollbackError = error;
    }
    if (rollbackError) {
      throw new Error(
        `Target verification failed and rollback could not be verified: ${rollbackError.message}`,
      );
    }
    throw new Error("Target verification failed; the original rule was restored.");
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = exitCodeFor(error);
});
