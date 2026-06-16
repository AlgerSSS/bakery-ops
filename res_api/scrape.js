import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

if (!fs.existsSync('storageState.json')) {
  console.error('storageState.json not found. Run `npm run login` first.');
  process.exit(1);
}

const BASE = 'https://bo.sea.restosuite.ai';

// Last 30 days ending today, in the shop's local timezone (Asia/Kuala_Lumpur).
// Using local-time wall clock matches the back office's notion of "business date".
const tz = 'Asia/Kuala_Lumpur';
const today = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
today.setHours(0, 0, 0, 0);
const from = new Date(today);
from.setDate(from.getDate() - 29);
const pad = (n) => String(n).padStart(2, '0');
const fmtSlash = (d) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
const fmtDash = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const RANGE_SLASH = [fmtSlash(from), fmtSlash(today)];
const RANGE_DASH = [fmtDash(from), fmtDash(today)];
console.log(`[scrape] date range: ${RANGE_DASH.join(' .. ')}`);

const TARGETS = [
  { slug: 'sales-overview', url: `${BASE}/report/report-overview`, label: 'Sales Overview' },
  { slug: 'sales-summary', url: `${BASE}/report/report-sales-breakdown`, label: 'Sales Summary' },
  { slug: 'items-breakdown', url: `${BASE}/report/report-items-breakdowm`, label: 'Items Breakdown' },
];

const outRoot = 'output/sales';
fs.mkdirSync(outRoot, { recursive: true });

function rewriteDateFilter(reqBody) {
  if (!reqBody || typeof reqBody !== 'object') return reqBody;
  const body = JSON.parse(JSON.stringify(reqBody));
  if (Array.isArray(body.filters)) {
    body.filters = body.filters.filter((f) => f.fieldName !== 'D_compare_businessDate');
    for (const f of body.filters) {
      if (f.fieldName === 'D_businessDate' && f.filterType === 'RANGE') {
        const orig = Array.isArray(f.filterValue) && f.filterValue[0];
        const usesSlash = typeof orig === 'string' && orig.includes('/');
        f.filterValue = usesSlash ? [...RANGE_SLASH] : [...RANGE_DASH];
      }
    }
  }
  if (body.page && typeof body.page === 'object') {
    body.page.pageSize = Math.max(body.page.pageSize || 0, 500);
    body.page.pageNo = 1;
  }
  return body;
}

function toCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const keys = Array.from(
    rows.reduce((acc, row) => {
      Object.keys(row || {}).forEach((k) => acc.add(k));
      return acc;
    }, new Set())
  );
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
    return s;
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

// Report APIs wrap each metric cell as { value, displayValue, abbrDisplayValue }.
// Flatten to scalars for CSV convenience.
function flattenCell(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('value' in v && ('displayValue' in v || 'abbrDisplayValue' in v)) return v.value;
  }
  return v;
}
function flattenRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = flattenCell(v);
  return out;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: 'storageState.json' });

for (const target of TARGETS) {
  const dir = path.join(outRoot, target.slug);
  const rawDir = path.join(dir, 'raw');
  const replayDir = path.join(dir, 'replay-30d');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(replayDir, { recursive: true });
  console.log(`\n=== ${target.label} ===`);

  const page = await context.newPage();
  const captured = [];

  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    const method = response.request().method();
    if (!ct.includes('application/json')) return;
    if (!url.includes('restosuite.ai')) return;
    try {
      const body = await response.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch { return; }
      let reqBody = null;
      try { reqBody = response.request().postDataJSON(); } catch {}
      const reqHeaders = response.request().headers();
      captured.push({ url, method, status: response.status(), reqHeaders, reqBody, body: parsed });
    } catch {}
  });

  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded' });
  } catch (e) {
    console.log(`  goto failed: ${e.message}`);
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(6000);

  await page.screenshot({ path: path.join(dir, 'page.png'), fullPage: true }).catch(() => {});

  // Save raw captures including request headers so we can inspect later.
  captured.forEach((c, i) => {
    const safe = c.url.replace(/https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 120);
    fs.writeFileSync(
      path.join(rawDir, `${String(i).padStart(3, '0')}_${safe}.json`),
      JSON.stringify(
        { url: c.url, method: c.method, status: c.status, reqHeaders: c.reqHeaders, reqBody: c.reqBody, body: c.body },
        null,
        2
      )
    );
  });

  const replayable = captured.filter(
    (c) =>
      c.method === 'POST' &&
      c.reqBody &&
      /\/api\/report\/data\/(queryData|dataBlock)/.test(c.url) &&
      Array.isArray(c.reqBody.filters) &&
      c.reqBody.filters.some((f) => f.fieldName === 'D_businessDate')
  );
  console.log(`  ${replayable.length} report queries eligible for 30-day replay`);

  const replaySummary = [];
  let idx = 0;
  for (const c of replayable) {
    const newBody = rewriteDateFilter(c.reqBody);

    // Replay inside the page context so the request is same-origin and carries cookies/auth.
    const result = await page.evaluate(
      async ({ url, body, origHeaders }) => {
        // Copy all headers from the real XHR except the ones the browser manages itself
        // (host, origin, referer, content-length, cookie, ua-... are fine to leave or override).
        const forbidden = new Set([
          'host', 'connection', 'content-length', 'cookie',
          ':authority', ':method', ':path', ':scheme',
        ]);
        const headers = {};
        for (const [k, v] of Object.entries(origHeaders || {})) {
          if (forbidden.has(k.toLowerCase())) continue;
          headers[k] = v;
        }
        headers['content-type'] = 'application/json';
        headers['accept'] = 'application/json, text/plain, */*';
        try {
          const r = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify(body),
          });
          const text = await r.text();
          let parsed;
          try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
          return { status: r.status, body: parsed, sentHeaders: headers };
        } catch (e) {
          return { status: 0, error: String(e) };
        }
      },
      { url: c.url, body: newBody, origHeaders: c.reqHeaders }
    );

    const safe = c.url.replace(/https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 120);
    const base = `${String(idx).padStart(3, '0')}_${safe}`;
    fs.writeFileSync(
      path.join(replayDir, `${base}.json`),
      JSON.stringify({ url: c.url, reqBody: newBody, result }, null, 2)
    );

    const rows = extractRows(result.body);
    if (rows && rows.length) {
      const flat = rows.map(flattenRow);
      fs.writeFileSync(path.join(replayDir, `${base}.csv`), toCsv(flat));
    }

    const d = result.body?.data ?? result.body;
    let valuePreview = null;
    if (d && !rows && typeof d === 'object' && !Array.isArray(d)) {
      valuePreview = Object.fromEntries(Object.entries(d).slice(0, 12));
    }

    replaySummary.push({
      file: `${base}.json`,
      endpoint: c.url.replace(BASE, ''),
      reportId: newBody.reportId,
      selectFields: newBody.selectFields,
      metricsByDim: (newBody.metricsByDimQryV2 || []).map((m) => ({ dims: m.dims?.map((x) => x.dim), metric: m.metrics })),
      status: result.status,
      code: result.body?.code,
      msg: result.body?.msg,
      rowCount: rows ? rows.length : null,
      valuePreview,
    });
    idx++;
  }

  fs.writeFileSync(path.join(dir, 'replay-summary.json'), JSON.stringify(replaySummary, null, 2));
  console.log(`  saved ${idx} replayed responses -> ${replayDir}`);
  await page.close();
}

await browser.close();
console.log('\n[scrape] done');
