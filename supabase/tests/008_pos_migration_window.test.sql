begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(11);

create temporary table accepted_batch as
select (public.ops_register_raw_batch(
  'LEGACY_POS_EXPORT', 'test-window-accepted', 'legacy-pos-export-v1',
  'pg-tap', 'HC001', '2025-12-31 16:00:00+00', '2026-01-01 16:00:00+00', 0,
  '{"business_date":"2026-01-01"}'::jsonb
)).batch_id;
select public.ops_complete_raw_batch(
  (select batch_id from accepted_batch), 0, 0, array['pos_daily_sales'], 'pos-backfill-v1'
);
create temporary table accepted_claim as
select * from public.ops_claim_processing_run_for_pipeline(
  'window-worker', array['pos_daily_sales'], 300
);
select public.ops_load_pos_daily_sales(
  (select processing_run_id from accepted_claim), 'window-worker',
  '[{"business_date":"2026-01-01","store_id":"HC001","store_name_source":"Pavilion","bill_count":"1","guest_count":"1","gross_sales":"100.00","discount_amount":"0.00","net_sales":"100.00","total_payment_received":"","raw_record":{"must_not_leak":true}}]'::jsonb,
  '[{"business_date":"2026-01-01","store_id":"HC001","sales_hour":"12","bill_count":"1","guest_count":"1","gross_sales":"100.00","discount_amount":"0.00","net_sales":"100.00","raw_record":{"must_not_leak":true}}]'::jsonb
);

create temporary table anomaly_batch as
select (public.ops_register_raw_batch(
  'LEGACY_POS_ANOMALY', 'test-window-anomaly', 'legacy-pos-anomaly-v1',
  'pg-tap', 'HC001', '2026-01-01 16:00:00+00', '2026-01-02 16:00:00+00', 0,
  '{"business_date":"2026-01-02","reason_code":"NO_HOURLY_SOURCE","health_impact":"acknowledged_source_quality"}'::jsonb
)).batch_id;
select public.ops_complete_raw_batch(
  (select batch_id from anomaly_batch), 0, 0, array[]::text[], 'pos-anomaly-v1',
  'NO_HOURLY_SOURCE: no hourly rows'
);

select extensions.throws_ok($$
  select public.ops_get_pos_migration_window('2026-01-01', '2026-02-01', 'HC001')
$$, '22023', 'migration reconciliation window must contain 1 to 31 days',
  'range reconciliation refuses an unbounded request');

select extensions.is(
  jsonb_array_length(public.ops_get_pos_migration_window('2026-01-01', '2026-01-02', 'HC001')->'daily'),
  1, 'window exposes one accepted current day'
);
select extensions.is(
  jsonb_array_length(public.ops_get_pos_migration_window('2026-01-01', '2026-01-02', 'HC001')->'hourly'),
  1, 'window exposes its accepted hourly fact'
);
select extensions.is(
  jsonb_array_length(public.ops_get_pos_migration_window('2026-01-01', '2026-01-02', 'HC001')->'legacy_batches'),
  2, 'window accounts for accepted and quarantined source batches'
);
select extensions.is(
  public.ops_get_pos_migration_window('2026-01-01', '2026-01-02', 'HC001')
    ->'legacy_batches'->1->>'reason_code',
  'NO_HOURLY_SOURCE', 'quarantined source quality reason is machine-readable'
);
select extensions.is(
  public.ops_get_pos_migration_window('2026-01-01', '2026-01-02', 'HC001')
    ->'legacy_batches'->0->>'processing_status',
  'SUCCEEDED', 'accepted batch proves its structured processing succeeded'
);
select extensions.ok(
  not (public.ops_get_pos_migration_window('2026-01-01', '2026-01-02', 'HC001')
    ->'daily'->0 ? 'raw_record'),
  'bounded reconciliation never exposes the embedded Raw source row'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.ops_get_pos_migration_window(date,date,text)', 'execute'),
  'anonymous callers cannot inspect migration evidence'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.ops_get_pos_migration_window(date,date,text)', 'execute'),
  'service role can run controlled migration reconciliation'
);
select extensions.is(
  (public.ops_get_platform_health()->'raw'->>'acknowledged_source_quality')::integer,
  1, 'platform health reports acknowledged source-quality quarantine separately'
);
select extensions.is(
  (public.ops_get_platform_health()->'raw'->>'quarantined_unacknowledged')::integer,
  0, 'acknowledged source quality does not masquerade as an unresolved platform fault'
);

select * from extensions.finish();
rollback;
