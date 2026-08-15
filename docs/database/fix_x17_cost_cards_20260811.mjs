// 修复 2026-07-14 批次成本卡的 ×1.7 录入错误（8 张卡：34,35,62,63,64,92,93,94）。
// 数据库触发器禁止直改已发布配方（cost_card_protect_recipe_item），因此走应用自己的流程：
//   逐行核对 v1 → 建 v2 草稿 → 写入 ÷1.7 后的行 → 发布 v2 → 归档 v1 → 同步修 product_material_cost。
// 全程单事务；41 行中任何一行与核对底稿不符即整体回滚，不写入任何数据。
// 用法：node docs/database/fix_x17_cost_cards_20260811.mjs
import postgres from '/Users/weiliangshao/hot/res_api/node_modules/postgres/src/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = readFileSync('/Users/weiliangshao/hot/res_api/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, prepare: false });

// v1 配方 id 恰好等于 item_id（34,35,62,63,64,92,93,94），已实测确认。
const ITEMS = [34, 35, 62, 63, 64, 92, 93, 94];
const CARD_NAMES = ['招牌惠灵顿', '招牌惠灵顿(联豪)', '蜂蜜蔓越莓坚果棒', '趁热蜂蜜开心果坚果棒',
  '趁热奶酪核桃马卡龙', '牛肉坚果棒', '咖啡马卡龙', '榛子马卡龙'];
const FIX_NOTE = '修复×1.7录入错误(2026-08-11)。依据: 成品层整数×1.7模式 + 7-29重建卡对照(8.17÷1.7≈4.70) + 研发部7-27黑松露牛肉坚果棒规格书(250g/个)。v1同批原值已归档保留。';

// 核对底稿：2026-08-11 从生产库逐行读出的 v1 行 (line_id -> 库中用量)。
const EXPECTED = {
  197: 6.799996, 198: 169.999996, 199: 50.999997, 200: 1.7, 201: 221.0,
  202: 6.799996, 203: 169.999996, 204: 82.139801, 205: 1.7, 206: 170.000004,
  388: 3.399999, 389: 33.999999, 390: 424.99992, 391: 1.7,
  392: 425.000008, 393: 1.7,
  394: 1.7, 395: 1.7, 396: 110.499997, 397: 42.499995, 398: 59.500007, 399: 306.000179,
  553: 13.6, 554: 424.999992, 555: 5.339989, 556: 34.000002, 557: 1.7,
  558: 68.000009, 559: 101.999999, 560: 305.999984, 561: 1.7, 562: 1.7, 563: 3.559991, 564: 59.499993,
  565: 68.00001, 566: 1.7, 567: 101.999992, 568: 306.000082, 569: 1.7, 570: 3.559991, 571: 62.3,
};

