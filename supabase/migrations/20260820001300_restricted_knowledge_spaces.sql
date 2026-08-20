-- C2 documents need a boundary above C1 but below sealed HR/finance/legal
-- spaces. HR policies get a separate membership boundary while sharing the
-- same private bucket; the space UUID remains the first object-path segment.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kb-restricted', 'kb-restricted', false, 104857600, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.ai_knowledge_space
  drop constraint ai_knowledge_space_bucket_ck;

alter table public.ai_knowledge_space
  add constraint ai_knowledge_space_bucket_ck check (bucket_id in (
    'kb-internal',
    'kb-restricted',
    'hr-recruiting-private',
    'hr-payroll-private',
    'finance-private',
    'legal-private'
  ));

alter table public.ai_knowledge_space
  drop constraint ai_knowledge_space_rag_policy_ck;

alter table public.ai_knowledge_space
  add constraint ai_knowledge_space_rag_policy_ck check (
    rag_policy in ('AUTO', 'REVIEW_REQUIRED', 'REDACTED_ONLY', 'DENY')
  );

insert into public.ai_knowledge_space (
  space_id,
  space_code,
  display_name,
  bucket_id,
  data_class,
  rag_policy,
  retention_days
)
values
  ('10000000-0000-7000-8000-000000000006', 'kb_restricted', 'Restricted Internal Knowledge', 'kb-restricted', 'C2', 'REVIEW_REQUIRED', null),
  ('10000000-0000-7000-8000-000000000007', 'hr_policy_restricted', 'HR Policy Restricted', 'kb-restricted', 'C2', 'REVIEW_REQUIRED', 2555)
on conflict (space_code) do update
set display_name = excluded.display_name,
    bucket_id = excluded.bucket_id,
    data_class = excluded.data_class,
    rag_policy = excluded.rag_policy,
    retention_days = excluded.retention_days,
    is_active = true;

alter policy storage_knowledge_member_select
on storage.objects
using (
  bucket_id in (
    'kb-internal',
    'kb-restricted',
    'hr-recruiting-private',
    'hr-payroll-private',
    'finance-private',
    'legal-private'
  )
  and (storage.foldername(name))[1] is not null
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (select private.is_space_member(((storage.foldername(name))[1])::uuid, null))
);
