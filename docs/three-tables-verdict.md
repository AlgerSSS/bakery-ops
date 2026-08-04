# 三张表最终判决（app_user_role / finance_import_batch_history / finance_revenue_daily）

> 2026-08-03 · 8 个代理并行取证 + 3 视角对抗证伪。全部数字为生产库实测。
> 配套：[db-refactor-plan.md](db-refactor-plan.md) · [db-schema-map.html](db-schema-map.html)

# 三张表最终判决

## 0. 先纠正前提：「还没上线」不成立 —— 这条改变后面所有结论

财务站是**今天仍在被使用的生产系统**。探测时刻 2026-08-03 14:03Z：app_session 有 1 条未过期会话正开着（user_id=1，你本人）；app_audit_log 今天 05:01–05:02 有 3 条 `finance.ai_insight`（在跑 5 月经营总览）；累计 cost_card.publish 30 次、finance.ai_insight 117 次、289 张成本卡。HANDOFF.md:14 写着生产域名 `finance.hotcrush.net`，AGENTS.md:22「线上跑的就是它」。

更关键：**要动的大头不在财务站**。daily_revenue 的另外两个写者每天在给真人发消息 —— daily_push_log 实测 morning_brief 54 条发给 4 个 Lark 收件人（最后 2026-08-02 KL 23:30）、weekly_report 8 条发给两个手机号（最后一条 **今天 02:00Z**）；item_hourly_sales 的 max(date) = 今天。「财务站还没上线」授权不了 Contabo 上的 cron。

准确说法是：**雅楠还没拿到账号**（app_user 仅你 + 一个 2026-07-18 停用的 QA 号；app_user_store_scope 0 行）。这授权你自由改财务站的功能与 UI，**不授权改 schema、写入契约、跨仓库接口** —— 而这三张表要动的恰好全是后者。

还有一条必须先说：**backups/ 里两个 .sql.gz 用 `grep -c daily_revenue` 都是 0，根本不含这张表**。而 daily_revenue 有 22 天（2025-12-03~12-31）的数据在全库任何其他表都不存在，member_sales_ratio 那 106 行也无法从库内推导。动手前先 pg_dump，这不是流程洁癖。

---

## 一、app_user_role（2 行）—— 删除并替代｜**唯一可以现在就做的**

**删了会炸什么**：`api/_lib/auth.js:88-91` findSessionUser 无 try/catch，表一没整站 503。连带 permissions.js:35,45、users.js:39,51,67,116,230,232、create-admin.js:55、两个测试文件。

**第三条路（既不保留也不裸删）**：折成 `app_user.role_code`，外键指向 `app_role.code`。理由不是「暂时只有一个角色」，而是**多对多已被三层代码主动封死**：users.js:230 assignRole 先 `DELETE FROM app_user_role WHERE user_id=$1` 再插唯一一条，全站没有任何追加角色的接口；js/auth.js:51 只读 `roles[0]`；js/cost-card.js:1339 是三选一 `<select>`。app_audit_log 里 `user.assign_role` 累计 **1 次**。同一个库里 staff 表 25 行用「单列 role + permissions 数组」跑得好好的 —— 财务站为 1 个用户维护比 25 人系统更重的建模，方向错了。

顺带收益：每个已登录请求从 3 次库查询降到 1 次（permissions.js:32-49 的 loadPermissions/loadRoles 是同一个 JOIN 查两遍）。

