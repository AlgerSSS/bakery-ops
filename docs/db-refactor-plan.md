# HOT CRUSH 数据库重构执行方案(最终版)

> 2026-08-03 · 生产库实测 + 五个代码库逐文件审计 + 三轮多代理对抗验证。
> 配套:[结构图](https://db-report-site.vercel.app) · [三张表判决](three-tables-verdict.md) · [业务方建议对照](#十与业务方建议的对照--哪些匹配哪些没有) · [运营建模方向](ops-model-direction.md)

---

## 一、数据库变更总账

| | 现在 | 最终 | 变化 |
|---|---|---|---|
| 基表 | 73 | **71** | 当前 **76**(+3 新表 已建，−5 删表 待代码上线) |
| 视图 | 11 | **11** | 当前 **9**(−4 MySQL 壳 已删，+2 排班/人效 已建，待 +2 对账/断货) |
| 对象总数 | 84 | **82** | 当前 **85** |
| 字段 | 812 | **807** | +34(新表) −5(删表列) −1(`hbti_member_hash`) −33(删表) |
| 外键 | 40 | **42** | −4(随删表消失) +6(新表挂载) |
| 约束 | 236 | ~240 | |
| 函数 / 触发器 / RLS 策略 | 16 / 13 / 26 | 不变 | |
| **最小事实** | 29 | **33** | 全部信息由它们承载 |
| 成本卡视图 | 9 | **5** | MySQL 时代的兼容壳全部退役 |
| **成本覆盖率** | **0.0%** | **92.8%** | 37 条人工映射，迁移 080 已就绪 |
| MySQL 依赖 | 1 张孤儿映射表 + 3 个死脚本 | **0** | 见 §三 |

**删除前置检查已跑通:** 5 张待删表 —— 16 个函数无一引用 ✅ / 表上无触发器 ✅ / 无入向外键 ✅。
(这是财务站 076 事故的教训:当时只 grep 代码没查 `pg_get_functiondef`,结果 `cost_card_normalize_price` 的 `DECLARE ... %ROWTYPE` 在删表后任何改价都 502。)

### 1.1 删除 5 张

| 表 | 行数 | 替代 |
|---|---|---|
| `app_user_role` | 2 | 折成 `app_user.role_code` |
| `finance_import_batch_history` | 0 | 锁独立 + 事件迁 `app_audit_log` + hash 跳过删掉 |
| `finance_revenue_daily` | 0 | `daily_revenue` 改键后自然消失 |
| `finance_labor` | 6 | 写入已 disabled、前端零消费 |
| `finance_stock_flow` | 491 | 前端零渲染(`sql/046:76` 自述) |

### 1.2 改视图 1 张

`out_of_stock_record`(519 行)→ 由 `item_hourly_sales` + `item_waste` 现算。

### 1.3 改键 1 张 ★已批准

`daily_revenue` 唯一键 `(date)` → `(date, store)`。**不改视图**(视图不支持 `ON CONFLICT`),**不改 `date` 列类型**。

### 1.4 新建 4 张

| 表 | 主键 | 外键 |
|---|---|---|
| `fact_hbti_response` | `(store, member_id, campaign_version, answered_at)` | — |
| `fact_production_plan` | `(plan_date, store_id, item_key, plan_version)` | `ops_store` `pos_product` |
| `fact_dispatch` | `(production_date, store_id, item_key)` | `ops_store` `pos_product` |
| **`fact_shift`** 排班 | `(work_date, store_id, staff_name)` | `ops_store` |

### 1.5 删列 1 个

`pos_member.hbti_member_hash` —— 066 换键后的死列。实测非空行 **3 / 4843**,视图/函数/触发器/索引引用全为 0,五个代码库零引用。它是 HMAC(手机号),删掉同时是隐私净收益。

---

## 二、迁移号段与台账

### 2.1 号段租约(本次新增 hbti-web)

```
财务站      001-099   ← 077/078 已被烧掉，下一个从 080 起
bakery-ops  100-199   ← 现用到 101，下一个 102
res_api     200-299   ← 未使用
hbti-web    300-399   ← 本次新领
```

### 2.2 ⚠️ 台账必须先补登,否则会中止整条链

实测 `schema_migrations` 76 行、`max(version)=101`,其中 **77 / 78 / 101 的 `filename` 与 `checksum` 皆为 NULL**。财务站 `apply-migrations.js:96-100` 对「已注册但无 checksum」的版本**直接 throw 中止**。今天不炸只因为财务站的 `MIGRATION_FILES` 里没有这三个号。

```sql
-- checksum 按 bakery-ops/src/modules/data/migrations/ 下三个文件的当前字节算
UPDATE schema_migrations SET filename='077_hbti_gift_stock.sql',
  checksum='8c75e87ccf557187104704275bdcc3e11a4059618c318b20fce29689cf4b1e22'
 WHERE version=77 AND checksum IS NULL;
-- 078 / 101 同理
```

**顺序要紧:先跑 UPDATE,再把文件搬进 `hbti-web/sql/`** —— 移动过程中任何 CRLF 或尾空格改动都会让 checksum 对不上。

### 2.3 迁移文件清单

| 文件 | 仓库 | 内容 |
|---|---|---|
| `sql/300_hbti_fact_response.sql` | hbti-web | 建 `fact_hbti_response` + RLS |
| `sql/301_hbti_drop_member_hash.sql` | hbti-web | 删死列 + 修三条过期列注释 |
| `102_daily_revenue_store_key.sql` | bakery-ops | `daily_revenue` 改键 + 建 `v_revenue_reconciliation` |
| `103_out_of_stock_view.sql` | bakery-ops | `out_of_stock_record` → 视图 |
| `104_daily_review_revenue_col.sql` | bakery-ops | `daily_review` 加店长录入列 |
| `105_production_facts.sql` | bakery-ops | 建 `fact_production_plan` + `fact_dispatch` + RLS + FK |
| **`106_fact_shift.sql`** | bakery-ops | ✅ **已写好** · 建 `fact_shift` + `v_labor_productivity` + `v_shift_by_post` |
| **`sql/080_relink_cost_card_product.sql`** | 财务站 | ✅ **已写好并登记** · 重建 `cost_card_product_link` 挂 `pos_item_id` + 37 条人工映射 |
| `sql/081_drop_app_user_role.sql` | 财务站 | 折成 `app_user.role_code` |
| `sql/082_drop_import_batch_history.sql` | 财务站 | 删账本表(代码改完之后) |
| `sql/083_drop_legacy_finance.sql` | 财务站 | 删 `finance_labor` + `finance_stock_flow` + `finance_revenue_daily` |
| `sql/084_retire_mysql_view_shells.sql` | 财务站 | 删 4 个 MySQL 兼容壳视图 + `product_material_cost` 压成一层 |
| `sql/085_drop_orphan_function.sql` | 财务站 | 删 `cost_prevent_raw_mutation()` 孤儿函数 |

⚠️ **每个新迁移都必须追加进 `scripts/apply-migrations.js` 的 `MIGRATION_FILES` 数组**(`:10-63`,硬编码不做 readdir)——放进 `sql/` 但没登记的文件**不报错、直接静默跳过**。

**全部新表必须 `ENABLE ROW LEVEL SECURITY`,全部新视图必须 `security_invoker=true`** —— `sql/059:375-403` 的自检会 `RAISE EXCEPTION` 回滚整个迁移。现成模板:`sql/074_derived_views_security_invoker.sql`。

**没有自动执行器。** bakery-ops 的 `check-migrations.ts:3-6` 明写「只报告,绝不执行」;财务站的 `apply-migrations.js` 只跑它自己 `MIGRATION_FILES` 里列的文件。全部手工 `psql \i` + 手工 `INSERT INTO schema_migrations`。

---

## 三、MySQL 退役 ★本轮新增

### 3.0 结论:不需要迁移,只需要清理 + 改挂一张表

| 排查项 | 结果 |
|---|---|
| 五个仓库的 `mysql` / `mysql2` 依赖 | **0** |
| 连接串 / jdbc / 3306 配置 | **0** |
| FDW / 外部服务器 / 外部表 / mysql 扩展 | **0** |
| MySQL → Postgres 的定时同步 | **0**(crontab 空、launchd 全 `.disabled`、Vercel cron 只有 hbti 对账) |
| 视图/函数/触发器/约束/默认值/RLS/索引 里的 mysql | **0** —— DDL 逻辑层完全干净 |
| 唯一能连 MySQL 的代码 | `财务站/scripts/migrate-mysql-cost-cards.js`,**已经跑不动了**(依赖的 `cost_migration_batch` 表在迁移 075 已被删) |

**MySQL 那边是什么:** 店主本机 Navicat 里的成本核算库 `baking_cost_2026`(11 表 13,585 行 + 4 视图 + 3 存储过程)。`mysqld` PID 851 现在还在跑、3306 还在 LISTEN,**但没有任何代码连它**。原始库两份 gzip 备份在 `财务站/backups/`(146KB + 143KB),**退役有底,可以直接停 `mysqld`**。

### 3.1 ⚠️ 必须踩刹车的地方 —— 按字面清理会删光整套成本卡

`mysql` 字样在库里 **100% 集中在「数据值」与「注释」两层**,而其中三列是**溯源标签,不是依赖**:

| 列 | 命中 | 内容 |
|---|---|---|
| `cost_card_item.source_ref` | **451 / 471** | `mysql:ingredient:9bf8c6b9…` —— 原 MySQL 行的主键指纹 |
| `cost_card_item_price.source` | **339 / 344** | `mysql:raw_packaging:unit_price:backfill` 等 4 种 |
| `cost_card_recipe.notes` | **261 / 289** | `Imported from MySQL batch f8833400-…` |

**这三列一旦清空,270 个能算出成本的商品就失去全部来源追溯。** `v_cost_card_current_cost` 的算价完全不读这三列,所以它们对功能零影响 —— 留着。

### 3.2 ★ 但店主看到的「MySQL」很可能是这一处

`财务站/js/cost-card.js:1138` 在成本卡的「原料与包装物价格台账」里渲染 `source_ref`:

```js
<td><b>${esc(row.name)}</b><small class="cc-cell-note">${esc(row.code || row.sourceKey || row.source_ref || '')}</small></td>
```

**451 个物料的名字底下,屏幕上现在直接写着 `mysql:ingredient:9bf8c6b9…`。**

最小改动、零数据风险:把 `row.source_ref` 从兜底链里去掉 → `row.code || row.sourceKey || ''`。**一行前端改动,UI 立刻不再出现 mysql 字样,库内溯源完整保留。**

若要求库里也看不见,则用前缀改写而非清空(会打断 `test/db-integration.js:453-456` 的断言):

```sql
UPDATE cost_card_item      SET source_ref = 'legacy:' || substring(source_ref from 7) WHERE source_ref LIKE 'mysql:%';
UPDATE cost_card_item_price SET source    = 'legacy:' || substring(source    from 7) WHERE source    LIKE 'mysql:%';
UPDATE cost_card_recipe    SET notes = replace(notes, 'Imported from MySQL batch', 'Imported from legacy batch') WHERE notes LIKE '%MySQL%';
```

`app_audit_log` 里那 13 行 MySQL 痕迹(含 `id=9` 的 `request_id='mysql-price-backfill'`,是那次价格回填的**唯一台账**)**不动** —— 审计日志是只增不改的历史,改写等于伪造记录。

### 3.3 `cost_card_product_link` 重挂 —— 这是 0% 覆盖率的根

**实测:94 行的 `external_key` 与 `cost_card_item.name` 逐行完全相等(94/94),`store` 全为空,`sku` 全为 NULL。**
整张表在 `item_id → name` 之外**零信息量** —— 它只是把物料名抄了一遍。`external_key` 根本不是 MySQL 代理主键,是 `v_product_direct.product` 的中文商品名(`migrate-mysql-cost-cards.js:423-425` 写的是 `productItem.name`)。

> **所以重挂完全在 Postgres 内部完成,一行数据都不需要回 MySQL 取。**

**读取方:零。** 全五仓只有一个写入点(已死的迁移脚本)和两处 schema 断言,没有任何 API / 页面 / skill 读它。它是孤儿表,改挂之后才会有第一个真正的消费者。

#### 挂 `item_id` 不挂 `item_key` —— 已判定

| 实测 | 含义 |
|---|---|
| 近 30 天 65 个商品,**两个 org 都在卖的 = 0** | org 是菜单分组容器,不是经营实体 |
| 88 个重叠商品,售价 **88/88 完全相同** | 价格都不分,成本更没道理分 |
| 一个 `item_id` 恰好一个 `spec`(123/123) | `item_id` 是干净的商品身份 |
| `ops_store` 2 行,其中「海外项目组」inactive | 只有一家实体店 |
| org7 是 **2026-04-02** 才出现的 | org 会变,挂 `item_key` 每次改菜单都要重做 |

将来开第二家店时变的是**采购价**(`cost_card_item_price` 加 store 维度),不是**配方对应关系**。

```sql
-- 商品身份 ↔ 成本卡配方。全局唯一，不分 org、不分门店。
DROP TABLE cost_card_product_link;   -- 94 行零信息量，无读取方，直接重建
CREATE TABLE cost_card_product_link (
  pos_item_id  text        PRIMARY KEY,                   -- POS 商品身份，不含 org 前缀
  item_id      bigint      NOT NULL REFERENCES cost_card_item(id),
  mapped_by    text,
  mapped_at    timestamptz NOT NULL DEFAULT now(),
  note         text                                        -- 「草莓塔对哪张卡」这类判断必须留痕
);
ALTER TABLE cost_card_product_link ENABLE ROW LEVEL SECURITY;
```

查成本时用 `split_part(item_key,'-',3) = pos_item_id` 从销售行接回来。

#### ✅ 映射已完成(2026-08-04)

**37 条人工对照,模拟验证成本覆盖率 `0.0% → 92.8%`**(RM 133.2 万 / RM 143.5 万)。
迁移文件 `财务站/sql/080_relink_cost_card_product.sql` 已写好,并已登记进 `scripts/apply-migrations.js:62`。

迁移内建四道闸:
1. **前置**:确认旧表 94 行确实 `external_key = 物料名`、`store` 全空 —— 不是纯冗余就 `RAISE EXCEPTION` 中止
2. **留档**:`cost_card_product_link_pre080` 存旧表,不直接 DROP
3. **后置**:37 条计数 + 所有 `item_id` 必须是 `product` 类型 + **覆盖率 <80% 直接中止**(防止 `pos_item_id` 取错段)
4. **RLS**:新表已开,否则 `sql/059:375-403` 自检会回滚整条链

对表过程中修正一处:**蓝莓软心巴斯克原本挂到了树莓的卡(72)** —— 71 才是蓝莓,已改。

#### 🔴 跑完之后必须跟进的五件事

| # | 事项 | 状态 |
|---|---|---|
| 1 | **成本率 >70% 的 5 个**:菲力牛肉派(网状) **85.8%** / 招牌惠灵顿 **82.9%** / 榛子马卡龙 75.6% / 牛肉坚果棒 75.2% / 开心果片碱水结 74.6% | 要么配方不对,要么采购价不对 |
| 2 | **成本率 <25% 的 2 个**:蓝莓香缇软心巴斯克 18.4% / 树莓香缇软心巴斯克 17.5% | **映射是对的,配方要改** —— 八寸 900g 面糊只写了 1.7g。改完成本自动上去,不用动映射 |
| 3 | **两张卡算不出成本**:`75 半糖伊朗开心果奶油拿破仑酥`、`27 树莓奶油可颂` | `v_cost_card_data_quality` 报 `missing_price` —— **末级原料缺采购价,配方已发布**。补价即可 |
| 4 | **67 号卡被两个商品共用**(草莓玫瑰拿破仑 + 草莓黑巧拿破仑) | 设计允许一卡多品,但用料若不同需拆卡 |
| 5 | **饮品 13 个、近 30 天净销 RM 51,894 完全没有成本卡** | 这是剩余 7.2% 覆盖率的主体。成本卡只覆盖烘焙品,饮品要单独建卡 |

> ⚠️ **惠灵顿选的是 34(RM 23.66,成本率 82.9%)不是 35(RM 18.49,64.7%)** —— 人工裁定。
> 但它是全店第一大单品(近 30 天 7,982 件 / RM 227,869),**上线第一天这个数就是最扎眼的**。
> 若数字看着不对,那就是选错卡,改一行 `item_id` 即可。

#### 📌 对表方法论(留档,下次改菜单还要用)

四条自动匹配全部不可用:

| 规则 | 命中 |
|---|---|
| `external_key` ↔ `pos_product.item_key` | **0 / 94** |
| ↔ `pos_product.name_zh` | 4 / 94 |
| ↔ `pos_product.name_zh_display` | 0 / 94 |
| ↔ bakery-ops `product.name` | 20 / 94 |

三套命名并存:成本卡叫 `原味蛋挞`(配方师取名)、POS 中文叫 `趁热心动蛋挞`(营销取名)、POS 英文叫 `Hot Crush Egg Tart`(顾客看到的,也是 `item_hourly_sales.item_name` 用的)。

**辅助人工对表的两条规则(实测有效,下次可复用):**
1. **剥品牌前缀再比**:`趁热心动` / `法式` / `招牌` / `半糖` / `芙洛芙拉` / `Hot Crush` / `French` / `Signature` / `TOP1-3` / `(下架)` / `测试` / 结尾的 `新`
2. **品类闸门**(关键):按后缀品类分组 —— 泡芙 / 蛋挞·挞·塔 / 碱水结 / 马卡龙 / 巴斯克 / 可颂 / 贝果 / 吐司 / 曲奇 / 拿破仑 / 蝴蝶酥 / 派 / 坚果棒 / 锥锥筒 / 盐面包 / 惠灵顿。**品类不同直接罚到 1/4 权重**。
   加这一条之前串了一堆:`蓝莓奶油蛋糕泡芙` 匹到 `蓝莓奶油蛋挞`、`榛子巧克力奶酪马卡龙` 匹到 `榛子巧克力碱水结`、`树莓奶油挞` 匹到 `草莓奶油蛋挞` —— 加上之后全部自动修正。

**交互式对照表:** [cost-card-pairing.html](cost-card-pairing.html)(候选按相似度排序、显示成本与成本率、选择存 localStorage、可导出 SQL)。下次改菜单重新生成即可。

**对抗审查在自动映射方案里抓出四个会算错钱的地方 —— 这就是为什么必须人工:**

| # | 问题 | 金额影响 |
|---|---|---|
| 🔴 | **`招牌黑松露牛排惠灵顿`** 有两张卡(id=34 成本率 82.8% / id=35 成本率 64.7%),而它是**全店第一大单品**(近 30 天 8,427 件 / RM 240,674) | 两卡 COGS 差 **RM 43,567/月** |
| 🔴 | **`奶酪核桃马卡龙`** 有两张同品卡(id=64 老卡 unit_cost 8.17 / id=502 新卡 4.70),同一套料只是用量不同 | 差 **RM 35,000/月** |
| ⚠️ | **`蓝莓/树莓软心巴斯克`**(71/72)配方漏算蛋糕体 —— 八寸 900g 面糊只写了 **1.7g**,整块蛋糕胚只计 RM 0.105 | 少算约 **2.4 倍**,RM 4.2 万/月销售 |
| ⚠️ | **`法式黑巧薄脆碱水结`** 该挂 id=88(`法式丹麦面团`,与 POS 名「法式」对应)而不是 id=32(`碱水结可颂面团`) | 差 RM 1.37/件 |

**并且:成本率一律要用实收单价做分母,不能用 `pos_product.sales_price`** —— 该列陈旧。实测 `法式黑巧薄脆碱水结` list 价 9.00 但近 30 天实收稳定在 12.66,按 list 算成本率 87.4%(假警报),按实收算只有 62.1%。

异常监控要**同时查上下界**:`> 70%` 抓错高,`< 25%` 抓错低 —— 蓝莓巴斯克那种「少算」会伪装成好消息,只查上界永远抓不到。

### 3.4 视图收敛 9 → 5

| 视图 | 处置 | 依据 |
|---|---|---|
| `v_cost_card_current_cost` | **留**,定义不动 | 真源,3 处引用 |
| `v_cost_card_data_quality` | **留** | 3 处引用。当前告警:缺售价 232 / 缺采购价 14 |
| `v_cost_card_recipe_expanded` | **留** | 纯中间层,被上面两个内部依赖 |
| `v_cost_card_price_current_normalized` | **留** | 真源。时间基准是吉隆坡营业日 |
| `product_material_cost` | **保名,压成一层** | bakery-ops 每日复盘在读(`daily-review-chat.definition.ts:269/286`) |
| `v_cost_card_product_material_cost_compat` | **删**(合并进上面) | 纯转发层 |
| `product_cost` | **删** | 0 引用,`SELECT ... FROM ..._compat` 纯别名 |
| `v_cost_card_product_cost_compat` | **删** | 0 引用,硬编码 `'供应链单位成本（非月度消耗）'::text` |
| `v_cost_card_price_current` | **删** | 是 029 的原始价格视图,被 036 的 normalized 版取代后没删干净。**且它用 `CURRENT_DATE`(UTC)而不是营业日** —— 每天 KL 00:00–08:00 会取到前一天的价 |

### 3.5 代码清理清单(6 项可安全删除)

| 文件 | 为什么能删 |
|---|---|
| `财务站/scripts/migrate-mysql-cost-cards.js` | 一次性基线迁移,依赖的表已被 075 删,现在跑必抛错 |
| `财务站/scripts/backfill-cost-prices.js` | 同上,已死 |
| `财务站/scripts/cost-price-source.js`(+ 单测) | 上面两个的共用依赖,专解析 MySQL 源表列名 |
| `财务站/package.json:9` 的 `db:import-cost` | 入口指向已死脚本 |
| `财务站/test/db-integration.js:182-192, 199-219` 的 `verifyImporterContract()` | 把 Keychain 服务名、`MYSQL_PWD`、`mysqldump`、11 张源表行数钉死成断言 |
| `财务站/index.html:941` 的「MySQL 备份 · 只读保留」卡片(+ `test/ui-content.test.js:436`) | 退役后是误导 |

顺带两处纯文字残留:`bakery-ops/src/modules/shared/db/postgres.ts:25` 的「MySQL-style ? 占位符」注释、`027_product_cost.sql:11` 的 `'baking_cost_2026.v_product_direct'` 默认值。

### 3.6 🔴 三个会让这一步失败的陷阱

**① 新迁移不登记进清单会静默永不执行。**
`财务站/scripts/apply-migrations.js:10-63` 的 `MIGRATION_FILES` 是**硬编码数组,不做 readdir**。放进 `sql/` 但没登记的文件不报错、直接跳过。新迁移必须追加进数组(在 `:62` 那条注释之前)。

**② 不能删 `bakery-ops/.../027_product_cost.sql`。**
财务站**仍在执行清单里**的 `sql/031_cost_card_compatibility.sql:52,73` 把 `product_cost` / `product_material_cost` 当**表**做 `INSERT ... ON CONFLICT`,`046:100-101` 又 `COMMENT ON TABLE`。而这两张表全库唯一的建表 DDL 就是 027。删掉它,财务站迁移链在任何全新库上永远跑不过 031。
→ 正确做法:027 加一行冻结注释「仅为财务站 031+046 的历史重放保留,禁止在现有库上手工应用」。

**③ 两个直连生产库的测试会硬崩。**
`财务站/test/verify-067-072-rollback.mjs:41,92,100`(`SNAPSHOT` 在 `:158` 事务外直连生产 `sql` 句柄)、`test/db-integration.js:236,240-241,255-258,497,533-535,556,588`(含模板字符串拼表名的动态 SQL)。删视图前必须先改这两个文件。

### 3.7 顺带清掉的孤儿

`cost_prevent_raw_mutation()` —— 它守护的 `cost_raw_*` 快照表(`source_system` 默认值就是 `'mysql'`)已被迁移 075 全部删除,函数留了下来,**0 个触发器引用**。全库 16 个函数里唯一的真孤儿。

```sql
DROP FUNCTION IF EXISTS public.cost_prevent_raw_mutation();
```

### 3.8 三条注释必须一起改

`财务站/sql/046_table_comments.sql:34, 100, 101` 至今仍在库里宣称「当前 94 条全部指向 MySQL 源 v_product_direct,**尚未与运营库 product 表建立任何映射,别指望用它做成本卡与 POS 商品的关联**」。

> 这条注释是准确的 —— 但改挂之后它会变成假信息,而下一个人会照着它继续绕开这张表。**这正是这个问题拖了这么久没被发现的原因。**

---

## 四、核心 DDL

### 4.1 `daily_revenue` 改键 ★已批准

```sql
BEGIN;
-- 实测 236/236 行 store 全为 NULL。此回填只在单店期间无歧义。
UPDATE daily_revenue SET store='吉隆坡Pavilion门店' WHERE store IS NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM daily_revenue WHERE store IS NULL)
    THEN RAISE EXCEPTION '仍有 store 为空的行'; END IF;
  IF EXISTS (SELECT date, store FROM daily_revenue GROUP BY 1,2 HAVING count(*)>1)
    THEN RAISE EXCEPTION '(date,store) 有重复，无法建唯一约束'; END IF;
END $$;

ALTER TABLE daily_revenue ALTER COLUMN store SET NOT NULL;
ALTER TABLE daily_revenue DROP CONSTRAINT uk_daily_revenue_date;
ALTER TABLE daily_revenue ADD CONSTRAINT uk_daily_revenue_date_store UNIQUE (date, store);

CREATE VIEW v_revenue_reconciliation
  WITH (security_invoker = true) AS
SELECT dr.date, dr.store, dr.revenue AS reported_revenue,
       h.hourly_revenue, dr.revenue - h.hourly_revenue AS diff,
       dr.transaction_count, h.hourly_bills,
       dr.transaction_count - h.hourly_bills AS bill_diff
FROM daily_revenue dr
LEFT JOIN (SELECT date::text d, SUM(net_sales) hourly_revenue, SUM(bill_count) hourly_bills
             FROM hourly_sales_summary GROUP BY 1) h ON h.d = dr.date;
COMMIT;

-- 回滚（数据不丢，只回约束）：
-- ALTER TABLE daily_revenue DROP CONSTRAINT uk_daily_revenue_date_store;
-- ALTER TABLE daily_revenue ADD CONSTRAINT uk_daily_revenue_date UNIQUE (date);
-- DROP VIEW v_revenue_reconciliation;
```

> **三条硬约束(实测得出,不可违背):**
> 1. **不要改 `date` 列类型。** `ALTER COLUMN date TYPE date` 会让 bakery-ops 的 `current_date >= to_char(...)` 报 **ERROR 42883**(命中 `forecast-calc.repository.ts:217`),且驱动返回值从 `string` 变 `Date`,而 `daily-review.repository.ts:61` 显式声明返回 `string`,这个值直接进 Lark 周报文案。
> 2. **不要建 store 维度表。** `finance_*` 的 store 值域实测只有两个:`吉隆坡Pavilion门店` 1831 行、**`全部` 69 行**,而 `finance_targets` 是 `PRIMARY KEY (month, store, item)` —— 加 FK 会失败或清掉那 69 行人工目标值。
> 3. **必须三仓库同窗口发布。** 兼容视图救不了(视图不支持 `ON CONFLICT`),而唯一会喊的告警 `freshness-check.ts:19-26` 是 `catch { logger.warn; return; }`,42P01 被原地吞成 no-op。

### 4.2 `fact_hbti_response` ⏰ 有时限

```sql
BEGIN;
CREATE TABLE IF NOT EXISTS public.fact_hbti_response (
  store            text        NOT NULL,
  member_id        text        NOT NULL,
  campaign_version text        NOT NULL,
  answered_at      timestamptz NOT NULL DEFAULT now(),
  attempt_id       text        NOT NULL,
  answers          jsonb       NOT NULL,
  hbti_code        text        NOT NULL,
  color            text,
  gender           text,
  age              text,
  CONSTRAINT pk_fact_hbti_response
    PRIMARY KEY (store, member_id, campaign_version, answered_at),
  CONSTRAINT ck_fact_hbti_answers_shape CHECK (jsonb_typeof(answers) = 'object')
);
ALTER TABLE public.fact_hbti_response ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS fact_hbti_response_campaign_idx
  ON public.fact_hbti_response (campaign_version, answered_at DESC);
COMMENT ON TABLE public.fact_hbti_response IS
  '所有权=hbti-web。HBTI 13 题的题目级原始作答，抢锁成功那一刻写一次。'
  '写入点 pg-completion-store.ts recordAnswers()，与 pos_member.hbti_completed_at 同时刻。'
  '★永久事实，不带 TTL，绝不可加进 purgeExpired 的 EXPIRING 列表。';
INSERT INTO schema_migrations (version, name) VALUES (300, 'hbti_fact_response')
  ON CONFLICT DO NOTHING;
COMMIT;
-- 回滚：DROP TABLE public.fact_hbti_response;
```

**不给它加指向 `pos_member` 的外键** —— res_api 每晚重写那张表。

### 4.3 `out_of_stock_record` 改视图

视图必须暴露 10 列且 `id` 要用 `row_number()` 伪造(`forecast-calc.repository.ts:75` 的 `rowToOutOfStock` 在用):

```sql
ALTER TABLE out_of_stock_record RENAME TO out_of_stock_record_legacy;  -- 保留数据，不 DROP
CREATE VIEW out_of_stock_record WITH (security_invoker = true) AS
SELECT row_number() OVER (ORDER BY date, product_name)::bigint AS id,
       date, product_name, input_name, soldout_time, soldout_slot,
       day_type, loss_slots, estimated_loss_qty, estimated_loss_amount
FROM ( /* computeStockoutForDate() 的 SQL 等价实现，源表 item_hourly_sales + item_waste */ ) t;
```

> 先 RENAME 不 DROP —— 519 行里有 14 组重复行,但也有算法变更前的历史判定,先留一期再删。

### 4.4 `app_user_role` 折入 `app_user`

```sql
BEGIN;
-- 先校验后动（本仓惯例，见 sql/057:30、072:139）
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM app_user_role GROUP BY user_id HAVING count(*)>1)
    THEN RAISE EXCEPTION '存在多角色用户，本迁移不适用'; END IF;
END $$;

ALTER TABLE app_user ADD COLUMN role_code text,
                     ADD COLUMN role_assigned_by bigint,
                     ADD COLUMN role_assigned_at timestamptz;
UPDATE app_user u SET role_code=r.code, role_assigned_by=ur.assigned_by, role_assigned_at=ur.assigned_at
  FROM app_user_role ur JOIN app_role r ON r.id=ur.role_id WHERE ur.user_id=u.id;
UPDATE app_user SET role_code='viewer' WHERE role_code IS NULL;

ALTER TABLE app_user
  ALTER COLUMN role_code SET NOT NULL,
  ALTER COLUMN role_code SET DEFAULT 'viewer',
  ADD CONSTRAINT app_user_role_code_fkey FOREIGN KEY (role_code)
    REFERENCES app_role(code) ON UPDATE CASCADE ON DELETE RESTRICT;
    -- 原来是 ON DELETE CASCADE：删角色会静默剥光用户权限。RESTRICT 更对。

DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM app_user WHERE is_active AND role_code='admin';
  IF n < 1 THEN RAISE EXCEPTION '折叠后没有启用中的管理员'; END IF;
END $$;

DROP TABLE app_user_role;
COMMIT;
```

---

## 五、五个代码库逐接口改造

### 5.1 hbti-web(0.8 人天 · **最先发布,与其他仓库完全解耦**)

实测全仓 SQL 只碰 `pos_member` / `hbti_auth_token` / `hbti_rate_limit` / `hbti_gift_stock` 四张表,不引用任何被删或改视图的对象。

| file:line | 符号 | 操作 | 改成什么 |
|---|---|---|---|
| `src/lib/db/postgres.ts:35-91` | `getDb` | 读写 | **不动**。6543 门禁、`max:1`、`prepare:false` 全部保留 |
| `src/lib/store/completion-store.ts:148-153` | `CompletionStore` 接口 | — | 加第三个 **optional** 形参 `answers?: Readonly<HbtiAnswers>` |
| `src/lib/store/pg-completion-store.ts:232-279` | `acquireProcessing` | 写 | 抢锁成功后调 `this.recordAnswers(key, record, answers)` |
| `pg-completion-store.ts:280` | **`recordAnswers`(新增)** | 写 | `INSERT INTO fact_hbti_response ... SELECT ... WHERE NOT EXISTS (1小时窗口 + answers 相等)`,整段包 `try/catch` 只告警 |
| `pg-completion-store.ts:459-462` | `checkCompletionStoreFromEnv` | 读 | 加第二条探活 `SELECT 1 FROM fact_hbti_response LIMIT 1` |
| `src/lib/completion/complete-hbti.ts:183-189` | `acquireCompletion` 调用点 | 写 | 传入 `parsed.data.answers` |
| `complete-hbti.ts:718-740` | `acquireCompletion` helper | 写 | 加 `answers: HbtiAnswersInput` 形参并透传 |
| `pg-completion-store.ts:348-363` | `clearLocked` | — | **不动**。答过题是既成事实,发券前失败不该抹掉 |
| `pg-completion-store.ts:590-593` | `EXPIRING` 常量 | — | **不动,且要加反注释**。`fact_hbti_response` 是永久事实,加进来会 42703 |

**三个关键设计决定:**

1. **不把两条语句合成 CTE。** 合成后 fact 表的任何故障(迁移没上、约束撞、盘满)都会回滚抢锁,把「答案存不下」升级成「券发不出」。`postgres.js` 无显式 `begin` 时每条语句自成事务,所以抢锁先提交、答案后写,失败方向安全。

2. **`recordAnswers` 的 `catch` 只告警不抛。** 但代价是**迁移 300 没上线也不会有任何症状** —— 每次完成静默丢答案,`/api/health` 仍 200。所以健康检查必须同时加第二条探活,把它变成可见的 503。

3. **绝不把 answers 塞进 `hbti_record`。** `completionSnapshotSchema` 是 `z.strictObject`,多一个字段会让该会员此后每一次 `get()` 都 parse 失败,而保留期 548 天。

**幂等:** 抢锁成功本身就是「本期第一次」的证明。剩余重复只来自 `clearLocked` 之后的重试(stale locked 90 秒),用 1 小时 `NOT EXISTS` 挡掉 —— 同时比对 `answers` 相等,所以顾客改了答案重做照样记新行。

**测试:** `tests/pg-stores.integration.test.ts:154-160` 的 `afterAll` 断言必须补一条 `fact_hbti_response WHERE member_id LIKE '91%'` 应为 0;`:412-487` 加 4 个用例。⚠️ 4 个假 store 只声明 0-2 个形参,加 optional 参数后**仍然编译通过** —— 编译期不会提醒你忘了传 `answers`,唯一保护是集成测试的行数断言,**必须带 `DATABASE_URL` 跑一次**。

**顺带修:** `.env.local` 与两份 `.vercel/.env.*.local` 都还是 Mongo 时代快照(键集是 `MONGODB_URI` / `HBTI_MEMBER_HASH_SECRET`,**完全没有 `DATABASE_URL`**),用 `vercel env pull` 覆盖;`README.md:104-106` 的迁移清单漏了 101,上线后改成 `066/077/078/101/300/301`。

### 5.2 res_api(1 人天)

8 个文件 `import postgres`。

| file:line | 操作 | 改成什么 |
|---|---|---|
| `sync-to-db.js:153-164` | 写 | `ON CONFLICT ON CONSTRAINT uk_daily_revenue_date` → `uk_daily_revenue_date_store`;INSERT 列表补 `store`,值取 `process.env.RES_STORE_NAME \|\| '吉隆坡Pavilion门店'` |
| `sync-to-db.js:104-175` | 写 | `syncDailyRevenue()` 的 degraded/COALESCE 逻辑保留 —— 实测 `import_source` 236 行全为 NULL,这条防线从无生效场景,但改键不影响它,不动 |
| `sync-to-db.js:206/218/232` | — | 放开写死的 `D_itemType IN ('0','2')`。实测造成 24 小时金额缺口共 −RM353.98。⚠️ 先查返回值确认 COMBO 与 COMBO_DETAIL 别双算 |
| `scrape-intraday.mjs:114` | 写 | INSERT 列表补 `item_key`。现在每天 14:20–23:00 之间当天的行 `item_key` 全为 NULL |
| `sync-to-db.js:407-416` | 写 | `item_waste` 的 DELETE+INSERT 补塌陷护栏,照抄 `:236-253` |
| `sync-to-db.js:452-459` | 写 | `item_last_sale` 同上 |
| `backfill-gross-sales.mjs:151-154`<br>`fix-revenue-net.mjs:106-109` | 写 | 改键后 `WHERE date=` 会命中多行。加 `AND store=` 或改名加 `_` 前缀归档(`deploy.sh:51` 会自动排除) |
| `sync-member.mjs:70-73` | 写 | **不动**。24 列 upsert,`phone_e164` 是 GENERATED 列绝不可进 INSERT 列表 |
| `_backfill-item-key.mjs:32` | — | `NAME_COL` 里含 `daily_sales_record`(已是视图),跑它会报错。归档 |
| `.env.example` | — | 补 `DATABASE_URL`(8 个脚本必需)、`API_KEY`、`ALERT_WEBHOOK`;`package.json:14` 的 `sync-pnl` 指向不存在的文件 |

**测试:** `test/sync-to-db.test.js:100,126,170-182,222,226,235-240`(6+ 用例围绕 daily_revenue 写入)、`test/zero-day.test.js:130-141`、`test/daily-refresh-guard.test.js:54,80`。

**时间窗:** `daily-refresh.sh` KL 23:00、`intraday-refresh.sh` 14:20,由 Contabo cron 触发,本机 launchd 四个任务全是 `.plist.disabled`。

### 5.3 bakery-ops(2.5 人天)

| file:line | 操作 | 改成什么 |
|---|---|---|
| **★已批准 · 停写 daily_revenue** | | |
| `daily-review.repository.ts:51-57` | 写 | 摘除 `upsertDailyRevenue()`。店长手填改存 `daily_review.manager_revenue`(迁移 104 新列) |
| `app/(forecast)/review-actions.ts:15,31` | — | 撤 server action 导出 |
| `ui/hooks/use-review.ts:78-81` | — | 改调用新的 `saveManagerRevenue` |
| **daily_revenue 改键(14 个读点)** | | |
| `daily-review.repository.ts:61` | 读 | `WHERE date=?` → `WHERE date=? AND store=?` |
| `forecast-calc.repository.ts:185,217` | 读 | 同上。⚠️ `:217` 是 `current_date >= to_char(...)`,**这也是为什么不能改 date 类型** |
| `daily-review.service.ts:44,53` · `context-builder.ts:57` · `ops-data-query.ts:77` · `data-driven-target.ts:40` · `freshness-check.ts:19` · `weekly-report.service.ts:122-126,151,155` · `morning-brief.service.ts:153,161` · `status.definition.ts:43` · `daily-review-chat.definition.ts:80,120` | 读 | 单店期间加 `AND store=$STORE` 或不加都能跑;**建议统一加**,否则开第二家店时这 14 处要重找一遍 |
| **out_of_stock_record 改视图** | | |
| `forecast-calc.repository.ts:152-164` | 写 | 摘除 `saveOutOfStockRecords` + `deleteOutOfStockByDate` |
| `stockout-detector.service.ts:341-352` | 写 | 删落库块,每晚 23:30 cron(`bootstrap.ts:174`)改为纯计算 + 告警 |
| `app/(forecast)/import-actions.ts:8-9,17-18` | — | 撤两个写 action |
| `forecast-calc.repository.ts:144` | 读 | `SELECT *` 映射 `OutOfStockRow` 10 列含 `id` —— 视图必须提供 |
| **补商品名映射(打在 41% WAPE 上)** | | |
| `product-demand.ts:29` · `restock-advice.ts:141` | 读 | 两处都是 **INNER JOIN** `product.name_en`,实测近 63 天在卖的 79 个商品名有 **37 个** join 不上(11.8% 件数、5.2% 净销),这些品在预测和加减货两条链上被**静默丢弃**,里面还有烘焙品。改法:先补 `product_alias` 映射行,再把 INNER JOIN 改 LEFT JOIN 并对未映射项告警 |
| **连接层** | | |
| `shared/db/postgres.ts:15-19` | — | 建议显式补 `ssl` 与 `prepare:false`(现在都没设);`scripts/team-list.mjs:4` 是第二个池且参数不一致,改用 `postgres.ts` |

**⚠️ 全仓 100% 手写 SQL 字符串,无 ORM 无类型生成,大量 `query<any>`。改视图/改键后列缺失**没有任何编译期保护**,只会静默输出 `RM 0` —— 与 `100_beverage_caliber.sql` 记载的历史事故同一类。22 个读点必须人工逐个核。

**✅ 有现成先例可抄:** `timeslot_sales_record` 在迁移 068 已改成 `item_hourly_sales` 派生视图,写入摘除的注释格式见 `forecast-calc.repository.ts:336-338`。

**不要删的表**(此前误判):`prompt_template`(5 行,`prompt-engine.ts:63` 查不到直接 throw,删表 = 四条 AI 链路同时挂)、`context_event`(14 行)、`screening_rules`(25 行)、`wa_send_log`(13 行,删表会让 WhatsApp 冷发日限流**静默失效**)、`appointments`(1 行,3 条 cron 依赖)。

### 5.4 财务站(4 人天 · 改动量最大)

| file:line | 操作 | 改成什么 |
|---|---|---|
| **删 app_user_role** | | |
| `api/_lib/auth.js:73-90` | 读 | 三次查询合一:`SELECT u.*, u.role_code, r.permissions ... FROM app_session s JOIN app_user u ON u.id=s.user_id JOIN app_role r ON r.code=u.role_code`。**返回时必须保持 `roles: [row.role_code]` 数组形状**,否则 `isAdminRole(roles).includes('admin')` 会把管理员判成无门店权限 |
| `api/_lib/permissions.js:32-49` | 读 | 删 `loadPermissions` / `loadRoles`(同一个 JOIN 查了两遍)。保留 `hasPermission` |
| `api/users.js:36-45` | 读 | `EXISTS(SELECT 1 FROM app_user_role ...)` → `u.role_code='admin'` |
| `api/users.js:48-53` | 读 | 管理员计数改 `SELECT count(*) FROM app_user WHERE is_active AND role_code='admin'` |
| `api/users.js:61-72` | 读 | 去掉两个 LEFT JOIN 和 `array_agg`,直接 `u.role_code`,返回包成数组 |
| `api/users.js:109-117,228-233` | 写 | `DELETE`+`INSERT` → `UPDATE app_user SET role_code=?, role_assigned_by=?, role_assigned_at=now()` |
| `scripts/create-admin.js:52-58` | 写 | INSERT 时直接带 `role_code='admin'`,删第二条 INSERT |
| **删 finance_import_batch_history** | | |
| `api/_lib/import-batch.js:222-223` | — | 抽成独立函数 `lockImportSlots(tx, storeSlots)`,在 `writeDataset` 前无条件调用。**锁键计算全程在内存**(`importSlotLockKeys` 只吃 `history.storeSlots`),零表依赖 |
| `import-batch.js:225-238` | 读 | **删掉** `payload_sha256` 整批跳过。它不是正确性护栏(写入本身是「槽位先删后插 + 单事务」构造性幂等),而且它是**错的**:脚本把某月写坏后拿原始 Excel 重传想恢复,系统会因 hash 撞上回你「内容未变化」拒绝写入 |
| `import-batch.js:158-166,169-179` | 写 | 删。`:893-907` 已经在同一事务把 batchId/results/storeSlots 整包写进 `app_audit_log.after_data`,13 列没一列装不下 |
| `api/import-history.js:116,144` | 读 | 改查 `app_audit_log WHERE action='finance.import'` |
| `sql/load2.js` 等一次性脚本 | 写 | **套上同一把 advisory lock** —— 现在 100% 的数据是从没上锁的那扇门进来的 |
| **★已批准 · daily_revenue 改键** | | |
| `import-batch.js:631-640,663-671` | 写 | `writeLegacyDailyRow` / `writeDailyRow` 两个 legacy 分支**删掉**,只保留 `writeSourceBoundDailyRow` 路径 |
| `import-batch.js:701-749` | 写 | 目标从 `finance_revenue_daily` 改回 `daily_revenue`,`ON CONFLICT (date, store)` |
| `import-batch.js:704-722` | 读 | 跨表 `FOR UPDATE` 冲突检测**整套退役** —— 改键后两个口径不再抢同一行 |
| `api/sales.js:96-113` | 读 | `mergeDailySources` 简化为直接读 `daily_revenue`;重叠改由 `v_revenue_reconciliation` 呈现 |
| `api/sales.js:135,142,151` · `api/finance.js:106,114,124` | 读 | 加 `store` 条件 |
| **删 finance_labor** | | |
| `api/finance.js:189,222-224,270` · `js/db.js:102` · `js/store.js:8` · `api/_lib/ai-facts.js:69` | 读 | 全删。⚠️ 保留 `api/finance.js:190,196` 的 `store='__legacy_unassigned__'` 特判,别把 `finance_order_base` 那条一起删了 |
| **删 finance_stock_flow** | | |
| `api/finance.js:208,239-241,294-297` · `js/db.js:106` · `js/store.js:10` · `api/_lib/ai-facts.js:70` | 读 | 全删 |
| **连接层** | | |
| `api/_lib/db.js:12-17` | — | 建议补显式 `ssl`(现在靠连接串的 `sslmode`) |

**⚠️ 测试会大面积静默变红:** `test/upload-api.test.js`(1,100 行)、`test/migration-chain.test.js`(600 行)、`test/store-scope-api.test.js`(590 行)用**逐字源码正则**钉死了写法(`AGENTS.md:54-56` 明确警告)。`test/auth-policy.test.js:125` 的 `/DELETE FROM app_user_role/` 要改成 `/UPDATE app_user[\s\S]*role_code/`。

**部署:** 无 `vercel.json` 因此全站无 cron;未连 GitHub,靠手动 `npx vercel --prod` **从当前工作目录打包**(出过一次事故:未提交的功能随部署上线,从干净 master 部署又被抹掉)。

**建议把源码从 iCloud 目录迁到 `~/hot/` 纳入统一 git** —— 生产库 schema 权威源(含 063、066)现在依赖 iCloud 同步,「优化存储」可能把它驱逐成占位符。

### 5.5 scripts/ 与 ops/ —— 零改动

5 个 Python 只调 Lark Bitable API,`ops/hbti-token/` 是 RES 令牌轮换,都不连库。

---

## 六、执行记录 ✅ 2026-08-04

### 已完成并验证

| # | 动作 | 验证 |
|---|---|---|
| 1 | **全库备份** `pg_dump -Fc`（本机无 pg 客户端，用 docker `postgres:18-alpine`） | `backups/hotcrush-20260804-1852.dump` 3.3 MB。**拉临时库真恢复了一遍**：73 张基表、行数对得上 |
| 2 | **台账补登** 77/78/101 的 checksum | 剩余 22 行无 checksum 的是版本 1–24（bakery-ops 历史），不在财务站执行器清单里，不阻塞 |
| 3 | **迁移 080** 成本卡重挂（37 条人工映射） | **成本覆盖率 0.0% → 92.8%**，近 30 天毛利率 **42.4%** |
| 4 | **迁移 106** `fact_shift` + 人效视图 + 门店身份桥 | RLS ✅ security_invoker ✅ |
| 5 | **迁移 300** `fact_hbti_response` + hbti-web 代码 | 5 个集成用例真库通过；CHECK 实测能挡住缺题；**变异测试**证明透传断言真的在守 |
| 6 | **迁移 081** 成本卡视图 9 → 5 + 清孤儿函数 | `product_material_cost` 94 行仍可读；bakery-ops 消费链未断 |
| 7 | **迁移 082** `app_user_role` 折进 `app_user.role_code` | **用还在的旧表做对照，折叠前后角色与权限逐字段完全一致** |
| 8 | **MySQL 代码退役** | 删 3 个死脚本 + `db:import-cost` 入口 + `verifyImporterContract()` + UI 的 MySQL 卡片；`js/cost-card.js:1138` 去掉 `source_ref` 渲染 |

### 测试结果

| 仓库 | 结果 |
|---|---|
| hbti-web | lint 干净 · **311/311** · build 成功 |
| 财务站 | **496/496** · 连库 `--all` ok · `--cost-card-runtime` ok |
| bakery-ops | **444/444** |

**全库终检：** 未开 RLS 的表 **0** · 未设 `security_invoker` 的视图 **0**（`sql/059` 的两条硬不变量）。

### 执行中撞到并修掉的五个问题

**① 080 的文件格式与执行器冲突。** 财务站迁移**不写 `BEGIN/COMMIT`、不自注册 `schema_migrations`**（`apply-migrations.js:121` 已包事务、`:124` 已写台账）。原稿两样都有，会主键冲突整体回滚。

**② `round(double precision, int)` 在 PG 里不存在。** `daily_revenue.revenue` 是 `double precision`，106 的人效视图报错整体回滚（零残留）。加 `::numeric`。

**③ 🔴 库里有两套互不相通的门店标识：** `ops_store.store_code='pavilion'`（人事招聘域 8 条外键）vs `daily_revenue.store` / `pos_member.store` / `finance_*.store`=`'吉隆坡Pavilion门店'`（销售财务域，无外键）。**之间没有任何映射** —— 不补桥，人效视图会永远静默返回 NULL。已在 106 加 `ops_store.pos_store_name`。桥值已核对无误，但要等迁移 102 回填 `daily_revenue.store` 才连得上。

**④ 🔴 `now()` 在事务里是常量。** 300 原设计把 `answered_at` 放进主键，同事务两次写入撞主键。改成 **`attempt_id` 作主键 + `clock_timestamp()`** —— 语义上也更对：一行 = 一次作答尝试。

**⑤ 方案里「删 `finance_labor` / `finance_stock_flow`」这条判错了。** `js/engine.js:250` 明确写着「旧 finance_labor 四维表不再作为数据源（**库中保留作历史备查**）」，而 `test/store-scope-api.test.js` 用它测 `__legacy_unassigned__` 的安全行为。「前端零消费」不等于「该删」。**已撤销，两张表保留。**

### 🛑 停在哪里，为什么

**A. `daily_revenue` 改键（第 9 步）需要三仓库同窗口发布。**
执行时是 KL 19:00 前后，距 res_api 每晚 23:00 的同步不到 4 小时。只改约束不发代码 → `ON CONFLICT ON CONSTRAINT uk_daily_revenue_date` 找不到 → 当晚同步失败 → 次日早简报不发。而唯一会喊的告警 `freshness-check.ts:19-26` 是 `catch { logger.warn; return; }`，会把它吞掉。

**B. `app_user_role` 的 DROP 拆成了两阶段。**
082 **只加列不删表**。财务站是手动 `npx vercel --prod` 部署，库改了代码不会自动跟上 —— 先删表则线上仍在读 `app_user_role` 的代码立刻 500，全站登录挂（`api/_lib/auth.js:88-91` 无 try/catch）。
**新代码上线并确认登录正常后**，再由 083 单独 `DROP TABLE app_user_role`。

**C. 删账本表 `finance_import_batch_history` 前必须先真传一次 Excel。**
它现在 0 行 = 网页上传通道从没在生产用过（表龄 12 天）。拆锁之前得先确认这条链路是通的。

---

## 七、执行时序

```
第 0 步  轮换生产库口令 + 清三份明文 + 清 app_session        ← 优先于全部
第 1 步  ✅ pg_dump 已做（但还没上 cron，仍是一次性快照）
第 2 步  ✅ 台账补登完成
─────────────────────────────────────────────────────────
第 3 步  hbti-web:迁移 300 → 部署代码 → 验证                 ⏰ 有时限，可独立发布
─── MySQL 退役（§三，四步，彼此独立，都不碰生产写入链）───────
第 3a 步 js/cost-card.js:1138 去掉 source_ref 渲染             ← 一行改动，UI 立刻不再出现 mysql
第 3b 步 删 3 个死脚本 + db:import-cost + 两处 UI/测试残留      ← 零风险
第 3c 步 视图收敛 9→5（迁移 084）                              ← 先改两个直连生产库的测试
第 3d 步 ✅ 迁移 080 已应用 —— 覆盖率 0% → 92.8%，毛利率已能算
第 3e 步 停本机 mysqld（备份已在 财务站/backups/）
────────────────────────────────────────────────────────
第 4 步  bakery-ops:补商品名映射                              ← 打在 41% WAPE 上
第 5 步  res_api:三处抓取修正                                 ← 独立小改
第 6 步  财务站:app_user_role 折入(迁移 080)                 ← 只动财务站
第 7 步  财务站:真传一次 Excel 走通导入链路                    ← 决定第 8 步
第 8 步  财务站:拆锁 + 事件迁审计 + 删账本表(迁移 081)
─────────────────────────────────────────────────────────
第 9 步  ★ daily_revenue 改键 —— 三仓库同窗口                 ← 唯一需要协调的
         ① 停 Contabo cron  ② 跑迁移 102  ③ 同时发布 res_api
         + bakery-ops + 财务站  ④ 恢复 cron  ⑤ 次日核对
第 10 步 bakery-ops 停写 daily_revenue(迁移 104)              ★已批准
第 11 步 财务站删 finance_labor + finance_stock_flow(迁移 082)
第 12 步 out_of_stock_record 改视图(迁移 103)
第 13 步 建 fact_production_plan + fact_dispatch(迁移 105)
第 13a步 ✅ 迁移 106 已应用（提前执行，与其他步骤无依赖）
第 14 步 hbti-web 迁移 301 删死列                              ← 低优先
```

**DDL 时间窗:** 避开 res_api 每晚 KL 23:00 与 14:20,以及 Contabo 的 `/etc/cron.d/recruit-*`。建议 **KL 01:00–13:00**。

**工作量:** hbti-web 0.8 + res_api 1.0 + bakery-ops 2.5 + 财务站 4.0 + DDL/验收 1.5 ≈ **10 人天**。

---

## 八、每步的失败与回滚

| 步骤 | 跑到一半失败 | 怎么退 |
|---|---|---|
| 迁移 300(建表) | 事务内,自动回滚 | 无残留。代码未发布则无影响 |
| hbti-web 代码 | Vercel 保留上一版本 | `vercel rollback`。⚠️ 若表已建代码未发,只是不写答案,无害 |
| 迁移 080(折角色) | 事务内 + 两个 `RAISE EXCEPTION` 校验 | 自动回滚。⚠️ `DROP TABLE` 之后无法回滚 —— 分两次发:先加列 + 改代码,确认无误后再单独 DROP |
| 迁移 102(改键) | 事务内 | `DROP CONSTRAINT ... ADD CONSTRAINT uk_daily_revenue_date`(见 §4.1 注释) |
| **第 9 步同窗口发布** | **某个仓库发布失败** | **这是最大风险点。** 预案:①先把三个仓库的代码都构建好再开始 ②改键后立刻发 res_api(它是唯一每晚必跑的) ③财务站发布失败可以等 —— 它只在人上传 Excel 时才写 ④bakery-ops 失败会让复盘页写入报错,但读路径不受影响 |
| 删表(081/082) | `DROP TABLE` 不可逆 | **只能靠 §第 1 步的 pg_dump**。`finance_stock_flow` 491 行、`finance_labor` 6 行、`app_user_role` 2 行 —— 建议 DROP 前先 `CREATE TABLE xxx_archive AS SELECT * FROM xxx` 留一期 |
| 迁移 103(改视图) | 已用 RENAME 不 DROP | `DROP VIEW; ALTER TABLE ..._legacy RENAME TO out_of_stock_record` |

---

## 九、验收清单

| 步骤 | 怎么确认真的对了 |
|---|---|
| 迁移 300 | 真机走一遍答题 → `SELECT jsonb_object_keys(answers) FROM fact_hbti_response ORDER BY answered_at DESC LIMIT 1` 应有 **13 个键**;`GET /api/health` 应 200 |
| 商品名映射 | `SELECT count(*) FROM item_hourly_sales i LEFT JOIN product p ON p.name_en=i.item_name WHERE p.id IS NULL AND i.date > current_date-63` 应降到 0 |
| 抓取修正 | 次日核对 `hourly_sales_summary` 与 `item_hourly_sales` 的金额差应从 24 小时降到 0 |
| 折角色 | 登出重登,管理员能看到全部门店数据;`SELECT count(*) FROM app_user WHERE role_code='admin' AND is_active` ≥ 1 |
| **改键(第 9 步)** | **次日 KL 08:00 前必查**:①`SELECT count(*) FROM daily_revenue WHERE date=昨天` 应为 1 ②早简报是否发出(`morning-brief.service.ts:232` 当天无行即 throw)③`SELECT * FROM v_revenue_reconciliation WHERE date=昨天` 的 `diff` 应为 0 |
| 停写 daily_revenue | 复盘页填一个营业额 → 应写进 `daily_review.manager_revenue`,`daily_revenue.revenue` 不变 |
| 改视图 | `SELECT count(*) FROM out_of_stock_record WHERE date=昨天` 与 legacy 表同日行数应一致(允许 14 组重复行的差异) |
| 删表 | 全站点开一遍:上传 Excel、损益表、库存页、成本卡页、登录登出 |

---

## 十、订单粒度:不做

把主事实表下沉到「订单×商品行」的方案,经 9 代理取证 + 4 视角对抗证伪,**结论是不做**。

技术上零实证(`reportId=211` 的元数据里有 `D_orderId` 但全仓从未查过,且供应商自己把它命名为 "Menu Items Summary Sheet");退款冲销会变成「买了 −145 个蛋挞」的假购物篮;源头没有行序号所以主键只能合成而现有代码撞键时直接丢行不告警;储值充值是订单但没有菜品行(占 3.58%)所以连 `bill_count` 都补不齐。

收益侧:bakery-ops 没有任何决策消费订单身份;蛋挞占 21.98% 件数、top5 占 47.2%,购物篮分析必然同义反复。代价是库从 77 MB 涨到 ~450 MB,顶穿 Supabase 免费档。

**顺带纠正一个口径:** `hourly_sales_summary.num_of_guests` **不是客流** —— 全期 180,648 人次 vs 180,496 单,2,523 个小时里 **2,373 个(94.1%)两值完全相等**,收银默认填 1。整张表真正不可替代的只有 `bill_count` 一列。

---

## 十一、与业务方建议的对照 —— 哪些匹配,哪些没有

> 一句话:**本方案覆盖的是「数据基础设施」,业务方讲的是「业务链路」。**
> 两者的交集只有成本卡那一块 —— 而那一块刚好做完了。其余大半在方案里是 0 处。

### ✅ 已匹配(5 条)

| 业务方的话 | 方案里对应 | 状态 |
|---|---|---|
| **成本卡和销售联动当日毛利率** | §3.3 迁移 080 | ✅ **已就绪**。覆盖率 0.0% → 92.8% |
| **靠 product-id 串起来** | `cost_card_product_link.pos_item_id` = `split_part(item_key,'-',3)` | ✅ 主键就是它 |
| **黑巧和草莓塔** | 37 条映射里都有(黑巧薄脆碱水结 → 32、草莓奶油挞 → 46) | ✅ 已对上 |
| **成本根据配方波动** | 成本卡本来就不落表、全部现算;`cost_card_recipe` 285 行已版本化 | ✅ **本来就成立**,改配方立刻反映 |
| **跨表抓取 vs 加门店预估单** | 已判定后者 —— 跨表同时录入失败时不知道哪张成功了,而本库没有跨表事务纪律 | ✅ 已定 |

### 🟡 部分匹配 —— 有骨架,没接线(4 条)

| 业务方的话 | 方案里有什么 | 差什么 |
|---|---|---|
| **预估单** | `fact_production_plan`(迁移 105)有表设计 | **没接线**。`plan-generator.ts` 现在纯内存算完就丢;现有 `forecast_snapshot` 只有 4 列、用商品名不是 `item_key` |
| **明日计划的调整动作** | 表里有 `plan_version` | **没有「调整原因」列** —— 方案全文 0 处 |
| **未来订的货量增减** | §六 提过「预估单 × BOM → 物料需求」的思路 | **没有设计**,只是一句话 |
| **某产品占比上涨/下降** | 销售侧数据齐(`item_hourly_sales` 8.1 万行),成本侧刚打通 | **没有「占比涨跌」的具体指标或视图** |

### ❌ 未匹配 —— 方案里 0 处(7 条)

| 业务方的话 | 方案全文出现次数 | 现状 |
|---|---|---|
| ~~**排班表** / **值班关键岗位必须写明**~~ | ✅ **已补** | 见 §10.1。`fact_shift` + 填写模板已就绪 |
| **人事的打分 → 入职培训 → 细节班表** | 0 处 | `applications` 125 行有漏斗,但 `offers` / `trials` / `employee_events` **全是 0 行**(有代码没跑起来) |
| **当日突发情况** | `context_event` 只在「不要删的表」里出现 1 次 | 表存在(14 行,日历页人工录),但方案没把它纳入建模 |
| **当日节假日 API 网上抓** | 「节假日」0 处 | `holiday` 18 行、带 `coefficient` 系数,**是人工填的** |
| **采购价根据市场波动** | 「版本化」0 处 | ⚠️ **最大的一个缺口**:`cost_card_item_price` **每物料恰好 1 行**,时间跨度只有 07-14 至 07-27。**改价即覆盖,没有历史** —— 今天算不出上个月的毛利率 |
| **订货表加上** | 「订货」0 处 | `finance_orders` 19 行是**月度采购台账**(7 个日期节点),不是日订货 |
| **预估单和班表人工录入什么** | 0 处 | 分工线已在 [ops-model-direction.md](ops-model-direction.md) §五 画好,但**没进本方案** |

### 10.1 排班链 ✅ 已补(2026-08-04)

**门店的两张 Excel 就是数据源**,不需要新建录入界面 —— 他们已经在填,而且已经在算人效。

| Excel 表头 | 实测 | 建模处置 |
|---|---|---|
| `Total turnover` | 后厨 51,000 / 前场 55,000 | **不存** —— 在 `daily_revenue` 里 |
| `Total working hours` | 后厨 168 / 前场 144.5 | **不存** —— `SUM(duration_h)` |
| `Output value` | 后厨 303.6 / 前场 380.6 | **不存** —— 两者相除。**这就是老板要的人效,他们已经在算** |

落表的只有 `fact_shift` 一张:`(work_date, store_id, staff_name)` 为主键,列与 Excel 一一对应
`Name / Post / 岗位 / on / off / notes / duration`。人效由 `v_labor_productivity` 现算。

**`duration_h` 存不算** —— 实测两张表的餐休口径**不一样**:

| | 规则 | 验证 |
|---|---|---|
| 后厨 | 在岗 **>9 小时扣 2**,否则扣 1 | shahparan 11:00–23:00 → 10 ✓ · Ong 12:00–24:00 → 10 ✓ · **合计 168** ✓ |
| 前场 | **一律扣 1** | arfan 12:00–23:00 → 10 ✓ · ayesha 12:00–22:30 → 9.5 ✓ · **合计 144.5** ✓ |

两套规则各自套进去分毫不差,所以按填的存 —— 由公式反推会与门店的账对不上。
> ⚠️ 但这值得业务方确认:**同样上 11 小时,后厨记 9 小时、前场记 10 小时。**

**「值班关键岗位必须写明」** 靠 `post` 列表达 —— `Duty` 就是关键岗,`v_shift_by_post` 按岗位汇总工时。

**填写模板:** [templates/排班表.xlsx](templates/排班表.xlsx) —— 后厨/前场两个页签,7 列与他们现在完全一致。
唯一改动:**Post 和岗位每行都填,不再靠分组标题行**(合并单元格导入会错位;前场本来就是这么填的)。

**三个待办(写在迁移 106 文件末尾):**
1. `staff_name` 暂不挂 `staff` 外键 —— Excel 用小名(豪哥 / 阿正 / jie ee(兼职)),与 `staff` 25 行匹配不上,要人工对一次,与成本卡那次同类
2. 两张 Excel 同一天填了不同 turnover(51,000 / 55,000),口径待确认
3. 前场 `ali` 一行的 `duration` 与 notes 的 `break 2hour` 对不上(填 10.0,按规则应 9.5,而当日合计 144.5 是按 10.5 加的)

### 📌 结论:还剩一条链

**成本链已通**(迁移 080)。**排班链已补**(迁移 106 + Excel 模板)。剩下最后一条:

```
订货链   fact_production_plan × BOM 展开 → 物料需求 → 订货建议
          ← 预估单表要先接线（plan-generator.ts 现在算完就丢），且要加「调整原因」列
          ← 前置：cost_card_item_price 必须先版本化
```

**采购价版本化要排在订货链之前**,而且现在比之前更急 —— 迁移 080 刚把毛利率打通,
而 `cost_card_item_price` **每物料只有 1 行、无历史**,**明天改一次价,今天的毛利率就失真且无法复现**。
它同时也是「采购价根据市场波动」这一条的答案。

一个 Postgres 上跑着三条互不知情的迁移血统,共用一张 `schema_migrations`(76 行、max=101、25 条 filename 为 NULL)。财务站需要一个不同的键时,它没有**资格**改一张三仓库依赖的表,也没有**渠道**协调 —— 于是它加了一张表。这就是生产 `finance_revenue_daily` 的机制,**下次还会再生产一张**。

最直白的证据:`import-batch.js:169-179` 捕获 42P01 后抛 409「幂等账本不可用」—— **应用在运行时防御「我自己的迁移可能没跑」**。

> 真正的第一优先级不是删表,是给这个库定**一条唯一的迁移血统 + 一个强制的号段租约**。
> 号段现已补全(财务 001-099 / bakery-ops 100-199 / res_api 200-299 / hbti-web 300-399),
> 但仍无强制机制。这件事不做,删掉的表会以别的形状长回来。
