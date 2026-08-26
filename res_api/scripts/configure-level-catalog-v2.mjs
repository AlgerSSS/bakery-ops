#!/usr/bin/env node

import "dotenv/config";
import crypto from "node:crypto";

import { assertOk, exitCodeFor } from "../lib/report-client.js";
import { createResHttpClientFromEnv } from "../lib/res-http-client.js";
import {
  LEVEL_CATALOG_V2,
  LEVEL_PROGRAM_ID,
  assertExistingLevelBaseline,
  buildL5CreatePayload,
  buildLevelModifyPayload,
  l5MatchesTarget,
} from "../lib/level-catalog-v2.js";

const CONFIRMATION = "SEE_YOU_OFTEN_FIVE_LEVELS_V2";
const LIST_PATH = "/crm/memberSystem/web/levelProgram/level/list";
const DETAILS_PATH = "/crm/memberSystem/web/levelProgram/level/details";
const CHECK_NAME_PATH = "/crm/memberSystem/web/levelProgram/level/checkName";
const CREATE_PATH = "/crm/memberSystem/web/levelProgram/level/create";
const MODIFY_PATH = "/crm/memberSystem/web/levelProgram/level/modify";

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

async function levelList(client) {
  return assertOk(
    await client.call(LIST_PATH, { levelProgramId: LEVEL_PROGRAM_ID }),
    "level list",
  ).data;
}

async function details(client, id) {
  return assertOk(await client.call(DETAILS_PATH, { id }), "level details").data;
}

async function waitFor(client, predicate) {
  let list = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    list = await levelList(client);
    const found = list.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      `Usage: node scripts/configure-level-catalog-v2.mjs [--apply --confirm=${CONFIRMATION}]`,
    );
    return;
  }
  const client = createResHttpClientFromEnv({
    storageState: process.env.RES_STORAGE_STATE || "storageState.json",
  });
  const listBefore = await levelList(client);
  const detailsBefore = [];
  for (const configured of LEVEL_CATALOG_V2.slice(0, 4)) {
    const live = await details(client, configured.id);
    assertExistingLevelBaseline(live, configured);
    detailsBefore.push(live);
  }
  const existingL5 = listBefore.filter(
    (level) => level.name === LEVEL_CATALOG_V2[4].targetName,
  );
  if (existingL5.length > 1) throw new Error("More than one Diamond Crush level exists.");
  if (existingL5.length === 1) {
    const liveL5 = await details(client, existingL5[0].id);
    if (!l5MatchesTarget(liveL5)) throw new Error("Existing L5 does not match the approved target.");
  }

  const summary = {
    mode: args.apply ? "apply" : "read-only-preview",
    before: listBefore.map((level) => ({
      id: String(level.id),
      name: level.name,
      threshold: Number(level.upgradeGrowth || 0),
    })),
    target: LEVEL_CATALOG_V2.map((level) => ({
      key: level.key,
      name: level.targetName,
      threshold: level.threshold,
    })),
  };
  if (!args.apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const changed = [];
  try {
    for (let index = 0; index < 4; index += 1) {
      const configured = LEVEL_CATALOG_V2[index];
      const before = detailsBefore[index];
      const current = await details(client, configured.id);
      if (fingerprint(current) !== fingerprint(before)) {
        throw new Error(`${configured.key} changed concurrently; refusing mutation.`);
      }
      if (current.name === configured.targetName) continue;
      assertOk(
        await client.call(
          MODIFY_PATH,
          buildLevelModifyPayload(current, configured.targetName),
        ),
        `rename ${configured.key}`,
      );
      const renamed = await details(client, configured.id);
      if (renamed.name !== configured.targetName) {
        throw new Error(`${configured.key} rename readback mismatch.`);
      }
      changed.push({ before, configured });
    }

    let l5 = existingL5[0] ?? null;
    if (!l5) {
      const checked = await client.call(CHECK_NAME_PATH, {
        name: LEVEL_CATALOG_V2[4].targetName,
        levelProgramId: LEVEL_PROGRAM_ID,
      });
      assertOk(checked, "check L5 name");
      assertOk(
        await client.call(CREATE_PATH, buildL5CreatePayload(detailsBefore[3])),
        "create L5",
      );
      l5 = await waitFor(
        client,
        (level) => level.name === LEVEL_CATALOG_V2[4].targetName,
      );
      if (!l5) throw new Error("L5 creation was accepted but readback did not appear.");
    }
    const liveL5 = await details(client, l5.id);
    if (!l5MatchesTarget(liveL5)) {
      throw new Error("L5 readback does not match the approved target.");
    }
    const after = await levelList(client);
    console.log(
      JSON.stringify(
        {
          ...summary,
          applied: true,
          l5Id: String(liveL5.id),
          after: after.map((level) => ({
            id: String(level.id),
            name: level.name,
            threshold: Number(level.upgradeGrowth || 0),
          })),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    for (const { before, configured } of changed.reverse()) {
      try {
        assertOk(
          await client.call(
            MODIFY_PATH,
            buildLevelModifyPayload(before, before.name),
          ),
          `rollback ${configured.key}`,
        );
      } catch {
        // The original error remains primary; the operator must inspect readback.
      }
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = exitCodeFor(error) || 1;
});
