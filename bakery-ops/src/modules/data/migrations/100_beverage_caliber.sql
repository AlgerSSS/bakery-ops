-- 100_beverage_caliber.sql — 现制饮品 / 非生产品 口径归位到 bakery-ops
--
-- 【为什么需要这个迁移】
-- 2026-07-07 财务站（门店财务AI分析系统）执行 sql/item_menu_category.sql，该脚本第 3 行是
--   TRUNCATE item_category;
-- 把整表换成 Restosuite 的英文营销分组。bakery-ops 两处按中文 '%饮品%' 查询的逻辑因此静默
-- 返回 0 行（stockout-detector.service.ts:232、daily-review-chat.definition.ts:92/153）。
-- 后果实测：近 30 天 out_of_stock_record 326 行里 100 行是现制饮品误报（30.7%）；
-- 水吧营业额恒报 RM0（2026-07-24 正确值 RM7186 = 应收 RM60295 的 11.9%）。
--
-- 【为什么不用新表 / 不给 item_category 加列】
-- · item_category 归财务站所有并被 TRUNCATE 整表重灌，加列的值每次重灌都会消失。
-- · 25 行数据不值得一张新表；且 'ops_' 前缀已被财务站占用（其 047/048 迁移把 stores→ops_store），
--   再建 ops_* 表会让「谁拥有」重新变模糊——恰是本次要根除的病。
-- · business_rule 的唯一写者已经是本仓库（forecast-calc.repository.ts updateBusinessRule），
--   单写者原则天然成立；表和 JSON 解析（getBusinessRulesFromDB）都现成；
--   settings-page.tsx 已经是它的编辑页，店长可以自己维护、不用等发版。
--
-- 【为什么是显式白名单而不是按分类/按名字匹配】
-- 漏判 vs 误判方向明确：把烘焙品错当饮品（永久退出断货检测，静默丢钱）远重于把饮品漏进检测
-- （多一条噪音记录，老板一眼看得出，且网页端有手工纠错通道）。所以逐品枚举，绝不用 LIKE/子串：
--   'Matcha' 会吞掉 5 款抹茶烘焙、'Iced' 会吞掉 7 款冰系贝果可颂、
--   'Coffee' 会吞掉 Berlin Volufra Coffee Pretzel 与 French Rich Coffee Macaron（都有报废记录）。
-- 未在清单中的新品默认「仍然检测」，由代码里的漂移提醒推动补录。
--
-- 【版本号 100 的由来】
-- schema_migrations 是四个代码库共用的一张表，version 是整数主键。财务站已占用 027-048，
-- 本仓库的 027_product_cost.sql 与财务站 027_finance_runtime_baseline.sql 已经双占过一次。
-- 自本迁移起划号段：财务站 001-099，bakery-ops 100-199，res_api 200-299。
--
-- 本迁移只写 business_rule 两行数据 + 三条表注释（COMMENT 不会被 TRUNCATE 抹掉），无 DDL 结构变更，可重复执行。

BEGIN;

-- ============================================================
-- 1) 现制饮品清单（25 款 POS 英文品名，永不做断货检测；计入水吧营业额）
-- ============================================================
-- 来源：item_category 六个疑似饮品组的 24 款，去掉 Thai Milk Tea Tiramisu（泰式鲜奶提拉米苏，
-- 杯装甜品，会卖完，近 30 天真实断货 13 次 RM2580，必须继续检测），
-- 补 Golden Tropic Cold Brew（2026-07-20 首次出单，整张 item_category 里没有这一行）
-- 与 Cocoa（意式浓厚黑巧酸奶昔，仅见于 res_api/_drinks.json，预置以免上架当天误报）。
-- 注：'vanilla cold brew' 小写、'Pistachio Green jewel' 小写 j、'Power CRush' 大写 R
--     都是 POS 原样品名，读侧统一走归一化（折叠空白含 U+00A0 + trim + 小写）比较，勿手改。
INSERT INTO business_rule (rule_key, rule_value) VALUES (
  'beverageItems',
  '["Americano","Latte","Coconut Latte","Rose Latte","Thai Milk Latte","Strawberry Rose Latte","Matcha Latte","Kyoto Matcha","Mocha Cold Brew","Chocolate Cold Brew","Pistachio Cold Brew","Strawberry Cold Brew","vanilla cold brew","Calpis Jasmine Breeze Cold Brew","Golden Tropic Cold Brew","Beryl Splash","Pink Tango","Triple Energy","Power CRush","Golden Mango","Strawberry Glaze","Avo Matcha","Pistachio Green jewel","Italian Crispy Iced Cocoa","Cocoa"]'
) ON CONFLICT (rule_key) DO UPDATE SET rule_value = EXCLUDED.rule_value, updated_at = now();

