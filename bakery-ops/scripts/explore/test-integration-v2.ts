import * as fs from 'fs';

const SUPABASE_URL = 'https://zpplbzrtdenvpfhaysij.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwcGxienJ0ZGVudnBmaGF5c2lqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzYyMzc3MCwiZXhwIjoyMDkzMTk5NzcwfQ.N8ICTK04sUbVlIfRr3Av5d_3_SDEhVG_f6-wzJ-irLY';

const log: string[] = [];

async function run() {
  log.push('=== Supabase REST API 直接测试 ===');

  // 直接用 REST API 测试表是否存在
  const tables = ['supply_orders', 'arrival_records', 'suppliers'];
  for (const table of tables) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
      });
      const text = await res.text();
      if (res.ok) {
        log.push(`${table}: EXISTS (${res.status})`);
      } else {
        log.push(`${table}: ${res.status} - ${text.slice(0, 100)}`);
      }
    } catch (err) {
      log.push(`${table}: ERROR - ${String(err)}`);
    }
  }

  log.push('');
  log.push('=== KDocs API (正确endpoint) ===');
  // 测试 KDocs 正确的 API base
  try {
    const res = await fetch(`https://developer.kdocs.cn/api/v1/oauth2/access_token?app_id=SX20260505QAMOIL&app_key=qYTHBLaPWMhBzQuHoDIrLXPoplumMVqV&code=test`, {
      method: 'GET',
    });
    const text = await res.text();
    log.push(`KDocs OAuth test: ${res.status}`);
    log.push(`Response: ${text.slice(0, 300)}`);
  } catch (err) {
    log.push(`KDocs error: ${String(err)}`);
  }

  fs.writeFileSync('/tmp/sc-result.txt', log.join('\n'));
}

run().catch(e => {
  log.push(`Fatal: ${String(e)}`);
  fs.writeFileSync('/tmp/sc-result.txt', log.join('\n'));
});
