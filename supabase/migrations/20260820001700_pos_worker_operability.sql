-- Complete the structured POS worker contract, health inspection and reversible acceptance.

create or replace function public.ops_claim_processing_run_for_pipeline(
  p_worker_id text,
  p_pipeline_keys text[],
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
  if btrim(p_worker_id) = ''
     or p_lease_seconds < 30
     or p_lease_seconds > 3600
     or cardinality(p_pipeline_keys) is null
     or cardinality(p_pipeline_keys) = 0
     or exists (
       select 1 from unnest(p_pipeline_keys) as key
       where key !~ '^[a-z][a-z0-9_]+$'
     ) then
    raise exception 'invalid worker id, pipeline filter or lease duration'
      using errcode = '22023';
  end if;

  with candidate as (
    select processing_run_id
    from public.ops_processing_run
    where status in ('PENDING', 'RETRY')
      and scheduled_for <= now()
      and pipeline_key = any (p_pipeline_keys)
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

comment on function public.ops_claim_processing_run_for_pipeline(text, text[], integer) is
  'Atomically leases only an explicitly allowlisted structured pipeline using SKIP LOCKED, so specialized workers cannot steal other domains.';

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
    'source_batch_key', batch.source_batch_key,
    'schema_version', batch.schema_version,
    'store_id', batch.store_id,
    'watermark_from', batch.watermark_from,
    'watermark_to', batch.watermark_to,
    'batch_metadata', batch.metadata,
    'pipeline_key', run.pipeline_key,
    'pipeline_version', run.pipeline_version,
    'objects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'raw_object_id', object.raw_object_id,
        'bucket_id', object.bucket_id,
        'object_path', object.object_path,
        'mime_type', object.mime_type,
        'source_record_key', object.source_record_key,
        'source_version', object.source_version,
        'sha256', object.sha256,
        'size_bytes', object.size_bytes,
        'data_class', object.data_class
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
  'Returns immutable batch identity and a size/hash-bearing Raw object manifest only to the worker holding the active lease.';

create or replace function public.ops_quarantine_raw_batch(
  p_batch_id uuid,
  p_reason text,
  p_actor text
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
  if btrim(p_reason) = '' or btrim(p_actor) = '' then
    raise exception 'quarantine reason and actor are required' using errcode = '22023';
  end if;

  select * into strict v_batch
  from public.ops_raw_batch
  where batch_id = p_batch_id
  for update;

  if v_batch.status = 'QUARANTINED' then
    return v_batch;
  end if;
  if v_batch.status <> 'READY' then
    raise exception 'only a READY batch can be quarantined' using errcode = '23514';
  end if;

  update public.ops_raw_batch
  set status = 'QUARANTINED',
      error_summary = left(p_reason, 2000),
      metadata = jsonb_set(
        metadata,
        '{quarantine_history}',
        coalesce(metadata -> 'quarantine_history', '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object(
            'actor', p_actor,
            'reason', left(p_reason, 2000),
            'at', now()
          )),
        true
      )
  where batch_id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;

comment on function public.ops_quarantine_raw_batch(uuid, text, text) is
  'Reversibly removes one accepted Raw batch from current processed views while preserving Raw objects and all versioned facts for audit.';

create or replace function public.ops_restore_raw_batch(
  p_batch_id uuid,
  p_reason text,
  p_actor text
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
  if btrim(p_reason) = '' or btrim(p_actor) = '' then
    raise exception 'restore reason and actor are required' using errcode = '22023';
  end if;

  select * into strict v_batch
  from public.ops_raw_batch
  where batch_id = p_batch_id
  for update;

  if v_batch.status = 'READY' then
    return v_batch;
  end if;
  if v_batch.status <> 'QUARANTINED' then
    raise exception 'only a QUARANTINED batch can be restored' using errcode = '23514';
  end if;

  update public.ops_raw_batch
  set status = 'READY',
      error_summary = null,
      metadata = jsonb_set(
        metadata,
        '{restore_history}',
        coalesce(metadata -> 'restore_history', '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object(
            'actor', p_actor,
            'reason', left(p_reason, 2000),
            'at', now()
          )),
        true
      )
  where batch_id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;

comment on function public.ops_restore_raw_batch(uuid, text, text) is
  'Restores a quarantined Raw batch after verification, making its preserved processed version eligible for current views again.';

create or replace function public.ops_get_platform_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_processing_pending integer;
  v_processing_failed integer;
  v_processing_stale integer;
  v_ingest_pending integer;
  v_ingest_failed integer;
  v_ingest_stale integer;
  v_agent_pending integer;
  v_agent_failed integer;
  v_agent_stale integer;
  v_raw_receiving_stale integer;
  v_raw_quarantined integer;
  v_registered_missing integer;
  v_unregistered_storage integer;
  v_active_cron integer;
  v_status text;
begin
  select
    count(*) filter (where status in ('PENDING', 'RETRY', 'RUNNING')),
    count(*) filter (where status in ('FAILED', 'DEAD')),
    count(*) filter (where status = 'RUNNING' and lease_until <= now())
  into v_processing_pending, v_processing_failed, v_processing_stale
  from public.ops_processing_run;

  select
    count(*) filter (where status in ('PENDING', 'RETRY', 'RUNNING')),
    count(*) filter (where status in ('FAILED', 'DEAD')),
    count(*) filter (where status = 'RUNNING' and lease_until <= now())
  into v_ingest_pending, v_ingest_failed, v_ingest_stale
  from public.ai_ingest_run;

  select
    count(*) filter (where status in ('PENDING', 'RETRY', 'RUNNING', 'AWAITING_APPROVAL')),
    count(*) filter (where status in ('FAILED', 'DEAD')),
    count(*) filter (where status = 'RUNNING' and lease_until <= now())
  into v_agent_pending, v_agent_failed, v_agent_stale
  from public.ops_agent_run;

  select
    count(*) filter (
      where status = 'RECEIVING' and started_at < now() - interval '30 minutes'
    ),
    count(*) filter (where status = 'QUARANTINED')
  into v_raw_receiving_stale, v_raw_quarantined
  from public.ops_raw_batch;

  select count(*) into v_registered_missing
  from public.ops_raw_object as object
  where not exists (
    select 1 from storage.objects
    where bucket_id = object.bucket_id and name = object.object_path
  );

  select count(*) into v_unregistered_storage
  from storage.objects as object
  where object.bucket_id in (
    'raw-business-private', 'kb-internal', 'kb-restricted',
    'hr-recruiting-private', 'hr-payroll-private', 'finance-private', 'legal-private'
  )
    and not exists (
      select 1 from public.ops_raw_object as raw
      where raw.bucket_id = object.bucket_id and raw.object_path = object.name
    );

  select count(*) into v_active_cron
  from cron.job
  where jobname like 'hc_%' and active;

  v_status := case
    when v_processing_failed + v_ingest_failed + v_agent_failed > 0 then 'degraded'
    when v_processing_stale + v_ingest_stale + v_agent_stale + v_raw_receiving_stale > 0
      then 'degraded'
    when v_registered_missing + v_unregistered_storage + v_raw_quarantined > 0 then 'degraded'
    when v_active_cron <> 6 then 'degraded'
    else 'healthy'
  end;

  return jsonb_build_object(
    'status', v_status,
    'checked_at', now(),
    'raw', jsonb_build_object(
      'stale_receiving', v_raw_receiving_stale,
      'quarantined', v_raw_quarantined
    ),
    'processing', jsonb_build_object(
      'pending', v_processing_pending,
      'failed_or_dead', v_processing_failed,
      'expired_leases', v_processing_stale
    ),
    'rag', jsonb_build_object(
      'pending', v_ingest_pending,
      'failed_or_dead', v_ingest_failed,
      'expired_leases', v_ingest_stale
    ),
    'agents', jsonb_build_object(
      'pending', v_agent_pending,
      'failed_or_dead', v_agent_failed,
      'expired_leases', v_agent_stale
    ),
    'storage', jsonb_build_object(
      'registered_missing_object', v_registered_missing,
      'object_missing_registration', v_unregistered_storage
    ),
    'cron', jsonb_build_object('expected_jobs', 6, 'active_jobs', v_active_cron),
    'pos', public.ops_get_pos_processed_summary()
  );
end;
$$;

comment on function public.ops_get_platform_health() is
  'Returns a bounded operational snapshot for Raw, structured processing, RAG, Agent, Storage lineage, Cron and current POS facts without exposing source payloads.';

revoke all on function public.ops_claim_processing_run_for_pipeline(text, text[], integer)
  from public, anon, authenticated;
revoke all on function public.ops_quarantine_raw_batch(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.ops_restore_raw_batch(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.ops_get_platform_health()
  from public, anon, authenticated;

grant execute on function public.ops_claim_processing_run_for_pipeline(text, text[], integer)
  to service_role, hc_ops_processor;
grant execute on function public.ops_quarantine_raw_batch(uuid, text, text)
  to service_role, hc_ops_processor;
grant execute on function public.ops_restore_raw_batch(uuid, text, text)
  to service_role, hc_ops_processor;
grant execute on function public.ops_get_platform_health()
  to service_role, hc_ops_processor, hc_agent_worker;
