import fs from 'node:fs';
import path from 'node:path';

const outRoot = 'output/sales';

function flattenCell(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && ('displayValue' in v || 'abbrDisplayValue' in v)) return v.value;
  return v;
}
function flattenRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = flattenCell(v);
  return out;
}
function toCsv(rows) {
  if (!rows?.length) return '';
  const keys = Array.from(rows.reduce((a, r) => { Object.keys(r || {}).forEach((k) => a.add(k)); return a; }, new Set()));
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r?.[k])).join(','))].join('\n');
}
function extractRows(body) {
  const d = body?.data ?? body;
  if (!d) return null;
  if (Array.isArray(d) && d.length && typeof d[0] === 'object') return d;
  for (const k of ['rows', 'list', 'records', 'items']) {
    if (Array.isArray(d?.[k]) && d[k].length && typeof d[k][0] === 'object') return d[k];
  }
  return null;
}

// Human-friendly naming for each replayed payload.
function describe(reqBody) {
  const reportId = reqBody.reportId;
  const selectFields = reqBody.selectFields || [];
  const hasDim = selectFields.find((f) => f.startsWith('D_'));
  const dimPart = selectFields.filter((f) => f.startsWith('D_')).join('+') || 'noDim';
  const metricHint = selectFields.find((f) => f.startsWith('M_')) || '';
  const page = reqBody.page ? 'paged' : 'agg';
  return `report${reportId}__${dimPart}__${page}`;
}

const csvIndex = [];
const flatSummary = {};

for (const slug of ['sales-overview', 'sales-summary', 'items-breakdown']) {
  const replayDir = path.join(outRoot, slug, 'replay-30d');
  const csvOut = path.join(outRoot, slug, 'csv');
  fs.mkdirSync(csvOut, { recursive: true });
  const files = fs.readdirSync(replayDir).filter((f) => f.endsWith('.json'));

  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(replayDir, f)));
    const name = describe(j.reqBody);
    const rows = extractRows(j.result.body);

    if (rows && rows.length) {
      const flat = rows.map(flattenRow);
      const csv = toCsv(flat);
      const filename = `${name}.csv`;
      fs.writeFileSync(path.join(csvOut, filename), csv);
      csvIndex.push({ page: slug, file: `${slug}/csv/${filename}`, rowCount: flat.length, columns: Object.keys(flat[0] || {}) });
    } else {
      // Single metric responses with no rows (e.g. only totals block) — skip, already in JSON.
    }
  }
}

// Build the headline KPI sheet by pulling the known "all metrics" call from sales-summary reportId 888001 (1 aggregate row) and sales-overview reportId 123.
function findFirstRow(slug, pred) {
  const dir = path.join(outRoot, slug, 'replay-30d');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(dir, f)));
    if (!pred(j.reqBody)) continue;
    const rows = extractRows(j.result.body);
    if (rows?.length) return rows.map(flattenRow);
  }
  return null;
}

const overviewCore = findFirstRow('sales-overview', (b) => b.reportId === '123' && !b.page && b.selectFields?.includes('M_Order_SUM_netSales') && !b.selectFields?.includes('D_shopName'));
const summaryTotals = findFirstRow('sales-summary', (b) => b.reportId === '888001' && !b.selectFields?.includes('D_businessDate'));
const summaryByDate = findFirstRow('sales-summary', (b) => b.reportId === '888001' && b.selectFields?.includes('D_businessDate'));
const itemsTotals = findFirstRow('items-breakdown', (b) => b.reportId === '211' && !b.selectFields?.includes('D_category'));
const itemsByCategory = findFirstRow('items-breakdown', (b) => b.reportId === '211' && b.selectFields?.includes('D_category'));

if (overviewCore) fs.writeFileSync(path.join(outRoot, 'kpi_overview_core.csv'), toCsv(overviewCore));
if (summaryTotals) fs.writeFileSync(path.join(outRoot, 'kpi_summary_totals.csv'), toCsv(summaryTotals));
if (summaryByDate) fs.writeFileSync(path.join(outRoot, 'sales_by_business_date.csv'), toCsv(summaryByDate));
if (itemsTotals) fs.writeFileSync(path.join(outRoot, 'items_totals.csv'), toCsv(itemsTotals));
if (itemsByCategory) fs.writeFileSync(path.join(outRoot, 'items_by_category.csv'), toCsv(itemsByCategory));

fs.writeFileSync(path.join(outRoot, '_csv_index.json'), JSON.stringify(csvIndex, null, 2));

console.log('Wrote headline CSVs:');
for (const f of ['kpi_overview_core', 'kpi_summary_totals', 'sales_by_business_date', 'items_totals', 'items_by_category']) {
  const p = path.join(outRoot, `${f}.csv`);
  if (fs.existsSync(p)) console.log('  ', p, '(' + fs.statSync(p).size + ' bytes)');
}
console.log('\nFull catalog: output/sales/_csv_index.json (' + csvIndex.length + ' files)');
for (const c of csvIndex) console.log('  ', c.file, 'rows=' + c.rowCount);
