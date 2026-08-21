begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(19);

-- ---------------------------------------------------------------------------
-- Monthly finance facts
-- ---------------------------------------------------------------------------

create temporary table fin_batch as
select (public.ops_register_raw_batch(
  'FINANCE_MONTHLY', 'test-finance-monthly', 'finance-monthly-v1', 'pg-tap', 'HC001',
  '2026-02-28 16:00:00+00', '2026-03-31 16:00:00+00', 0, '{}'::jsonb
)).batch_id;

select public.ops_complete_raw_batch(
  (select batch_id from fin_batch), 0, 0, array['finance_monthly'], 'finance-v1'
);

create temporary table fin_claim as
select * from public.ops_claim_processing_run('fin-worker-a', 300);

select extensions.is(
  (select pipeline_key from public.ops_processing_run
   where processing_run_id = (select processing_run_id from fin_claim)),
  'finance_monthly', 'finance batch schedules the finance_monthly pipeline');

select extensions.throws_ok($$
  select public.ops_load_finance_monthly(
    (select processing_run_id from fin_claim), 'wrong-worker', '[]'::jsonb, '[]'::jsonb)
$$, '55000', 'processing run is not actively leased by this worker',
  'a worker without the lease cannot load finance facts');

-- The two 2026-03 物料费 rows share every dimension and differ only by legacy row id.
-- This is the real production shape; both must survive.
select public.ops_load_finance_monthly(
  (select processing_run_id from fin_claim),
  'fin-worker-a',
  $json$[
    {"domain":"EXPENSE","source_row_key":"232","period_month":"2026-03","store_id":"HC001",
     "store_name_source":"吉隆坡Pavilion门店","major":"物料费","sub":"日常物料",
     "source":"银行账户采买","amount":"1507.50","raw_record":{"table":"finance_expense"}},
    {"domain":"EXPENSE","source_row_key":"233","period_month":"2026-03","store_id":"HC001",
     "store_name_source":"吉隆坡Pavilion门店","major":"物料费","sub":"日常物料",
     "source":"银行账户采买","amount":"472.22","raw_record":{"table":"finance_expense"}},
    {"domain":"PL_METRIC","source_row_key":"2026-03|营业额","period_month":"2026-03",
     "store_id":"HC001","item":"营业额","amount":"53189.00",
     "raw_record":{"table":"finance_pl_metrics"}},
    {"domain":"TARGET","source_row_key":"2026-01|全部|总流水","period_month":"2026-01",
     "store_id":"ALL","store_scope":"GROUP","store_name_source":"全部","item":"总流水",
     "amount":"1766000.00","raw_record":{"table":"finance_targets"}},
    {"domain":"TARGET","source_row_key":"2026-01|吉隆坡Pavilion门店|总流水","period_month":"2026-01",
     "store_id":"HC001","store_scope":"STORE","store_name_source":"吉隆坡Pavilion门店",
     "item":"总流水","amount":"1766000.00","raw_record":{"table":"finance_targets"}}
  ]$json$::jsonb,
  $json$[
    {"business_date":"2026-03-31","store_id":"HC001","revenue":"1800.00",
     "gross_sales":"2000.00","total_discount":"200.00","discount_rate":"0.1000",
     "raw_record":{"table":"finance_revenue_daily"}}
  ]$json$::jsonb
);

select extensions.is(
  (select status from public.ops_processing_run
   where processing_run_id = (select processing_run_id from fin_claim)),
  'SUCCEEDED', 'finance load atomically completes its processing run');

select extensions.is((select count(*)::integer from public.fin_month_fact), 5,
  'all five monthly facts are stored');

select extensions.is(
  (select count(*)::integer from public.v_fin_month_fact_current
   where domain = 'EXPENSE' and major = '物料费' and sub = '日常物料'),
  2, 'two genuinely distinct expense entries sharing a dimension tuple are both kept');

select extensions.is(
  (select sum(amount) from public.v_fin_month_fact_current
   where domain = 'EXPENSE' and major = '物料费'),
  1979.72::numeric, 'the duplicated dimension tuple still sums to the production total');

select extensions.is((select count(*)::integer from public.v_fin_revenue_day_current), 1,
  'finance-side daily revenue is exposed through its current view');

-- finance_targets carries an identical 全部 group row and per-store row; the scope keeps them
-- apart so summing the domain does not double every target.
select extensions.is(
  (select store_scope from public.v_fin_month_fact_current where domain = 'TARGET' and store_id = 'ALL'),
  'GROUP', 'the aggregate target row is stored as a GROUP scope, not as a second store');
select extensions.is(
  (select sum(amount) from public.v_fin_month_fact_current
   where domain = 'TARGET' and store_scope = 'STORE'),
  1766000.00::numeric, 'summing store-scoped targets does not double count the group row');

select extensions.throws_ok($$
  insert into public.fin_month_fact (
    source_batch_id, domain, source_row_key, period_month, store_id, amount, raw_record)
  values ((select batch_id from fin_batch), 'NOT_A_DOMAIN', 'x', '2026-03', 'HC001', 1, '{}'::jsonb)
$$, '23514', null, 'an unknown finance domain is rejected by the check constraint');

