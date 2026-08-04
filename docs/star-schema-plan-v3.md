# HOT CRUSH 数据建模方案 v3(三方收敛最终版)

> 2026-08-03。本文是 Claude(v2 §1–9)、Kimi(§10)、Codex(§11)三轮讨论后的**唯一执行版本**。
> `star-schema-plan.md`(v2 + 两家批注)保留为决策历史,不再执行。
>
> **收敛状态**:五个待决问题三方一致(Kimi 全部同意;Codex 对 Q1/Q5 修正后同意,修正已采纳)。
> 所有事实基线来自 2026-08-03 对生产库的只读实测,不引用历史采样。

---

## 一、判断

**适合星型建模,不适合独立数仓** —— 这条 v2 的结论三方无异议,保留。

但 v2 有一个被 Kimi 正确指出的根本缺陷:它以「现状为地基、只在上面铺视图」为原则,
于是漏掉了这门生意的核心闭环。实测确认:

```
预测 ✅ → 排产计划 ❌ → 实际出货 ❌ → 销售 ✅ → 报废/断货 ✅ → 用工 ❌
```

`to_regclass` 对 `ops_production_plan` / `hr_shift_schedule` / `hr_timesheet_entry` /
`pos_sales_bill` **四张全部返回 NULL**。`forecast_snapshot` 是覆盖式(1,698 行/39 天,
`ON CONFLICT DO UPDATE`),没有运行历史。

**v3 的立场**:核心层要补齐生产与用工两条链(Kimi 对);但补的方式必须区分计划与实际、
不得用登录身份冒充员工身份、不得把未证实的粒度命名成权威事实(Codex 对)。

---

## 二、三方分歧的实测裁决

| 争议 | 实测(2026-08-03 生产库) | 裁决 |
|---|---|---|
| `item_hourly_sales.item_key` 覆盖率 | 81,168 行中 78,871 行有键 = **97.17% 行 / 96.98% 金额** | **Codex 对**。Kimi 已撤回「2.6%」。推论也随之改变:POS 事实与商品主数据的连接**已经是好的**,剩余 2,297 行是残留治理项,不是结构性断裂 |
| `cost_card_product_link` | **已存在,94 行,来源全部 `mysql:v_product_direct`** | **Codex 对**。扩展现有表(补来源列、覆盖非 direct 商品),**禁止新建同名表** |
| `ops_store` 是否纯门店 | 2 行:`pavilion` + **`海外项目组`** | **Codex 对**。这正是最小身份键第一步要清的脏数据 |
| 生产/班表/工时/账单四表 | **`to_regclass` 全部 NULL** | **Kimi 对**,业务闭环确实断裂 |
| `forecast_snapshot` | 1,698 行/39 天,覆盖式,无运行历史 | **Kimi 对** |
| HBTI 原始答案 | `HbtiCompletionSnapshot` 仅 6 字段,**13 题答案不落库** | **Kimi 对** |
| 换 campaignVersion 的后果 | `ON CONFLICT DO UPDATE SET`(12 列)`WHERE … campaign_version IS DISTINCT FROM $1` | **Kimi 对,且紧迫** —— 见 P0 |
| 账单级粒度是否已验证 | `openedTime` 时间桶 ≠ 账单:26,683 桶含 26,741 张,**57 桶多单** | **Codex 对**。不得据此命名 `pos_sales_bill`,POS 订单级另立项 |

**Claude 自我更正**:我在上一轮曾建议用户「正式开跑前改 `HBTI_CAMPAIGN_VERSION` 放开所有人重玩」。
实测证明该操作会**逐行覆盖上期全部 12 个 hbti_ 列**,销毁测试期完成记录。该建议作废,
被本文 P0 取代。

---

## 三、硬规则(三方一致,写死不可协商)

