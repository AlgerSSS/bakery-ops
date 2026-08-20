begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(4);

create temporary table legacy_batch as
select (public.ops_register_raw_batch(
  'LEGACY_POS_EXPORT', 'test-legacy-pos-2026-07-26', 'legacy-pos-export-v1',
  'pg-tap', 'HC001', null, null, 0, '{}'::jsonb
)).batch_id;

select lives_ok(
  format(
    'select public.ops_complete_raw_batch(%L, 0, 0, array[''pos_daily_sales''], ''pos-backfill-v1'')',
    (select batch_id from legacy_batch)
  ),
  'legacy POS exports are explicitly allowlisted into the POS processing pipeline'
);

create temporary table legacy_claim as
select * from public.ops_claim_processing_run_for_pipeline(
  'legacy-pos-worker', array['pos_daily_sales'], 300
);

select lives_ok(
  format(
    $sql$select public.ops_load_pos_daily_sales(
      %s, 'legacy-pos-worker',
      '[{"business_date":"2026-07-26","store_id":"HC001","store_name_source":"Pavilion","bill_count":"1","guest_count":"1","gross_sales":"100.00","discount_amount":"0.00","net_sales":"100.00","total_payment_received":"","raw_record":{"source":"legacy"}}]'::jsonb,
      '[{"business_date":"2026-07-26","store_id":"HC001","sales_hour":"12","bill_count":"1","guest_count":"1","gross_sales":"100.00","discount_amount":"0.00","net_sales":"100.00","raw_record":{"source":"legacy"}}]'::jsonb
    )$sql$,
    (select processing_run_id from legacy_claim)
  ),
  'the controlled POS loader accepts a leased legacy export batch'
);

select extensions.is(
  (select net_sales from public.v_pos_sales_day_current where business_date = '2026-07-26'),
  100.00::numeric, 'legacy export publishes through the same versioned current view'
);
select extensions.is(
  (public.ops_get_pos_day_for_reconcile('2026-07-26', 'HC001')->'daily'->>'net_sales')::numeric,
  100.00::numeric, 'reconciliation RPC exposes the bounded current POS result without Raw payloads'
);

select * from extensions.finish();
rollback;
