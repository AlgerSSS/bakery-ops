# HOT CRUSH R6A1 多国家汇率与成本基座评审

> 修订：`R6A1-FX-SIGNED-POS` / `HOTCRUSH-CORE-V1-R6A1-OVERLAY-CONTRACT-v3`<br>
> 评审日期：2026-08-11（Asia/Kuala_Lumpur）<br>
> 状态：`DESIGN_ONLY_NOT_COMPILED` / `NOT_APPLY_COMPATIBLE` / `PHYSICAL_BACKFILL_NOT_STARTED`<br>
> 本文范围：原币价格事实、地点经营币、会计主体功能币、直接币种对汇率、`MATERIAL_COST` 采用关系，以及 RES 缺失值与退款符号边界<br>
> 本文不代表：已生成或应用 R6A1 DDL、已创建 SQL 视图、已读取或回填生产数据、已选择汇率提供方、已完成应用切换，或已治理全库所有币种字段

## 结论

R6A1 已在**设计层**关闭一条最小且可追溯的多币种原料成本链，但它只承诺 `MATERIAL_COST` 的**直接币种对**基座，不能宣称已经完成多国家财务、集团列报或全库币种治理。

冻结设计有且只有以下五张货币与会计核心表：

1. `app_currency`
2. `finance_accounting_entity`，统一表示 `LEGAL_ENTITY | BRANCH`
3. `finance_currency_assignment`
4. `finance_fx_rate_observation`
5. `finance_currency_policy`

旧“四表方案”、`finance_legal_entity`、Phase 1 `104` 表 / `1,450` 字段候选，以及把 `GROUP_PRESENTATION` 放进当前政策表的方案均已被 R6A1 取代。当前批准作用域只有：

| 能力 | R6A1 结论 |
|---|---|
| 地点经营币 | 批准 `LOCATION / OPERATING` 的有效期指定 |
| 会计主体功能币 | 批准 `ACCOUNTING_ENTITY / FUNCTIONAL` 的有效期指定 |
| 原料成本换算 | 只批准 `MATERIAL_COST`、同一来源币到目标币的直接币种对 |
| 会计主体类型 | 只批准 `LEGAL_ENTITY | BRANCH`；分支的 parent 是法定承载主体，不是集团关系 |
| 集团列报 | `GROUP`、`PRESENTATION`、`ENTITY_PRESENTATION` 全部延期 |
| 地点归属会计主体 | 有效期关系延期；不得在 `ops_location` 写一个“当前主体”冒充历史 |
| 到岸、税务、预算、海关、合并换算 | 不在本次承诺内 |

## 前提纠正

- **R6A1 不是 100 表上再加四表。** 冻结 Phase 1 设计是 `105` 表 / `1,469` 字段；`104` / `1,450` 只是已废弃的中间候选，不能继续用于设计、DDL 或验收。
- **法律实体不是唯一会计作用域。** `finance_accounting_entity` 是 `LEGAL_ENTITY | BRANCH` 超类型；旧名 `finance_legal_entity` 会排除可独立拥有功能币的分支，因此不再创建。
- **币种指定与换算政策不是一回事。** `finance_currency_assignment` 回答“某地点的经营币或某会计主体的功能币在何时是什么”；`finance_currency_policy` 回答“某原币按哪一种直接汇率规则换到该指定币种”。两者不能合并。
- **NULL 作用域不是集团默认。** 当前模型没有集团身份、集团列报范围或实体列报币粒度，不能用 NULL、特殊 UUID 或伪造主体代替。
- **设计计数不是部署结果。** 当前 Green 中已经应用的仍是旧 Phase 1 空结构；R6A1 尚无可应用 SQL payload、约束触发器目录捕获或已编译视图 SELECT。
- **多币种成本基座不等于全库币种治理。** R6A1 修正了受影响的结构化金额字段和成本链，但仍有自由文本及 JSON 内币种债务，见本文末尾。

## 旧库只读证据与证据边界

### 价格与汇率事实

2026-08-11 的旧生产库只读核验给出以下时点证据：

