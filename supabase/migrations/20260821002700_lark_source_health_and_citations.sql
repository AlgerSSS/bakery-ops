-- Surface Lark sync health in the platform snapshot and return source URLs
-- for online-document citations without changing the existing RAG RPC contract.

create or replace function public.ai_get_source_sync_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
  select jsonb_build_object(
    'enabled_connectors', count(*) filter (where connector.sync_enabled),
    'stale_connectors', count(*) filter (
      where connector.sync_enabled
        and (
          connector.last_successful_scan_at is null
          or connector.last_successful_scan_at < now() - interval '75 minutes'
        )
    ),
    'failed_connectors', count(*) filter (
      where connector.sync_enabled and connector.last_error is not null
    ),
    'running_scans', (
      select count(*) from public.ai_source_sync_run where status = 'RUNNING'
    ),
    'stale_running_scans', (
      select count(*)
      from public.ai_source_sync_run
      where status = 'RUNNING' and started_at < now() - interval '2 hours'
    ),
    'failed_items', (
      select count(*) from public.ai_source_item where status = 'FAILED'
    ),
    'missing_items', (
      select count(*) from public.ai_source_item where status = 'MISSING'
    ),
    'review_required_items', (
      select count(*) from public.ai_source_item where status = 'REVIEW_REQUIRED'
    ),
    'last_successful_scan_at', max(connector.last_successful_scan_at)
  )
  from public.ai_source_connector as connector;
$$;

comment on function public.ai_get_source_sync_health() is
  'Returns aggregate Lark source freshness, scan, failure, missing and review counts without exposing document titles, tokens or payloads.';

alter function public.ops_get_platform_health()
  rename to ops_get_platform_health_base;

revoke all on function public.ops_get_platform_health_base()
  from public, anon, authenticated, service_role, hc_ops_processor, hc_agent_worker;

create or replace function public.ops_get_platform_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_base jsonb;
  v_sources jsonb;
  v_status text;
begin
  v_base := public.ops_get_platform_health_base();
  v_sources := public.ai_get_source_sync_health();
  v_status := case
    when (v_sources ->> 'stale_connectors')::integer > 0
      or (v_sources ->> 'failed_connectors')::integer > 0
      or (v_sources ->> 'stale_running_scans')::integer > 0
      or (v_sources ->> 'failed_items')::integer > 0
      or (v_sources ->> 'missing_items')::integer > 0
      then 'degraded'
    else v_base ->> 'status'
  end;
  return v_base || jsonb_build_object('status', v_status, 'sources', v_sources);
end;
$$;

comment on function public.ops_get_platform_health() is
  'Returns bounded platform health including Lark source freshness; review-required source items are visible but are not platform failures.';

create or replace function public.ai_search_knowledge_v2(
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
  hybrid_score double precision,
  citation_uri text,
  citation_label text
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
  select result.chunk_id,
         result.document_id,
         result.space_id,
         result.title,
         result.document_key,
         result.version_no,
         result.page_from,
         result.page_to,
         result.section_path,
         result.content,
         result.vector_score,
         result.text_score,
         result.hybrid_score,
         source.source_uri as citation_uri,
         case
           when result.page_from is null then result.title
           when result.page_from = result.page_to then result.title || ' · page ' || result.page_from
           else result.title || ' · pages ' || result.page_from || '-' || result.page_to
         end as citation_label
  from public.ai_search_knowledge(
    p_query,
    p_query_embedding,
    p_limit,
    p_space_ids,
    p_model_version
  ) as result
  left join lateral (
    select item.source_uri
    from public.ai_source_item as item
    where item.current_document_id = result.document_id
      and item.status in ('SYNCED', 'REVIEW_REQUIRED')
    order by item.updated_at desc
    limit 1
  ) as source on true;
$$;

comment on function public.ai_search_knowledge_v2(text, extensions.vector, integer, uuid[], text) is
  'Runs the existing permission-scoped hybrid search and adds a direct Lark Wiki URI for online-source citations; PDF-only sources retain page citations and a null URI.';

revoke all on function public.ai_get_source_sync_health(),
                       public.ops_get_platform_health(),
                       public.ai_search_knowledge_v2(text, extensions.vector, integer, uuid[], text)
from public, anon;

revoke all on function public.ai_get_source_sync_health(),
                       public.ops_get_platform_health()
from authenticated;

grant execute on function public.ai_get_source_sync_health()
  to service_role, hc_ai_ingestor, hc_agent_worker;
grant execute on function public.ops_get_platform_health()
  to service_role, hc_ops_processor, hc_agent_worker;
grant execute on function public.ai_search_knowledge_v2(text, extensions.vector, integer, uuid[], text)
  to authenticated, service_role, hc_ai_ingestor, hc_agent_worker;
