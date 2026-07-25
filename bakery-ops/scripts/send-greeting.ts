/**
 * One-off: queue the English "choose 1 or 2" outbound greeting to a candidate number, and set up the
 * application + conversation (outbound_intro stage) so their 1/2 reply enters the funnel. Does NOT touch
 * the WhatsApp client — the RUNNING bot's outbound worker (cron every 2 min, business-hours/cap governed)
 * drains the queue and sends it.
 *   npx tsx scripts/send-greeting.ts [phone]
 */
import "dotenv/config";
import { storeRepository } from "../src/modules/data/repositories/store.repository";
import { applicationRepository } from "../src/modules/data/repositories/application.repository";
import { candidateConversationRepository } from "../src/modules/data/repositories/candidate-conversation.repository";
import { waOutboundQueueRepository } from "../src/modules/data/repositories/wa-outbound-queue.repository";

const STORE = "pavilion";
const phone = (process.argv[2] || "60175437858").trim();

async function main() {
  const store = await storeRepository.getByCode(STORE);
  if (!store) throw new Error(`store ${STORE} not found`);

  const application = await applicationRepository.createOrGet({
    store_id: STORE,
    phone,
    contact_status: "ready",
    source: "whatsapp_outbound",
  });
  if (!application) throw new Error("failed to create/get application");

  await candidateConversationRepository.upsertState(
    STORE,
    phone,
    "AWAITING_INTERVIEW_CONFIRM",
    { stage: "outbound_intro", roleArea: application.role_area, unclearCount: 0 },
    application.id,
  );

  const body = [
    `Hi! This is ${store.name} 🧁 (bakery cafe at Pavilion, Bukit Bintang, KL).`,
    `We're hiring and would love to have you in for a short interview + trial shift.`,
    `Reply 1 to arrange a time, 2 for more info, or STOP to opt out.`,
  ].join("\n");

  await waOutboundQueueRepository.enqueue(phone, body, {
    storeId: STORE,
    applicationId: application.id,
  });

  console.log(JSON.stringify({ phone, applicationId: application.id, queued: true, body }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
