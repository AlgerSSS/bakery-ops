begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(8);

create temporary table agent_context as
select (public.ops_start_agent_run(
  'KNOWLEDGE_QA', 'SCHEDULE', 'test:knowledge:2026-08-20', 'test-model-v1', 'test-prompt-v1'
)).agent_run_id;

select extensions.is((select agent_run_id from public.ops_start_agent_run(
  'KNOWLEDGE_QA', 'SCHEDULE', 'test:knowledge:2026-08-20', 'test-model-v1', 'test-prompt-v1'
)), (select agent_run_id from agent_context), 'Agent start is idempotent by type and dedupe key');

create temporary table agent_claim as
select * from public.ops_claim_agent_run('agent-worker-a', 600);
select extensions.ok((select agent_run_id is not null and status = 'RUNNING' from agent_claim), 'Agent worker claims one pending run');

select extensions.is((select status from public.ops_finish_agent_run(
  (select agent_run_id from agent_claim), 'agent-worker-a', 'AWAITING_APPROVAL',
  '{"proposal":"send report"}'::jsonb, null
)), 'AWAITING_APPROVAL', 'Agent run can pause for approval without being marked finished');

create temporary table approval_context as
select (public.ops_append_agent_event(
  (select agent_run_id from agent_context), 'APPROVED', 'v1', 'SYSTEM', 'approval:test:1',
  '{"approved":true}'::jsonb
)).agent_event_id;

select extensions.is((select agent_event_id from public.ops_append_agent_event(
  (select agent_run_id from agent_context), 'APPROVED', 'v1', 'SYSTEM', 'approval:test:1',
  '{"approved":true}'::jsonb
)), (select agent_event_id from approval_context), 'duplicate approval callbacks return the original event');

select extensions.is((select count(*)::integer from public.ops_agent_event), 1,
  'duplicate approval callbacks do not append duplicate events');
select extensions.is((select status from public.ops_agent_run where agent_run_id = (select agent_run_id from agent_context)),
  'PENDING', 'approval moves the paused run back to the pending queue exactly once');

select extensions.throws_ok($$ update public.ops_agent_event set payload = '{}'::jsonb $$,
  '55000', 'ops_agent_event is append-only; create a new event instead', 'Agent events cannot be updated');
select extensions.throws_ok($$ delete from public.ops_agent_event $$,
  '55000', 'ops_agent_event is append-only; create a new event instead', 'Agent events cannot be deleted');

select * from extensions.finish();
rollback;
