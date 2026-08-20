-- Explicit legacy-source contract for isolated, read-only old-production POS backfills.

create or replace function private.is_allowed_pipeline(
  p_source_system text,
  p_pipeline_key text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_source_system in ('RES_POS_DAILY', 'LEGACY_POS_EXPORT')
      then p_pipeline_key = 'pos_daily_sales'
    when p_source_system = 'RES_POS_MEMBER'
      then p_pipeline_key = 'pos_member_snapshot'
    when p_source_system = 'RES_POS_MEMBER_TXN'
      then p_pipeline_key = 'pos_member_transaction'
    when p_source_system = 'RES_POS'
      then p_pipeline_key in ('pos_daily_sales', 'pos_member_snapshot', 'pos_member_transaction')
    when p_source_system = 'JOBSTREET_APPLICANT'
      then p_pipeline_key = 'hr_application_import'
    when p_source_system = 'FINANCE_EXCEL'
      then p_pipeline_key = 'finance_import'
    else false
  end;
$$;

create or replace function public.ops_load_pos_daily_sales(
  p_processing_run_id bigint,
  p_worker_id text,
  p_daily_rows jsonb,
  p_hourly_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_run public.ops_processing_run%rowtype;
  v_batch public.ops_raw_batch%rowtype;
  v_daily_count bigint;
  v_hourly_count bigint;
begin
  select * into strict v_run
  from public.ops_processing_run
  where processing_run_id = p_processing_run_id
  for update;

  if v_run.status <> 'RUNNING' or v_run.claimed_by <> p_worker_id or v_run.lease_until <= now() then
    raise exception 'processing run is not actively leased by this worker' using errcode = '55000';
  end if;
  if v_run.pipeline_key <> 'pos_daily_sales' then
    raise exception 'processing run pipeline is not pos_daily_sales' using errcode = '22023';
  end if;
  if jsonb_typeof(p_daily_rows) <> 'array' or jsonb_typeof(p_hourly_rows) <> 'array' then
    raise exception 'POS row payloads must be arrays' using errcode = '22023';
  end if;

  select * into strict v_batch from public.ops_raw_batch where batch_id = v_run.batch_id;
  if v_batch.source_system not in ('RES_POS_DAILY', 'LEGACY_POS_EXPORT')
     or v_batch.status <> 'READY' then
    raise exception 'processing run is not backed by an accepted POS source batch'
      using errcode = '23514';
  end if;

  delete from public.pos_sales_day where source_batch_id = v_batch.batch_id;
  delete from public.pos_sales_hour where source_batch_id = v_batch.batch_id;

  insert into public.pos_sales_day (
    source_batch_id, business_date, store_id, store_name_source, bill_count, guest_count,
    gross_sales, discount_amount, net_sales, total_payment_received, raw_record
  )
  select v_batch.batch_id,
         row.business_date::date,
         coalesce(nullif(row.store_id, ''), v_batch.store_id),
         nullif(row.store_name_source, ''),
         row.bill_count::bigint,
         row.guest_count::bigint,
         row.gross_sales::numeric(18, 2),
         row.discount_amount::numeric(18, 2),
         row.net_sales::numeric(18, 2),
         nullif(row.total_payment_received, '')::numeric(18, 2),
         row.raw_record
  from jsonb_to_recordset(p_daily_rows) as row(
    business_date text,
    store_id text,
    store_name_source text,
    bill_count text,
    guest_count text,
    gross_sales text,
    discount_amount text,
    net_sales text,
    total_payment_received text,
    raw_record jsonb
  );
  get diagnostics v_daily_count = row_count;

  insert into public.pos_sales_hour (
    source_batch_id, business_date, store_id, sales_hour, bill_count, guest_count,
    gross_sales, discount_amount, net_sales, raw_record
  )
  select v_batch.batch_id,
         row.business_date::date,
         coalesce(nullif(row.store_id, ''), v_batch.store_id),
         row.sales_hour::smallint,
         row.bill_count::bigint,
         row.guest_count::bigint,
         row.gross_sales::numeric(18, 2),
         row.discount_amount::numeric(18, 2),
         row.net_sales::numeric(18, 2),
         row.raw_record
  from jsonb_to_recordset(p_hourly_rows) as row(
    business_date text,
    store_id text,
    sales_hour text,
    bill_count text,
    guest_count text,
    gross_sales text,
    discount_amount text,
    net_sales text,
    raw_record jsonb
  );
  get diagnostics v_hourly_count = row_count;

  perform public.ops_finish_processing_run(
    p_processing_run_id,
    p_worker_id,
    'SUCCEEDED',
    v_daily_count + v_hourly_count,
    v_daily_count + v_hourly_count,
    0,
    jsonb_build_object(
      'daily_rows', v_daily_count,
      'hourly_rows', v_hourly_count,
      'source_system', v_batch.source_system
    )
  );

  return jsonb_build_object('daily_rows', v_daily_count, 'hourly_rows', v_hourly_count);
end;
$$;

comment on function public.ops_load_pos_daily_sales(bigint, text, jsonb, jsonb) is
  'Atomically replaces one leased RES daily or explicit legacy-export POS projection, validates its accepted source batch, and marks the run successful.';
