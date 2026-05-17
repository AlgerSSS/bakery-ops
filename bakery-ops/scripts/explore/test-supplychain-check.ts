import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  'https://zpplbzrtdenvpfhaysij.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwcGxienJ0ZGVudnBmaGF5c2lqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzYyMzc3MCwiZXhwIjoyMDkzMTk5NzcwfQ.N8ICTK04sUbVlIfRr3Av5d_3_SDEhVG_f6-wzJ-irLY'
);

const log: string[] = [];

async function run() {
  log.push('=== 1. 数据库表检查 ===');
  const r1 = await supabase.from('supply_orders').select('id').limit(1);
  log.push(`supply_orders: ${r1.error ? 'NOT FOUND - ' + r1.error.message : 'EXISTS'}`);

  const r2 = await supabase.from('arrival_records').select('id').limit(1);
  log.push(`arrival_records: ${r2.error ? 'NOT FOUND - ' + r2.error.message : 'EXISTS'}`);

  const r3 = await supabase.from('suppliers').select('id').limit(1);
  log.push(`suppliers: ${r3.error ? 'NOT FOUND - ' + r3.error.message : 'EXISTS'}`);

  log.push('');
  log.push('=== 2. KDocs API 测试 ===');
  try {
    const res = await fetch('https://www.kdocs.cn/api/v3/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: 'SX20260505QAMOIL',
        app_secret: 'qYTHBLaPWMhBzQuHoDIrLXPoplumMVqV',
        grant_type: 'client_credentials',
      }),
    });
    const text = await res.text();
    log.push(`KDocs auth status: ${res.status}`);
    log.push(`KDocs response: ${text.slice(0, 500)}`);

    if (res.ok) {
      const data = JSON.parse(text);
      if (data.access_token) {
        log.push(`Token obtained: ${data.access_token.slice(0, 20)}...`);
        // Try reading the sheet
        const fileToken = 'cvUrx5gtcWUf';
        const sheetRes = await fetch(
          `https://www.kdocs.cn/api/v3/files/${fileToken}/sheets/Sheet1/values`,
          { headers: { Authorization: `Bearer ${data.access_token}` } }
        );
        const sheetText = await sheetRes.text();
        log.push(`KDocs sheet read status: ${sheetRes.status}`);
        log.push(`KDocs sheet response: ${sheetText.slice(0, 500)}`);
      }
    }
  } catch (err) {
    log.push(`KDocs network error: ${String(err)}`);
  }

  fs.writeFileSync('/tmp/supplychain-test-result.txt', log.join('\n'));
}

run().catch(e => {
  log.push(`Fatal: ${String(e)}`);
  fs.writeFileSync('/tmp/supplychain-test-result.txt', log.join('\n'));
});
