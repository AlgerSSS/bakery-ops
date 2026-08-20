-- Controlled document registration, staged ingestion, publication and search RPCs.

create or replace function public.ai_finalize_document_upload(
  p_raw_object_id uuid,
  p_space_id uuid,
  p_document_key text,
  p_version_no integer,
  p_title text,
  p_document_type text,
  p_pipeline_version text,
  p_embedding_model text
)
returns public.ai_raw_document
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_object public.ops_raw_object%rowtype;
  v_batch_status text;
  v_space public.ai_knowledge_space%rowtype;
  v_document public.ai_raw_document%rowtype;
  v_eligibility text;
  v_status text;
  v_object_class_rank integer;
  v_space_class_rank integer;
begin
  select object.* into strict v_object
  from public.ops_raw_object as object
  where object.raw_object_id = p_raw_object_id;

  select status into strict v_batch_status
  from public.ops_raw_batch
  where batch_id = v_object.batch_id;

  if v_batch_status <> 'READY' then
    raise exception 'document raw batch must be READY before finalization' using errcode = '23514';
  end if;

  select * into strict v_space
  from public.ai_knowledge_space
  where space_id = p_space_id
    and is_active
  for share;

  if v_space.bucket_id <> v_object.bucket_id then
    raise exception 'raw object bucket does not match knowledge space' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from storage.objects
    where bucket_id = v_object.bucket_id and name = v_object.object_path
  ) then
    raise exception 'registered Storage object does not exist' using errcode = 'P0002';
  end if;

  v_object_class_rank := array_position(array['C1', 'C2', 'C3', 'C4'], v_object.data_class);
  v_space_class_rank := array_position(array['C1', 'C2', 'C3', 'C4'], v_space.data_class);
  if v_object_class_rank > v_space_class_rank then
    raise exception 'document classification exceeds knowledge-space boundary' using errcode = '42501';
  end if;

  if v_object.data_class = 'C4' or v_space.rag_policy = 'DENY' then
    v_eligibility := 'DENIED';
    v_status := 'REVIEW_REQUIRED';
  elsif v_object.data_class = 'C3' or v_space.rag_policy = 'REDACTED_ONLY' then
    v_eligibility := 'REDACTED_ONLY';
    v_status := 'REVIEW_REQUIRED';
  elsif v_space.rag_policy = 'AUTO' and v_object.data_class in ('C1', 'C2') then
    v_eligibility := 'ALLOWED';
    v_status := 'QUEUED';
  else
    v_eligibility := 'REVIEW_REQUIRED';
    v_status := 'REVIEW_REQUIRED';
  end if;

  insert into public.ai_raw_document (
    space_id,
    raw_object_id,
    document_key,
    version_no,
    title,
    document_type,
    data_class,
    rag_eligibility,
    status
  )
  values (
    p_space_id,
    p_raw_object_id,
    p_document_key,
    p_version_no,
    p_title,
    p_document_type,
    v_object.data_class,
    v_eligibility,
    v_status
  )
  on conflict (space_id, document_key, version_no) do nothing
  returning * into v_document;

  if not found then
    select * into strict v_document
    from public.ai_raw_document
    where space_id = p_space_id
      and document_key = p_document_key
      and version_no = p_version_no;

    if v_document.raw_object_id <> p_raw_object_id
       or v_document.title <> p_title
       or v_document.document_type <> p_document_type
       or v_document.data_class <> v_object.data_class then
      raise exception 'document version already exists with different immutable attributes'
        using errcode = '23505';
    end if;
  end if;

  if v_document.status = 'QUEUED' then
    insert into public.ai_ingest_run (
      document_id,
      pipeline_version,
      embedding_model
    )
    values (
      v_document.document_id,
      p_pipeline_version,
      p_embedding_model
    )
    on conflict (document_id, pipeline_version) do nothing;
  end if;

  return v_document;
end;
$$;

