import fs from 'node:fs';
import path from 'node:path';

const outRoot = 'output/sales';
const T = JSON.parse(fs.readFileSync(path.join(outRoot, 'translations.json')));

// Mirror of additional mappings used by apply-translations.js (kept in sync manually).
T.dimOptions = T.dimOptions || {};
const SHOP_MAP = { '406994127': 'HOT CRUSH BAKERY' };
T.dimOptions.D_shopId = { ...SHOP_MAP, ...(T.dimOptions.D_shopId || {}) };

const src = path.join(outRoot, 'items-by-hour', 'rows.json');
if (!fs.existsSync(src)) {
  console.error('rows.json not found. Run scrape-items-by-hour.js first.');
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(src));

const dimMap = {
  D_menuItemId: 'D_itemName',          // menuItemId is short id; D_itemName mapping is by long id, but row D_itemName uses long id form
  D_itemName: 'D_itemName',
  D_unit: 'D_unit',
};

// Some rows have D_itemName like "1990716608733069315-1-XXXXX" matching D_itemName options.
// D_menuItemId is the short suffix without prefix; map separately.
function translateValue(col, val) {
  const dim = dimMap[col];
  if (!dim) return val;
  const opts = T.dimOptions[dim];
  if (opts && val in opts) return opts[val];
  return val;
}

// Pivot: keep itemName + unit as identity, hours as columns.
// First, collapse to per-item totals across all hours, plus a wide hour breakdown for net qty and net sales.
const itemKey = (r) => `${r.D_itemName}||${r.D_unit}`;
const items = new Map();
for (const r of rows) {
  const k = itemKey(r);
  if (!items.has(k)) items.set(k, { D_itemName: r.D_itemName, D_unit: r.D_unit, byHour: {} });
  items.get(k).byHour[Number(r.D_hours)] = {
    netQty: Number(r.M_Item_SUM_netQty || 0),
    netSales: Number(r.M_Item_SUM_netSales || 0),
  };
}

function unitLabel(unitId) {
  const name = T.dimOptions.D_unit?.[unitId];
  if (name && name.trim()) return name.trim();
  return '-';
}

// Long-form (item, hour, qty, sales) — friendly for analysts.
const longRows = rows.map((r) => ({
  'Dish Name': translateValue('D_itemName', r.D_itemName) || r.D_itemName,
  'Unit': unitLabel(r.D_unit),
  'Hour': Number(r.D_hours),
  'Qty': Number(r.M_Item_SUM_netQty || 0),
  'Net Sales': Number(r.M_Item_SUM_netSales || 0),
  'Gross Sales': Number(r.M_Item_SUM_grossSales || 0),
  'Refund Qty': Number(r.M_Item_SUM_refundQty || 0),
  'Refund Amount': Number(r.M_Item_SUM_refundAmount || 0),
  'Discount': Number(r.M_Item_SUM_discountProm || 0),
})).sort((a, b) => a['Dish Name'].localeCompare(b['Dish Name']) || a.Hour - b.Hour);

// Wide-form: rows = item, columns = hours 0..23 (Qty)
const hours = Array.from({ length: 24 }, (_, i) => i);
const wideQty = [];
const wideSales = [];
for (const it of items.values()) {
  const dishName = (T.dimOptions.D_itemName?.[it.D_itemName]) || it.D_itemName;
  const unit = unitLabel(it.D_unit);
  const baseQty = { 'Dish Name': dishName, 'Unit': unit, 'Total Qty': 0 };
  const baseSales = { 'Dish Name': dishName, 'Unit': unit, 'Total Net Sales': 0 };
  for (const h of hours) {
    const v = it.byHour[h];
    baseQty[`H${String(h).padStart(2, '0')}`] = v ? v.netQty : 0;
    baseSales[`H${String(h).padStart(2, '0')}`] = v ? Number(v.netSales.toFixed(2)) : 0;
    if (v) {
      baseQty['Total Qty'] += v.netQty;
      baseSales['Total Net Sales'] += v.netSales;
    }
  }
  baseSales['Total Net Sales'] = Number(baseSales['Total Net Sales'].toFixed(2));
  wideQty.push(baseQty);
  wideSales.push(baseSales);
}
wideQty.sort((a, b) => b['Total Qty'] - a['Total Qty']);
wideSales.sort((a, b) => b['Total Net Sales'] - a['Total Net Sales']);

function toCsv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = (v) => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replaceAll('"', '""') + '"' : String(v);
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}

const readableDir = path.join(outRoot, 'readable');
fs.mkdirSync(readableDir, { recursive: true });
fs.writeFileSync(path.join(readableDir, 'items_by_hour_long.csv'), toCsv(longRows));
fs.writeFileSync(path.join(readableDir, 'items_by_hour_qty.csv'), toCsv(wideQty));
fs.writeFileSync(path.join(readableDir, 'items_by_hour_sales.csv'), toCsv(wideSales));

console.log('wrote:');
console.log('  output/sales/readable/items_by_hour_long.csv  (' + longRows.length + ' rows)');
console.log('  output/sales/readable/items_by_hour_qty.csv   (' + wideQty.length + ' items × 24 hours)');
console.log('  output/sales/readable/items_by_hour_sales.csv (' + wideSales.length + ' items × 24 hours)');
