-- Idempotent Agent orchestration, leasing and append-only approval events.

create or replace function private.prevent_row_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only; create a new event instead', tg_table_name
    using errcode = '55000';
end;
$$;

create trigger ops_agent_event_append_only
before update or delete on public.ops_agent_event
for each row execute function private.prevent_row_mutation();

create or replace function public.ops_start_agent_run(
  p_agent_type text,
  p_trigger_type text,
  p_dedupe_key text,
  p_model_version text,
  p_prompt_version text,
  p_store_id text default null,
  p_requested_by_user_id uuid default null,
  p_input_refs jsonb default '{}'::jsonb,
  p_priority smallint default 100,
  p_scheduled_for timestamptz default now()
)
returns public.ops_agent_run
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_run public.ops_agent_run%rowtype;
  v_auth_user uuid := (select auth.uid());
  v_auth_role text := (select auth.role());
  v_requester uuid;
begin
  if v_auth_role = 'authenticated' then
    if p_trigger_type <> 'USER' then
      raise exception 'authenticated users can only start USER-triggered runs' using errcode = '42501';
    end if;
    if p_requested_by_user_id is not null and p_requested_by_user_id <> v_auth_user then
      raise exception 'authenticated users cannot impersonate another requester' using errcode = '42501';
    end if;
    v_requester := v_auth_user;
  else
    v_requester := p_requested_by_user_id;
  end if;

  insert into public.ops_agent_run (
    agent_type,
    trigger_type,
    dedupe_key,
    store_id,
    requested_by_user_id,
    input_refs,
    model_version,
    prompt_version,
    priority,
    scheduled_for
  )
  values (
    p_agent_type,
    p_trigger_type,
    p_dedupe_key,
    p_store_id,
    v_requester,
    coalesce(p_input_refs, '{}'::jsonb),
    p_model_version,
    p_prompt_version,
    p_priority,
    p_scheduled_for
  )
  on conflict (agent_type, dedupe_key) do nothing
  returning * into v_run;

  if not found then
    select * into strict v_run
    from public.ops_agent_run
    where agent_type = p_agent_type and dedupe_key = p_dedupe_key;

    if v_run.model_version <> p_model_version
       or v_run.prompt_version <> p_prompt_version
       or v_run.store_id is distinct from p_store_id
       or v_run.requested_by_user_id is distinct from v_requester
       or v_run.input_refs <> coalesce(p_input_refs, '{}'::jsonb) then
      raise exception 'agent dedupe key exists with different immutable inputs'
        using errcode = '23505';
    end if;
  end if;

  return v_run;
end;
$$;

create or replace function public.ops_claim_agent_run(
  p_worker_id text,
  p_lease_seconds integer default 600
)
returns public.ops_agent_run
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_run public.ops_agent_run%rowtype;
begin
  if btrim(p_worker_id) = '' or p_lease_seconds < 60 or p_lease_seconds > 3600 then
    raise exception 'invalid worker id or lease duration' using errcode = '22023';
  end if;

  with candidate as (
    select agent_run_id
    from public.ops_agent_run
    where status in ('PENDING', 'RETRY')
      and scheduled_for <= now()
    order by priority, scheduled_for, created_at
    for update skip locked
    limit 1
  )
  update public.ops_agent_run as run
  set status = 'RUNNING',
      attempt_count = run.attempt_count + 1,
      claimed_by = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(run.started_at, now()),
      error_summary = null
  from candidate
  where run.agent_run_id = candidate.agent_run_id
  returning run.* into v_run;

  return v_run;
end;
$$;

