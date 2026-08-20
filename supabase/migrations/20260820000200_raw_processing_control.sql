-- Raw evidence and structured-processing control plane.

create table public.ops_raw_batch (
  batch_id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_batch_key text not null,
  store_id text,
  schema_version text not null,
  status text not null default 'RECEIVING',
  watermark_from timestamptz,
  watermark_to timestamptz,
  expected_count bigint,
  accepted_count bigint not null default 0,
  rejected_count bigint not null default 0,
  writer_id text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb,
  constraint ops_raw_batch_source_key_uk
    unique (source_system, source_batch_key, schema_version),
  constraint ops_raw_batch_source_system_ck
    check (source_system = upper(source_system) and source_system ~ '^[A-Z0-9_]+$'),
  constraint ops_raw_batch_schema_version_ck check (btrim(schema_version) <> ''),
  constraint ops_raw_batch_writer_id_ck check (btrim(writer_id) <> ''),
  constraint ops_raw_batch_status_ck
    check (status in ('RECEIVING', 'READY', 'FAILED', 'QUARANTINED')),
  constraint ops_raw_batch_counts_ck check (
    (expected_count is null or expected_count >= 0)
    and accepted_count >= 0
    and rejected_count >= 0
  ),
  constraint ops_raw_batch_watermark_ck
    check (watermark_from is null or watermark_to is null or watermark_to >= watermark_from),
  constraint ops_raw_batch_completion_ck check (
    (status = 'RECEIVING' and completed_at is null)
    or (status <> 'RECEIVING' and completed_at is not null)
  )
);

comment on table public.ops_raw_batch is
  'One row per source ingestion batch at source granularity; written only through ingestion control RPCs.';

create index ops_raw_batch_source_started_idx
  on public.ops_raw_batch (source_system, started_at desc);
create index ops_raw_batch_open_idx
  on public.ops_raw_batch (started_at)
  where status in ('RECEIVING', 'FAILED');

create table public.ops_raw_object (
  raw_object_id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ops_raw_batch(batch_id) on delete restrict,
  bucket_id text not null,
  object_path text not null,
  sha256 character(64) not null,
  size_bytes bigint not null,
  mime_type text not null,
  data_class text not null,
  source_record_key text,
  source_version text,
  created_at timestamptz not null default now(),
  constraint ops_raw_object_bucket_path_uk unique (bucket_id, object_path),
  constraint ops_raw_object_bucket_ck check (bucket_id in (
    'raw-business-private',
    'kb-internal',
    'hr-recruiting-private',
    'hr-payroll-private',
    'finance-private',
    'legal-private'
  )),
  constraint ops_raw_object_path_ck check (
    btrim(object_path) <> ''
    and object_path !~ '(^|/)\.\.(/|$)'
    and object_path !~ '^/'
  ),
  constraint ops_raw_object_sha256_ck check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint ops_raw_object_size_ck check (size_bytes >= 0),
  constraint ops_raw_object_mime_ck check (btrim(mime_type) <> ''),
  constraint ops_raw_object_data_class_ck check (data_class in ('C1', 'C2', 'C3', 'C4'))
);

comment on table public.ops_raw_object is
  'One row per immutable source object in a private Storage bucket; metadata only, never the binary payload.';

create index ops_raw_object_batch_idx on public.ops_raw_object (batch_id);
create index ops_raw_object_sha256_idx on public.ops_raw_object (sha256);

create table public.ops_processing_run (
  processing_run_id bigint generated always as identity primary key,
  batch_id uuid not null references public.ops_raw_batch(batch_id) on delete restrict,
  pipeline_key text not null,
  pipeline_version text not null,
  status text not null default 'PENDING',
  priority smallint not null default 100,
  attempt_count integer not null default 0,
  scheduled_for timestamptz not null default now(),
  claimed_by text,
  lease_until timestamptz,
  input_watermark jsonb not null default '{}'::jsonb,
  output_watermark jsonb not null default '{}'::jsonb,
  rows_read bigint not null default 0,
  rows_written bigint not null default 0,
  rows_rejected bigint not null default 0,
  error_code text,
  error_summary text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint ops_processing_run_logic_uk
    unique (batch_id, pipeline_key, pipeline_version),
  constraint ops_processing_run_pipeline_key_ck
    check (pipeline_key ~ '^[a-z][a-z0-9_]+$'),
  constraint ops_processing_run_pipeline_version_ck check (btrim(pipeline_version) <> ''),
  constraint ops_processing_run_status_ck check (status in (
    'PENDING', 'RUNNING', 'SUCCEEDED', 'REVIEW_REQUIRED', 'RETRY', 'FAILED', 'DEAD'
  )),
  constraint ops_processing_run_attempt_ck check (attempt_count >= 0),
  constraint ops_processing_run_counts_ck check (
    rows_read >= 0 and rows_written >= 0 and rows_rejected >= 0
  ),
  constraint ops_processing_run_lease_ck check (
    (status = 'RUNNING' and claimed_by is not null and lease_until is not null and started_at is not null)
    or (status <> 'RUNNING' and lease_until is null)
  ),
  constraint ops_processing_run_finished_ck check (
    (status in ('SUCCEEDED', 'REVIEW_REQUIRED', 'FAILED', 'DEAD') and finished_at is not null)
    or (status not in ('SUCCEEDED', 'REVIEW_REQUIRED', 'FAILED', 'DEAD') and finished_at is null)
  )
);

comment on table public.ops_processing_run is
  'One logical run per raw batch and processor version; owns leases, retries and output watermarks for structured processing.';

create index ops_processing_run_batch_idx on public.ops_processing_run (batch_id);
create index ops_processing_run_claim_idx
  on public.ops_processing_run (priority, scheduled_for, processing_run_id)
  where status in ('PENDING', 'RETRY');
create index ops_processing_run_lease_idx
  on public.ops_processing_run (lease_until)
  where status = 'RUNNING';
create index ops_processing_run_pipeline_created_idx
  on public.ops_processing_run (pipeline_key, created_at desc);

create table public.pipeline_health (
  source_key text primary key,
  last_run_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  status text not null default 'unknown',
  rows_imported bigint not null default 0,
  pending_count bigint not null default 0,
  oldest_pending_at timestamptz,
  lag_seconds bigint,
  error text,
  updated_at timestamptz not null default now(),
  constraint pipeline_health_status_ck
    check (status in ('success', 'error', 'running', 'unknown', 'stale', 'degraded')),
  constraint pipeline_health_counts_ck
    check (rows_imported >= 0 and pending_count >= 0 and (lag_seconds is null or lag_seconds >= 0))
);

comment on table public.pipeline_health is
  'One rollup row per pipeline key; monitoring summary only, written by the health rollup and never used as a work queue.';

alter table public.ops_raw_batch enable row level security;
alter table public.ops_raw_object enable row level security;
alter table public.ops_processing_run enable row level security;
alter table public.pipeline_health enable row level security;
