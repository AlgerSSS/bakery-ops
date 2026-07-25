-- Migration 011: enforce one sales record per (product_name, date)
-- Run in Supabase SQL Editor. Idempotent.
--
-- daily_sales_record had no uniqueness guard, so writers (res_api/sync-to-db.js and
-- the Excel importers) could emit two rows for the same product on the same date when
-- the source listed a product on multiple line items. That double-counted those days
-- and skewed product_sales_baseline (the baseline pushes each row as a separate sample).
-- Existing duplicates were merged by SUMMING quantity per (product_name, date) before
-- this constraint was added. The writers now pre-aggregate by (product_name, date), and
-- this constraint is the backstop against regressions.
--
-- NOTE: the natural key is (product_name, date), NOT (standard_name, date) — multiple
-- product_names legitimately map to one standard_name (aliases), so standard_name is
-- intentionally NOT part of the key.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_daily_sales_record_product_date'
  ) THEN
    ALTER TABLE daily_sales_record
      ADD CONSTRAINT uq_daily_sales_record_product_date UNIQUE (product_name, date);
  END IF;
END $$;
