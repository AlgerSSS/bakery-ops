begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(11);

select extensions.has_function(
  'public', 'ai_get_document_ingest_status', array['uuid[]'],
  'RAG operations expose a bounded document status RPC'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated', 'public.ai_get_document_ingest_status(uuid[])', 'execute'
  ),
  'authenticated users cannot bypass document membership through the operations RPC'
);

create temporary table rag_ops_batch as
select (public.ops_register_raw_batch(
  'BRAIN_PDF', 'test-rag-operability', 'brain-pdf-v1', 'pg-tap', null,
  null, null, 1, '{}'::jsonb
)).batch_id;
insert into storage.objects (bucket_id, name, metadata)
values (
  'kb-internal',
  '10000000-0000-7000-8000-000000000001/test-rag-operability/1/original.pdf',
  '{"mimetype":"application/pdf","size":128}'::jsonb
);
create temporary table rag_ops_object as
select (public.ops_register_raw_object(
  (select batch_id from rag_ops_batch), 'kb-internal',
  '10000000-0000-7000-8000-000000000001/test-rag-operability/1/original.pdf',
  repeat('d', 64)::character(64), 128, 'application/pdf', 'C1',
  'test-rag-operability', '1'
)).raw_object_id;
select public.ops_complete_raw_batch(
  (select batch_id from rag_ops_batch), 1, 0, '{}'::text[], 'rag-v1'
);
create temporary table rag_ops_document as
select (public.ai_finalize_document_upload(
  (select raw_object_id from rag_ops_object),
  '10000000-0000-7000-8000-000000000001',
  'test-rag-operability', 1, 'RAG Operability', 'SOP',
  'rag-v1', 'openai/text-embedding-3-small'
)).*;
create temporary table rag_ops_claim as
select * from public.ai_claim_ingest_run('rag-ops-worker', 600);
create temporary table rag_ops_embedding as
select to_jsonb(array(select case when position = 1 then 1.0 else 0.0 end
  from generate_series(1, 1536) as position)) as value;
select public.ai_stage_ingest_batch(
  (select ingest_run_id from rag_ops_claim), 'rag-ops-worker',
  jsonb_build_array(jsonb_build_object(
    'chunk_no', 0, 'page_from', 1, 'page_to', 1,
    'section_path', jsonb_build_array('Operations'),
    'content', 'RAG rollback keeps citations and vectors for restoration.',
    'content_sha256', repeat('e', 64), 'token_count', 11,
    'is_redacted', false, 'metadata', '{}'::jsonb,
    'embedding', (select value from rag_ops_embedding)
  )), true
);
select public.ai_publish_ingest_run(
  (select ingest_run_id from rag_ops_claim), 'rag-ops-worker', 1, 1, 1,
  '{"parser":"pg-tap"}'::jsonb
);

select extensions.ok(
  (
    select document_status = 'READY'
      and ingest_status = 'SUCCEEDED'
      and chunk_count = 1
      and embedding_count = 1
    from public.ai_get_document_ingest_status(
      array[(select document_id from rag_ops_document)]::uuid[]
    )
  ),
  'document status reports publication and exact staged counts'
);
select extensions.is(
  (select status from public.ai_unpublish_document(
    (select document_id from rag_ops_document), 'rollback rehearsal', 'pg-tap'
  )),
  'SUPERSEDED',
  'unpublish removes the current READY publication'
);
select set_config('request.jwt.claim.role', 'service_role', true);
select extensions.is(
  (select count(*)::integer from public.ai_search_knowledge(
    'RAG rollback',
    ('[' || array_to_string(array(select case when position = 1 then 1.0 else 0.0 end
      from generate_series(1, 1536) as position), ',') || ']')::extensions.vector,
    10, array['10000000-0000-7000-8000-000000000001']::uuid[],
    'openai/text-embedding-3-small'
  )),
  0,
  'unpublished chunks are immediately excluded from search'
);
select extensions.is(
  (select count(*)::integer from public.ai_document_chunk
    where document_id = (select document_id from rag_ops_document)),
  1,
  'unpublish preserves immutable chunks for audit and restore'
);
select extensions.is(
  jsonb_array_length(
    (select metrics -> 'publication_state_history'
     from public.ai_ingest_run
     where ingest_run_id = (select ingest_run_id from rag_ops_claim))
  ),
  1,
  'unpublish records one append-only state event in run metrics'
);
select extensions.is(
  (select status from public.ai_restore_document(
    (select document_id from rag_ops_document), 'rollback rehearsal passed', 'pg-tap'
  )),
  'READY',
  'restore republishes the preserved successful run'
);
select extensions.is(
  (select count(*)::integer from public.ai_search_knowledge(
    'RAG rollback',
    ('[' || array_to_string(array(select case when position = 1 then 1.0 else 0.0 end
      from generate_series(1, 1536) as position), ',') || ']')::extensions.vector,
    10, array['10000000-0000-7000-8000-000000000001']::uuid[],
    'openai/text-embedding-3-small'
  )),
  1,
  'restored document becomes searchable without re-embedding'
);
select extensions.is(
  jsonb_array_length(
    (select metrics -> 'publication_state_history'
     from public.ai_ingest_run
     where ingest_run_id = (select ingest_run_id from rag_ops_claim))
  ),
  2,
  'restore appends a second state event'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.ai_restore_document(uuid,text,text)', 'execute'),
  'service role can execute controlled RAG restoration'
);

select * from extensions.finish();
rollback;
