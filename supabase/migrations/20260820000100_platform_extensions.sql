-- Foundation extensions and private helper schema.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

comment on schema private is
  'HOT CRUSH internal helper functions; not exposed through the Data API.';
