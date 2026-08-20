-- Keep the retrieval default identical to the model identifier stored by the
-- production OpenRouter embedding worker.

create or replace function public.ai_search_knowledge(
  p_query text,
  p_query_embedding extensions.vector(1536),
  p_limit integer default 10,
  p_space_ids uuid[] default null,
  p_model_version text default 'openai/text-embedding-3-small'
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
