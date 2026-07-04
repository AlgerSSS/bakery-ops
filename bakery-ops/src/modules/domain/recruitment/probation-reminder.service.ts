// probation-reminder.service.ts — 试用期转正提醒（IMPROVEMENT-PLAN.md F13）。
//
// runProbationReminder()（本文件不接 cron，需接线 agent 配 9:00 KL cron）：
// 查 employees status='hired' 且 hired_at 距今落在 [PROBATION_DAYS-10, PROBATION_DAYS] 天
// （env PROBATION_DAYS，默认 90）、employee_events 无 probation_passed 的员工，
// 推老板 (OWNER_WHATSAPP) 一条提醒；老板回"XX 试用期通过"走现有 employee_management 落库。
// 幂等：daily_push_log kind='probation_'+employeeId，date 放今天；hasPushLogAnyDate 保证每人只提醒一次。

import { query } from "@/modules/shared/db/postgres";
import { logger } from "@/modules/shared/logger";
import { notifyInternal } from "@/modules/channel/internal-notify";
import { localDate } from "@/modules/channel/whatsapp/outbound.config";
import { hasPushLogAnyDate, recordPushLog } from "../notifications/push-log";

const DEFAULT_PROBATION_DAYS = 90;
const WINDOW_DAYS = 10; // 提醒窗口宽度：[PROBATION_DAYS-10, PROBATION_DAYS]

/** env PROBATION_DAYS（默认 90）。 */
export function probationDays(): number {
  const n = Number(process.env.PROBATION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PROBATION_DAYS;
}

/** 纯函数：入职至今天数是否落在提醒窗口 [days-10, days]（含两端）。无效日期返回 false。 */
export function isInProbationWindow(
  hiredAt: string,
  now: Date = new Date(),
  days: number = probationDays(),
): boolean {
  const hired = new Date(hiredAt);
  if (Number.isNaN(hired.getTime())) return false;
  const elapsedDays = Math.floor((now.getTime() - hired.getTime()) / 86_400_000);
  return elapsedDays >= days - WINDOW_DAYS && elapsedDays <= days;
}

/** 固定中文模板（纯函数）。 */
export function buildProbationReminderText(name: string): string {
  return `${name} 入职将满 3 个月，尚未记录转正，请评估（直接回复"${name} 试用期通过"即可登记）`;
}

interface DueEmployeeRow {
  id: string;
  name: string;
  hired_at: string;
}

/** 入口 — 接线 agent 配 cron。无数据/未连接/无 OWNER_WHATSAPP 时安全 no-op。 */
export async function runProbationReminder(): Promise<void> {
  const owner = process.env.OWNER_WHATSAPP || process.env.OWNER_PHONE || "";
  if (!owner) {
    logger.warn("Probation reminder: OWNER_WHATSAPP not configured, skipping");
    return;
  }

  let rows: DueEmployeeRow[];
  try {
    rows = await query<DueEmployeeRow>(
      `SELECT e.id, e.name, e.hired_at::text AS hired_at
       FROM employees e
       WHERE e.status = 'hired' AND e.hired_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM employee_events ev
           WHERE ev.employee_id = e.id AND ev.event_type = 'probation_passed'
         )`,
    );
  } catch (err) {
    logger.error("Probation reminder: employee query failed", { error: String(err) });
    return;
  }

  const due = rows.filter((r) => isInProbationWindow(r.hired_at));
  if (due.length === 0) return;

  const today = localDate();
  for (const emp of due) {
    const kind = `probation_${emp.id}`;
    try {
      if (await hasPushLogAnyDate(kind, owner)) continue; // 每人只提醒一次
      const sent = await notifyInternal(owner, buildProbationReminderText(emp.name));
      if (sent) {
        await recordPushLog(kind, owner, today);
        logger.info("Probation reminder: sent", { employeeId: emp.id, name: emp.name });
      } else {
        logger.error("Probation reminder: send failed", { employeeId: emp.id });
      }
    } catch (err) {
      logger.error("Probation reminder: employee failed", { employeeId: emp.id, error: String(err) });
    }
  }
}
