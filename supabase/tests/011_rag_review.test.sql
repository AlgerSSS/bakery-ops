begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(14);

select extensions.has_table(
  'public', 'ai_document_review',
  'RAG review decisions have an append-only audit table'
);
select extensions.has_function(
  'public', 'ai_approve_document_review',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'text'],
  'review-required documents expose a controlled approval RPC'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.ai_approve_document_review(uuid,text,text,text,text,text,text)',
    'execute'
  ),
  'authenticated users cannot self-approve reviewed documents'
);
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.ai_approve_document_review(uuid,text,text,text,text,text,text)',
    'execute'
  ),
  'the privileged ingestion control plane can approve reviewed documents'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '20000000-0000-7000-8000-000000000011', 'authenticated', 'authenticated',
  'rag-reviewer@example.invalid', '', '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.ai_space_member (space_id, user_id, role)
values (
  '10000000-0000-7000-8000-000000000006',
  '20000000-0000-7000-8000-000000000011',
  'VIEWER'
);

create temporary table c2_review_batch as
select (public.ops_register_raw_batch(
  'BRAIN_PDF', 'test-c2-reviewed-document', 'brain-pdf-v1', 'pg-tap', null,
  null, null, 1, '{}'::jsonb
)).batch_id;
insert into storage.objects (bucket_id, name, metadata)
values (
  'kb-restricted',
  '10000000-0000-7000-8000-000000000006/reviewed-policy/1/original.pdf',
  '{"mimetype":"application/pdf","size":128}'::jsonb
);
create temporary table c2_review_object as
select (public.ops_register_raw_object(
  (select batch_id from c2_review_batch),
  'kb-restricted',
  '10000000-0000-7000-8000-000000000006/reviewed-policy/1/original.pdf',
  repeat('a', 64)::character(64), 128, 'application/pdf', 'C2',
  'reviewed-policy', '1'
)).raw_object_id;
select public.ops_complete_raw_batch(
  (select batch_id from c2_review_batch), 1, 0, '{}'::text[], 'rag-v1'
);
create temporary table c2_review_document as
select (public.ai_finalize_document_upload(
  (select raw_object_id from c2_review_object),
  '10000000-0000-7000-8000-000000000006',
  'reviewed-policy', 1, 'Reviewed Policy', 'OTHER',
  'rag-v1', 'openai/text-embedding-3-small'
)).*;

select extensions.ok(
  (
    select status = 'REVIEW_REQUIRED'
      and rag_eligibility = 'REVIEW_REQUIRED'
    from c2_review_document
  ) and (
    select count(*) = 0
    from public.ai_ingest_run
    where document_id = (select document_id from c2_review_document)
  ),
  'C2 content remains blocked before an explicit review decision'
);

create temporary table c2_approved_document as
select (public.ai_approve_document_review(
  (select document_id from c2_review_document),
  'codex-reviewer',
  'Rendered every page; no personal, payroll, financial or legal records found.',
  repeat('b', 64),
  repeat('a', 64),
  'rag-v1',
  'openai/text-embedding-3-small'
)).*;

select extensions.ok(
  (select status = 'QUEUED' and rag_eligibility = 'ALLOWED' from c2_approved_document),
  'an approved C2 document becomes eligible and queued'
);
select extensions.ok(
  (
    select reviewer = 'codex-reviewer'
      and decision = 'APPROVE_RAG'
      and manifest_sha256 = repeat('b', 64)
      and source_sha256 = repeat('a', 64)
    from public.ai_document_review
    where document_id = (select document_id from c2_review_document)
  ),
  'approval records reviewer, reason and both immutable hashes'
);
select extensions.is(
  (
    select count(*)::integer
    from public.ai_ingest_run
    where document_id = (select document_id from c2_review_document)
  ),
  1,
  'approval creates exactly one ingest run'
);
select public.ai_approve_document_review(
  (select document_id from c2_review_document),
  'codex-reviewer',
  'Rendered every page; no personal, payroll, financial or legal records found.',
  repeat('b', 64),
  repeat('a', 64),
  'rag-v1',
  'openai/text-embedding-3-small'
);
select extensions.is(
  (
    select count(*)::integer
    from public.ai_document_review
    where document_id = (select document_id from c2_review_document)
  ),
  1,
  'replaying the identical approval is idempotent'
);
select extensions.throws_ok(
  $$
    select public.ai_approve_document_review(
      (select document_id from c2_review_document),
      'codex-reviewer', 'different reason', repeat('b', 64), repeat('a', 64),
      'rag-v1', 'openai/text-embedding-3-small'
    )
  $$,
  '23505',
  'document already has a different review decision',
  'a conflicting replay cannot rewrite the review audit'
);
select extensions.throws_ok(
  $$
    select public.ai_approve_document_review(
      (select document_id from c2_review_document),
      'codex-reviewer',
      'Rendered every page; no personal, payroll, financial or legal records found.',
      repeat('b', 64), repeat('f', 64),
      'rag-v1', 'openai/text-embedding-3-small'
    )
  $$,
  '23514',
  'review source SHA-256 does not match raw object',
  'approval is bound to the immutable source bytes'
);

create temporary table c3_review_batch as
select (public.ops_register_raw_batch(
  'BRAIN_PDF', 'test-c3-reviewed-document', 'brain-pdf-v1', 'pg-tap', null,
  null, null, 1, '{}'::jsonb
)).batch_id;
insert into storage.objects (bucket_id, name, metadata)
values (
  'legal-private',
  '10000000-0000-7000-8000-000000000005/reviewed-contract/1/original.pdf',
  '{"mimetype":"application/pdf","size":256}'::jsonb
);
create temporary table c3_review_object as
select (public.ops_register_raw_object(
  (select batch_id from c3_review_batch),
  'legal-private',
  '10000000-0000-7000-8000-000000000005/reviewed-contract/1/original.pdf',
  repeat('c', 64)::character(64), 256, 'application/pdf', 'C3',
  'reviewed-contract', '1'
)).raw_object_id;
select public.ops_complete_raw_batch(
  (select batch_id from c3_review_batch), 1, 0, '{}'::text[], 'rag-v1'
);
create temporary table c3_review_document as
select (public.ai_finalize_document_upload(
  (select raw_object_id from c3_review_object),
  '10000000-0000-7000-8000-000000000005',
  'reviewed-contract', 1, 'Reviewed Contract', 'CONTRACT',
  'rag-v1', 'openai/text-embedding-3-small'
)).*;
select extensions.throws_ok(
  $$
    select public.ai_approve_document_review(
      (select document_id from c3_review_document),
      'codex-reviewer', 'reviewed', repeat('d', 64), repeat('c', 64),
      'rag-v1', 'openai/text-embedding-3-small'
    )
  $$,
  '42501',
  'only C1/C2 documents can be approved without a redaction pipeline',
  'C3 content remains fail-closed until genuine redaction exists'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub', '20000000-0000-7000-8000-000000000011', true
);
set local role authenticated;
select extensions.is(
  (select count(*)::integer from public.ai_document_review),
  1,
  'a knowledge-space member can inspect the review audit through RLS'
);
reset role;

select set_config(
  'request.jwt.claim.sub', '20000000-0000-7000-8000-000000000099', true
);
set local role authenticated;
select extensions.is(
  (select count(*)::integer from public.ai_document_review),
  0,
  'a non-member cannot inspect review decisions'
);
reset role;

select * from extensions.finish();
rollback;
