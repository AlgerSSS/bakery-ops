// One-off G1 backfill (see IMPROVEMENT-PLAN.md G1):
// daily_sales_record's POS-era rows are 30-day rolling averages, not real daily sales.
// This rebuilds every date present in item_hourly_sales (real per-day data) from that table.
// A full backup is taken to daily_sales_record_backup_g1 before any change.
//
// Run manually:  node backfill-daily-sales.js
// Rollback:      TRUNCATE daily_sales_record; INSERT INTO daily_sales_record SELECT * FROM daily_sales_record_backup_g1;
import 'dotenv/config';
import postgres from 'postgres';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('DATABASE_URL required'); process.exit(1); }
const sql = postgres(DB_URL, { max: 1, idle_timeout: 5 });

async function main() {
  const ex = await sql`SELECT to_regclass('daily_sales_record_backup_g1') AS t`;
  if (!ex[0].t) {
    await sql`CREATE TABLE daily_sales_record_backup_g1 AS SELECT * FROM daily_sales_record`;
    console.log('[backfill] backup created: daily_sales_record_backup_g1');
  } else {
    console.log('[backfill] backup already exists, keeping it');
  }

  const before = await sql`SELECT COUNT(*) c FROM daily_sales_record`;
  await sql.begin(async (sql) => {
    await sql`DELETE FROM daily_sales_record WHERE date IN (SELECT DISTINCT date::text FROM item_hourly_sales)`;
    await sql`
      INSERT INTO daily_sales_record (product_name, standard_name, quantity, date, day_of_week)
      SELECT item_name, item_name, SUM(qty)::int, date::text, EXTRACT(DOW FROM date)::int
      FROM item_hourly_sales
      GROUP BY item_name, date
      HAVING SUM(qty) > 0
    `;
  });
  const after = await sql`SELECT COUNT(*) c, COUNT(DISTINCT date) d FROM daily_sales_record`;
  console.log(`[backfill] rows ${before[0].c} -> ${after[0].c}, distinct dates: ${after[0].d}`);

  // Sanity: real data varies day to day; the old fake averages were near-constant
  const v = await sql`
    SELECT date, quantity FROM daily_sales_record
    WHERE product_name = (SELECT product_name FROM daily_sales_record GROUP BY product_name ORDER BY SUM(quantity) DESC LIMIT 1)
    ORDER BY date DESC LIMIT 7`;
  console.log('[backfill] top product last 7 days:', v.map(r => `${r.date}:${r.quantity}`).join(' '));
  await sql.end();
}

main().catch(async e => {
  console.error('[backfill] ERROR:', e.message);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
