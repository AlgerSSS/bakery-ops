begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(10);

create temporary table raw_context as
select (public.ops_register_raw_batch(
  'RES_POS_DAILY', 'test-pos-2026-08-20', 'v1', 'pg-tap', 'HC001',
  '2026-08-19 00:00:00+00', '2026-08-20 00:00:00+00', 10, '{}'::jsonb
)).batch_id;

select extensions.is((select batch_id from public.ops_register_raw_batch(
  'RES_POS_DAILY', 'test-pos-2026-08-20', 'v1', 'pg-tap', 'HC001',
  '2026-08-19 00:00:00+00', '2026-08-20 00:00:00+00', 10, '{}'::jsonb
)), (select batch_id from raw_context), 'raw batch registration is idempotent');

select extensions.throws_ok($$
  select public.ops_register_raw_batch(
    'RES_POS_DAILY', 'test-pos-2026-08-20', 'v1', 'different-writer', 'HC001',
    '2026-08-19 00:00:00+00', '2026-08-20 00:00:00+00', 10, '{}'::jsonb
  )
$$, '23505', 'idempotency key already exists with different immutable batch attributes',
  'conflicting batch idempotency keys are rejected');

create temporary table raw_object_context as
select (public.ops_register_raw_object(
  (select batch_id from raw_context), 'raw-business-private', 'test/pos-daily.json',
  repeat('a', 64)::character(64), 100, 'application/json', 'C1', '2026-08-20', '1'
)).raw_object_id;

select extensions.is((select status from public.ops_complete_raw_batch(
  (select batch_id from raw_context), 9, 1, array['pos_daily_sales'], 'processor-v1'
)), 'READY', 'completing a valid batch makes it ready');

select extensions.is((select raw_object_id from public.ops_register_raw_object(
  (select batch_id from raw_context), 'raw-business-private', 'test/pos-daily.json',
  repeat('a', 64)::character(64), 100, 'application/json', 'C1', '2026-08-20', '1'
)), (select raw_object_id from raw_object_context),
  'a completed batch can replay its identical raw object after a client timeout');

select extensions.is((select count(*)::integer from public.ops_processing_run), 1, 'batch completion creates one processing run');

create temporary table processing_claim as
select * from public.ops_claim_processing_run('worker-a', 300);
select extensions.ok((select processing_run_id is not null and status = 'RUNNING' from processing_claim),
  'worker atomically claims the pending processing run');
select extensions.is((public.ops_claim_processing_run('worker-b', 300)).processing_run_id, null::bigint,
  'a second worker cannot claim the already leased run');

select extensions.is((select status from public.ops_finish_processing_run(
  (select processing_run_id from processing_claim), 'worker-a', 'SUCCEEDED', 10, 9, 1,
  '{"business_date":"2026-08-19"}'::jsonb
)), 'SUCCEEDED', 'the lease owner can finish the processing run');

select extensions.is(public.ops_rollup_pipeline_health(), 1, 'health rollup summarizes the pipeline');
select extensions.is((select status from public.pipeline_health where source_key = 'pos_daily_sales'), 'success',
  'pipeline health reports success after the completed run');

select * from extensions.finish();
rollback;
