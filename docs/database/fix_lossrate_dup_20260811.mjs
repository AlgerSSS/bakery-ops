// 修复成本卡 loss_rate 冗余双算（2026-08-11）。
// 结论依据（三条证据链，详见 HANDOFF 2026-08-11 条目）：
//   1. 成本引擎 v_cost_card_recipe_expanded 公式 = quantity × (1+loss_rate) ÷ net_yield，两字段同时生效；
//   2. 全库已发布配方中 loss_rate>0 的行【全部】满足 loss_rate = 1 − net_yield（58 行互补，0 行例外），
//      同一份修整损耗被编码两次；不存在合法的双因子行；
//   3. 物理自洽：腌制牛肉批产 1320g = Σ配方行用量，证明行用量是入批净料、净得率仅用于折算采购毛料，
//      ×(1+loss) 无物理对应（引擎展开西冷 204.545g/个 vs 自洽值 151.5g/个，正是惠灵顿 13.92→11.23 的差额）。
// 修法：受影响 47 个已发布配方各发新版本（冗余行 loss_rate→0，其余原样复制），旧版归档保留。
// 用法：node docs/database/fix_lossrate_dup_20260811.mjs
import postgres from '/Users/weiliangshao/hot/res_api/node_modules/postgres/src/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = readFileSync('/Users/weiliangshao/hot/res_api/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, prepare: false });

const EXPECTED_LINES = 58;
const EXPECTED_RECIPES = 47;
const FIX_NOTE = '修复loss_rate冗余双算(2026-08-11)：该批行 loss_rate=1−net_yield 为导入时重复编码，引擎公式 q×(1+loss)/ny 会双算；本版本将冗余 loss_rate 归零，净得率保留。旧版本已归档。';