comment on function public.ai_finalize_document_upload(uuid, uuid, text, integer, text, text, text, text) is
  'Finalizes a registered private Storage object into an immutable document and queues only policy-eligible C1/C2 content.';

create or replace function public.ai_claim_ingest_run(
  p_worker_id text,
  p_lease_seconds integer default 600
)
returns table (
  ingest_run_id bigint,
  document_id uuid,
  pipeline_version text,
  embedding_model text,
  attempt_count integer,
  lease_until timestamptz,
  bucket_id text,
  object_path text,
  sha256 character(64),
  data_class text,
  rag_eligibility text
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_run public.ai_ingest_run%rowtype;
begin
  if btrim(p_worker_id) = '' or p_lease_seconds < 60 or p_lease_seconds > 3600 then
    raise exception 'invalid worker id or lease duration' using errcode = '22023';
  end if;

  with candidate as (
    select run.ingest_run_id
    from public.ai_ingest_run as run
    join public.ai_raw_document as document on document.document_id = run.document_id
    where run.status in ('PENDING', 'RETRY')
      and run.scheduled_for <= now()
      and document.rag_eligibility in ('ALLOWED', 'REDACTED_ONLY')
      and document.status in ('QUEUED', 'PROCESSING')
    order by run.priority, run.scheduled_for, run.ingest_run_id
    for update of run skip locked
    limit 1
  )
  update public.ai_ingest_run as run
  set status = 'RUNNING',
      stage = 'DOWNLOAD',
      attempt_count = run.attempt_count + 1,
      claimed_by = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(run.started_at, now()),
      error_code = null,
      error_summary = null
  from candidate
  where run.ingest_run_id = candidate.ingest_run_id
  returning run.* into v_run;

  if v_run.ingest_run_id is null then
    return;
  end if;

  update public.ai_raw_document
  set status = 'PROCESSING'
  where ai_raw_document.document_id = v_run.document_id;

  return query
  select v_run.ingest_run_id,
         v_run.document_id,
         v_run.pipeline_version,
         v_run.embedding_model,
         v_run.attempt_count,
         v_run.lease_until,
         object.bucket_id,
         object.object_path,
         object.sha256,
         document.data_class,
         document.rag_eligibility
  from public.ai_raw_document as document
  join public.ops_raw_object as object on object.raw_object_id = document.raw_object_id
  where document.document_id = v_run.document_id;
end;
$$;

create or replace function public.ai_heartbeat_ingest_run(
  p_ingest_run_id bigint,
  p_worker_id text,
  p_stage text,
  p_lease_seconds integer default 600,
  p_metrics jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  if p_stage not in ('DOWNLOAD', 'OCR', 'PARSE', 'CHUNK', 'EMBED', 'VALIDATE', 'PUBLISH')
     or p_lease_seconds < 60 or p_lease_seconds > 3600 then
    raise exception 'invalid ingest stage or lease duration' using errcode = '22023';
  end if;

  update public.ai_ingest_run
  set stage = p_stage,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      metrics = metrics || coalesce(p_metrics, '{}'::jsonb)
  where ingest_run_id = p_ingest_run_id
    and status = 'RUNNING'
    and claimed_by = p_worker_id
    and lease_until > now();

  return found;
end;
$$;

create or replace function public.ai_stage_ingest_batch(
  p_ingest_run_id bigint,
  p_worker_id text,
  p_chunks jsonb,
  p_reset_existing boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_run public.ai_ingest_run%rowtype;
  v_item jsonb;
  v_chunk_id bigint;
  v_section_path text[];
  v_staged integer := 0;
begin
  if jsonb_typeof(p_chunks) <> 'array'
     or jsonb_array_length(p_chunks) < 1
     or jsonb_array_length(p_chunks) > 100 then
    raise exception 'chunk batch must contain between 1 and 100 entries' using errcode = '22023';
  end if;

  select * into strict v_run
  from public.ai_ingest_run
  where ingest_run_id = p_ingest_run_id
  for update;

  if v_run.status <> 'RUNNING'
     or v_run.claimed_by <> p_worker_id
     or v_run.lease_until <= now() then
    raise exception 'ingest run is not actively leased by this worker' using errcode = '55000';
  end if;

  if p_reset_existing then
    delete from public.ai_document_chunk where ingest_run_id = p_ingest_run_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_chunks)
  loop
    if jsonb_typeof(v_item -> 'embedding') <> 'array'
       or jsonb_array_length(v_item -> 'embedding') <> 1536 then
      raise exception 'each chunk embedding must have exactly 1536 dimensions'
        using errcode = '22023';
    end if;

    select coalesce(array_agg(path_part), '{}'::text[])
      into v_section_path
    from jsonb_array_elements_text(coalesce(v_item -> 'section_path', '[]'::jsonb)) as path(path_part);

    insert into public.ai_document_chunk (
      document_id,
      ingest_run_id,
      chunk_no,
      page_from,
      page_to,
      section_path,
      content,
      content_sha256,
      token_count,
      is_redacted,
      metadata
    )
    values (
      v_run.document_id,
      p_ingest_run_id,
      (v_item ->> 'chunk_no')::integer,
      (v_item ->> 'page_from')::integer,
      (v_item ->> 'page_to')::integer,
      v_section_path,
      v_item ->> 'content',
      (v_item ->> 'content_sha256')::character(64),
      (v_item ->> 'token_count')::integer,
      coalesce((v_item ->> 'is_redacted')::boolean, false),
      coalesce(v_item -> 'metadata', '{}'::jsonb)
    )
    on conflict (ingest_run_id, chunk_no) do update
    set page_from = excluded.page_from,
        page_to = excluded.page_to,
        section_path = excluded.section_path,
        content = excluded.content,
        content_sha256 = excluded.content_sha256,
        token_count = excluded.token_count,
        is_redacted = excluded.is_redacted,
        metadata = excluded.metadata
    returning chunk_id into v_chunk_id;

    insert into public.ai_chunk_embedding (chunk_id, model_version, embedding)
    values (
      v_chunk_id,
      v_run.embedding_model,
      ((v_item -> 'embedding')::text)::extensions.vector
    )
    on conflict (chunk_id, model_version) do update
    set embedding = excluded.embedding,
        created_at = now();

    v_staged := v_staged + 1;
  end loop;

  update public.ai_ingest_run
  set stage = 'EMBED',
      lease_until = greatest(lease_until, now() + interval '60 seconds')
  where ingest_run_id = p_ingest_run_id;

  return v_staged;
end;
$$;

create or replace function public.ai_publish_ingest_run(
  p_ingest_run_id bigint,
  p_worker_id text,
  p_page_count integer,
  p_expected_chunk_count integer,
  p_expected_embedding_count integer,
  p_metrics jsonb default '{}'::jsonb
)
returns public.ai_raw_document
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_run public.ai_ingest_run%rowtype;
  v_document public.ai_raw_document%rowtype;
  v_chunk_count integer;
  v_embedding_count integer;
begin
  select * into strict v_run
  from public.ai_ingest_run
  where ingest_run_id = p_ingest_run_id
  for update;

  select * into strict v_document
  from public.ai_raw_document
  where document_id = v_run.document_id
  for update;

  if v_run.status <> 'RUNNING'
     or v_run.claimed_by <> p_worker_id
     or v_run.lease_until <= now() then
    raise exception 'ingest run is not actively leased by this worker' using errcode = '55000';
  end if;

  if v_document.rag_eligibility not in ('ALLOWED', 'REDACTED_ONLY')
     or v_document.data_class = 'C4' then
    raise exception 'document is not eligible for RAG publication' using errcode = '42501';
  end if;

  select count(*) into v_chunk_count
  from public.ai_document_chunk
  where ingest_run_id = p_ingest_run_id;

  select count(*) into v_embedding_count
  from public.ai_chunk_embedding as embedding
  join public.ai_document_chunk as chunk on chunk.chunk_id = embedding.chunk_id
  where chunk.ingest_run_id = p_ingest_run_id
    and embedding.model_version = v_run.embedding_model;

  if p_page_count < 1
     or v_chunk_count < 1
     or v_chunk_count <> p_expected_chunk_count
     or v_embedding_count <> p_expected_embedding_count
     or v_chunk_count <> v_embedding_count then
    raise exception 'publication counts do not match staged chunks and embeddings'
      using errcode = '23514';
  end if;

  update public.ai_ingest_run
  set status = 'SUCCEEDED',
      stage = 'PUBLISH',
      chunk_count = v_chunk_count,
      embedding_count = v_embedding_count,
      metrics = metrics || coalesce(p_metrics, '{}'::jsonb),
      lease_until = null,
      finished_at = now()
  where ingest_run_id = p_ingest_run_id;

  update public.ai_raw_document
  set is_current = false,
      status = 'SUPERSEDED'
  where space_id = v_document.space_id
    and document_key = v_document.document_key
    and is_current
    and document_id <> v_document.document_id;

  update public.ai_raw_document
  set status = 'READY',
      is_current = true,
      page_count = p_page_count,
      published_ingest_run_id = p_ingest_run_id,
      published_at = now()
  where document_id = v_document.document_id
  returning * into v_document;

  return v_document;
end;
$$;

create or replace function public.ai_fail_ingest_run(
  p_ingest_run_id bigint,
  p_worker_id text,
  p_error_code text,
  p_error_summary text,
  p_retryable boolean,
  p_retry_delay_seconds integer default 120,
  p_max_attempts integer default 5,
  p_metrics jsonb default '{}'::jsonb
)
returns public.ai_ingest_run
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_run public.ai_ingest_run%rowtype;
  v_next_status text;
begin
  select * into strict v_run
  from public.ai_ingest_run
  where ingest_run_id = p_ingest_run_id
  for update;

  if v_run.status <> 'RUNNING' or v_run.claimed_by <> p_worker_id then
    raise exception 'ingest run is not leased by this worker' using errcode = '55000';
  end if;

  v_next_status := case
    when p_retryable and v_run.attempt_count < p_max_attempts then 'RETRY'
    when p_retryable then 'DEAD'
    else 'FAILED'
  end;

  update public.ai_ingest_run
  set status = v_next_status,
      scheduled_for = case
        when v_next_status = 'RETRY' then now() + make_interval(secs => greatest(1, p_retry_delay_seconds))
        else scheduled_for
      end,
      lease_until = null,
      error_code = nullif(left(p_error_code, 120), ''),
      error_summary = left(p_error_summary, 2000),
      metrics = metrics || coalesce(p_metrics, '{}'::jsonb),
      finished_at = case when v_next_status in ('FAILED', 'DEAD') then now() else null end
  where ingest_run_id = p_ingest_run_id
  returning * into v_run;

  update public.ai_raw_document
  set status = case when v_next_status = 'RETRY' then 'QUEUED' else 'FAILED' end
  where document_id = v_run.document_id;

  return v_run;
end;
$$;

create or replace function public.ai_recover_ingest_runs(
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
  with recovered as (
    update public.ai_ingest_run
    set status = case when attempt_count >= p_max_attempts then 'DEAD' else 'RETRY' end,
        scheduled_for = now(),
        lease_until = null,
        error_code = 'LEASE_EXPIRED',
        error_summary = 'AI worker lease expired before publication',
        finished_at = case when attempt_count >= p_max_attempts then now() else null end
    where status = 'RUNNING'
      and lease_until <= now()
    returning document_id, status
  )
  update public.ai_raw_document as document
  set status = case when recovered.status = 'RETRY' then 'QUEUED' else 'FAILED' end
  from recovered
  where document.document_id = recovered.document_id;

  get diagnostics v_recovered = row_count;
  return v_recovered;
end;
$$;

create or replace function public.ai_search_knowledge(
  p_query text,
  p_query_embedding extensions.vector(1536),
  p_limit integer default 10,
  p_space_ids uuid[] default null,
  p_model_version text default 'text-embedding-3-small'
)
returns table (
  chunk_id bigint,
  document_id uuid,
  space_id uuid,
  title text,
  document_key text,
  version_no integer,
  page_from integer,
  page_to integer,
  section_path text[],
  content text,
  vector_score double precision,
  text_score real,
  hybrid_score double precision
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
  with query_terms as (
    select websearch_to_tsquery('simple', coalesce(p_query, '')) as query
  ), candidates as (
    select chunk.chunk_id,
           document.document_id,
           document.space_id,
           document.title,
           document.document_key,
           document.version_no,
           chunk.page_from,
           chunk.page_to,
           chunk.section_path,
           chunk.content,
           1 - (embedding.embedding operator(extensions.<=>) p_query_embedding) as vector_score,
           ts_rank_cd(chunk.search_vector, query_terms.query) as text_score
    from public.ai_document_chunk as chunk
    join public.ai_chunk_embedding as embedding
      on embedding.chunk_id = chunk.chunk_id
     and embedding.model_version = p_model_version
    join public.ai_raw_document as document
      on document.document_id = chunk.document_id
     and document.published_ingest_run_id = chunk.ingest_run_id
    cross join query_terms
    where document.status = 'READY'
      and document.is_current
      and (p_space_ids is null or document.space_id = any (p_space_ids))
      and (
        (select private.is_space_member(document.space_id, null))
        or (
          (select auth.role()) = 'service_role'
          and p_space_ids is not null
          and document.space_id = any (p_space_ids)
        )
      )
  )
  select candidates.chunk_id,
         candidates.document_id,
         candidates.space_id,
         candidates.title,
         candidates.document_key,
         candidates.version_no,
         candidates.page_from,
         candidates.page_to,
         candidates.section_path,
         candidates.content,
         candidates.vector_score,
         candidates.text_score,
         (0.7 * candidates.vector_score + 0.3 * candidates.text_score)::double precision as hybrid_score
  from candidates
  order by hybrid_score desc, candidates.chunk_id
  limit least(greatest(p_limit, 1), 50);
$$;

revoke all on function public.ai_finalize_document_upload(uuid, uuid, text, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.ai_claim_ingest_run(text, integer) from public, anon, authenticated;
revoke all on function public.ai_heartbeat_ingest_run(bigint, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.ai_stage_ingest_batch(bigint, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.ai_publish_ingest_run(bigint, text, integer, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.ai_fail_ingest_run(bigint, text, text, text, boolean, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.ai_recover_ingest_runs(integer) from public, anon, authenticated;
revoke all on function public.ai_search_knowledge(text, extensions.vector, integer, uuid[], text) from public, anon, authenticated;

grant execute on function public.ai_finalize_document_upload(uuid, uuid, text, integer, text, text, text, text) to service_role;
grant execute on function public.ai_claim_ingest_run(text, integer) to service_role;
grant execute on function public.ai_heartbeat_ingest_run(bigint, text, text, integer, jsonb) to service_role;
grant execute on function public.ai_stage_ingest_batch(bigint, text, jsonb, boolean) to service_role;
grant execute on function public.ai_publish_ingest_run(bigint, text, integer, integer, integer, jsonb) to service_role;
grant execute on function public.ai_fail_ingest_run(bigint, text, text, text, boolean, integer, integer, jsonb) to service_role;
grant execute on function public.ai_recover_ingest_runs(integer) to service_role;
grant execute on function public.ai_search_knowledge(text, extensions.vector, integer, uuid[], text) to authenticated, service_role;
