#!/usr/bin/env node

import "dotenv/config";
import crypto from "node:crypto";

import {
  assertOk,
  exitCodeFor,
  openAuthedPage,
} from "../lib/report-client.js";
import {
  assertSafePointsBaseline,
  buildPointsProgramRollback,
  buildPointsProgramTarget,
  pointsProgramMatchesTarget,
  summarizePointsProgram,
} from "../lib/points-program-config.js";

const CARD_PROGRAM_ID = "1991044916737863680";
const POINTS_PROGRAM_ID = "1991044916763029509";
const CONFIRMATION = "SEE_YOU_OFTEN_POINTS_V1";
const DETAILS_PATH = "/crm/memberSystem/web/pointsProgram/details";
const MODIFY_PATH = "/crm/memberSystem/web/pointsProgram/modify";

function usage() {
  return [
    "Usage:",
    "  npm run points-program:configure",
    `  npm run points-program:configure -- --apply --confirm=${CONFIRMATION}`,
    "",
    "Default mode is read-only. Apply mode verifies the audited baseline,",
    "checks for concurrent changes, writes once, reads back, and rolls back",
    "automatically if the target state cannot be verified.",
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
      memberProgramId: null,
    }),
    "points program details",
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

  const storageState = process.env.RES_STORAGE_STATE || "storageState.json";
  const session = await openAuthedPage({
    storageState,
    warmupPath: "/member-overview",
    log: () => {},
  });

  try {
    const before = await fetchDetails(session);
    const target = buildPointsProgramTarget(before);
    const summary = {
      mode: args.apply ? "apply" : "read-only-preview",
      before: summarizePointsProgram(before),
      target: summarizePointsProgram(target),
      alreadyTarget: pointsProgramMatchesTarget(before),
    };

    if (!args.apply || summary.alreadyTarget) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    assertSafePointsBaseline(before, {
      pointsProgramId: POINTS_PROGRAM_ID,
      cardProgramId: CARD_PROGRAM_ID,
    });
    const rollback = buildPointsProgramRollback(before);

    const immediatelyBeforeWrite = await fetchDetails(session);
    if (fingerprint(immediatelyBeforeWrite) !== fingerprint(before)) {
      throw new Error("Points program changed concurrently; refusing mutation.");
    }

    assertOk(await session.call(MODIFY_PATH, target), "update points program");
    const after = await readback(session, pointsProgramMatchesTarget);
    if (pointsProgramMatchesTarget(after)) {
      console.log(
        JSON.stringify(
          {
            ...summary,
            applied: true,
            rolledBack: false,
            after: summarizePointsProgram(after),
          },
          null,
          2,
        ),
      );
      return;
    }

    let rollbackError;
    try {
      assertOk(
        await session.call(MODIFY_PATH, rollback),
        "rollback points program",
      );
      const restored = await readback(session, (program) => {
        try {
          assertSafePointsBaseline(program, {
            pointsProgramId: POINTS_PROGRAM_ID,
            cardProgramId: CARD_PROGRAM_ID,
          });
          return true;
        } catch {
          return false;
        }
      });
      assertSafePointsBaseline(restored, {
        pointsProgramId: POINTS_PROGRAM_ID,
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
    throw new Error("Target verification failed; the original configuration was restored.");
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = exitCodeFor(error);
});
