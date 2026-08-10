-- HOT CRUSH Core V1 R6 / 001 extensions and immutable helpers; custom roles deliberately deferred
-- Generated deterministically. Do not hand-edit.
-- The psycopg2 apply runner owns the sole transaction, lock and SET LOCAL state.

DO $hotcrush_extensions$
BEGIN
  PERFORM 1 FROM pg_catalog.pg_namespace WHERE nspname = 'extensions';
  IF NOT FOUND THEN
    EXECUTE 'CREATE SCHEMA extensions';
  END IF;
  PERFORM 1 FROM pg_catalog.pg_extension WHERE extname = 'pgcrypto';
  IF NOT FOUND THEN
    EXECUTE 'CREATE EXTENSION pgcrypto WITH SCHEMA extensions';
  END IF;
  PERFORM 1 FROM pg_catalog.pg_extension WHERE extname = 'citext';
  IF NOT FOUND THEN
    EXECUTE 'CREATE EXTENSION citext WITH SCHEMA extensions';
  END IF;
  PERFORM 1 FROM pg_catalog.pg_extension WHERE extname = 'btree_gist';
  IF NOT FOUND THEN
    EXECUTE 'CREATE EXTENSION btree_gist WITH SCHEMA extensions';
  END IF;
END
$hotcrush_extensions$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC, "anon", "authenticated", "service_role";
GRANT USAGE ON SCHEMA public TO PUBLIC, "anon", "authenticated", "service_role";

CREATE FUNCTION public.app_normalize_alias_v1(pg_catalog.text)
RETURNS pg_catalog.text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $hotcrush_function$
  SELECT pg_catalog.lower(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.replace($1, pg_catalog.chr(160), ' '),
        '[[:space:]]+',
        ' ',
        'g'
      )
    )
  )
$hotcrush_function$;
REVOKE EXECUTE ON FUNCTION public.app_normalize_alias_v1(pg_catalog.text) FROM PUBLIC, "anon", "authenticated", "service_role";
COMMENT ON FUNCTION public.app_normalize_alias_v1(pg_catalog.text) IS 'Immutable v1 alias normalization: replaces NBSP, collapses whitespace, trims and lowercases; not a display-name formatter.';
