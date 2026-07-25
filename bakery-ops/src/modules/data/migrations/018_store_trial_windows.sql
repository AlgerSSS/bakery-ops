-- Migration 018: per-store, per-role trial-shift windows (additive, IF NOT EXISTS).
-- Trial slots are role-specific (FOH vs BOH have different times/durations) so they can't reuse the
-- single interview_windows. Shape: {"FOH":["12:00","14:00"], "BOH":["10:00","14:00"]} (applied every day).
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS trial_windows JSONB NOT NULL DEFAULT '{}';
