// ×1.7 批量修复第二批（2026-08-11）：剩余 86 张成品卡。
// 分组与依据：
//   A 组 56 张：7-14 导入后从未变动的 v1（notes='Imported…' 且 updated_at=7-14；触发器保证已发布行不可改）；
//   B 组 27 张：昨日 loss_rate 修复重发的版本，行用量系从导入 v1 原样复制（脚本内逐行断言 ==归档v1）；
//     注意排除 92/93/94——它们在 loss 修复前已 ÷1.7，当前版本携带 loss-fix notes 但用量已是正确值；
//   C 组 3 张：65/66/68 测试拿破仑（7-30 由导入卡复制/按份数缩放，×1.7 随之继承，逐行签名确认）。
// 半成品配方已全量扫描（843 行零 ×1.7 签名），不在修复范围。
// 修法：每张卡发新版本、全部成品层行用量 ÷1.7、发布新版、归档旧版；单事务，任何断言失败全回滚。
// 用法：node docs/database/fix_x17_batch2_20260811.mjs
import postgres from '/Users/weiliangshao/hot/res_api/node_modules/postgres/src/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const env = readFileSync('/Users/weiliangshao/hot/res_api/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, prepare: false });

const EXPECT_A = 56, EXPECT_B = 27, EXPECT_C = 3;
const B_EXCLUDE = [92, 93, 94]; // loss 修复前已 ÷1.7 修正，勿二次除
// 零签名但人工逐行核对确认 ×1.7 的卡（2026-08-11）：
// 58/59 曲奇：221=130×1.7、17=10×1.7 精确倍数（整数值被签名规则的排歧条款跳过）；
// 2/3/4/5 吐司：÷1.7 落点 60/200/285/30/120/45 等，漂移≤0.25%，包装袋 1.6891/1.6938≈1×1.7
//（全目录正常袋只有精确 1.7 或 1.0）。
const MANUAL_OK = new Set([2, 3, 4, 5, 58, 59]);
const C_ITEMS = [65, 66, 68];
const FIX_NOTE = '修复×1.7录入错误(2026-08-11 第二批)。依据: 7-14导入批次成品层整数×1.7模式、同批8张卡已验证修复、研发规格书与重建卡双重对照。旧版本已归档。';
const sig17 = q => {
  const d = q / 1.7;
  const nearRound = Math.abs(d - Math.round(d)) < 0.001 || Math.abs(d - Math.round(d * 2) / 2) < 0.001;
  const selfClean = Math.abs(q - Math.round(q)) < 0.001 || Math.abs(q - Math.round(q * 2) / 2) < 0.001;
  return nearRound && !selfClean;
};

