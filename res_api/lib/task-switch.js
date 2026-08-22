export const MANAGED_TASK_CODES = Object.freeze([
  "birthday_reservation_lark_notify",
  "recruit_morning_report",
  "recruit_tomorrow_preview",
  "weekly_executive_report",
  "member_email_job",
  "member_day_topup",
]);

function columnIndex(fields, name) {
  const index = fields.indexOf(name);
  if (index === -1) throw new Error(`Task switch table is missing ${name}.`);
  return index;
}

function singleSelectValue(value) {
  if (Array.isArray(value) && value.length === 1) return value[0];
  return value;
}

export function buildTaskSwitchState(
  envelope,
  { syncedAt = new Date().toISOString() } = {},
) {
  if (envelope?.ok !== true) {
    throw new Error("Lark task switch read did not return ok=true.");
  }
  const fields = envelope.data?.fields;
  const rows = envelope.data?.data;
  if (!Array.isArray(fields) || !Array.isArray(rows)) {
    throw new Error("Lark task switch response has an invalid data shape.");
  }

  const codeIndex = columnIndex(fields, "任务代码");
  const modeIndex = columnIndex(fields, "管理模式");
  const enabledIndex = columnIndex(fields, "启用");
  const expected = new Set(MANAGED_TASK_CODES);
  const tasks = {};

  for (const row of rows) {
    const code = `${row?.[codeIndex] ?? ""}`.trim();
    if (!expected.has(code)) continue;
    if (singleSelectValue(row[modeIndex]) !== "表格开关") {
      throw new Error(`${code} is not marked as 表格开关.`);
    }
    if (Object.hasOwn(tasks, code)) {
      throw new Error(`Duplicate task switch row: ${code}.`);
    }
    if (typeof row[enabledIndex] !== "boolean") {
      throw new Error(`${code} does not have a boolean 启用 value.`);
    }
    tasks[code] = row[enabledIndex];
  }

  const missing = MANAGED_TASK_CODES.filter((code) => !Object.hasOwn(tasks, code));
  if (missing.length) {
    throw new Error(`Task switch rows are missing: ${missing.join(", ")}.`);
  }

  return { version: 1, syncedAt, tasks };
}

export function taskSwitchDecision(state, code) {
  if (!MANAGED_TASK_CODES.includes(code)) {
    throw new Error(`Unknown managed task code: ${code}.`);
  }
  if (
    state?.version !== 1 ||
    !state.tasks ||
    typeof state.tasks[code] !== "boolean"
  ) {
    return { enabled: false, source: "missing-or-invalid-cache" };
  }
  return { enabled: state.tasks[code], source: "lark-last-known-state" };
}
