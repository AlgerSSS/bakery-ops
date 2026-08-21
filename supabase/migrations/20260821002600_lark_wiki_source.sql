-- Allowlisted Lark Wiki source inventory and recurring sync control plane.
-- The source app is a read-only member of each team Wiki space; credentials
-- remain outside Postgres and are supplied to the Tokyo worker by systemd.

update storage.buckets
set allowed_mime_types = array['application/pdf', 'application/json']
where id in (
  'kb-internal',
  'kb-restricted',
  'hr-recruiting-private',
  'hr-payroll-private',
  'finance-private',
  'legal-private'
);

create table public.ai_source_connector (
  connector_id uuid primary key default gen_random_uuid(),
  source_system text not null,
  external_space_id text not null,
  display_name text not null,
  knowledge_space_id uuid not null references public.ai_knowledge_space(space_id) on delete restrict,
  sync_enabled boolean not null default true,
  max_file_size_bytes bigint not null default 104857600,
  config jsonb not null default '{}'::jsonb,
  last_attempt_at timestamptz,
  last_successful_scan_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_source_connector_external_uk unique (source_system, external_space_id),
  constraint ai_source_connector_system_ck check (source_system = 'LARK_WIKI'),
  constraint ai_source_connector_external_ck check (external_space_id ~ '^[0-9]{10,30}$'),
  constraint ai_source_connector_name_ck check (btrim(display_name) <> ''),
  constraint ai_source_connector_size_ck check (
    max_file_size_bytes > 0 and max_file_size_bytes <= 104857600
  ),
  constraint ai_source_connector_config_ck check (jsonb_typeof(config) = 'object')
);

comment on table public.ai_source_connector is
  'One allowlisted external Lark Wiki team space mapped to exactly one Supabase knowledge security boundary; the Tokyo sync service writes, credentials are never stored here.';

create index ai_source_connector_space_idx
  on public.ai_source_connector (knowledge_space_id, sync_enabled);

create trigger ai_source_connector_set_updated_at
before update on public.ai_source_connector
for each row execute function private.set_updated_at();

create table public.ai_source_sync_run (
  sync_run_id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references public.ai_source_connector(connector_id) on delete restrict,
  worker_id text not null,
  status text not null default 'RUNNING',
  counts jsonb not null default '{}'::jsonb,
  error_summary text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint ai_source_sync_run_worker_ck check (btrim(worker_id) <> ''),
  constraint ai_source_sync_run_status_ck check (
    status in ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')
  ),
  constraint ai_source_sync_run_counts_ck check (jsonb_typeof(counts) = 'object'),
  constraint ai_source_sync_run_finished_ck check (
    (status = 'RUNNING' and finished_at is null)
    or (status <> 'RUNNING' and finished_at is not null)
  )
);

comment on table public.ai_source_sync_run is
  'One bounded traversal of one allowlisted Lark Wiki space, including completion state and aggregate discovery/ingestion counts.';

create unique index ai_source_sync_run_active_uk
  on public.ai_source_sync_run (connector_id)
  where status = 'RUNNING';
create index ai_source_sync_run_connector_started_idx
  on public.ai_source_sync_run (connector_id, started_at desc);

