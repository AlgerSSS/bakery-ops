import fs from 'node:fs';
import path from 'node:path';

const outRoot = 'output/sales';
const T = JSON.parse(fs.readFileSync(path.join(outRoot, 'translations.json')));

// Ensure core dim mappings exist even if live API lookups failed.
T.dimOptions = T.dimOptions || {};
const SHOP_MAP = { '406994127': 'HOT CRUSH BAKERY' };
T.dimOptions.D_shopId = { ...SHOP_MAP, ...(T.dimOptions.D_shopId || {}) };
T.dimOptions.D_shopName = { ...SHOP_MAP, ...(T.dimOptions.D_shopName || {}) };
// D_diningOption in reports uses a compact code set (10/20/...) distinct from the full OrderType enum.
T.dimOptions.D_diningOption = {
  '10': 'Dine-in',
  '20': 'Takeaway',
  '30': 'Delivery',
  '40': 'Pickup',
  ...(T.dimOptions.D_diningOption || {}),
};
// Dish category ID → name observed in captured dim options (reportId 211 on 2026-05-12).
T.dimOptions.D_category = T.dimOptions.D_category || {
  '1990716608733069315-1-4120d1db-ff02-40c2-b09a-f7c9f9022da4': 'TOP list, New items',
  '1990716608733069315-1-b17e07f4-06e7-4075-bf20-a84f93815fcb': 'Fruit tart + alkaline water',
  '1990716608733069315-1-ab2fa656-a702-40aa-a022-8c8552de4793': 'Croissant, ciabatta, cream puff, Basque',
  '1990716608733069315-1-3f411944-98b9-4177-a317-1ccd8c49985a': 'Bagel series, toast category',
  '1990716608733069315-1-b1ae6133-1c41-48fa-839f-1f53766f97fd': 'Coffee Latte Series',
  '1990716608733069315-1-80b7dea0-9311-489f-b2c6-ed5a574fecdc': 'Lemon tea series',
  '1990716608733069315-1-b8949ce3-4a0a-41c8-9788-c1634c6b5e2c': 'Matcha series',
  '1990716608733069315-1-fe4a9f64-865e-4616-a3b5-9532d87e41e9': 'Milkshake series',
  '1990716608733069315-1-6515aa62-72a3-4ec2-8c0d-a3fc879dacf9': 'Chocolate series',
  '1990716608733069315-1-cafbe1e6-85fc-46e2-b7e3-608b5eca89f6': 'Peripheral products',
  '1990716608733069315-1-24bfa312-beef-4534-b41e-c57c1f4825d1': 'Combo set',
  '1991027325256417283-7-91b90af6-89f9-497d-a7eb-5650174aca9c': 'Combo set (branch)',
};

// Unified column renamer: metric or dim code -> display text.
function columnLabel(code) {
  if (T.dynamicSubHeads[code]) {
    // Prefix with base metric title when available, e.g. "6% SST" (tax). Strip the base dim to keep it readable.
    const baseMetric = code.replace(/_BY_D_[A-Za-z]+_.+$/, '');
    const baseTitle = T.metricTitles[baseMetric];
    const subTitle = T.dynamicSubHeads[code];
    return baseTitle ? `${baseTitle} — ${subTitle}` : subTitle;
  }
  if (T.metricTitles[code]) return T.metricTitles[code];
  if (T.dimTitles[code]) return T.dimTitles[code];
  return code;
}

function translateValue(columnCode, rawValue) {
  if (rawValue == null) return rawValue;
  const mapping = T.dimOptions[columnCode];
  if (mapping && rawValue in mapping) return mapping[rawValue];
  return rawValue;
}

function toCsv(rows, columnOrder) {
  if (!rows?.length) return '';
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  return [columnOrder.map(columnLabel).join(','), ...rows.map((r) => columnOrder.map((k) => esc(r[k])).join(','))].join('\n');
}

function flattenCell(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && ('displayValue' in v || 'abbrDisplayValue' in v)) return v.value;
  return v;
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

function describe(reqBody) {
  const reportId = reqBody.reportId;
  const selectFields = reqBody.selectFields || [];
  const dimPart = selectFields.filter((f) => f.startsWith('D_')).join('+') || 'noDim';
  const page = reqBody.page ? 'paged' : 'agg';
  return `report${reportId}__${dimPart}__${page}`;
}

const slugs = ['sales-overview', 'sales-summary', 'items-breakdown'];

