import pkg from '@supabase/supabase-js';
const { createClient } = pkg;

const supabase = createClient(
  'https://zpplbzrtdenvpfhaysij.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwcGxienJ0ZGVudnBmaGF5c2lqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzYyMzc3MCwiZXhwIjoyMDkzMTk5NzcwfQ.N8ICTK04sUbVlIfRr3Av5d_3_SDEhVG_f6-wzJ-irLY'
);

async function run() {
  console.log('=== 数据库表检查 ===');
  const r1 = await supabase.from('supply_orders').select('id').limit(1);
  console.log('supply_orders:', r1.error ? `NOT FOUND: ${r1.error.message}` : 'EXISTS');

  const r2 = await supabase.from('arrival_records').select('id').limit(1);
  console.log('arrival_records:', r2.error ? `NOT FOUND: ${r2.error.message}` : 'EXISTS');

  const r3 = await supabase.from('suppliers').select('id').limit(1);
  console.log('suppliers:', r3.error ? `NOT FOUND: ${r3.error.message}` : 'EXISTS');
}

run().catch(e => console.error('Fatal:', e));
