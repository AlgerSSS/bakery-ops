-- Permission-aware document ingestion and hybrid RAG storage.

create table public.ai_knowledge_space (
  space_id uuid primary key default gen_random_uuid(),
  space_code text not null unique,
  display_name text not null,
  bucket_id text not null,
  data_class text not null,
  rag_policy text not null,
  retention_days integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_knowledge_space_code_ck check (space_code ~ '^[a-z][a-z0-9_]+$'),
  constraint ai_knowledge_space_display_name_ck check (btrim(display_name) <> ''),
  constraint ai_knowledge_space_bucket_ck check (bucket_id in (
    'kb-internal',
    'hr-recruiting-private',
    'hr-payroll-private',
    'finance-private',
    'legal-private'
  )),
  constraint ai_knowledge_space_bucket_uk unique (space_id, bucket_id),
  constraint ai_knowledge_space_data_class_ck check (data_class in ('C1', 'C2', 'C3', 'C4')),
  constraint ai_knowledge_space_rag_policy_ck check (rag_policy in ('AUTO', 'REDACTED_ONLY', 'DENY')),
  constraint ai_knowledge_space_retention_ck check (retention_days is null or retention_days > 0)
);

comment on table public.ai_knowledge_space is
  'One permission, Storage bucket, classification and retention boundary for knowledge documents; administered only through controlled services.';

create index ai_knowledge_space_bucket_idx on public.ai_knowledge_space (bucket_id);

