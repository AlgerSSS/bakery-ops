-- Idempotent raw-ingestion and structured-processing RPC boundary.

create or replace function public.ops_register_raw_batch(
  p_source_system text,
  p_source_batch_key text,
  p_schema_version text,
  p_writer_id text,
  p_store_id text default null,
  p_watermark_from timestamptz default null,
  p_watermark_to timestamptz default null,
  p_expected_count bigint default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.ops_raw_batch
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_batch public.ops_raw_batch%rowtype;
begin
  insert into public.ops_raw_batch (
    source_system,
    source_batch_key,
    schema_version,
    writer_id,
    store_id,
    watermark_from,
    watermark_to,
    expected_count,
    metadata
  )
  values (
    p_source_system,
    p_source_batch_key,
    p_schema_version,
    p_writer_id,
    p_store_id,
    p_watermark_from,
    p_watermark_to,
    p_expected_count,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (source_system, source_batch_key, schema_version) do nothing
  returning * into v_batch;

  if not found then
    select * into strict v_batch
    from public.ops_raw_batch
    where source_system = p_source_system
      and source_batch_key = p_source_batch_key
      and schema_version = p_schema_version;

    if v_batch.writer_id <> p_writer_id
       or v_batch.store_id is distinct from p_store_id
       or v_batch.watermark_from is distinct from p_watermark_from
       or v_batch.watermark_to is distinct from p_watermark_to
       or v_batch.expected_count is distinct from p_expected_count then
      raise exception 'idempotency key already exists with different immutable batch attributes'
        using errcode = '23505';
    end if;
  end if;

  return v_batch;
end;
$$;

comment on function public.ops_register_raw_batch(text, text, text, text, text, timestamptz, timestamptz, bigint, jsonb) is
  'Idempotently registers one receiving source batch and rejects immutable-attribute conflicts.';

create or replace function public.ops_register_raw_object(
  p_batch_id uuid,
  p_bucket_id text,
  p_object_path text,
  p_sha256 character(64),
  p_size_bytes bigint,
  p_mime_type text,
  p_data_class text,
  p_source_record_key text default null,
  p_source_version text default null
)
returns public.ops_raw_object
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_batch_status text;
  v_object public.ops_raw_object%rowtype;
begin
  select status into strict v_batch_status
  from public.ops_raw_batch
  where batch_id = p_batch_id
  for update;

  if v_batch_status <> 'RECEIVING' then
    raise exception 'raw objects can only be registered while batch is RECEIVING'
      using errcode = '23514';
  end if;

  insert into public.ops_raw_object (
    batch_id,
    bucket_id,
    object_path,
    sha256,
    size_bytes,
    mime_type,
    data_class,
    source_record_key,
    source_version
  )
  values (
    p_batch_id,
    p_bucket_id,
    p_object_path,
    p_sha256,
    p_size_bytes,
    p_mime_type,
    p_data_class,
    p_source_record_key,
    p_source_version
  )
  on conflict (bucket_id, object_path) do nothing
  returning * into v_object;

  if not found then
    select * into strict v_object
    from public.ops_raw_object
    where bucket_id = p_bucket_id and object_path = p_object_path;

    if v_object.batch_id <> p_batch_id
       or v_object.sha256 <> p_sha256
       or v_object.size_bytes <> p_size_bytes
       or v_object.mime_type <> p_mime_type
       or v_object.data_class <> p_data_class
       or v_object.source_record_key is distinct from p_source_record_key
       or v_object.source_version is distinct from p_source_version then
      raise exception 'object path already exists with different immutable attributes'
        using errcode = '23505';
    end if;
  end if;

  return v_object;
end;
$$;

comment on function public.ops_register_raw_object(uuid, text, text, character, bigint, text, text, text, text) is
  'Idempotently registers one immutable Storage object against a receiving raw batch.';

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
    when p_source_system = 'RES_POS_DAILY'
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

create or replace function public.ops_complete_raw_batch(
  p_batch_id uuid,
  p_accepted_count bigint,
  p_rejected_count bigint,
  p_pipeline_keys text[],
  p_pipeline_version text,
  p_error_summary text default null
)
returns public.ops_raw_batch
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_batch public.ops_raw_batch%rowtype;
  v_pipeline_key text;
begin
  select * into strict v_batch
  from public.ops_raw_batch
  where batch_id = p_batch_id
  for update;

  if v_batch.status not in ('RECEIVING', 'READY') then
    raise exception 'batch cannot be completed from status %', v_batch.status
      using errcode = '23514';
  end if;

  if p_accepted_count < 0 or p_rejected_count < 0 then
    raise exception 'batch counts cannot be negative' using errcode = '23514';
  end if;

  if v_batch.expected_count is not null
     and v_batch.expected_count <> p_accepted_count + p_rejected_count then
    raise exception 'accepted plus rejected count does not match expected count'
      using errcode = '23514';
  end if;

  if btrim(p_pipeline_version) = '' then
    raise exception 'pipeline version is required' using errcode = '23514';
  end if;

  foreach v_pipeline_key in array coalesce(p_pipeline_keys, '{}'::text[])
  loop
    if not private.is_allowed_pipeline(v_batch.source_system, v_pipeline_key) then
      raise exception 'pipeline % is not allowed for source %', v_pipeline_key, v_batch.source_system
        using errcode = '42501';
    end if;
  end loop;

  if v_batch.status = 'READY'
     and (v_batch.accepted_count <> p_accepted_count
       or v_batch.rejected_count <> p_rejected_count) then
    raise exception 'completed batch cannot be changed' using errcode = '23514';
  end if;

  update public.ops_raw_batch
  set status = case when p_error_summary is null then 'READY' else 'QUARANTINED' end,
      accepted_count = p_accepted_count,
      rejected_count = p_rejected_count,
      completed_at = coalesce(completed_at, now()),
      error_summary = p_error_summary,
      metadata = metadata || jsonb_build_object(
        'pipeline_keys', to_jsonb(coalesce(p_pipeline_keys, '{}'::text[])),
        'pipeline_version', p_pipeline_version
      )
  where batch_id = p_batch_id
  returning * into v_batch;

  if v_batch.status = 'READY' then
    insert into public.ops_processing_run (batch_id, pipeline_key, pipeline_version)
    select p_batch_id, key, p_pipeline_version
    from unnest(coalesce(p_pipeline_keys, '{}'::text[])) as key
    on conflict (batch_id, pipeline_key, pipeline_version) do nothing;
  end if;

  return v_batch;
end;
$$;

comment on function public.ops_complete_raw_batch(uuid, bigint, bigint, text[], text, text) is
  'Atomically marks a validated batch ready and creates allowlisted processing runs exactly once.';

create or replace function public.ops_claim_processing_run(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns public.ops_processing_run
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_run public.ops_processing_run%rowtype;
begin
  if btrim(p_worker_id) = '' or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'invalid worker id or lease duration' using errcode = '22023';
  end if;

  with candidate as (
    select processing_run_id
    from public.ops_processing_run
    where status in ('PENDING', 'RETRY')
      and scheduled_for <= now()
    order by priority, scheduled_for, processing_run_id
    for update skip locked
    limit 1
  )
  update public.ops_processing_run as run
  set status = 'RUNNING',
      attempt_count = run.attempt_count + 1,
      claimed_by = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(run.started_at, now()),
      error_code = null,
      error_summary = null
  from candidate
  where run.processing_run_id = candidate.processing_run_id
  returning run.* into v_run;

  return v_run;
end;
$$;

create or replace function public.ops_heartbeat_processing_run(
  p_processing_run_id bigint,
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'invalid lease duration' using errcode = '22023';
  end if;

  update public.ops_processing_run
  set lease_until = now() + make_interval(secs => p_lease_seconds)
  where processing_run_id = p_processing_run_id
    and status = 'RUNNING'
    and claimed_by = p_worker_id
    and lease_until > now();

  return found;
end;
$$;

create or replace function public.ops_finish_processing_run(
  p_processing_run_id bigint,
  p_worker_id text,
  p_status text,
  p_rows_read bigint,
  p_rows_written bigint,
  p_rows_rejected bigint,
  p_output_watermark jsonb default '{}'::jsonb
)
returns public.ops_processing_run
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_run public.ops_processing_run%rowtype;
begin
  if p_status not in ('SUCCEEDED', 'REVIEW_REQUIRED') then
    raise exception 'invalid processing completion status' using errcode = '22023';
  end if;

  update public.ops_processing_run
  set status = p_status,
      rows_read = p_rows_read,
      rows_written = p_rows_written,
      rows_rejected = p_rows_rejected,
      output_watermark = coalesce(p_output_watermark, '{}'::jsonb),
      lease_until = null,
      finished_at = now()
  where processing_run_id = p_processing_run_id
    and status = 'RUNNING'
    and claimed_by = p_worker_id
    and lease_until > now()
  returning * into v_run;

  if not found then
    raise exception 'processing run is not actively leased by this worker'
      using errcode = '55000';
  end if;

  return v_run;
end;
$$;

create or replace function public.ops_fail_processing_run(
  p_processing_run_id bigint,
  p_worker_id text,
  p_error_code text,
  p_error_summary text,
  p_retryable boolean,
  p_retry_delay_seconds integer default 60,
  p_max_attempts integer default 5
)
returns public.ops_processing_run
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_run public.ops_processing_run%rowtype;
  v_next_status text;
begin
  select * into strict v_run
  from public.ops_processing_run
  where processing_run_id = p_processing_run_id
  for update;

  if v_run.status <> 'RUNNING' or v_run.claimed_by <> p_worker_id then
    raise exception 'processing run is not leased by this worker' using errcode = '55000';
  end if;

  v_next_status := case
    when p_retryable and v_run.attempt_count < p_max_attempts then 'RETRY'
    when p_retryable then 'DEAD'
    else 'FAILED'
  end;

  update public.ops_processing_run
  set status = v_next_status,
      scheduled_for = case
        when v_next_status = 'RETRY' then now() + make_interval(secs => greatest(1, p_retry_delay_seconds))
        else scheduled_for
      end,
      lease_until = null,
      error_code = nullif(left(p_error_code, 120), ''),
      error_summary = left(p_error_summary, 2000),
      finished_at = case when v_next_status in ('FAILED', 'DEAD') then now() else null end
  where processing_run_id = p_processing_run_id
  returning * into v_run;

  return v_run;
end;
$$;

create or replace function public.ops_recover_processing_runs(
  p_max_attempts integer default 5
)
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_recovered integer;
begin
  insert into public.ops_processing_run (batch_id, pipeline_key, pipeline_version)
  select batch.batch_id,
         route.pipeline_key,
         batch.metadata ->> 'pipeline_version'
  from public.ops_raw_batch as batch
  cross join lateral jsonb_array_elements_text(
    coalesce(batch.metadata -> 'pipeline_keys', '[]'::jsonb)
  ) as route(pipeline_key)
  where batch.status = 'READY'
    and nullif(batch.metadata ->> 'pipeline_version', '') is not null
    and private.is_allowed_pipeline(batch.source_system, route.pipeline_key)
  on conflict (batch_id, pipeline_key, pipeline_version) do nothing;

  update public.ops_processing_run
  set status = case when attempt_count >= p_max_attempts then 'DEAD' else 'RETRY' end,
      scheduled_for = now(),
      lease_until = null,
      error_code = 'LEASE_EXPIRED',
      error_summary = 'Worker lease expired before completion',
      finished_at = case when attempt_count >= p_max_attempts then now() else null end
  where status = 'RUNNING'
    and lease_until <= now();

  get diagnostics v_recovered = row_count;
  return v_recovered;
end;
$$;

revoke all on function public.ops_register_raw_batch(text, text, text, text, text, timestamptz, timestamptz, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.ops_register_raw_object(uuid, text, text, character, bigint, text, text, text, text) from public, anon, authenticated;
revoke all on function public.ops_complete_raw_batch(uuid, bigint, bigint, text[], text, text) from public, anon, authenticated;
revoke all on function public.ops_claim_processing_run(text, integer) from public, anon, authenticated;
revoke all on function public.ops_heartbeat_processing_run(bigint, text, integer) from public, anon, authenticated;
revoke all on function public.ops_finish_processing_run(bigint, text, text, bigint, bigint, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.ops_fail_processing_run(bigint, text, text, text, boolean, integer, integer) from public, anon, authenticated;
revoke all on function public.ops_recover_processing_runs(integer) from public, anon, authenticated;

grant execute on function public.ops_register_raw_batch(text, text, text, text, text, timestamptz, timestamptz, bigint, jsonb) to service_role;
grant execute on function public.ops_register_raw_object(uuid, text, text, character, bigint, text, text, text, text) to service_role;
grant execute on function public.ops_complete_raw_batch(uuid, bigint, bigint, text[], text, text) to service_role;
grant execute on function public.ops_claim_processing_run(text, integer) to service_role;
grant execute on function public.ops_heartbeat_processing_run(bigint, text, integer) to service_role;
grant execute on function public.ops_finish_processing_run(bigint, text, text, bigint, bigint, bigint, jsonb) to service_role;
grant execute on function public.ops_fail_processing_run(bigint, text, text, text, boolean, integer, integer) to service_role;
grant execute on function public.ops_recover_processing_runs(integer) to service_role;