-- ============================================================
-- 2) 非生产品清单（12 款周边，永不做断货检测；【不】计入水吧营业额）
-- ============================================================
-- 拆成第二个 key 而不是混进 beverageItems：排除理由不同（「不是生产品」而非「现制饮品」），
-- 混在一起会污染水吧营业额口径。
-- 现存事故：2026-07-18 Hot Crush Heart Scent Card 当天只卖出 1 片(15:24)，断货检测判它 15:24
-- 断货、估损 RM13545，占近 30 天总估损 RM83473 的 16.2%。
-- 注：'Hot Crush Dual-Layer  Coffee Cup' 中间是两个空格（POS 原样），读侧归一化会折叠，勿手改。
INSERT INTO business_rule (rule_key, rule_value) VALUES (
  'stockoutExcludeItems',
  '["Hot Crush Butterfly Fridge Magnet","Hot Crush Butterfly Scent Card","Hot Crush Ceramic Coffee Cup","Hot Crush Dual-Layer  Coffee Cup","Hot Crush Heart Fridge Magnet","Hot Crush Heart Scent Card","Hot Crush Petite Bow Earbuds Case","Hot Crush Petronas Twin Towers Fridge Magnet","Hot Crush Red Stripes Canvas Tote Bag","Hot Crush Rosé Bloom Fridge Magnet","Hot Crush Rosé Bloom Scent Card","杯子"]'
) ON CONFLICT (rule_key) DO UPDATE SET rule_value = EXCLUDED.rule_value, updated_at = now();

-- ============================================================
-- 3) 所有权登记（写进库里，TRUNCATE 不会抹掉 COMMENT）
-- ============================================================
COMMENT ON TABLE item_category IS
  '所有权=财务站（门店财务AI分析系统），由 sql/item_menu_category.sql 用 TRUNCATE 整表重灌，内容是 Restosuite 营销分组（含 TOP list / Membership Price 这类非品类维度）。其他仓库只读，且【仅可用于品类结构展示】。禁止在此表上承载饮品/排除/排产等运营语义——2026-07-07 重灌曾使 bakery-ops 的饮品判据静默返回 0 行。饮品口径见 business_rule.beverageItems。';

COMMENT ON TABLE business_rule IS
  '所有权=bakery-ops，唯一写者 src/modules/data/repositories/forecast-calc.repository.ts updateBusinessRule()，编辑入口 settings-page.tsx。承载 bakery-ops 自有的运营口径 KV（beverageItems=现制饮品清单、stockoutExcludeItems=非生产品清单、breakStockThresholds、shipmentFormula 等）。财务站与 res_api 不得写入。';

COMMENT ON TABLE product_sales_baseline IS
  '【已废弃 / 冻结】数据停在 2026-04-12（一次性 Excel 播种，45 行）。自动排产已改走 item_hourly_sales × product.name_en 直算（product-demand.ts getProductSalesStats）。两处写入点已于 2026-07 摘除；确认无读者并冻结满 2 周后单独提 DROP 迁移。不要新增读者，不要往里灌数。';

COMMIT;

-- 回滚（如需）：
--   DELETE FROM business_rule WHERE rule_key IN ('beverageItems','stockoutExcludeItems');
-- 注意：代码侧 beverage-caliber.ts 内置了同一份常量做兜底，删掉这两行不会让口径变空，
-- 只会退回代码内置版本（这正是设计意图：DB 查空绝不回落成空集）。