**规则 1 · 每步独立,双写不得跨窗口**(Q1,采纳 Codex 修正)
- 每一步必须**独立验收**,且具备**已验证过的**回退或前滚恢复路径 —— 「理论上能回滚」不算。
- 默认**禁止**双写跨维护窗口。确需跨窗时:**旧链保持唯一权威**,新链只做**影子写/单向复制**,
  并具备时限、幂等、自动对账三项。
- 对账失败时**熔断新链并停止切换**,不是只停下一步。
- 熔断必须**向 Lark 群发消息**(复用现有 bot 通道)—— 这个环境 `res_api/.env` 没配
  `ALERT_WEBHOOK`,不发消息的话「熔断」本身也没人知道(Kimi 补充)。

**规则 2 · 对账是门禁,不是阶段**(采纳 Codex)
双轨对账不是流程里的第 N 步,而是**每一次切换的准入门**。对账机制(`recon_check` 表 +
断言集)作为止血阶段的一部分先建好,此后每次切换都必须过它。

**规则 3 · 最小身份键必须不可变、只追加**(采纳 Kimi)
门店与员工的映射行**只追加、不改键**,第一天就用不可变代理键。
否则「随后演进」会退化成「重新洗键」,那比一次建完整体系更糟。

**规则 4 · 最小集不猜填**(采纳 Codex)
最小身份集必须**覆盖试点批次的全部引用**;未映射记录**隔离进队列由人确认**,
禁止按中英文名称自动猜配。

**规则 5 · 活动期内 `pos_member.hbti_*` 列结构冻结**
`pos_member` 是全库唯一列级双写表(res_api 写 26 列 / hbti-web 写 8 个 hbti_ 列,
靠列集不相交共存)。HBTI 活动正在跑,历史留存用**新增追加表**解决,
不通过重构会员主表解决。

---

## 四、执行顺序(三方一致)

```
P0 HBTI 止损  →  P1 止血  →  P2 最小身份键  →  P3 生产上传链
                                              →  P4 Lark 工时链  →  P5 mart
                          ↑ 每次切换都必须过对账门禁(规则 2)
```

### P0 · HBTI 止损(**最高优先级,排在止血之前**)

理由(Kimi,三方同意):止血类工作可以等维护窗口,**这个活动正在跑**,
每多一天不快照,换版本时的损失就多一天。

1. 建追加式 `mkt_campaign_response`(`campaign_version` + `member_id` + 原始答案 jsonb +
   计分版本 + 结果 + 幂等键 + 发奖结果),**append-only,永不覆盖**。
2. 把现有 6 条完成记录的 hbti_ 列**快照进去并校验读回**。
   现有 6 条的 13 题原始答案**无法恢复**,必须**显式标记为不可恢复**,
   **不得推造**(Codex)。
3. **hbti-web 在完成写入处直接双写这张表**(Kimi)—— 一次性快照脚本只救这一次,
   双写才能让「换版本销毁历史」这个雷以后不存在。
4. 写入顺序固定为:**先成功追加 version/答案/结果/幂等键 → 再更新 `pos_member` 兼容投影 → 再发券**(Codex)。
5. **读回与对账通过之前,禁止更换 `HBTI_CAMPAIGN_VERSION`**(Codex)。

### P1 · 止血(纯代码 + 最小治理,不动业务模型)

**代码止血**(全部来自 v2 §四批 A,file:line 已核实,三方无异议):
- `res_api/scrape-intraday.mjs` **三处**改动:`:103` 去重键从显示名换成稳定键
  (`id = r.D_itemName`,对齐 `sync-to-db.js:219`)、`:106` batch 补 `item_key`、
  `:114` INSERT 列清单补 `'item_key'`。只加列不改去重键,同名商品照样丢数据。
- `bakery-ops/src/modules/shared/db/postgres.ts:15` 钉住 date 解析
  (`types: { date: { to: 1082, from: [1082], serialize: v=>v, parse: v=>v } }`)——
  一处改动让 12 处 JS 日期用法透明,并顺带修好两个**现存**的暗 bug
  (Lark 追问与周报把日期显示成 `Mon Jul 21 …`)。
