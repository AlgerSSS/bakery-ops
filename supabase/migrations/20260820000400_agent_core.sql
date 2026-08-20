-- Agent run and append-only event control plane.

create table public.ops_agent_run (
  agent_run_id uuid primary key default gen_random_uuid(),
  agent_type text not null,
  trigger_type text not null,
  dedupe_key text not null,
  store_id text,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  input_refs jsonb not null default '{}'::jsonb,
  model_version text not null,
  prompt_version text not null,
  status text not null default 'PENDING',
  priority smallint not null default 100,
  attempt_count integer not null default 0,
  scheduled_for timestamptz not null default now(),
  claimed_by text,
  lease_until timestamptz,
  result_summary jsonb,
  error_summary text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint ops_agent_run_dedupe_uk unique (agent_type, dedupe_key),
  constraint ops_agent_run_type_ck check (agent_type ~ '^[A-Z][A-Z0-9_]+$'),
  constraint ops_agent_run_trigger_ck check (trigger_type in ('SCHEDULE', 'USER', 'EVENT', 'RETRY')),
  constraint ops_agent_run_dedupe_ck check (btrim(dedupe_key) <> ''),
  constraint ops_agent_run_model_ck check (btrim(model_version) <> ''),
  constraint ops_agent_run_prompt_ck check (btrim(prompt_version) <> ''),
  constraint ops_agent_run_status_ck check (status in (
    'PENDING', 'RUNNING', 'AWAITING_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RETRY', 'DEAD'
  )),
  constraint ops_agent_run_attempt_ck check (attempt_count >= 0),
  constraint ops_agent_run_lease_ck check (
    (status = 'RUNNING' and claimed_by is not null and lease_until is not null and started_at is not null)
    or (status <> 'RUNNING' and lease_until is null)
  ),
  constraint ops_agent_run_finished_ck check (
    (status in ('SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD') and finished_at is not null)
    or (status not in ('SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD') and finished_at is null)
  )
);

comment on table public.ops_agent_run is
  'One idempotent Agent execution with model, prompt, lease and lifecycle state; it never replaces source business facts.';

create index ops_agent_run_requested_by_idx
  on public.ops_agent_run (requested_by_user_id, created_at desc)
  where requested_by_user_id is not null;
create index ops_agent_run_claim_idx
  on public.ops_agent_run (priority, scheduled_for, created_at)
  where status in ('PENDING', 'RETRY');
create index ops_agent_run_lease_idx
  on public.ops_agent_run (lease_until)
  where status = 'RUNNING';

create table public.ops_agent_event (
  agent_event_id bigint generated always as identity primary key,
  agent_run_id uuid not null references public.ops_agent_run(agent_run_id) on delete restrict,
  event_type text not null,
  schema_version text not null,
  actor_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ops_agent_event_idempotency_uk unique (agent_run_id, idempotency_key),
  constraint ops_agent_event_type_ck check (event_type ~ '^[A-Z][A-Z0-9_]+$'),
  constraint ops_agent_event_schema_ck check (btrim(schema_version) <> ''),
  constraint ops_agent_event_actor_ck check (actor_type in ('USER', 'AGENT', 'WORKER', 'SYSTEM')),
  constraint ops_agent_event_actor_user_ck check (
    (actor_type = 'USER' and actor_user_id is not null) or actor_type <> 'USER'
  ),
  constraint ops_agent_event_idempotency_ck check (btrim(idempotency_key) <> '')
);

comment on table public.ops_agent_event is
  'One immutable, append-only event in an Agent run, including approvals, actions, failures and feedback with idempotency.';

create index ops_agent_event_run_time_idx
  on public.ops_agent_event (agent_run_id, occurred_at, agent_event_id);
create index ops_agent_event_actor_user_idx
  on public.ops_agent_event (actor_user_id, occurred_at desc)
  where actor_user_id is not null;

alter table public.ops_agent_run enable row level security;
alter table public.ops_agent_event enable row level security;
