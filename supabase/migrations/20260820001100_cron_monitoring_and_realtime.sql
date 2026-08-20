-- Short database-side recovery, health and reconciliation jobs. All schedules are UTC.

create or replace function public.ops_rollup_pipeline_health()
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_rows integer;
begin
  with pipeline_stats as (
    select run.pipeline_key,
           max(coalesce(run.finished_at, run.started_at, run.created_at)) as last_run_at,
           max(run.finished_at) filter (where run.status = 'SUCCEEDED') as last_success_at,
           max(run.finished_at) filter (where run.status in ('FAILED', 'DEAD')) as last_failure_at,
           count(*) filter (where run.status in ('PENDING', 'RETRY', 'RUNNING')) as pending_count,
           min(run.created_at) filter (where run.status in ('PENDING', 'RETRY', 'RUNNING')) as oldest_pending_at
    from public.ops_processing_run as run
    group by run.pipeline_key
  ), latest_success as (
    select distinct on (run.pipeline_key)
           run.pipeline_key,
           run.rows_written
    from public.ops_processing_run as run
    where run.status = 'SUCCEEDED'
    order by run.pipeline_key, run.finished_at desc, run.processing_run_id desc
  ), latest_failure as (
    select distinct on (run.pipeline_key)
           run.pipeline_key,
           run.error_summary
    from public.ops_processing_run as run
    where run.status in ('FAILED', 'DEAD')
    order by run.pipeline_key, run.finished_at desc, run.processing_run_id desc
  )
  insert into public.pipeline_health (
    source_key,
    last_run_at,
    last_success_at,
    last_failure_at,
    status,
    rows_imported,
    pending_count,
    oldest_pending_at,
    lag_seconds,
    error,
    updated_at
  )
  select stats.pipeline_key,
         stats.last_run_at,
         stats.last_success_at,
         stats.last_failure_at,
         case
           when stats.pending_count > 0
             and stats.oldest_pending_at < now() - interval '30 minutes' then 'stale'
           when stats.pending_count > 0 then 'running'
           when stats.last_failure_at is not null
             and (stats.last_success_at is null or stats.last_failure_at > stats.last_success_at) then 'error'
           when stats.last_success_at is not null then 'success'
           else 'unknown'
         end,
         coalesce(success.rows_written, 0),
         stats.pending_count,
         stats.oldest_pending_at,
         case when stats.last_success_at is null then null
              else greatest(0, extract(epoch from now() - stats.last_success_at)::bigint)
         end,
         failure.error_summary,
         now()
  from pipeline_stats as stats
  left join latest_success as success using (pipeline_key)
  left join latest_failure as failure using (pipeline_key)
  on conflict (source_key) do update
  set last_run_at = excluded.last_run_at,
      last_success_at = excluded.last_success_at,
      last_failure_at = excluded.last_failure_at,
      status = excluded.status,
      rows_imported = excluded.rows_imported,
      pending_count = excluded.pending_count,
      oldest_pending_at = excluded.oldest_pending_at,
      lag_seconds = excluded.lag_seconds,
      error = excluded.error,
      updated_at = excluded.updated_at;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.ops_record_lineage_reconcile()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_summary jsonb;
  v_run_id uuid;
  v_dedupe_key text := to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD');