- 修 8 处转型后会硬报错的 SQL(`holiday.repository.ts:47,51`、
  `ai-correction.repository.ts:27`、`app/api/ai-correction/route.ts:25-28`、
  `forecast-calc.repository.ts:217`)。
- `res_api/sync-to-db.js:399` 兜底从 `|| r.reason` 改成 `|| 'other'` + warn。

**治理止血**(Codex 要求纳入止血,三方同意):
- 失败日志与**可见告警**(Lark webhook)—— 这是规则 1 熔断能被感知的前提。
- 迁移编号**锁**(advisory lock + 文件名↔登记一致性断言 + 拒绝执行未登记文件)。
  这比争论「从 102 起」还是「全局 ID 体系」更对症 —— 问题是抢占没有锁。
- **禁止破坏性 `TRUNCATE`**(`timeslot_sales_record` 三写入点互相 TRUNCATE 是已发生事故)。
- 固定提交构建物 + 恢复验证(`deploy.sh` 从工作树 rsync 不经过 git,工作区不干净就上生产)。
- 建 `recon_check` 表与断言集(规则 2 的载体),断言至少包含:
  三口径日营收对账、`item_key` 空值率、`dim_*` 无孤儿事实行、断货表无重复。
  **`item_key` 残留 2,297 行监控必须在内**(Kimi)—— 97% 不再是阻塞项,
  但那 3% 会随新数据持续产生,没有对账盯着就会悄悄恶化。

**DDL 止血**(v2 迁移 102–105,内容不变,顺序服从规则 1):
- 102:`item_hourly_sales` 唯一约束迁到 `(date, hour, item_key)`,`NULLS DISTINCT` 包容历史歧义。
  **前置**:P1 的盘中补键已上线 + `_backfill-item-key.mjs --apply` 已跑
  (须先摘掉脚本里的 `daily_sales_record` 条目 —— 它已是视图)。
- 103:六张表 varchar 日期转 date。**必须用 `ALTER COLUMN … TYPE`**,保留
  `uk_daily_revenue_date` 约束名(三仓四处硬编码 `ON CONFLICT ON CONSTRAINT`)。
- 104:`waste_reason` 归一 + CHECK。取值域**必须是 `{scheduling, tasting, production, gift, other}`**——
  res_api 的 `REASON_MAP` 把 `abnormal loss` 写成 `production`,少这个值今晚同步就撞约束。
- 105:`out_of_stock_record` 去重 + `UNIQUE(date, product_name)`,写入改 `ON CONFLICT DO NOTHING`,
  删掉 `stockout-detector.service.ts:341-349` 的非原子 read-then-filter。

### P2 · 最小身份键(不是完整 identity 体系)

只做两件事,遵守规则 3(不可变代理键、只追加)与规则 4(不猜填、未映射隔离):
- `core_store` + 门店来源身份映射:清掉 `海外项目组`(它是组织不是门店),
  把 RES shopId / `finance_store` 中文全名 / `ops_store.store_code` 三套写法收进映射。
- `hr_employment` + 员工来源身份映射:**工时必须挂稳定 `hr_employment_id`,
  不得直接连 `staff`**(`staff` 是 Lark/WhatsApp 登录与通知身份,不是员工主数据;
  实测 `staff JOIN employees ON name` 匹配 0 行)。`staff` 只配做 `synced_by`/`approved_by`。

**不做**:完整 `core_product` 平铺(RES 商品/企业 SKU/排产名/成本卡成品/半成品/原料是不同实体,
必须靠带来源与有效期的映射桥连接);完整 identity 体系(投机性泛化)。

### P3 · 生产上传链

- `ops_import_batch`(文件 SHA-256、原名、模板版本、门店、业务日、上传人、行数、
  错误行、未映射行、解析器版本)。解析失败或商品未映射时**整批不发布**。
