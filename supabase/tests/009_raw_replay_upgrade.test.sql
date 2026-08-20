begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(10);

select extensions.has_function(
  'public', 'ops_resolve_raw_object',
  array['text', 'text', 'character', 'bigint', 'text', 'text', 'text', 'text'],
  'Raw replay exposes an immutable existing-object resolver'
);
select extensions.has_function(
  'public', 'ops_abandon_empty_raw_batch', array['uuid', 'text', 'text'],
  'Raw replay exposes an empty-batch abandonment RPC'
);
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.ops_resolve_raw_object(text,text,character,bigint,text,text,text,text)',
    'execute'
  ),
  'authenticated users cannot resolve Raw control-plane objects'
);

create temporary table replay_batch as
select (public.ops_register_raw_batch(
  'BRAIN_PDF', 'test-replay-existing', 'brain-pdf-v1', 'pg-tap', null,
  null, null, 1, '{}'::jsonb
)).batch_id;

select extensions.is(
  (
    select count(*)::integer
    from public.ops_resolve_raw_object(
      'kb-internal', 'test/replay/existing.pdf', repeat('a', 64)::character(64),
      100, 'application/pdf', 'C1', 'document-a', '1'
    )
  ),
  0,
  'resolver returns no row when the immutable object is absent'
);

create temporary table replay_object as
select (public.ops_register_raw_object(
  (select batch_id from replay_batch),
  'kb-internal', 'test/replay/existing.pdf', repeat('a', 64)::character(64),
  100, 'application/pdf', 'C1', 'document-a', '1'
)).raw_object_id;

select extensions.is(
  (
    select raw_object_id
    from public.ops_resolve_raw_object(
      'kb-internal', 'test/replay/existing.pdf', repeat('a', 64)::character(64),
      100, 'application/pdf', 'C1', 'document-a', '1'
    )
  ),
  (select raw_object_id from replay_object),
  'resolver reuses an identical object without requiring its original batch key'
);
select extensions.throws_ok($$
  select * from public.ops_resolve_raw_object(
    'kb-internal', 'test/replay/existing.pdf', repeat('b', 64)::character(64),
    100, 'application/pdf', 'C1', 'document-a', '1'
  )
$$, '23505', 'object path already exists with different immutable attributes',
  'resolver rejects a hash conflict at an existing object path');

create temporary table empty_batch as
select (public.ops_register_raw_batch(
  'BRAIN_PDF', 'test-replay-empty', 'brain-pdf-v1', 'pg-tap', null,
  null, null, 1, '{}'::jsonb
)).batch_id;

select extensions.is(
  (select status from public.ops_abandon_empty_raw_batch(
    (select batch_id from empty_batch), 'client upgrade recovery', 'pg-tap'
  )),
  'FAILED',
  'an empty receiving batch can be explicitly abandoned'
);
select extensions.is(
  (select status from public.ops_abandon_empty_raw_batch(
    (select batch_id from empty_batch), 'client upgrade recovery', 'pg-tap'
  )),
  'FAILED',
  'empty batch abandonment is idempotent'
);
select extensions.throws_ok($$
  select public.ops_abandon_empty_raw_batch(
    (select batch_id from replay_batch), 'must fail', 'pg-tap'
  )
$$, '23514', 'only an empty RECEIVING batch can be abandoned',
  'a batch with an immutable object cannot be abandoned');
select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.ops_abandon_empty_raw_batch(uuid,text,text)',
    'execute'
  ),
  'service role can execute controlled empty-batch recovery'
);

select * from extensions.finish();
rollback;
