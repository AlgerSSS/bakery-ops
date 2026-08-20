-- Human read policies, internal policy helpers and invariant triggers.

create or replace function private.is_space_member(
  p_space_id uuid,
  p_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.ai_space_member as member
      where member.space_id = p_space_id
        and member.user_id = (select auth.uid())
        and (p_roles is null or member.role = any (p_roles))
    );
$$;

comment on function private.is_space_member(uuid, text[]) is
  'RLS helper that checks the current authenticated user against explicit knowledge-space membership.';

revoke all on function private.is_space_member(uuid, text[]) from public;
grant execute on function private.is_space_member(uuid, text[]) to authenticated, service_role;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger ai_knowledge_space_set_updated_at
before update on public.ai_knowledge_space
for each row execute function private.set_updated_at();

create or replace function private.enforce_ai_chunk_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.ai_raw_document%rowtype;
  v_run public.ai_ingest_run%rowtype;
begin
  select * into strict v_run
  from public.ai_ingest_run
  where ingest_run_id = new.ingest_run_id;

  select * into strict v_document
  from public.ai_raw_document
  where document_id = new.document_id;

  if v_run.document_id <> new.document_id then
    raise exception 'chunk document does not match ingest run' using errcode = '23514';
  end if;

  if v_run.status <> 'RUNNING' then
    raise exception 'chunks can only be staged into a running ingest run' using errcode = '23514';
  end if;

  if v_document.data_class = 'C4' or v_document.rag_eligibility = 'DENIED' then
    raise exception 'document classification forbids RAG chunks' using errcode = '42501';
  end if;

  if (v_document.data_class = 'C3' or v_document.rag_eligibility = 'REDACTED_ONLY')
     and not new.is_redacted then
    raise exception 'restricted document chunks must be explicitly redacted' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger ai_document_chunk_enforce_policy
before insert or update on public.ai_document_chunk
for each row execute function private.enforce_ai_chunk_policy();

create or replace function private.enforce_ai_embedding_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_model text;
  v_status text;
begin
  select run.embedding_model, run.status
    into strict v_expected_model, v_status
  from public.ai_document_chunk as chunk
  join public.ai_ingest_run as run on run.ingest_run_id = chunk.ingest_run_id
  where chunk.chunk_id = new.chunk_id;

  if v_status <> 'RUNNING' then
    raise exception 'embeddings can only be staged into a running ingest run' using errcode = '23514';
  end if;

  if new.model_version <> v_expected_model then
    raise exception 'embedding model does not match ingest run' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger ai_chunk_embedding_enforce_policy
before insert or update on public.ai_chunk_embedding
for each row execute function private.enforce_ai_embedding_policy();

revoke all on all tables in schema public from anon, authenticated;

grant select on public.pipeline_health to authenticated;
grant select on public.ai_knowledge_space to authenticated;
grant select on public.ai_space_member to authenticated;
grant select on public.ai_raw_document to authenticated;
grant select on public.ai_ingest_run to authenticated;
grant select on public.ai_document_chunk to authenticated;
grant select on public.ops_agent_run to authenticated;
grant select on public.ops_agent_event to authenticated;

create policy ai_knowledge_space_member_select
on public.ai_knowledge_space
for select
to authenticated
using ((select private.is_space_member(space_id, null)));

create policy ai_space_member_self_or_admin_select
on public.ai_space_member
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_space_member(space_id, array['ADMIN']::text[]))
);

create policy ai_raw_document_member_select
on public.ai_raw_document
for select
to authenticated
using ((select private.is_space_member(space_id, null)));

create policy ai_ingest_run_member_select
on public.ai_ingest_run
for select
to authenticated
using (
  exists (
    select 1
    from public.ai_raw_document as document
    where document.document_id = ai_ingest_run.document_id
      and (select private.is_space_member(document.space_id, null))
  )
);

create policy ai_document_chunk_member_select
on public.ai_document_chunk
for select
to authenticated
using (
  exists (
    select 1
    from public.ai_raw_document as document
    where document.document_id = ai_document_chunk.document_id
      and (select private.is_space_member(document.space_id, null))
  )
);

create policy ops_agent_run_requester_select
on public.ops_agent_run
for select
to authenticated
using (requested_by_user_id = (select auth.uid()));

create policy ops_agent_event_requester_select
on public.ops_agent_event
for select
to authenticated
using (
  exists (
    select 1
    from public.ops_agent_run as run
    where run.agent_run_id = ops_agent_event.agent_run_id
      and run.requested_by_user_id = (select auth.uid())
  )
);

create policy pipeline_health_authenticated_select
on public.pipeline_health
for select
to authenticated
using (true);
