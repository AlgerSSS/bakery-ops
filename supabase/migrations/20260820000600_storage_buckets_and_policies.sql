-- Private Storage buckets and initial knowledge-space boundaries.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('raw-business-private', 'raw-business-private', false, 104857600, array[
    'application/json', 'text/csv', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf'
  ]),
  ('kb-internal', 'kb-internal', false, 104857600, array['application/pdf']),
  ('hr-recruiting-private', 'hr-recruiting-private', false, 104857600, array['application/pdf']),
  ('hr-payroll-private', 'hr-payroll-private', false, 104857600, array['application/pdf']),
  ('finance-private', 'finance-private', false, 104857600, array[
    'application/pdf', 'text/csv', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]),
  ('legal-private', 'legal-private', false, 104857600, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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
  ('10000000-0000-7000-8000-000000000001', 'kb_internal', 'Internal Knowledge', 'kb-internal', 'C1', 'AUTO', null),
  ('10000000-0000-7000-8000-000000000002', 'hr_recruiting', 'Recruiting Restricted', 'hr-recruiting-private', 'C3', 'REDACTED_ONLY', 2555),
  ('10000000-0000-7000-8000-000000000003', 'hr_payroll', 'Payroll Sealed', 'hr-payroll-private', 'C4', 'DENY', 2555),
  ('10000000-0000-7000-8000-000000000004', 'finance_private', 'Finance Private', 'finance-private', 'C3', 'DENY', 2555),
  ('10000000-0000-7000-8000-000000000005', 'legal_private', 'Legal Restricted', 'legal-private', 'C3', 'REDACTED_ONLY', 3650)
on conflict (space_code) do update
set display_name = excluded.display_name,
    bucket_id = excluded.bucket_id,
    data_class = excluded.data_class,
    rag_policy = excluded.rag_policy,
    retention_days = excluded.retention_days,
    is_active = true;

create policy storage_knowledge_member_select
on storage.objects
for select
to authenticated
using (
  bucket_id in (
    'kb-internal',
    'hr-recruiting-private',
    'hr-payroll-private',
    'finance-private',
    'legal-private'
  )
  and (storage.foldername(name))[1] is not null
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (select private.is_space_member(((storage.foldername(name))[1])::uuid, null))
);