**DDL 与步骤**（单文件单事务，失败即回滚）：
```sql
-- ① 先校验后动（本仓惯例见 057:30、072:139，上一版把校验放在 UPDATE 之后，错了）
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM app_user_role GROUP BY user_id HAVING count(*)>1)
    THEN RAISE EXCEPTION '存在多角色用户，本迁移不适用'; END IF; END $$;
ALTER TABLE app_user ADD COLUMN role_code text;
UPDATE app_user u SET role_code=r.code FROM app_user_role ur
  JOIN app_role r ON r.id=ur.role_id WHERE ur.user_id=u.id;
ALTER TABLE app_user ALTER COLUMN role_code SET NOT NULL, ALTER COLUMN role_code SET DEFAULT 'viewer',
  ADD CONSTRAINT app_user_role_code_fkey FOREIGN KEY (role_code)
    REFERENCES app_role(code) ON UPDATE CASCADE ON DELETE RESTRICT;  -- 原 CASCADE 会静默剥光权限
DROP TABLE app_user_role;
```
**一处不能错**：会话载荷必须继续返回 `roles: [role_code]` **数组**。loadUserStoreAccess 内部 `isAdminRole(roles).includes('admin')`、前端 auth.js:51 都吃数组，改成标量字符串会让管理员被静默判成"无门店权限"。

**迁移号不要拍 080**：实测 `schema_migrations` max(version)=**101**，77/78/101 已被 hbti-web 占用且 checksum 为 NULL，而 `scripts/apply-migrations.js:96-100` 遇到无 checksum 的已注册版本会直接 throw、中止整条链。写文件前先 `SELECT max(version)`。

**代价**：0.5 人天，风险低。将来真要多角色，反向迁移是一段确定性 SQL，前端零改动。

---

## 二、finance_import_batch_history（0 行）—— 删除并替代，**但先补一次真实上传**

**必须纠正一个事实**：它不是「运行数月仍 0 行」。schema_migrations 实测 version=40 的 applied_at 是 **2026-07-22 06:48**，今天 8-03，**表龄 12 天**。0 行的正确读法是「新功能还没走过第一次真实导入」，不是「假设被证伪」。这两种读法对应的处置完全不同。

（同理，"pg_stat 是全生命周期口径"这个取证前提也**不成立**：daily_revenue 真实 236 行，而 n_tup_ins=67、n_tup_del=0，算术上不可能同时为真；`pg_postmaster_start_time()` = 2026-07-02。所有「历史上从未发生过 X」的推断只覆盖 7-02 之后。）

**删了会炸什么**：三件事被塞在一张表上，一起塌。(a) **advisory lock 跟它长在同一个 try/catch 里**（import-batch.js:219-255），表没了 42P01 会把已经拿到的锁一起翻译成 409；而锁是唯一防止双写的东西 —— 实测 finance_expense/material/item_sales/stock/orders 的主键**全是 `PRIMARY KEY (id)` serial，槽位上没有任何 UNIQUE**（对照 finance_targets 是 PK(month,store,item)、finance_labor_detail 是 PK(month,store,category,item,org)，有自然键的反而被保护着）。(b) 导入历史页空掉 —— 实测 idx_scan=157，这页被打开过一百多次。(c) `:169-179` 的 409 `import_idempotency_unavailable` 会变成对全站财务导入的永久否决。

**第三条路**：三件事拆开归位，然后删表。
1. **锁提出来**：`lockImportSlots(tx, storeSlots)` 独立成函数，在 writeDataset 前无条件调用。锁键计算全程在内存（importSlotLockKeys 只吃 history.storeSlots），零表依赖。test/upload-api.test.js:568 断言"事务首条是 pg_advisory_xact_lock"，拆完照样过。**顺手给 load2.js 这类脚本也套上同一把锁 —— 现在 100% 的数据是从裸奔的那扇门进来的。**
2. **批次事件迁 app_audit_log**：import-batch.js:893-907 已经在同一事务里把 batchId/payloadSha256/results/sourceFiles/storeSlots 整包写进 `after_data`，13 列没有一列装不下（row_count 可从 storeSlots 求和）。import-history.js 改查 `action='finance.import'`。
3. **payload_sha256 整批跳过直接删掉**。它不是正确性护栏（写入本身是"槽位先删后插 + 单事务"，构造性幂等），而且它现在是**错的**：脚本把某月×店写坏后，你拿原始 Excel 重传想恢复，系统会因 hash 撞上回你一句"内容未变化"、拒绝写入。

