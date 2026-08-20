-- Bounded POS reconciliation read contract for migration verification and Agents.

create or replace function public.ops_get_pos_day_for_reconcile(
  p_business_date date,
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
  if p_business_date is null or btrim(p_store_id) = '' then
    raise exception 'business date and store id are required' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'daily', (
      select jsonb_build_object(
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
      )
      from public.v_pos_sales_day_current as day
      where day.business_date = p_business_date and day.store_id = p_store_id
    ),
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
      ) order by hour.sales_hour)
      from public.v_pos_sales_hour_current as hour
      where hour.business_date = p_business_date and hour.store_id = p_store_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.ops_get_pos_day_for_reconcile(date, text) is
  'Returns one current POS day and its hours for controlled migration reconciliation; excludes Raw payloads and version history.';

revoke all on function public.ops_get_pos_day_for_reconcile(date, text)
  from public, anon, authenticated;
grant execute on function public.ops_get_pos_day_for_reconcile(date, text)
  to service_role, hc_ops_processor, hc_agent_worker;
