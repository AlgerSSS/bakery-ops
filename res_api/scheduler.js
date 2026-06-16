import 'dotenv/config';
import cron from 'node-cron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const shops = JSON.parse(fs.readFileSync('shops.json', 'utf8'));

function resolveEnv(val) {
  if (typeof val === 'string' && val.startsWith('ENV:')) return process.env[val.slice(4)] || '';
  return val;
}

function runShop(shop) {
  const logDir = path.join('output', 'logs', shop.id);
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10)}.log`);
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  const ts = () => new Date().toISOString();

  log.write(`\n=== ${ts()} refresh started for ${shop.name} (${shop.id}) ===\n`);
  console.log(`[${ts()}] [${shop.name}] refresh started`);

  const email = resolveEnv(shop.credentials.email);
  const password = resolveEnv(shop.credentials.password);
  const dbUrl = resolveEnv(shop.database);
  const stateFile = `storageState-${shop.id}.json`;

  const stepEnv = { ...process.env, HC_EMAIL: email, HC_PASSWORD: password, DATABASE_URL: dbUrl };

  const steps = [
    ['login', ['login.js', `--shop-id=${shop.id}`]],
    ['scrape-daily', ['scrape-daily.js', `--shop-id=${shop.id}`, `--state-file=${stateFile}`]],
    ['sync-to-db', ['sync-to-db.js']],
  ];

  (async () => {
    for (const [label, args] of steps) {
      log.write(`\n# ${label}\n`);
      const code = await new Promise((resolve) => {
        const child = spawn(process.execPath, args, { env: stepEnv });
        child.stdout.on('data', (b) => log.write(b));
        child.stderr.on('data', (b) => log.write(b));
        child.on('close', resolve);
        child.on('error', (err) => {
          log.write(`\n!!! ${label} spawn error: ${err.message}\n`);
          resolve(1);
        });
      });
      if (code !== 0) {
        log.write(`\n!!! ${label} failed with code ${code}\n`);
        console.error(`[${ts()}] [${shop.name}] FAILED at ${label}`);
        return;
      }
    }
    log.write(`\n=== ${ts()} refresh completed ===\n`);
    console.log(`[${ts()}] [${shop.name}] refresh completed`);
  })();
}

// PLACEHOLDER_SCHEDULE

console.log('[scheduler] registering shops:\n');

for (const shop of shops) {
  const [hour, minute] = (shop.refreshAt || '01:00').split(':').map(Number);
  const cronExpr = `${minute} ${hour} * * *`;

  cron.schedule(cronExpr, () => runShop(shop), { timezone: shop.timezone });

  console.log(`  ${shop.name} (${shop.id})`);
  console.log(`    timezone: ${shop.timezone}`);
  console.log(`    schedule: ${cronExpr} (${shop.refreshAt} local)`);
  console.log('');
}

console.log(`[scheduler] running. ${shops.length} shop(s) scheduled. Ctrl+C to stop.`);
console.log('[scheduler] to trigger manually: node scheduler.js --run-now\n');

if (process.argv.includes('--run-now')) {
  console.log('[scheduler] --run-now: triggering all shops immediately\n');
  for (const shop of shops) runShop(shop);
}
