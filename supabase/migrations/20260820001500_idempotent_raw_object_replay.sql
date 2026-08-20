-- A completed batch may be replayed after a client timeout. Return its existing
-- immutable object before enforcing RECEIVING for genuinely new objects.

create or replace function public.ops_register_raw_object(
  p_batch_id uuid,
  p_bucket_id text,
  p_object_path text,
  p_sha256 character(64),
  p_size_bytes bigint,
  p_mime_type text,
  p_data_class text,
  p_source_record_key text default null,
  p_source_version text default null
)
returns public.ops_raw_object
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_batch_status text;
  v_object public.ops_raw_object%rowtype;
begin
  select * into v_object
  from public.ops_raw_object
  where bucket_id = p_bucket_id and object_path = p_object_path;

  if found then
    if v_object.batch_id <> p_batch_id
       or v_object.sha256 <> p_sha256
       or v_object.size_bytes <> p_size_bytes
       or v_object.mime_type <> p_mime_type
       or v_object.data_class <> p_data_class
       or v_object.source_record_key is distinct from p_source_record_key
       or v_object.source_version is distinct from p_source_version then
      raise exception 'object path already exists with different immutable attributes'
        using errcode = '23505';
    end if;
    return v_object;
  end if;

  select status into strict v_batch_status
  from public.ops_raw_batch
  where batch_id = p_batch_id
  for update;

  if v_batch_status <> 'RECEIVING' then
    raise exception 'raw objects can only be registered while batch is RECEIVING'
      using errcode = '23514';
  end if;

  insert into public.ops_raw_object (
    batch_id,
    bucket_id,
    object_path,
    sha256,
    size_bytes,
    mime_type,
    data_class,
    source_record_key,
    source_version
  )
  values (
    p_batch_id,
    p_bucket_id,
    p_object_path,
    p_sha256,
    p_size_bytes,
    p_mime_type,
    p_data_class,
    p_source_record_key,
    p_source_version
  )
  on conflict (bucket_id, object_path) do nothing
  returning * into v_object;

  if not found then
    select * into strict v_object
    from public.ops_raw_object
    where bucket_id = p_bucket_id and object_path = p_object_path;

    if v_object.batch_id <> p_batch_id
       or v_object.sha256 <> p_sha256
       or v_object.size_bytes <> p_size_bytes
       or v_object.mime_type <> p_mime_type
       or v_object.data_class <> p_data_class
       or v_object.source_record_key is distinct from p_source_record_key
       or v_object.source_version is distinct from p_source_version then
      raise exception 'object path already exists with different immutable attributes'
        using errcode = '23505';
    end if;
  end if;

  return v_object;
end;
$$;