- `ops_production_plan`(门店×生产日的稳定业务头)
  / `_version`(每次上传或修订,**不可变**,`source` ∈ `excel_upload`/`forecast_auto`/`manual_revision`,
  `status` ∈ `draft`/`validated`/`approved`/`published`/`superseded`/`cancelled`)
  / `_line`(版本×SKU 计划总量)/ `_slot`(版本×SKU×时段量)。
  同门店同业务日只能有一个当前 `published`,但**首次、最终、全部中间版本都保留**。
- **`ops_production_output/_line` 独立事实**(Codex 关键更正,Kimi 已接受):
  「confirmed 版本即实际生产记录」**不成立** —— 那会把估算值洗成权威值。
  只有来源明确填写「实际出货」时才产生执行事实;**空白存 `NULL`(未知),0 存 0(明确为零)**,
  二者绝不合并。字段命名忠于来源用 **`actual_dispatched_qty`** ——
  后厨实际烤的、出给前场的、POS 卖掉的、报废的,是四个不同的量。

### P4 · Lark 工时链

用户已拍板:权威来源是 **Lark 月度实际工时在线表**(每天填写、每天读取),
**不是** Excel 班表上传(Kimi 原 §10.6 的 `hr_shift_schedule` 作废)。

- `hr_timesheet_sync_batch`(spreadsheet token、月度 sheet ID、document revision、
  同步时间、批次状态)。相同 revision 重读**必须幂等**。
- `hr_timesheet_entry`,粒度固定为
  **`employment_id + store_id + work_date + work_area_code`**
  (前场/后厨是两条独立来源流,同一员工同日可跨区,唯一键不能只有员工×门店×日期;
  同一区域同日多条当前记录**阻止发布**)。
- 必存 `raw_cell_value` —— 单元格里混着数字、空白、0、大小写不一的 off、病假/无薪假/补假。
  **空白 = 未填(未知),数字 0 = 明确零小时**,不得合并。
- 月份靠 **sheet 名 `YYYY-MM` + 表头 Year/Month 双重校验**发现,
  **不得用 tab index 推断**(两本工作簿的月份 sheet 排列顺序不一致)。
- Total/Required/Variance 三列只作**来源校验值与异常提示**,不作事实
  (它们是 `SUM` 派生值,会忽略文字状态;前场 2026-07 已出现手工 Required 与
  标准工时×工作日不一致)。
- 休息时间未证明是否已扣除 → 首期忠实保存 `reported_hours`,
  指标命名为**「申报工时人效」**,不反推上下班,不包装成净工作时长。
- 员工键:两表目前只有 No./Name/Position,**No. 跨月不构成身份**。
  上线前必须建「工作簿/部门+原姓名 → `hr_employment_id`」的**人工确认映射**与未匹配队列,
  禁止按相似姓名静默归并。(对源表最值得提的改进:加一列稳定 Employee ID。)
- 门店键:表头无 store code → 同步配置**显式登记**「spreadsheet token → store_id + work_area」,
  不得因为现在只有 Pavilion 就硬编码。

### P5 · mart(最后建)

**维度与事实的数量由核心层粒度决定,不预先钉死**(三方一致,v2 图的「4 维 9 事实」
是当时已有事实表的投影,不是对未来的约束)。生产与工时链接入后,
`dim_employment` / `fct_production_output` / `fct_timesheet` 自然长出。

- 拆成语义视图,**不做万能宽表**:预测准确率 / 计划调整 / 生产执行 / 产销报废 /
  缺货影响 / 申报人效,各自保持正确粒度。
- `ops_plan_vs_actual`(原 `forecast_vs_actual`):**在拿到实际出货那一列之前不要建** ——
  建了就是把估算值洗成权威值。
- `fct_stockout` 必须标明是**算法推断**、含置信度,不能包装成真实观察到的缺货事件。
- `fct_forecast` 每次运行不可变,记录模型/规则版本与输入截止时间。
- mart 只做**已对账来源**的只读派生层。
- 财务/成本**写入所有权**仍归财务站,但这不等于排除出管理分析 ——
  经财务关闭与对账的指标可通过统一门店/商品/期间维度进入受控 mart(Codex 更正,采纳)。

