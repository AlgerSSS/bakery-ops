// appointment-reminder.service.ts — 面试/试工当日早晨提醒候选人（IMPROVEMENT-PLAN.md F11）。
//
// 9:00 (Asia/Kuala_Lumpur) cron：查当天 status='confirmed' 的 interview/trial appointment，给候选人
// 发提醒"回复 1 确认到场"。只发暖号码——候选人 application 必须 contact_status='ready'（已建立
// WhatsApp 对话），needs_manual（JobStreet 落库、从未对话）一律跳过，绝不冷发。
// scheduled_for 为 NULL 的跳过并 logger.info。
// 幂等：daily_push_log (kind='appt_reminder', recipient=候选人电话, date=今天)，发送成功才写。

import { logger } from "../../shared/logger";
import { isClientConnected, sendTextTo } from "../../channel/whatsapp/whatsapp.client";
import { localDate, OUTBOUND_TZ } from "../../channel/whatsapp/outbound.config";
import { storeRepository, type StoreRow } from "../../data/repositories/store.repository";
import {
  appointmentRepository,
  type AppointmentKind,
  type AppointmentRow,
} from "../../data/repositories/appointment.repository";
import { applicationRepository } from "../../data/repositories/application.repository";
import { hasPushLog, recordPushLog } from "../notifications/push-log";

const PUSH_KIND = "appt_reminder";

/** scheduled_for（timestamptz ::text，如 "2026-07-02 10:30:00+08"）→ KL 当地 HH:mm。解析失败时原样返回。 */
export function formatApptTime(scheduledFor: string): string {
  // Postgres ::text 的时区偏移不带分钟（"+08"），Date 只认 "+08:00"，补齐后再解析。
  let iso = scheduledFor.replace(" ", "T");
  if (/[+-]\d{2}$/.test(iso)) iso += ":00";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return scheduledFor;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: OUTBOUND_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** 提醒文本：时间 + 门店 + 面试/试工 + 回 1 确认到场。 */
export function buildAppointmentReminderText(
  kind: AppointmentKind,
  time: string,
  storeName: string,
): string {
  const what = kind === "interview" ? "面试" : "试工";
  return `提醒：您今天 ${time} 在 ${storeName}有${what}，回复 1 确认到场；如需改期请直接回复说明。`;
}

/** 入口 — 9:00 cron。未连接/无确认预约时安全 no-op。 */
export async function runAppointmentReminder(): Promise<void> {
  if (!(await isClientConnected())) {
    logger.info("Appointment reminder: WhatsApp client not connected, skipping this run");
    return;
  }

  const today = localDate();
  const stores = await storeRepository.listActive();

  for (const store of stores) {
    for (const kind of ["interview", "trial"] as const) {
      const appts = await appointmentRepository.getByStoreAndDate(store.store_code, today, kind);
      for (const appt of appts) {
        if (appt.status !== "confirmed") continue;
        try {
          await remindOne(store, appt, today);
        } catch (err) {
          logger.error("Appointment reminder: appointment failed", {
            appointmentId: appt.id,
            error: String(err),
          });
        }
      }
    }
  }
}

async function remindOne(store: StoreRow, appt: AppointmentRow, today: string): Promise<void> {
  if (!appt.scheduled_for) {
    logger.info("Appointment reminder: no scheduled_for, skipping", { appointmentId: appt.id });
    return;
  }

  const application = await applicationRepository.findById(appt.application_id);
  if (!application?.phone || application.contact_status !== "ready") {
    logger.info("Appointment reminder: candidate has no warm number, skipping", {
      appointmentId: appt.id,
      contactStatus: application?.contact_status,
    });
    return;
  }

  if (await hasPushLog(PUSH_KIND, application.phone, today)) {
    logger.info("Appointment reminder: already sent today, skipping", { recipient: application.phone });
    return;
  }

  const text = buildAppointmentReminderText(appt.kind, formatApptTime(appt.scheduled_for), store.name);
  const sent = await sendTextTo(application.phone, text);
  if (!sent.ok) {
    logger.error("Appointment reminder: send failed", { recipient: application.phone, error: sent.error });
    return;
  }

  await recordPushLog(PUSH_KIND, application.phone, today);
  logger.info("Appointment reminder: sent", { recipient: application.phone, kind: appt.kind });
}
