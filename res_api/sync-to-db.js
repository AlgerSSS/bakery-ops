import 'dotenv/config';
import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './lib/csv-parser.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v]; }));

const DB_URL = args['database-url'] || process.env.DATABASE_URL;
if (!DB_URL) { console.error('[sync-to-db] ERROR: DATABASE_URL env var is required'); process.exit(1); }
const sql = postgres(DB_URL, { max: 5, idle_timeout: 20 });

const READABLE_DIR = args['readable-dir'] || 'output/sales/readable';
const DAILY_FILE = args['daily-file'] || 'output/daily/daily.json';

function loadCsv(relPath) {
  if (!fs.existsSync(relPath)) return null;
  return parseCsv(fs.readFileSync(relPath, 'utf8'));
}

function num(v) { const n = Number(v); return isNaN(n) ? null : n; }

// PLACEHOLDER_MAIN

// === 1. daily_revenue (existing table) ===
async function syncDailyRevenue() {
  const rows = loadCsv(`${READABLE_DIR}/sales_by_business_date.csv`);
  if (!rows?.length) { console.log('  [skip] no data'); return 0; }
  let count = 0;
  for (const r of rows) {
    const date = r['Business Date'];
    if (!date) continue;
    const grossSales = num(r['Gross Sales']);
    const discount = num(r['Amount Of Discount']);
    const discountRate = grossSales > 0 ? +(discount / grossSales).toFixed(4) : null;
    const totalPayment = num(r['Total Payment received']) || num(r['Net Sales']);
    const memberPay = num(r['Payment Subtotal — Membership card pay']) || 0;
    const memberRatio = totalPayment > 0 ? +(memberPay / totalPayment).toFixed(4) : null;
    await sql`
      INSERT INTO daily_revenue (date, revenue, transaction_count, avg_transaction_value, gross_sales, total_discount, discount_rate, member_sales_ratio)
      VALUES (${date}, ${num(r['Net Sales'])}, ${num(r['Bill Count'])}, ${num(r['Avg Order Net Sales'])}, ${grossSales}, ${discount}, ${discountRate}, ${memberRatio})
      ON CONFLICT ON CONSTRAINT uk_daily_revenue_date DO UPDATE SET
        revenue = EXCLUDED.revenue,
        transaction_count = EXCLUDED.transaction_count,
        avg_transaction_value = EXCLUDED.avg_transaction_value,
        gross_sales = EXCLUDED.gross_sales,
        total_discount = EXCLUDED.total_discount,
        discount_rate = EXCLUDED.discount_rate,
        member_sales_ratio = EXCLUDED.member_sales_ratio
    `;
    count++;
  }
  return count;
}

// === 2. daily_sales_record (existing table) ===
// Real per-day per-product quantities aggregated from daily.json itemsByDateHour.
// (Previously wrote a 30-day rolling average stamped with the sync date, which
// flattened all weekday variation downstream — see IMPROVEMENT-PLAN.md G1.)
async function syncDailySalesRecord() {
  if (!fs.existsSync(DAILY_FILE)) { console.log('  [skip] daily.json not found'); return 0; }
  const daily = JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8'));
  if (!daily.itemsByDateHour?.length) { console.log('  [skip] no itemsByDateHour data'); return 0; }

  const transFile = 'output/sales/translations.json';
  let itemNames = {};
  if (fs.existsSync(transFile)) {
    const t = JSON.parse(fs.readFileSync(transFile, 'utf8'));
    itemNames = t.dimOptions?.D_itemName || {};
  }

  // Sum real qty per (date, product); dedupe date|hour|name like syncItemHourlySales
  const seen = new Set();
  const byDate = new Map();
  for (const r of daily.itemsByDateHour) {
    if (!r.date || !r.name) continue;
    const name = itemNames[r.name] || r.name;
    const uid = `${r.date}|${r.hour}|${name}`;
    if (seen.has(uid)) continue;
    seen.add(uid);
    const qty = num(r.qty);
    if (!qty || qty <= 0) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, new Map());
    const m = byDate.get(r.date);
    m.set(name, (m.get(name) || 0) + qty);
  }

  let count = 0;
  await sql.begin(async (sql) => {
    for (const [date, products] of byDate) {
      const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
      await sql`DELETE FROM daily_sales_record WHERE date = ${date}`;
      const batch = [...products].map(([name, qty]) => ({
        product_name: name, standard_name: name, quantity: qty, date, day_of_week: dayOfWeek,
      }));
      for (let i = 0; i < batch.length; i += 200) {
        const chunk = batch.slice(i, i + 200);
        await sql`INSERT INTO daily_sales_record ${sql(chunk, 'product_name', 'standard_name', 'quantity', 'date', 'day_of_week')}`;
      }
      count += batch.length;
    }
  });
  return count;
}

