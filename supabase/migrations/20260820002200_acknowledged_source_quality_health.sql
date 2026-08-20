-- Expected historical source-quality anomalies remain auditable without paging as platform faults.

update public.ops_raw_batch
set metadata = jsonb_set(
  metadata,
  '{health_impact}',
  '"acknowledged_source_quality"'::jsonb,
  true
)
where source_system = 'LEGACY_POS_ANOMALY'
  and metadata ->> 'health_impact' is distinct from 'acknowledged_source_quality';

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
  v_raw_quarantined_total integer;
  v_raw_quarantined_acknowledged integer;
  v_raw_quarantined_unacknowledged integer;
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
    count(*) filter (where status = 'QUARANTINED'),
    count(*) filter (
      where status = 'QUARANTINED'
        and metadata ->> 'health_impact' = 'acknowledged_source_quality'
    ),
    count(*) filter (
      where status = 'QUARANTINED'
        and metadata ->> 'health_impact' is distinct from 'acknowledged_source_quality'
    )
  into v_raw_receiving_stale, v_raw_quarantined_total,
       v_raw_quarantined_acknowledged, v_raw_quarantined_unacknowledged
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
    when v_registered_missing + v_unregistered_storage + v_raw_quarantined_unacknowledged > 0
      then 'degraded'
    when v_active_cron <> 6 then 'degraded'
    else 'healthy'
  end;

  return jsonb_build_object(
    'status', v_status,
    'checked_at', now(),
    'raw', jsonb_build_object(
      'stale_receiving', v_raw_receiving_stale,
      'quarantined', v_raw_quarantined_total,
      'quarantined_unacknowledged', v_raw_quarantined_unacknowledged,
      'acknowledged_source_quality', v_raw_quarantined_acknowledged
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
  'Returns bounded platform health; acknowledged historical source-quality quarantine is reported separately and does not page as an unresolved platform fault.';

revoke all on function public.ops_get_platform_health()
  from public, anon, authenticated;
grant execute on function public.ops_get_platform_health()
  to service_role, hc_ops_processor, hc_agent_worker;
