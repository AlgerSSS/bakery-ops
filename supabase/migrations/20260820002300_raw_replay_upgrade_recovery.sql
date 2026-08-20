-- Resolve immutable Raw objects across client idempotency-key upgrades and
-- explicitly close empty receiving batches left by an interrupted client.

create or replace function public.ops_resolve_raw_object(
  p_bucket_id text,
  p_object_path text,
  p_sha256 character(64),
  p_size_bytes bigint,
  p_mime_type text,
  p_data_class text,
  p_source_record_key text default null,
  p_source_version text default null
)
returns setof public.ops_raw_object
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_object public.ops_raw_object%rowtype;
begin
  select * into v_object
  from public.ops_raw_object
  where bucket_id = p_bucket_id
    and object_path = p_object_path;

  if not found then
    return;
  end if;

  if v_object.sha256 <> p_sha256
     or v_object.size_bytes <> p_size_bytes
     or v_object.mime_type <> p_mime_type
     or v_object.data_class <> p_data_class
     or v_object.source_record_key is distinct from p_source_record_key
     or v_object.source_version is distinct from p_source_version then
    raise exception 'object path already exists with different immutable attributes'
      using errcode = '23505';
  end if;

  return next v_object;
end;
$$;

comment on function public.ops_resolve_raw_object(text, text, character, bigint, text, text, text, text) is
  'Returns an existing Raw object only when all immutable attributes match, allowing safe replay across client batch-key upgrades.';

create or replace function public.ops_abandon_empty_raw_batch(
  p_batch_id uuid,
  p_reason text,
  p_actor text
)
returns public.ops_raw_batch
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_batch public.ops_raw_batch%rowtype;
begin
  if btrim(coalesce(p_reason, '')) = '' or btrim(coalesce(p_actor, '')) = '' then
    raise exception 'abandonment reason and actor are required' using errcode = '22023';
  end if;

  select * into strict v_batch
  from public.ops_raw_batch
  where batch_id = p_batch_id
  for update;

  if v_batch.status = 'FAILED'
     and v_batch.metadata ->> 'abandoned_by' = p_actor
     and v_batch.error_summary = left(p_reason, 2000) then
    return v_batch;
  end if;

  if v_batch.status <> 'RECEIVING'
     or exists (
       select 1
       from public.ops_raw_object as object
       where object.batch_id = p_batch_id
     ) then
    raise exception 'only an empty RECEIVING batch can be abandoned' using errcode = '23514';
  end if;

  update public.ops_raw_batch
  set status = 'FAILED',
      rejected_count = coalesce(expected_count, 0),
      completed_at = now(),
      error_summary = left(p_reason, 2000),
      metadata = metadata || jsonb_build_object(
        'abandoned_by', p_actor,
        'abandoned_at', now(),
        'health_impact', 'acknowledged_client_recovery'
      )
  where batch_id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;

comment on function public.ops_abandon_empty_raw_batch(uuid, text, text) is
  'Marks only an empty RECEIVING Raw batch as FAILED with auditable recovery metadata; idempotent for the same actor and reason.';

revoke all on function public.ops_resolve_raw_object(text, text, character, bigint, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.ops_abandon_empty_raw_batch(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.ops_resolve_raw_object(text, text, character, bigint, text, text, text, text),
                          public.ops_abandon_empty_raw_batch(uuid, text, text)
  to service_role, hc_ai_ingestor;
