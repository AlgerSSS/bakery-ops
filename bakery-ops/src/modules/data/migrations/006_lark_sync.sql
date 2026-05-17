-- 006: Add lark_record_id to employees for Feishu Base sync
ALTER TABLE employees ADD COLUMN IF NOT EXISTS lark_record_id TEXT;
CREATE INDEX IF NOT EXISTS idx_employees_lark_record_id ON employees(lark_record_id) WHERE lark_record_id IS NOT NULL;
