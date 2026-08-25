#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildTaskSwitchState } from "../lib/task-switch.js";

const baseToken =
  process.env.HOTCRUSH_TASK_SWITCH_BASE_TOKEN ||
  "ZgQ4bYgRkaJKDUsj9mjjWMRupkd";
const tableId =
  process.env.HOTCRUSH_TASK_SWITCH_TABLE_ID || "tbl50MRrv8oDbReO";
const stateFile =
  process.env.HOTCRUSH_TASK_SWITCH_STATE ||
  "/var/lib/hotcrush-task-switch/state.json";

const result = spawnSync(
  "lark-cli",
  [
    "base",
    "+record-list",
    "--base-token",
    baseToken,
    "--table-id",
    tableId,
    "--format",
    "json",
    "--as",
    "user",
  ],
  { encoding: "utf8", timeout: 45_000, maxBuffer: 1024 * 1024 },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(
    `lark-cli task switch read failed with exit ${result.status}: ${result.stderr.trim()}`,
  );
}

const state = buildTaskSwitchState(JSON.parse(result.stdout));
mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o755 });
const temporaryFile = `${stateFile}.tmp`;
writeFileSync(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o644,
});
renameSync(temporaryFile, stateFile);
console.log(
  `[task-switch] synced ${Object.keys(state.tasks).length} managed tasks at ${state.syncedAt}.`,
);
