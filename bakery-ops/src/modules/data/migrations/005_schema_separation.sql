-- Migration 005: Schema Separation
-- Moves tables from public schema to module-specific schemas
-- Execute ONLY after Phase 1-4 are stable and all features verified
-- PREREQUISITE: Run pg_dump backup before executing this migration

-- Create schemas
CREATE SCHEMA IF NOT EXISTS recruitment;
CREATE SCHEMA IF NOT EXISTS supplychain;
CREATE SCHEMA IF NOT EXISTS marketing;
CREATE SCHEMA IF NOT EXISTS forecast;
CREATE SCHEMA IF NOT EXISTS kitchen;

-- ===== Recruitment Schema =====
ALTER TABLE IF EXISTS employees SET SCHEMA recruitment;
ALTER TABLE IF EXISTS employee_events SET SCHEMA recruitment;
ALTER TABLE IF EXISTS screening_rules SET SCHEMA recruitment;
ALTER TABLE IF EXISTS recruitment_runs SET SCHEMA recruitment;

-- ===== Supply Chain Schema =====
ALTER TABLE IF EXISTS supply_orders SET SCHEMA supplychain;
ALTER TABLE IF EXISTS arrival_records SET SCHEMA supplychain;
ALTER TABLE IF EXISTS suppliers SET SCHEMA supplychain;

-- ===== Marketing Schema =====
ALTER TABLE IF EXISTS kols SET SCHEMA marketing;
ALTER TABLE IF EXISTS kol_collaborations SET SCHEMA marketing;
ALTER TABLE IF EXISTS marketing_chat_samples SET SCHEMA marketing;

-- ===== Forecast Schema =====
ALTER TABLE IF EXISTS product SET SCHEMA forecast;
ALTER TABLE IF EXISTS product_strategy SET SCHEMA forecast;
ALTER TABLE IF EXISTS product_sales_baseline SET SCHEMA forecast;
ALTER TABLE IF EXISTS product_alias SET SCHEMA forecast;
ALTER TABLE IF EXISTS daily_sales_record SET SCHEMA forecast;
ALTER TABLE IF EXISTS timeslot_sales_record SET SCHEMA forecast;
ALTER TABLE IF EXISTS fixed_shipment_schedule SET SCHEMA forecast;
ALTER TABLE IF EXISTS out_of_stock_record SET SCHEMA forecast;
ALTER TABLE IF EXISTS daily_revenue SET SCHEMA forecast;
ALTER TABLE IF EXISTS daily_review SET SCHEMA forecast;
ALTER TABLE IF EXISTS context_event SET SCHEMA forecast;
ALTER TABLE IF EXISTS holiday SET SCHEMA forecast;
ALTER TABLE IF EXISTS empowerment_event SET SCHEMA forecast;
ALTER TABLE IF EXISTS prompt_segment SET SCHEMA forecast;
ALTER TABLE IF EXISTS prompt_template SET SCHEMA forecast;

-- ===== Public Schema (shared) =====
-- Keep in public: users, business_rule, audit_log

-- NOTE: After running this migration, update Repository constants:
-- const FORECAST_SCHEMA = 'forecast';
-- Use `${FORECAST_SCHEMA}.product` instead of `product` in all queries
