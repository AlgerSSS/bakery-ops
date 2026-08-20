-- Select current POS facts by deterministic successful processing order, never random UUID order.

create or replace view public.v_pos_sales_day_current
with (security_invoker = true)
as
select distinct on (fact.store_id, fact.business_date)
  fact.source_batch_id,
  fact.business_date,
  fact.store_id,
  fact.store_name_source,
  fact.bill_count,
  fact.guest_count,
  fact.gross_sales,
  fact.discount_amount,
  fact.net_sales,
  fact.total_payment_received,
  fact.loaded_at
from public.pos_sales_day as fact
join public.ops_raw_batch as batch on batch.batch_id = fact.source_batch_id
join lateral (
  select run.processing_run_id
  from public.ops_processing_run as run
  where run.batch_id = fact.source_batch_id
    and run.pipeline_key = 'pos_daily_sales'
    and run.status = 'SUCCEEDED'
  order by run.processing_run_id desc
  limit 1
) as accepted_run on true
where batch.status = 'READY'
order by fact.store_id, fact.business_date,
  accepted_run.processing_run_id desc, fact.source_batch_id desc;

comment on view public.v_pos_sales_day_current is
  'Current accepted RES or legacy POS daily version selected by the latest successful processing run; quarantine falls back without deleting history.';

create or replace view public.v_pos_sales_hour_current
with (security_invoker = true)
as
select distinct on (fact.store_id, fact.business_date, fact.sales_hour)
  fact.source_batch_id,
  fact.business_date,
  fact.store_id,
  fact.sales_hour,
  fact.bill_count,
  fact.guest_count,
  fact.gross_sales,
  fact.discount_amount,
  fact.net_sales,
  fact.loaded_at
from public.pos_sales_hour as fact
join public.ops_raw_batch as batch on batch.batch_id = fact.source_batch_id
join lateral (
  select run.processing_run_id
  from public.ops_processing_run as run
  where run.batch_id = fact.source_batch_id
    and run.pipeline_key = 'pos_daily_sales'
    and run.status = 'SUCCEEDED'
  order by run.processing_run_id desc
  limit 1
) as accepted_run on true
where batch.status = 'READY'
order by fact.store_id, fact.business_date, fact.sales_hour,
  accepted_run.processing_run_id desc, fact.source_batch_id desc;

comment on view public.v_pos_sales_hour_current is
  'Current accepted RES or legacy POS hourly version selected by the latest successful processing run; quarantine falls back without deleting history.';
