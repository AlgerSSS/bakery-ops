-- Capability roles. Login credentials are created out-of-band and inherit one role only.

do $$
declare
  v_role text;
begin
  foreach v_role in array array[
    'hc_pos_writer',
    'hc_ops_processor',
    'hc_ai_ingestor',
    'hc_agent_worker',
    'hc_hr_worker',
    'hc_scm_worker',
    'hc_msg_worker'
  ]
  loop
    if not exists (select 1 from pg_roles where rolname = v_role) then
      execute format('create role %I nologin noinherit', v_role);
    end if;
  end loop;
end;
$$;

grant usage on schema public, extensions to
  hc_pos_writer,
  hc_ops_processor,
  hc_ai_ingestor,
  hc_agent_worker,
  hc_hr_worker,
  hc_scm_worker,
  hc_msg_worker;

revoke all on table
  public.ops_raw_batch,
  public.ops_raw_object,
  public.ops_processing_run,
  public.pipeline_health,
  public.ai_knowledge_space,
  public.ai_space_member,
  public.ai_raw_document,
  public.ai_ingest_run,
  public.ai_document_chunk,
  public.ai_chunk_embedding,
  public.ops_agent_run,
  public.ops_agent_event
from service_role;

grant execute on function public.ops_register_raw_batch(text, text, text, text, text, timestamptz, timestamptz, bigint, jsonb)
  to hc_pos_writer, hc_hr_worker, hc_scm_worker;
grant execute on function public.ops_register_raw_object(uuid, text, text, character, bigint, text, text, text, text)
  to hc_pos_writer, hc_hr_worker, hc_scm_worker, hc_ai_ingestor;
grant execute on function public.ops_complete_raw_batch(uuid, bigint, bigint, text[], text, text)
  to hc_pos_writer, hc_hr_worker, hc_scm_worker, hc_ai_ingestor;

grant execute on function public.ops_claim_processing_run(text, integer),
                          public.ops_heartbeat_processing_run(bigint, text, integer),
                          public.ops_finish_processing_run(bigint, text, text, bigint, bigint, bigint, jsonb),
                          public.ops_fail_processing_run(bigint, text, text, text, boolean, integer, integer)
  to hc_ops_processor;

grant execute on function public.ai_finalize_document_upload(uuid, uuid, text, integer, text, text, text, text),
                          public.ai_claim_ingest_run(text, integer),
                          public.ai_heartbeat_ingest_run(bigint, text, text, integer, jsonb),
                          public.ai_stage_ingest_batch(bigint, text, jsonb, boolean),
                          public.ai_publish_ingest_run(bigint, text, integer, integer, integer, jsonb),
                          public.ai_fail_ingest_run(bigint, text, text, text, boolean, integer, integer, jsonb),
                          public.ai_search_knowledge(text, extensions.vector, integer, uuid[], text)
  to hc_ai_ingestor;

grant execute on function public.ops_start_agent_run(text, text, text, text, text, text, uuid, jsonb, smallint, timestamptz),
                          public.ops_claim_agent_run(text, integer),
                          public.ops_heartbeat_agent_run(uuid, text, integer),
                          public.ops_append_agent_event(uuid, text, text, text, text, jsonb, uuid, timestamptz),
                          public.ops_finish_agent_run(uuid, text, text, jsonb, text),
                          public.ai_search_knowledge(text, extensions.vector, integer, uuid[], text)
  to hc_agent_worker;

comment on role hc_pos_writer is 'RES POS ingestion capability; raw batch RPC only until POS domain grants are added.';
comment on role hc_ops_processor is 'Structured processing capability; claims and finishes versioned processing runs.';
comment on role hc_ai_ingestor is 'Document ingestion capability; controlled Storage metadata and RAG RPCs only.';
comment on role hc_agent_worker is 'Agent orchestration capability; Agent run/event and scoped RAG RPCs only.';
comment on role hc_hr_worker is 'HR source-ingestion capability; HR-domain grants are added with the HR vertical slice.';
comment on role hc_scm_worker is 'Supply-chain source-ingestion capability; SCM-domain grants are added with that vertical slice.';
comment on role hc_msg_worker is 'Messaging worker capability; messaging-domain grants remain outside this foundation migration.';
