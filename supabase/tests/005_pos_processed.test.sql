begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(9);

create temporary table pos_batch as
select (public.ops_register_raw_batch(
  'RES_POS_DAILY', 'test-pos-processed', 'res-pos-daily-v1', 'pg-tap', 'HC001',
  '2026-08-19 16:00:00+00', '2026-08-20 16:00:00+00', 0, '{}'::jsonb
)).batch_id;

select public.ops_complete_raw_batch(
  (select batch_id from pos_batch), 0, 0, array['pos_daily_sales'], 'pos-v1'
);

create temporary table pos_claim as
select * from public.ops_claim_processing_run('pos-worker-a', 300);

select extensions.is(
  (public.ops_get_processing_input((select processing_run_id from pos_claim), 'pos-worker-a')->>'pipeline_key'),
  'pos_daily_sales', 'leased worker can resolve its Raw manifest');

select extensions.throws_ok($$
  select public.ops_get_processing_input((select processing_run_id from pos_claim), 'wrong-worker')
$$, '55000', 'processing run is not actively leased by this worker',
  'a different worker cannot resolve another lease input');

select public.ops_load_pos_daily_sales(
  (select processing_run_id from pos_claim),
  'pos-worker-a',
  '[{"business_date":"2026-08-20","store_id":"HC001","store_name_source":"HOT CRUSH BAKERY","bill_count":"100","guest_count":"101","gross_sales":"5000.00","discount_amount":"200.00","net_sales":"4800.00","total_payment_received":"4900.00","raw_record":{"source":"csv"}}]'::jsonb,
  '[{"business_date":"2026-08-20","store_id":"HC001","sales_hour":"12","bill_count":"20","guest_count":"21","gross_sales":"1000.00","discount_amount":"50.00","net_sales":"950.00","raw_record":{"source":"json"}}]'::jsonb
);

select extensions.is((select status from public.ops_processing_run where processing_run_id = (select processing_run_id from pos_claim)),
  'SUCCEEDED', 'POS load atomically completes the processing run');
select extensions.is((select count(*)::integer from public.pos_sales_day), 1, 'one versioned daily fact is stored');
select extensions.is((select count(*)::integer from public.pos_sales_hour), 1, 'one versioned hourly fact is stored');
select extensions.is((select net_sales from public.v_pos_sales_day_current), 4800.00::numeric,
  'current daily view exposes the accepted latest version');
select extensions.is((select net_sales from public.v_pos_sales_hour_current), 950.00::numeric,
  'current hourly view exposes the accepted latest version');
select extensions.is((public.ops_get_pos_processed_summary()->>'current_days')::integer, 1,
  'processed summary reports one current business day');
select extensions.is((select count(*)::integer from pg_policies where schemaname = 'public' and tablename in ('pos_sales_day', 'pos_sales_hour')), 0,
  'processed POS tables are closed by default and exposed only through narrow RPCs');

select * from extensions.finish();
rollback;
