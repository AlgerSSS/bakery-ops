import 'dotenv/config';
import postgres from 'postgres';
import XLSX from 'xlsx';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v]; }));

const DB_URL = args['database-url'] || process.env.DATABASE_URL;
if (!DB_URL) { console.error('[sync-pnl] ERROR: DATABASE_URL env var is required'); process.exit(1); }
const sql = postgres(DB_URL, { max: 5, idle_timeout: 20 });

const FILE_PATH = args.file || process.env.PNL_EXCEL_PATH || '';
if (!FILE_PATH || !fs.existsSync(FILE_PATH)) {
  console.error(`[sync-pnl] file not found: ${FILE_PATH}`);
  console.error('Usage: node sync-pnl.js --file=/path/to/损益表.xlsx');
  process.exit(1);
}

const STORE_NAME = args.store || 'HOT CRUSH BAKERY - Pavilion KL';

function parseSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return null;
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const map = {};
  for (const row of data) {
    if (row[0] && typeof row[0] === 'string') {
      map[row[0].trim()] = row[1] ?? null;
    }
  }
  return map;
}

function num(v) { const n = Number(v); return isNaN(n) || v === null || v === undefined ? null : n; }

function excelDateToISO(serial, year, month) {
  if (typeof serial === 'number' && serial > 40000) {
    const d = new Date((serial - 25569) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

async function main() {
  console.log(`[sync-pnl] reading: ${FILE_PATH}`);
  const wb = XLSX.readFile(FILE_PATH);

  // Determine year/month from the 修改后表 header dates
  const summaryWs = wb.Sheets['修改后表'] || wb.Sheets[wb.SheetNames[0]];
  const summaryData = XLSX.utils.sheet_to_json(summaryWs, { header: 1 });
  const headerRow = summaryData[0] || [];

  // Try to get year from first date serial in header
  let year = new Date().getFullYear();
  let month = new Date().getMonth() + 1;
  for (let i = 1; i < headerRow.length; i++) {
    if (typeof headerRow[i] === 'number' && headerRow[i] > 40000) {
      const d = new Date((headerRow[i] - 25569) * 86400000);
      year = d.getFullYear();
      month = d.getMonth() + 1;
      break;
    }
  }
  console.log(`[sync-pnl] detected period: ${year}-${String(month).padStart(2, '0')}`);

  // Process daily sheets (numbered 1-31)
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const sheetName = String(day);
    const map = parseSheet(wb, sheetName);
    if (!map) continue;

    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const revenue = num(map['营业额流水']);
    if (revenue === null || revenue === 0) continue;

    const row = {
      date,
      store_name: STORE_NAME,
      revenue,
      waste_total: num(map['报废']),
      waste_scheduling: num(map['排产报废']),
      waste_tasting: num(map['品尝报废']),
      waste_production: num(map['生产报废']),
      waste_other: num(map['打卡及其他报废']),
      discount_total: num(map['优惠组成（财务）']),
      actual_received: num(map['实收金额（财务）']),
      material_cost: num(map['原料成本']) || num(map['综合总成本']),
      labor_cost: num(map['人力成本合计']),
      energy_cost: num(map['能源费用合计']),
      rent: num(map['租金合计']),
      gross_profit: num(map['营业毛利']),
      net_profit: num(map['净利润']),
    };

    await sql`
      INSERT INTO daily_pnl (date, store_name, revenue, waste_total, waste_production, waste_tasting, waste_scheduling, waste_other, discount_total, actual_received, material_cost, labor_cost, energy_cost, rent, gross_profit, net_profit, raw_json, synced_at)
      VALUES (${row.date}, ${row.store_name}, ${row.revenue}, ${row.waste_total}, ${row.waste_production}, ${row.waste_tasting}, ${row.waste_scheduling}, ${row.waste_other}, ${row.discount_total}, ${row.actual_received}, ${row.material_cost}, ${row.labor_cost}, ${row.energy_cost}, ${row.rent}, ${row.gross_profit}, ${row.net_profit}, ${JSON.stringify(map)}, NOW())
      ON CONFLICT (date) DO UPDATE SET
        store_name = EXCLUDED.store_name, revenue = EXCLUDED.revenue,
        waste_total = EXCLUDED.waste_total, waste_production = EXCLUDED.waste_production,
        waste_tasting = EXCLUDED.waste_tasting, waste_scheduling = EXCLUDED.waste_scheduling,
        waste_other = EXCLUDED.waste_other, discount_total = EXCLUDED.discount_total,
        actual_received = EXCLUDED.actual_received, material_cost = EXCLUDED.material_cost,
        labor_cost = EXCLUDED.labor_cost, energy_cost = EXCLUDED.energy_cost,
        rent = EXCLUDED.rent, gross_profit = EXCLUDED.gross_profit,
        net_profit = EXCLUDED.net_profit, raw_json = EXCLUDED.raw_json, synced_at = NOW()
    `;
    count++;
    console.log(`  ${date}: revenue=RM${revenue}, waste=RM${row.waste_total || 0}, net_profit=RM${row.net_profit || 0}`);
  }

  // Also try 修改后表 for days that have data
  if (wb.Sheets['修改后表']) {
    const modData = XLSX.utils.sheet_to_json(summaryWs, { header: 1 });
    const labels = modData.map(r => r[0]);
    const revenueIdx = labels.indexOf('营业额流水');
    const wasteIdx = labels.indexOf('报废');
    const wasteSchedIdx = labels.indexOf('排产报废');
    const wasteTasteIdx = labels.indexOf('品尝报废');
    const wasteProdIdx = labels.indexOf('生产报废');
    const laborIdx = labels.indexOf('人力成本合计');
    const profitIdx = labels.indexOf('净利润');

    if (revenueIdx >= 0) {
      for (let col = 1; col < headerRow.length; col++) {
        const serial = headerRow[col];
        if (typeof serial !== 'number' || serial < 40000) continue;
        const d = new Date((serial - 25569) * 86400000);
        const date = d.toISOString().slice(0, 10);
        const rev = num(modData[revenueIdx]?.[col]);
        if (!rev || rev === 0) continue;

        // Only insert if not already from daily sheet
        const existing = await sql`SELECT 1 FROM daily_pnl WHERE date = ${date} AND revenue IS NOT NULL AND revenue > 0`;
        if (existing.length) continue;

        await sql`
          INSERT INTO daily_pnl (date, store_name, revenue, waste_total, waste_scheduling, waste_tasting, waste_production, labor_cost, net_profit, synced_at)
          VALUES (${date}, ${STORE_NAME}, ${rev}, ${num(modData[wasteIdx]?.[col])}, ${num(modData[wasteSchedIdx]?.[col])}, ${num(modData[wasteTasteIdx]?.[col])}, ${num(modData[wasteProdIdx]?.[col])}, ${num(modData[laborIdx]?.[col])}, ${num(modData[profitIdx]?.[col])}, NOW())
          ON CONFLICT (date) DO UPDATE SET
            revenue = EXCLUDED.revenue, waste_total = EXCLUDED.waste_total,
            waste_scheduling = EXCLUDED.waste_scheduling, waste_tasting = EXCLUDED.waste_tasting,
            waste_production = EXCLUDED.waste_production, labor_cost = EXCLUDED.labor_cost,
            net_profit = EXCLUDED.net_profit, synced_at = NOW()
        `;
        count++;
        console.log(`  ${date} (from summary): revenue=RM${rev}`);
      }
    }
  }

  console.log(`\n[sync-pnl] done: ${count} days synced`);
  await sql.end();
}

main().catch(e => { console.error('[sync-pnl] ERROR:', e.message); sql.end(); process.exit(1); });
