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
// Writes per-product per-date records from items_by_hour_long (has dish name + date-aggregated qty)
async function syncDailySalesRecord() {
  const rows = loadCsv(`${READABLE_DIR}/items_by_hour_qty.csv`);
  if (!rows?.length) { console.log('  [skip] no data'); return 0; }

  // items_by_hour_qty has 30-day totals per dish. We write one record per product for today's sync date.
  // The existing data uses individual dates; we'll use the date range end as the reference.
  const tz = 'Asia/Kuala_Lumpur';
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const dayOfWeek = now.getDay();

  // Delete existing records for today to avoid duplicates (no unique constraint on date+product)
  await sql`DELETE FROM daily_sales_record WHERE date = ${today}`;

  let count = 0;
  for (const r of rows) {
    const name = r['Dish Name'];
    if (!name) continue;
    const totalQty = num(r['Total Qty']);
    if (!totalQty || totalQty <= 0) continue;
    // Calculate daily average from 30-day total
    const dailyAvg = Math.round(totalQty / 30);
    await sql`
      INSERT INTO daily_sales_record (product_name, standard_name, quantity, date, day_of_week, created_at)
      VALUES (${name}, ${name}, ${dailyAvg}, ${today}, ${dayOfWeek}, NOW())
    `;
    count++;
  }
  return count;
}

// === 3. timeslot_sales_record (existing table) ===
async function syncTimeslotSalesRecord() {
  const rows = loadCsv(`${READABLE_DIR}/items_by_hour_qty.csv`);
  if (!rows?.length) { console.log('  [skip] no data'); return 0; }

  await sql`TRUNCATE timeslot_sales_record RESTART IDENTITY`;

  const batch = [];
  const seen = new Set();
  for (const r of rows) {
    const name = r['Dish Name'];
    if (!name) continue;
    for (let h = 10; h <= 22; h++) {
      const key = `H${String(h).padStart(2, '0')}`;
      const qty = num(r[key]);
      if (!qty || qty <= 0) continue;
      const avgQty = +(qty / 30).toFixed(1);
      const timeSlot = `${String(h).padStart(2, '0')}:00`;
      for (const dayType of ['monday_to_thursday', 'friday', 'weekend']) {
        const uid = `${name}|${dayType}|${timeSlot}`;
        if (seen.has(uid)) continue;
        seen.add(uid);
        batch.push({ product_name: name, day_type: dayType, time_slot: timeSlot, avg_quantity: avgQty, sample_count: 30 });
      }
    }
  }

  for (let i = 0; i < batch.length; i += 200) {
    const chunk = batch.slice(i, i + 200);
    await sql`
      INSERT INTO timeslot_sales_record ${sql(chunk, 'product_name', 'day_type', 'time_slot', 'avg_quantity', 'sample_count')}
    `;
  }
  return batch.length;
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

  // Clear and bulk insert in chunks
  const dates = [...new Set(batch.map(r => r.date))];
  for (const d of dates) {
    await sql`DELETE FROM item_hourly_sales WHERE date = ${d}`;
  }

  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    await sql`INSERT INTO item_hourly_sales ${sql(chunk, 'date', 'hour', 'item_name', 'qty', 'net_sales', 'gross_sales')}`;
  }
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

  // Delete existing and bulk insert
  const dates = [...new Set(batch.map(r => r.date))];
  for (const d of dates) {
    await sql`DELETE FROM item_waste WHERE date = ${d}`;
  }
  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    await sql`INSERT INTO item_waste ${sql(chunk, 'date', 'item_name', 'waste_reason', 'qty', 'amount')}`;
  }
  return batch.length;
}

async function main() {
  console.log('[sync-to-db] syncing scraped data to database...\n');

  console.log('1. daily_revenue (existing)');
  const c1 = await syncDailyRevenue();
  console.log(`   -> ${c1} rows\n`);

  console.log('2. daily_sales_record (existing)');
  const c2 = await syncDailySalesRecord();
  console.log(`   -> ${c2} rows\n`);

  console.log('3. timeslot_sales_record (existing)');
  const c3 = await syncTimeslotSalesRecord();
  console.log(`   -> ${c3} rows\n`);

  console.log('4. hourly_sales_summary (per-day per-hour)');
  const c4 = await syncHourlySales();
  console.log(`   -> ${c4} rows\n`);

  console.log('5. item_hourly_sales (per-day per-hour per-item)');
  const c5 = await syncItemHourlySales();
  console.log(`   -> ${c5} rows\n`);

  console.log('6. daily_payment_breakdown');
  const c6 = await syncPaymentBreakdown();
  console.log(`   -> ${c6} rows\n`);

  console.log('7. daily_dining_breakdown');
  const c7 = await syncDiningBreakdown();
  console.log(`   -> ${c7} rows\n`);

  console.log('8. item_waste (per-day per-item waste)');
  const c8 = await syncItemWaste();
  console.log(`   -> ${c8} rows\n`);

  console.log('[sync-to-db] done');
  await sql.end();
}

main().catch(e => { console.error('[sync-to-db] ERROR:', e.message); sql.end(); process.exit(1); });
