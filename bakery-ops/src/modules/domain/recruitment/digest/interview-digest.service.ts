// interview-digest.service.ts
//
// 21:00 (Asia/Kuala_Lumpur) nightly interview-result digest. For each active store, finds TODAY's
// first-interview appointments and sends SEPARATE numbered digests to the store manager (FOH/前场) and
// the head chef (kitchen_manager, BOH/后厨). Interviews with an unknown role_area go to BOTH.
//
// Each digest is a NUMBERED TEXT menu (no buttons): the recipient replies "<#> <1|2|3>" to record the
// 初面结论 (1=通过/pass, 2=备选/backup, 3=淘汰/reject). We persist a pending binding (kind='interview')
// keyed (store, recipient, date, kind) so the pre-router can interpret the reply and a restart won't
// double-send (idempotent: skip if a binding already exists for today).
//
// Mirrors trial-digest.service.ts. The reply handling (applyInterviewConclusion) lives in the pre-router.

import { logger } from "../../../shared/logger";
import { storeRepository, type StoreRow } from "../../../data/repositories/store.repository";
import { userRepository } from "../../../data/repositories/user.repository";
import { appointmentRepository, type AppointmentRow } from "../../../data/repositories/appointment.repository";
import { applicationRepository } from "../../../data/repositories/application.repository";
import { notifyInternal } from "../../../channel/internal-notify";
import { localDate } from "../../../channel/whatsapp/outbound.config";
import {
  hasBinding,
  putBinding,
  type DigestOption,
  type DigestBinding,
} from "./digest-binding.store";

/** An interview appointment enriched with its candidate name for the digest line. */
interface DigestInterview {
  appointment: AppointmentRow;
  candidateName: string;
}

type Recipient = "store_manager" | "kitchen_manager";

/** Entry point — registered on cron '0 21 * * *' in bootstrap. Safe no-op when nothing to send. */
export async function runInterviewDigest(): Promise<void> {
  logger.info("Interview digest: starting");

  const stores = await storeRepository.listActive();
  const today = localDate();

  for (const store of stores) {
    try {
      await runForStore(store, today);
    } catch (err) {
      logger.error("Interview digest: store failed", { store: store.store_code, error: String(err) });
    }
  }

  logger.info("Interview digest: done");
}

async function runForStore(store: StoreRow, today: string): Promise<void> {
  const appts = await appointmentRepository.getByStoreAndDate(store.store_code, today, "interview");
  if (appts.length === 0) return;

  const interviews: DigestInterview[] = [];
  for (const a of appts) {
    const app = await findApplication(store.store_code, a.application_id);
    interviews.push({ appointment: a, candidateName: app?.name || "(unknown)" });
  }

  // FOH interviews -> store manager; BOH -> chef; unknown role_area -> both.
  const foh = interviews.filter((t) => t.appointment.role_area === "FOH" || !t.appointment.role_area);
  const boh = interviews.filter((t) => t.appointment.role_area === "BOH" || !t.appointment.role_area);

  const { managerUserId, headChefUserId } = await storeRepository.getManagerAndChef(store.store_code);

  if (foh.length && managerUserId) {
    await sendDigest(store, "store_manager", managerUserId, foh, today);
  }
  if (boh.length && headChefUserId) {
    await sendDigest(store, "kitchen_manager", headChefUserId, boh, today);
  }
}

async function findApplication(storeCode: string, applicationId: string) {
  // Interview appointments imply the application is at 'first_interview'; scan that stage first.
  for (const stage of ["first_interview", "trial", "backup_pool", "rejected"] as const) {
    const rows = await applicationRepository.listByStoreStage(storeCode, stage);
    const hit = rows.find((r) => r.id === applicationId);
    if (hit) return hit;
  }
  return null;
}

async function sendDigest(
  store: StoreRow,
  role: Recipient,
  userId: string,
  interviews: DigestInterview[],
  today: string,
): Promise<void> {
  const user = await userRepository.getByUserId(userId);
  if (!user?.phone) {
    logger.warn("Interview digest: recipient has no phone", { store: store.store_code, role, userId });
    return;
  }

  // Idempotency: one interview digest per (store, recipient, local date).
  if (hasBinding(store.store_code, user.phone, today, "interview")) {
    logger.info("Interview digest: already sent today, skipping", {
      store: store.store_code,
      recipient: user.phone,
    });
    return;
  }

  const options: DigestOption[] = interviews.map((t, i) => ({
    optionIndex: i + 1,
    appointmentId: t.appointment.id,
    applicationId: t.appointment.application_id,
    larkRecordId: t.appointment.lark_record_id,
    candidateName: t.candidateName,
    roleArea: t.appointment.role_area,
  }));

  const text = buildDigestText(store, interviews);
  const sent = await notifyInternal(user.phone, text);
  if (!sent) {
    logger.error("Interview digest: send failed", { store: store.store_code, recipient: user.phone });
    return;
  }

  const binding: DigestBinding = {
    storeId: store.store_code,
    recipientPhone: user.phone,
    recipientUserId: userId,
    recipientRole: role,
    localDate: today,
    kind: "interview",
    options,
    createdAt: new Date().toISOString(),
  };
  putBinding(binding);
  logger.info("Interview digest: sent", { store: store.store_code, role, count: interviews.length });
}

/** Numbered, bilingual digest body listing today's interviews + the 初面结论 options. */
function buildDigestText(store: StoreRow, interviews: DigestInterview[]): string {
  const lines: string[] = [];

  lines.push(`【${store.name}】Today's interviews / 今日初面:`);
  interviews.forEach((t, i) => {
    const time = t.appointment.scheduled_for || "(time TBD / 待定)";
    lines.push(`${i + 1}. ${t.candidateName} — ${time}`);
  });
  lines.push("");
  lines.push(
    `Reply "<#> <result>" — result: 1=通过(pass) 2=备选(backup) 3=淘汰(reject). / ` +
      `回复"<编号> <结论>"，结论: 1=通过 2=备选 3=淘汰。`,
  );
  lines.push(`e.g. "1 1"`);
  lines.push(`（可直接在此回复，如 "3 1"）`);

  return lines.join("\n");
}
