# HOT CRUSH 数据建模方案:星型适配判断与全链路落地计划(v2)

> 2026-08-03 · v2。在 v1(判断 + 分阶段框架)基础上,把**连接这个库的全部四个项目、
> 每个功能的读写点**梳到了文件行级,并据此重写了落地步骤。
> 本版修正了 v1 里三处照原样执行会出事故的地方(见 §四 0.6、§三 C1、§四 0.4)。
> 所有 file:line 均来自 2026-08-03 对四个仓库的实际代码梳理与生产库实测。

**（Codex 的总评：四个直接连接方的范围基本正确，现状依赖梳理也很有价值；但本文更适合作为“止血修复与迁移风险附录”，不适合作为允许大改后的全业务目标模型。作为 POS/运营分析层方案约 7/10，作为多门店、全业务目标数据模型约 3–4/10。以下批注均以 2026-08-03 的现行代码和生产库只读核对为依据。）**

---

## 一、判断:适合星型建模,不适合独立数仓

「星型模型」常被混为一谈的是两件事:

1. **星型建模思想** —— 事实(发生了什么)与维度(从哪些角度看)分开,用一致性维度键串起来。这是组织数据的纪律。
2. **独立数据仓库** —— 单独一套库、ETL 管道、dbt/Airflow。这是基础设施投入。

**（Codex 的建议：这两个概念区分正确，但还应增加第三层“规范化业务核心模型”。星型模型适合分析层，不适合替代订单、会员卡、活动发奖、预测运行、财务期间、消息队列等交易/流程模型。）**

**结论:你的业务是第 1 件事的教科书案例,但完全够不上第 2 件事的规模。**

**（Codex 的建议：改为“当前业务适合在规范化核心层之上建设星型分析层，当前规模不需要独立数仓”。不能据此推出整个运营库只需加几张维度和视图。）**

| 维度 | 现状(实测) | 星型适配 |
|---|---|---|
| 查询形态 | 排产、断货检测、AI 复盘、会员分析 —— 全是「按维度切事实再聚合」 | ✅ |
| 数据规模 | 全库 ~60 MB,最大表 8.1 万行,Postgres 全表扫毫秒级 | ⛔ 差独立数仓三个数量级 |
| 写入形态 | 每晚 KL 23:00 批量整日重写 + 14:20 盘中覆盖 | ✅ |
| 多源一致化 | POS 英文名 + item_key / 排产中文名 / Excel 别名三套并存 | ✅ 正是一致性维度要解决的 |
| 消费方 | 排产算法、AI prompt、财务站、老板看数,口径打过架(有事故记录) | ✅ |
| 演进 | 计划开第二家店,而门店标识现在有两套写法 | ✅ |

**（Codex 对上表逐项的建议：查询形态确实适合 mart；数据规模结论同意；“整日重写”不是适合星型的证据，反而说明必须补采集批次、完整性和修订历史；多源一致化应由企业主键与来源映射表解决，不只是做一个维度视图；消费口径必须纳入财务和成本；多门店不是普通适配项，而是当前方案必须先解决的基础主键问题。）**

**方案:同库分层(Kimball-lite)。**`public` 运营层保持原样(四个活写者),
新建分析层放 4 张一致性维度 + 8 张事实视图,视图优先、不物化
(物化触发条件:某视图查询 P95 > 1 秒)。

**（Codex 的建议：保留“一个 PostgreSQL、视图优先”的判断；删除“public 运营层保持原样”和固定的“4 维度 + 8 事实”。建议逻辑上分为来源落地层、规范化业务核心层、只读分析层；当前可继续用 `stg_`/业务域前缀/`mart_` 前缀实现。物化与否应按查询成本、刷新时效和并发实测决定，不能只写死 P95 1 秒。）**

---

## 二、连接方全景:四个项目,谁在读写什么

### 2.1 项目与运行位置

| 项目 | 位置 | 部署 | 数据库客户端 |
|---|---|---|---|
| **res_api**(POS 抓取同步) | `~/hot/res_api` | Contabo `/opt/hotcrush/res_api`,root crontab | postgres.js,无自定义 types |
| **bakery-ops**(排产/复盘/招聘/机器人) | `~/hot/bakery-ops` | Contabo,`INSTANCE_ROLE=all`(Mac 端已停用) | postgres.js v3.4.9,单一 `getSQL()` 工厂(`src/modules/shared/db/postgres.ts:15`) |
| **hbti-web**(HBTI 活动 H5) | `~/hot/hbti-web` | Vercel `hotcrush-hbti` | postgres.js,`max:1, prepare:false` |
| **财务站**(月结/成本卡) | `~/…/雅楠需求/门店财务AI分析系统` | Vercel `hotcrush-finance`(本地 `vercel --prod`,不接 GitHub) | postgres.js v3.4.9 |

**（Codex 对四个项目逐项的建议：四个直接数据库消费者已核实；当前仓库里的根目录 Python 招聘脚本直接连接 Lark，不是第五个数据库消费者。若继续声称还有 Contabo Python 直接连接者，应补出实际代码路径。四个项目目前都使用可绕过 RLS 的高权限数据库角色，目标治理还需为每个应用拆独立角色。）**

- **res_api：** **（Codex 的建议：明确为 POS 来源数据唯一写者，使用独立 `pos_writer` 角色；手工目录同步也必须记录批次、完整性和新鲜度。）**
- **bakery-ops：** **（Codex 的建议：它不是单一分析应用，还覆盖运营、HR、消息和审计；目标需按业务域明确写入所有权及权限，不能由单一连接工厂掩盖多域边界。）**
- **hbti-web：** **（Codex 的建议：部署信息可保留；业务上应把活动和奖励历史迁出会员当前投影，并使用只允许 HBTI 所需表/列的独立角色。）**
- **财务站：** **（Codex 的建议：补充财务日报、期间数据、成本卡和导入批次的真实边界；“本地发布、不接 GitHub”属于运维风险，应放到部署附录。）**

### 2.2 每日时间线(KL = 服务器本地时间)

```
03:00/09:00/15:00/21:00  hbti-token 刷新(只碰 RES,不碰本库)
07:00   production_plan_push(默认关,PRODUCTION_PLAN_PUSH_ENABLED 未开)
09:00   data_freshness_check(只读 daily_revenue)
14:20   res_api 盘中刷新 → 覆写当天 item_hourly_sales
14:30   restock_advice(读 14:20 刚写的当天行 —— 两者是上下游)
23:00   res_api 全量刷新(~20 分钟预算,失败 +60s 重试一次)
        → daily_revenue / hourly_sales_summary / item_hourly_sales /
          daily_breakdown / item_waste / item_last_sale / pos_member*
23:30   stockout_detect + morning_brief(同一分钟;读昨日,写 out_of_stock_record)
周一 10:00  weekly_report
──────────────────────────────────────────────
DDL 安全窗口:KL 01:00–07:00 或 10:00–13:00(AGENTS.md:47 建议 01:00–13:00,
再避开 07:00 与 09:00 两个 cron 更稳)
```

**（Codex 的建议：时间线适合作为迁移附录并应保留，但它只描述调度依赖，不构成数据模型依据。任何跨写者的表切换还需单独维护窗口、冻结相关 cron，并在切换前后按门店、日期、金额、数量和批次完整性对账。）**

### 2.3 功能 → 表 读写矩阵(按项目)

**res_api**(只有 4 个文件在生产链路写库):

| 入口 | 写 | 写法 |
|---|---|---|
| `sync-to-db.js`(23:00,7 步) | daily_revenue(upsert `ON CONFLICT ON CONSTRAINT uk_daily_revenue_date`)/ hourly_sales_summary / **item_hourly_sales(DELETE+INSERT,带塌陷护栏)** / daily_breakdown ×2 / item_waste(DELETE+INSERT)/ item_last_sale | 列清单齐全,含 item_key |
| `scrape-intraday.mjs`(14:20) | **item_hourly_sales(DELETE+INSERT 当天)** | **INSERT 缺 item_key;按显示名去重(`:103`)** |
| `sync-member.mjs`(23:00 末步) | pos_member / pos_member_card_txn / pos_member_daily | 纯 upsert,永不删行 |
| `sync-catalog.mjs`(手工) | pos_product | upsert on item_key |

**（Codex 对 res_api 四项的建议：`sync-to-db.js` 还必须解决 dining 的 30 天窗口冒充日事实、零报损残留及部分结果覆盖；盘中链补 `item_key` 应立即做，同时增加分页/缩水/完整性护栏；会员同步必须校验源文件的业务日与 complete 状态，并把会员、卡、每日快照分开；商品目录应进入受控刷新链，记录 `last_seen`、来源批次和失效状态。所有新事实都必须带 `store_id`。）**

**bakery-ops**(核心读者;写点只有 4 个):

**（Codex 的建议：这句事实错误，应改为“核心读写者”。生产代码还写招聘、员工、会话、预约、试工、Offer、WhatsApp 队列/日志、staff、审计、AI 调用和业务配置；生产库已有 employees 129、applications 125、candidate_conversations 42、ops_audit_log 1,808 等数据，不能按四个写点或近空域处理。）**

| 功能(cron) | 读 | 写 |
|---|---|---|
| production_plan_push(07:00,默认关)| business_rule / product / timeslot_sales_record(视图)/ ai_daily_correction / hourly_sales_summary / item_hourly_sales / daily_revenue / item_waste | **forecast_snapshot**(upsert)+ daily_push_log |
| stockout_detect(23:30)| item_last_sale / item_hourly_sales / hourly_sales_summary / item_waste(`='scheduling'`)/ business_rule / product / product_alias / pos_product | **out_of_stock_record(逐行裸 INSERT,幂等靠 JS)** |
| daily_review_chat(消息触发;morning_brief 复用)| **12 条 SQL**:daily_revenue / hourly_sales_summary / item_hourly_sales×product / item_waste×product / daily_breakdown / out_of_stock_record / forecast_snapshot×product / product_material_cost(视图)/ pos_product / business_rule | **daily_review**(upsert) |
| morning_brief(23:30)| daily_revenue / item_hourly_sales / item_waste / out_of_stock_record(+复用上行全链)| daily_push_log |
| restock_advice(14:30)| 排产全链 + item_hourly_sales 当天行(`hour <= 14:20`)| daily_push_log |
| data_freshness_check(09:00)| daily_revenue(`MAX(date)`)| — |
| weekly_report(周一 10:00)| daily_revenue / item_waste(全量)/ daily_review / sell-through(item_hourly_sales+item_waste 按名合并)| — |
| forecast_review / forecast_order(消息触发)| forecast_snapshot / item_hourly_sales×product / item_waste / product_alias / out_of_stock_record | — |
| 设置页/日历 UI | holiday / context_event / business_rule | holiday / context_event / business_rule(唯一写者)|
| 复盘 UI(use-review)| daily_revenue | **daily_revenue(upsert,bakery-ops 侧唯一写点** `daily-review.repository.ts:51`)|

**（Codex 对 bakery-ops 表逐项的建议：）**

- **production_plan_push：** **（Codex 的建议：当前覆盖 `forecast_snapshot`，且生成的生产计划未持久化；改为 forecast run/line 和 production plan/version/line，并记录审批、发布与实际执行。）**
- **stockout_detect：** **（Codex 的建议：当前是算法估算而非已确认事件；保存 detection run、门店、SKU、算法版本、置信度及结果，不要先强制日×品唯一。）**
- **daily_review_chat：** **（Codex 的建议：各来源先聚合到共同粒度再连接，避免扇出；`daily_review` 拆成 AI 生成版本、经理评论、决策和行动项。）**
- **morning_brief：** **（Codex 的建议：不能与 stockout_detect 同一分钟却假定本次检测已完成；应引用一个已完成的 detection_run，并最终读取统一语义层。）**
- **restock_advice：** **（Codex 的建议：不要仅凭 14:30 推断 14:20 数据已就绪；必须读取门店、业务日匹配且标记 complete 的盘中批次。）**
- **data_freshness_check：** **（Codex 的建议：`MAX(date)` 不足以证明新鲜和完整；按门店、来源批次、窗口、complete 和期望/实际行数检查。）**
- **weekly_report：** **（Codex 的建议：按门店和稳定 SKU 汇总，替换按名合并；指标公式与规则版本也需纳入语义层。）**
- **forecast_review / forecast_order：** **（Codex 的建议：两条消息触发链都应迁到版本化 forecast run、规范商品映射和 detection run；`product_alias` 只留在导入治理层。）**
- **设置页/日历 UI：** **（Codex 的建议：这些属于运营配置而非星型事实；holiday/context_event/business_rule 应有适用门店、有效期和规则版本。）**
- **复盘 UI：** **（Codex 的建议：停止 Bakery Ops 直接 upsert POS 主事实 `daily_revenue`；人工更正进入独立 adjustment/import 表，保留来源、审批与审计。）**