create table public.ai_space_member (
  space_id uuid not null references public.ai_knowledge_space(space_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (space_id, user_id),
  constraint ai_space_member_role_ck check (role in ('VIEWER', 'EDITOR', 'INGESTOR', 'ADMIN'))
);

comment on table public.ai_space_member is
  'One explicit user membership in one knowledge space; the sole human authorization source for RAG access.';

create index ai_space_member_user_idx on public.ai_space_member (user_id, space_id);
create index ai_space_member_created_by_idx on public.ai_space_member (created_by)
  where created_by is not null;

create table public.ai_raw_document (
  document_id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.ai_knowledge_space(space_id) on delete restrict,
  raw_object_id uuid not null unique references public.ops_raw_object(raw_object_id) on delete restrict,
  document_key text not null,
  version_no integer not null,
  title text not null,
  document_type text not null,
  data_class text not null,
  rag_eligibility text not null,
  status text not null default 'REGISTERED',
  is_current boolean not null default false,
  page_count integer,
  published_ingest_run_id bigint,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint ai_raw_document_logic_version_uk unique (space_id, document_key, version_no),
  constraint ai_raw_document_key_ck check (document_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]+$'),
  constraint ai_raw_document_version_ck check (version_no > 0),
  constraint ai_raw_document_title_ck check (btrim(title) <> ''),
  constraint ai_raw_document_type_ck check (document_type ~ '^[A-Z][A-Z0-9_]+$'),
  constraint ai_raw_document_data_class_ck check (data_class in ('C1', 'C2', 'C3', 'C4')),
  constraint ai_raw_document_eligibility_ck check (
    rag_eligibility in ('ALLOWED', 'REDACTED_ONLY', 'DENIED', 'REVIEW_REQUIRED')
  ),
  constraint ai_raw_document_status_ck check (status in (
    'REGISTERED', 'QUEUED', 'PROCESSING', 'REVIEW_REQUIRED', 'READY', 'FAILED', 'SUPERSEDED'
  )),
  constraint ai_raw_document_page_count_ck check (page_count is null or page_count > 0),
  constraint ai_raw_document_denied_publish_ck check (
    rag_eligibility <> 'DENIED' or published_ingest_run_id is null
  ),
  constraint ai_raw_document_ready_ck check (
    (status = 'READY' and is_current and published_ingest_run_id is not null and published_at is not null)
    or status <> 'READY'
  )
);

comment on table public.ai_raw_document is
  'One immutable logical document version linked to one raw Storage object; publication selects exactly one current searchable version.';

create unique index ai_raw_document_current_uk
  on public.ai_raw_document (space_id, document_key)
  where is_current;
create index ai_raw_document_space_status_idx
  on public.ai_raw_document (space_id, status, created_at desc);

create table public.ai_ingest_run (
  ingest_run_id bigint generated always as identity primary key,
  document_id uuid not null references public.ai_raw_document(document_id) on delete restrict,
  pipeline_version text not null,
  embedding_model text not null,
  status text not null default 'PENDING',
  stage text not null default 'DOWNLOAD',
  priority smallint not null default 100,
  attempt_count integer not null default 0,
  scheduled_for timestamptz not null default now(),
  claimed_by text,
  lease_until timestamptz,
  chunk_count integer not null default 0,
  embedding_count integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  error_code text,
  error_summary text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint ai_ingest_run_logic_uk unique (document_id, pipeline_version),
  constraint ai_ingest_run_pipeline_ck check (btrim(pipeline_version) <> ''),
  constraint ai_ingest_run_model_ck check (btrim(embedding_model) <> ''),
  constraint ai_ingest_run_status_ck check (status in (
    'PENDING', 'RUNNING', 'SUCCEEDED', 'REVIEW_REQUIRED', 'RETRY', 'FAILED', 'DEAD'
  )),
  constraint ai_ingest_run_stage_ck check (stage in (
    'DOWNLOAD', 'OCR', 'PARSE', 'CHUNK', 'EMBED', 'VALIDATE', 'PUBLISH'
  )),
  constraint ai_ingest_run_attempt_ck check (attempt_count >= 0),
  constraint ai_ingest_run_counts_ck check (chunk_count >= 0 and embedding_count >= 0),
  constraint ai_ingest_run_lease_ck check (
    (status = 'RUNNING' and claimed_by is not null and lease_until is not null and started_at is not null)
    or (status <> 'RUNNING' and lease_until is null)
  ),
  constraint ai_ingest_run_finished_ck check (
    (status in ('SUCCEEDED', 'REVIEW_REQUIRED', 'FAILED', 'DEAD') and finished_at is not null)
    or (status not in ('SUCCEEDED', 'REVIEW_REQUIRED', 'FAILED', 'DEAD') and finished_at is null)
  )
);

comment on table public.ai_ingest_run is
  'One logical OCR, parsing, chunking and embedding run for one immutable document version, including lease and retry state.';

create index ai_ingest_run_document_idx on public.ai_ingest_run (document_id);
create index ai_ingest_run_claim_idx
  on public.ai_ingest_run (priority, scheduled_for, ingest_run_id)
  where status in ('PENDING', 'RETRY');
create index ai_ingest_run_lease_idx
  on public.ai_ingest_run (lease_until)
  where status = 'RUNNING';

alter table public.ai_raw_document
  add constraint ai_raw_document_published_run_fk
  foreign key (published_ingest_run_id)
  references public.ai_ingest_run(ingest_run_id)
  on delete restrict
  deferrable initially deferred;

create index ai_raw_document_published_run_idx
  on public.ai_raw_document (published_ingest_run_id)
  where published_ingest_run_id is not null;

create table public.ai_document_chunk (
  chunk_id bigint generated always as identity primary key,
  document_id uuid not null references public.ai_raw_document(document_id) on delete restrict,
  ingest_run_id bigint not null references public.ai_ingest_run(ingest_run_id) on delete cascade,
  chunk_no integer not null,
  page_from integer,
  page_to integer,
  section_path text[] not null default '{}'::text[],
  content text not null,
  content_sha256 character(64) not null,
  token_count integer not null,
  is_redacted boolean not null default false,
  search_vector tsvector generated always as (to_tsvector('simple', content)) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_document_chunk_run_no_uk unique (ingest_run_id, chunk_no),
  constraint ai_document_chunk_no_ck check (chunk_no >= 0),
  constraint ai_document_chunk_pages_ck check (
    (page_from is null and page_to is null)
    or (page_from is not null and page_to is not null and page_from > 0 and page_to >= page_from)
  ),
  constraint ai_document_chunk_content_ck check (btrim(content) <> ''),
  constraint ai_document_chunk_sha_ck check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ai_document_chunk_token_ck check (token_count >= 0)
);

comment on table public.ai_document_chunk is
  'One citation-ready, policy-approved text chunk for one ingest run; unpublished runs remain invisible to search.';

create index ai_document_chunk_document_run_idx
  on public.ai_document_chunk (document_id, ingest_run_id);
create index ai_document_chunk_search_idx
  on public.ai_document_chunk using gin (search_vector);

create table public.ai_chunk_embedding (
  chunk_id bigint not null references public.ai_document_chunk(chunk_id) on delete cascade,
  model_version text not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  primary key (chunk_id, model_version),
  constraint ai_chunk_embedding_model_ck check (btrim(model_version) <> '')
);

comment on table public.ai_chunk_embedding is
  'One 1536-dimensional embedding for one document chunk and frozen model version; exact scan is the initial retrieval strategy.';

create index ai_chunk_embedding_model_idx on public.ai_chunk_embedding (model_version, chunk_id);

alter table public.ai_knowledge_space enable row level security;
alter table public.ai_space_member enable row level security;
alter table public.ai_raw_document enable row level security;
alter table public.ai_ingest_run enable row level security;
alter table public.ai_document_chunk enable row level security;
alter table public.ai_chunk_embedding enable row level security;