for (const slug of slugs) {
  const src = path.join(outRoot, slug, 'replay-30d');
  const dst = path.join(outRoot, slug, 'readable');
  fs.mkdirSync(dst, { recursive: true });

  for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(src, f)));
    const rows = extractRows(j.result.body);
    if (!rows?.length) continue;

    // Preserve column order from selectFields if available, else fall back to first row keys.
    const orderedKeys = j.reqBody.selectFields?.length
      ? [...j.reqBody.selectFields, ...Object.keys(rows[0]).filter((k) => !j.reqBody.selectFields.includes(k))]
      : Object.keys(rows[0]);

    const flat = rows.map((row) => {
      const out = {};
      for (const k of orderedKeys) {
        if (!(k in row)) continue;
        out[k] = translateValue(k, flattenCell(row[k]));
      }
      return out;
    });

    const columnOrder = orderedKeys.filter((k) => flat.some((r) => k in r));
    const filename = `${describe(j.reqBody)}.csv`;
    fs.writeFileSync(path.join(dst, filename), toCsv(flat, columnOrder));
  }
  console.log(`[apply] ${slug} -> ${dst}`);
}

// Rebuild headline CSVs with translated titles/values.
function findFirstRows(slug, pred) {
  const dir = path.join(outRoot, slug, 'replay-30d');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f)));
    if (!pred(j.reqBody)) continue;
    const rows = extractRows(j.result.body);
    if (!rows?.length) continue;
    const orderedKeys = j.reqBody.selectFields?.length
      ? [...j.reqBody.selectFields, ...Object.keys(rows[0]).filter((k) => !j.reqBody.selectFields.includes(k))]
      : Object.keys(rows[0]);
    const flat = rows.map((row) => {
      const out = {};
      for (const k of orderedKeys) {
        if (!(k in row)) continue;
        out[k] = translateValue(k, flattenCell(row[k]));
      }
      return out;
    });
    return { rows: flat, order: orderedKeys.filter((k) => flat.some((r) => k in r)) };
  }
  return null;
}

const headlineDir = path.join(outRoot, 'readable');
fs.mkdirSync(headlineDir, { recursive: true });

const headlineMap = {
  'kpi_overview_core.csv': ['sales-overview', (b) => b.reportId === '123' && !b.page && b.selectFields?.includes('M_Order_SUM_netSales') && !b.selectFields?.includes('D_shopName')],
  'kpi_summary_totals.csv': ['sales-summary', (b) => b.reportId === '888001' && !b.selectFields?.includes('D_businessDate')],
  'sales_by_business_date.csv': ['sales-summary', (b) => b.reportId === '888001' && b.selectFields?.includes('D_businessDate')],
  'items_totals.csv': ['items-breakdown', (b) => b.reportId === '211' && !b.selectFields?.includes('D_category')],
  'items_by_category.csv': ['items-breakdown', (b) => b.reportId === '211' && b.selectFields?.includes('D_category')],
  'items_by_dish_unit_30d.csv': ['sales-overview', (b) => b.reportId === '211' && b.selectFields?.includes('D_Combined_D_itemName_And_D_unit') && b.page],
  'orders_by_dining_option.csv': ['sales-overview', (b) => b.reportId === '123' && b.selectFields?.includes('D_diningOption')],
  'payment_by_payer_type.csv': ['sales-overview', (b) => b.reportId === '198'],
  'items_by_category_overview.csv': ['sales-overview', (b) => b.reportId === '211' && b.selectFields?.includes('D_category') && b.page],
};

for (const [outName, [slug, pred]] of Object.entries(headlineMap)) {
  const found = findFirstRows(slug, pred);
  if (!found) { console.log(`  (missing) ${outName}`); continue; }
  const csv = toCsv(found.rows, found.order);
  fs.writeFileSync(path.join(headlineDir, outName), csv);
  console.log(`  wrote ${outName} (${found.rows.length} rows)`);
}

// Write a README-style summary pointing users to the right file.
const manifestLines = [
  'Readable Sales CSVs — 2026-04-13 to 2026-05-12 (last 30 days)',
  '',
  'Headline files (output/sales/readable/):',
  '  kpi_overview_core.csv         Net Sales, Gross Sales, Orders, Guests (single row)',
  '  kpi_summary_totals.csv        Sales Breakdown totals (all metrics, 1 row)',
  '  sales_by_business_date.csv    Sales Breakdown per day (30 rows)',
  '  items_totals.csv              Items totals (1 aggregate row)',
  '  items_by_category.csv         Items grouped by parent+sub category',
  '  items_by_dish_unit_30d.csv    Top dishes (Combined_itemName_unit)',
  '  orders_by_dining_option.csv   Orders split by dining option',
  '  payment_by_payer_type.csv     Payments split by payer type',
  '',
  'Per-page readable dumps:',
  '  output/sales/sales-overview/readable/',
  '  output/sales/sales-summary/readable/',
  '  output/sales/items-breakdown/readable/',
  '',
  'Raw (field codes untranslated) kept for debugging in:',
  '  output/sales/*/csv/   and  output/sales/*/replay-30d/',
];
fs.writeFileSync(path.join(outRoot, 'README.txt'), manifestLines.join('\n'));
console.log('\n[apply] done -> output/sales/readable/');
