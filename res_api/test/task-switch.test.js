import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildTaskSwitchState,
  MANAGED_TASK_CODES,
  taskSwitchDecision,
} from "../lib/task-switch.js";

function envelope(overrides = {}) {
  const fields = ["任务代码", "任务名称", "管理模式", "启用"];
  const rows = MANAGED_TASK_CODES.map((code) => [
    code,
    code,
    ["表格开关"],
    overrides[code] ?? true,
  ]);
  rows.push(["res_daily_refresh", "RES 每日全量刷新", "仅查看", true]);
  return { ok: true, data: { fields, data: rows } };
}

test("task switch rows become a complete last-known state", () => {
  const state = buildTaskSwitchState(
    envelope({ recruit_morning_report: false }),
    { syncedAt: "2026-08-21T10:00:00.000Z" },
  );

  assert.equal(state.version, 1);
  assert.equal(state.syncedAt, "2026-08-21T10:00:00.000Z");
  assert.equal(state.tasks.recruit_morning_report, false);
  assert.equal(state.tasks.member_email_job, true);
  assert.equal(Object.hasOwn(state.tasks, "res_daily_refresh"), false);
});

test("missing, duplicate and non-boolean managed rows fail without a new cache", () => {
  const missing = envelope();
  missing.data.data.shift();
  assert.throws(() => buildTaskSwitchState(missing), /rows are missing/i);

  const duplicate = envelope();
  duplicate.data.data.push([...duplicate.data.data[0]]);
  assert.throws(() => buildTaskSwitchState(duplicate), /duplicate/i);

  const invalid = envelope();
  invalid.data.data[0][3] = "yes";
  assert.throws(() => buildTaskSwitchState(invalid), /boolean/i);
});

test("runner uses cached decisions and fails closed without a valid cache", () => {
  const state = buildTaskSwitchState(envelope());
  assert.deepEqual(taskSwitchDecision(state, "recruit_morning_report"), {
    enabled: true,
    source: "lark-last-known-state",
  });
  assert.deepEqual(taskSwitchDecision(null, "recruit_morning_report"), {
    enabled: false,
    source: "missing-or-invalid-cache",
  });
  assert.throws(
    () => taskSwitchDecision(state, "res_daily_refresh"),
    /unknown managed task code/i,
  );
});

test("only the five approved push jobs are wrapped by Lark switches", () => {
  const files = [
    "../task-switch-recruit.cron.example",
    "../task-switch-birthday.cron.example",
    "../task-switch-root.crontab.example",
    "../member-email.cron.example",
  ].map((file) => readFileSync(new URL(file, import.meta.url), "utf8"));
  const combined = files.join("\n");

  for (const code of MANAGED_TASK_CODES) {
    assert.match(combined, new RegExp(`task-switch-run\\.mjs ${code} --`));
  }
  assert.doesNotMatch(
    files[0],
    /task-switch-run\.mjs recruit_(?:demand|funnel)_sync/,
  );
  assert.match(files[0], /python3 recruit_demand_sync\.py/);
  assert.match(files[0], /python3 recruit_funnel_sync\.py/);
});
