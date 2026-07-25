import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

if (!fs.existsSync('storageState.json')) {
  console.error('storageState.json not found.');
  process.exit(1);
}

const BASE = 'https://bo.sea.restosuite.ai';
const outRoot = 'output/sales';
const translationsPath = path.join(outRoot, 'translations.json');

// Collect reportIds and referenced dims from all replay payloads.
const slugs = ['sales-overview', 'sales-summary', 'items-breakdown'];
const usedReportIds = new Set();
const usedDims = new Set();
const slugToRefererUrl = {
  'sales-overview': `${BASE}/report/report-overview`,
  'sales-summary': `${BASE}/report/report-sales-breakdown`,
  'items-breakdown': `${BASE}/report/report-items-breakdowm`,
};

for (const slug of slugs) {
  const dir = path.join(outRoot, slug, 'replay-30d');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f)));
    const b = j.reqBody || {};
    if (b.reportId) usedReportIds.add(String(b.reportId));
    for (const fld of b.selectFields || []) {
      if (fld.startsWith('D_')) usedDims.add(fld);
    }
    for (const m of b.metricsByDimQryV2 || []) {
      for (const d of m.dims || []) if (d?.dim) usedDims.add(d.dim);
    }
    for (const fl of b.filters || []) {
      if (fl.fieldName && fl.fieldName.startsWith('D_')) usedDims.add(fl.fieldName);
    }
  }
}
console.log('[translate] reportIds used:', [...usedReportIds].join(', '));
console.log('[translate] dims used:', [...usedDims].join(', '));

// Open a browser page to borrow auth, then fetch metadata per reportId and dim options per (reportId, dim).
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: 'storageState.json' });
const page = await context.newPage();

// Register listener BEFORE navigating so we catch the first XHRs.
let capturedHeaders = null;
page.on('request', (req) => {
  const h = req.headers();
  if (!capturedHeaders && h['vulcan-token']) capturedHeaders = h;
});

await page.goto(`${BASE}/report/report-overview`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(5000);

if (!capturedHeaders) {
  console.error('[translate] could not capture auth headers; aborting');
  await browser.close();
  process.exit(2);
}
console.log('[translate] captured auth headers (vulcan-token present, shop-id=' + capturedHeaders['shop-id'] + ')');

async function apiPost(url, body) {
  return page.evaluate(
    async ({ url, body, origHeaders }) => {
      const forbidden = new Set(['host', 'connection', 'content-length', 'cookie']);
      const headers = {};
      for (const [k, v] of Object.entries(origHeaders || {})) {
        if (forbidden.has(k.toLowerCase())) continue;
        headers[k] = v;
      }
      headers['content-type'] = 'application/json';
      headers['accept'] = 'application/json, text/plain, */*';
      const r = await fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
      const text = await r.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
      return { status: r.status, body: parsed };
    },
    { url, body, origHeaders: capturedHeaders }
  );
}

const translations = {
  dimTitles: {},         // reportFieldName -> displayText
  metricTitles: {},      // reportFieldName -> displayText
  metricExplain: {},     // reportFieldName -> explain
  dynamicSubHeads: {},   // metricsCode -> title (e.g. M_Tax_..._BY_D_taxName_2036... -> "6% SST")
  dimOptions: {},        // dimCode -> { value: name }
  reports: {},           // reportId -> { title, description }
};

// 1) metadata/get per reportId
const corporationId = capturedHeaders['corporation-id'];
const shopId = capturedHeaders['shop-id'];

for (const reportId of usedReportIds) {
  const r = await apiPost(`${BASE}/api/report/metadata/get`, { reportId });
  if (r.status !== 200 || !r.body?.data) {
    console.log(`  metadata/get reportId=${reportId}: status=${r.status} code=${r.body?.code}`);
    continue;
  }
  const d = r.body.data;
  translations.reports[reportId] = { title: d.reportTitle, description: d.reportDescription };
  for (const x of d.dimList || []) translations.dimTitles[x.reportFieldName] = x.displayText;
  for (const x of d.metricsList || []) {
    translations.metricTitles[x.reportFieldName] = x.displayText;
    if (x.explain) translations.metricExplain[x.reportFieldName] = x.explain;
  }
  console.log(`  metadata/get reportId=${reportId}: ${(d.dimList||[]).length} dims, ${(d.metricsList||[]).length} metrics`);
}

// 2) dim/getDimOptions per (reportId, dim). Only look up dim codes that actually appear as values in the data rows,
//    so we don't flood the API with irrelevant ones.
// Inspect all replayed responses to find dim codes that have ID-like values we need to translate.
const dimsWithIdValues = new Set();
for (const slug of slugs) {
  const dir = path.join(outRoot, slug, 'replay-30d');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f)));
    const rows = j.result?.body?.data?.rows || j.result?.body?.data?.list;
    if (!Array.isArray(rows)) continue;
    for (const row of rows.slice(0, 2)) {
      for (const [k, v] of Object.entries(row || {})) {
        if (!k.startsWith('D_')) continue;
        const raw = v && typeof v === 'object' && 'value' in v ? v.value : v;
        if (typeof raw === 'string' && /^[0-9]{6,}/.test(raw) && raw.includes('-')) {
          dimsWithIdValues.add(k);
        }
      }
    }
  }
}
// The items-breakdown dim "D_category" is actually the foodCategory UUID series; getDimOptions uses dimCode "D_foodCategory".
const dimCodeAlias = { D_category: 'D_foodCategory' };