select extensions.throws_ok($$
  insert into public.fin_month_fact (
    source_batch_id, domain, source_row_key, period_month, store_id, amount, raw_record)
  values ((select batch_id from fin_batch), 'EXPENSE', 'y', '2026-3', 'HC001', 1, '{}'::jsonb)
$$, '23514', null, 'a malformed period_month is rejected instead of silently stored');

select extensions.throws_ok($$
  insert into public.fin_month_fact (
    source_batch_id, domain, source_row_key, period_month, store_id, store_scope, amount, raw_record)
  values ((select batch_id from fin_batch), 'TARGET', 'z', '2026-03', 'HC001', 'REGION', 1, '{}'::jsonb)
$$, '23514', null, 'an unknown store scope is rejected');

-- ---------------------------------------------------------------------------
-- Cost cards
-- ---------------------------------------------------------------------------

create temporary table cc_batch as
select (public.ops_register_raw_batch(
  'FINANCE_COST_CARD', 'test-finance-cost-card', 'finance-cost-card-v1', 'pg-tap', 'HC001',
  '2026-08-19 16:00:00+00', '2026-08-20 16:00:00+00', 0, '{}'::jsonb
)).batch_id;

select public.ops_complete_raw_batch(
  (select batch_id from cc_batch), 0, 0, array['finance_cost_card'], 'finance-cc-v1'
);

create temporary table cc_claim as
select * from public.ops_claim_processing_run('fin-worker-b', 300);

select public.ops_load_finance_cost_cards(
  (select processing_run_id from cc_claim),
  'fin-worker-b',
  $json$[{"legacy_item_id":"456","name":"茉莉卡仕达","item_type":"ingredient",
          "base_unit":"g","status":"active","raw_record":{"table":"cost_card_item"}}]$json$::jsonb,
  $json$[{"legacy_price_id":"9001","legacy_item_id":"456","supplier":"A",
          "unit_price":"12.5000","currency":"MYR","price_unit":"kg",
          "effective_from":"2026-01-01","raw_record":{"table":"cost_card_item_price"}}]$json$::jsonb,
  $json$[{"legacy_recipe_id":"7001","legacy_item_id":"456","version":"1","status":"published",
          "batch_yield":"1000.0000","batch_unit":"g","sale_price":"18.00",
          "raw_record":{"table":"cost_card_recipe"}}]$json$::jsonb,
  $json$[{"legacy_recipe_item_id":"8001","legacy_recipe_id":"7001","component_item_id":"456",
          "quantity":"250.000000","unit":"g","loss_rate":"0.050000","seq":"1",
          "raw_record":{"table":"cost_card_recipe_item"}}]$json$::jsonb
);

select extensions.is((select count(*)::integer from public.v_fin_cost_item_current), 1,
  'cost-card material is exposed through its current view');
select extensions.is((select count(*)::integer from public.v_fin_cost_recipe_item_current), 1,
  'cost-card recipe line is exposed through its current view');
select extensions.is(
  (public.ops_get_finance_summary()->'orphans'->>'line_without_recipe')::integer, 0,
  'a consistent cost-card import reports no orphan recipe lines');
select extensions.is(
  (public.ops_get_finance_summary()->'cost_cards'->>'prices')::integer, 1,
  'finance summary counts current cost-card prices');

-- A second, still-leased monthly run: the first one is already SUCCEEDED, so reusing it would
-- trip the lease guard and never reach the pipeline check this assertion is about.
create temporary table fin_batch_2 as
select (public.ops_register_raw_batch(
  'FINANCE_MONTHLY', 'test-finance-monthly-2', 'finance-monthly-v1', 'pg-tap', 'HC001',
  '2026-03-31 16:00:00+00', '2026-04-30 16:00:00+00', 0, '{}'::jsonb
)).batch_id;

select public.ops_complete_raw_batch(
  (select batch_id from fin_batch_2), 0, 0, array['finance_monthly'], 'finance-v1'
);

create temporary table fin_claim_2 as
select * from public.ops_claim_processing_run('fin-worker-c', 300);

select extensions.throws_ok($$
  select public.ops_load_finance_cost_cards(
    (select processing_run_id from fin_claim_2), 'fin-worker-c',
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
$$, '22023', 'processing run pipeline is not finance_cost_card',
  'the cost-card loader refuses an actively leased monthly-finance run');

-- ---------------------------------------------------------------------------
-- Security boundary
-- ---------------------------------------------------------------------------

select extensions.is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename in (
    'fin_month_fact', 'fin_revenue_day', 'fin_cost_item', 'fin_cost_item_price',
    'fin_cost_recipe', 'fin_cost_recipe_item')),
  0, 'finance tables are closed by default and reachable only through narrow RPCs');

select extensions.ok(
  not has_function_privilege('hc_pos_writer', 'public.ops_load_finance_monthly(bigint, text, jsonb, jsonb)', 'execute'),
  'the POS writer capability cannot load finance facts');

select * from extensions.finish();
rollback;
