begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(12);

create temporary table finance_batch as
select (public.ops_register_raw_batch(
  'FINANCE_EXCEL', 'test-operability-finance', 'finance-v1', 'pg-tap', 'HC001',
  null, null, 0, '{}'::jsonb
)).batch_id;
select public.ops_complete_raw_batch(
  (select batch_id from finance_batch), 0, 0, array['finance_import'], 'finance-v1'
);

create temporary table first_batch as
select (public.ops_register_raw_batch(
  'RES_POS_DAILY', 'test-operability-pos-1', 'res-pos-daily-v1', 'pg-tap', 'HC001',
  '2026-08-19 16:00:00+00', '2026-08-20 16:00:00+00', 1, '{}'::jsonb
)).batch_id;

insert into storage.objects (bucket_id, name, metadata)
values (
  'raw-business-private', 'test/operability/daily.json',
  '{"size":1,"mimetype":"application/json"}'::jsonb
);
select public.ops_register_raw_object(
  (select batch_id from first_batch), 'raw-business-private', 'test/operability/daily.json',
  repeat('a', 64)::character(64), 1, 'application/json', 'C1', 'daily.json', 'test-v1'
);
select public.ops_complete_raw_batch(
  (select batch_id from first_batch), 1, 0, array['pos_daily_sales'], 'pos-v1'
);

create temporary table first_claim as
select * from public.ops_claim_processing_run_for_pipeline(
  'pos-operability-worker', array['pos_daily_sales'], 300
);

select extensions.is(
  (select pipeline_key from first_claim), 'pos_daily_sales',
  'pipeline-filtered claim does not steal an unrelated finance job'
);
select extensions.is(
  (public.ops_get_processing_input(
    (select processing_run_id from first_claim), 'pos-operability-worker'
  )->'objects'->0->>'size_bytes')::integer,
  1, 'processing manifest exposes the registered object size for integrity checks'
);
select extensions.is(
  public.ops_get_processing_input(
    (select processing_run_id from first_claim), 'pos-operability-worker'
  )->>'source_batch_key',
  'test-operability-pos-1', 'processing input exposes the immutable source batch key'
);

select public.ops_load_pos_daily_sales(
  (select processing_run_id from first_claim), 'pos-operability-worker',
  '[{"business_date":"2026-08-20","store_id":"HC001","store_name_source":"HOT CRUSH BAKERY","bill_count":"1","guest_count":"1","gross_sales":"100.00","discount_amount":"0.00","net_sales":"100.00","total_payment_received":"100.00","raw_record":{"source":"first"}}]'::jsonb,
  '[{"business_date":"2026-08-20","store_id":"HC001","sales_hour":"12","bill_count":"1","guest_count":"1","gross_sales":"100.00","discount_amount":"0.00","net_sales":"100.00","raw_record":{"source":"first"}}]'::jsonb
);

create temporary table second_batch as
select (public.ops_register_raw_batch(
  'RES_POS_DAILY', 'test-operability-pos-2', 'res-pos-daily-v1', 'pg-tap', 'HC001',
  '2026-08-19 16:00:00+00', '2026-08-20 16:00:00+00', 0, '{}'::jsonb
)).batch_id;
select public.ops_complete_raw_batch(
  (select batch_id from second_batch), 0, 0, array['pos_daily_sales'], 'pos-v1'
);
create temporary table second_claim as
select * from public.ops_claim_processing_run_for_pipeline(
  'pos-operability-worker', array['pos_daily_sales'], 300
);
select public.ops_load_pos_daily_sales(
  (select processing_run_id from second_claim), 'pos-operability-worker',
  '[{"business_date":"2026-08-20","store_id":"HC001","store_name_source":"HOT CRUSH BAKERY","bill_count":"2","guest_count":"2","gross_sales":"200.00","discount_amount":"0.00","net_sales":"200.00","total_payment_received":"200.00","raw_record":{"source":"second"}}]'::jsonb,
  '[]'::jsonb
);

select extensions.is(
  (select net_sales from public.v_pos_sales_day_current where business_date = '2026-08-20'),
  200.00::numeric, 'current view selects the latest accepted source batch'
);

select public.ops_quarantine_raw_batch(
  (select batch_id from second_batch), 'rollback rehearsal', 'pg-tap'
);
select extensions.is(
  (select net_sales from public.v_pos_sales_day_current where business_date = '2026-08-20'),
  100.00::numeric, 'quarantine rolls the current view back to the previous batch'
);
select extensions.is(
  (select count(*)::integer from public.pos_sales_day where business_date = '2026-08-20'),
  2, 'rollback preserves both immutable processed versions for audit'
);
select extensions.is(
  (select status from public.ops_raw_batch where batch_id = (select batch_id from second_batch)),
  'QUARANTINED', 'quarantined batch is explicit in the Raw control plane'
);

select public.ops_restore_raw_batch(
  (select batch_id from second_batch), 'rollback rehearsal passed', 'pg-tap'
);
select extensions.is(
  (select net_sales from public.v_pos_sales_day_current where business_date = '2026-08-20'),
  200.00::numeric, 'restore makes the verified batch current again without reloading facts'
);

update public.ai_source_connector
set last_successful_scan_at = now(), last_error = null;
select public.ops_rollup_pipeline_health();
select extensions.is(
  public.ops_get_platform_health()->>'status', 'healthy',
  'platform health reports healthy when there are no failed or stale runs'
);
select extensions.is(
  (public.ops_get_platform_health()->'processing'->>'pending')::integer, 1,
  'platform health still reports the intentionally unclaimed finance job'
);
select extensions.is(
  (public.ops_get_platform_health()->'storage'->>'registered_missing_object')::integer, 0,
  'platform health reconciles Raw registration with Storage objects'
);
select extensions.is(
  (public.ops_get_platform_health()->'cron'->>'active_jobs')::integer, 6,
  'platform health confirms all six database Cron jobs are active'
);

select * from extensions.finish();
rollback;
