// End-to-end smoke test for the sales API.
// - Boots the server as a child process
// - Hits every endpoint
// - Verifies auth, JSON shape, CSV format
// - Prints a coloured pass/fail table and exits non-zero on any failure.

import 'dotenv/config';
import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const KEY = process.env.API_KEY;
if (!KEY) {
  console.error('API_KEY not set in .env');
  process.exit(1);
}
const BASE = `http://localhost:${PORT}`;

const tests = [];

function record(name, ok, detail = '') {
  tests.push({ name, ok, detail });
  const icon = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
}

function req(path, { auth = true, accept, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (auth) headers.authorization = `Bearer ${KEY}`;
    if (accept) headers.accept = accept;
    const r = http.request({ host: 'localhost', port: PORT, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    r.on('error', reject);
    r.end();
  });
}

function parseJson(body) { try { return JSON.parse(body); } catch { return null; } }

// ---- wait for server to be ready ------------------------------------------

async function waitReady(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await req('/', { auth: false });
      if (r.status === 200) return true;
    } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  return false;
}

// ---- boot server ----------------------------------------------------------

console.log(`[test] starting server on port ${PORT}...`);
const server = spawn(process.execPath, ['server.js'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (b) => { serverLog += b.toString(); });
server.stderr.on('data', (b) => { serverLog += b.toString(); });

const ready = await waitReady();
if (!ready) {
  console.error('[test] server did not become ready. Log:\n' + serverLog);
  server.kill();
  process.exit(1);
}
console.log('[test] server up\n');

try {
  // 1. Public catalog
  {
    const r = await req('/', { auth: false });
    const j = parseJson(r.body);
    record('GET / (public catalog)',
      r.status === 200 && j?.name === 'Restosuite sales proxy' && Array.isArray(j.endpoints),
      `status=${r.status} endpoints=${j?.endpoints?.length || 0}`);
  }

  // 2. /v1/status
  {
    const r = await req('/v1/status', { auth: false });
    const j = parseJson(r.body);
    record('GET /v1/status (public)',
      r.status === 200 && Array.isArray(j?.files) && j.files.length >= 11,
      `files=${j?.files?.length}`);
  }

  // 3. Auth: missing key → 401
  {
    const r = await req('/v1/sales/overview', { auth: false });
    record('GET /v1/sales/overview without key → 401', r.status === 401, `status=${r.status}`);
  }

  // 4. Auth: wrong key → 401
  {
    const r = await new Promise((resolve, reject) => {
      const req2 = http.request({ host: 'localhost', port: PORT, path: '/v1/sales/overview', headers: { authorization: 'Bearer wrong' } }, (res) => {
        const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
      });
      req2.on('error', reject); req2.end();
    });
    record('GET /v1/sales/overview with wrong key → 401', r.status === 401, `status=${r.status}`);
  }

  // 5. Auth via ?key= query param
  {
    const r = await req(`/v1/sales/overview?key=${encodeURIComponent(KEY)}`, { auth: false });
    const j = parseJson(r.body);
    record('GET /v1/sales/overview via ?key=',
      r.status === 200 && j?.rows?.[0]?.['Net Sales'],
      `status=${r.status} netSales=${j?.rows?.[0]?.['Net Sales']}`);
  }

  // 6. All data endpoints, JSON
  const dataRoutes = [
    ['/v1/sales/overview', (j) => j.rows.length === 1 && 'Net Sales' in j.rows[0]],
    ['/v1/sales/totals', (j) => j.rows.length === 1 && 'Bill Count' in j.rows[0]],
    ['/v1/sales/by-date', (j) => j.rows.length >= 1 && 'Business Date' in j.rows[0]],
    ['/v1/sales/by-dining-option', (j) => j.rows.length >= 1 && 'Dining Options' in j.rows[0]],
    ['/v1/sales/by-payment', (j) => j.rows.length >= 1 && 'Third-Party Payment Method' in j.rows[0]],
    ['/v1/items/totals', (j) => j.rows.length === 1],
    ['/v1/items/by-category', (j) => j.rows.length >= 1 && 'Dish Subcategory' in j.rows[0]],
    ['/v1/items/by-dish', (j) => j.rows.length >= 1],
    ['/v1/items/by-hour', (j) => j.rows.length >= 1 && 'Dish Name' in j.rows[0] && 'Hour' in j.rows[0]],
    ['/v1/items/by-hour-qty', (j) => j.rows.length >= 1 && 'H12' in j.rows[0]],
    ['/v1/items/by-hour-sales', (j) => j.rows.length >= 1 && 'Total Net Sales' in j.rows[0]],
  ];
  for (const [path, verify] of dataRoutes) {
    const r = await req(path);
    const j = parseJson(r.body);
    const ok = r.status === 200 && j && verify(j);
    record(`GET ${path} (JSON)`, ok, `status=${r.status} rows=${j?.rows?.length ?? '?'}`);
  }

  // 7. CSV format selection
  {
    const r = await req('/v1/sales/by-date?format=csv');
    const firstLine = r.body.split('\n')[0];
    record('GET /v1/sales/by-date?format=csv',
      r.status === 200 && /text\/csv/.test(r.headers['content-type']) && firstLine.includes('Business Date'),
      `content-type=${r.headers['content-type']}`);
  }

  // 8. CSV via Accept header
  {
    const r = await req('/v1/items/by-hour-qty', { accept: 'text/csv' });
    const firstLine = r.body.split('\n')[0];
    record('GET /v1/items/by-hour-qty (Accept: text/csv)',
      r.status === 200 && /text\/csv/.test(r.headers['content-type']) && firstLine.startsWith('Dish Name,'),
      `first col=${firstLine.split(',')[0]}`);
  }

  // 9. 404 for unknown path
  {
    const r = await req('/v1/nope');
    record('GET /v1/nope → 404', r.status === 404, `status=${r.status}`);
  }

  // 10. POST /v1/refresh without auth → 401
  {
    const r = await req('/v1/refresh', { auth: false, method: 'POST' });
    record('POST /v1/refresh without auth → 401', r.status === 401, `status=${r.status}`);
  }

  // 11. Data sanity: guests and bill count should agree within reason
  {
    const r = await req('/v1/sales/overview');
    const row = parseJson(r.body)?.rows?.[0];
    const guests = Number(row?.['Num Of Guests'] || 0);
    const bills = Number(row?.['Bill Count'] || 0);
    const netSales = Number(row?.['Net Sales'] || 0);
    record('sales overview sanity (netSales > 0, guests > 0, bills > 0)',
      netSales > 0 && guests > 0 && bills > 0,
      `netSales=${netSales} guests=${guests} bills=${bills}`);
  }

  // 12. by-hour-qty: ensure 24 H-columns present and totals match sum of hours
  {
    const r = await req('/v1/items/by-hour-qty');
    const j = parseJson(r.body);
    const top = j?.rows?.[0];
    let hoursOk = false, sumOk = false;
    if (top) {
      const hourCols = Object.keys(top).filter((k) => /^H\d\d$/.test(k));
      hoursOk = hourCols.length === 24;
      const summed = hourCols.reduce((a, k) => a + Number(top[k] || 0), 0);
      const total = Number(top['Total Qty'] || 0);
      sumOk = Math.abs(summed - total) <= 1;
    }
    record('items by-hour-qty: 24 hour columns + totals reconcile',
      hoursOk && sumOk,
      `topDish=${top?.['Dish Name']} totalQty=${top?.['Total Qty']}`);
  }

} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 200));
}

const failed = tests.filter((t) => !t.ok);
console.log(`\n\x1b[1m${tests.length - failed.length}/${tests.length} passed\x1b[0m`);
if (failed.length) {
  console.log('\n\x1b[31mFailed tests:\x1b[0m');
  for (const f of failed) console.log('  - ' + f.name + (f.detail ? ' [' + f.detail + ']' : ''));
  process.exit(1);
}
