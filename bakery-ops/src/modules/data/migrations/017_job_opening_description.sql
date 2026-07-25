-- Migration 017: add job_openings.description (additive). PUBLIC schema, IF NOT EXISTS — safe to re-run.
-- WHY: the candidate FSM's "2 = more info" reply sends the role's job description. We store it on the
-- opening (sourced from the JobStreet ad, or an editable default blurb) so the bot can answer instantly.

ALTER TABLE public.job_openings ADD COLUMN IF NOT EXISTS description TEXT;
