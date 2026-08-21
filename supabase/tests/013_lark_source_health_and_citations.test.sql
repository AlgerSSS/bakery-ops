begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(8);

select extensions.has_function(
  'public', 'ai_get_source_sync_health', array[]::text[],
  'source sync health has a payload-free RPC'
);
select extensions.has_function(
  'public', 'ai_search_knowledge_v2',
  array['text', 'vector', 'integer', 'uuid[]', 'text'],
  'citation-aware hybrid search RPC exists'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.ai_get_source_sync_health()', 'execute'),
  'service role can read aggregate source health'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.ai_get_source_sync_health()', 'execute'),
  'authenticated users cannot inspect machine source health'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.ai_search_knowledge_v2(text,extensions.vector,integer,uuid[],text)',
    'execute'
  ),
  'authenticated knowledge users can call citation-aware search'
);
select extensions.is(
  ((public.ai_get_source_sync_health() ->> 'enabled_connectors')::integer),
  8,
  'source health reports all eight enabled connectors'
);
select extensions.is(
  ((public.ai_get_source_sync_health() ->> 'stale_connectors')::integer),
  8,
  'fresh replay starts degraded until every connector completes a scan'
);
select extensions.ok(
  public.ops_get_platform_health() ? 'sources'
    and public.ops_get_platform_health() ->> 'status' = 'degraded',
  'platform health includes and enforces source freshness'
);

select * from extensions.finish();
rollback;