create or replace function public.ops_heartbeat_agent_run(
  p_agent_run_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  if p_lease_seconds < 60 or p_lease_seconds > 3600 then
    raise exception 'invalid lease duration' using errcode = '22023';
  end if;

  update public.ops_agent_run
  set lease_until = now() + make_interval(secs => p_lease_seconds)
  where agent_run_id = p_agent_run_id
    and status = 'RUNNING'
    and claimed_by = p_worker_id
    and lease_until > now();

  return found;
end;
$$;

create or replace function public.ops_append_agent_event(
  p_agent_run_id uuid,
  p_event_type text,
  p_schema_version text,
  p_actor_type text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null,
  p_occurred_at timestamptz default now()
)
returns public.ops_agent_event
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_event public.ops_agent_event%rowtype;
  v_run public.ops_agent_run%rowtype;
  v_inserted boolean := false;
  v_auth_user uuid := (select auth.uid());
  v_auth_role text := (select auth.role());
begin
  select * into strict v_run
  from public.ops_agent_run
  where agent_run_id = p_agent_run_id
  for update;

  if v_auth_role = 'authenticated' then
    if p_actor_type <> 'USER'
       or p_actor_user_id is distinct from v_auth_user
       or v_run.requested_by_user_id is distinct from v_auth_user
       or p_event_type not in ('APPROVED', 'REJECTED', 'FEEDBACK') then
      raise exception 'user is not allowed to append this Agent event' using errcode = '42501';
    end if;
  end if;

  insert into public.ops_agent_event (
    agent_run_id,
    event_type,
    schema_version,
    actor_type,
    actor_user_id,
    idempotency_key,
    payload,
    occurred_at
  )
  values (
    p_agent_run_id,
    p_event_type,
    p_schema_version,
    p_actor_type,
    p_actor_user_id,
    p_idempotency_key,
    coalesce(p_payload, '{}'::jsonb),
    p_occurred_at
  )
  on conflict (agent_run_id, idempotency_key) do nothing
  returning * into v_event;

  if found then
    v_inserted := true;
  else
    select * into strict v_event
    from public.ops_agent_event
    where agent_run_id = p_agent_run_id
      and idempotency_key = p_idempotency_key;

    if v_event.event_type <> p_event_type
       or v_event.actor_type <> p_actor_type
       or v_event.actor_user_id is distinct from p_actor_user_id
       or v_event.payload <> coalesce(p_payload, '{}'::jsonb) then
      raise exception 'event idempotency key exists with different content'
        using errcode = '23505';
    end if;
  end if;

  if v_inserted and p_event_type = 'APPROVED' and v_run.status = 'AWAITING_APPROVAL' then
    update public.ops_agent_run
    set status = 'PENDING',
        scheduled_for = now(),
        finished_at = null
    where agent_run_id = p_agent_run_id;
  elsif v_inserted and p_event_type = 'REJECTED' and v_run.status = 'AWAITING_APPROVAL' then
    update public.ops_agent_run
    set status = 'CANCELLED',
        finished_at = now()
    where agent_run_id = p_agent_run_id;
  end if;

  return v_event;
end;
$$;

create or replace function public.ops_finish_agent_run(
  p_agent_run_id uuid,
  p_worker_id text,
  p_status text,
  p_result_summary jsonb default null,
  p_error_summary text default null
)
returns public.ops_agent_run
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_run public.ops_agent_run%rowtype;
begin
  if p_status not in ('SUCCEEDED', 'AWAITING_APPROVAL', 'FAILED') then
    raise exception 'invalid Agent completion status' using errcode = '22023';
  end if;

  update public.ops_agent_run
  set status = p_status,
      result_summary = p_result_summary,
      error_summary = left(p_error_summary, 2000),
      lease_until = null,
      finished_at = case when p_status in ('SUCCEEDED', 'FAILED') then now() else null end
  where agent_run_id = p_agent_run_id
    and status = 'RUNNING'
    and claimed_by = p_worker_id
    and lease_until > now()
  returning * into v_run;

  if not found then
    raise exception 'Agent run is not actively leased by this worker' using errcode = '55000';
  end if;

  return v_run;
end;
$$;

create or replace function public.ops_recover_agent_runs(
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
  update public.ops_agent_run
  set status = case when attempt_count >= p_max_attempts then 'DEAD' else 'RETRY' end,
      trigger_type = 'RETRY',
      scheduled_for = now(),
      lease_until = null,
      error_summary = 'Agent worker lease expired before completion',
      finished_at = case when attempt_count >= p_max_attempts then now() else null end
  where status = 'RUNNING'
    and lease_until <= now();

  get diagnostics v_recovered = row_count;
  return v_recovered;
end;
$$;

revoke all on function public.ops_start_agent_run(text, text, text, text, text, text, uuid, jsonb, smallint, timestamptz) from public, anon;
revoke all on function public.ops_claim_agent_run(text, integer) from public, anon, authenticated;
revoke all on function public.ops_heartbeat_agent_run(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.ops_append_agent_event(uuid, text, text, text, text, jsonb, uuid, timestamptz) from public, anon;
revoke all on function public.ops_finish_agent_run(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.ops_recover_agent_runs(integer) from public, anon, authenticated;

grant execute on function public.ops_start_agent_run(text, text, text, text, text, text, uuid, jsonb, smallint, timestamptz) to authenticated, service_role;
grant execute on function public.ops_claim_agent_run(text, integer) to service_role;
grant execute on function public.ops_heartbeat_agent_run(uuid, text, integer) to service_role;
grant execute on function public.ops_append_agent_event(uuid, text, text, text, text, jsonb, uuid, timestamptz) to authenticated, service_role;
grant execute on function public.ops_finish_agent_run(uuid, text, text, jsonb, text) to service_role;
grant execute on function public.ops_recover_agent_runs(integer) to service_role;
