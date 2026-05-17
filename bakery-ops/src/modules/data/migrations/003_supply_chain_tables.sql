-- Migration 003: Supply Chain Tables
-- Creates supply chain related tables in public schema (Phase 1-4)
-- Phase 5 will move these to supplychain schema

CREATE TABLE IF NOT EXISTS supply_orders (
  id SERIAL PRIMARY KEY,
  supplier_name VARCHAR(200) NOT NULL,
  order_date VARCHAR(10) NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS arrival_records (
  id SERIAL PRIMARY KEY,
  supplier_name VARCHAR(200) NOT NULL,
  arrival_date VARCHAR(10) NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supply_orders_date ON supply_orders (order_date);
CREATE INDEX IF NOT EXISTS idx_arrival_records_date ON arrival_records (arrival_date);