| 检查项 | 只读结果 | 结论边界 |
|---|---:|---|
| `cost_card_item_price` | 344 行 | 这是当时的旧价格事实规模，不是未来迁移 golden |
| 原始币种 | 344 / 344 为 `MYR` | 只验证现有 MYR 路径，不能证明外币路径可用 |
| `exchange_rate_id` | 0 / 344 非空 | 当前 344 行没有运行中的 FX 引用链 |
| `normalized_price_myr` | 344 / 344 非空 | 旧库保存了 MYR 归一结果；该结果不迁为新事实 |
| 当前简单公式重算 | 344 / 344 一致 | 只覆盖当时的 `price_quantity=1`、g→g、MYR 场景 |

因此，现有证据不支持把历史上约 `×1.7` 的成本偏差解释为汇率换算：当前价格全为 MYR，且没有任何 FX 引用。历史审计把最强疑点指向配方投料数量或版本链污染，而不是汇率被乘了 1.7；但最终根因仍须由最新 S0 与配方重建逐组件核验，本文不把该诊断写成已完成证明。R6A1 必须保留这两个问题的粒度分离：价格与汇率链不能用来“修”错误的配方数量，配方重建也不能反向覆盖价格观察。

### 本文可证明与不能证明的事项

- 本文引用的是冻结 R6A1 overlay、编译器断言、仓库内审计收据和上述只读结果摘要；**本文没有直接读取任何 Claude 对话，也不把对话中的完成状态当作数据库证据**。
- 344 / 344 与 0 / 344 是一次只读时点核验，不证明之后旧库没有新增或修改行；真实迁移必须以最新获准 S0 守恒清单重新计数。
- 仓库中的 RAW capture 收据只证明一次加密、只读源捕获；它明确不是 S0、路由账本、目标回填、catch-up 或 cutover。
- 当前没有批准任何实际 FX provider。Bank Negara Malaysia 只能作为未来候选来源示例，不能据此写默认来源或模拟 live rate。
- 当前 Green 的 100 表空结构验收只证明旧 Phase 1 catalog；它不证明本文的 105 表 R6A1 设计已经编译或应用。
- R6A1 delivery gate 明确为 `source_reads_allowed=false`、`database_writes_allowed=false`、`production_data_gate=BLOCKED`；本文引用历史只读证据不等于授权新一轮源读取或目标写入。

## 五张核心表的冻结语义

### 1. `app_currency`：币种身份

一行代表一个获准使用的 ISO 4217 三字母币种代码。`currency_code char(3)` 是主键；数字代码可空但唯一，`minor_unit` 只描述标准常用小数位，不充当具体业务舍入政策。

硬边界：

- 币种不得从地点国家、历史 MYR 默认、供应商常用报价币或自由文本推断。
- `ACTIVE` 才能进入新事实；`RETIRED` 仍保留历史身份。
- `standard_source_ref` 必须显式指向采用的标准版本或证据，不得存密钥。
- 表本身不保存汇率、经营币、功能币或舍入规则。

### 2. `finance_accounting_entity`：会计主体超类型

一行代表一个稳定的 `LEGAL_ENTITY` 或 `BRANCH` 身份。`accounting_entity_id` 是稳定主键，`entity_code` 是跨版本业务键；名称、登记号和国家都不是连接键。

硬边界：

- `LEGAL_ENTITY` 的 `parent_accounting_entity_id` 必须为空。
- `BRANCH` 必须指向真实 `LEGAL_ENTITY`；parent 只表示分支的法定承载主体，绝不表示集团母子关系。
- `ACTIVE` 需要非空证据与核验事实；法律实体还必须有登记号。没有权威证据不得伪造默认主体。
- 未来约束触发器必须拒绝 parent 环、非法律实体 parent、失效 parent，并冻结 ACTIVE 后的 kind、parent 与身份字段；这些触发器尚未编译。

### 3. `finance_currency_assignment`：有效期币种指定

一行代表“作用域身份 × 币种角色 × 有效区间 × 版本”。它只允许两种互斥组合：

```text
LOCATION          + OPERATING  + location_id          + accounting_entity_id IS NULL
ACCOUNTING_ENTITY + FUNCTIONAL + accounting_entity_id + location_id IS NULL
```

硬边界：

