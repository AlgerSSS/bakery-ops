// trial-digest.service.ts
//
// 23:00 (Asia/Kuala_Lumpur) nightly trial digest. For each active store, finds tomorrow's trial
// appointments and sends SEPARATE numbered digests to the store manager (FOH/前场 trials) and the head
// chef (kitchen_manager, BOH/后厨 trials). Trials with an unknown role_area go to BOTH.
//
// Each digest is a NUMBERED TEXT menu (no buttons): the recipient replies with a number to confirm a
// trial and specify the 岗位/站位. We persist a pending binding (digest-binding.store) keyed
// (store, recipient, date) so (a) the pre-router can interpret the reply and (b) a restart won't
// double-send (idempotent: skip if a binding already exists for today).
//
// Templates are tri-lingual (EN / 中文 / BM).

import { logger } from "../../../shared/logger";
import { storeRepository, type StoreRow } from "../../../data/repositories/store.repository";
import { userRepository } from "../../../data/repositories/user.repository";
import { appointmentRepository, type AppointmentRow } from "../../../data/repositories/appointment.repository";
import { applicationRepository } from "../../../data/repositories/application.repository";
import { notifyInternal } from "../../../channel/internal-notify";
import { POSITIONS } from "../recruitment-vocab";
import { localDate } from "../../../channel/whatsapp/outbound.config";
import {
  hasBinding,
  putBinding,
  type DigestOption,
  type DigestBinding,
} from "./digest-binding.store";

/** A trial appointment enriched with its candidate name for the digest line. */
interface DigestTrial {
  appointment: AppointmentRow;
  candidateName: string;
}

type Recipient = "store_manager" | "kitchen_manager";

/** Entry point — registered on cron '0 23 * * *' in bootstrap. Safe no-op when nothing to send. */
export async function runTrialDigest(): Promise<void> {
  logger.info("Trial digest: starting");

  const stores = await storeRepository.listActive();
  const today = localDate();

  for (const store of stores) {
    try {
      await runForStore(store, today);
    } catch (err) {
      logger.error("Trial digest: store failed", { store: store.store_code, error: String(err) });
    }
  }

  logger.info("Trial digest: done");
}

async function runForStore(store: StoreRow, today: string): Promise<void> {
  const appts = await appointmentRepository.getNextDayTrials(store.store_code);
  if (appts.length === 0) return;

  // Enrich each appointment with its candidate name (from the linked application).
  const trials: DigestTrial[] = [];
  for (const a of appts) {
    const app = await findApplication(store.store_code, a.application_id);
    trials.push({ appointment: a, candidateName: app?.name || "(unknown)" });
  }

  // FOH trials -> store manager; BOH trials -> chef; unknown role_area -> both.
  const fohTrials = trials.filter((t) => t.appointment.role_area === "FOH" || !t.appointment.role_area);
  const bohTrials = trials.filter((t) => t.appointment.role_area === "BOH" || !t.appointment.role_area);

  const { managerUserId, headChefUserId } = await storeRepository.getManagerAndChef(store.store_code);

  if (fohTrials.length && managerUserId) {
    await sendDigest(store, "store_manager", managerUserId, "FOH", fohTrials, today);
  }
  if (bohTrials.length && headChefUserId) {
    await sendDigest(store, "kitchen_manager", headChefUserId, "BOH", bohTrials, today);
  }
}

async function findApplication(storeCode: string, applicationId: string) {
  // applications have no findById helper; we list the relevant stages and match by id.
  // Trial appointments imply the application is at/after 'trial', so scan that stage first.
  for (const stage of ["trial", "first_interview", "post_trial_interview"] as const) {
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
  area: "FOH" | "BOH",
  trials: DigestTrial[],
  today: string,
): Promise<void> {
  const user = await userRepository.getByUserId(userId);
  if (!user?.phone) {
    logger.warn("Trial digest: recipient has no phone", { store: store.store_code, role, userId });
    return;
  }

  // Idempotency: one digest per (store, recipient, local date). A restart re-running the 23:00 job
  // won't re-send because the binding already exists.
  if (hasBinding(store.store_code, user.phone, today)) {
    logger.info("Trial digest: already sent today, skipping", {
      store: store.store_code,
      recipient: user.phone,
    });
    return;
  }

  const options: DigestOption[] = trials.map((t, i) => ({
    optionIndex: i + 1,
    appointmentId: t.appointment.id,
    applicationId: t.appointment.application_id,
    larkRecordId: t.appointment.lark_record_id,
    candidateName: t.candidateName,
    roleArea: t.appointment.role_area,
  }));

  const text = buildDigestText(store, area, trials);
  const sent = await notifyInternal(user.phone, text);
  if (!sent) {
    logger.error("Trial digest: send failed", { store: store.store_code, recipient: user.phone });
    return;
  }

  const binding: DigestBinding = {
    storeId: store.store_code,
    recipientPhone: user.phone,
    recipientUserId: userId,
    recipientRole: role,
    localDate: today,
    kind: "trial",
    options,
    createdAt: new Date().toISOString(),
  };
  putBinding(binding);
  logger.info("Trial digest: sent", { store: store.store_code, role, count: trials.length });
}

/** Numbered, tri-lingual digest body listing tomorrow's trials + the 岗位/站位 options for the area. */
function buildDigestText(store: StoreRow, area: "FOH" | "BOH", trials: DigestTrial[]): string {
  const lines: string[] = [];
  const positions = POSITIONS[area];

  lines.push(`【${store.name}】Trials tomorrow / 明日试工 / Trial esok:`);
  trials.forEach((t, i) => {
    const time = t.appointment.scheduled_for || "(time TBD / 待定)";
    lines.push(`${i + 1}. ${t.candidateName} — ${time}`);
  });
  lines.push("");
  lines.push(
    `Reply with the number to confirm a trial and specify the station. / ` +
      `回复数字确认试工并指定岗位/站位。/ Balas nombor untuk sahkan & pilih stesen.`,
  );
  lines.push("");
  lines.push(`岗位/站位 (${area}):`);
  positions.forEach((p, i) => lines.push(`  ${i + 1}) ${p}`));
  lines.push("");
  lines.push(`Format: <trial #> <station #>   e.g. "1 2"`);
  lines.push(`（可直接在此回复，如 "3 1"）`);

  return lines.join("\n");
}
