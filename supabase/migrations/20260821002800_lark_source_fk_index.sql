-- PostgreSQL does not index foreign keys automatically. This dedicated index
-- keeps sync-run retention/restrict checks and run-to-item diagnostics bounded.

create index ai_source_item_last_seen_run_idx
  on public.ai_source_item (last_seen_sync_run_id);

comment on index public.ai_source_item_last_seen_run_idx is
  'Supports the ai_source_item.last_seen_sync_run_id foreign key and sync-run to source-item diagnostics without scanning the source inventory.';
