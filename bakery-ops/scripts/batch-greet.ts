/**
 * Bulk-queue the English "choose 1 or 2" outbound greeting to a list of candidate numbers, and set up
 * each as an application + conversation (outbound_intro) so their 1/2 reply enters the funnel. Does NOT
 * touch the WhatsApp client — the RUNNING bot's outbound worker drains the queue under governance
 * (every 2 min, business-hours, daily cap, jitter).
 *   npx tsx scripts/batch-greet.ts
 */
import "dotenv/config";
import { storeRepository } from "../src/modules/data/repositories/store.repository";
import { applicationRepository } from "../src/modules/data/repositories/application.repository";
import { candidateConversationRepository } from "../src/modules/data/repositories/candidate-conversation.repository";
import { waOutboundQueueRepository } from "../src/modules/data/repositories/wa-outbound-queue.repository";

const STORE = "pavilion";

const RAW = [
  "601159618813", "60187898730", "601129233754", "60169445918", "+60122061276",
  "60163297423", "601110598027", "60138899986", "601116356291", "601137710908",
  "60176644429", "60149638153", "60163783834", "60142407806", "60199545496",
  "601116126010", "60142124261", "60109633065", "601115872064", "60165118552",
  "60175612700", "60183144781", "601126104278", "60136214500", "60166673586",
  "60103827226", "60123186756", "60172129130", "60195441600", "60182922059",
  "601129714577", "601133466211", "601121524711", "601136844186", "60182924489",
  "601114973808", "60198049729", "60128376810",
];

// Normalize to digits only (strip '+', spaces) and dedupe, preserving order.
const phones = Array.from(new Set(RAW.map((p) => p.replace(/\D/g, "")).filter(Boolean)));

async function main() {
  const store = await storeRepository.getByCode(STORE);
  if (!store) throw new Error(`store ${STORE} not found`);

  const body = [
    `Hi! This is ${store.name} 🧁 (bakery cafe at Pavilion, Bukit Bintang, KL).`,
    `We're hiring and would love to have you in for a short interview + trial shift.`,
    `Reply 1 to arrange a time, 2 for more info, or STOP to opt out.`,
  ].join("\n");

  let ok = 0;
  const failed: string[] = [];
  for (const phone of phones) {
    try {
      const application = await applicationRepository.createOrGet({
        store_id: STORE,
        phone,
        contact_status: "ready",
        source: "whatsapp_outbound",
      });
      if (!application) {
        failed.push(phone);
        continue;
      }
      await candidateConversationRepository.upsertState(
        STORE,
        phone,
        "AWAITING_INTERVIEW_CONFIRM",
        { stage: "outbound_intro", roleArea: application.role_area, unclearCount: 0 },
        application.id,
      );
      await waOutboundQueueRepository.enqueue(phone, body, {
        storeId: STORE,
        applicationId: application.id,
      });
      ok += 1;
    } catch (e) {
      failed.push(phone);
      console.error("enqueue failed", phone, (e as Error).message);
    }
  }

  console.log(JSON.stringify({ total: phones.length, queued: ok, failed }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