**hbti-web**(自成一域,零波及):
读写 hbti_auth_token / hbti_rate_limit / hbti_gift_stock / pos_member 的 `hbti_*` 列。
本方案对它**零代码改动**;mart 的 `fct_hbti_completion` 只是对 pos_member 的只读投影。

**（Codex 的建议：前两句可作为当前依赖说明，“零波及”和 `fct_hbti_completion` 结论必须删除。`pos_member.hbti_*` 只能表达最新画像，新活动会覆盖旧活动，无法形成“会员×活动”历史；目标应新增 campaign、campaign_response、reward_issuance 和追加式 reward_stock_ledger，认证 token/rate-limit 继续留在临时平台状态域。）**

**财务站(⚠ v1 的假设错了,它不只写 finance_*)**:

| 端点 | 读 | 写 |
|---|---|---|
| `api/sales.js` | **daily_revenue / item_hourly_sales / pos_product**(按月×单品聚合,LEFT JOIN 取中文名)| — |
| `api/finance.js` | **item_waste / daily_revenue** + 16 张 finance_* | — |
| `api/upload.js` → `_lib/import-batch.js` | daily_revenue(`SELECT … FOR UPDATE`)| **daily_revenue(`ON CONFLICT ON CONSTRAINT uk_daily_revenue_date`)** + 5 张 finance_* |
| cost-cards / cost-items / cost-dashboard | cost_card_* + v_cost_card_* | cost_card_* + app_audit_log |
| auth / users / audit | app_* | app_* |

**（Codex 对财务表逐项的建议：矩阵需要更新。`api/sales.js` 还读取并合并 `finance_revenue_daily`；`api/finance.js` 实际读取 15 张月度财务表并联 POS/门店数据；当前普通日报上传主要写 `finance_revenue_daily`，`daily_revenue` 是旧兼容路径；上传支持约 10 类数据集且每次写 batch history/audit。成本卡的版本化配方和有效期价格值得保留，但必须补 POS SKU 映射、供应商/门店价格和历史成本。auth/audit 是运营技术表，不属于星型事实。）**

---

## 三、跨仓库硬契约(改造前必须知道的七条)

**（Codex 的建议：本节应改名为“当前迁移期兼容契约”。这些约束需要保留解除条件、负责项目和退出阶段，不能反向决定最终业务模型。）**

**C1 · `uk_daily_revenue_date` 这个约束名是硬编码契约。**
三个仓库四处 `ON CONFLICT ON CONSTRAINT uk_daily_revenue_date`
(财务站 `import-batch.js:637,666`、`finance-import-load.js:121`;res_api `sync-to-db.js` 第 1 步)。
date 列转型必须用 `ALTER COLUMN … TYPE date USING date::date`(保留约束名),
**绝不 drop/recreate 表或改约束名** —— 否则财务导入和每晚同步当场 42704。
财务站 `sql/037:2`、`sql/039:1-2` 都明文声明了这个依赖。

**（Codex 的建议：同意这是当前硬编码契约，但“绝不修改”只能用于过渡期。仅按 date 唯一与第二家店冲突；应先建设包含 `store_id` 的 v2 日事实，迁移四处 upsert 并双轨对账，最后在同一维护窗口替换旧约束。PostgreSQL 视图不能兼容 `ON CONFLICT` 写入。）**

**C2 · `daily_sales_record` / `timeslot_sales_record` 两个视图的定义权在财务站仓库**
(`sql/068_derived_tables_to_views.sql`,且 `sql/074` 设了 `security_invoker=true`)。
本方案不改 item_hourly_sales 的列类型,所以**不需要动这两个视图**;
但将来任何 `ALTER COLUMN` 都会被它们阻塞,重建时必须补 security_invoker,
否则财务站 `test/db-integration.js` 的门禁会红。

**（Codex 的建议：当前依赖判断正确。长期应把公共派生视图及迁移定义收归共享数据库的唯一迁移所有者，而不是继续由某个消费应用单独拥有；重建时保留 `security_invoker` 和依赖检测。）**

**C3 · `pos_member` 是全库唯一列级双写表**(res_api 写 26 列,hbti-web 写 8 个 hbti_ 列,
靠列集不相交共存)。任何人把它的同步改成 DELETE-then-INSERT 会每晚清掉 HBTI 画像。本方案不碰它。

**（Codex 的建议：同意这是当前不得破坏的兼容边界，但不同意作为长期模型。“本方案不碰它”应改为：短期禁止整表替换，长期把活动响应、发奖和库存流水迁出 `pos_member`，该表只保留会员当前状态与最新画像投影。）**

**C4 · `waste_reason` 的取值域由 res_api 的 REASON_MAP 决定**(`sync-to-db.js:387-391`):
`abnormal loss→production`、`taste testing…→tasting`、`production scheduling…→scheduling`。
**v1 计划把中文旧值「异常报损」映射到 other 是错的 —— 必须映射到 production**;
CHECK 取值域必须是 `{scheduling, tasting, production, gift, other}`,
否则今晚 23:00 第 6 步(res_api 写 production)当场撞约束。

**（Codex 的建议：`异常报损→production` 的修正正确；但必须同时保留 RES 原始原因、标准原因和映射版本。未知原因可以标准化为 `other`，不能只留下 `other` 而丢失原值；长期采用受控原因映射，避免新来源值令整批失败。）**

**C5 · 迁移编号是四仓共用的一张 `schema_migrations`,且已有冲突史**
(27 号双占;77/78 已被 hbti 迁移占用,而财务站清单里这两个号还空着;80–100 段的 DDL 文件已散佚)。
**本方案新迁移一律从 102 起编号**,放 `bakery-ops/src/modules/data/migrations/`,
应用后登记 version+name。财务站侧不得再新建 077/078 号文件。

**（Codex 的建议：不同意“从 102 起”即可解决治理问题。当前迁移台账存在未登记文件、027 冲突及登记缺少 filename/checksum 等问题；执行任何 102 以后迁移前，先指定一个共享库迁移所有者和目录，使用全局唯一 ID、checksum、advisory lock、事务及执行审计，并人工核对已存在但未登记的迁移，不能重放。）**

**C6 · `deploy.sh` 从本地工作树 rsync,不经过 git,且排除 `_*` 文件。**
两个推论:工作区不干净就 deploy = 半成品上生产;
`_backfill-item-key.mjs` 永远不会被同步到 Contabo,**回填必须在 Mac 本地对生产库执行**。

**（Codex 的建议：关于当前 deploy 行为的事实正确，应保留在运维附录。回填不应被永久设计成“Mac 直连生产运行临时脚本”，而应成为可 dry-run、有输入快照、影响行数、歧义清单、审批和可复核结果的版本化迁移任务。）**

**C7 · 迁移当晚失败不会有人被通知。**`res_api/.env` 没配 `ALERT_WEBHOOK`,
`daily-refresh.sh` 只在有 webhook 时告警。所以每一批改动的次晨都要**主动**跑验收清单(§四 0.8)。

**（Codex 的建议：风险判断正确，但人工次晨验收不能替代告警。应先配置可送达的告警，并验证一次真实失败能够触达负责人；迁移后立即跑结构、数据和四消费者冒烟测试，次晨只负责验证真实夜间批次。）**

**（Codex 的建议：原文引用的“§四 0.8”并不存在，应改为“§四 批 D · 次晨验收”。）**

---

## 四、Phase 0 · 修运营层地基(重写为四批,含全部落地点)

> v1 的七件事不变,但按「代码先行 → 回填 → DDL → 验收」重排,
> 并列出每一处必改的 file:line。**顺序不可调换。**

**（Codex 的建议：本节应改名为“现有单店链路的临时止血”。代码先行、回填、DDL、验收的局部顺序合理，但 102/105 是否执行必须等门店主键、事实粒度和迁移治理先确定，不能把整批写成不可调整的目标路线。）**

### 批 A · 代码先行(D1 白天改,D1 晚部署,不动数据库)

**0.1 盘中刷新补 item_key —— 三处改动,不是一处**(`res_api/scrape-intraday.mjs`):
- `:103` 去重键从显示名换成稳定键:`` uid = `${date}|${hour}|${name}` `` → 用 `:99` 已拿到的 `id = r.D_itemName`。
  只加列不改这行,三组同名商品的第二个仍会被静默丢掉(全量链 `sync-to-db.js:219` 早已按键去重,盘中链漏了)。
  **（Codex 的建议：保留这项紧急修复，但先确认 `id` 确实是完整 RES 来源商品键而非显示值；目标去重粒度还必须加入 `store_id`、业务日期和小时。）**
- `:106` batch 对象补 `item_key: id`
  **（Codex 的建议：保留；同时应增加 `source_batch_id`、来源窗口、抓取完成状态和门店键，避免部分结果被当成完整结果。）**
- `:114` INSERT 列清单补 `'item_key'`(对齐 `sync-to-db.js:259`)
  **（Codex 的建议：保留并作为盘中/夜间两条写入链的共同契约；未来写 v2 事实时还需同步加入 `store_id` 与批次外键。）**
- 照 `test/sync-to-db.test.js` 的模式补一条列清单断言(目前盘中链零测试)。
  **（Codex 的建议：保留；测试还应覆盖同名不同商品、分页达到安全上限、来源缩水时拒绝覆盖、批次不完整和门店隔离。）**

**0.2 钉住日期解析,让 varchar→date 对 JS 侧透明**(bakery-ops 一处):
`src/modules/shared/db/postgres.ts:15` 的 `postgres(url, {…})` 加:
```ts
types: { date: { to: 1082, from: [1082], serialize: (v: string) => v,
                 parse: (v: string) => v } },   // date 列一律返回 'YYYY-MM-DD' 字符串
```
为什么这是对的:梳理发现 bakery-ops 把日期当字符串用的位置有 **12 处**
(Map 键、`===` 比较、模板拼接、`String()`),而依赖 Date 对象的位置为**零**
(全部经 dayjs,dayjs 两者都吃)。钉住后:
- 转型对全部 JS 代码透明,12 处一个都不用改;
- 顺带修好两个**现存**的暗 bug:`ops-data-query.ts` 的 item_by_hour 把 Date `String()` 成
  `"Mon Jul 21 …"`、`weekly-report.service.ts:182-183` 周报最好/最差日同病 —— 它们今天就在坏。
- 类型注解从此与运行时一致(`forecast-calc.repository.ts:75`、`forecast.service.ts:128`
  两处 `date: string` 现在是谎报)。
res_api 不需要钉(读路径已全部 `::text`);财务站不需要钉(有 `dateText`/`businessDate`
归一层,且 `api/finance.js:102,110,120` 已在用 `::date` 正常运转)。

**（Codex 的建议：保留真 `date` 类型和统一字符串边界的做法，并补驱动解析、API 契约与 Kuala Lumpur 业务日测试。这个配置只解决 JS 表示形式，不代替业务日期、时区和门店营业日模型。）**

**0.3 修掉转型后会硬报错的 8 处 SQL**(bakery-ops;date 类型上没有 `LIKE`,
`date >= text` 也没有 operator):

| 文件:行 | 现状 | 改成 |
|---|---|---|
| `holiday.repository.ts:47` | `WHERE date LIKE '2026-08%'` | `WHERE date >= $1 AND date < $2`(月首/次月首) |
| `holiday.repository.ts:51` | `WHERE date LIKE '2026%'` | `WHERE EXTRACT(YEAR FROM date) = $1` |
| `ai-correction.repository.ts:27` | `WHERE date LIKE ?` | 区间谓词 |
| `app/api/ai-correction/route.ts:25,26,27,28` | 四条 `LIKE`(holiday ×3 + context_event) | 区间谓词 |
| `forecast-calc.repository.ts:217` | `WHERE date >= to_char(CURRENT_DATE-30,'YYYY-MM-DD')` | `WHERE date >= CURRENT_DATE - 30` |

**（Codex 对上述日期 SQL 的建议：修复方向正确；所有月、年筛选统一使用“起始日包含、下一周期首日不包含”的半开区间。年度查询也优先用日期区间而不是 `EXTRACT(YEAR...)`，以便普通日期索引生效。）**