- `currency_code` 显式引用 `app_currency`，没有 MYR 或其他币种默认。
- `APPROVED | RETIRED` 行必须有批准用户、批准时间和非空证据。
- 同一作用域、角色的获批/退役有效区间不得重叠；排斥约束要求 `DEFERRABLE INITIALLY IMMEDIATE`。
- `ops_location` 不再保存 current/default currency，避免与本表形成两个真源。
- 不允许 `GROUP` scope、`PRESENTATION` role、空 scope 或“集团默认币种”。

### 4. `finance_fx_rate_observation`：不可变直接汇率观察

一行代表“来源系统 × 稳定来源记录 × 修订前驱”的一次**直接方向**汇率观察。方向固定为：

```text
to_amount = from_amount × rate
```

硬边界：

- `from_currency_code <> to_currency_code`；同币种不创建 1:1 FX 行。
- R6A1 只允许 `SPOT | DAILY_CLOSE` 与 `MID | BID | ASK | OFFICIAL_REFERENCE`。
- 原始载荷以 lowercase SHA-256 和加密载荷引用固定；引用不得包含秘密本身。
- 已写入的核心观察不可原地改写。来源更正必须追加新行，并用 `supersedes_fx_rate_observation_id` 指向被替代的当前终态行。
- NULLS NOT DISTINCT 幂等键阻止同一来源记录/前驱分叉；未来触发器还必须验证同 source/record、无环、解释合同版本递增及自动任务审计来源。
- 只有 `VERIFIED` 观察可以进入正式成本选择；“抓取到了”不等于“获准使用”。

### 5. `finance_currency_policy`：直接币种对选择与舍入政策

一行代表“目标币种指定 × 原币种 × `MATERIAL_COST` × 有效区间 × 版本”。政策通过复合外键同时钉住 `finance_currency_assignment` 及其目标币种，不能把 target currency 脱离 assignment 单独解释。

硬边界：

- `conversion_purpose` 当前只能是 `MATERIAL_COST`。
- 跨币种时必须显式给出直接币种对的 `rate_type`、`rate_basis`、权威 `rate_source_system_id`、最大报价年龄和 `LATEST_AT_OR_BEFORE_PRICE_OBSERVED_AT` 时点规则。
- `missing_rate_behavior` 只能是 `FAIL_CLOSED`；没有符合 provider、方向、类型、基准、时点和新鲜度的汇率就失败，不能倒数、三角换算、换源、补 1 或采用“最近随便一条”。
- 同币种政策仍保留政策与舍入版本，但全部 FX 选择参数必须为空。
- 最终舍入只允许获批的 scale 与 `HALF_UP | HALF_EVEN | DOWN`；`DOWN` 明确定义为 toward-zero。
- 同一 assignment、source currency、用途的获批/退役有效区间不得重叠；政策区间必须被 assignment 区间包含。对应触发器尚未编译。

## 原币价格到成本采用的关系链

五张核心表不是单独存在；它们与两张改造后的成本事实共同形成以下链路：

```text
scm_material_price_observation
  原币 amount + quantity + unit + observed_at + source evidence
                 │
                 ├──────────────┐
                 ▼              ▼
finance_currency_policy   finance_fx_rate_observation
  指向有效 assignment       只在跨币时选择直接 VERIFIED 观察
                 │              │
                 └──────┬───────┘
                        ▼
cost_card_material_cost_selection
  冻结 price + assignment + policy + optional FX 的采用关系
                        │
                        ▼
逻辑只读成本输出（字段合同已定，SELECT / rounding 尚未编译）
```

### 原币价格观察

`scm_supplier_price_observation` 被替换为 `scm_material_price_observation`，粒度改为“原料 × 来源稳定记录 × 修订前驱”。它必须保存：

- `raw_price_amount`、`raw_price_quantity`、原始单位文本与已解析单位；
- `transaction_currency_code`，显式引用 `app_currency` 且无默认；
- `observed_at`、来源系统、稳定来源记录、payload hash 与核验证据；
- 可空的真实 `supplier_item_id`、PO 行或收货行证据；没有证据就保持 NULL，不能伪造供应商或采购单；
- 结构化零价原因；只有 `VERIFIED + CONTRACTUAL_FREE_OF_CHARGE` 的零价才可供当前 `MATERIAL_COST / PURCHASE_PRICE_ONLY` 选择，`SOURCE_PLACEHOLDER` 只能是 `REJECTED`；
- 追加式修订链，不能覆盖原观察。