// Always try to translate these dims even if values don't look like IDs (payment codes, shop IDs, etc.).
const ALWAYS_TRANSLATE = [
  'D_payerType',
  'D_shopName',
  'D_shopId',
  'D_diningOption',
  'D_parentCategory',
  'D_promotionSubType',
  'D_surchargeType',
  'D_taxName',
];
for (const d of ALWAYS_TRANSLATE) dimsWithIdValues.add(d);

console.log('[translate] dims with ID-like values that need name mapping:', [...dimsWithIdValues]);

for (const dim of dimsWithIdValues) {
  const dimCode = dimCodeAlias[dim] || dim;
  // Try with each reportId we know; pick the first that returns options.
  let got = false;
  for (const reportId of usedReportIds) {
    const r = await apiPost(`${BASE}/api/report/dim/getDimOptions`, {
      corporationId,
      dimCode: [dimCode],
      shopIds: [shopId],
      reportId,
    });
    const list = r.body?.data?.list?.[0];
    if (list?.options?.length) {
      translations.dimOptions[dim] = Object.fromEntries(list.options.map((o) => [o.value, o.name]));
      console.log(`  dim ${dim} (via ${dimCode}, reportId=${reportId}): ${list.options.length} options`);
      got = true;
      break;
    }
  }
  if (!got) console.log(`  dim ${dim}: no options found`);
}

// Fallback: many dims are backed by operation-manager field enums. Load those directly.
const enumCodeByDim = {
  D_payerType: 'PaymentMethod',
  D_diningOption: 'OrderType',
  D_promotionSubType: 'PromotionType',
  D_surchargeType: 'SurchargeType',
  D_itemType: 'MenuItemType',
};
for (const [dim, enumCode] of Object.entries(enumCodeByDim)) {
  if (Object.keys(translations.dimOptions[dim] || {}).length) continue;
  const r = await apiPost(`${BASE}/operation-manager/object/field/enum/metadata/listFieldEnumValue`, { code: enumCode });
  const data = r.body?.data;
  if (Array.isArray(data) && data.length) {
    // enumValueName is the code stored in rows; enumKeyName is the human label.
    translations.dimOptions[dim] = Object.fromEntries(data.map((x) => [x.enumValueName, x.enumKeyName]));
    console.log(`  enum fallback ${dim} (${enumCode}): ${data.length} values`);
  }
}

// Fallback: mine previously-captured dim/getDimOptions responses from raw/ directories.
// These are real data from earlier scrapes, useful when today's live getDimOptions is broken.
for (const slug of slugs) {
  const rawDir = path.join(outRoot, slug, 'raw');
  if (!fs.existsSync(rawDir)) continue;
  for (const f of fs.readdirSync(rawDir).filter((x) => x.endsWith('.json') && x.includes('getDimOptions'))) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(rawDir, f)));
      const list = j.body?.data?.list || [];
      for (const l of list) {
        if (!l.dimCode || !l.options?.length) continue;
        const alias = Object.entries(dimCodeAlias).find(([, v]) => v === l.dimCode)?.[0] || l.dimCode;
        const existing = translations.dimOptions[alias] || {};
        const merged = { ...Object.fromEntries(l.options.map((o) => [o.value, o.name])), ...existing };
        translations.dimOptions[alias] = merged;
      }
    } catch {}
  }
}

// Shop id/name fallback from queryOrgView (we pulled it while scraping).
try {
  const r = await apiPost(`${BASE}/vulcan/employee/queryOrgView`, {});
  const shops = r.body?.data?.shopOrganizationRoleList || [];
  if (shops.length) {
    translations.dimOptions.D_shopId = Object.fromEntries(shops.map((s) => [String(s.shopId), (s.shopName || '').trim()]));
    translations.dimOptions.D_shopName = translations.dimOptions.D_shopId;
    console.log(`  shop fallback: ${shops.length} shops`);
  }
} catch {}

console.log('[translate] after all fallbacks:', Object.keys(translations.dimOptions).map((k) => `${k}=${Object.keys(translations.dimOptions[k]).length}`).join(', '));

// 3) getDynamicSubHead — translate "M_xxx_BY_D_yyy_ID" columns.
//    We reuse the real request bodies captured earlier (they carry the exact selectFields/filters
//    the dynamic subheads depend on).
for (const slug of slugs) {
  const replayDir = path.join(outRoot, slug, 'replay-30d');
  for (const f of fs.readdirSync(replayDir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(replayDir, f)));
    const b = j.reqBody || {};
    if (!Array.isArray(b.metricsByDimQryV2) || b.metricsByDimQryV2.length === 0) continue;
    // Minimal payload for getDynamicSubHead: same fields.
    const payload = {
      reportId: b.reportId,
      selectFields: b.selectFields,
      filters: b.filters,
      metricsByDimQryV2: b.metricsByDimQryV2,
    };
    const r = await apiPost(`${BASE}/api/report/metadata/getDynamicSubHead`, payload);
    const list = r.body?.data?.list || [];
    for (const entry of list) {
      for (const sh of entry.subHeads || []) {
        if (sh.metricsCode && sh.title) translations.dynamicSubHeads[sh.metricsCode] = sh.title;
      }
    }
  }
}
console.log(`[translate] collected ${Object.keys(translations.dynamicSubHeads).length} dynamic subhead titles`);

fs.writeFileSync(translationsPath, JSON.stringify(translations, null, 2));
console.log(`[translate] wrote ${translationsPath}`);
await browser.close();