try {
  // ---- 核对 ----
  const bad = await sql`
    SELECT count(*) n FROM cost_card_recipe_item ri JOIN cost_card_recipe r ON r.id = ri.recipe_id
    WHERE r.status='published' AND ri.net_yield < 1 AND ri.loss_rate > 0
      AND abs(ri.loss_rate - (1 - ri.net_yield)) >= 0.000001`;
  if (Number(bad[0].n) !== 0) throw new Error('存在非互补的 ny/loss 行，前提不成立 —— 中止');

  const recipes = await sql`
    SELECT DISTINCT r.id rid, r.item_id, i.name, r.version, r.batch_yield, r.batch_unit,
           r.sale_price, r.created_by
    FROM cost_card_recipe_item ri
    JOIN cost_card_recipe r ON r.id = ri.recipe_id
    JOIN cost_card_item i ON i.id = r.item_id
    WHERE r.status='published' AND ri.net_yield < 1 AND ri.loss_rate > 0
      AND abs(ri.loss_rate - (1 - ri.net_yield)) < 0.000001
    ORDER BY r.item_id`;
  if (recipes.length !== EXPECTED_RECIPES) throw new Error(`预期 ${EXPECTED_RECIPES} 个配方、实际 ${recipes.length} —— 中止`);

  const rids = recipes.map(r => r.rid);
  const allLines = await sql`
    SELECT ri.*, c.name component FROM cost_card_recipe_item ri
    JOIN cost_card_item c ON c.id = ri.component_item_id
    WHERE ri.recipe_id IN ${sql(rids)} ORDER BY ri.recipe_id, ri.seq`;
  const redundant = allLines.filter(l =>
    Number(l.net_yield) < 1 && Number(l.loss_rate) > 0 &&
    Math.abs(Number(l.loss_rate) - (1 - Number(l.net_yield))) < 0.000001);
  if (redundant.length !== EXPECTED_LINES) throw new Error(`预期 ${EXPECTED_LINES} 行、实际 ${redundant.length} —— 中止`);

  const existing = await sql`
    SELECT item_id, version FROM cost_card_recipe WHERE item_id IN ${sql(recipes.map(r => r.item_id))}`;
  const taken = new Set(existing.map(e => `${e.item_id}:${e.version}`));
  const conflict = recipes.filter(r => taken.has(`${r.item_id}:${Number(r.version) + 1}`));
  if (conflict.length > 0) throw new Error(`目标版本已存在: ${conflict.map(c => c.item_id).join(',')} —— 中止`);

  console.log(`核对通过：47 配方 / 58 冗余行（全部满足 loss=1−ny）。逐行：`);
  for (const l of redundant) {
    console.log(`  ✓ #${l.id} ${l.component}: ny=${Number(l.net_yield)} loss=${Number(l.loss_rate)} → loss=0`);
  }

  // 修复前成本快照：全部成品卡（引用被修半成品的成品也会变，必须全量拍）
  const beforeCost = await sql`
    SELECT c.item_id, c.item_name, c.unit_cost FROM v_cost_card_current_cost c
    JOIN cost_card_item i ON i.id = c.item_id WHERE i.item_type = 'product'`;
  const beforeMap = new Map(beforeCost.map(c => [Number(c.item_id), Number(c.unit_cost)]));

  // 回滚脚本
  const rbPath = join(HERE, 'rollback_lossrate_fix_20260811.sql');
  writeFileSync(rbPath, [
    '-- 回滚 loss_rate 双算修复（2026-08-11）。以表 owner（postgres）执行。',
    'BEGIN;',
    'ALTER TABLE cost_card_recipe DISABLE TRIGGER cost_card_recipe_protect;',
    ...recipes.map(r => `UPDATE cost_card_recipe SET status='archived', effective_to=CURRENT_DATE WHERE item_id=${r.item_id} AND version=${Number(r.version) + 1};`),
    ...recipes.map(r => `UPDATE cost_card_recipe SET status='published', effective_to=NULL WHERE id=${r.rid};`),
    'ALTER TABLE cost_card_recipe ENABLE TRIGGER cost_card_recipe_protect;',
    'COMMIT;',
  ].join('\n'));

  // ---- 单事务执行 ----
  const linesByRecipe = new Map();
  for (const l of allLines) {
    const k = Number(l.recipe_id);
    if (!linesByRecipe.has(k)) linesByRecipe.set(k, []);
    linesByRecipe.get(k).push(l);
  }
  const isRedundant = l =>
    Number(l.net_yield) < 1 && Number(l.loss_rate) > 0 &&
    Math.abs(Number(l.loss_rate) - (1 - Number(l.net_yield))) < 0.000001;

  await sql.begin(async tx => {
    for (const r of recipes) {
      const [nv] = await tx`
        INSERT INTO cost_card_recipe (item_id, version, status, batch_yield, batch_unit, sale_price, effective_from, notes, created_by)
        VALUES (${r.item_id}, ${Number(r.version) + 1}, 'draft', ${r.batch_yield}, ${r.batch_unit}, ${r.sale_price}, CURRENT_DATE, ${FIX_NOTE}, ${r.created_by})
        RETURNING id`;
      for (const l of linesByRecipe.get(Number(r.rid))) {
        await tx`
          INSERT INTO cost_card_recipe_item (recipe_id, component_item_id, quantity, unit, net_yield, loss_rate, seq, notes)
          VALUES (${nv.id}, ${l.component_item_id}, ${l.quantity}, ${l.unit}, ${l.net_yield}, ${isRedundant(l) ? 0 : l.loss_rate}, ${l.seq}, ${l.notes})`;
      }
      await tx`UPDATE cost_card_recipe SET status = 'published' WHERE id = ${nv.id}`;
      await tx`UPDATE cost_card_recipe SET status = 'archived', effective_to = CURRENT_DATE WHERE id = ${r.rid}`;
    }
    const left = await tx`
      SELECT count(*) n FROM cost_card_recipe_item ri JOIN cost_card_recipe r ON r.id = ri.recipe_id
      WHERE r.status='published' AND ri.net_yield < 1 AND ri.loss_rate > 0
        AND abs(ri.loss_rate - (1 - ri.net_yield)) < 0.000001`;
    if (Number(left[0].n) !== 0) throw new Error(`修复后仍有 ${left[0].n} 行冗余 —— 回滚`);
  });

  console.log(`\n✅ 47 个配方全部发新版并归档旧版；已发布配方中冗余 loss_rate 行清零。`);
  console.log(`回滚脚本：${rbPath}`);

  // ---- 修复后成本对比：全部成品卡，只打印有变化的 ----
  const afterCost = await sql`
    SELECT c.item_id, c.item_name, c.unit_cost FROM v_cost_card_current_cost c
    JOIN cost_card_item i ON i.id = c.item_id WHERE i.item_type = 'product'`;
  console.log('\n成品卡成本变化（修复前 → 修复后）：');
  for (const a of afterCost.sort((x, y) => Number(x.item_id) - Number(y.item_id))) {
    const b = beforeMap.get(Number(a.item_id));
    const na = Number(a.unit_cost);
    if (b != null && Math.abs(b - na) > 0.005) {
      console.log(`   ${a.item_name}: RM${b.toFixed(2)} → RM${na.toFixed(2)}`);
    }
  }
} catch (e) {
  console.error('❌ 修复失败（未提交任何改动）：', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
