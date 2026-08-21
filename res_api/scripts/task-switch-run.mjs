#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { taskSwitchDecision } from "../lib/task-switch.js";

const [taskCode, separator, command, ...commandArgs] = process.argv.slice(2);
if (!taskCode || separator !== "--" || !command) {
  console.error("Usage: task-switch-run.mjs <task-code> -- <command> [args...]");
  process.exit(64);
}

const stateFile =
  process.env.HOTCRUSH_TASK_SWITCH_STATE ||
  "/var/lib/hotcrush-task-switch/state.json";
let state;
try {
  state = JSON.parse(readFileSync(stateFile, "utf8"));
} catch {
  state = null;
}

let decision;
try {
  decision = taskSwitchDecision(state, taskCode);
} catch (error) {
  console.error(`[task-switch] ${error.message}`);
  process.exit(64);
}

if (!decision.enabled) {
  console.log(
    `[task-switch] skipped task=${taskCode} source=${decision.source}.`,
  );
  process.exit(0);
}

console.log(`[task-switch] allowed task=${taskCode} source=${decision.source}.`);
const child = spawn(command, commandArgs, { stdio: "inherit", env: process.env });
child.on("error", (error) => {
  console.error(`[task-switch] failed to start ${taskCode}: ${error.message}`);
  process.exit(70);
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 70);
});