**0.4 res_api 收尾两件**:
- `sync-to-db.js:399` 兜底从 `REASON_MAP[r.reason] || r.reason` 改成 `|| 'other'` + warn 日志
  —— 否则 RES 将来新增报废原因,0.6 的 CHECK 会让整个第 6 步硬失败。
  **（Codex 的建议：修改后保留。未知值可映射为 canonical `other`，但必须把原始值写入 `waste_reason_raw` 并记录映射版本；warn 日志不足以支持以后追溯和重分类。）**
- 两个一次性脚本 `fix-revenue-net.mjs` / `backfill-gross-sales.mjs` 文件头加「已因 date 转型失效,
  勿再运行」注释(前者转型后必炸:`:97` Map 键 miss、`:111` `.slice` TypeError、`:118` `substring(date,…)` SQL 错)。
  **（Codex 的建议：不要只加注释，脚本应默认拒绝执行并指向替代流程，或移入明确的归档目录；保留仅用于审计，不能继续像有效维护工具一样存在。）**

**0.5(可选加固)财务站 `api/sales.js:133,141` 补 `date::text AS date`** ——
现在靠下游归一层兜着,加上这条保险后,将来绕过 `mergeDailySources` 的新读点也不会拿到 Date。

**（Codex 的建议：若该接口契约明确要求日期字符串，可以保留并补契约测试；不要用零散 `::text` 代替统一日期适配层，其他读点仍应通过同一边界规范。）**

**部署**:`deploy.sh core` 上 Contabo(先 `git status` 确认工作区干净,C6);
bakery-ops 侧跑 `vitest run` 全绿(受影响用例:stockout-detector / sell-through /
f9-review-ops-query / ai-correction-apply / review-date-normalize / restock-advice)。

**（Codex 的建议：部署与数据库迁移应分开。除干净工作区和测试外，还要记录准确提交、部署文件边界和回滚版本；部署后验证服务与实际 cron 结果再进入回填/DDL。当前工作区有其他未提交 HBTI 改动，本计划在未隔离前不得执行 `deploy.sh`。）**

**批 A 验收(D2 早)**:`item_hourly_sales` 当天(D1 14:20 盘中批之后的首个当天)
`COUNT(*) FILTER (WHERE item_key IS NULL) = 0`。

**（Codex 的建议：补充按门店、KL 业务日和来源批次核对来源商品键数、写入键数、小时行数、同名不同品及批次 complete 状态；空值为零只能证明列被写入，不能证明没有塌陷或只写了部分结果。）**

### 批 B · 回填(D2 上午,Mac 本地执行,C6)

**0.6 历史空键回填**:`res_api/_backfill-item-key.mjs --apply`。
- **先删掉脚本表映射里的 `daily_sales_record` 条目**(`:28-33`)—— 它已是视图,UPDATE 会报错;
- 脚本已正确处理歧义:3 组同名不同品(French Cocoa Crispy Pretzel / Golden Tropic Cold Brew /
  Iced Red Bean Butter Bagel)留空不猜 —— **猜错比缺失更糟,保持这个行为**;
- 跑完记录残留空键行数(预期 ≈ 那 3 组歧义名的历史行),它们等 0.7 的约束用 `NULLS DISTINCT` 包容。

**（Codex 的建议：保留“不猜填”原则，但改成 dry-run 先生成证据、映射规则、影响行数和未解决项报告，再由迁移执行。歧义记录可暂留旧表，目标 v2 事实应进入未映射/隔离队列，等待重抓或人工审核，而不是长期依赖 NULL。）**

### 批 C · DDL(D2 13:00 前完成;每个迁移独立文件,附回滚)

**（Codex 的建议：整批先暂停。当前共享迁移账本已有漏登记、编号冲突和 checksum 缺口；必须先完成唯一迁移所有者、全局 ID、执行锁和台账核对，之后再决定哪些止血 DDL 可以执行。）**

**迁移 102 · item_hourly_sales 唯一约束迁到 item_key**
```sql
ALTER TABLE item_hourly_sales DROP CONSTRAINT item_hourly_sales_date_hour_item_name_key;
ALTER TABLE item_hourly_sales ADD CONSTRAINT uk_item_hourly_sales_date_hour_key
  UNIQUE (date, hour, item_key);   -- 默认 NULLS DISTINCT,包容历史歧义空键行
```
依据:回填脚本实证 3 组不同商品共用同一显示名 —— 旧约束建在显示名上,
同名商品同小时出现时整晚第 3 步事务会回滚,是颗随时会踩的雷。
写者不用改(res_api 两条链都是 DELETE+INSERT,无 ON CONFLICT 依赖);
塌陷护栏(`sync-to-db.js:235-253`)按天数行数比较,与约束无关,照常工作。
视图不阻塞(本迁移不改列类型,C2)。

**（Codex 的建议：暂停按当前形式执行。`UNIQUE(date, hour, item_key)` 仍是单店约束，第二家店会冲突；目标粒度至少是 `store_id + business_date + hour + source_product_id`。`NULLS DISTINCT` 只会放过未知记录，不能保证其不重复。若为现网临时止血，也必须标注退出条件并在引入 `store_id` 后替换。）**

**迁移 103 · varchar 日期列转 date**(六张:daily_revenue / forecast_snapshot /
out_of_stock_record / holiday / context_event / ai_daily_correction)
```sql
ALTER TABLE daily_revenue ALTER COLUMN date TYPE date USING date::date;  -- 保留 uk_daily_revenue_date(C1)
-- 其余五张同式
COMMENT ON TABLE daily_revenue IS '…(更新掉「date 为 text 类型」的旧注释,财务站 sql/046 里那份也已过时)';
```
前提:批 A 的 0.2(解析钉住)与 0.3(8 处 SQL)已上线。此后
`WHERE date = $1` 参数化比较全部安全(Postgres 从列推断参数类型),
财务站运行时已实证能吃 date 类型。

**（Codex 的建议：修改后保留。迁移前验证所有非空字符串可解析，并检查默认值、索引、视图和写者依赖；在事务内执行。`uk_daily_revenue_date` 只作当前兼容约束，目标多门店表最终必须使用含 `store_id` 的唯一键。）**

**迁移 104 · waste_reason 归一 + CHECK(按 C4 修正后的映射)**
```sql
UPDATE item_waste SET waste_reason = 'scheduling' WHERE waste_reason = '排产报损';  -- 67 行
UPDATE item_waste SET waste_reason = 'tasting'    WHERE waste_reason = '试吃报损';  -- 17 行
UPDATE item_waste SET waste_reason = 'production' WHERE waste_reason = '异常报损';  --  5 行,对齐 REASON_MAP
ALTER TABLE item_waste ADD CONSTRAINT ck_item_waste_reason
  CHECK (waste_reason IN ('scheduling','tasting','production','gift','other'));
```
bakery-ops 的 7 处过滤全部只认英文,零处认中文 —— 归一后 2026-01~03 那 89 行历史
开始被正确统计(注意:那三个月的断货判定与报废口径会**变化**,这是修正不是回归;
`docs/data-caliber.md:31` 的口径说明同步更新)。
财务站 `js/engine.js:1410-1412` 新旧值都认,安全。

**（Codex 的建议：标准化方向正确，但不要覆盖唯一的原始原因。建议保留 `waste_reason_raw`，另设受 CHECK 约束的 canonical reason 与 mapping version；历史指标变化还应记录重新计算批次和口径版本。）**

**迁移 105 · out_of_stock_record 去重 + 唯一约束**
```sql
DELETE FROM out_of_stock_record a USING out_of_stock_record b
 WHERE a.date = b.date AND a.product_name = b.product_name AND a.id > b.id;  -- 14 组重复,留最早
ALTER TABLE out_of_stock_record ADD CONSTRAINT uk_oos_date_product UNIQUE (date, product_name);
```
配套代码(bakery-ops,随批 C 部署):
- `forecast-calc.repository.ts:152-160` 的裸 INSERT 补 `ON CONFLICT (date, product_name) DO NOTHING`;
- `stockout-detector.service.ts:341-349` 的 read-then-filter 幂等块整段删除(非原子,已被约束取代)。

**（Codex 的建议：暂停迁移 105 和配套代码。尚未确认一行表示实际断货事件、一次算法检测结果还是每日损失估算；同一商品同日可能补货后再次断货。应先拆 `stockout_detection_run` 与检测明细，或定义带起止时间的 episode，并包含 `store_id`、稳定商品键、算法版本和置信度。现有 14 组重复应逐组分类，不能直接“留最早”。）**

**0.7(随批 C)`product.item_key` 补齐 7 条缺口**:54 行中 47 行有值,
剩 7 条人工对照 pos_product 补上 —— 这是两套品名之间最后一段断桥。

**（Codex 的建议：不要把 7 条来源键直接人工写成企业商品身份。`item_key` 是 RES 来源商品键并可能带组织/门店作用域；应建立企业 product/SKU、门店商品和来源商品映射，保存证据、审核人与有效期。无法确认的继续列为未映射，不能猜填。）**

### 批 D · 次晨验收(D3 08:00,主动跑,C7)

```sql
-- 1) 昨晚 23:00 全量链成功:今天有昨日整日数据
SELECT COUNT(*) FROM item_hourly_sales WHERE date = CURRENT_DATE - 1;
-- 2) 空键归零(当天行也不空,证明盘中链修好了)
SELECT COUNT(*) FILTER (WHERE item_key IS NULL) FROM item_hourly_sales
 WHERE date >= CURRENT_DATE - 1;
-- 3) 三口径对账基线不劣化(流水口径应 ≥ 212/214 的历史水平)
-- 4) waste_reason 取值域干净
SELECT DISTINCT waste_reason FROM item_waste;
-- 5) 断货表无新重复
SELECT date, product_name, COUNT(*) FROM out_of_stock_record GROUP BY 1,2 HAVING COUNT(*)>1;
```

**（Codex 的建议：验收清单需显式采用 Kuala Lumpur 业务日，并按门店和来源批次检查 complete、期望/实际行数、异常塌陷、孤儿商品映射、gross/net/qty/支付对账及 JOIN 扇出。“有昨日数据”“空键为零”“没有日×品重复”都不能单独证明任务成功。）**
另看 Contabo `output/logs/daily-status.log` 与 `LAST_FAILURE` 哨兵文件。

**（Codex 的建议：日志和哨兵只能作辅助证据。应配置并实测可送达告警，同时把每次抓取和迁移的开始/结束时间、业务窗口、门店、状态、行数与错误摘要持久化，避免部分成功仍显示绿色。）**

---

## 五、Phase 1 · 分析层与一致性维度

**（Codex 的建议：不同意把分析层作为下一阶段。应先确定门店、商品、会员、来源批次等核心身份，以及每个业务事实的粒度、唯一写者和历史策略；建议顺序改为“核心身份与来源映射 → v2 业务事实 → 对账 → 分析层”。）**

**⚠ 治理门(动手前必须过)**:财务站 `AGENTS.md:60-62` 写死了「**不分 schema,
靠命名前缀分域**」(理由在 `~/Downloads/企业级数据库重构与全代码数据访问改造总控Prompt.md` §1.3)。
新建 `mart` schema 与它冲突。**先读那份 §1.3**:
- 理由已不成立 → 建 `mart` schema(迁移 106),同步更新 AGENTS.md,
  并平行财务站 `sql/059` 对 public 的权限收紧、确认 `test/db-integration.js` 的
  `verifySchema`/`verifyPublicSecurity` 门禁不受影响;
- 理由仍成立 → 全部对象放 `public`,用 `mart_` 前缀(`mart_dim_date`…),
  **方案其余部分逐字不变**。以下按前者书写。

**（Codex 的建议：schema 只是物理命名选择，不能让其余方案“逐字不变”。当前应用角色可绕过 RLS，新 schema 本身不构成权限隔离；短期可用 `public.mart_*`，先拆应用角色和最小权限，之后再评估只读 `analytics` schema。无论放哪里，以下维度与事实都必须重做。）**

**1.1 `dim_date`**(物化,2025-01-01→2027-12-31):date_key/年/月/日/星期/是否周末/
是否公假(联 holiday)/`day_type`。day_type 取值**必须**沿用
`mondayToThursday / friday / weekend`(timeslot_sales_record 与 out_of_stock_record 已在用)。

**（Codex 的建议：不要固定为 2025–2027，否则 2028 年直接失效。通用日期属性放 `dim_date`；公假、营业状态和 day_type 与门店地区、营业安排、规则版本有关，应放 `store_calendar`/有效期规则。三个旧值可以作为兼容映射，不应成为永久全局日期分类。）**