---

## 五、明确另立项(已确认需要,但不进 v3 时间线)

| 项目 | 理由 |
|---|---|
| **角色/RLS 治理**(6 角色 + 应用身份切换) | Codex 自己指出现有应用依赖 `postgres` 的 BYPASSRLS,切换是**四个应用可能同时失效**型风险,而环境无 staging、无告警。与数据模型**零耦合**:新表建完不切也照跑。单独立项、单独窗口、单独回滚预案。v3 只保留新表所需的最小授权与审计字段 |
| **POS 订单/订单行级** | 账单级未被证明(57 桶多单)。准入条件:稳定 order/check ID、退款不丢、分页不截断、按门店与业务日对平金额与单数、失败批次不覆盖上批 |
| **财务期间关闭** | 能力需要,但关闭责任人、重开条件、跨期调整方式是业务规则,不是技术决定 |
| **供应链事实** | 权威来源当前在 WMS + 在线文档;本库先只保留供应商/物料/成本映射。**不是「已死」,是边界外** |
| **招聘漏斗分析** | Lark 是主数据源,DB 是镜像。需要漏斗分析时补追加式 `hr_stage_event` |

---

## 六、跨仓库硬契约(v2 §三,三方无异议,原样保留)

1. **`uk_daily_revenue_date` 约束名是硬编码契约** —— 三仓四处 `ON CONFLICT ON CONSTRAINT`。
   转型只能 `ALTER COLUMN … TYPE`,绝不 drop/recreate。
2. **`daily_sales_record` / `timeslot_sales_record` 视图定义权在财务站仓库**,
   且设了 `security_invoker=true`;重建必须补回,否则财务站 db-integration 门禁会红。
3. **`pos_member` 列级双写** —— 见规则 5。
4. **`waste_reason` 取值域由 res_api 的 `REASON_MAP` 决定** —— 含 `production`。
5. **迁移编号四仓共用且有冲突史** —— 解法是锁,不是约定新起点(P1)。
6. **`deploy.sh` 从工作树 rsync,不经过 git,且排除 `_*`** ——
   工作区不干净就是半成品上生产;`_backfill-item-key.mjs` 永远同步不到服务器,
   必须在 Mac 本地对生产库执行。
7. **失败当晚无人知道** —— 没配 `ALERT_WEBHOOK`。这是 P1 治理止血的第一项。

---

## 七、验收标准(Codex 提出,三方同意)

验收不是「新表已创建」,而是每张核心事实同时满足:

- 有稳定门店、业务键、来源批次;
- 相同输入**幂等**;
- 修订**可追溯**;
- 未映射的门店/商品/员工**阻止发布**;
- **计划量、实际出货、实卖、报废、申报工时、财务金额绝不互相冒充**;
- 四个消费者分别对账通过。

---

## 八、一页总结

**判断**:适合星型建模,不适合独立数仓 —— 但核心层必须先补齐生产与用工闭环,
mart 是这之后的一层薄投影。

**顺序**:P0 HBTI 止损(活动正在跑,最急)→ P1 止血(代码 + 治理 + DDL)→
P2 最小身份键(不可变、只追加、不猜填)→ P3 生产上传链(计划与实际分开)→
P4 Lark 工时链(申报工时,非打卡)→ P5 mart(粒度由核心层决定)。

**贯穿**:每步独立可回滚;双写不跨窗口,必须跨时旧链保持唯一权威、新链只影子写;
对账是每次切换的门禁,失败熔断新链并发 Lark 消息。

**边界**:角色/RLS、POS 订单级、财务期间关闭、供应链、招聘漏斗 —— 已确认需要,另立项。

**三方状态**:Claude 承认 v2 漏掉业务闭环;Kimi 撤回三条陈旧数据;
Codex 的计划≠实际、身份≠登录、账单级未证实三条更正被全体采纳。**无未决分歧。**