// === 3. timeslot_sales_record (existing table) ===
// Real per-dayType per-hour averages aggregated from item_hourly_sales (56-day window).
// Must run AFTER syncItemHourlySales so the window includes tonight's data.
// (Previously copied one 30-day average to all three day_types with snake_case
// 'monday_to_thursday', which the TS engine — expecting 'mondayToThursday' — could
// never match for Mon-Thu; see IMPROVEMENT-PLAN.md G1.)
async function syncTimeslotSalesRecord() {
  return await sql.begin(async (sql) => {
    await sql`TRUNCATE timeslot_sales_record RESTART IDENTITY`;
    const inserted = await sql`
      WITH win AS (
        SELECT DISTINCT date FROM item_hourly_sales
        WHERE date >= CURRENT_DATE - INTERVAL '56 days'
      ), typed AS (
        SELECT date,
          CASE WHEN EXTRACT(DOW FROM date) = 5 THEN 'friday'
               WHEN EXTRACT(DOW FROM date) IN (0, 6) THEN 'weekend'
               ELSE 'mondayToThursday' END AS day_type
        FROM win
      ), day_counts AS (
        SELECT day_type, COUNT(*) AS days FROM typed GROUP BY day_type
      )
      INSERT INTO timeslot_sales_record (product_name, day_type, time_slot, avg_quantity, sample_count)
      SELECT s.item_name, t.day_type, lpad(s.hour::text, 2, '0') || ':00',
             ROUND(SUM(s.qty)::numeric / c.days, 1), c.days
      FROM item_hourly_sales s
      JOIN typed t ON t.date = s.date
      JOIN day_counts c ON c.day_type = t.day_type
      GROUP BY s.item_name, t.day_type, s.hour, c.days
      HAVING SUM(s.qty) > 0
      RETURNING 1
    `;
    return inserted.length;
  });
}

// === 4. hourly_sales_summary (per-day per-hour) ===
async function syncHourlySales() {
  if (!fs.existsSync(DAILY_FILE)) { console.log('  [skip] daily.json not found'); return 0; }
  const daily = JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8'));
  if (!daily.hourlyByDate?.length) {
    // Fallback to old aggregated hourly if no per-day data
    if (!daily.hourly?.length) { console.log('  [skip] no hourly data'); return 0; }
    console.log('  [warn] only aggregated hourly data available');
    return 0;
  }

  let count = 0;
  for (const h of daily.hourlyByDate) {
    if (!h.date) continue;
    await sql`
      INSERT INTO hourly_sales_summary (date, hour, bill_count, num_of_guests, net_sales, gross_sales, avg_order_net_sales, total_discount, synced_at)
      VALUES (${h.date}, ${num(h.hour)}, ${h.billCount}, ${h.guests}, ${h.netSales}, ${h.grossSales}, ${h.avgTicket}, ${h.discount}, NOW())
      ON CONFLICT (date, hour) DO UPDATE SET
        bill_count = EXCLUDED.bill_count, num_of_guests = EXCLUDED.num_of_guests,
        net_sales = EXCLUDED.net_sales, gross_sales = EXCLUDED.gross_sales,
        avg_order_net_sales = EXCLUDED.avg_order_net_sales, total_discount = EXCLUDED.total_discount, synced_at = NOW()
    `;
    count++;
  }
  return count;
}

// === 5. item_hourly_sales (per-day per-hour per-item) ===
async function syncItemHourlySales() {
  if (!fs.existsSync(DAILY_FILE)) { console.log('  [skip] daily.json not found'); return 0; }
  const daily = JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8'));
  if (!daily.itemsByDateHour?.length) { console.log('  [skip] no itemsByDateHour data'); return 0; }

  const transFile = 'output/sales/translations.json';
  let itemNames = {};
  if (fs.existsSync(transFile)) {
    const t = JSON.parse(fs.readFileSync(transFile, 'utf8'));
    itemNames = t.dimOptions?.D_itemName || {};
  }

  // Collect unique rows
  const seen = new Set();
  const batch = [];
  for (const r of daily.itemsByDateHour) {
    if (!r.date || !r.name) continue;
    const name = itemNames[r.name] || r.name;
    const uid = `${r.date}|${r.hour}|${name}`;
    if (seen.has(uid)) continue;
    seen.add(uid);
    batch.push({ date: r.date, hour: Number(r.hour), item_name: name, qty: r.qty || 0, net_sales: r.netSales || 0, gross_sales: r.grossSales || 0 });
  }

  // Clear and bulk insert in chunks — atomic per run so a mid-sync crash
  // can't leave a date half-deleted (IMPROVEMENT-PLAN.md A4)
  await sql.begin(async (sql) => {
    const dates = [...new Set(batch.map(r => r.date))];
    for (const d of dates) {
      await sql`DELETE FROM item_hourly_sales WHERE date = ${d}`;
    }
    for (let i = 0; i < batch.length; i += 500) {
      const chunk = batch.slice(i, i + 500);
      await sql`INSERT INTO item_hourly_sales ${sql(chunk, 'date', 'hour', 'item_name', 'qty', 'net_sales', 'gross_sales')}`;
    }
  });
  return batch.length;
}