该表不再保存 `fx_rate_to_myr`、`normalized_price_myr` 或任何换汇派生金额。原币价格事实、单位换算事实和 FX 观察是三个不同粒度。

### 成本采用关系

`cost_card_material_price` 被替换为 `cost_card_material_cost_selection`，一行代表“原料 × 目标币种指定 × 生效区间”的获准采用关系。R6A1 只允许：

- `cost_basis = 'PURCHASE_PRICE_ONLY'`；
- `formula_version = 'MATERIAL_COST_V1'`；
- 复合外键钉住 price observation 的 material + source currency；
- 复合外键钉住 policy 的 assignment + source currency + target currency；
- 跨币时用复合外键钉住 FX observation 的直接 from/to pair；
- `VERIFIED` 的同一 material + assignment 区间不重叠。

选择表只保存**采用关系和审批证据**，不保存 `price_myr_per_base_unit` 或其他派生成本金额。逻辑输出将展示原币价格、单位换算、assignment、policy、FX、目标币成本、计算版本和输入 hash；但当前只有字段/血缘合同，`MATERIAL_COST_V1` 的 SQL SELECT、跨表资格触发器、汇率新鲜度和政策舍入仍未编译，因此不能把逻辑字段合同冒充可执行计算。

### 同币种与跨币种

| 场景 | Policy | Selection | FX observation |
|---|---|---|---|
| `source_currency = target_currency` | FX 参数全部为空，仍保留用途与舍入版本 | `fx_rate_observation_id IS NULL` | 不创建；计算身份关系由规则表达 |
| `source_currency <> target_currency` | 显式直接 pair、provider、type、basis、时点与最大年龄 | 正式 `VERIFIED` 必须引用符合政策的直接 FX 观察 | 必须存在且方向与 source/target 完全一致 |

R6A1 不批准倒数自动生成反向汇率、不批准经第三币种三角换算，也不批准集团列报换算。

## 配方售价字段的归档边界

`cost_card_recipe_version` 是技术配方版本，不是“地点 × 时间 × 币种”的售价事实。R6A1 从 active schema 删除：

- `reference_sale_price`
- `currency`

历史原值只允许进入**经过认证且加密的 S0**，或进入带未来 route manifest 的 authenticated migration archive。它们不得：

- 默认解释为 MYR；
- 回填到 active recipe schema；
- 参与 margin、成本率或售价比较；
- 用来推断 POS listing 的地点售价。

`RECIPE_ARCHIVE_ROUTE_MANIFEST_REQUIRED` 在完成前，任何配方价格/币种迁移都必须阻断。

## RES 缺失数据与 signed refund 规则

RES/POS 的源值必须忠实保留，不能为了满足目标非空列而“修得更整齐”。冻结规则如下：

1. **源值缺失就重新抓取原始 RES。** 需要逐行商品/冲销语义时，只能使用获批准的原始 RES Report211 replay；旧 `pos_member_order_item` 聚合表只用于 reconciliation，不能拆成伪造的 raw line。
2. **禁止猜测。** 不从商品名、净额、其他报表、地点默认值或历史平均值反推缺失源字段。
3. **禁止 `COALESCE(..., 0)`。** NULL/缺失表示尚未取得或无法证明；来源真实返回的 0 才是 0。
4. **保留符号。** `gross_quantity`、`net_quantity`、`refund_quantity`、`gross_sales`、`discount_promotion_amount`、`net_sales`、`refund_amount` 允许负数、零、正数及混合符号，不增加跨字段符号 CHECK。
5. **退款/冲销保持原始粒度。** `source_order_item_id`、`source_order_status_code` 和 `source_reversal_order_code` 共同保留来源退款与冲销语义；不能先取绝对值再另造退款，也不能把负数当坏数据过滤。
6. **当前设计不授权真实 replay。** `RAW_RES_REPORT211_REPLAY_REQUIRED` 仍是生产数据门禁；已知样本/探针计数不能替代最新原始重抓与守恒验收。