**1.2 `dim_product`**(视图,核心):
```sql
CREATE VIEW mart.dim_product AS
SELECT pp.item_key, pp.item_id, pp.org_type,          -- item_id 用于跨作用域归并
       pp.name_en, pp.name_zh_display AS name_zh, pp.category_display AS category,
       pp.sales_price,
       (p.id IS NOT NULL) AS is_in_production,        -- 是否在 54 个排产品里
       p.name AS production_name, p.positioning, p.cold_hot, p.pack_multiple
FROM pos_product pp LEFT JOIN product p ON p.item_key = pp.item_key;
```

**（Codex 的建议：该视图只能作为 RES 商品与当前排产配置的临时关联，不能作为企业商品维度。`item_key` 是来源身份，目标应有企业 product、SKU/规格、source_product_identity、带有效期的 store_product，以及与 cost_card_item/配方的受治理映射；`dim_product` 再由这些核心表投影。）**
粒度是 item_key(作用域×规格),不是「一个商品」;`product_alias` 不进维度(ETL 层工具)。

**（Codex 的建议：同意区分作用域和规格，但目标维度粒度应是企业 SKU，并保留 parent product 与来源映射。`product_alias` 不参与分析 JOIN 是对的，但它仍可作为导入治理或待确认映射，不能在证据不完整时删除。）**

**1.3 `dim_member`**(视图,已脱敏):从 pos_member 投影,
**不含 phone_country_code / phone_national / hbti_member_hash**。

**（Codex 的建议：脱敏方向正确，但当前投影仍不能解决跨门店身份、会员卡/账户和历史状态。先建立来源会员身份、企业会员、会员卡、每日快照/等级历史；分析层使用不可逆匿名键，PII 单独授权。HBTI 答题与发奖不能放在会员维度中。）**

**1.4 `dim_store`**(物化,1 行):`store_name='吉隆坡Pavilion门店'`(对齐 finance_store)+
`ops_code='pavilion'`(对齐 ops_store)。开第二家店 = 加一行,不是三个系统各造一个写法。

**（Codex 的建议：不接受硬编码一行，也不能等第二家店才补。现在就建立稳定 `store_id` 和 `store_external_identity`，分别映射 RES org/shop ID、finance_store 标识和 ops code，映射要有来源证据。所有销售、会员、报损、预测、断货、HBTI 和财务事实及唯一键都必须包含 `store_id`。）**

---

## 六、Phase 2 · 事实视图(8 张 + 1 张对比)

**（Codex 的建议：这些多数只是现有聚合表的过渡语义视图，不能称为完整事实层。只有核心表先具备门店、稳定商品键、来源批次、完整性和历史版本后才应建设；无法取得订单明细时，名称必须明确使用 `_agg`。）**

| 视图 | 底表 | 粒度 | 备注 |
|---|---|---|---|
| fct_sales_hourly | item_hourly_sales | 日×时×item_key | 核心;注释写明折扣归属差异(整单赠送,17 天,gross 口径 212/214 相等,跨表校验用 gross) |
| fct_sales_daily | daily_revenue | 日 | 日营收唯一口径(与 hourly_sales_summary 实测 214/214 相等) |
| fct_traffic_hourly | hourly_sales_summary | 日×时 | 账单数/客数只有这里有 |
| fct_waste | item_waste | 日×item_key×原因 | 依赖迁移 104 |
| fct_card_txn | pos_member_card_txn | 每笔卡交易 | 余额快照列不暴露,防误 SUM |
| fct_stockout | out_of_stock_record | 日×品 | 依赖迁移 105 |
| fct_forecast | forecast_snapshot | 目标日×品 | 快照语义,不可重算 |
| fct_hbti_completion | pos_member(hbti_ 列) | 会员×活动期 | 嵌在维度上的事实投影回事实,含 `hbti_record->'reward'->>'couponTemplateName'`(抽中的周边) |
| **forecast_vs_actual** | 上述四张 | 日×品 | 建议量 vs 实卖 vs 报废 vs 断货 —— 正是 `daily-review-chat.definition.ts:315-322` 手写四表 JOIN 的那个查询 |

**（Codex 对九个对象逐项的建议：）**

- **`fct_sales_hourly`：** **（Codex 的建议：目标粒度至少是门店×业务日×小时×SKU×来源批次。若 RES 能稳定取得订单行，应由 order/order_line/payment/refund 派生；否则命名为 `fct_sales_item_hourly_agg`，保存 gross/net、折扣、退款、税、币种、来源窗口、完整性和修订版本。）**
- **`fct_sales_daily`：** **（Codex 的建议：`daily_revenue` 只是一个 POS 日报来源，不能称全企业唯一营收口径。必须包含门店、业务日、币种、口径、来源和批次，并与 `finance_revenue_daily`/月结调整做差异对账。）**
- **`fct_traffic_hourly`：** **（Codex 的建议：补门店和来源批次，明确账单数/客数的定义与完整性；与商品事实连接前先聚合到共同粒度，避免客流被每个商品重复放大。）**
- **`fct_waste`：** **（Codex 的建议：补门店、稳定 SKU、原始原因、标准原因、批次和修订关系；若只有日聚合就命名 `_daily_agg`，并解决“非零修正为零后旧行残留”的替换语义。）**
- **`fct_card_txn`：** **（Codex 的建议：不暴露余额供 SUM 是对的；还要明确门店、会员匿名键、卡账户、来源交易 ID、交易类型、币种和发生时间。卡号/手机号不能作为分析退化维度，余额应另建时间点快照。）**
- **`fct_stockout`：** **（Codex 的建议：不接受日×品唯一粒度。当前更接近算法检测结果，应建 detection run+明细，或带起止时间的 episode，区分估算与真实事件，并含门店、SKU、算法版本和置信度。）**
- **`fct_forecast`：** **（Codex 的建议：当前表会覆盖同日结果，不是不可变快照。改为 forecast_run+forecast_line，保存生成时间、门店、目标日、SKU、模型/规则版本、输入截止时间和状态；旧表仅作“当前有效预测”兼容视图。）**
- **`fct_hbti_completion`：** **（Codex 的建议：不能从 `pos_member` 可靠生成。应新增 campaign、包含原始答案和问卷/评分版本的 campaign_response、reward_item、reward_issue 状态机和追加式 reward_stock_ledger；可变的 couponTemplateName 不能作为奖品键。）**
- **`forecast_vs_actual`：** **（Codex 的建议：这是指标/语义视图，不是基础事实。四个来源应分别先聚合到门店×日期×SKU×预测运行/场景再连接；当前没有实际生产事实，因此还不能把销量称为生产 actual。）**

验收:`SUM(fct_sales_daily.revenue)` 逐日等于旧口径;全部视图 < 100ms。

**（Codex 的建议：验收不能只看总额和 100ms。必须按门店、日期、SKU、支付/来源批次对账，检查行数、重复键、未映射商品、来源完整性、新鲜度和 JOIN 扇出。性能指标应来自真实负载的 SLI，而不是给所有视图统一写死 100ms。）**

---

## 七、Phase 3 · 逐消费方迁移清单(渐进,不设死线)

**（Codex 的建议：消费方迁移不能只替换 SQL JOIN。先发布有版本的数据契约和 v2 核心表，完成证据化回填，再用兼容视图或功能开关双读；为每个消费者记录负责人、对账指标、切换条件、回滚路径和旧契约退出条件。）**

迁移的实质是把 **14 处 `NORM(name_en)=NORM(item_name)` JOIN 和 8 处纯 item_name 聚合**
换成走 `item_key → dim_product`。全部位置已梳出,按收益/风险排序:

**（Codex 的建议：名称 JOIN 改成来源 `item_key` 只能解决部分同名问题；最终路径应是 `source_product_identity → enterprise SKU/product`，并带门店与有效期。未确认映射必须隔离和报告，不能继续用名称或别名猜配。）**

| 优先 | 功能 | 位置 | 迁移后收益 |
|---|---|---|---|
| 1 | daily_review_chat 取数 | `daily-review-chat.definition.ts` 12 条 SQL(:88,:97,:246,:265,:282,:315…) | 最集中的分析读;`forecast_vs_actual` 直接替换 :315-322 |
| 2 | forecast_review | `forecast-review.definition.ts:131-158` 五路并行 | 顺带去掉 `product_alias` 在分析路径的最后一处使用(:154) |
| 3 | morning_brief TOP5 | `morning-brief.service.ts:164-166` | 现在推给老板的是英文 POS 名;走 dim_product 后显示中文名 |
| 4 | sell-through | `sell-through.ts:38-65`(SQL 按名聚合 + JS 按名合并) | 同名不同品不再被并成一个 |
| 5 | ops-data-query(Lark 追问) | `ops-data-query.ts:21-30` 三路名匹配 | 简化为 dim_product 单查 |
| 6 | 断货检测白名单比对 | `stockout-detector.service.ts:237,267-269` | item_waste↔item_hourly_sales 改按 item_key 对齐 |
| 最后 | 排产链 | `product-demand.ts:28-31` / `restock-advice.ts:140-147` / `forecast.service.ts` | 回归风险最高,双轨对数两周后再切 |

**（Codex 对迁移优先级逐项的建议：）**

- **daily_review_chat：** **（Codex 的建议：可以集中到受治理的语义视图，但当前 `forecast_vs_actual` 不能直接替换；先完成各来源独立聚合和无扇出验证，再逐指标对比。）**
- **forecast_review：** **（Codex 的建议：迁移到带运行版本的预测模型。`product_alias` 可退出分析 JOIN，但在来源映射证据完整前仍应保留在导入治理层。）**
- **morning_brief：** **（Codex 的建议：中文名应通过有语言回退规则的商品展示属性；切换前同时验证 TOP5 排序、金额、门店范围和日期边界，不能只看显示名称。）**
- **sell-through：** **（Codex 的建议：稳定 SKU 只解决误合并；分母仍需实际生产量或可售库存。未补生产事实前，应明确当前指标只是估算值。）**
- **ops-data-query：** **（Codex 的建议：应读取声明粒度和权限边界的语义视图/数据服务；商品维度只负责身份属性，销售、报损、预测仍需分别聚合后连接。）**
- **断货检测：** **（Codex 的建议：它是运行写链路，不应依赖只读 mart 作为主数据源；应通过核心 source-product 映射取得 `store_id + sku_id`，再写 detection run 和结果。按 item_key 对齐只能作为过渡。）**
- **排产链：** **（Codex 的建议：同意最后迁移高风险链路，但“两周”不是验收标准；应覆盖工作日、周末、促销和异常营业日，并依据每店每品的预测、建议量和缺货风险容差决定切换。）**

**双轨与断言**(挂在现有 cron 尾部):新旧口径日营收对账、`item_key` 空值率为零、
dim_product 无孤儿事实行、断货表无重复。

**（Codex 的建议：双轨结果应持久化，并按门店、日期、SKU、来源批次和关键指标比较；同时检查抓取完整性、新鲜度、重复键、歧义映射和 JOIN 扇出。目标应是“可确定记录全部映射，歧义进入隔离队列”，不能为了空值归零而猜填。）**
**business_rule 白名单**迁移时注意:`beverage-caliber.ts:25-60` 的代码内置兜底常量
与 DB 是两份,改任何一份必须同步另一份。

**（Codex 的建议：长期依赖人工同步两份规则不可治理。应指定带版本、适用门店和有效期的唯一配置来源；代码常量只作明确版本的故障兜底，并用自动化测试阻止漂移，最终消除双重维护。）**

**不迁的消费方**:res_api(纯写入,零 mart 依赖);hbti-web(自成一域);
财务站(月结口径,`api/sales.js` 对 item_hourly_sales 的月度聚合**可以**将来改读
fct_sales_hourly,但不作为本计划义务)。

**（Codex 的建议：不同意“不迁”。应改成各自的迁移边界：res_api 不读 mart，但必须迁 v2 写入契约、门店、商品和批次；hbti-web 必须迁会员/活动/奖励核心模型；Bakery Ops 迁运营读写模型；财务站保持独立写所有权，但必须迁共享门店/商品/日期维度和分析读模型。四个消费者全部对账切换后，旧表或兼容视图才能退役。）**

---

## 八、明确不做什么

**（Codex 的建议：改名为“当前阶段不做、永久不做与待验证事项”。本节混合了合理延期、待验证结论和不应成立的永久边界，必须分别标注。）**

