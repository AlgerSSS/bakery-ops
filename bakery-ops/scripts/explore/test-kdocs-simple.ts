import * as fs from 'fs';

const log: string[] = [];
const TIMEOUT = 10000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms)),
  ]);
}

async function run() {
  log.push('=== Script started ===');

  // Test 1: KDocs API auth
  log.push('Testing KDocs API...');
  try {
    const res = await withTimeout(fetch('https://www.kdocs.cn/api/v3/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: 'SX20260505QAMOIL',
        app_secret: 'qYTHBLaPWMhBzQuHoDIrLXPoplumMVqV',
        grant_type: 'client_credentials',
      }),
    }), TIMEOUT);
    const text = await res.text();
    log.push(`KDocs status: ${res.status}`);
    log.push(`KDocs body: ${text.slice(0, 300)}`);
  } catch (err) {
    log.push(`KDocs error: ${String(err)}`);
  }

  fs.writeFileSync('/tmp/sc-result.txt', log.join('\n'));
  process.exit(0);
}

// Write immediately to confirm script runs
fs.writeFileSync('/tmp/sc-result.txt', 'STARTED\n');
run().catch(e => {
  log.push(`Fatal: ${String(e)}`);
  fs.writeFileSync('/tmp/sc-result.txt', log.join('\n'));
  process.exit(1);
});
