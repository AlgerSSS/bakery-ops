// push-log.ts — 定时推送幂等日志（daily_push_log，migration 021）。
// 发送成功才写入；同 (kind, recipient, date) 已存在则调用方跳过发送。
import { query, execute } from "@/modules/shared/db/postgres";

export async function hasPushLog(kind: string, recipient: string, date: string): Promise<boolean> {
  const rows = await query<{ id: number }>(
    "SELECT id FROM daily_push_log WHERE kind = ? AND recipient = ? AND date = ? LIMIT 1",
    [kind, recipient, date],
  );
  return rows.length > 0;
}

/** 同 (kind, recipient) 任意日期已发过 —— "每人只提醒一次"类幂等（kind 内含实体 id，如 probation_<employeeId>）。 */
export async function hasPushLogAnyDate(kind: string, recipient: string): Promise<boolean> {
  const rows = await query<{ id: number }>(
    "SELECT id FROM daily_push_log WHERE kind = ? AND recipient = ? LIMIT 1",
    [kind, recipient],
  );
  return rows.length > 0;
}

export async function recordPushLog(kind: string, recipient: string, date: string): Promise<void> {
  await execute(
    "INSERT INTO daily_push_log (kind, recipient, date) VALUES (?, ?, ?) ON CONFLICT (kind, recipient, date) DO NOTHING",
    [kind, recipient, date],
  );
}