| 不做 | 理由 |
|---|---|
| 独立数仓 / dbt / Airflow | 规模差三个数量级;node cron 每晚构建够用 |
| 重构 public 运营表 | 四个活写者;Phase 0 之外的问题都在分析层解决 |
| 动 `uk_daily_revenue_date` 约束名 | 三仓四处硬编码(C1) |
| 拆 pos_member 双写结构 | 列级共存是清醒设计(C3),HBTI 事实用视图投影 |
| 合并财务域 | 月结 Excel 口径与 POS 日粒度语义不同 |
| 重放或修改历史迁移 | 财务站 apply-migrations 有 checksum 守卫;005/006 是已归档地雷(HANDOFF S1) |
| 给招聘漏斗建模 | 数据几乎全空(125 投递→0 录用),先补 stage_change 事件表再谈 |
| 立刻物化事实表 | 视图毫秒级;物化触发条件:P95 > 1s |
| 升级独立数仓 | 触发条件写死:单表 > 5,000 万行 / 查询 P95 > 5s / 出现订单行级数据。届时首选 DuckDB/ClickHouse 读副本 |

**（Codex 对上表逐项的建议：）**

- **独立数仓/dbt/Airflow：** **（Codex 的建议：保留“当前不建设”，理由是现有数据量与负载不足；先在同一 PostgreSQL 建核心层和只读分析层并补批次、血缘、完整性与监控。不要把 node cron 写成永久答案。）**
- **重构 public 运营表：** **（Codex 的建议：删除这条永久限制。用户允许大改，现有门店键、事实粒度和历史策略有根本问题；应通过 v2 并行表、兼容适配和逐消费者切换重构，而不是把缺陷封进视图。）**
- **`uk_daily_revenue_date`：** **（Codex 的建议：改为迁移期兼容要求。最终多门店唯一性必须包含 `store_id`，迁完所有硬编码调用后替换旧约束。）**
- **`pos_member` 双写：** **（Codex 的建议：当前禁止破坏性替换，但必须新增活动响应、发奖和库存流水；HBTI 列只保留最新状态兼容投影，不能代替历史事实。）**
- **财务域：** **（Codex 的建议：不把财务运营表与 POS 物理合并是对的，但财务必须进入一致分析模型，共享门店、日期、商品、科目、场景和来源批次。）**
- **历史迁移：** **（Codex 的建议：保留“不修改已执行迁移”，用新迁移前滚修正；同时必须统一迁移 ID、filename、checksum、执行者和锁，核对未登记与冲突历史。）**
- **招聘：** **（Codex 的建议：125 个投递不等于几乎为空，0 录用更可能说明阶段历史不完整。Lark 继续作为 ATS 主数据源，数据库先建带外部 ID 的追加式 stage event；来源完整前可以暂缓招聘 mart，但不能不建模。）**
- **立刻物化：** **（Codex 的建议：保留“先普通视图”，删除固定 P95 1 秒门槛；按真实查询负载、刷新时效、并发和构建成本决定物化。）**
- **升级数仓触发条件：** **（Codex 的建议：删除硬编码条件。订单行是正确销售粒度，不是数仓触发器；是否拆数仓应综合数据量、并发隔离、保留周期、CDC、刷新 SLA、计算成本和治理重新评估。）**

---

## 九、执行时间线(一页)

**（Codex 的建议：改成阶段门禁，不承诺 D1–D5。当前首先缺的是经批准的业务模型、来源能力验证和迁移治理；每阶段必须以前一阶段验收通过作为进入条件。）**

| 日 | 动作 | 窗口 |
|---|---|---|
| D1 | 批 A 全部代码改动 + vitest 全绿 + `deploy.sh core`(工作区必须干净) | 白天改,避开 14:20/23:00 部署 |
| D2 早 | 验收盘中 item_key;跑批 B 回填(Mac 本地,先摘 daily_sales_record 条目) | 08:00–12:00 |
| D2 午 | 批 C:迁移 102–105 + 0.7 补键 + 配套代码部署 | **13:00 前收工**(避开 14:20) |
| D3 早 | 批 D 验收清单(主动跑,没有告警兜底,C7) | 08:00 |
| D3–D5 | 治理门(AGENTS.md §1.3)→ 迁移 106/107:mart schema + 4 维度 + 9 视图 | 任意 |
| 第 2 周起 | Phase 3 按优先级逐个迁,双轨对数;排产链最后 | 渐进 |

**（Codex 对原时间线逐项的建议：）**

- **D1：** **（Codex 的建议：改为阶段 0——逐业务过程确认主数据源、唯一写者、行粒度、企业主键、门店范围、历史与更正规则；经用户批准前不部署代码或数据库变化。明确安全的 item_key 盘中止血可单独审批。）**
- **D2 早：** **（Codex 的建议：改为阶段 1——只读验证 RES 订单、订单行、支付、退款、就餐和门店标识能力；历史只通过可审计迁移或重新抓取处理，不猜填歧义。）**
- **D2 午：** **（Codex 的建议：暂停原定 102–105。先设计 `store_id`、企业商品/来源映射、ingestion batch 和事实粒度；尤其迁移 105 不能按当前日×品唯一模型执行。）**
- **D3 早：** **（Codex 的建议：改为治理与可观测性阶段——统一迁移账本、checksum、执行锁、应用数据库角色和告警；验收覆盖完整夜间批次与盘中批次，不能只靠单次人工检查。）**
- **D3–D5：** **（Codex 的建议：暂停 106/107。先建设核心主数据和 v2 事实并完成历史对账，mart 的维度/事实数量由业务粒度决定，不能预先固定。）**
- **第 2 周起：** **（Codex 的建议：改为验收驱动切换——v2 回填并按门店、日期、SKU、来源对账后才建 mart、迁消费者、保留兼容适配，全部退出后再清理旧表/约束。）**

**判断**:适合星型建模,不适合独立数仓。
**（Codex 的建议：改为“业务分析层适合星型建模；交易、认证、消息队列、工作流和版本化业务记录不应强行星型化；按当前规模暂不需要独立数仓。”）**
**边界**:运营表不重构、财务域不并入、约束名不动、迁移号从 102 起。
**（Codex 的建议：整句改为“运营核心允许通过 v2 并行结构重构；财务保持独立写入所有权但进入一致分析维度；旧约束只在迁移期兼容；新迁移使用统一、可校验且不冲突的编号体系。”）**
**一句话**:先把 item_key 铺到每一行、把日期变成真日期,星型层只是这两件事做完之后的一层薄视图。
**（Codex 的建议：整句改为“先确定门店、商品、会员和业务事实的企业主键、行粒度、来源血缘与历史策略，再建设可并行迁移的核心模型；item_key 和日期修复只是必要止血，核心模型完成后才建设星型分析层。”）**

---

## 十、Kimi 的建议(2026-08-03)

> 依据:当天对四个数据库使用方的独立代码级复查(res_api / bakery-ops / hbti-web /
> 财务站),外加 2026-07-27《数据库演进方案(实测修订版)》(下称「0727 方案」)。
> 用户前提:**数据量小(全库 ~70MB、最大表 8.1 万行)、允许大改重构**。
> 因此本节的出发点是「目标模型应该长什么样」,而不是「怎么动现状最安全」——
> 这恰好在 Claude(以现状为地基)和 Codex(以治理流程为主线)之间补上了缺失的第三块:
> **业务闭环本身**。

### 10.1 总评

| 对象 | 评价 |
|---|---|
| Claude 方案(本文 v2) | **作为止血修复清单:8/10。** Phase 0 批 A(item_key、日期钉死、8 处 SQL)都是真 bug 修复,应该做。**作为目标数据模型:3/10。** 它把现有 105 张表当作不可动的地基,只在上面铺视图——建模的出发点是「现在表里有什么」,不是「这门生意是什么」。 |
| Codex 批注 | 方向正确(规范化核心层、store_id、来源身份、批次血缘必须先于 mart),但**同样没有给出目标模型**,只说了「要重做」;且治理要求(逐阶段审批门、每应用独立角色+列级权限)对「一个人 + 三个 AI、单店」的体量偏重,与 0727 方案的实测结论冲突(见 10.2)。 |
| 两份文档共同的最大盲区 | **烘焙业务的核心闭环在模型里是断的**:预测✅ → 排产计划❌ → **实际生产❌** → 销售✅ → 报废/断货✅ → 复盘(只能靠销售+报废反推)。`plan-generator.ts` 是纯函数,排产计划不落库;全库没有任何「实际烤了什么、烤了多少」的表。`forecast_vs_actual` 里的 "actual" 是销量不是产量,sell-through 的分母根本不存在。对一家面包店,**计划产量 vs 实际产量 vs 实卖 vs 报废**就是生意本身——这张表不进目标模型,任何星型层都是在给半个闭环做精装修。 |

### 10.2 我与 Codex 的主要分歧(部分同意 Claude)

1. **销售事实粒度:账单级,不是订单行级。** Codex 说「订单行是正确销售粒度」。我复查后的结论:
   RES 当前生产链路的下限是日×小时×单品;**账单级已被实测证明可抓**(`probe-orders.mjs` /
   `scrape-order-analysis.mjs` 用 `D_businessDate+D_openedTime` 维度过 888001,产出 26,683 行、
   99.8% 是真·单笔账单,含 openedTime/net/gross/discount/guests——但这份数据从没入库)。
   订单行级(账单×单品)需要验证 `/report/report-sales-orders` 对应的 reportId,**目前不存在这条链路**。
   建议:目标模型按**账单级**设计(客单价分布、连带率、时段结构全解锁,数据量每月仅 ~2.7 万行,
   约等于白捡);订单行级列为「待验证决策点」,不阻塞建模。
2. **角色拆分:3 个就够,不要每应用一个。** Codex 要求 per-app 角色+最小列权限。
   0727 方案实测论证过:四仓读写表集合高度重叠,真正有意义的信任边界是「Vercel 公网 vs 自己的
   Contabo」,不是业务域;`hotcrush_migrator`(唯一 DDL)/ `svc_app`(无 DDL 无 TRUNCATE)/
   `svc_readonly` 三个角色即可。我站 0727 方案。
3. **「经用户批准业务模型前不动任何代码」过绝对。** 盘中链丢 item_key 是**正在发生的数据丢失
   bug**(三组同名商品的第二个被静默丢弃),止血不应等业务模型审批。批 A 应单独放行。
4. **迁移编号「从 102 起」与既有约定冲突。** HANDOFF 里已有号段约定(财务 001–099 /
   bakery-ops 100–199 / res_api 200–299)。问题不是起点数字,是**抢占没有锁**:
   0727 方案的解法(advisory lock + 文件名↔登记一致性断言 + 拒绝执行未登记文件,约 20 行)
   才是对症下药,Claude 的「从 102 起」和 Codex 的「全局唯一 ID 体系」都不如它直接。

### 10.3 业务闭环对照:模型缺什么(我复查确认的事实)

| 业务环节 | 现状 | 目标模型必须补的 |
|---|---|---|
| 排产计划 | `plan-generator.ts` 纯函数,**零持久化** | `ops_production_plan` / `_line`(版本化,含来源与确认状态) |
| **实际生产** | **全库无表、无写入路径** | ✅ **已定(见 10.6-1)**:每日上传生产预估单,确认版即实际生产记录;不另建 actual 表 |
| 班表/排班 | **全库无表**;工时只有月汇总(`finance_labor_detail`,财务域,月×店×类别) | `hr_shift_schedule`(店×日×员工×班次,**用户上传 Excel**):日粒度工时,人效分析(营收/工时、产量/工时)第一次成为可能,并可与财务月工时互相校验 |
| 销售 | 日×小时×单品✅;但**单品折扣抓了没存**(itemsByHour 有 discountProm,itemsByDateHour 没 select)、**退款只进 CSV 不入库**、**dining 日数据是伪造精度**(30 天总比摊到每天,bill_count/net_sales 写 NULL) | `pos_sales_bill`(账单级,新抓);v2 小时事实补折扣/退款/批次;dining 要么按日抓要么标记为 30 天聚合,不许再摊 |
| 会员/储值 | 快照+行级流水+日汇总,基本健康;`memberConsumeAmt` 口径未坐实、充值拆分是启发式 | 保持结构,口径收进语义层 |
| HBTI/营销 | **13 题原始答案完全不落库**(只存算好的 code);换 campaignVersion 即**覆盖上期全部 12 列**(是 12 列不是 8 列);礼品库存是**纯计数器无流水**,抽中后崩溃即漏账(代码注释自认) | `mkt_campaign` / `mkt_campaign_response`(含原始答案 jsonb)/ `mkt_reward_issue`(状态机)/ `mkt_reward_stock_ledger`(追加式流水) |
| 供应链 | DB 路径已死(表零数据、repo 已删),真实流程在 WMS + 金山文档 | **目标模型里先不建 SCM 事实**;只留供应商/物料主数据挂成本卡 |
| 成本卡 | 模型是好的(物料-配方版本-配方行-有效期价格,值得原样保留),但与 POS 商品只有 2.6% 能连 | `cost_card_product_link` 接 `item_key`,毛利分析才真正可能 |
| 财务月结 | 月×店行项目长表,结构合理;但**无期间关闭状态**,历史月靠人工对账迁移修数;`finance_store`(中文全名)与 `ops_store`(store_code)**无映射** | `finance_period_close`(月×店 closed 状态);门店身份归一到 core 主数据 |
| 招聘 | DB 主 Lark 镜像,FSM 表在真实使用,模型没问题(Claude「数据几乎全空」对 DB 原生招聘域不成立,Codex 已更正) | 需要漏斗分析时补追加式 `hr_stage_event`,否则不动 |
| 门店 | POS 事实表 store 列全 NULL;`daily_revenue` 三个写者按 `(date)` 互相覆盖 | 所有新表必带 `store_id`;门店外部身份映射表(RES shopId ↔ finance_store ↔ ops_code) |