begin
  select jsonb_build_object(
    'ready_batches_missing_runs', (
      select count(*)
      from public.ops_raw_batch as batch
      where batch.status = 'READY'
        and jsonb_array_length(coalesce(batch.metadata -> 'pipeline_keys', '[]'::jsonb)) > 0
        and not exists (
          select 1 from public.ops_processing_run as run where run.batch_id = batch.batch_id
        )
    ),
    'registered_objects_missing_storage', (
      select count(*)
      from public.ops_raw_object as object
      where not exists (
        select 1 from storage.objects
        where bucket_id = object.bucket_id and name = object.object_path
      )
    ),
    'storage_objects_missing_registration', (
      select count(*)
      from storage.objects as object
      where object.bucket_id in (
        'raw-business-private', 'kb-internal', 'hr-recruiting-private',
        'hr-payroll-private', 'finance-private', 'legal-private'
      )
        and not exists (
          select 1 from public.ops_raw_object as raw
          where raw.bucket_id = object.bucket_id and raw.object_path = object.name
        )
    ),
    'checked_at', now()
  ) into v_summary;

  insert into public.ops_agent_run (
    agent_type,
    trigger_type,
    dedupe_key,
    input_refs,
    model_version,
    prompt_version,
    status,
    result_summary,
    finished_at
  )
  values (
    'DATA_LINEAGE_RECONCILE',
    'SCHEDULE',
    v_dedupe_key,
    '{}'::jsonb,
    'deterministic-sql',
    'lineage-v1',
    'SUCCEEDED',
    v_summary,
    now()
  )
  on conflict (agent_type, dedupe_key) do update
  set result_summary = excluded.result_summary,
      finished_at = excluded.finished_at
  returning agent_run_id into v_run_id;

  insert into public.ops_agent_event (
    agent_run_id,
    event_type,
    schema_version,
    actor_type,
    idempotency_key,
    payload
  )
  values (
    v_run_id,
    'RECONCILE_RESULT',
    'v1',
    'SYSTEM',
    'result:' || v_dedupe_key,
    v_summary
  )
  on conflict (agent_run_id, idempotency_key) do nothing;

  return v_summary;
end;
$$;

create or replace function public.ai_cleanup_failed_stage(
  p_retention_days integer default 30
)
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_deleted integer;
begin
  if p_retention_days < 7 then
    raise exception 'failed-stage retention cannot be shorter than 7 days' using errcode = '22023';
  end if;

  delete from public.ai_document_chunk as chunk
  using public.ai_ingest_run as run
  where chunk.ingest_run_id = run.ingest_run_id
    and run.status in ('FAILED', 'DEAD')
    and run.finished_at < now() - make_interval(days => p_retention_days)
    and not exists (
      select 1
      from public.ai_raw_document as document
      where document.published_ingest_run_id = run.ingest_run_id
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.ops_rollup_pipeline_health() from public, anon, authenticated;
revoke all on function public.ops_record_lineage_reconcile() from public, anon, authenticated;
revoke all on function public.ai_cleanup_failed_stage(integer) from public, anon, authenticated;
grant execute on function public.ops_rollup_pipeline_health() to service_role;
grant execute on function public.ops_record_lineage_reconcile() to service_role;
grant execute on function public.ai_cleanup_failed_stage(integer) to service_role;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'hc_recover_processing_runs',
      'hc_recover_ingest_runs',
      'hc_recover_agent_runs',
      'hc_pipeline_health_rollup',
      'hc_daily_lineage_reconcile',
      'hc_failed_stage_cleanup'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'hc_recover_processing_runs',
  '*/5 * * * *',
  'select public.ops_recover_processing_runs(5);'
);
select cron.schedule(
  'hc_recover_ingest_runs',
  '*/5 * * * *',
  'select public.ai_recover_ingest_runs(5);'
);
select cron.schedule(
  'hc_recover_agent_runs',
  '*/5 * * * *',
  'select public.ops_recover_agent_runs(5);'
);
select cron.schedule(
  'hc_pipeline_health_rollup',
  '*/10 * * * *',
  'select public.ops_rollup_pipeline_health();'
);
select cron.schedule(
  'hc_daily_lineage_reconcile',
  '30 16 * * *',
  'select public.ops_record_lineage_reconcile();'
);
select cron.schedule(
  'hc_failed_stage_cleanup',
  '0 18 * * 6',
  'select public.ai_cleanup_failed_stage(30);'
);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'ops_agent_run',
    'ops_agent_event',
    'ai_ingest_run'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
