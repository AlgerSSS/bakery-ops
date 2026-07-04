/**
 * Hold the batch: delete ONLY the still-queued outbound rows for the 38 batch numbers, so a later bot
 * restart won't auto-resume cold-sending them. Leaves 'sent' rows (the ledger), applications, and
 * candidate_conversations untouched — candidates can still reply, and the batch can be re-enqueued via
 * scripts/batch-greet.ts.
 *   npx tsx scripts/clear-queued.ts
 */
import "dotenv/config";
import { execute, query } from "../src/modules/shared/db/postgres";

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
const phones = Array.from(new Set(RAW.map((p) => p.replace(/\D/g, "")).filter(Boolean)));

async function main() {
  const placeholders = phones.map(() => "?").join(",");
  const before = await query<any>(
    `SELECT status, count(*)::int n FROM wa_outbound_queue WHERE phone IN (${placeholders}) GROUP BY status`,
    phones,
  );
  await execute(
    `DELETE FROM wa_outbound_queue WHERE status='queued' AND phone IN (${placeholders})`,
    phones,
  );
  const after = await query<any>(
    `SELECT status, count(*)::int n FROM wa_outbound_queue WHERE phone IN (${placeholders}) GROUP BY status`,
    phones,
  );
  console.log(JSON.stringify({ before, after }, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
