begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(10);

select extensions.is((select count(*)::integer from information_schema.tables where table_schema = 'public' and table_name = any (array[
  'ops_raw_batch', 'ops_raw_object', 'ops_processing_run', 'ai_knowledge_space', 'ai_space_member',
  'ai_raw_document', 'ai_ingest_run', 'ai_document_chunk', 'ai_chunk_embedding', 'ops_agent_run', 'ops_agent_event'
])), 11, 'all eleven blueprint control, RAG and Agent tables exist');

select extensions.is((select count(*)::integer from pg_class as relation join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public' and relation.relname = any (array[
    'ops_raw_batch', 'ops_raw_object', 'ops_processing_run', 'pipeline_health', 'ai_knowledge_space', 'ai_space_member',
    'ai_raw_document', 'ai_ingest_run', 'ai_document_chunk', 'ai_chunk_embedding', 'ops_agent_run', 'ops_agent_event'
  ]) and relation.relrowsecurity), 12, 'all platform tables have RLS enabled');

select extensions.is((select count(*)::integer from pg_class as relation join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public' and relation.relname = any (array[
    'ops_raw_batch', 'ops_raw_object', 'ops_processing_run', 'pipeline_health', 'ai_knowledge_space', 'ai_space_member',
    'ai_raw_document', 'ai_ingest_run', 'ai_document_chunk', 'ai_chunk_embedding', 'ops_agent_run', 'ops_agent_event'
  ]) and obj_description(relation.oid, 'pg_class') is not null), 12, 'every platform table has an ownership and grain comment');

select extensions.ok(exists (select 1 from pg_extension where extname = 'vector'), 'pgvector is installed');
select extensions.is((select count(*)::integer from storage.buckets where id like '%-private' or id in ('kb-internal', 'kb-restricted')), 7, 'seven private Storage buckets exist');
select extensions.is((select count(*)::integer from storage.buckets where public), 0, 'no platform Storage bucket is public');
select extensions.is((select count(*)::integer from cron.job where jobname like 'hc_%'), 6, 'six short platform Cron jobs are installed');
select extensions.is((select count(*)::integer from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename = any (array['ops_agent_run', 'ops_agent_event', 'ai_ingest_run'])), 3,
  'Realtime contains only the three intended platform status tables');

select extensions.is((select count(*)::integer
  from pg_constraint as constraint_row
  join pg_attribute as attribute on attribute.attrelid = constraint_row.conrelid and attribute.attnum = any (constraint_row.conkey)
  where constraint_row.contype = 'f' and constraint_row.connamespace = 'public'::regnamespace
    and constraint_row.conrelid::regclass::text = any (array[
      'ops_raw_object', 'ops_processing_run', 'ai_space_member', 'ai_raw_document', 'ai_ingest_run',
      'ai_document_chunk', 'ai_chunk_embedding', 'ops_agent_run', 'ops_agent_event'
    ])
    and not exists (select 1 from pg_index as index_row where index_row.indrelid = constraint_row.conrelid
      and attribute.attnum = any (index_row.indkey))), 0, 'all foreign-key columns have supporting indexes');

select extensions.is((select count(*)::integer from pg_roles where rolname = any (array[
  'hc_pos_writer', 'hc_ops_processor', 'hc_ai_ingestor', 'hc_agent_worker', 'hc_hr_worker', 'hc_scm_worker', 'hc_msg_worker'
]) and not rolcanlogin), 7, 'all seven machine capability roles exist without direct login');

select * from extensions.finish();
rollback;
