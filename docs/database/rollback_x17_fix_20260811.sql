-- 回滚 ×1.7 修复（2026-08-11）。以表 owner（postgres）执行。
BEGIN;
ALTER TABLE cost_card_recipe DISABLE TRIGGER cost_card_recipe_protect;
UPDATE cost_card_recipe SET status='archived', effective_to=CURRENT_DATE WHERE item_id IN (34,35,62,63,64,92,93,94) AND version=2;
UPDATE cost_card_recipe SET status='published', effective_to=NULL WHERE item_id IN (34,35,62,63,64,92,93,94) AND version=1;
ALTER TABLE cost_card_recipe ENABLE TRIGGER cost_card_recipe_protect;
COMMIT;