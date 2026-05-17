import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://zpplbzrtdenvpfhaysij.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwcGxienJ0ZGVudnBmaGF5c2lqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzYyMzc3MCwiZXhwIjoyMDkzMTk5NzcwfQ.N8ICTK04sUbVlIfRr3Av5d_3_SDEhVG_f6-wzJ-irLY'
);

async function run() {
  console.log('=== 1. 检查数据库表 ===');
  const r1 = await supabase.from('supply_orders').select('id').limit(1);
  console.log('supply_orders:', r1.error ? `ERROR: ${r1.error.message}` : 'OK');

  const r2 = await supabase.from('arrival_records').select('id').limit(1);
  console.log('arrival_records:', r2.error ? `ERROR: ${r2.error.message}` : 'OK');

  const r3 = await supabase.from('suppliers').select('id').limit(1);
  console.log('suppliers:', r3.error ? `ERROR: ${r3.error.message}` : 'OK');

  console.log('\n=== 2. 测试 KDocs API ===');
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
    const data = await res.json();
    if (res.ok && data.access_token) {
      console.log('KDocs auth: OK (token obtained)');
      console.log('Token prefix:', data.access_token.slice(0, 20) + '...');

      // 尝试读取文档
      const fileToken = 'cvUrx5gtcWUf';
      const sheetRes = await fetch(
        `https://www.kdocs.cn/api/v3/files/${fileToken}/sheets/Sheet1/values`,
        { headers: { Authorization: `Bearer ${data.access_token}` } }
      );
      if (sheetRes.ok) {
        const sheetData = await sheetRes.json();
        const rows = sheetData.values || [];
        console.log(`KDocs read: OK (${rows.length} rows)`);
        if (rows.length > 0) {
          console.log('Header:', JSON.stringify(rows[0]));
          if (rows.length > 1) console.log('Row 1:', JSON.stringify(rows[1]));
        }
      } else {
        const errText = await sheetRes.text();
        console.log(`KDocs read: ERROR ${sheetRes.status} - ${errText.slice(0, 200)}`);
      }
    } else {
      console.log(`KDocs auth: ERROR ${res.status} -`, JSON.stringify(data).slice(0, 200));
    }
  } catch (err) {
    console.log('KDocs API: NETWORK ERROR -', String(err));
  }

  console.log('\n=== 3. 测试订货解析器 ===');
  // 直接测试解析逻辑
  const UNITS = ["kg", "g", "斤", "包", "箱", "瓶", "桶", "袋", "个", "盒", "升", "L", "ml", "条", "块", "片", "打", "罐", "支", "把"];
  const UNIT_PATTERN = UNITS.map(u => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const ITEM_REGEX = new RegExp(`([^,:：;；\\d]+?)[：:]\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})`, "gi");

  const testCases = [
    "订货: 面粉:50kg, 糖:20kg",
    "订货: 鸡蛋:200个, 牛奶:10升, 黄油:5箱",
    "到货: 面粉:48kg, 糖:20kg",
  ];

  for (const tc of testCases) {
    const cleaned = tc.replace(/^订货[：:]\s*/i, "").replace(/^到货[：:]\s*/i, "").trim();
    const items: any[] = [];
    let match;
    const regex = new RegExp(ITEM_REGEX.source, "gi");
    while ((match = regex.exec(cleaned)) !== null) {
      items.push({ name: match[1].trim(), qty: parseFloat(match[2]), unit: match[3] });
    }
    console.log(`"${tc}" → ${items.length} items:`, JSON.stringify(items));
  }
}

run().catch(e => console.error('Fatal:', e));
