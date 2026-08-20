-- Bounded RAG observability plus reversible publication state changes. Binary
-- originals, chunks and embeddings remain immutable during rollback.

create or replace function public.ai_get_document_ingest_status(
  p_document_ids uuid[]
)
returns table (
  document_id uuid,
  space_id uuid,
  title text,
  document_status text,
  is_current boolean,
  page_count integer,
  rag_eligibility text,
  ingest_run_id bigint,
  ingest_status text,
  ingest_stage text,
  attempt_count integer,
  scheduled_for timestamptz,
  chunk_count integer,
  embedding_count integer,
  error_code text,
  error_summary text,
  batch_id uuid,
  bucket_id text,
  object_path text
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
begin
  if p_document_ids is null
     or cardinality(p_document_ids) < 1
     or cardinality(p_document_ids) > 100 then
    raise exception 'document status requires between 1 and 100 IDs' using errcode = '22023';
  end if;

  return query
  select document.document_id,
         document.space_id,
         document.title,
         document.status,
         document.is_current,
         document.page_count,
         document.rag_eligibility,
         run.ingest_run_id,
         run.status,
         run.stage,
         run.attempt_count,
         run.scheduled_for,
         coalesce(chunk_totals.chunk_count, 0)::integer,
         coalesce(chunk_totals.embedding_count, 0)::integer,
         run.error_code,
         run.error_summary,
         object.batch_id,
         object.bucket_id,
         object.object_path
  from unnest(p_document_ids) with ordinality as requested(document_id, ordinal)
  join public.ai_raw_document as document
    on document.document_id = requested.document_id
  join public.ops_raw_object as object
    on object.raw_object_id = document.raw_object_id
  left join lateral (
    select candidate.*
    from public.ai_ingest_run as candidate
    where candidate.document_id = document.document_id
    order by candidate.ingest_run_id desc
    limit 1
  ) as run on true
  left join lateral (
    select count(distinct chunk.chunk_id) as chunk_count,
           count(embedding.chunk_id) as embedding_count
    from public.ai_document_chunk as chunk
    left join public.ai_chunk_embedding as embedding
      on embedding.chunk_id = chunk.chunk_id
     and embedding.model_version = run.embedding_model
    where chunk.ingest_run_id = run.ingest_run_id
  ) as chunk_totals on run.ingest_run_id is not null
  order by requested.ordinal;
end;
$$;

comment on function public.ai_get_document_ingest_status(uuid[]) is
  'Returns bounded operational state and exact staged counts for explicitly named RAG documents; privileged worker use only.';

create or replace function public.ai_unpublish_document(
  p_document_id uuid,
  p_reason text,
  p_actor text
)
returns public.ai_raw_document
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_document public.ai_raw_document%rowtype;
begin
  if btrim(coalesce(p_reason, '')) = '' or btrim(coalesce(p_actor, '')) = '' then
    raise exception 'publication state reason and actor are required' using errcode = '22023';
  end if;

  select * into strict v_document
  from public.ai_raw_document
  where document_id = p_document_id
  for update;

  if v_document.status = 'SUPERSEDED' and not v_document.is_current then
    return v_document;
  end if;

  if v_document.status <> 'READY'
     or not v_document.is_current
     or v_document.published_ingest_run_id is null then
    raise exception 'only a current READY document can be unpublished' using errcode = '23514';
  end if;

  update public.ai_raw_document
  set status = 'SUPERSEDED',
      is_current = false
  where document_id = p_document_id
  returning * into v_document;

  update public.ai_ingest_run
  set metrics = jsonb_set(
    metrics,
    '{publication_state_history}',
    coalesce(metrics -> 'publication_state_history', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'event', 'UNPUBLISHED',
        'reason', left(p_reason, 1000),
        'actor', left(p_actor, 200),
        'at', now()
      )),
    true
  )
  where ingest_run_id = v_document.published_ingest_run_id;

  return v_document;
end;
$$;

comment on function public.ai_unpublish_document(uuid, text, text) is
  'Removes one current READY document from retrieval while preserving its Raw object, successful run, chunks and embeddings.';

create or replace function public.ai_restore_document(
  p_document_id uuid,
  p_reason text,
  p_actor text
)
returns public.ai_raw_document
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_document public.ai_raw_document%rowtype;
  v_run_status text;
begin
  if btrim(coalesce(p_reason, '')) = '' or btrim(coalesce(p_actor, '')) = '' then
    raise exception 'publication state reason and actor are required' using errcode = '22023';
  end if;

  select * into strict v_document
  from public.ai_raw_document
  where document_id = p_document_id
  for update;

  if v_document.status = 'READY' and v_document.is_current then
    return v_document;
  end if;

  if v_document.status <> 'SUPERSEDED'
     or v_document.is_current
     or v_document.published_ingest_run_id is null
     or v_document.rag_eligibility not in ('ALLOWED', 'REDACTED_ONLY') then
    raise exception 'only a previously published eligible document can be restored'
      using errcode = '23514';
  end if;

  select status into strict v_run_status
  from public.ai_ingest_run
  where ingest_run_id = v_document.published_ingest_run_id
  for update;

  if v_run_status <> 'SUCCEEDED' then
    raise exception 'document publication run is not successful' using errcode = '23514';
  end if;

  perform document_id
  from public.ai_raw_document
  where space_id = v_document.space_id
    and document_key = v_document.document_key
  for update;

  with displaced as (
    update public.ai_raw_document
    set status = 'SUPERSEDED',
        is_current = false
    where space_id = v_document.space_id
      and document_key = v_document.document_key
      and is_current
      and document_id <> p_document_id
    returning published_ingest_run_id
  )
  update public.ai_ingest_run as run
  set metrics = jsonb_set(
    run.metrics,
    '{publication_state_history}',
    coalesce(run.metrics -> 'publication_state_history', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'event', 'DISPLACED_BY_RESTORE',
        'reason', left(p_reason, 1000),
        'actor', left(p_actor, 200),
        'at', now()
      )),
    true
  )
  from displaced
  where run.ingest_run_id = displaced.published_ingest_run_id;

  update public.ai_raw_document
  set status = 'READY',
      is_current = true
  where document_id = p_document_id
  returning * into v_document;

  update public.ai_ingest_run
  set metrics = jsonb_set(
    metrics,
    '{publication_state_history}',
    coalesce(metrics -> 'publication_state_history', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'event', 'RESTORED',
        'reason', left(p_reason, 1000),
        'actor', left(p_actor, 200),
        'at', now()
      )),
    true
  )
  where ingest_run_id = v_document.published_ingest_run_id;

  return v_document;
end;
$$;

comment on function public.ai_restore_document(uuid, text, text) is
  'Restores a preserved successful RAG publication and atomically supersedes any current version of the same logical document.';

revoke all on function public.ai_get_document_ingest_status(uuid[]),
                       public.ai_unpublish_document(uuid, text, text),
                       public.ai_restore_document(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.ai_get_document_ingest_status(uuid[]),
                          public.ai_unpublish_document(uuid, text, text),
                          public.ai_restore_document(uuid, text, text)
  to service_role, hc_ai_ingestor;
