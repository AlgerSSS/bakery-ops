-- Bounded range reconciliation for resumable legacy POS backfills and quarantined evidence.

create index ops_raw_batch_legacy_business_date_idx
  on public.ops_raw_batch (store_id, ((metadata ->> 'business_date')), source_system)
  where source_system in ('LEGACY_POS_EXPORT', 'LEGACY_POS_ANOMALY');

create or replace function public.ops_get_pos_migration_window(
  p_from_date date,
  p_to_date date,
  p_store_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_result jsonb;
begin
  if p_from_date is null
     or p_to_date is null
     or p_store_id is null
     or btrim(p_store_id) = ''
     or p_to_date - p_from_date not between 0 and 30 then
    raise exception 'migration reconciliation window must contain 1 to 31 days'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'from_date', p_from_date,
    'to_date', p_to_date,
    'store_id', p_store_id,
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_batch_id', day.source_batch_id,
        'business_date', day.business_date,
        'store_id', day.store_id,
        'store_name_source', day.store_name_source,
        'bill_count', day.bill_count,
        'guest_count', day.guest_count,
        'gross_sales', day.gross_sales,
        'discount_amount', day.discount_amount,
        'net_sales', day.net_sales,
        'total_payment_received', day.total_payment_received,
        'loaded_at', day.loaded_at
      ) order by day.business_date)
      from public.v_pos_sales_day_current as day
      where day.store_id = p_store_id
        and day.business_date between p_from_date and p_to_date
    ), '[]'::jsonb),
    'hourly', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_batch_id', hour.source_batch_id,
        'business_date', hour.business_date,
        'store_id', hour.store_id,
        'sales_hour', hour.sales_hour,
        'bill_count', hour.bill_count,
        'guest_count', hour.guest_count,
        'gross_sales', hour.gross_sales,
        'discount_amount', hour.discount_amount,
        'net_sales', hour.net_sales,
        'loaded_at', hour.loaded_at
      ) order by hour.business_date, hour.sales_hour)
      from public.v_pos_sales_hour_current as hour
      where hour.store_id = p_store_id
        and hour.business_date between p_from_date and p_to_date
    ), '[]'::jsonb),
    'legacy_batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batch_id', batch.batch_id,
        'business_date', batch.metadata ->> 'business_date',
        'source_system', batch.source_system,
        'source_batch_key', batch.source_batch_key,
        'schema_version', batch.schema_version,
        'status', batch.status,
        'reason_code', batch.metadata ->> 'reason_code',
        'error_summary', batch.error_summary,
        'artifact_sha256', batch.metadata ->> 'artifact_sha256',
        'accepted_count', batch.accepted_count,
        'rejected_count', batch.rejected_count,
        'registered_objects', (
          select count(*) from public.ops_raw_object as object
          where object.batch_id = batch.batch_id
        ),
        'processing_run_id', latest_run.processing_run_id,
        'processing_status', latest_run.status,
        'pipeline_version', latest_run.pipeline_version
      ) order by batch.metadata ->> 'business_date', batch.source_system, batch.batch_id)
      from public.ops_raw_batch as batch
      left join lateral (
        select run.processing_run_id, run.status, run.pipeline_version
        from public.ops_processing_run as run
        where run.batch_id = batch.batch_id
          and run.pipeline_key = 'pos_daily_sales'
        order by run.processing_run_id desc
        limit 1
      ) as latest_run on true
      where batch.source_system in ('LEGACY_POS_EXPORT', 'LEGACY_POS_ANOMALY')
        and batch.store_id = p_store_id
        and batch.metadata ->> 'business_date'
          between p_from_date::text and p_to_date::text
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.ops_get_pos_migration_window(date, date, text) is
  'Returns at most 31 days of current POS facts plus accepted/quarantined legacy batch evidence for automated migration reconciliation; never exposes Raw payloads.';

revoke all on function public.ops_get_pos_migration_window(date, date, text)
  from public, anon, authenticated;
grant execute on function public.ops_get_pos_migration_window(date, date, text)
  to service_role, hc_ops_processor;