### 10.4 目标模型建议(三层,同库,遵守 AGENTS.md 前缀分域)

用户的「数据少、可大改」前提改变了最优路径:**对核心事实表,重建回填优于兼容视图体操**。
历史可以重抓(RES 报表按 30 天窗口查,会员流水全量可重拉),回填成本以小时计而不是以周计。
兼容视图只在跨仓 `ON CONFLICT` 硬编码处(C1)保留。

**第 0 层 · 来源落地(`pos_ingest_batch` + 各来源暂存)**:每次抓取记批次(来源、门店、
业务窗口、行列数、complete 状态)。这是治「静默失败」的总开关——本项目历次重大事故
(爬虫六晚 exit=0、名称 JOIN 丢 45 个商品、批次表 0 行)全是静默失败,批次+完整性校验
让失败变响亮,比任何维度设计都值钱。

**第 1 层 · 规范化业务核心**:
- 主数据:`core_store` + `store_external_identity`(三系统门店写法归一)、
  `core_product`(企业 SKU)+ `product_source_map`(item_key/中文排产名/成本卡物料的
  带证据映射)、`core_member`(现有 pos_member 演进)。⚠ `core_` 前缀不在 AGENTS.md 现有
  号段里,采纳前需先更新 AGENTS.md。
- 事实:`pos_sales_bill`(新)、`pos_sales_item_hourly_v2`(store_id + item_key +
  折扣 + 退款 + batch_id)、`pos_waste_v2`(原始原因+标准原因+映射版本)、
  `ops_production_plan/_line`(**新,核心缺口**;`source` ∈ `excel_upload` / `forecast_auto`,
  `status` ∈ `draft` / `confirmed`,确认版即实际生产记录,不另建 actual 表)、
  `hr_shift_schedule`(**新**;店×日×员工×班次,来源 = 用户上传 Excel,
  关联 `staff`,带 `batch_id` 与上传版本)、
  `ops_forecast_run/_line`(替代覆盖式 forecast_snapshot)、`ops_stockout_run/_line`
  (替代裸 INSERT)、`mkt_*` 四张(见上)、`finance_period_close`(新)。
- 存量健康部分原样保留:会员三表、成本卡五表、招聘 FSM 表、财务月度行项目表、
  msg_/ai_ 平台表(它们不进星型层,也不需要)。

**第 2 层 · 分析层(`mart_` 视图)**:**维度与事实的数量由第 1 层粒度决定,不预先钉死
「4 维 8 事实」**。dim_date 不固定 2025–2027(Codex 对);门店相关的营业日历进
`store_calendar` 不进全局日期维。`forecast_vs_actual` 改名 `ops_plan_vs_actual`,
四输入变成五输入(计划/实际生产/实卖/报废/断货)——**没有实际生产那一列之前,
这个视图不要建,建了也是把估算值洗成权威值。**

### 10.5 落地路径(利用「数据少」的红利)

1. **批 A 止血单独放行**(item_key 三处、日期钉死、8 处 SQL)——这是数据丢失 bug 修复,
   不等目标模型审批。这点我与 Claude 一致、比 Codex 激进。
2. **迁移治理 20 行**(advisory lock + 一致性断言,0727 方案 4.1③)+ 005 物理隔离 ——
   在任何新 DDL 之前。
3. **建 v2 核心表**(`pos_sales_bill`、`pos_sales_item_hourly_v2`、生产计划两张、
   `hr_shift_schedule`、forecast run、mkt 四张、门店/商品主数据),全部带 `store_id`
   与 `batch_id`,**与旧表并行**。
4. **回填**:RES 按 30 天窗口重抓历史(含账单级),歧义商品进未映射队列不猜填
   (Claude/Codex 一致,我同意)。
5. **双轨对账后逐消费方切读**,排产链最后(Claude 的优先级排序合理,保留);
   `uk_daily_revenue_date` 等跨仓硬契约最后在同一维护窗口收口(C1 按 Codex 的退出条件处理)。
6. **mart 层最后建**,此时维度只是核心层的薄投影,Claude「星型层是一层薄视图」这句话
   到这一步才成立。

### 10.6 决策点(1 已拍板,2–5 待拍板)

1. ✅ **已拍板(2026-08-03):生产数据 = 每日上传生产预估单;班表同样每日上传。**
   - **现阶段**:用户每日上传两份 Excel —— 生产预估单、班表。bakery-ops 已有 Excel
     上传/导入的成熟路径(策略导入 `importStrategies`、产品导入),两份新上传复用同一模式:
     解析 → 暂存校验 → 生成新版本行,**上传即产生一个 `excel_upload` 来源的
     `ops_production_plan` 版本,确认(confirmed)版本即当天实际生产记录**,不另建
     `ops_production_actual` 事实表;班表同理落 `hr_shift_schedule`。
   - **终态**:预测模型被验证足够准之后,`ops_production_plan` 改由 `ops_forecast_run`
     自动生成(`source='forecast_auto'`),上传通道降级为人工修正入口——表结构不变,
     只是多一个来源值,**这就是为什么 source/status 两列必须第一天就在**。
   - 待实施时确认:两份 Excel 的模板列(预估单是否带批次/时段、班表的班次表达方式),
     按模板敲定 `_line` 与 `hr_shift_schedule` 的列;同日重复上传 = 新版本覆盖还是
     拒绝,建议「同日常态覆盖、跨天只读」。
2. **账单级抓取是否纳入每晚链路?** 已验证可行,代价是每晚多抓 ~30 个分页请求。
3. **门店主键现在就建还是等签第二家店?** 我的建议:现在建新表全部带 `store_id`
   (一行门店也是一行),旧表随 v2 重建带上——比 0727 方案的「签约那天再做」略激进,
   因为反正要重建,顺手做成本为零。
4. **财务月结要不要 closed 状态?** 新增能力,涉及月结工作流改动,不是纯技术决定。
5. **三份方案文档归一**:GPT 蓝图(0727 修订)、本文(Claude+Codex)、以及本节并存,
   建议采纳后将结论合并成一份 v3 目标模型文档,其余两份归档为历史——否则下一个 agent
   面对的是三份互相不完全一致的「权威」。

**Kimi 的一句话**:Claude 修对了地基的裂缝,Codex 指出了地基位置不对,但两家都还在
「现有表」的框里画图。这门生意的核心是「每天烤什么、烤多少、卖掉多少、报废多少、
谁在上班」——**先把排产计划和班表这两张上传表建出来,再谈星型。**

---

## 十一、Codex 对 Kimi 版本的逐条复核与落地建议（2026-08-03）

**（Codex 意见：本节只追加审阅意见，不改写 Claude、此前 Codex 或 Kimi 的任何原文。用户已进一步确认：员工数据来源不是“加班表”，也不是预排班 Excel，而是 Lark 上每天填写、每天读取的月度实际工时在线表，记录某员工在哪一天实际上班及实际工作时长。以下所有人效与工时建议均按这一已确认语义修订。）**

### 11.1 对 10.1 总评的复核

**（Codex 意见：Kimi 把讨论拉回“预测、计划、执行、销售、报废、人员投入”的烘焙业务闭环，方向正确，也比只整理现有 POS 分析视图更接近企业目标模型；但其方案仍混淆了计划与实际、来源聚合与真实订单、登录身份与员工身份，因此不能按 10.4–10.6 原样实施。）**

**（Codex 意见：前文 Codex 批注并非只提出治理，已经提出来源层、规范化业务核心层、分析层，以及门店、商品、来源身份、预测、生产、HBTI 和财务对象；真正需要补齐的是把这些对象收敛为逐表明确“粒度、稳定主键、唯一写者、来源批次、状态流、历史策略”的目标模型。本节给出该收敛版本。）**

**（Codex 意见：推荐采用“精简核心 v2”方案：继续使用同一个 PostgreSQL 和 `public` schema，遵守域前缀；重建少量企业主数据、来源批次和核心事实，最后才建 `mart_` 视图。只在旧表旁边补两张上传表只能作为短期 MVP；现在直接建设多 schema、事件总线、完整总账和独立数仓则超出真实数据源与团队规模。）**

**（Codex 意见：当前规模不需要独立数仓、dbt 或 Airflow，但“不需要独立数仓”不等于“业务核心表也按星型事实设计”。交易、上传版本、审批、消息、认证、招聘状态和库存流水仍应使用规范化业务模型；星型结构只用于最后的分析投影。）**

### 11.2 对 10.2 四项分歧的复核

**（Codex 意见：10.2-1 的“账单级已被实测证明”需要更正。现有 888001 数据按 `businessDate + openedTime` 聚合，不带稳定订单 ID；旧样本 26,683 个时间桶实际包含 26,741 张账单，其中 57 个时间桶包含多张账单。因此它只能作为 `opened_time` 聚合事实，不能直接命名为权威 `pos_sales_bill`。）**

**（Codex 意见：旧脚本用返回行数而不是 `SUM(bill_count)` 作为订单数，客单价约应为 RM54.11，而不是 RM54.22；脚本还排除了净额不大于零的行，无法构成包含退款和冲销的完整销售账本。该链路入库前必须补完整分页、total 校验、失败批次阻断以及按门店和业务日的金额、单数对账。）**

**（Codex 意见：订单头与订单商品不是二选一。企业目标应预留 `pos_order`、`pos_order_item`、`pos_payment` 和 `pos_refund`；只有订单头可以分析客单价和时段，但商品连带、同单组合、订单级毛利和生产—销售闭环仍需要订单商品。现有 report 211 metadata 已暴露 order ID、商品 ID、数量、折扣、退款和税等候选字段，应先做一次只读组合验证，再决定实际可落的最低粒度。）**

**（Codex 意见：如果短期只接入当前 888001 数据，建议明确命名为 `pos_sales_opened_time_bucket` 或同义聚合表，并保留 `bill_count`；不得用 `openedTime` 拼成永久订单主键，也不得据此宣称已经支持精确单笔账单分布或购物篮分析。）**

**（Codex 意见：10.2-2 的三个数据库角色只适合作为临时收权，不适合作为企业终态。四个运行方共享 `svc_app` 会使任何一个公网应用凭据泄露后获得其他业务域的写权限，也没有真正实现文中所说的 Vercel 与 Contabo 信任边界。）**

**（Codex 意见：第一阶段无需铺满列级权限和复杂 RLS，但至少使用六个简单表级身份：`hotcrush_migrator`、`svc_res_ingest`、`svc_bakery_ops`、`svc_hbti_web`、`svc_finance_web`、`svc_readonly`。运行应用不再使用 `postgres`；`postgres` 只保留为人工 break-glass 身份。）**

**（Codex 意见：角色切换不能只做 GRANT。当前共享库大量 public 表已启用 RLS，现有应用又依赖 `postgres` 的 BYPASSRLS；普通新角色即使拿到表权限，没有匹配 policy 仍会全部读写失败。每个角色必须先生成允许表清单，逐表配置并核验 grants + RLS policy（极少数受控 BYPASSRLS 例外需单独批准），再用真实运行身份做读写 smoke test，最后才轮换连接串。）**

**（Codex 意见：10.2-3 中正在发生的数据丢失问题可以单独止血，这与前文 Codex 的真实主张并不冲突。建议将盘中 `item_key` 丢失修复作为一个最小、可测试、可回滚的发布；日期解析、八处 SQL 和日期类型迁移另成一组，避免把风险不同的改动捆绑成“批 A 全部安全”。）**

