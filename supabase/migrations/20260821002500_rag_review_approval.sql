-- Auditable approval gate for C1/C2 documents that cannot enter RAG automatically.
-- C3/C4 remain blocked until a real redaction pipeline exists.

-- Migration 13 added the restricted bucket and knowledge spaces but omitted the
-- Raw-object bucket constraint. Add and validate the wider constraint before
-- replacing the original, so existing writers never see an unconstrained table.
alter table public.ops_raw_object
  add constraint ops_raw_object_bucket_v2_ck check (bucket_id in (
    'raw-business-private',
    'kb-internal',
    'kb-restricted',
    'hr-recruiting-private',
    'hr-payroll-private',
    'finance-private',
    'legal-private'
  )) not valid;

alter table public.ops_raw_object
  validate constraint ops_raw_object_bucket_v2_ck;

alter table public.ops_raw_object
  drop constraint ops_raw_object_bucket_ck;

alter table public.ops_raw_object
  rename constraint ops_raw_object_bucket_v2_ck to ops_raw_object_bucket_ck;

create table public.ai_document_review (
  review_id bigint generated always as identity primary key,
  document_id uuid not null unique
    references public.ai_raw_document(document_id) on delete restrict,
  decision text not null,
  reviewer text not null,
  reason text not null,
  manifest_sha256 character(64) not null,
  source_sha256 character(64) not null,
  pipeline_version text not null,
  embedding_model text not null,
  reviewed_at timestamptz not null default now(),
  constraint ai_document_review_decision_ck check (decision = 'APPROVE_RAG'),
  constraint ai_document_review_reviewer_ck check (
    btrim(reviewer) <> '' and length(reviewer) <= 200
  ),
  constraint ai_document_review_reason_ck check (
    btrim(reason) <> '' and length(reason) <= 1000
  ),
  constraint ai_document_review_manifest_sha_ck check (
    manifest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_document_review_source_sha_ck check (
    source_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint ai_document_review_pipeline_ck check (btrim(pipeline_version) <> ''),
  constraint ai_document_review_model_ck check (btrim(embedding_model) <> '')
);

comment on table public.ai_document_review is
  'One immutable APPROVE_RAG decision for one C1/C2 document version; records reviewer, reason, source manifest/hash and the exact queued pipeline. Written only by ai_approve_document_review.';

alter table public.ai_document_review enable row level security;

revoke all on table public.ai_document_review from public, anon, authenticated, service_role;
grant select on table public.ai_document_review to authenticated;

create policy ai_document_review_member_select
on public.ai_document_review
for select
to authenticated
using (
  exists (
    select 1
    from public.ai_raw_document as document
    where document.document_id = ai_document_review.document_id
      and (select private.is_space_member(document.space_id, null))
  )
);

create or replace function public.ai_approve_document_review(
  p_document_id uuid,
  p_reviewer text,
  p_reason text,
  p_manifest_sha256 text,
  p_source_sha256 text,
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
  v_document public.ai_raw_document%rowtype;
  v_object public.ops_raw_object%rowtype;
  v_space public.ai_knowledge_space%rowtype;
  v_review public.ai_document_review%rowtype;
begin
  if btrim(coalesce(p_reviewer, '')) = ''
     or length(p_reviewer) > 200
     or btrim(coalesce(p_reason, '')) = ''
     or length(p_reason) > 1000
     or btrim(coalesce(p_pipeline_version, '')) = ''
     or btrim(coalesce(p_embedding_model, '')) = '' then
    raise exception 'reviewer, reason, pipeline and embedding model are required and bounded'
      using errcode = '22023';
  end if;

  if p_manifest_sha256 is null
     or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
     or p_source_sha256 is null
     or p_source_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'review manifest and source SHA-256 must be lowercase hex'
      using errcode = '22023';
  end if;

  select document.* into strict v_document
  from public.ai_raw_document as document
  where document.document_id = p_document_id
  for update;

  select object.* into strict v_object
  from public.ops_raw_object as object
  where object.raw_object_id = v_document.raw_object_id;

  select space.* into strict v_space
  from public.ai_knowledge_space as space
  where space.space_id = v_document.space_id;

  if v_object.sha256::text <> p_source_sha256 then
    raise exception 'review source SHA-256 does not match raw object'
      using errcode = '23514';
  end if;

  if v_document.data_class not in ('C1', 'C2') then
    raise exception 'only C1/C2 documents can be approved without a redaction pipeline'
      using errcode = '42501';
  end if;

  select review.* into v_review
  from public.ai_document_review as review
  where review.document_id = p_document_id;

  if found then
    if v_review.reviewer <> p_reviewer
       or v_review.reason <> p_reason
       or v_review.manifest_sha256::text <> p_manifest_sha256
       or v_review.source_sha256::text <> p_source_sha256
       or v_review.pipeline_version <> p_pipeline_version
       or v_review.embedding_model <> p_embedding_model then
      raise exception 'document already has a different review decision'
        using errcode = '23505';
    end if;
    return v_document;
  end if;

  if v_space.rag_policy <> 'REVIEW_REQUIRED'
     or v_document.status <> 'REVIEW_REQUIRED'
     or v_document.rag_eligibility <> 'REVIEW_REQUIRED'
     or v_document.is_current
     or v_document.published_ingest_run_id is not null then
    raise exception 'document is not awaiting a C1/C2 RAG review decision'
      using errcode = '23514';
  end if;

  insert into public.ai_document_review (
    document_id,
    decision,
    reviewer,
    reason,
    manifest_sha256,
    source_sha256,
    pipeline_version,
    embedding_model
  )
  values (
    p_document_id,
    'APPROVE_RAG',
    p_reviewer,
    p_reason,
    p_manifest_sha256::character(64),
    p_source_sha256::character(64),
    p_pipeline_version,
    p_embedding_model
  );

  update public.ai_raw_document
  set rag_eligibility = 'ALLOWED',
      status = 'QUEUED'
  where document_id = p_document_id
  returning * into v_document;

  insert into public.ai_ingest_run (
    document_id,
    pipeline_version,
    embedding_model
  )
  values (
    p_document_id,
    p_pipeline_version,
    p_embedding_model
  );

  return v_document;
end;
$$;

comment on function public.ai_approve_document_review(uuid, text, text, text, text, text, text) is
  'Atomically records one immutable C1/C2 review approval and queues the exact reviewed source bytes for RAG; C3/C4 are rejected until genuine redaction is implemented.';

revoke all on function public.ai_approve_document_review(uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.ai_approve_document_review(uuid, text, text, text, text, text, text)
  to service_role, hc_ai_ingestor;
