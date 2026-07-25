-- Migration 016: Drop the dead recruitment_runs table (DESTRUCTIVE — owner applies manually)
-- PUBLIC schema. NOT auto-applied: this DROPs a table, so the migration runner must skip it and the
-- owner runs it by hand after confirming the table is empty / no longer needed.
--
-- WHY: recruitment_runs was created by 001_core_tables.sql for the old AJobThing crawl/score flow.
-- That flow has been fully removed. The funnel is now modeled by 013_recruitment_funnel.sql
-- (job_openings + applications + candidate_conversations + appointments + trials + offers). No
-- TypeScript repository reads or writes recruitment_runs — the only remaining references are its
-- CREATE in 001 and the schema-move in 005_schema_separation.sql (005 was never applied). The table
-- is therefore dead and superseded by 013's applications/job_openings.
--
-- VERIFY BEFORE APPLYING: confirm the table holds no rows you still need
-- (SELECT count(*) FROM public.recruitment_runs;). 005's `ALTER TABLE IF EXISTS recruitment_runs SET
-- SCHEMA recruitment` becomes a guarded no-op once this table is gone.

DROP TABLE IF EXISTS public.recruitment_runs;