**（Codex 意见：10.2-4 的 advisory lock、文件清单和 version/name/checksum 冲突断言值得立即采用，但 lock 只防并发，不解决多仓库号段所有权、清单互不知情或危险历史迁移重放。应冻结既有历史，建立一份权威 migration manifest，记录版本、文件名、checksum、仓库、状态和执行时间，并让所有仓库通过同一执行入口申请锁。）**

### 11.3 对 10.3 业务闭环逐项复核

**（Codex 意见—排产计划：同意这是当前最重要的业务缺口之一。生产预估单应形成不可变版本，而不是覆盖同日记录；模型至少包含上传批次、计划头、版本、商品行和时段行，才能保存首次计划、最终计划、调整原因和逐时出货安排。）**

**（Codex 意见—实际生产：删除“confirmed 版本即实际生产记录”的结论。现有预估单已把“预估/计划总数量”和“实际出货”分成独立字段；`confirmed` 或 `published` 只能证明计划获批。只有来源明确填写“实际出货”时才可形成执行事实，空白必须保存为未知 `NULL`，不能用计划量代替，也不能填成 0。）**

**（Codex 意见—实际出货口径：模板中的“实际出货”仍不当然等于“实际烘烤/实际生产”。后厨实际做成数量、后厨向前场实际出货数量、POS 实卖数量和报废数量可能不同。现阶段建议事实命名忠于来源，使用 `actual_dispatched_qty`；取得真正烘烤批次或完成记录后，再增加实际生产数量。）**

**（Codex 意见—员工工时：Kimi 所写的“班表每日上传”已被用户的新确认取代。权威来源是 Lark 月度实际工时在线表，每天填写、每天读取，记录员工×日期的实际工作时长。因此首期应建设实际工时同步，不应把它落成 `hr_shift_schedule` 计划排班表。）**

**（Codex 意见—员工工时粒度：依据用户提供的两张 Lark 实表，首期粒度应固定为“雇佣关系×门店×工作日期×工作区域/来源流”，一条记录对应前场或后厨月表中的一个员工日单元格，保存 `actual_work_minutes` 即可计算日/月实际人效。前场与后厨是两条独立来源，同一员工同日可能跨区工作，因此唯一键不能只有员工×门店×日期；同一区域重复行应进入异常队列，跨区工时只在聚合层相加。不能让一张表同时混存“日汇总”和“班次分段”，否则将来会重复计时；若以后取得上下班或打卡分段，应另建 `hr_work_session`/考勤事件表。每日总小时数不能虚构成具体上下班时间。）**

**（Codex 意见—员工身份：实际工时不得直接关联 `staff`。`staff` 当前承载 Lark/WhatsApp 登录、权限和通知身份，不是完整员工主数据；当前生产快照中 active employees 与 active staff 的姓名/电话也没有形成可靠自动匹配。工时应引用稳定 `hr_employment_id`，再通过员工来源身份映射到 Lark 表中的员工编号或用户 ID；`staff` 只适合记录 `synced_by`、`approved_by` 等操作人。）**

**（Codex 意见—财务工时：`finance_labor_detail` 只有 month/store/category/item/org/amount，保存月度人工成本金额，没有员工和工时。Lark 实际工时可以按月汇总后与人工成本做成本率或趋势分析，但不能说该财务表能验证月工时。工资、OT 和法定扣款仍属于另一业务过程。）**

**（Codex 意见—Lark 实表结构：已只读确认后厨与前场均按月份建工作表，员工为行，1–31 日为列，后接 Total Actual Hours、Required Hours、Variance 和异常备注；后厨标准日工时为 7.5，前场为 8。两本表结构高度相似但不是完全相同模板，必须按工作簿+sheet revision 解析，不能硬编码一个永不变化的列布局。）**

**（Codex 意见—Lark 月份定位：两本工作簿的月度 sheet 排列顺序并不一致，不能用 tab index 推断月份。同步器应从 sheet 名 `YYYY-MM` 发现月份，并再次校验表头 Year/Month；标题、表头和实际日期列不一致时整批标错，不发布到核心工时表。）**

**（Codex 意见—Lark 原始值：每日单元格同时出现数字小时、空白、0、大小写不一致的 off、病假/无薪假/补假等中英文状态。同步必须保存 `raw_cell_value`，再由带版本的映射解析出可空 `actual_work_minutes` 与可空 `attendance_status_code`；空白表示尚未填/未知，数字 0 表示明确零小时，二者绝不能合并。请假状态也不能未经规则确认就按工资工时处理。）**

**（Codex 意见—休息时间：表头给出 Default Daily Break Hours，但每日格只保存一个小时数，尚未证明该数字是否已经扣除休息。首期应忠实保存 `reported_hours`/`actual_work_minutes` 和模板参数，不反推开始、结束或休息；业务确认扣休规则前，分析指标命名为“申报工时人效”，避免把口径不明的数据包装成净工作时长。）**

**（Codex 意见—Lark 汇总列：月总实际工时是 `SUM` 每日数字单元格的派生值，文字状态会被忽略；Required Hours 在两表中也可能是公式或手工值。核心表应逐日读取并自行汇总，Total/Required/Variance 只作为来源校验值和异常提示，不能作为员工工时事实。前场 2026-07 的只读样例中，标准日工时×标准工作日与手工 Required Hours 已出现不一致，更需要差异告警而不是盲信汇总列。）**

**（Codex 意见—Lark 员工键：两张表目前只有 No.、Name、Position，没有稳定员工编号；No. 在月份之间不能视为员工身份，行号和姓名也都可能变化。上线同步前最值得对源表做的最小改进是增加稳定 Employee ID；在此之前必须建立经人工确认的“工作簿/部门+原姓名→hr_employment_id”映射和未匹配队列，禁止静默按相似姓名归并。）**

**（Codex 意见—Lark 门店键：两本工作簿能区分后厨和前场，但表头没有稳定 store code。同步配置必须显式登记“spreadsheet token→store_id+department/work_area”，或者在模板加入 Store Code；不能因为现在只有 Pavilion 就把门店硬编码进解析器。）**

**（Codex 意见—销售：保留“单品折扣和退款未完整入库、dining 日粒度存在伪精度”的判断。目标销售结构应是订单头、订单商品、支付、退款；当前小时商品数据保留为来源聚合事实并明确 `_hourly_agg`，不得与未来订单明细互相覆盖。）**

**（Codex 意见—会员：现有会员账户、卡流水和日快照可保留为演进基础，但所有来源记录必须明确 `store_id + source_member_id`、业务日期、批次和 PII 权限边界。现在没有必要提前把不同门店会员强行去重为一个 `core_member`；只有跨店统一会员与同意管理成为真实需求时再建设企业会员主档。）**

**（Codex 意见—HBTI：同意拆为 campaign、response、reward item、reward issue 和 stock ledger。response 还应保存问卷/计分版本、原始答案、同意版本、来源和保留期限；reward issue 与库存流水共享幂等业务键，避免扣库存成功但发奖结果未知形成双账。）**

**（Codex 意见—供应链：当前不创建没有稳定写入来源的 SCM 交易事实是合理的，但不应把供应链定义为“已死”。目标边界应注明现阶段 WMS/在线文档是权威来源，本库先保留供应商、物料和商品/成本映射；有稳定接口及真实消费者后再增加采购、收货和库存事实。）**

**（Codex 意见—成本卡：10.3 的“只有 2.6% 能连”已过时。2026-08-03 只读快照显示 `item_hourly_sales` 81,168 行中已有 78,871 行带 `item_key`，按净销售额覆盖约 96.98%；`pos_product` 211 行中 158 行已有 RES 成本字段。真正仍缺的是企业商品与本库财务成本卡成品之间的受控映射。）**

**（Codex 意见—成本桥：`cost_card_product_link` 已经存在且已有 94 行，当前来源均为 `mysql:v_product_direct`，不能再创建一个同名新表。应扩展或迁移现有桥，增加企业 SKU、RES item_key、门店、有效期、来源证据、确认状态和批准人；RES 理论成本与本地财务配方成本必须保持两个来源口径。）**

**（Codex 意见—财务月结：建议保留 `finance_period_close` 能力，并明确 `open / closed / reopened` 状态、关闭人/时间、来源批次和重开原因。关闭后的修正必须通过重开或调整记录，不得静默覆盖历史月；具体谁有权关闭和重开仍需财务业务规则确认。）**

**（Codex 意见—招聘：Lark 继续作为招聘主数据源，数据库承担镜像、自动化状态和事件记录；“现有模型没问题”表述过强。需要漏斗分析时补追加式 stage event。正式员工、候选人、雇佣关系和登录/通知身份必须分开，实际工时只连接已确认的雇佣关系。）**

**（Codex 意见—门店：同意现在就建立稳定 `store_id` 和外部身份映射，但“顺手做成本为零”不准确，四个消费者、历史数据和唯一键都需要迁移。要求应限定为所有具有门店范围的业务事实必须带 `store_id`；迁移日志、全局配置等技术表不应机械增加门店列。）**

### 11.4 对 10.4 三层目标模型的复核

**（Codex 意见—来源层：批次治理必须按唯一写者分域，不能让所有项目共同写一个 `pos_ingest_batch`。RES 使用 `pos_ingest_run`；生产预估单使用 `ops_import_batch`；Lark 实际工时使用 `hr_timesheet_sync_batch`；财务继续使用并完善现有导入批次历史。核心事实只引用本域批次。）**

**（Codex 意见—批次内容：POS 批次至少记录 dataset/report ID、门店、RES shop ID、业务窗口、提取器版本、分页 total、返回行数、账单/数量/金额校验、checksum 和 complete/partial/failed 状态；只有 complete 且对账通过的批次才能发布到核心表。）**

**（Codex 意见—文件导入：生产预估单批次至少保存文件 SHA-256、原文件名、对象存储路径、模板版本、门店、业务日期、上传人、行数、错误行、未映射行和解析器版本。解析失败或商品未映射时整批不得发布；原文件不应作为数据库二进制长期塞入业务表。）**

**（Codex 意见—Lark 同步：实际工时同步必须保存 Lark spreadsheet token、月度 sheet ID、document revision、员工来源键、工作日期、原单元格定位/值、同步时间和批次状态。当前每月仅约 31 列×数十名员工，建议每天完整读取“本月+仍可修订的上月”而不是设计脆弱的单元格增量游标；相同 revision/hash 重读必须幂等，来源变化则保留旧值与修订轨迹。）**

**（Codex 意见—主数据命名：不建议立即引入无人负责的宽泛 `core_` 前缀。继续按现有域前缀，并明确唯一维护者：`ops_store` 与 `ops_store_external_identity` 管真实经营门店；`ops_product` 与 `ops_product_external_identity` 管企业可售/可生产 SKU；`pos_product` 保留为 RES 来源商品目录；`hr_person`、`hr_employment`、`hr_person_identity` 管人员、雇佣关系和来源身份。）**

**（Codex 意见—门店与组织：这里的 `ops_store` 指清理后的 v2 经营门店主档，不是默认复用现表。现有 `ops_store` 已混入“海外项目组”等非门店组织并承载招聘配置；v2 前必须把部门/项目组迁到 `hr_org_unit`，通过雇佣分配连接员工、组织和门店，确保生产、销售与工时事实只能 FK 到真实物理经营门店。）**

**（Codex 意见—商品边界：企业可售产品/SKU、RES 来源商品、排产名称、成本卡成品、原料和半成品不能被一个 `core_product` 平铺为同类实体。应通过带来源、有效期和确认状态的映射连接；未映射项进入队列，由人确认，禁止按中英文名称自动猜填。）**

**（Codex 意见—生产模型：推荐 `ops_forecast_run/_line` 保存模型建议；`ops_production_plan` 表示门店×生产日期的稳定业务头；`ops_production_plan_version` 保存每次系统生成、文件上传或人工修订；`ops_production_plan_line` 保存版本×SKU 的计划总量；`ops_production_plan_slot` 保存版本×SKU×计划时段的数量。计划总量与时段量分开，避免重复汇总。）**

**（Codex 意见—生产状态：计划版本状态建议为 `draft / validated / approved / published / superseded / cancelled`；来源为 `forecast_auto / excel_upload / manual_revision`。同一门店同一业务日只能有一个当前 published 版本，但首次发布、最终发布和全部中间版本都必须保留。）**

**（Codex 意见—实际出货模型：当预估单明确填写“实际出货”时，另写 `ops_production_output/_line` 或同义执行事实，并使用 `provisional / final / corrected` 状态。不得通过改变计划版本状态表达实际数量；0 表示明确为零，空白表示未知。）**