## 冻结设计计数

以下是 R6A1 resolved model 的精确**设计断言**，不是 `pg_catalog` 实拍，也不是已应用结果：

| 边界 | 精确计数 |
|---|---:|
| Phase 1 物理表 | 105 |
| Phase 1 字段 / 字段注释 | 1,469 |
| Primary Key | 105 |
| Unique Constraint | 112 |
| CHECK Constraint | 403 |
| EXCLUDE Constraint | 21 |
| Active Foreign Key | 332 |
| FK-support index | 266 |
| Catalog total index | 504 |
| 全局物理表 | 142 |
| 全局物理字段 | 1,907 |
| 逻辑视图 | 59 |
| 逻辑视图字段 | 727 |
| 全部声明字段 | 2,634 |

说明：

- 266 个 FK-support index 包含在 504 个 catalog total index 中，不能相加。
- 59 个视图目前是逻辑字段/血缘合同；R6A1 当前物理 SQL view 数仍为 0。
- 六组 DEFERRABLE constraint-trigger 合同尚未编译，也不应伪装成上述静态约束计数中的已落库触发器。
- 旧 `104` 表 / `1,450` 字段候选已经 superseded，不得再用来生成模型或验收。
- 唯一安全状态仍是 `DESIGN_ONLY_NOT_COMPILED`、`NOT_APPLY_COMPATIBLE`、`PHYSICAL_BACKFILL_NOT_STARTED`；`phase1_apply` 不能应用这个 overlay。

## 实施 DAG 与验收门禁

R6A1 后续实施必须同时关闭“结构”与“数据证据”两条支线，任一支线未完成都不能进入回填：

```text
冻结 R6A1 overlay + baseline pins
        │
        ├─ 结构支线
        │    └─ 编译新 SQL payload / manifest / release pins
        │         └─ 编译 CHECK、EXCLUDE、DEFERRABLE triggers、受控函数
        │              └─ 编译 26 个受影响视图的 SELECT specs
        │                   └─ 两个 PG17 空库独立应用并得到同一 105-table catalog
        │
        └─ 数据证据支线
             ├─ 最新 authenticated S0 守恒清单
             ├─ 原始 RES Report211 replay package
             └─ recipe price/currency archive + route manifest
                         │
            两条支线全部通过
                         ▼
币种主档 / 会计主体证据
  → currency assignment
  → 原币 material price observations + direct FX observations
  → MATERIAL_COST policies
  → material cost selections
  → 守恒、符号、单位、时点、有效区间与输入 hash 验收
  → 应用逐域 shadow read
  → 每个事实域唯一写者切换与可回滚窗口
```

最低门禁：

1. `NEW_SQL_PAYLOAD_AND_RELEASE_PINS_REQUIRED`
2. `CONSTRAINT_TRIGGER_DDL_NOT_COMPILED`
3. `AFFECTED_VIEW_SELECT_SPECS_NOT_COMPILED`
4. `LATEST_S0_CONSERVATION_REQUIRED`
5. `RAW_RES_REPORT211_REPLAY_REQUIRED`
6. `RECIPE_ARCHIVE_ROUTE_MANIFEST_REQUIRED`
7. `LOCATION_ACCOUNTING_ENTITY_EFFECTIVE_RELATION_DEFERRED`

第 7 项不阻止只使用获证的 `LOCATION / OPERATING` 成本目标，但它阻止把地点当前归属猜成会计主体、阻止声称地点到主体的历史已治理，并阻止依赖该关系的法定/主体级扩展。

## 明确不可做的事项