// === 6. daily_payment_breakdown (per-day from sales_by_business_date) ===
async function syncPaymentBreakdown() {
  const rows = loadCsv(`${READABLE_DIR}/sales_by_business_date.csv`);
  if (!rows?.length) { console.log('  [skip] no data'); return 0; }

  let count = 0;
  for (const r of rows) {
    const date = r['Business Date'];
    if (!date) continue;
    const totalPayment = num(r['Total Payment received']) || 0;
    if (totalPayment <= 0) continue;

    const channels = [
      ['ExternalBankCard', num(r['Payment Subtotal — External Bank Card'])],
      ['Membership card balance', num(r['Payment Subtotal — Membership card pay'])],
      ['Cash', num(r['Payment Subtotal — Cash'])],
    ];

    for (const [method, amount] of channels) {
      if (amount == null) continue;
      const ratio = totalPayment > 0 ? +(amount / totalPayment).toFixed(4) : null;
      await sql`
        INSERT INTO daily_payment_breakdown (date, payment_method, net_sales, ratio)
        VALUES (${date}, ${method}, ${amount}, ${ratio})
        ON CONFLICT (date, payment_method) DO UPDATE SET
          net_sales = EXCLUDED.net_sales, ratio = EXCLUDED.ratio
      `;
      count++;
    }
  }
  return count;
}

// === 7. daily_dining_breakdown (per-day from hourly_sales_summary) ===
async function syncDiningBreakdown() {
  // We don't have per-day dining data from the CSV, only 30-day totals.
  // Store the 30-day ratio for each date in the range as a reference.
  const rows = loadCsv(`${READABLE_DIR}/orders_by_dining_option.csv`);
  if (!rows?.length) { console.log('  [skip] no data'); return 0; }

  const total = rows.reduce((a, r) => a + (num(r['Bill Count']) || 0), 0);
  // Get all dates from daily_revenue to assign dining ratios
  const revenueRows = loadCsv(`${READABLE_DIR}/sales_by_business_date.csv`);
  if (!revenueRows?.length) return 0;

  let count = 0;
  for (const rev of revenueRows) {
    const date = rev['Business Date'];
    if (!date) continue;
    for (const r of rows) {
      const option = r['Dining Options'] || '';
      if (!option) continue;
      const billCount = num(r['Bill Count']);
      const ratio = total > 0 ? +(billCount / total).toFixed(4) : null;
      await sql`
        INSERT INTO daily_dining_breakdown (date, dining_option, bill_count, net_sales, ratio)
        VALUES (${date}, ${option}, ${null}, ${null}, ${ratio})
        ON CONFLICT (date, dining_option) DO UPDATE SET ratio = EXCLUDED.ratio
      `;
      count++;
    }
  }
  return count;
}

// === 8. item_waste (per-day per-item waste with reason) ===
async function syncItemWaste() {
  if (!fs.existsSync(DAILY_FILE)) { console.log('  [skip] daily.json not found'); return 0; }
  const daily = JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8'));
  if (!daily.itemWaste?.length) { console.log('  [skip] no itemWaste data'); return 0; }

  const transFile = 'output/sales/translations.json';
  let itemNames = {};
  if (fs.existsSync(transFile)) {
    const t = JSON.parse(fs.readFileSync(transFile, 'utf8'));
    itemNames = t.dimOptions?.D_itemName || {};
  }

  const REASON_MAP = {
    'abnormal loss': 'production',
    'taste testing and spoilage reporting': 'tasting',
    'production scheduling and loss reporting': 'scheduling',
  };

  const seen = new Set();
  const batch = [];
  for (const r of daily.itemWaste) {
    if (!r.date || !r.name) continue;
    const name = itemNames[r.name] || r.name;
    const reason = REASON_MAP[r.reason] || r.reason || 'other';
    const uid = `${r.date}|${name}|${reason}`;
    if (seen.has(uid)) continue;
    seen.add(uid);
    batch.push({ date: r.date, item_name: name, waste_reason: reason, qty: r.qty || 0, amount: r.amount || 0 });
  }

  // Delete existing and bulk insert — atomic per run (IMPROVEMENT-PLAN.md A4)
  await sql.begin(async (sql) => {
    const dates = [...new Set(batch.map(r => r.date))];
    for (const d of dates) {
      await sql`DELETE FROM item_waste WHERE date = ${d}`;
    }
    for (let i = 0; i < batch.length; i += 500) {
      const chunk = batch.slice(i, i + 500);
      await sql`INSERT INTO item_waste ${sql(chunk, 'date', 'item_name', 'waste_reason', 'qty', 'amount')}`;
    }
  });
  return batch.length;
}

