begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(10);

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('20000000-0000-7000-8000-000000000001', 'authenticated', 'authenticated',
  'rag-member@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.ai_space_member (space_id, user_id, role)
values ('10000000-0000-7000-8000-000000000001', '20000000-0000-7000-8000-000000000001', 'VIEWER');

create temporary table rag_batch as
select (public.ops_register_raw_batch(
  'BRAIN_PDF', 'test-c1-document', 'v1', 'pg-tap', null, null, null, 1, '{}'::jsonb
)).batch_id;

insert into storage.objects (bucket_id, name, metadata)
values ('kb-internal', '10000000-0000-7000-8000-000000000001/test-sop/1/original.pdf',
  '{"mimetype":"application/pdf","size":128}'::jsonb);

create temporary table rag_object as
select (public.ops_register_raw_object(
  (select batch_id from rag_batch), 'kb-internal',
  '10000000-0000-7000-8000-000000000001/test-sop/1/original.pdf',
  repeat('a', 64)::character(64), 128, 'application/pdf', 'C1'
)).raw_object_id;

select extensions.is((select status from public.ops_complete_raw_batch(
  (select batch_id from rag_batch), 1, 0, '{}'::text[], 'rag-v1'
)), 'READY', 'a document-only raw batch can complete without a structured pipeline');

create temporary table rag_document as
select (public.ai_finalize_document_upload(
  (select raw_object_id from rag_object), '10000000-0000-7000-8000-000000000001',
  'test-sop', 1, 'Test SOP', 'SOP', 'rag-v1', 'text-embedding-3-small'
)).*;
select extensions.ok((select status = 'QUEUED' and rag_eligibility = 'ALLOWED' from rag_document),
  'eligible C1 document is queued automatically');

create temporary table rag_claim as select * from public.ai_claim_ingest_run('rag-worker-a', 600);
select extensions.ok((select ingest_run_id is not null from rag_claim), 'RAG worker claims the queued document');

create temporary table test_embedding as
select to_jsonb(array(select case when position = 1 then 1.0 else 0.0 end
  from generate_series(1, 1536) as position)) as value;

select extensions.is(public.ai_stage_ingest_batch(
  (select ingest_run_id from rag_claim), 'rag-worker-a',
  jsonb_build_array(jsonb_build_object(
    'chunk_no', 0, 'page_from', 1, 'page_to', 1,
    'section_path', jsonb_build_array('Opening'),
    'content', 'Hot Crush opening checklist and food safety steps.',
    'content_sha256', repeat('b', 64), 'token_count', 9, 'is_redacted', false,
    'metadata', '{}'::jsonb, 'embedding', (select value from test_embedding)
  )), true
), 1, 'one complete chunk and embedding can be staged');

select extensions.is((select status from public.ai_publish_ingest_run(
  (select ingest_run_id from rag_claim), 'rag-worker-a', 1, 1, 1, '{"parser":"pg-tap"}'::jsonb
)), 'READY', 'a fully staged ingest run publishes atomically');

select set_config('request.jwt.claim.role', 'service_role', true);
select extensions.is((select count(*)::integer from public.ai_search_knowledge(
  'opening checklist',
  ('[' || array_to_string(array(select case when position = 1 then 1.0 else 0.0 end
    from generate_series(1, 1536) as position), ',') || ']')::extensions.vector,
  10, array['10000000-0000-7000-8000-000000000001']::uuid[], 'text-embedding-3-small'
)), 1, 'hybrid search returns the published chunk with an explicit service scope');

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-7000-8000-000000000001', true);
set local role authenticated;
select extensions.is((select count(*)::integer from public.ai_raw_document), 1,
  'an explicit knowledge-space member can read the document through RLS');
reset role;

select set_config('request.jwt.claim.sub', '20000000-0000-7000-8000-000000000099', true);
set local role authenticated;
select extensions.is((select count(*)::integer from public.ai_raw_document), 0,
  'a non-member cannot read the document through RLS');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table c4_batch as
select (public.ops_register_raw_batch(
  'BRAIN_PDF', 'test-c4-document', 'v1', 'pg-tap', null, null, null, 1, '{}'::jsonb
)).batch_id;
insert into storage.objects (bucket_id, name, metadata)
values ('hr-payroll-private', '10000000-0000-7000-8000-000000000003/payroll-sealed/1/original.pdf',
  '{"mimetype":"application/pdf","size":256}'::jsonb);
create temporary table c4_object as
select (public.ops_register_raw_object(
  (select batch_id from c4_batch), 'hr-payroll-private',
  '10000000-0000-7000-8000-000000000003/payroll-sealed/1/original.pdf',
  repeat('c', 64)::character(64), 256, 'application/pdf', 'C4'
)).raw_object_id;
select public.ops_complete_raw_batch((select batch_id from c4_batch), 1, 0, '{}'::text[], 'rag-v1');

create temporary table c4_document as
select (public.ai_finalize_document_upload(
  (select raw_object_id from c4_object), '10000000-0000-7000-8000-000000000003',
  'payroll-sealed', 1, 'Payroll Sealed', 'PAYROLL', 'rag-v1', 'text-embedding-3-small'
)).*;
select extensions.ok((select status = 'REVIEW_REQUIRED' and rag_eligibility = 'DENIED' from c4_document),
  'C4 payroll document is denied automatic RAG');
select extensions.is((select count(*)::integer from public.ai_ingest_run
  where document_id = (select document_id from c4_document)), 0,
  'C4 payroll document never receives an ingest run');

select * from extensions.finish();
rollback;