try {
  const groupA = await sql`
    SELECT r.id rid, r.item_id, i.name, r.version, r.batch_yield, r.batch_unit, r.sale_price, r.created_by
    FROM cost_card_recipe r JOIN cost_card_item i ON i.id = r.item_id
    WHERE i.item_type='product' AND r.status='published' AND r.version=1
      AND r.notes LIKE 'Imported from MySQL batch%' AND r.updated_at::date='2026-07-14'
    ORDER BY r.item_id`;
  const groupB = await sql`
    SELECT r.id rid, r.item_id, i.name, r.version, r.batch_yield, r.batch_unit, r.sale_price, r.created_by
    FROM cost_card_recipe r JOIN cost_card_item i ON i.id = r.item_id
    WHERE i.item_type='product' AND r.status='published'
      AND r.notes LIKE '修复loss_rate冗余双算%'
      AND r.item_id NOT IN ${sql(B_EXCLUDE)}
    ORDER BY r.item_id`;
  const groupC = await sql`
    SELECT r.id rid, r.item_id, i.name, r.version, r.batch_yield, r.batch_unit, r.sale_price, r.created_by
    FROM cost_card_recipe r JOIN cost_card_item i ON i.id = r.item_id
    WHERE r.item_id IN ${sql(C_ITEMS)} AND r.status='published'
    ORDER BY r.item_id`;
  if (groupA.length !== EXPECT_A) throw new Error(`A 组预期 ${EXPECT_A} 实际 ${groupA.length} —— 中止`);
  if (groupB.length !== EXPECT_B) throw new Error(`B 组预期 ${EXPECT_B} 实际 ${groupB.length} —— 中止`);
  if (groupC.length !== EXPECT_C) throw new Error(`C 组预期 ${EXPECT_C} 实际 ${groupC.length} —— 中止`);
  const all = [...groupA, ...groupB, ...groupC];
  const overlap = new Set(all.map(r => Number(r.item_id)));
  if (overlap.size !== all.length) throw new Error('分组重叠 —— 中止');

  const lines = await sql`
    SELECT ri.*, c.name component FROM cost_card_recipe_item ri
    JOIN cost_card_item c ON c.id = ri.component_item_id
    WHERE ri.recipe_id IN ${sql(all.map(r => r.rid))} ORDER BY ri.recipe_id, ri.seq`;
  const linesByRecipe = new Map();
  for (const l of lines) {
    const k = Number(l.recipe_id);
    if (!linesByRecipe.has(k)) linesByRecipe.set(k, []);
    linesByRecipe.get(k).push(l);
  }

  // B 组强校验：当前 v2 行用量必须与归档的导入 v1 行逐行相等（按 component+seq 匹配）
  const bV1 = await sql`
    SELECT r.item_id, ri.component_item_id, ri.seq, ri.quantity
    FROM cost_card_recipe r JOIN cost_card_recipe_item ri ON ri.recipe_id = r.id
    WHERE r.item_id IN ${sql(groupB.map(r => r.item_id))} AND r.version=1 AND r.status='archived'
      AND r.notes LIKE 'Imported from MySQL batch%'`;
  const v1Map = new Map(bV1.map(x => [`${x.item_id}:${x.component_item_id}:${x.seq}`, Number(x.quantity)]));
  for (const r of groupB) {
    for (const l of linesByRecipe.get(Number(r.rid))) {
      const old = v1Map.get(`${r.item_id}:${l.component_item_id}:${l.seq}`);
      if (old == null || Math.abs(old - Number(l.quantity)) > 1e-6) {
        throw new Error(`B组 ${r.name} 行#${l.id}（${l.component}）与导入v1不一致（v1=${old} v2=${l.quantity}）—— 中止`);
      }
    }
  }

  // 每张卡至少 1 条明确 ×1.7 签名行
  const log = [];
  for (const r of all) {
    const ls = linesByRecipe.get(Number(r.rid)) || [];
    const sigCount = ls.filter(l => sig17(Number(l.quantity))).length;
    if (sigCount < 1 && !MANUAL_OK.has(Number(r.item_id))) {
      throw new Error(`${r.name}（item ${r.item_id}）无明确 ×1.7 签名行且不在人工白名单 —— 中止，需人工看`);
    }
    log.push(`## ${r.name} (item ${r.item_id}, v${r.version} → 新版, 签名行 ${sigCount}/${ls.length})`);
    for (const l of ls) log.push(`  ${l.component}: ${Number(l.quantity)} → ${(Number(l.quantity) / 1.7).toFixed(6)}${sig17(Number(l.quantity)) ? '  [×1.7签名]' : ''}`);
  }
  writeFileSync(join(HERE, 'fix_x17_batch2_20260811.log'), log.join('\n'));

  // 新版本号 = 该品现存最大版本 + 1（个别品存在已归档的历史 v2，如 E2E 测试残留）
  const existing = await sql`
    SELECT item_id, version FROM cost_card_recipe WHERE item_id IN ${sql(all.map(r => r.item_id))}`;
  const nextVer = new Map();
  for (const e of existing) {
    const k = Number(e.item_id);
    nextVer.set(k, Math.max(nextVer.get(k) ?? 0, Number(e.version) + 1));
  }

  console.log(`核对通过：A组 ${groupA.length} + B组 ${groupB.length} + C组 ${groupC.length} = ${all.length} 张卡，行级明细见 fix_x17_batch2_20260811.log`);

  // 修复前成本快照（全部成品）
  const before = await sql`
    SELECT c.item_id, c.item_name, c.unit_cost FROM v_cost_card_current_cost c
    JOIN cost_card_item i ON i.id = c.item_id WHERE i.item_type='product'`;
  const beforeMap = new Map(before.map(c => [Number(c.item_id), Number(c.unit_cost)]));

  // 回滚脚本
  const rbPath = join(HERE, 'rollback_x17_batch2_20260811.sql');
  writeFileSync(rbPath, [
    '-- 回滚 ×1.7 第二批修复（2026-08-11）。以表 owner（postgres）执行。',
    'BEGIN;',
    'ALTER TABLE cost_card_recipe DISABLE TRIGGER cost_card_recipe_protect;',
    ...all.map(r => `UPDATE cost_card_recipe SET status='archived', effective_to=CURRENT_DATE WHERE item_id=${r.item_id} AND version=${nextVer.get(Number(r.item_id))};`),
    ...all.map(r => `UPDATE cost_card_recipe SET status='published', effective_to=NULL WHERE id=${r.rid};`),
    'ALTER TABLE cost_card_recipe ENABLE TRIGGER cost_card_recipe_protect;',
    'COMMIT;',
  ].join('\n'));

  // ---- 单事务执行 ----
  await sql.begin(async tx => {
    for (const r of all) {
      const [nv] = await tx`
        INSERT INTO cost_card_recipe (item_id, version, status, batch_yield, batch_unit, sale_price, effective_from, notes, created_by)
        VALUES (${r.item_id}, ${nextVer.get(Number(r.item_id))}, 'draft', ${r.batch_yield}, ${r.batch_unit}, ${r.sale_price}, CURRENT_DATE, ${FIX_NOTE}, ${r.created_by})
        RETURNING id`;
      for (const l of linesByRecipe.get(Number(r.rid))) {
        await tx`
          INSERT INTO cost_card_recipe_item (recipe_id, component_item_id, quantity, unit, net_yield, loss_rate, seq, notes)
          VALUES (${nv.id}, ${l.component_item_id}, ${(Number(l.quantity) / 1.7).toFixed(6)}, ${l.unit}, ${l.net_yield}, ${l.loss_rate}, ${l.seq}, ${l.notes})`;
      }
      await tx`UPDATE cost_card_recipe SET status = 'published' WHERE id = ${nv.id}`;
      await tx`UPDATE cost_card_recipe SET status = 'archived', effective_to = CURRENT_DATE WHERE id = ${r.rid}`;
    }
  });
  console.log(`✅ ${all.length} 张卡全部发新版并归档旧版。回滚脚本：${rbPath}`);

  // ---- 修复后报告 ----
  const after = await sql`
    SELECT c.item_id, c.item_name, c.unit_cost FROM v_cost_card_current_cost c
    JOIN cost_card_item i ON i.id = c.item_id WHERE i.item_type='product'`;
  console.log('\n成品卡成本变化（修复前 → 修复后）：');
  for (const a of after.sort((x, y) => Number(x.item_id) - Number(y.item_id))) {
    const b = beforeMap.get(Number(a.item_id));
    const na = Number(a.unit_cost);
    if (b != null && Math.abs(b - na) > 0.005) console.log(`   ${a.item_name}: RM${b.toFixed(2)} → RM${na.toFixed(2)}`);
  }

  // 残留 ×1.7 签名扫描（已发布成品层）
  const leftover = await sql`
    SELECT r.item_id, i.name, c.name component, ri.quantity
    FROM cost_card_recipe_item ri
    JOIN cost_card_recipe r ON r.id = ri.recipe_id
    JOIN cost_card_item i ON i.id = r.item_id
    JOIN cost_card_item c ON c.id = ri.component_item_id
    WHERE r.status='published' AND i.item_type='product'`;
  const remain = leftover.filter(l => sig17(Number(l.quantity)));
  console.log(`\n残留 ×1.7 签名行（已发布成品层）：${remain.length}`);
  for (const l of remain) console.log(`   item ${l.item_id} ${l.name} / ${l.component}: ${Number(l.quantity)}`);
} catch (e) {
  console.error('❌ 修复失败（未提交任何改动）：', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