try {
  const v1 = await sql`
    SELECT r.id rid, r.item_id, i.name product, r.version, r.status, r.batch_yield, r.batch_unit,
           r.sale_price, r.effective_from, r.created_by
    FROM cost_card_recipe r JOIN cost_card_item i ON i.id = r.item_id
    WHERE r.item_id IN ${sql(ITEMS)} AND r.version = 1
    ORDER BY r.item_id`;
  if (v1.length !== 8 || v1.some(r => r.status !== 'published')) {
    throw new Error('v1 配方数量或状态与预期不符（应为 8 张、全部 published）—— 中止');
  }
  const v2exists = await sql`
    SELECT item_id FROM cost_card_recipe WHERE item_id IN ${sql(ITEMS)} AND version = 2`;
  if (v2exists.length > 0) {
    throw new Error(`以下卡已存在 v2，疑似已修复过，中止: ${v2exists.map(r => r.item_id).join(',')}`);
  }

  const lines = await sql`
    SELECT ri.id, ri.recipe_id, ri.component_item_id, ri.quantity, ri.unit, ri.net_yield,
           ri.loss_rate, ri.seq, ri.notes, c.name component
    FROM cost_card_recipe_item ri JOIN cost_card_item c ON c.id = ri.component_item_id
    WHERE ri.recipe_id IN ${sql(v1.map(r => r.rid))}
    ORDER BY ri.recipe_id, ri.seq`;

  // ---- 逐行核对 ----
  const expIds = Object.keys(EXPECTED).map(Number).sort((a, b) => a - b);
  const gotIds = lines.map(l => Number(l.id)).sort((a, b) => a - b);
  if (expIds.length !== gotIds.length || expIds.some((v, i) => v !== gotIds[i])) {
    throw new Error(`行集合与核对底稿不一致（底稿 ${expIds.length} 行 / 库中 ${gotIds.length} 行）—— 中止`);
  }
  console.log('逐行核对（库中值 vs 底稿 → 新值）：');
  const byRecipe = new Map();
  for (const l of lines) {
    const exp = EXPECTED[Number(l.id)];
    if (Math.abs(Number(l.quantity) - exp) > 1e-6) {
      throw new Error(`行 ${l.id}（${l.component}）库中=${l.quantity} 底稿=${exp} 不符 —— 全部中止`);
    }
    const k = Number(l.recipe_id);
    if (!byRecipe.has(k)) byRecipe.set(k, []);
    byRecipe.get(k).push(l);
    console.log(`  ✓ #${l.id} ${l.component}: ${Number(l.quantity)} → ${(Number(l.quantity) / 1.7).toFixed(6)}`);
  }

  // 回滚脚本（归档是冻结态，恢复 v1 需临时停触发器，须以表 owner 身份执行）
  // 注：product_material_cost 是基于 v_cost_card_current_cost 的视图，随配方自动重算，无需也不能手动改。
  const rbPath = join(HERE, 'rollback_x17_fix_20260811.sql');
  writeFileSync(rbPath, [
    '-- 回滚 ×1.7 修复（2026-08-11）。以表 owner（postgres）执行。',
    'BEGIN;',
    'ALTER TABLE cost_card_recipe DISABLE TRIGGER cost_card_recipe_protect;',
    `UPDATE cost_card_recipe SET status='archived', effective_to=CURRENT_DATE WHERE item_id IN (${ITEMS.join(',')}) AND version=2;`,
    `UPDATE cost_card_recipe SET status='published', effective_to=NULL WHERE item_id IN (${ITEMS.join(',')}) AND version=1;`,
    'ALTER TABLE cost_card_recipe ENABLE TRIGGER cost_card_recipe_protect;',
    'COMMIT;',
  ].join('\n'));

  // ---- 单事务执行 ----
  await sql.begin(async tx => {
    for (const r of v1) {
      const [v2] = await tx`
        INSERT INTO cost_card_recipe (item_id, version, status, batch_yield, batch_unit, sale_price, effective_from, notes, created_by)
        VALUES (${r.item_id}, 2, 'draft', ${r.batch_yield}, ${r.batch_unit}, ${r.sale_price}, CURRENT_DATE, ${FIX_NOTE}, ${r.created_by})
        RETURNING id`;
      for (const l of byRecipe.get(Number(r.rid))) {
        await tx`
          INSERT INTO cost_card_recipe_item (recipe_id, component_item_id, quantity, unit, net_yield, loss_rate, seq, notes)
          VALUES (${v2.id}, ${l.component_item_id}, ${(Number(l.quantity) / 1.7).toFixed(6)}, ${l.unit}, ${l.net_yield}, ${l.loss_rate}, ${l.seq}, ${l.notes})`;
      }
      await tx`UPDATE cost_card_recipe SET status = 'published' WHERE id = ${v2.id}`;
      await tx`UPDATE cost_card_recipe SET status = 'archived', effective_to = CURRENT_DATE WHERE id = ${r.rid}`;
      console.log(`  ✅ ${r.product}: v2(#${v2.id}) 已发布，v1(#${r.rid}) 已归档`);
    }
  });

  console.log('\n✅ 8 张卡全部修复（v2 发布 / v1 归档）。');
  console.log(`回滚脚本：${rbPath}`);

  // product_material_cost 是视图，应已随新配方自动重算——读出来确认：
  const cached = await sql`
    SELECT product_name, material_cost FROM product_material_cost
    WHERE product_name IN ${sql(CARD_NAMES)} ORDER BY product_name`;
  console.log(`\nproduct_material_cost 视图当前值（应为修复后成本）：`);
  for (const c of cached) console.log(`   ${c.product_name} → RM${Number(c.material_cost).toFixed(2)}`);

  // ---- 修复后复核：按发布配方重算 8 张卡的单件成本 ----
  const items = await sql`SELECT id, name, item_type FROM cost_card_item`;
  const recipes = await sql`
    SELECT DISTINCT ON (item_id) id, item_id, batch_yield, batch_unit FROM cost_card_recipe
    WHERE status='published' ORDER BY item_id, version DESC`;
  const allLines = await sql`SELECT recipe_id, component_item_id, quantity, unit, net_yield FROM cost_card_recipe_item`;
  const prices = await sql`
    SELECT DISTINCT ON (item_id) item_id, normalized_price_myr FROM cost_card_item_price
    ORDER BY item_id, effective_from DESC NULLS LAST, created_at DESC`;
  const itemById = new Map(items.map(i => [Number(i.id), i]));
  const recipeByItem = new Map(recipes.map(r => [Number(r.item_id), r]));
  const linesByRecipe = new Map();
  for (const l of allLines) {
    const k = Number(l.recipe_id);
    if (!linesByRecipe.has(k)) linesByRecipe.set(k, []);
    linesByRecipe.get(k).push(l);
  }
  const priceByItem = new Map(prices.map(p => [Number(p.item_id), Number(p.normalized_price_myr)]));
  const memo = new Map();
  const unitCost = id => {
    if (memo.has(id)) return memo.get(id);
    const it = itemById.get(id);
    let v;
    if (it.item_type === 'ingredient' || it.item_type === 'packaging') v = priceByItem.get(id) ?? 0;
    else {
      const r = recipeByItem.get(id);
      v = (linesByRecipe.get(Number(r.id)) || []).reduce((s, l) =>
        s + Number(l.quantity) / (Number(l.net_yield) || 1) * unitCost(Number(l.component_item_id)), 0) / Number(r.batch_yield);
    }
    memo.set(id, v);
    return v;
  };
  console.log('\n修复后单件成本（按当前已发布配方重算）：');
  for (const iid of ITEMS) {
    console.log(`   ${itemById.get(iid).name}: RM${unitCost(iid).toFixed(3)}`);
  }
} catch (e) {
  console.error('❌ 修复失败（未提交任何改动）：', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