// === 9. item_last_sale (per-day per-item last-sale MINUTE, for precise stockout) ===
// Source: scrape-item-last-sale.mjs → output/sales/item-last-sale.json (menuItemId keyed).
// Translate id → readable name via the same D_itemName map as item_hourly_sales/item_waste.
async function syncItemLastSale() {
  const file = 'output/sales/item-last-sale.json';
  if (!fs.existsSync(file)) { console.log('  [skip] item-last-sale.json not found'); return 0; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data.rows?.length) { console.log('  [skip] no rows'); return 0; }

  const transFile = 'output/sales/translations.json';
  let itemNames = {};
  if (fs.existsSync(transFile)) {
    const t = JSON.parse(fs.readFileSync(transFile, 'utf8'));
    itemNames = t.dimOptions?.D_itemName || {};
  }

  // Collapse to one row per (date, readable name): keep the latest last_sale_time.
  const byKey = new Map();
  for (const r of data.rows) {
    if (!r.date || !r.id || !r.lastTime) continue;
    const name = itemNames[r.id] || r.id;
    const key = `${r.date}|${name}`;
    const cur = byKey.get(key);
    if (!cur || r.lastTime > cur.last_sale_time) {
      byKey.set(key, { date: r.date, item_name: name, last_sale_time: r.lastTime, day_qty: (cur?.day_qty || 0) + (Number(r.dayQty) || 0) });
    } else {
      cur.day_qty += Number(r.dayQty) || 0;
    }
  }
  const batch = [...byKey.values()];

  await sql.begin(async (sql) => {
    const dates = [...new Set(batch.map(r => r.date))];
    for (const d of dates) await sql`DELETE FROM item_last_sale WHERE date = ${d}`;
    for (let i = 0; i < batch.length; i += 500) {
      const chunk = batch.slice(i, i + 500);
      await sql`INSERT INTO item_last_sale ${sql(chunk, 'date', 'item_name', 'last_sale_time', 'day_qty')}`;
    }
  });
  return batch.length;
}

async function main() {
  console.log('[sync-to-db] syncing scraped data to database...\n');

  console.log('1. daily_revenue (existing)');
  const c1 = await syncDailyRevenue();
  console.log(`   -> ${c1} rows\n`);

  console.log('2. daily_sales_record (real per-day, from itemsByDateHour)');
  const c2 = await syncDailySalesRecord();
  console.log(`   -> ${c2} rows\n`);

  console.log('3. hourly_sales_summary (per-day per-hour)');
  const c4 = await syncHourlySales();
  console.log(`   -> ${c4} rows\n`);

  console.log('4. item_hourly_sales (per-day per-hour per-item)');
  const c5 = await syncItemHourlySales();
  console.log(`   -> ${c5} rows\n`);

  console.log('5. timeslot_sales_record (real day-type averages, from item_hourly_sales)');
  const c3 = await syncTimeslotSalesRecord();
  console.log(`   -> ${c3} rows\n`);

  console.log('6. daily_payment_breakdown');
  const c6 = await syncPaymentBreakdown();
  console.log(`   -> ${c6} rows\n`);

  console.log('7. daily_dining_breakdown');
  const c7 = await syncDiningBreakdown();
  console.log(`   -> ${c7} rows\n`);

  console.log('8. item_waste (per-day per-item waste)');
  const c8 = await syncItemWaste();
  console.log(`   -> ${c8} rows\n`);

  console.log('9. item_last_sale (per-day per-item last-sale minute)');
  const c9 = await syncItemLastSale();
  console.log(`   -> ${c9} rows\n`);

  console.log('[sync-to-db] done');
  await sql.end();
}

main().catch(async e => {
  console.error('[sync-to-db] ERROR:', e.message);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