**不采纳** 上一轮提的 `finance_import_slot` 替代表：**首次**导入某槽位时行还不存在，`SELECT ... FOR UPDATE` 锁不到任何东西，两个并发事务会同时通过 —— 它恰在最需要的时刻失效，而那个方案还要顺手把 advisory lock 省掉。

**步骤**：改代码 → **用浏览器真传一次 Excel 走通全链路** → 确认审计里有 finance.import → `DROP TABLE finance_import_batch_history;`

**代价**：0.5 人天，风险低。唯一真风险是拆锁时把锁一起删了。

---

## 三、finance_revenue_daily（0 行）—— 删除并替代，**但上一轮那套五阶段方案不要做**

**病根一句话**：039 的注释自己承认了 —— POS 写者还依赖 `uk_daily_revenue_date` 和 `ON CONFLICT (date)`，所以"保持旧契约不动、把模板行隔离到这里"。**这张表的全部存在理由，是没人愿意改另外两个仓库里的两条 ON CONFLICT 子句。**这不是架构决策，是跨仓库协调成本的化石。

**删了会炸什么**：财务模板日营收无处可写，只能退回写 daily_revenue，而它的唯一键只有 date（且 date 还是 varchar），第二家店开业即撞。同时写侧 `import-batch.js:704-722` 的跨表 FOR UPDATE + 读侧 `sales.js:96-113` mergeDailySources 那整套 409 冲突机制失去意义 —— 这其实是好事，那套机制不裁决、不记录、不对账，唯一功能是保护一个本该删掉的约束。

**第三条路 = 只改键，不改名、不改类型、不建 store 表**：
```sql
UPDATE daily_revenue SET store='吉隆坡Pavilion门店' WHERE store IS NULL;  -- 236/236 全 NULL
ALTER TABLE daily_revenue DROP CONSTRAINT uk_daily_revenue_date,
  ADD CONSTRAINT uk_daily_revenue_date_store UNIQUE (date, store);
-- res_api sync-to-db.js:156 与 bakery-ops daily-review.repository.ts:54 各改一条 ON CONFLICT，同窗口发布
DROP TABLE finance_revenue_daily;   -- 0 行
CREATE VIEW v_revenue_reconciliation AS ...  -- 重叠从"409 错误"变成"一行差异"
```
这个回填**只在单店期间无歧义**。第二家店开业后，store IS NULL 的历史行归属谁将永远说不清 —— 这扇窗会关，且不会再开。

**上一轮方案里三个被实测证伪的点，如实告诉你**：
1. **「挂个兼容视图零窗口过渡」是假的**。你自己的 AGENTS.md 改名流程写着：「PostgreSQL 的视图不支持 ON CONFLICT。如果这张表有 upsert 写入，兼容视图救不了它。」改名那一刻 res_api 每晚同步硬失败，而唯一会喊的告警 `freshness-check.ts:19-26` 是 `catch { logger.warn; return; }`，42P01 被原地吞成 no-op。抓取窗口只有 today−29（scrape-daily.js:25），超窗要手工重建 —— 052 迁移就是这么补 2026-04-13 那一天的。
2. **`ALTER COLUMN date TYPE date` 会打断 bakery-ops**。实测 `current_date >= to_char(...)` → **ERROR 42883**，命中 forecast-calc.repository.ts:217；且驱动返回值从字符串变 Date，而 daily-review.repository.ts:61 显式声明返回 `string`，这个值直接进 Lark 周报文案。bakery-ops 实测有 **14 处**读 daily_revenue，方案只列了 4 个文件。
3. **新建 store 表会被两个实体顶死**。finance_* 的 store 取值实测只有两个：`吉隆坡Pavilion门店` 1831 行、**`全部` 69 行**，而 finance_targets 是 `PRIMARY KEY (month, store, item)` —— "全部"是主键的一部分，不是可空标注，加 FK 会直接失败或让这 69 行人工目标值被清掉。ops_store 的 `海外项目组`(active=false) 在新表里没有目标行，而 ops_store.store_code 被 **8 个**招聘/WhatsApp 表外键引用。这步做不动，也不需要做。