create table public.ai_source_item (
  source_item_id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references public.ai_source_connector(connector_id) on delete restrict,
  external_node_token text not null,
  external_object_token text not null,
  object_type text not null,
  title text not null,
  source_uri text not null,
  source_revision text,
  source_sha256 character(64),
  current_document_id uuid references public.ai_raw_document(document_id) on delete restrict,
  status text not null,
  last_seen_sync_run_id uuid not null references public.ai_source_sync_run(sync_run_id) on delete restrict,
  missing_scan_count integer not null default 0,
  last_seen_at timestamptz not null default now(),
  last_ingested_at timestamptz,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_source_item_node_uk unique (connector_id, external_node_token),
  constraint ai_source_item_node_ck check (external_node_token ~ '^[A-Za-z0-9_-]+$'),
  constraint ai_source_item_object_ck check (external_object_token ~ '^[A-Za-z0-9_-]+$'),
  constraint ai_source_item_type_ck check (object_type ~ '^[a-z][a-z0-9_]*$'),
  constraint ai_source_item_title_ck check (length(title) <= 500),
  constraint ai_source_item_uri_ck check (source_uri ~ '^https://'),
  constraint ai_source_item_sha_ck check (
    source_sha256 is null or btrim(source_sha256) ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_source_item_status_ck check (
    status in ('SYNCED', 'REVIEW_REQUIRED', 'UNSUPPORTED', 'FAILED', 'MISSING')
  ),
  constraint ai_source_item_missing_ck check (missing_scan_count >= 0),
  constraint ai_source_item_metadata_ck check (jsonb_typeof(metadata) = 'object'),
  constraint ai_source_item_ingested_ck check (
    (status in ('SYNCED', 'REVIEW_REQUIRED')
      and current_document_id is not null
      and source_revision is not null
      and source_sha256 is not null
      and last_ingested_at is not null)
    or status not in ('SYNCED', 'REVIEW_REQUIRED')
  )
);

comment on table public.ai_source_item is
  'One discovered Lark Wiki node with its latest source revision/hash, linked immutable RAG document, unsupported/failure state, and two-scan missing reconciliation counter.';

create index ai_source_item_document_idx
  on public.ai_source_item (current_document_id)
  where current_document_id is not null;
create index ai_source_item_scan_idx
  on public.ai_source_item (connector_id, last_seen_sync_run_id);
create index ai_source_item_status_idx
  on public.ai_source_item (connector_id, status, updated_at desc);

create trigger ai_source_item_set_updated_at
before update on public.ai_source_item
for each row execute function private.set_updated_at();

alter table public.ai_source_connector enable row level security;
alter table public.ai_source_sync_run enable row level security;
alter table public.ai_source_item enable row level security;

insert into public.ai_source_connector (
  connector_id,
  source_system,
  external_space_id,
  display_name,
  knowledge_space_id,
  config
)
values
  ('20000000-0000-7000-8000-000000000001', 'LARK_WIKI', '7657065348520250907', '公共',
    '10000000-0000-7000-8000-000000000001', '{"supported_types":["docx","pdf"],"missing_scans_before_unpublish":2}'),
  ('20000000-0000-7000-8000-000000000002', 'LARK_WIKI', '7657070111534091800', '营运部',
    '10000000-0000-7000-8000-000000000001', '{"supported_types":["docx","pdf"],"missing_scans_before_unpublish":2}'),
  ('20000000-0000-7000-8000-000000000003', 'LARK_WIKI', '7657070048464342551', '市场部',
    '10000000-0000-7000-8000-000000000001', '{"supported_types":["docx","pdf"],"missing_scans_before_unpublish":2}'),
  ('20000000-0000-7000-8000-000000000004', 'LARK_WIKI', '7657070081020546584', '供应链部',
    '10000000-0000-7000-8000-000000000006', '{"supported_types":["docx","pdf"],"missing_scans_before_unpublish":2}'),
  ('20000000-0000-7000-8000-000000000005', 'LARK_WIKI', '7657071425748012568', '人事部',
    '10000000-0000-7000-8000-000000000007', '{"supported_types":["docx","pdf"],"missing_scans_before_unpublish":2}'),
  ('20000000-0000-7000-8000-000000000006', 'LARK_WIKI', '7657071455368154647', '财务部',
    '10000000-0000-7000-8000-000000000004', '{"supported_types":["docx","pdf"],"missing_scans_before_unpublish":2}'),
  ('20000000-0000-7000-8000-000000000007', 'LARK_WIKI', '7657793097069235739', '法务',
    '10000000-0000-7000-8000-000000000005', '{"supported_types":["docx","pdf"],"missing_scans_before_unpublish":2}'),
  ('20000000-0000-7000-8000-000000000008', 'LARK_WIKI', '7657065362898292252', '总经办',
    '10000000-0000-7000-8000-000000000006', '{"supported_types":["docx","pdf"],"missing_scans_before_unpublish":2}')
on conflict (source_system, external_space_id) do update
set display_name = excluded.display_name,
    knowledge_space_id = excluded.knowledge_space_id,
    sync_enabled = true,
    max_file_size_bytes = excluded.max_file_size_bytes,
    config = excluded.config;

create or replace function public.ai_list_source_connectors()
returns table (
  connector_id uuid,
  external_space_id text,
  display_name text,
  knowledge_space_id uuid,
  bucket_id text,
  data_class text,
  rag_policy text,
  max_file_size_bytes bigint,
  config jsonb
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
  select connector.connector_id,
         connector.external_space_id,
         connector.display_name,
         connector.knowledge_space_id,
         space.bucket_id,
         space.data_class,
         space.rag_policy,
         connector.max_file_size_bytes,
         connector.config
  from public.ai_source_connector as connector
  join public.ai_knowledge_space as space
    on space.space_id = connector.knowledge_space_id
   and space.is_active
  where connector.source_system = 'LARK_WIKI'
    and connector.sync_enabled
  order by connector.display_name, connector.connector_id;
$$;

comment on function public.ai_list_source_connectors() is
  'Returns only enabled allowlisted Lark Wiki connectors plus their authoritative Supabase classification and Storage boundary.';

create or replace function public.ai_begin_source_sync(
  p_connector_id uuid,
  p_worker_id text
)
returns public.ai_source_sync_run
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_run public.ai_source_sync_run%rowtype;
begin
  if btrim(coalesce(p_worker_id, '')) = '' then
    raise exception 'source sync worker id is required' using errcode = '22023';
  end if;

  perform connector_id
  from public.ai_source_connector
  where connector_id = p_connector_id
    and sync_enabled
  for update;
  if not found then
    raise exception 'source connector is missing or disabled' using errcode = 'P0002';
  end if;

  update public.ai_source_sync_run
  set status = 'FAILED',
      finished_at = now(),
      error_summary = 'stale RUNNING sync recovered by a new worker'
  where connector_id = p_connector_id
    and status = 'RUNNING'
    and started_at < now() - interval '2 hours';

  insert into public.ai_source_sync_run (connector_id, worker_id)
  values (p_connector_id, left(p_worker_id, 200))
  returning * into v_run;

  update public.ai_source_connector
  set last_attempt_at = now()
  where connector_id = p_connector_id;

  return v_run;
end;
$$;

comment on function public.ai_begin_source_sync(uuid, text) is
  'Starts one exclusive bounded Lark Wiki traversal, recovering only a RUNNING scan older than two hours.';

create or replace function public.ai_record_source_item(
  p_sync_run_id uuid,
  p_external_node_token text,
  p_external_object_token text,
  p_object_type text,
  p_title text,
  p_source_uri text,
  p_source_revision text,
  p_source_sha256 text,
  p_document_id uuid,
  p_status text,
  p_error_summary text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.ai_source_item
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_run public.ai_source_sync_run%rowtype;
  v_item public.ai_source_item%rowtype;
  v_document_space_id uuid;
  v_document_sha text;
  v_source_record_key text;
begin
  select * into strict v_run
  from public.ai_source_sync_run
  where sync_run_id = p_sync_run_id
  for update;

  if v_run.status <> 'RUNNING' then
    raise exception 'source item can only be recorded into a RUNNING sync' using errcode = '55000';
  end if;
  if p_status not in ('SYNCED', 'REVIEW_REQUIRED', 'UNSUPPORTED', 'FAILED') then
    raise exception 'invalid source item status' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'source item metadata must be an object' using errcode = '22023';
  end if;
  if p_status in ('SYNCED', 'REVIEW_REQUIRED')
     and (p_document_id is null or p_source_revision is null or p_source_sha256 is null) then
    raise exception 'ingested source items require document, revision and SHA-256'
      using errcode = '23514';
  end if;

  if p_document_id is not null then
    select document.space_id, btrim(raw_object.sha256), raw_object.source_record_key
      into strict v_document_space_id, v_document_sha, v_source_record_key
    from public.ai_raw_document as document
    join public.ops_raw_object as raw_object
      on raw_object.raw_object_id = document.raw_object_id
    where document.document_id = p_document_id;

    if not exists (
      select 1
      from public.ai_source_connector as connector
      where connector.connector_id = v_run.connector_id
        and connector.knowledge_space_id = v_document_space_id
    ) or v_document_sha <> p_source_sha256
       or v_source_record_key <> p_external_node_token then
      raise exception 'source document does not match connector, node or SHA-256'
        using errcode = '23514';
    end if;
  end if;

  insert into public.ai_source_item (
    connector_id,
    external_node_token,
    external_object_token,
    object_type,
    title,
    source_uri,
    source_revision,
    source_sha256,
    current_document_id,
    status,
    last_seen_sync_run_id,
    missing_scan_count,
    last_seen_at,
    last_ingested_at,
    error_summary,
    metadata
  )
  values (
    v_run.connector_id,
    p_external_node_token,
    p_external_object_token,
    p_object_type,
    left(coalesce(p_title, ''), 500),
    p_source_uri,
    p_source_revision,
    p_source_sha256::character(64),
    p_document_id,
    p_status,
    p_sync_run_id,
    0,
    now(),
    case when p_document_id is not null then now() else null end,
    nullif(left(coalesce(p_error_summary, ''), 2000), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (connector_id, external_node_token) do update
  set external_object_token = excluded.external_object_token,
      object_type = excluded.object_type,
      title = excluded.title,
      source_uri = excluded.source_uri,
      source_revision = coalesce(excluded.source_revision, ai_source_item.source_revision),
      source_sha256 = coalesce(excluded.source_sha256, ai_source_item.source_sha256),
      current_document_id = coalesce(excluded.current_document_id, ai_source_item.current_document_id),
      status = excluded.status,
      last_seen_sync_run_id = excluded.last_seen_sync_run_id,
      missing_scan_count = 0,
      last_seen_at = now(),
      last_ingested_at = case
        when excluded.current_document_id is not null then now()
        else ai_source_item.last_ingested_at
      end,
      error_summary = excluded.error_summary,
      metadata = excluded.metadata
  returning * into v_item;

  if p_status = 'UNSUPPORTED' and v_item.current_document_id is not null
     and exists (
       select 1 from public.ai_raw_document
       where document_id = v_item.current_document_id and status = 'READY' and is_current
     ) then
    perform public.ai_unpublish_document(
      v_item.current_document_id,
      'Lark source changed to an unsupported object type',
      'hotcrush-lark-wiki-sync'
    );
  end if;

  return v_item;
end;
$$;

comment on function public.ai_record_source_item(uuid, text, text, text, text, text, text, text, uuid, text, text, jsonb) is
  'Upserts one node observed in a RUNNING Lark scan, verifies any document against connector/Raw SHA, and fails closed on unsupported source-type changes.';

create or replace function public.ai_finish_source_sync(
  p_sync_run_id uuid,
  p_status text,
  p_counts jsonb default '{}'::jsonb,
  p_error_summary text default null
)
returns public.ai_source_sync_run
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_run public.ai_source_sync_run%rowtype;
  v_item record;
  v_count_value text;
begin
  if p_status not in ('SUCCEEDED', 'PARTIAL', 'FAILED') then
    raise exception 'invalid terminal source sync status' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_counts, '{}'::jsonb)) <> 'object' then
    raise exception 'source sync counts must be an object' using errcode = '22023';
  end if;
  foreach v_count_value in array array[
    coalesce(p_counts ->> 'discovered', '0'),
    coalesce(p_counts ->> 'synced', '0'),
    coalesce(p_counts ->> 'unchanged', '0'),
    coalesce(p_counts ->> 'unsupported', '0'),
    coalesce(p_counts ->> 'failed', '0')
  ]
  loop
    if v_count_value !~ '^[0-9]+$' then
      raise exception 'source sync counts must be nonnegative integers' using errcode = '22023';
    end if;
  end loop;

  select * into strict v_run
  from public.ai_source_sync_run
  where sync_run_id = p_sync_run_id
  for update;
  if v_run.status <> 'RUNNING' then
    raise exception 'only a RUNNING source sync can finish' using errcode = '55000';
  end if;

  if p_status in ('SUCCEEDED', 'PARTIAL') then
    for v_item in
      update public.ai_source_item
      set missing_scan_count = missing_scan_count + 1,
          status = case when missing_scan_count + 1 >= 2 then 'MISSING' else status end,
          error_summary = case
            when missing_scan_count + 1 >= 2 then 'not seen in two consecutive complete source scans'
            else error_summary
          end
      where connector_id = v_run.connector_id
        and last_seen_sync_run_id <> p_sync_run_id
      returning current_document_id, missing_scan_count
    loop
      if v_item.missing_scan_count >= 2
         and v_item.current_document_id is not null
         and exists (
           select 1 from public.ai_raw_document
           where document_id = v_item.current_document_id and status = 'READY' and is_current
         ) then
        perform public.ai_unpublish_document(
          v_item.current_document_id,
          'Lark source missing from two consecutive complete scans',
          'hotcrush-lark-wiki-sync'
        );
      end if;
    end loop;
  end if;

  update public.ai_source_sync_run
  set status = p_status,
      counts = coalesce(p_counts, '{}'::jsonb),
      error_summary = nullif(left(coalesce(p_error_summary, ''), 2000), ''),
      finished_at = now()
  where sync_run_id = p_sync_run_id
  returning * into v_run;

  update public.ai_source_connector
  set last_successful_scan_at = case
        when p_status in ('SUCCEEDED', 'PARTIAL') then now()
        else last_successful_scan_at
      end,
      last_error = case
        when p_status = 'SUCCEEDED' then null
        when p_status = 'PARTIAL' then 'one or more discovered source items failed'
        else nullif(left(coalesce(p_error_summary, ''), 2000), '')
      end
  where connector_id = v_run.connector_id;

  return v_run;
end;
$$;

comment on function public.ai_finish_source_sync(uuid, text, jsonb, text) is
  'Finishes a Lark traversal and, only after two consecutive complete scans miss an item, marks it missing and reversibly unpublishes its current RAG document.';

revoke all on table public.ai_source_connector,
                    public.ai_source_sync_run,
                    public.ai_source_item
from public, anon, authenticated, service_role;

revoke all on function public.ai_list_source_connectors(),
                       public.ai_begin_source_sync(uuid, text),
                       public.ai_record_source_item(uuid, text, text, text, text, text, text, text, uuid, text, text, jsonb),
                       public.ai_finish_source_sync(uuid, text, jsonb, text)
from public, anon, authenticated;

grant execute on function public.ai_list_source_connectors(),
                          public.ai_begin_source_sync(uuid, text),
                          public.ai_record_source_item(uuid, text, text, text, text, text, text, text, uuid, text, text, jsonb),
                          public.ai_finish_source_sync(uuid, text, jsonb, text)
to service_role, hc_ai_ingestor;
