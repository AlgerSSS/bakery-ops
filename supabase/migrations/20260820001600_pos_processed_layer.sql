-- Minimal processed POS layer fed from immutable RES POS Raw batches.

create table public.pos_sales_day (
  source_batch_id uuid not null references public.ops_raw_batch(batch_id) on delete restrict,
  business_date date not null,
  store_id text not null,
  store_name_source text,
  bill_count bigint not null,
  guest_count bigint not null,
  gross_sales numeric(18, 2) not null,
  discount_amount numeric(18, 2) not null,
  net_sales numeric(18, 2) not null,
  total_payment_received numeric(18, 2),
  raw_record jsonb not null,
  loaded_at timestamptz not null default now(),
  primary key (source_batch_id, business_date, store_id),
  constraint pos_sales_day_counts_ck check (bill_count >= 0 and guest_count >= 0),
  constraint pos_sales_day_store_ck check (btrim(store_id) <> ''),
  constraint pos_sales_day_raw_record_ck check (jsonb_typeof(raw_record) = 'object')
);

comment on table public.pos_sales_day is
  'One versioned RES POS sales fact per source batch, store and business date; written only by the pos_daily_sales processing RPC, never by finance imports.';

create index pos_sales_day_current_idx
  on public.pos_sales_day (store_id, business_date desc, source_batch_id);

create table public.pos_sales_hour (
  source_batch_id uuid not null references public.ops_raw_batch(batch_id) on delete restrict,
  business_date date not null,
  store_id text not null,
  sales_hour smallint not null,
  bill_count bigint not null,
  guest_count bigint not null,
  gross_sales numeric(18, 2) not null,
  discount_amount numeric(18, 2) not null,
  net_sales numeric(18, 2) not null,
  raw_record jsonb not null,
  loaded_at timestamptz not null default now(),
  primary key (source_batch_id, business_date, store_id, sales_hour),
  constraint pos_sales_hour_hour_ck check (sales_hour between 0 and 23),
  constraint pos_sales_hour_counts_ck check (bill_count >= 0 and guest_count >= 0),
  constraint pos_sales_hour_store_ck check (btrim(store_id) <> ''),
  constraint pos_sales_hour_raw_record_ck check (jsonb_typeof(raw_record) = 'object')
);

comment on table public.pos_sales_hour is
  'One versioned RES POS hourly sales fact per source batch, store, business date and hour; written only by the pos_daily_sales processing RPC.';

create index pos_sales_hour_current_idx
  on public.pos_sales_hour (store_id, business_date desc, sales_hour, source_batch_id);

alter table public.pos_sales_day enable row level security;
alter table public.pos_sales_hour enable row level security;

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
where batch.status = 'READY'
order by fact.store_id, fact.business_date, batch.completed_at desc, batch.started_at desc, fact.source_batch_id desc;

comment on view public.v_pos_sales_day_current is
  'Current accepted RES POS daily version selected by latest completed immutable Raw batch; no duplicate stored copy.';

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
where batch.status = 'READY'
order by fact.store_id, fact.business_date, fact.sales_hour,
  batch.completed_at desc, batch.started_at desc, fact.source_batch_id desc;

comment on view public.v_pos_sales_hour_current is
  'Current accepted RES POS hourly version selected by latest completed immutable Raw batch; no duplicate stored copy.';

create or replace function public.ops_get_processing_input(
  p_processing_run_id bigint,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'processing_run_id', run.processing_run_id,
    'batch_id', batch.batch_id,
    'source_system', batch.source_system,
    'store_id', batch.store_id,
    'pipeline_key', run.pipeline_key,
    'pipeline_version', run.pipeline_version,
    'objects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'raw_object_id', object.raw_object_id,
        'bucket_id', object.bucket_id,
        'object_path', object.object_path,
        'mime_type', object.mime_type,
        'source_record_key', object.source_record_key,
        'sha256', object.sha256
      ) order by object.source_record_key, object.raw_object_id)
      from public.ops_raw_object as object
      where object.batch_id = batch.batch_id
    ), '[]'::jsonb)
  )
  into v_result
  from public.ops_processing_run as run
  join public.ops_raw_batch as batch on batch.batch_id = run.batch_id
  where run.processing_run_id = p_processing_run_id
    and run.status = 'RUNNING'
    and run.claimed_by = p_worker_id
    and run.lease_until > now();

  if v_result is null then
    raise exception 'processing run is not actively leased by this worker' using errcode = '55000';
  end if;
  return v_result;
end;
$$;

comment on function public.ops_get_processing_input(bigint, text) is
  'Returns only the Raw object manifest for a processing run actively leased by the calling worker identity.';

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
  if v_batch.source_system <> 'RES_POS_DAILY' or v_batch.status <> 'READY' then
    raise exception 'processing run is not backed by a ready RES_POS_DAILY batch' using errcode = '23514';
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
    jsonb_build_object('daily_rows', v_daily_count, 'hourly_rows', v_hourly_count)
  );

  return jsonb_build_object('daily_rows', v_daily_count, 'hourly_rows', v_hourly_count);
end;
$$;

comment on function public.ops_load_pos_daily_sales(bigint, text, jsonb, jsonb) is
  'Atomically replaces one leased Raw batch POS projection, validates its source, and marks that processing run successful.';

create or replace function public.ops_get_pos_processed_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
  select jsonb_build_object(
    'daily_versions', (select count(*) from public.pos_sales_day),
    'hourly_versions', (select count(*) from public.pos_sales_hour),
    'current_days', (select count(*) from public.v_pos_sales_day_current),
    'max_business_date', (select max(business_date) from public.v_pos_sales_day_current)
  );
$$;

revoke all on public.pos_sales_day, public.pos_sales_hour from public, anon, authenticated, service_role;
revoke all on public.v_pos_sales_day_current, public.v_pos_sales_hour_current from public, anon, authenticated, service_role;
revoke all on function public.ops_get_processing_input(bigint, text) from public, anon, authenticated;
revoke all on function public.ops_load_pos_daily_sales(bigint, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.ops_get_pos_processed_summary() from public, anon, authenticated;

grant execute on function public.ops_get_processing_input(bigint, text) to service_role, hc_ops_processor;
grant execute on function public.ops_load_pos_daily_sales(bigint, text, jsonb, jsonb) to service_role, hc_ops_processor;
grant execute on function public.ops_get_pos_processed_summary() to service_role, hc_ops_processor, hc_agent_worker;