另外两条纠正：**2026-04-12 不是"人工污染指纹"** —— transaction_count 和 avg_transaction_value 直接取 CSV 的 `Bill Count` / `Avg Order Net Sales` 两列（daily-revenue-resolver.js:19-21），日表与小时表口径本来就不同（sync-to-db.js:141-150 注释写明"不含无小时归属订单与迟到退款"）。别为它建 `v_pos_revenue_integrity` 告警，那会是一条永久假阳。

**但 bakery-ops 的 `upsertDailyRevenue` 确实该停写**：repository:55 `revenue = EXCLUDED.revenue` 无条件覆盖 POS 实测值，当晚 res_api 又反向抹掉店长的修正，双向静默互相消灭。而它**上周还在用**（daily_review 最新一条 created_at 2026-08-01 08:40Z）—— 改成存进 daily_review 新列、不进 POS 表。**这条要你单独点头，「财务站没上线」覆盖不到它。**

**代价**：1.5 人天。风险中等，最大风险是切换当晚 res_api 同步失败 → 次日早简报不发（morning-brief.service.ts:232 当天无行即 throw）。前置硬要求：pg_dump 快照 + 三仓库同一维护窗口发布（视图救不了，只能同窗口）。

---

## 这三张表暴露的是不是同一个问题？

是。一句话：**这个库没有主人，只有租客。**

一个 Postgres 上跑着三条互不知情的迁移血统，共用一张 `schema_migrations`（实测 76 行、max=101、25 条 filename 为 NULL，8-02 hbti-web 刚越界占了财务站的 77/78 号）。财务站需要一个不同的键时，它没有**资格**改一张三个仓库依赖的表，也没有**渠道**协调这次改动 —— 于是它加了一张表。这就是生产 finance_revenue_daily 的机制，而这个机制下次还会再生产一张。finance_import_batch_history 是同一机制的另一形态：与其让脚本通道和网页通道就"一条导入路径"达成一致，网页通道自己造了整套幂等机器，而搬进 100% 数据的脚本通道什么都没有。

最直白的证据在代码里：`import-batch.js:169-179` 捕获 42P01/42703 后抛 409「幂等账本不可用」—— **应用在运行时防御"我自己的迁移可能没跑"**。这不是防御性编程，这是没有 schema 权威的直接后果。

所以真正的第一优先级不是删表，是给这个库定一条**唯一的迁移血统 + 一个强制的号段租约**（HANDOFF.md 已定 财务 001-099 / bakery-ops 100-199 / res_api 200-299，但没有任何强制机制，8-02 刚被违约一次）。这件事不做，删掉的表会以别的形状长回来。

---

## 建议执行顺序（合计约 3 人天）

| # | 动作 | 人天 | 需要你点头 |
|---|---|---|---|
| 0 | `pg_dump` daily_revenue + 全部 finance_* | 0.2 | 否，今天就做 |
| 1 | app_user_role 折成 role_code | 0.5 | 否，只动财务站 |
| 2 | 用浏览器真传一次 Excel 走通导入链路 | 0.2 | 否 —— 这步决定第 3 步 |
| 3 | 拆锁 + 事件迁 app_audit_log + 删账本表 | 0.5 | 否 |
| 4 | daily_revenue 改键 + 三仓库同窗口发布 + 删 finance_revenue_daily + 上对账视图 | 1.5 | **是**：接受切换当晚可能少一天 POS 数据？ |
| 5 | bakery-ops 停写 daily_revenue，改存 daily_review | 0.3 | **是**：店长录入的实际营收不再覆盖 POS 值 |

上一轮那套「阶段 0 建 store 表 → 改类型 → 改名 → 五阶段」的方案是 8–10 人天，且含 3 个致命点（兼容视图无效、42883、'全部' 顶死 FK）。**不要做。**