- 不得创建 `finance_legal_entity`，也不得把 `finance_accounting_entity.parent_accounting_entity_id` 当集团层级。
- 不得恢复 `GROUP_PRESENTATION`、添加 NULL group default，或把 `ENTITY_PRESENTATION` 塞进当前 assignment/policy。
- 不得继续使用 104 表候选、旧 Phase 1 SQL payload 或旧 release hash 来应用 R6A1。
- 不得把设计断言、生成器通过、空库绿色结果或 `NOOP` 写成“数据已迁移”。
- 不得给地点、供应商、价格、财务事实或 POS 事实静默补 MYR；供应商常用报价币也不能覆盖真实交易币种。
- 不得创建 MYR→MYR 等同币种 FX 行；不得自动倒数或三角换算填补缺失直接币种对。
- 不得 UPDATE 已冻结价格/FX 观察；更正必须追加 superseding observation。
- 不得把旧 `normalized_price_myr`、配方参考售价或旧换汇数值复制成新事实。
- 不得沿用旧 `MIGRATED_MANUAL` 启动采用价规则；它已经被 `NO_APPROVED_TARGET_INTENT` 取代。合法的 `MANUAL_MARKET_CHECK` 原币观察仍须走独立核验、审批和成本选择关系，不能借旧状态自动生效。
- 不得把缺失 RES 值补 0、把负退款取绝对值、把聚合行拆成伪 raw line，或用旧聚合覆盖原始 replay。
- 不得在约束触发器、受控函数、视图 SELECT 与完整 restore 验收尚未完成时批准 `VERIFIED` cost selection。
- 不得宣称 59 个逻辑视图已经物理创建、R6A1 已 apply、真实回填已开始、应用已切换或全库币种已经治理。

## 后续全库币种债务

R6A1 完成的是 `MATERIAL_COST` 基座，不是 global currency closure。至少以下问题仍需独立设计和迁移：

- `finance_monthly_metric.unit` 仍把 `MYR | PERCENT | COUNT` 等不同量纲塞在自由文本 `unit` 中；应把币种、比率和计数单位拆成受控且互斥的结构。
- `finance_target.unit` 有同样问题；目标值不能只靠自由文本决定它是金额、百分比还是数量。
- JSON 中仍可能承载币种，例如 `ops_business_rule.rule_value.currency` 与 `hr_offer.compensation_summary.currency`。即使 JSON Schema 校验三字母格式，也没有形成到 `app_currency` 的关系完整性；必须逐 JSON contract 设计版本、引用校验与迁移门禁。
- `GROUP`、`PRESENTATION`、`ENTITY_PRESENTATION` 需要先建立真实集团/报告范围身份与合并粒度，不能复用 accounting entity 或 NULL scope。
- 地点到会计主体的有效期关系仍未批准；功能币不等于地点经营币，二者也不能仅凭国家相同而推导。
- 到岸成本、税务、海关、预算、月均/月末汇率、合并抵销与当地账簿均需要各自权威来源、用途与政策，不得从 `MATERIAL_COST` policy 泛化。
- 26 个受影响视图的字段/血缘已经关闭，但 SELECT、币种不一致输出、质量状态优先级和 rounding 尚未编译。

所以，正确交付表述只能是：**R6A1 已冻结可编译的五表货币/会计结构与 `MATERIAL_COST` 直接币种对成本关系；它仍是未编译、不可应用、未回填的设计，不代表全库或集团财务币种治理完成。**

## 可复核引用

仓库内权威材料：

- [R6A1 冻结 overlay](revisions/r6a1-fx-signed-pos/model-overlay.json)
- [R6A1 fail-closed compiler 与精确计数断言](revisions/r6a1-fx-signed-pos/compiler.py)
- [旧生产库对象审计](01-current-database-audit.md)
- [Green Phase 1 空结构应用证据](implementation/evidence/green-phase1-apply-2026-08-10.md)
- [2026-08-11 加密 RAW source capture 收据](evidence/source-raw-capture-2026-08-11.md)

外部权威参考仅用于未来主数据/政策审批，不表示已选 provider 或已实现：

- [ISO 4217 currency codes and minor units](https://www.iso.org/standard/64758.html)
- [IFRS IAS 21 — The Effects of Changes in Foreign Exchange Rates](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2024/issued/part-a/ias-21-the-effects-of-changes-in-foreign-exchange-rates.pdf?bypass=on)
- [Bank Negara Malaysia historical exchange-rate download](https://financialmarkets.bnm.gov.my/data-download-exchange-rates) — 仅为未来候选来源示例，R6A1 未选择 provider