**（Codex 意见—实际工时模型：推荐 `hr_timesheet_sync_batch` + `hr_timesheet_entry`，并固定一条 entry 为一个 `employment_id + store_id + work_date + work_area_code` 的日实际工时；来源 workbook/sheet/revision/cell 作为来源身份与幂等依据。至少保存 `actual_work_minutes`、`attendance_status_code`、`raw_cell_value`、前场/后厨或岗位、来源定位、解析规则版本和确认状态。同一雇佣关系同日跨工作区域可以有两条 entry，同一区域同日出现多条当前记录则阻止发布。若将来需要提前排班，再另建 `ops_shift_plan/_assignment`；若将来接入分段打卡，再另建 `hr_work_session`，两者都不得回写或覆盖日实际工时。）**

**（Codex 意见—实际工时口径：Lark 表是人工每日填写的“申报实际工时”来源，不等同于打卡设备产生的原始考勤事件。当前模板虽有 Prepared By/Reviewed By，但只读样例未证明每条记录已经审批，因此 entry 状态应区分 `reported / approved / corrected`。它足以计算申报实际日/月人效；若没有上下班时间、休息和审批事件，则不能据此推断迟到、早退、缺勤、班表执行率或法定 OT。）**

**（Codex 意见—工时域与权限：现有 AGENTS.md 把 `hr_` 描述为招聘域；采纳 `hr_timesheet_*` 前应把该域正式扩展为人员、雇佣关系与工时，并登记 Bakery Ops/Lark 同步为唯一写者。员工明细工时属于受限数据，`svc_readonly` 默认只读脱敏或聚合的人效视图，不应获得全员原始工时明细。）**

**（Codex 意见—预测与缺货：`ops_forecast_run/_line` 每次运行不可变并记录模型/规则版本、输入截止时间和目标日；`ops_stockout_detection_run/_result` 必须表明它是算法推断、含置信度和估算值，不能包装成真实观察到的缺货事件。）**

**（Codex 意见—分析层：同意 mart 最后建设，但不要把预测、计划、实际出货、销售、报废、缺货和工时强塞进一个“万能事实”。至少拆为预测准确率、计划调整、生产执行、产销报废、缺货影响、实际人效等语义视图，并先统一到门店×日期×SKU或门店×日期×岗位的正确粒度。）**

**（Codex 意见—非分析表：消息队列、发送尝试、认证 token、审计日志、招聘工作流、上传状态和审批记录继续作为运营表，不强行进入星型层。星型层只暴露稳定、可解释、已对账的业务指标。）**

### 11.5 对 10.5 落地路径的复核

**（Codex 意见：数据量小使重建 v2 和双轨对账更现实，但不等于全部历史都能重新抓取。必须把数据分为“可从来源重抓、只能从旧库转换、已经不可恢复”三类；RES 的历史窗口、分页与更正能力要逐项证明，HBTI 未保存的原始答案和部分人工文件不能凭空恢复。）**

**（Codex 意见：落地顺序建议调整为：① 独立发布明确的数据丢失止血；② 只读确认生产预估单实际出货使用方式及 Lark 工时字段；③ 建统一迁移 manifest、锁、备份恢复门禁和运行角色；④ 建门店、商品、人员/雇佣关系及来源映射；⑤ 上生产预估单导入与 Lark 实际工时同步；⑥ 验证稳定订单键后建设 POS v2；⑦ 建 HBTI、财务期间及成本桥；⑧ 四个消费者双读对账后切换；⑨ 最后建设 mart。）**

**（Codex 意见：旧表在每个来源完成对账和消费者退出前保留只读快照。兼容层不仅用于 `ON CONFLICT`，还可能服务 API 字段契约、普通查询和跨部署切换；有 upsert 的旧名视图仍不能承接写入，相关写者必须在同一维护窗口切换。）**

**（Codex 意见：验收条件不是“新表已创建”，而是每张核心事实都有稳定门店、业务键和来源批次；相同输入可幂等；修订可追溯；未映射门店/商品/员工会阻止发布；计划量、实际出货、实卖、报废、实际工时和财务金额绝不互相冒充；四个消费者分别对账通过。）**

### 11.6 对 10.6 决策点的逐项复核

**（Codex 意见—决策 1A 生产预估单：确认保留每日生产预估单上传入口，但“上传即 actual”不成立。上传产生一个来源版本；批准/发布产生当前计划；只有实际出货列被明确填写才产生执行事实。预测模型未来应先生成 draft，达到准确率和审批要求后才允许自动发布。）**

**（Codex 意见—决策 1B 实际工时：用户已经拍板使用 Lark 月度实际工时在线表，每日填写、每日读取；后厨与前场两本实表也已完成只读结构核验。首期不是再上传一份班表 Excel，而是把员工×日期的混合单元格标准化为可追溯的日工时与状态，并以申报实际工时计算日/月人效。若未来需要计划排班，则另开独立业务对象。）**

**（Codex 意见—决策 1C 重复与修订：相同文件 hash 或相同 Lark 来源版本重读应幂等返回原批次；内容变化创建新版本，绝不物理覆盖旧版本。同日修订和跨日迟报都应允许，但必须记录修订人、时间、原因和被替代版本；真正锁定应由业务日/工资期间关闭规则控制，而不是简单“跨天只读”。）**

**（Codex 意见—决策 2 账单链：不能直接认定已验证可行，也不是约 30 个“分页请求”；当前是约 30 个按日单页请求，没有完整分页和 total 守卫。准入条件应是稳定 order/check ID、退款/取消不丢、分页不截断、按门店和日对平金额与单数、失败批次不覆盖上一批完整数据。正常夜间任务应抓增量与近期修订窗口，不必每天重抓完整 30 天。）**

**（Codex 意见—决策 3 门店主键：同意现在建立 `store_id` 和外部身份映射。先完成 Pavilion 在 RES、财务、Ops 和 Lark 中的来源身份确认，再允许新事实发布；未来第二家店只需新增映射和配置，不再修改事实唯一键。）**

**（Codex 意见—决策 4 财务期间：目标模型应包含 period close，因为没有关闭状态就无法形成稳定管理报表。需要另行确认的是关闭责任人、何时允许重开、跨期调整方式和实际工时/工资期间的关闭关系，而不是是否需要这个能力本身。）**

**（Codex 意见—决策 5 文档归一：同意最终形成一份 v3 企业目标模型，但按用户本轮要求，当前只保留 Claude、此前 Codex 和 Kimi 原文并追加本节批注，不覆盖或删改原方案。v3 应在剩余来源字段和业务状态确认后另建，旧方案归档为决策历史。）**

**（Codex 意见—Kimi 一句话结论：应改为“先统一门店、商品和员工/雇佣关系身份，再接生产预估单版本与 Lark 实际工时同步；同时把实际出货与计划分开；完成来源对账后再建设销售明细与 mart”。这比直接先建 `ops_production_plan` 和 `hr_shift_schedule` 两张平表更符合实际业务，也不会制造新的名称键和覆盖式历史。）**

### 11.7 Codex 推荐的企业数据库落地结论

**（Codex 意见：最终推荐方案是“单库、域前缀、分域单写、规范化核心、mart 后置”。它既不受现有 105 张表束缚，也不为当前不存在的库存、考勤打卡、总账或数据平台需求预建大量空结构。）**

**（Codex 意见：第一优先级是身份与来源：真实门店、企业 SKU、来源商品、人员、雇佣关系、Lark 身份、RES 身份、财务门店身份及各域批次。没有这些稳定键，生产预估、实际工时、成本、POS 与人效仍会靠名称拼接。）**

**（Codex 意见：第二优先级是两个已明确的业务入口：生产预估单采用上传批次+不可变计划版本+商品/时段明细+独立实际出货事实；Lark 实际工时采用同步批次+员工日工时明细+来源修订轨迹。两条链均先完成校验预览，再发布到核心表。）**

**（Codex 意见：第三优先级是 POS v2、HBTI 历史/奖励流水、财务期间和成本映射；这些对象分别由自己的写者维护，通过门店、商品、会员及来源身份连接，不再共享无边界写权限或依赖名称 JOIN。）**

**（Codex 意见：最后才建设管理分析层。届时可以可靠回答：预测与最终计划差多少、计划与实际出货差多少、实际出货中卖掉/报废多少、哪些缺货是算法估算、每店每天实际投入多少工时、前后厨实际人效及人工成本率是多少。任何来源缺失时都显示未知或估算，不把缺失数据洗成权威事实。）**

### 11.8 对 Claude《HOT CRUSH 星型模型目标结构图》的复核

**（Codex 意见—总体方向：架构图提出“一个生产 PostgreSQL、运营核心与 mart 分层、共享日期/门店维度、分析消费者只读”的方向是对的，适合作为早期分析层草图；但它不能直接作为本轮企业数据库的最终目标模型。）**

**（Codex 意见—核心层是否重构：图中“public 运营表不重构、mart 只做薄视图”的原则不适合当前业务。现表存在门店键缺失、名称关联、覆盖式更新、不同实体混表和来源身份不稳定等问题；如果核心层不建立 v2，mart 只会把这些缺陷换一层名称继续暴露。）**

**（Codex 意见—四个统一键：图中的 `item_key / date / member_id / store_key` 不足以支撑企业模型。还需要来源系统外部身份、批次/运行/版本键、稳定订单键、人员与雇佣关系键，以及实际工时的工作区域/来源流；这些键分别解决可追溯、幂等、修订和跨来源映射，不能由四个分析维度替代。）**

**（Codex 意见—门店键时机：不同意“第二家店再携带 `store_key`”。所有具有门店范围的销售、生产、预测、工时、成本和财务事实从 v2 起就必须携带稳定 `store_id`，否则 Pavilion 的无门店历史会在扩店时变成无法可靠回填的歧义数据。现有 `ops_store` 还混有非门店组织，必须先清理经营门店与组织单位边界。）**

**（Codex 意见—固定 4 维 9 事实：维度和事实数量不应先固定再要求业务迁就。生产预估单的不可变版本、独立实际出货、Lark 日实际工时、来源批次和修订历史都是已经存在的业务对象，必须先在规范化核心层表达；最终 mart 有多少维度和事实，应在指标粒度与对账规则确定后自然形成。）**

**（Codex 意见—业务闭环：图中的“销售星型+会员星型”覆盖了两个分析主题，却遗漏本轮最关键的生产与用工闭环。最终架构至少要能沿稳定键连接预测→批准计划→实际出货→实卖/报废/缺货估算，以及申报实际工时→门店/岗位人效→经财务确认的人工成本；不同事实保持各自粒度，不能合成万能宽表。）**

**（Codex 意见—商品维度：`dim_product` 不能只通过 `item_key` 直接把 `pos_product` 与 `product` 拼在一起。RES 商品、企业 SKU、排产名称、成本卡成品、半成品和原料是不同实体；应使用带来源、有效期、确认状态和映射依据的身份桥，未匹配项进入人工确认队列，禁止用中英文名称自动猜配。）**

**（Codex 意见—会员键：当前来源中的 `member_id` 应视为受 RES 门店/租户和来源系统约束的外部身份，不能直接宣称为跨门店企业会员主键。企业人员/会员实体与 `pos_member_external_identity` 应分开；扩店前验证同一自然人跨店是否共用 ID、合并规则和隐私权限。）**

**（Codex 意见—事实语义：图中把当前 forecast、stockout 和 HBTI 状态投影成分析事实时会丢失历史语义。预测每次运行必须不可变；缺货检测必须标为算法推断而非真实事件；HBTI 需要 completion 与 reward ledger 保留每次完成和奖励历史，不能只投影会员表上的最新状态。）**

**（Codex 意见—财务与成本：同意财务、成本卡和账号表继续由财务网站拥有写权限，但“排除出 mart”不应理解为不能进入管理分析。经财务关闭与对账的成本/人工/收入指标应通过统一门店、商品和期间维度进入受控 mart；写入所有权与分析可见性是两件事。）**

**（Codex 意见—修订后的数据流：更合适的目标流是“RES、生产预估单、Lark 实际工时、HBTI、财务/成本等来源→各域同步或导入批次→带稳定身份和不可变版本的规范化核心→经对账发布的主题 mart→网站、Bot、报表和 AI 只读消费者”。来源文件、解析错误和未映射项停留在本域隔离区，不能直接进入权威事实。）**

**（Codex 意见—架构图定位：建议保留 Claude 图作为 2026-08-03 的分析层初稿并附上本节批注，不覆盖其原图；后续 v3 图应以规范化核心、来源批次、身份映射、生产/工时闭环和权限边界为主干，再把销售、会员、生产、人效和财务 mart 画成下游投影。）**
