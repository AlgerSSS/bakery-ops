begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(18);

select extensions.has_table('public', 'ai_source_connector', 'Lark allowlist connectors exist');
select extensions.has_table('public', 'ai_source_sync_run', 'Lark bounded sync runs exist');
select extensions.has_table('public', 'ai_source_item', 'Lark node inventory exists');

select extensions.is(
  (select count(*)::integer from public.ai_source_connector where sync_enabled),
  8,
  'exactly eight HOT CRUSH team Wiki spaces are allowlisted'
);
select extensions.is(
  (select count(*)::integer
   from public.ai_source_connector as connector
   join public.ai_knowledge_space as space on space.space_id = connector.knowledge_space_id
   where space.data_class = 'C1' and space.rag_policy = 'AUTO'),
  3,
  'only Public, Operations and Marketing enter automatic C1 RAG'
);
select extensions.is(
  (select count(*)::integer
   from public.ai_source_connector as connector
   join public.ai_knowledge_space as space on space.space_id = connector.knowledge_space_id
   where space.data_class in ('C2', 'C3')),
  5,
  'five restricted department spaces remain review-required or denied'
);

select extensions.ok(
  (select allowed_mime_types @> array['application/pdf', 'application/json']
   from storage.buckets where id = 'kb-internal'),
  'knowledge Storage accepts exact PDFs and canonical Lark Docx JSON'
);
select extensions.ok(
  not has_table_privilege('service_role', 'public.ai_source_item', 'select'),
  'service role cannot bypass source inventory RPCs with table reads'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.ai_list_source_connectors()', 'execute'),
  'service role can list only enabled source connectors through a controlled RPC'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.ai_begin_source_sync(uuid,text)', 'execute'),
  'authenticated users cannot start source syncs'
);
select extensions.ok(
  exists (
    select 1
    from pg_index as index
    join pg_class as relation on relation.oid = index.indexrelid
    where index.indrelid = 'public.ai_source_item'::regclass
      and relation.relname = 'ai_source_item_last_seen_run_idx'
      and index.indisvalid
  ),
  'source item last_seen_sync_run_id foreign key has a dedicated index'
);

create temporary table first_scan as
select (public.ai_begin_source_sync(
  '20000000-0000-7000-8000-000000000001', 'pg-tap'
)).sync_run_id;

select public.ai_record_source_item(
  (select sync_run_id from first_scan),
  'NodeToken1', 'ObjectToken1', 'sheet', 'Unsupported sheet',
  'https://example.invalid/wiki/NodeToken1', null, null, null,
  'UNSUPPORTED', null, '{}'::jsonb
);
select public.ai_finish_source_sync(
  (select sync_run_id from first_scan), 'SUCCEEDED',
  '{"discovered":1,"synced":0,"unchanged":0,"unsupported":1,"failed":0}'::jsonb,
  null
);

select extensions.is(
  (select status from public.ai_source_item where external_node_token = 'NodeToken1'),
  'UNSUPPORTED',
  'unsupported nodes are inventoried but never queued for RAG'
);

create temporary table second_scan as
select (public.ai_begin_source_sync(
  '20000000-0000-7000-8000-000000000001', 'pg-tap'
)).sync_run_id;
select public.ai_finish_source_sync(
  (select sync_run_id from second_scan), 'SUCCEEDED',
  '{"discovered":0,"synced":0,"unchanged":0,"unsupported":0,"failed":0}'::jsonb,
  null
);
select extensions.is(
  (select missing_scan_count from public.ai_source_item where external_node_token = 'NodeToken1'),
  1,
  'one complete missed scan does not mark a source item missing'
);
select extensions.is(
  (select status from public.ai_source_item where external_node_token = 'NodeToken1'),
  'UNSUPPORTED',
  'one complete missed scan preserves the prior source status'
);

create temporary table third_scan as
select (public.ai_begin_source_sync(
  '20000000-0000-7000-8000-000000000001', 'pg-tap'
)).sync_run_id;
select public.ai_finish_source_sync(
  (select sync_run_id from third_scan), 'SUCCEEDED',
  '{"discovered":0,"synced":0,"unchanged":0,"unsupported":0,"failed":0}'::jsonb,
  null
);
select extensions.is(
  (select missing_scan_count from public.ai_source_item where external_node_token = 'NodeToken1'),
  2,
  'two complete missed scans increment the source reconciliation counter to two'
);
select extensions.is(
  (select status from public.ai_source_item where external_node_token = 'NodeToken1'),
  'MISSING',
  'two complete missed scans mark the source item missing'
);

create temporary table failed_scan as
select (public.ai_begin_source_sync(
  '20000000-0000-7000-8000-000000000001', 'pg-tap'
)).sync_run_id;
select public.ai_finish_source_sync(
  (select sync_run_id from failed_scan), 'FAILED', '{}', 'enumeration failed'
);
select extensions.is(
  (select missing_scan_count from public.ai_source_item where external_node_token = 'NodeToken1'),
  2,
  'a failed traversal never advances missing reconciliation'
);
select extensions.is(
  (select status from public.ai_source_sync_run where sync_run_id = (select sync_run_id from failed_scan)),
  'FAILED',
  'failed traversals retain an explicit terminal status'
);

select * from extensions.finish();
rollback;
