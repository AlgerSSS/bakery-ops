import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { parseCsv } from './lib/csv-parser.js';

const PORT = Number(process.env.PORT || 8787);
const API_KEY = process.env.API_KEY || (() => {
  const k = 'hc_' + randomBytes(24).toString('hex');
  console.log(`[server] no API_KEY in .env — generated one for this run: ${k}`);
  return k;
})();

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean);

// Token bucket rate limiter: 60 requests/minute per IP
const rateBuckets = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket) { bucket = { tokens: 60, last: now }; rateBuckets.set(ip, bucket); }
  const elapsed = (now - bucket.last) / 1000;
  bucket.tokens = Math.min(60, bucket.tokens + elapsed * 1); // refill 1/sec = 60/min
  bucket.last = now;
  if (bucket.tokens < 1) return true;
  bucket.tokens -= 1;
  return false;
}

const READABLE_DIR = 'output/sales/readable';
const PER_PAGE_DIR = 'output/sales';
const DAILY_FILE = 'output/daily/daily.json';

function loadDaily() {
  if (!fs.existsSync(DAILY_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8'));
  } catch { return null; }
}

// ---- CSV helpers -----------------------------------------------------------

function loadCsv(relPath) {
  const full = path.resolve(relPath);
  if (!fs.existsSync(full)) return null;
  const text = fs.readFileSync(full, 'utf8');
  return { rows: parseCsv(text), raw: text, mtime: fs.statSync(full).mtimeMs };
}

function toCsvText(rows) {
  if (!rows?.length) return '';
  const keys = Array.from(rows.reduce((a, r) => { Object.keys(r || {}).forEach((k) => a.add(k)); return a; }, new Set()));
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}

// ---- Route map -------------------------------------------------------------

const ROUTES = {
  '/v1/sales/overview':         `${READABLE_DIR}/kpi_overview_core.csv`,
  '/v1/sales/totals':           `${READABLE_DIR}/kpi_summary_totals.csv`,
  '/v1/sales/by-date':          `${READABLE_DIR}/sales_by_business_date.csv`,
  '/v1/sales/by-dining-option': `${READABLE_DIR}/orders_by_dining_option.csv`,
  '/v1/sales/by-payment':       `${READABLE_DIR}/payment_by_payer_type.csv`,
  '/v1/items/totals':           `${READABLE_DIR}/items_totals.csv`,
  '/v1/items/by-category':      `${READABLE_DIR}/items_by_category.csv`,
  '/v1/items/by-dish':          `${READABLE_DIR}/items_by_dish_unit_30d.csv`,
  '/v1/items/by-hour':          `${READABLE_DIR}/items_by_hour_long.csv`,
  '/v1/items/by-hour-qty':      `${READABLE_DIR}/items_by_hour_qty.csv`,
  '/v1/items/by-hour-sales':    `${READABLE_DIR}/items_by_hour_sales.csv`,
};

// Daily analysis endpoints (served from output/daily/daily.json)
const DAILY_ENDPOINTS = [
  '/v1/daily/summary',
  '/v1/daily/hourly',
  '/v1/daily/items',
  '/v1/daily/items-by-hour',
  '/v1/daily/payment',
  '/v1/daily/dining',
  '/v1/daily/analysis',
];

// ---- Auth ------------------------------------------------------------------

function isAuthorized(req, url) {
  const hdr = req.headers['authorization'] || '';
  const bearer = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  const key = bearer || url.searchParams.get('key');
  return key && key === API_KEY;
}

// ---- Refresh runner --------------------------------------------------------

let refreshRunning = false;
let lastRefresh = null;

function runRefresh() {
  return new Promise((resolve) => {
    if (refreshRunning) return resolve({ ok: false, error: 'refresh already running' });
    refreshRunning = true;
    const logLines = [];
    const start = Date.now();

    const steps = [
      ['login', 'login.js'],
      ['scrape', 'scrape.js'],
      ['scrape-items-by-hour', 'scrape-items-by-hour.js'],
      ['scrape-daily', 'scrape-daily.js'],
      ['translate', 'fetch-translations.js'],
      ['apply', 'apply-translations.js'],
      ['apply-items-by-hour', 'apply-items-by-hour.js'],
      ['sync-to-db', 'sync-to-db.js'],
    ];

    (async () => {
      for (const [label, script] of steps) {
        logLines.push(`\n# ${label}`);
        const code = await new Promise((res) => {
          const child = spawn(process.execPath, [script], { env: process.env });
          child.stdout.on('data', (b) => logLines.push(b.toString()));
          child.stderr.on('data', (b) => logLines.push(b.toString()));
          child.on('close', res);
        });
        if (code !== 0) {
          refreshRunning = false;
          lastRefresh = { ok: false, failedAt: label, elapsedMs: Date.now() - start, log: logLines.join('') };
          return resolve(lastRefresh);
        }
      }
      refreshRunning = false;
      lastRefresh = { ok: true, elapsedMs: Date.now() - start, log: logLines.join('') };
      resolve(lastRefresh);
    })();
  });
}

// ---- Daily analysis builder ------------------------------------------------

function buildAnalysis(daily) {
  const s = daily.summary || {};
  const hourly = daily.hourly || [];
  const items = daily.topItems || [];
  const channels = daily.paymentBreakdown || s.paymentChannels || [];
  const dining = daily.diningOption || [];

  // Peak hours (top 3 by bill count)
  const peakHours = [...hourly].sort((a, b) => b.billCount - a.billCount).slice(0, 3);

  // Customer segments by dining option
  const totalBills = dining.reduce((a, d) => a + d.billCount, 0);
  const customerSegments = dining.map((d) => ({
    segment: d.type,
    billCount: d.billCount,
    pct: totalBills > 0 ? +((d.billCount / totalBills) * 100).toFixed(1) : 0,
    netSales: d.netSales,
  }));

  // Payment strategy
  const totalPayment = channels.reduce((a, c) => a + c.amount, 0);
  const bankCard = channels.filter((c) => /bank card|external/i.test(c.channel)).reduce((a, c) => a + c.amount, 0);
  const tng = channels.filter((c) => /touch.*go|tng/i.test(c.channel)).reduce((a, c) => a + c.amount, 0);
  const membership = channels.filter((c) => /member/i.test(c.channel)).reduce((a, c) => a + c.amount, 0);
  const cash = channels.filter((c) => /cash/i.test(c.channel)).reduce((a, c) => a + c.amount, 0);

  // Revenue strategy insights
  const strategies = [];
  if (s.discountRate > 10) strategies.push({ type: 'discount_alert', msg: `Discount rate ${s.discountRate}% is high (>10%). Consider tightening promotions.` });
  if (s.discountRate < 5) strategies.push({ type: 'discount_ok', msg: `Discount rate ${s.discountRate}% is healthy (<5%).` });
  if (s.memberSalesRatio < 15) strategies.push({ type: 'member_growth', msg: `Member payment ratio ${s.memberSalesRatio}% is low. Push membership sign-ups.` });
  if (s.memberSalesRatio > 30) strategies.push({ type: 'member_strong', msg: `Member payment ratio ${s.memberSalesRatio}% is strong. Loyalty program working.` });
  if (peakHours.length && peakHours[0].hour) {
    const peakStr = peakHours.map((h) => `${h.hour}:00`).join(', ');
    strategies.push({ type: 'peak_hours', msg: `Peak hours: ${peakStr}. Focus staffing and prep here.` });
  }
  if (items.length > 0) {
    const topItem = items[0];
    strategies.push({ type: 'top_seller', msg: `Top seller: ${topItem.name} (${topItem.qty} units, RM${topItem.netSales.toFixed(2)}).` });
  }

  return {
    dateRange: daily.dateRange,
    scrapedAt: daily.scrapedAt,
    kpi: {
      billCount: s.billCount,
      avgTicket: s.avgTicket,
      grossSales: s.grossSales,
      netSales: s.netSales,
      discountRate: s.discountRate,
      memberSalesRatio: s.memberSalesRatio,
    },
    peakHours,
    customerSegments,
    paymentMix: {
      bankCard: { amount: +bankCard.toFixed(2), pct: totalPayment > 0 ? +((bankCard / totalPayment) * 100).toFixed(1) : 0 },
      touchNGo: { amount: +tng.toFixed(2), pct: totalPayment > 0 ? +((tng / totalPayment) * 100).toFixed(1) : 0 },
      membership: { amount: +membership.toFixed(2), pct: totalPayment > 0 ? +((membership / totalPayment) * 100).toFixed(1) : 0 },
      cash: { amount: +cash.toFixed(2), pct: totalPayment > 0 ? +((cash / totalPayment) * 100).toFixed(1) : 0 },
    },
    strategies,
  };
}

// ---- HTTP handler ----------------------------------------------------------

function corsOrigin(req) {
  const origin = req.headers['origin'] || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function sendJson(res, status, body, req) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': corsOrigin(req) });
  res.end(JSON.stringify(body));
}
function sendCsv(res, status, text, req) {
  res.writeHead(status, { 'content-type': 'text/csv; charset=utf-8', 'access-control-allow-origin': corsOrigin(req) });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const wantsCsv = url.searchParams.get('format') === 'csv' || (req.headers.accept || '').includes('text/csv');

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': corsOrigin(req),
      'access-control-allow-headers': 'authorization, content-type, accept',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    });
    return res.end();
  }

  // Rate limiting
  const ip = req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return sendJson(res, 429, { error: 'too many requests' }, req);
  }

  // Public endpoints
  if (url.pathname === '/' || url.pathname === '/v1') {
    return sendJson(res, 200, {
      name: 'Restosuite sales proxy',
      corporation: 'Yuns & hot crush sdn bhd',
      brand: 'HOT CRUSH BAKERY',
      shop: { id: '406994127', name: 'HOT CRUSH BAKERY' },
      window: 'last 30 days relative to last refresh',
      dataSource: 'scraped from bo.sea.restosuite.ai back office',
      auth: 'Authorization: Bearer <API_KEY>  or  ?key=<API_KEY>',
      endpoints: [
        ...Object.keys(ROUTES).map((p) => ({ path: p, formats: ['json', 'csv'] })),
        ...DAILY_ENDPOINTS.map((p) => ({ path: p, formats: ['json'] })),
        { path: '/v1/status', auth: false },
        { path: '/v1/refresh', method: 'POST', auth: true, note: 'Re-scrape + sync to DB. Takes 1-2 minutes.' },
      ],
    }, req);
  }
  if (url.pathname === '/v1/status') {
    const files = Object.entries(ROUTES).map(([route, file]) => {
      const st = fs.existsSync(file) ? fs.statSync(file) : null;
      return { route, file, exists: !!st, size: st?.size || 0, modified: st ? new Date(st.mtimeMs).toISOString() : null };
    });
    return sendJson(res, 200, { refreshRunning, lastRefresh, files }, req);
  }

  // Authenticated endpoints below this line
  if (!isAuthorized(req, url)) {
    return sendJson(res, 401, { error: 'unauthorized', hint: 'Authorization: Bearer <API_KEY> or ?key=<API_KEY>' }, req);
  }

  if (url.pathname === '/v1/refresh' && req.method === 'POST') {
    if (refreshRunning) return sendJson(res, 409, { error: 'refresh already running' }, req);
    runRefresh();
    return sendJson(res, 202, { status: 'started', pollAt: '/v1/status' }, req);
  }

  // Daily analysis endpoints
  if (url.pathname.startsWith('/v1/daily/')) {
    const daily = loadDaily();
    if (!daily) return sendJson(res, 503, { error: 'data not yet available', hint: 'POST /v1/refresh-daily' }, req);

    if (url.pathname === '/v1/daily/summary') {
      return sendJson(res, 200, {
        dateRange: daily.dateRange,
        scrapedAt: daily.scrapedAt,
        ...daily.summary,
      }, req);
    }
    if (url.pathname === '/v1/daily/hourly') {
      return sendJson(res, 200, { dateRange: daily.dateRange, rows: daily.hourly || [] }, req);
    }
    if (url.pathname === '/v1/daily/items') {
      return sendJson(res, 200, { dateRange: daily.dateRange, count: (daily.topItems || []).length, rows: daily.topItems || [] }, req);
    }
    if (url.pathname === '/v1/daily/items-by-hour') {
      return sendJson(res, 200, { dateRange: daily.dateRange, count: (daily.itemsByHour || []).length, rows: daily.itemsByHour || [] }, req);
    }
    if (url.pathname === '/v1/daily/payment') {
      return sendJson(res, 200, { dateRange: daily.dateRange, rows: daily.paymentBreakdown || daily.summary?.paymentChannels || [] }, req);
    }
    if (url.pathname === '/v1/daily/dining') {
      return sendJson(res, 200, { dateRange: daily.dateRange, rows: daily.diningOption || [] }, req);
    }
    if (url.pathname === '/v1/daily/analysis') {
      return sendJson(res, 200, buildAnalysis(daily), req);
    }
    return sendJson(res, 404, { error: 'not found', path: url.pathname }, req);
  }

  const file = ROUTES[url.pathname];
  if (file) {
    const data = loadCsv(file);
    if (!data) return sendJson(res, 503, { error: 'data not yet available', hint: 'POST /v1/refresh' }, req);
    if (wantsCsv) return sendCsv(res, 200, data.raw, req);
    return sendJson(res, 200, {
      route: url.pathname,
      modified: new Date(data.mtime).toISOString(),
      count: data.rows.length,
      rows: data.rows,
    }, req);
  }

  // Let advanced users hit raw per-page CSVs via /v1/raw/<slug>/<name>.csv
  const rawMatch = url.pathname.match(/^\/v1\/raw\/([a-z-]+)\/([\w.\-+]+\.csv)$/);
  if (rawMatch) {
    const [, slug, name] = rawMatch;
    const fpath = path.join(PER_PAGE_DIR, slug, 'readable', name);
    const data = loadCsv(fpath);
    if (!data) return sendJson(res, 404, { error: 'not found', tried: fpath }, req);
    if (wantsCsv) return sendCsv(res, 200, data.raw, req);
    return sendJson(res, 200, { route: url.pathname, count: data.rows.length, rows: data.rows }, req);
  }

  sendJson(res, 404, { error: 'not found', path: url.pathname }, req);
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] API key: ${API_KEY}`);
  console.log(`[server] try:   curl -H "Authorization: Bearer ${API_KEY}" http://localhost:${PORT}/v1/sales/overview`);
});
