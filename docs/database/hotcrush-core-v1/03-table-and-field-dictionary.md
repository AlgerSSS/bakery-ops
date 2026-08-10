# 03 逐表说明与逐字段字典

每张目标表、每个目标字段和每个只读视图的完整评审契约。

> 状态：**方案 C 评审稿，不是迁移脚本，不授权修改生产数据库。**
> 模型版本：`HOTCRUSH-CORE-V1-REVIEW-R6-2026-08-10`；生产结构快照：`2026-08-09T09:56:05.204Z`；代码静态扫描：`2026-08-09T10:30:31.506548+00:00`。

## 阅读方法

- `CORE_BUSINESS`：首期业务事实/主数据；必须能说明删掉会丢失哪种不可重建事实。
- `CORE_PLATFORM`：首期运行治理侧车；因权限、幂等、审计、安全或恢复而存，不是经营事实。
- `EXTENSION_PACK:*`：结构已设计，但模块批准和真实写入者出现前不创建空壳。
- `SOURCE_CONDITIONAL`：外部来源身份、粒度、修改语义和重跑幂等被验证后才实施；当前包括 POS 支付、POS 退款和两张 Lark 工时表。
- 写入策略单独说明表是否只追加、何时可更新、何时冻结；它与证据成熟度不是一回事。
- 含可空字段的唯一约束必须显式声明 `NULLS NOT DISTINCT` 或有意保留 `NULLS DISTINCT`；不能依赖读者猜 PostgreSQL 默认行为。
- 生效期统一采用左闭右开 `[from, to)`；映射、规则、课程、配方、换算和采用价的正式区间由排斥约束阻止重叠。
- `NULL` 不是 0；允许为空的字段必须按字段语义解释。
- 下列来源和写入者是目标责任设计，不是对当前生产运行状态的断言。
- 41 个 Phase1 视图只是设计候选；其中 10 个 PASS_SELECT_SPEC 仅表示 SELECT 规格足够，不表示已经创建或运行验证；当前已创建并验证的 SQL view = 0。

# APP — 治理、权限与质量

## `app_schema_migration` — 迁移版本台账

- **用途：** 按代码仓库分别记录已执行的迁移，消除多个项目共用单一数字版本造成的冲突。
- **一行代表：** 代码仓库 × 迁移版本一行
- **写入责任：** 受控迁移执行器
- **读取项目：** 所有项目
- **数据来源：** 各项目迁移目录
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 按代码仓库分别记录已执行的迁移，消除多个项目共用单一数字版本造成的冲突。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 永久保留
- **向外连接：** 无外键；仍受来源/批次和业务唯一约束控制
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** repository_code + migration_version
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** execution_ms IS NULL OR execution_ms >= 0

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `migration_id` | 迁移记录ID | `uuid` | 非空; 默认 gen_random_uuid() | 迁移台账内部稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `0b420e40-94f8-52d9-b68d-d70324833cc1` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `repository_code` | 代码仓库代码 | `text` | 非空; 默认 — | 产生这条迁移的代码仓库稳定代码。 | 与 migration_version 共同唯一，避免不同仓库版本号碰撞。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `bakery_ops` | app_schema_migration.repository_code 只表示本字段说明中的 代码仓库代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `migration_version` | 迁移版本 | `text` | 非空; 默认 — | 仓库内部不可重复的迁移版本。 | 按原仓库顺序判断遗漏和重复执行。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `00109` | app_schema_migration.migration_version 只表示本字段说明中的 迁移版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `migration_name` | 迁移名称 | `text` | 可空; 默认 — | 来源台账记录的人类可读迁移标题；来源没有时为空。 | 承接旧 schema_migrations.name，帮助人工审计，但不参与版本唯一性。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `add margin and holiday factor` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `filename` | 迁移文件名 | `text` | 非空; 默认 — | 实际执行的迁移文件名。 | 便于从数据库追溯到版本库文件。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `109_margin_and_holiday_factor.sql` | app_schema_migration.filename 只表示本字段说明中的 迁移文件名；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `checksum_sha256` | 文件校验值 | `char(64)` | 非空; 默认 — | 迁移文件内容的 SHA-256。 | 阻止同一版本号对应不同 SQL 内容。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `d7a8...64位十六进制` | app_schema_migration.checksum_sha256 只表示本字段说明中的 文件校验值；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `applied_at` | 执行时间 | `timestamptz` | 非空; 默认 now() | 迁移成功提交的时间。 | 用于排序、审计和避开生产抓取窗口。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T02:15:00+08:00` | app_schema_migration.applied_at 只表示本字段说明中的 执行时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `applied_by` | 执行主体 | `text` | 非空; 默认 — | 执行迁移的人或自动化身份。 | 明确谁完成了生产变更。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `human:weiliang` | app_schema_migration.applied_by 只表示本字段说明中的 执行主体；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `execution_ms` | 执行耗时毫秒 | `integer` | 可空; 默认 — | 迁移事务的实际耗时。 | 识别慢 DDL 和锁风险。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `842` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `app_source_system` — 来源系统注册表

- **用途：** 登记 RES、Lark、财务模板、人工后台等数据来源及其责任边界。
- **一行代表：** 每个可区分的数据来源系统一行
- **写入责任：** 平台管理员
- **读取项目：** 所有项目
- **数据来源：** 人工配置
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 登记 RES、Lark、财务模板、人工后台等数据来源及其责任边界。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 永久保留；停用来源仅改状态
- **向外连接：** 无外键；仍受来源/批次和业务唯一约束控制
- **被谁连接：** `app_job_run.source_system_id`；`finance_import_batch.source_system_id`；`hr_application.source_system_id`；`hr_application_stage_event.source_system_id`；`hr_employment_mapping_review.source_system_id`；`hr_employment_source_identity.source_system_id`；`hr_timesheet_sync_batch.source_system_id`；`mkt_reward_claim.source_system_id`；`mkt_survey_response.source_system_id`；`mkt_survey_result.source_system_id`；`msg_delivery_event.source_system_id`；`ops_location_source_identity.source_system_id`；`ops_product_alias.source_system_id`；`pos_ingest_batch.source_system_id`；`pos_member.source_system_id`；`pos_member_card.source_system_id`；`pos_member_card_transaction.source_system_id`；`pos_order.source_system_id`；`pos_payment.source_system_id`；`pos_product_listing.source_system_id`；`pos_refund.source_system_id`；`scm_inventory_count.source_system_id`；`scm_material_alias.source_system_id`；`scm_material_source_identity.source_system_id`；`scm_material_unit_conversion.source_system_id`；`scm_supplier_price_observation.source_system_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** source_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** source_system_id <> '00000000-0000-0000-0000-000000000000'

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 gen_random_uuid() | 来源系统稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 这是来源系统证据，不等于企业统一身份。 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `source_code` | 来源代码 | `text` | 非空; 默认 — | 程序和数据字典使用的不可变代码。 | 作为来源身份、批次和审计表的统一连接键。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `res_pos` | 这是来源系统证据，不等于企业统一身份。 |
| 3 | `source_name` | 来源名称 | `text` | 非空; 默认 — | 给人阅读的来源系统名称。 | 用于界面和审计展示，不参与业务连接。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `Restosuite POS` | 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_type` | 来源类型 | `text` | 非空; 默认 — | 来源属于 API、FILE、MANUAL、DATABASE 或 GENERATED。 | 决定抓取、校验和重跑策略。 | CHECK source_type IN ('API','FILE','MANUAL','DATABASE','GENERATED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `API` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `owner_project` | 责任项目 | `text` | 非空; 默认 — | 负责读取该来源并写入规范表的唯一项目。 | 阻止多个项目争抢同一来源写入权。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `res_api` | app_source_system.owner_project 只表示本字段说明中的 责任项目；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `authoritative_scope` | 权威范围 | `text` | 非空; 默认 — | 该来源在哪些事实上具备权威性。 | 防止把财务月表、POS 日表或人工确认互相冒充。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `POS销售与会员事实` | app_source_system.authoritative_scope 只表示本字段说明中的 权威范围；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `status` | 状态 | `text` | 非空; 默认 'ACTIVE' | 来源是否 ACTIVE、PAUSED 或 RETIRED。 | 控制调度和告警，但不删除历史。 | CHECK status IN ('ACTIVE','PAUSED','RETIRED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | app_source_system.status 只表示本字段说明中的 状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 9 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `app_unit` — 统一计量单位

- **用途：** 登记产品、原料、配方、采购和库存共同使用的计量单位；单位代码只表达计量含义，不夹带某个供应商包装规格。
- **一行代表：** 一个受控计量单位一行
- **写入责任：** 数据治理管理员
- **读取项目：** BakeryOps、财务网站、RES/POS、分析/BI
- **数据来源：** 企业单位字典和人工批准
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 登记产品、原料、配方、采购和库存共同使用的计量单位；单位代码只表达计量含义，不夹带某个供应商包装规格。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 永久保留；已引用单位不得物理删除
- **向外连接：** `canonical_unit_id` → `app_unit.unit_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `app_unit.canonical_unit_id`；`cost_card_recipe_component.input_unit_id`；`cost_card_recipe_version.yield_unit_id`；`ops_dispatch_line.unit_id`；`ops_product.base_unit_id`；`ops_production_plan_line.unit_id`；`ops_production_run_line.unit_id`；`scm_inventory_count_line.raw_unit_id`；`scm_material.base_unit_id`；`scm_material_unit_conversion.from_unit_id`；`scm_material_unit_conversion.to_unit_id`；`scm_purchase_order_line.order_unit_id`；`scm_supplier_item.order_unit_id`；`scm_supplier_price_observation.raw_price_unit_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** unit_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** canonical_unit_id IS NULL OR canonical_unit_id <> unit_id
- **特别说明：** 全局可换算单位使用 canonical_unit_id + factor_to_canonical；供应商包装或特定原料换算使用 scm_material_unit_conversion。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `unit_id` | 单位ID | `uuid` | 非空; 默认 gen_random_uuid() | 跨产品、原料、配方、采购和库存使用的稳定计量单位身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `3cf62aa7-6657-5f04-b833-b7d7163ad827` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `unit_code` | 单位代码 | `text` | 非空; 默认 — | 程序使用的唯一、大小写受控单位代码。 | 替代散落的 g、G、gram、公斤等自由文本。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `G` | app_unit.unit_code 只表示本字段说明中的 单位代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `unit_name` | 单位名称 | `text` | 非空; 默认 — | 给业务人员阅读的单位名称。 | 用于界面展示，连接仍使用 unit_id。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `克` | app_unit.unit_name 只表示本字段说明中的 单位名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `dimension_code` | 量纲代码 | `text` | 非空; 默认 — | MASS、VOLUME、COUNT、LENGTH、PACKAGING 或 OTHER。 | 阻止质量、体积、件数等不同量纲直接换算。 | CHECK dimension_code IN ('MASS','VOLUME','COUNT','LENGTH','PACKAGING','OTHER') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `MASS` | app_unit.dimension_code 只表示本字段说明中的 量纲代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `canonical_unit_id` | 量纲基准单位ID | `uuid` | 可空; 默认 — | 同量纲的企业基准单位；包装等只能按具体物料换算时可以为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `97dcea12-9b77-54a7-92b9-bbef1a85877e` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `factor_to_canonical` | 换算到基准单位系数 | `numeric(24,12)` | 可空; 默认 — | 一个本单位等于多少个 canonical_unit_id；没有全局线性换算时为空。 | 支持 kg→g、L→ml 等全局换算；CASE→g 等物料相关换算不得写这里。 | CHECK factor_to_canonical IS NULL OR factor_to_canonical > 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `1000.000000000000` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `decimal_scale` | 建议小数位 | `smallint` | 非空; 默认 3 | 该单位业务录入和展示建议保留的小数位。 | 统一界面精度；不替代金额和计算精度规则。 | CHECK decimal_scale BETWEEN 0 AND 12 | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `3` | app_unit.decimal_scale 只表示本字段说明中的 建议小数位；必须在所属对象粒度内按 smallint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `status` | 单位状态 | `text` | 非空; 默认 'ACTIVE' | ACTIVE 或 RETIRED。 | 停用单位但不破坏历史事实。 | CHECK status IN ('ACTIVE','RETIRED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | app_unit.status 只表示本字段说明中的 单位状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 11 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `app_job_run` — 自动任务运行记录

- **用途：** 统一记录抓取、预测、成本计算和同步任务每次运行的输入窗口、结果和错误。
- **一行代表：** 某个任务的一次运行一行
- **写入责任：** 任务调度平台
- **读取项目：** 所有项目、分析/BI
- **数据来源：** 各自动任务
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** R6_MERGE_INTO: calendar imports and cost refreshes use the generic job-run ledger
- **为何存表而不是现算视图：** 统一记录抓取、预测、成本计算和同步任务每次运行的输入窗口、结果和错误。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 至少保留 24 个月；失败运行保留更久以支持审计
- **向外连接：** `source_system_id` → `app_source_system.source_system_id`
- **被谁连接：** `ai_call.job_run_id`；`app_audit_event.job_run_id`；`finance_import_batch.job_run_id`；`hr_application_stage_event.job_run_id`；`hr_timesheet_sync_batch.job_run_id`；`msg_outbound_message.job_run_id`；`ops_calendar_event.job_run_id`；`ops_forecast_run.job_run_id`；`ops_shift_plan_version.source_job_run_id`；`ops_stockout_event.detected_job_run_id`；`ops_workload_run.job_run_id`；`pos_ingest_batch.job_run_id`；`scm_material_requirement_run.job_run_id`；`scm_replenishment_run.job_run_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `job_run_id` | 任务运行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次任务运行的稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `source_system_id` | 来源系统ID | `uuid` | 可空; 默认 — | 该任务主要读取的数据来源；纯内部计算可以为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `job_code` | 任务代码 | `text` | 非空; 默认 — | 不可变的任务名称。 | 连接调度、告警和批次表。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `pos_full_sync` | app_job_run.job_code 只表示本字段说明中的 任务代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `scheduled_for` | 计划执行时间 | `timestamptz` | 可空; 默认 — | 调度器原计划启动的时间。 | 计算调度延迟。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T23:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `started_at` | 实际开始时间 | `timestamptz` | 非空; 默认 — | 任务真正开始处理的时间。 | 计算运行时长和判断重叠。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T23:00:03+08:00` | app_job_run.started_at 只表示本字段说明中的 实际开始时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `finished_at` | 实际结束时间 | `timestamptz` | 可空; 默认 — | 任务成功、失败或取消时结束的时间。 | 判断任务是否卡死。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T23:03:18+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `status` | 运行状态 | `text` | 非空; 默认 — | QUEUED、RUNNING、SUCCEEDED、FAILED、PARTIAL 或 CANCELLED。 | 所有下游只消费符合要求的成功批次。 | CHECK status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','PARTIAL','CANCELLED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `SUCCEEDED` | app_job_run.status 只表示本字段说明中的 运行状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `input_manifest` | 输入清单 | `jsonb` | 非空; 默认 '{}'::jsonb | 输入日期窗口、文件哈希、游标或上游版本的结构化清单。 | 保证相同输入可重放并解释结果差异。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `{"business_date":"2026-08-08"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 9 | `row_count` | 处理行数 | `bigint` | 可空; 默认 — | 任务实际读取或生成的主要记录数。 | 用于空跑和数量异常告警。 | CHECK row_count IS NULL OR row_count >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `82998` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `error_code` | 错误代码 | `text` | 可空; 默认 — | 失败或部分成功时的机器可读错误类别。 | 支持聚合告警而不依赖自由文本。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `SOURCE_TIMEOUT` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `error_detail` | 错误详情 | `text` | 可空; 默认 — | 经过脱敏的错误摘要。 | 支持排障；不得保存密码、令牌或完整 PII。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `RES request exceeded 30s` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `app_audit_event` — 受控操作审计流水

- **用途：** 只追加记录登录、权限、人工改数、审批和敏感读取等受控操作。
- **一行代表：** 一次已完成或拒绝的受控操作一行
- **写入责任：** 数据库受控审计函数
- **读取项目：** 安全管理员、审计/BI
- **数据来源：** 所有应用的受控写入接口
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 只追加记录登录、权限、人工改数、审批和敏感读取等受控操作。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 永久保留；只允许追加，不允许应用账号 UPDATE/DELETE
- **向外连接：** `actor_user_id` → `app_user.user_id`；`job_run_id` → `app_job_run.job_run_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** object_type/object_id 是审计元数据，不是业务关系。业务查询必须使用各域真实外键；删除或改名业务对象不会级联修改审计流水。object_type 受域前缀格式约束，object_id 受 UUID 类型约束，仍不能据此声称数据库验证了它指向哪张表。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `audit_event_id` | 审计事件ID | `uuid` | 非空; 默认 gen_random_uuid() | 审计事件稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `10653363-ee87-5944-b85a-5b2d5fcc511d` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `actor_user_id` | 操作账号 | `uuid` | 可空; 默认 — | 发起操作的应用账号；系统任务可以为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e34d8b81-3f73-52c5-bfa0-158ba9c35656` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `job_run_id` | 任务运行ID | `uuid` | 可空; 默认 — | 由自动任务触发时对应的运行记录。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `actor_type` | 操作者类型 | `text` | 非空; 默认 — | USER、SERVICE 或 DATABASE。 | 区分业务审批者、应用服务和数据库自动动作。 | CHECK actor_type IN ('USER','SERVICE','DATABASE') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `USER` | app_audit_event.actor_type 只表示本字段说明中的 操作者类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `action_code` | 操作代码 | `text` | 非空; 默认 — | 机器可读的受控动作代码，例如 COST_PRICE_APPROVE。 | 支持权限核查和异常操作统计；新增动作必须随发布登记语义。 | CHECK action_code ~ '^[A-Z][A-Z0-9_]{2,95}$' | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `SHIFT_PLAN_PUBLISH` | app_audit_event.action_code 只表示本字段说明中的 操作代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `object_type` | 对象类型 | `text` | 非空; 默认 — | 被操作目标表或批准聚合的受控代码，只允许 HOT CRUSH 已登记域前缀。 | 与 object_id 仅用于审计定位，不作为业务连接或反向外键。 | CHECK object_type ~ '^(app\|ops\|pos\|hr\|scm\|cost_card\|finance\|mkt\|msg\|ai)_[a-z0-9_]+$' | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `ops_shift_plan_version` | app_audit_event.object_type 只表示本字段说明中的 对象类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `object_id` | 对象UUID | `uuid` | 可空; 默认 — | 被操作目标行的 UUID 主键；对无单行对象的聚合动作可以为空。 | 让审计引用至少具备统一格式，但不伪造跨表物理外键。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `request_id` | 请求ID | `text` | 可空; 默认 — | 贯穿网关、应用日志与数据库审计的请求追踪号。 | 把一次用户动作的多条日志串起来。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `req_01J4W...` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `result` | 操作结果 | `text` | 非空; 默认 — | SUCCESS、DENIED 或 FAILED。 | 区分被拒绝与执行失败。 | CHECK result IN ('SUCCESS','DENIED','FAILED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `SUCCESS` | app_audit_event.result 只表示本字段说明中的 操作结果；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `before_data` | 修改前快照 | `jsonb` | 可空; 默认 — | 受控修改前的脱敏字段快照。 | 支持回溯和人工复核。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `restricted` | `{"status":"DRAFT"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `after_data` | 修改后快照 | `jsonb` | 可空; 默认 — | 受控修改后的脱敏字段快照。 | 说明实际发生了什么变化。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `restricted` | `{"status":"PUBLISHED"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `ip_address` | 来源IP | `inet` | 可空; 默认 — | 请求来源 IP；后台任务可以为空。 | 用于安全审计，访问必须受限。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `restricted` | `203.0.113.10` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `user_agent` | 客户端标识 | `text` | 可空; 默认 — | 客户端或服务的 User-Agent 摘要。 | 识别异常客户端，不保存多余指纹。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `internal` | `finance-web/1.8` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `occurred_at` | 发生时间 | `timestamptz` | 非空; 默认 now() | 操作结果确定的绝对时间。 | 审计排序的权威时间。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:35:00+08:00` | app_audit_event.occurred_at 只表示本字段说明中的 发生时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `app_user` — 统一应用账号

- **用途：** 统一财务、BakeryOps及未来后台的登录账号；不等同于员工自然人。
- **一行代表：** 每个可登录或可代表服务的账号一行
- **写入责任：** 身份管理服务
- **读取项目：** 所有应用
- **数据来源：** 管理员创建、单点登录或服务账号配置
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 统一财务、BakeryOps及未来后台的登录账号；不等同于员工自然人。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 账号停用后保留审计所需最短期限，不物理删除被审计引用的账号
- **向外连接：** `person_id` → `hr_person.person_id`
- **被谁连接：** `ai_call.actor_user_id`；`ai_prompt_segment.approved_by_user_id`；`ai_prompt_segment.created_by_user_id`；`ai_prompt_template.approved_by_user_id`；`ai_prompt_template.created_by_user_id`；`app_audit_event.actor_user_id`；`app_one_time_token.user_id`；`app_role_permission.granted_by_user_id`；`app_session.user_id`；`app_unit.created_by_user_id`；`app_user_location_scope.granted_by_user_id`；`app_user_role.granted_by_user_id`；`app_user_role.user_id`；`cost_card_material_price.approved_by_user_id`；`cost_card_material_price.created_by_user_id`；`cost_card_recipe_version.approved_by_user_id`；`cost_card_recipe_version.created_by_user_id`；`finance_import_batch.approved_by_user_id`；`finance_import_batch.created_by_user_id`；`finance_period_category_map.approved_by_user_id`；`finance_period_category_map.created_by_user_id`；`finance_target.approved_by_user_id`；`finance_target.created_by_user_id`；`hr_application.created_by_user_id`；`hr_application_stage_event.actor_user_id`；`hr_appointment.confirmed_by_user_id`；`hr_appointment.created_by_user_id`；`hr_employee_event.recorded_by_user_id`；`hr_employment.created_by_user_id`；`hr_employment_mapping_review.created_by_user_id`；`hr_employment_mapping_review.reviewed_by_user_id`；`hr_employment_source_identity.created_by_user_id`；`hr_job_requisition.approved_by_user_id`；`hr_job_requisition.created_by_user_id`；`hr_offer.created_by_user_id`；`hr_onboarding_task.completed_by_user_id`；`hr_onboarding_task.created_by_user_id`；`hr_person.created_by_user_id`；`hr_person_contact.created_by_user_id`；`hr_screening_rule.approved_by_user_id`；`hr_screening_rule.created_by_user_id`；`hr_training_assignment.assigned_by_user_id`；`hr_training_course.created_by_user_id`；`hr_training_course_version.created_by_user_id`；`hr_training_result.verified_by_user_id`；`mkt_campaign_version.approved_by_user_id`；`mkt_campaign_version.created_by_user_id`；`mkt_reward.created_by_user_id`；`mkt_reward_claim.redeemed_by_user_id`；`mkt_survey_question.created_by_user_id`；`mkt_survey_question_option.created_by_user_id`；`msg_conversation.app_user_id`；`msg_outbound_message.queued_by_user_id`；`ops_business_rule.approved_by_user_id`；`ops_business_rule.created_by_user_id`；`ops_daily_review.approved_by_user_id`；`ops_daily_review.created_by_user_id`；`ops_dispatch.created_by_user_id`；`ops_location_source_identity.created_by_user_id`；`ops_operational_event.created_by_user_id`；`ops_operational_event_product.created_by_user_id`；`ops_product.created_by_user_id`；`ops_product_alias.created_by_user_id`；`ops_production_plan_line.confirmed_by_user_id`；`ops_production_plan_version.approved_by_user_id`；`ops_production_plan_version.created_by_user_id`；`ops_production_run.created_by_user_id`；`ops_review_action.created_by_user_id`；`ops_role.created_by_user_id`；`ops_role_training_requirement.created_by_user_id`；`ops_shift_assignment.created_by_user_id`；`ops_shift_assignment.override_approved_by_user_id`；`ops_shift_plan_version.approved_by_user_id`；`ops_shift_plan_version.created_by_user_id`；`ops_station.created_by_user_id`；`ops_stockout_event.created_by_user_id`；`pos_product_mapping.created_by_user_id`；`pos_product_mapping_review.created_by_user_id`；`pos_product_mapping_review.reviewed_by_user_id`；`scm_goods_receipt.created_by_user_id`；`scm_inventory_count.approved_by_user_id`；`scm_inventory_count.created_by_user_id`；`scm_inventory_movement.created_by_user_id`；`scm_material.created_by_user_id`；`scm_material_alias.created_by_user_id`；`scm_material_source_identity.created_by_user_id`；`scm_material_unit_conversion.created_by_user_id`；`scm_material_unit_conversion.verified_by_user_id`；`scm_purchase_order_revision.approved_by_user_id`；`scm_purchase_order_revision.created_by_user_id`；`scm_replenishment_line.approved_by_user_id`；`scm_replenishment_line.created_by_user_id`；`scm_supplier.created_by_user_id`；`scm_supplier_item.confirmed_by_user_id`；`scm_supplier_item.created_by_user_id`；`scm_supplier_item_mapping_review.created_by_user_id`；`scm_supplier_item_mapping_review.reviewed_by_user_id`；`scm_supplier_price_observation.verified_by_user_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** username
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** failed_login_count 和 last_login_at 是认证路径必须原子读取/更新的安全状态缓存，不是分析事实；notification_subscription_codes 是消息路由需要读取的当前偏好集合，不代表权限或雇佣岗位，更新必须校验已登记消息类型并写 app_audit_event；人员出勤绝不能读取这些账号状态字段。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `user_id` | 账号ID | `uuid` | 非空; 默认 gen_random_uuid() | 应用账号稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `869c8106-7e07-5851-a6ff-d68b3a2030c3` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `person_id` | 人员ID | `uuid` | 可空; 默认 — | 账号对应自然人；服务账号可以为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_person.person_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `974372c0-eeaf-573e-b810-7959c45598c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `username` | 登录名 | `citext` | 非空; 默认 — | 唯一、大小写不敏感的登录名。 | 供密码或内部登录使用；不得用作人员跨域主键。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `finance.admin` | app_user.username 只表示本字段说明中的 登录名；必须在所属对象粒度内按 citext 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `display_name` | 显示名称 | `text` | 非空; 默认 — | 界面显示的账号名称。 | 提高审计可读性。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `Finance Admin` | app_user.display_name 只表示本字段说明中的 显示名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `password_hash` | 密码哈希 | `text` | 可空; 默认 — | 采用批准算法生成的密码哈希；单点登录账号可以为空。 | 仅用于认证，绝不保存明文密码。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `secret` | `$argon2id$...` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `account_type` | 账号类型 | `text` | 非空; 默认 — | HUMAN 或 SERVICE。 | 决定会话、MFA和权限审查策略。 | CHECK account_type IN ('HUMAN','SERVICE') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `HUMAN` | app_user.account_type 只表示本字段说明中的 账号类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `status` | 账号状态 | `text` | 非空; 默认 'ACTIVE' | ACTIVE、LOCKED、DISABLED 或 PENDING_RESET。 | 阻止失效账号继续创建会话。 | CHECK status IN ('ACTIVE','LOCKED','DISABLED','PENDING_RESET') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | app_user.status 只表示本字段说明中的 账号状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `must_change_password` | 强制改密 | `boolean` | 非空; 默认 false | 下次密码登录是否必须先修改密码。 | 处理初始密码和安全重置。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `false` | app_user.must_change_password 只表示本字段说明中的 强制改密；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `failed_login_count` | 连续失败次数 | `integer` | 非空; 默认 0 | 自上次成功登录后的连续失败次数。 | 达到门槛后锁定账号。 | CHECK failed_login_count >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `0` | app_user.failed_login_count 只表示本字段说明中的 连续失败次数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `last_login_at` | 最后登录时间 | `timestamptz` | 可空; 默认 — | 最近一次成功认证时间。 | 用于账号审查，不作为员工出勤。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `2026-08-09T09:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `notification_subscription_codes` | 消息订阅代码 | `text[]` | 非空; 默认 '{}'::text[] | 该账号主动保留的自动推送类型代码集合；空数组表示当前不订阅任何自动推送。 | 承接现有 staff.subscriptions，并让消息任务按稳定 user_id 选择收件人；这是不可从角色或消息历史确定性重建的当前偏好状态。 | CHECK cardinality(notification_subscription_codes) <= 64；CHECK array_position(notification_subscription_codes, NULL) IS NULL | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `{DAILY_REVIEW,PRODUCTION_PLAN}` | 只能通过受控偏好更新函数写入；每个代码必须存在于部署随附的消息类型注册表，函数拒绝未知代码和重复代码。变更历史写 app_audit_event，不把数组拆成分析事实。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `app_role` — 应用角色

- **用途：** 定义可分配给账号的角色集合。
- **一行代表：** 一个角色一行
- **写入责任：** 身份管理服务
- **读取项目：** 所有应用
- **数据来源：** 管理员配置
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 定义可分配给账号的角色集合。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** 无外键；仍受来源/批次和业务唯一约束控制
- **被谁连接：** `app_role_permission.role_id`；`app_user_role.role_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** role_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `role_id` | 角色ID | `uuid` | 非空; 默认 gen_random_uuid() | 角色稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `a28ce29f-93bc-5620-a42b-c652824558c9` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `role_code` | 角色代码 | `text` | 非空; 默认 — | 程序判断使用的唯一不可变代码。 | 连接账号和权限。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `FINANCE_EDITOR` | app_role.role_code 只表示本字段说明中的 角色代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `role_name` | 角色名称 | `text` | 非空; 默认 — | 给管理员阅读的角色名称。 | 权限配置界面展示。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `财务编辑者` | app_role.role_name 只表示本字段说明中的 角色名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `description` | 角色说明 | `text` | 非空; 默认 — | 该角色的业务职责和授权边界。 | 帮助审批者避免过度授权。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `可编辑成本卡但不能管理账号` | app_role.description 只表示本字段说明中的 角色说明；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `status` | 状态 | `text` | 非空; 默认 'ACTIVE' | ACTIVE 或 RETIRED。 | 停用角色但保留历史分配记录。 | CHECK status IN ('ACTIVE','RETIRED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | app_role.status 只表示本字段说明中的 状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 7 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `app_permission` — 应用权限

- **用途：** 定义最小可授权动作，例如读取成本、发布班表或管理账号。
- **一行代表：** 一个原子权限一行
- **写入责任：** 身份管理服务
- **读取项目：** 所有应用
- **数据来源：** 代码声明后由管理员批准
- **实施层级：** `EXTENSION_PACK:FINE_GRAINED_ACCESS`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 定义最小可授权动作，例如读取成本、发布班表或管理账号。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** 无外键；仍受来源/批次和业务唯一约束控制
- **被谁连接：** `app_role_permission.permission_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** permission_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `permission_id` | 权限ID | `uuid` | 非空; 默认 gen_random_uuid() | 权限稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `0f9d9b06-00b9-5e5e-bbcd-99eef0d0e654` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `permission_code` | 权限代码 | `text` | 非空; 默认 — | 程序鉴权使用的唯一代码。 | 避免以页面名称或角色名称硬编码权限。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `SHIFT_PLAN_PUBLISH` | app_permission.permission_code 只表示本字段说明中的 权限代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `domain_code` | 业务域 | `text` | 非空; 默认 — | 权限所属业务域。 | 支持按域审查授权。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `OPS` | app_permission.domain_code 只表示本字段说明中的 业务域；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `description` | 权限说明 | `text` | 非空; 默认 — | 允许执行的具体动作与不包含的动作。 | 让管理员能基于最小权限审批。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `发布已通过资格门禁的班表版本` | app_permission.description 只表示本字段说明中的 权限说明；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `sensitivity` | 敏感等级 | `text` | 非空; 默认 'NORMAL' | NORMAL、SENSITIVE 或 PRIVILEGED。 | 决定是否需要额外审批或 MFA。 | CHECK sensitivity IN ('NORMAL','SENSITIVE','PRIVILEGED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `PRIVILEGED` | app_permission.sensitivity 只表示本字段说明中的 敏感等级；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 7 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `app_user_role` — 账号角色分配

- **用途：** 记录账号在有效期内拥有的角色。
- **一行代表：** 账号 × 角色 × 生效区间一行
- **写入责任：** 身份管理服务
- **读取项目：** 所有应用
- **数据来源：** 管理员授权
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 记录账号在有效期内拥有的角色。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `user_id` → `app_user.user_id`；`role_id` → `app_role.role_id`；`granted_by_user_id` → `app_user.user_id`
- **被谁连接：** `app_user_location_scope.user_role_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** user_id + role_id + valid_from
- **不可重叠约束：** NO_OVERLAP(user_id, role_id, tstzrange(valid_from, LEAST(COALESCE(valid_to, 'infinity'), COALESCE(revoked_at, 'infinity')), '[)'))
- **表级检查：** valid_to IS NULL OR valid_to > valid_from；revoked_at IS NULL OR revoked_at > valid_from
- **特别说明：** 授予后仅允许补写 revoked_at 或受控缩短 valid_to；授权主体、角色和起点冻结，所有修改进入 app_audit_event。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `user_role_id` | 分配ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次角色分配稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `b77e0323-5e3c-539d-aa15-06b42b91400d` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `user_id` | 账号ID | `uuid` | 非空; 默认 — | 被授权账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `869c8106-7e07-5851-a6ff-d68b3a2030c3` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `role_id` | 角色ID | `uuid` | 非空; 默认 — | 授予的角色。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_role.role_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `a28ce29f-93bc-5620-a42b-c652824558c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `valid_from` | 生效时间 | `timestamptz` | 非空; 默认 now() | 角色权限开始有效的时间。 | 支持临时授权。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-09T09:00:00+08:00` | app_user_role.valid_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `valid_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 角色权限自动失效时间；长期授权为空。 | 避免忘记回收临时权限。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-16T09:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `granted_by_user_id` | 授权账号 | `uuid` | 非空; 默认 — | 批准本次授权的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `08e54b06-a881-5820-a3a6-00ae36fa344d` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 7 | `revoked_at` | 撤销时间 | `timestamptz` | 可空; 默认 — | 提前撤销授权的时间。 | 保留历史而不删除分配行。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-10T12:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 9 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `app_role_permission` — 角色权限关系

- **用途：** 按生效区间把原子权限组合进角色，并保留撤销历史。
- **一行代表：** 角色 × 权限 × 生效区间一行
- **写入责任：** 身份管理服务
- **读取项目：** 所有应用
- **数据来源：** 管理员配置
- **实施层级：** `EXTENSION_PACK:FINE_GRAINED_ACCESS`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 按生效区间把原子权限组合进角色，并保留撤销历史。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `role_id` → `app_role.role_id`；`permission_id` → `app_permission.permission_id`；`granted_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** role_id + permission_id + valid_from
- **不可重叠约束：** NO_OVERLAP(role_id, permission_id, tstzrange(valid_from, LEAST(COALESCE(valid_to, 'infinity'), COALESCE(revoked_at, 'infinity')), '[)'))
- **表级检查：** valid_to IS NULL OR valid_to > valid_from；revoked_at IS NULL OR revoked_at > valid_from
- **特别说明：** 授予后角色、权限和起点冻结；只允许受控关闭 valid_to 或首次写入 revoked_at，变更必须进入 app_audit_event。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `role_permission_id` | 关系ID | `uuid` | 非空; 默认 gen_random_uuid() | 角色权限关系稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `7488154e-4412-5ff6-9d3a-039a5b944918` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `role_id` | 角色ID | `uuid` | 非空; 默认 — | 被配置的角色。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_role.role_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `a28ce29f-93bc-5620-a42b-c652824558c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `permission_id` | 权限ID | `uuid` | 非空; 默认 — | 角色获得的原子权限。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_permission.permission_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `0f9d9b06-00b9-5e5e-bbcd-99eef0d0e654` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `granted_by_user_id` | 配置账号 | `uuid` | 非空; 默认 — | 执行权限配置的管理员账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `08e54b06-a881-5820-a3a6-00ae36fa344d` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `valid_from` | 生效时间 | `timestamptz` | 非空; 默认 now() | 该角色权限开始生效的时间。 | 支持权限组合变更且不重写历史。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-09T09:00:00+08:00` | app_role_permission.valid_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `valid_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 权限按计划停止生效的时间；长期有效为空。 | 限制临时权限。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-09-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `revoked_at` | 撤销时间 | `timestamptz` | 可空; 默认 — | 管理员提前撤销该角色权限的时间。 | 撤销而不删除授权历史。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-10T12:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 9 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `app_user_location_scope` — 账号地点范围

- **用途：** 限制一项账号角色分配可以读取或操作哪些门店、厨房或仓库，避免多角色账号的地点范围互相串用。
- **一行代表：** 账号角色分配 × 地点 × 权限范围一行
- **写入责任：** 身份管理服务
- **读取项目：** 所有应用
- **数据来源：** 管理员授权
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 限制一项账号角色分配可以读取或操作哪些门店、厨房或仓库，避免多角色账号的地点范围互相串用。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `user_role_id` → `app_user_role.user_role_id`；`location_id` → `ops_location.location_id`；`granted_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** user_role_id + location_id + scope_level + valid_from
- **不可重叠约束：** NO_OVERLAP(user_role_id, location_id, scope_level, tstzrange(valid_from, LEAST(COALESCE(valid_to, 'infinity'), COALESCE(revoked_at, 'infinity')), '[)'))
- **表级检查：** valid_to IS NULL OR valid_to > valid_from；revoked_at IS NULL OR revoked_at > valid_from
- **特别说明：** 授予后仅允许补写 revoked_at 或受控缩短 valid_to；账号角色分配、地点、级别和起点冻结，所有修改进入 app_audit_event。当前 app_user_store_scope 迁移时先建立账号当时有效的 app_user_role，再把门店范围挂到具体 user_role_id；不得把一个地点范围默认扩散到账号的所有角色。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `user_location_scope_id` | 范围ID | `uuid` | 非空; 默认 gen_random_uuid() | 地点授权稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2052c96f-75af-54a3-8208-2fe3f1bed7dd` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `user_role_id` | 账号角色分配ID | `uuid` | 非空; 默认 — | 被限定地点范围的具体账号角色分配；同一账号有多个角色时必须分别授权。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user_role.user_role_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `b77e0323-5e3c-539d-aa15-06b42b91400d` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 账号可访问的地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `scope_level` | 范围级别 | `text` | 非空; 默认 — | READ、WRITE 或 ADMIN。 | 区分只读分析、业务录入和地点管理。 | CHECK scope_level IN ('READ','WRITE','ADMIN') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `READ` | app_user_location_scope.scope_level 只表示本字段说明中的 范围级别；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `valid_from` | 生效时间 | `timestamptz` | 非空; 默认 now() | 地点授权开始时间。 | 支持临时门店支援。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-09T09:00:00+08:00` | app_user_location_scope.valid_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `valid_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 地点授权结束时间；长期有效为空。 | 自动回收临时范围。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-09-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `granted_by_user_id` | 授权账号 | `uuid` | 非空; 默认 — | 批准地点范围的管理员账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `08e54b06-a881-5820-a3a6-00ae36fa344d` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 8 | `revoked_at` | 撤销时间 | `timestamptz` | 可空; 默认 — | 管理员提前撤销地点权限的绝对时间。 | 立即结束授权而不删除历史分配。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-10T12:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 10 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `app_session` — 登录会话

- **用途：** 保存经过哈希的登录会话及其过期和撤销状态。
- **一行代表：** 一个登录会话一行
- **写入责任：** 身份管理服务
- **读取项目：** 所有应用
- **数据来源：** 成功认证
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存经过哈希的登录会话及其过期和撤销状态。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 过期或撤销后保留 90 天，再按审计政策清理
- **向外连接：** `user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** token_hash
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** expires_at > issued_at
- **特别说明：** 签发后除首次写入 revoked_at 外全部字段冻结；过期或撤销即终态。APPEND_ONLY 无法表达登出撤销，因此明确采用终态前受控更新。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `session_id` | 会话ID | `uuid` | 非空; 默认 gen_random_uuid() | 会话稳定主键；客户端令牌使用另一随机值。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `4cfb5a49-e2e6-5ad7-b79b-03d1d80a73c6` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `user_id` | 账号ID | `uuid` | 非空; 默认 — | 会话所属账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `869c8106-7e07-5851-a6ff-d68b3a2030c3` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `token_hash` | 会话令牌哈希 | `char(64)` | 非空; 默认 — | 客户端会话令牌的 SHA-256，数据库不保存原令牌。 | 验证会话同时降低数据库泄漏后直接冒用风险。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `secret` | `0f4c...64位十六进制` | app_session.token_hash 只表示本字段说明中的 会话令牌哈希；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `issued_at` | 签发时间 | `timestamptz` | 非空; 默认 now() | 会话创建时间。 | 计算生命周期。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T09:00:00+08:00` | app_session.issued_at 只表示本字段说明中的 签发时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `expires_at` | 过期时间 | `timestamptz` | 非空; 默认 — | 会话自动失效时间。 | 每次鉴权必须检查。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T21:00:00+08:00` | app_session.expires_at 只表示本字段说明中的 过期时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `revoked_at` | 撤销时间 | `timestamptz` | 可空; 默认 — | 登出或管理员撤销会话的时间。 | 保留审计而不立即删除。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T12:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `ip_address` | 签发IP | `inet` | 可空; 默认 — | 签发会话时的请求 IP。 | 用于异常会话分析，访问受限。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `restricted` | `203.0.113.10` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `user_agent` | 客户端标识 | `text` | 可空; 默认 — | 签发会话时的客户端摘要。 | 辅助识别被盗会话。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `Safari/macOS` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `app_one_time_token` — 一次性访问令牌

- **用途：** 为 HBTI、重置密码或一次性公开流程保存哈希令牌和消费状态。
- **一行代表：** 一个一次性令牌一行
- **写入责任：** 令牌服务
- **读取项目：** HBTI、所有应用
- **数据来源：** 受控令牌签发接口
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 为 HBTI、重置密码或一次性公开流程保存哈希令牌和消费状态。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 失效后保留 180 天用于滥用调查，再删除
- **向外连接：** `user_id` → `app_user.user_id`；`member_id` → `pos_member.member_id`；`campaign_member_id` → `mkt_campaign_member.campaign_member_id`；`application_id` → `hr_application.application_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** token_hash
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** num_nonnulls(user_id, member_id, campaign_member_id, application_id) = 1；consumed_at IS NULL OR revoked_at IS NULL
- **特别说明：** 签发后用途、主体外键、哈希、到期时间和 return_route_code 冻结；仅允许首次写入 consumed_at 或 revoked_at，任一终态后整行冻结。显式外键替代 subject_type+subject_id 多态文本；return_route_code 由服务端注册表解析，metadata 只作证据且绝不能扩大令牌能力。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `one_time_token_id` | 令牌记录ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次性令牌记录稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `27439741-c459-54e4-9014-c8276adbac8e` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `token_purpose` | 令牌用途 | `text` | 非空; 默认 — | 令牌允许完成的单一目的。 | 防止同一令牌跨场景复用。 | CHECK length(token_purpose) > 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `HBTI_SURVEY` | app_one_time_token.token_purpose 只表示本字段说明中的 令牌用途；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `user_id` | 账号ID | `uuid` | 可空; 默认 — | 令牌用于账号重置或账号级一次性动作时连接的应用账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `869c8106-7e07-5851-a6ff-d68b3a2030c3` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `member_id` | 会员ID | `uuid` | 可空; 默认 — | 令牌直接代表会员身份时连接的 POS 会员。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_member.member_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `ca70f98b-3820-5620-9a6b-71b5098f4e17` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `campaign_member_id` | 活动会员ID | `uuid` | 可空; 默认 — | 令牌用于某一活动参与流程时连接的活动会员记录。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_campaign_member.campaign_member_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `7e810e39-f83d-5a4c-8626-de67f132680f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `application_id` | 候选申请ID | `uuid` | 可空; 默认 — | 令牌用于候选预约或资料确认时连接的招聘申请。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_application.application_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `3564ea14-b3b1-590c-b1a9-1e4b50e3e6c1` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `token_hash` | 令牌哈希 | `char(64)` | 非空; 默认 — | 发送给用户的随机令牌哈希。 | 数据库泄漏时不暴露可直接使用的链接。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `secret` | `eb6a...64位十六进制` | app_one_time_token.token_hash 只表示本字段说明中的 令牌哈希；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `expires_at` | 过期时间 | `timestamptz` | 非空; 默认 — | 令牌最后可使用时间。 | 短时授权必须强制过期。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-10T10:00:00+08:00` | app_one_time_token.expires_at 只表示本字段说明中的 过期时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `consumed_at` | 消费时间 | `timestamptz` | 可空; 默认 — | 令牌首次成功使用时间。 | 保证一次性语义。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:10:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `revoked_at` | 撤销时间 | `timestamptz` | 可空; 默认 — | 未消费前被管理员或系统撤销的时间。 | 支持主动失效。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:05:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `return_route_code` | 回跳路由代码 | `text` | 可空; 默认 — | 令牌消费成功后允许进入的已登记内部路由代码；不保存任意 URL。 | 由服务端白名单解析实际地址，阻止开放重定向。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `HBTI_RESULT` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `metadata` | 签发证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 不驱动授权、主体选择或跳转的最小签发上下文快照。 | 仅供滥用调查和兼容核对；不得放秘密、PII、权限、任意 URL 或行为开关。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `{"issuer_release":"hbti-v4"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 14 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `app_rate_limit_event` — 限流计数事件

- **用途：** 记录受保护接口的限流计数，替代 HBTI 专用的孤立限流表。
- **一行代表：** 限流键 × 时间桶一行
- **写入责任：** API 网关或限流服务
- **读取项目：** HBTI、所有应用、安全管理员
- **数据来源：** 受保护接口请求
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 记录受保护接口的限流计数，替代 HBTI 专用的孤立限流表。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 按限流调查需要保留 7 至 30 天
- **向外连接：** 无外键；仍受来源/批次和业务唯一约束控制
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** scope_code + key_hash + window_started_at + window_seconds
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 这是刻意不连接业务身份的短期安全计数：key_hash 不可逆，防止为分析便利反向暴露 IP、会员或令牌。仅计数器可在窗口内原子递增，expires_at 后冻结并清理；它是稳定关联原则的隐私例外。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `rate_limit_event_id` | 限流记录ID | `uuid` | 非空; 默认 gen_random_uuid() | 限流桶稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `c84d15e4-47cd-5cbd-90f8-72cde3442f81` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `scope_code` | 限流范围 | `text` | 非空; 默认 — | 被限制的接口或动作代码。 | 不同接口使用独立阈值。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `HBTI_SUBMIT` | app_rate_limit_event.scope_code 只表示本字段说明中的 限流范围；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `key_hash` | 限流键哈希 | `char(64)` | 非空; 默认 — | IP、会员或令牌等限流键的不可逆哈希。 | 计数但不重复保存原始敏感标识。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `restricted` | `7c22...64位十六进制` | app_rate_limit_event.key_hash 只表示本字段说明中的 限流键哈希；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `window_started_at` | 窗口开始 | `timestamptz` | 非空; 默认 — | 固定限流时间桶开始时间。 | 与 scope_code/key_hash 共同唯一。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:00:00+08:00` | app_rate_limit_event.window_started_at 只表示本字段说明中的 窗口开始；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `window_seconds` | 窗口秒数 | `integer` | 非空; 默认 — | 本限流桶持续秒数。 | 解释 request_count 的时间范围。 | CHECK window_seconds > 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `60` | app_rate_limit_event.window_seconds 只表示本字段说明中的 窗口秒数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `request_count` | 请求次数 | `integer` | 非空; 默认 1 | 该时间桶内已计数的请求数量。 | 判断是否拒绝后续请求。 | CHECK request_count >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `3` | app_rate_limit_event.request_count 只表示本字段说明中的 请求次数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `blocked_count` | 拒绝次数 | `integer` | 非空; 默认 0 | 因超过阈值而被拒绝的请求数量。 | 监控攻击或误配置。 | CHECK blocked_count >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `1` | app_rate_limit_event.blocked_count 只表示本字段说明中的 拒绝次数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `expires_at` | 清理时间 | `timestamptz` | 非空; 默认 — | 该计数桶可安全删除的时间。 | 支持自动清理易失数据。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-10T10:00:00+08:00` | app_rate_limit_event.expires_at 只表示本字段说明中的 清理时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 10 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

# OPS — 地点、产品、预测、计划、执行与班表

## `ops_location` — 统一地点主数据

- **用途：** 统一表示门店、中央厨房、仓库、办公室或兼具多种能力的地点。
- **一行代表：** 每个真实经营地点一行
- **写入责任：** BakeryOps 主数据管理
- **读取项目：** 所有项目
- **数据来源：** 企业地点登记与审核
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 统一表示门店、中央厨房、仓库、办公室或兼具多种能力的地点。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 永久保留；地点关闭只改变状态
- **向外连接：** `parent_location_id` → `ops_location.location_id`
- **被谁连接：** `app_user_location_scope.location_id`；`cost_card_material_price.location_id`；`finance_cashflow_line.location_id`；`finance_import_batch.scope_location_id`；`finance_inventory_flow_line.location_id`；`finance_inventory_snapshot_line.location_id`；`finance_item_sales_monthly.location_id`；`finance_monthly_cost_line.location_id`；`finance_monthly_metric.location_id`；`finance_order_logistics_line.location_id`；`finance_sales_daily.location_id`；`finance_supplier_purchase_monthly.location_id`；`finance_target.location_id`；`hr_appointment.location_id`；`hr_employee_event.from_location_id`；`hr_employee_event.to_location_id`；`hr_employment.home_location_id`；`hr_job_requisition.location_id`；`hr_offer.location_id`；`hr_timesheet_entry.location_id`；`mkt_campaign_version.location_id`；`mkt_reward_stock.location_id`；`ops_business_rule.scope_location_id`；`ops_daily_review.location_id`；`ops_dispatch.from_location_id`；`ops_dispatch.to_location_id`；`ops_forecast_run.location_id`；`ops_location.parent_location_id`；`ops_location_source_identity.location_id`；`ops_operational_event.location_id`；`ops_production_plan_version.location_id`；`ops_production_run.location_id`；`ops_shift_plan_version.location_id`；`ops_station.default_location_id`；`ops_stockout_event.location_id`；`ops_workload_run.location_id`；`pos_daily_breakdown.location_id`；`pos_ingest_batch.location_id`；`pos_item_sales_hour.location_id`；`pos_item_waste.location_id`；`pos_member.home_location_id`；`pos_member_card.issued_location_id`；`pos_member_card_transaction.location_id`；`pos_member_daily_metric.location_id`；`pos_order.location_id`；`pos_product_listing.location_id`；`pos_sales_day.location_id`；`pos_sales_hour.location_id`；`scm_goods_receipt.location_id`；`scm_inventory_count.location_id`；`scm_inventory_movement.from_location_id`；`scm_inventory_movement.to_location_id`；`scm_material_requirement_run.location_id`；`scm_purchase_order_revision.deliver_to_location_id`；`scm_replenishment_run.location_id`
- **分析视图：** `v_cost_card_product_cost_component`、`v_ops_timeslot_sales_baseline`、`v_ops_holiday_factor`
- **唯一约束：** location_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** closed_on IS NULL OR opened_on IS NULL OR closed_on >= opened_on；location_id <> '00000000-0000-0000-0000-000000000000'

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 非空; 默认 gen_random_uuid() | 跨所有模块稳定不变的地点身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `parent_location_id` | 上级地点ID | `uuid` | 可空; 默认 — | 地点层级中的直接上级，例如区域或园区。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `74482f25-3415-581c-8e4b-be0053f2e04c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `location_code` | 地点代码 | `text` | 非空; 默认 — | 程序、文件和业务人员共同使用的唯一不可变代码。 | 在人工沟通中定位地点；跨表仍使用 location_id。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `MY-KUL-PAV-STORE` | ops_location.location_code 只表示本字段说明中的 地点代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `location_name` | 地点名称 | `text` | 非空; 默认 — | 地点当前正式展示名称。 | 只用于显示和搜索，改名不影响历史连接。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `HOT CRUSH Pavilion` | ops_location.location_name 只表示本字段说明中的 地点名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `address_text` | 地点地址 | `text` | 可空; 默认 — | 当前经人工确认的营业或收货地址文本。 | 供招聘、配送和人工核对展示；不作为地点身份或地理距离计算键。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `168 Jalan Bukit Bintang, Kuala Lumpur` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `area_code` | 区域代码 | `text` | 可空; 默认 — | 企业治理的城市、商圈或运营区域代码。 | 支持区域筛选和权限配置；必须使用受控代码，不以自由区域名跨表连接。 | CHECK area_code IS NULL OR area_code ~ '^[A-Z][A-Z0-9_-]{1,63}$' | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `KUL-BUKIT-BINTANG` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `location_type` | 地点类型 | `text` | 非空; 默认 — | STORE、KITCHEN、WAREHOUSE、OFFICE 或 HYBRID。 | 约束哪些业务事实可以落到该地点。 | CHECK location_type IN ('STORE','KITCHEN','WAREHOUSE','OFFICE','HYBRID') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `STORE` | ops_location.location_type 只表示本字段说明中的 地点类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `country_code` | 国家代码 | `char(2)` | 非空; 默认 'MY' | ISO 3166-1 alpha-2 国家代码。 | 确定节假日辖区、币种和合规规则。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `MY` | ops_location.country_code 只表示本字段说明中的 国家代码；必须在所属对象粒度内按 char(2) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `timezone_name` | 时区 | `text` | 非空; 默认 'Asia/Kuala_Lumpur' | IANA 时区名称。 | 把来源时间正确换算为营业日。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `Asia/Kuala_Lumpur` | ops_location.timezone_name 只表示本字段说明中的 时区；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `default_currency` | 默认币种 | `char(3)` | 非空; 默认 'MYR' | 该地点日常经营默认 ISO 4217 币种。 | 解释销售、采购和成本金额。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `MYR` | ops_location.default_currency 只表示本字段说明中的 默认币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `business_day_cutoff` | 营业日切点 | `time` | 非空; 默认 '04:00:00' | 跨午夜营业时，时间归属下一营业日的切点。 | 统一 POS、班表和财务的 business_date 计算。 | — | 本地钟点；必须与地点时区和对应日期组合，不能单独视为绝对时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `04:00:00` | ops_location.business_day_cutoff 只表示本字段说明中的 营业日切点；必须在所属对象粒度内按 time 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `status` | 地点状态 | `text` | 非空; 默认 'ACTIVE' | PLANNED、ACTIVE、SUSPENDED 或 CLOSED。 | 阻止新事实写入已关闭地点，同时保留历史。 | CHECK status IN ('PLANNED','ACTIVE','SUSPENDED','CLOSED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | ops_location.status 只表示本字段说明中的 地点状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `opened_on` | 开业日期 | `date` | 可空; 默认 — | 地点正式开始经营的日期。 | 限定事实有效范围。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2025-11-01` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `closed_on` | 关闭日期 | `date` | 可空; 默认 — | 地点永久停止经营的日期。 | 保留历史并停止未来计划。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2028-12-31` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 16 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_location_source_identity` — 地点来源身份映射

- **用途：** 把 RES、Lark、财务模板等外部地点编号映射到统一 location_id，并保留有效期。
- **一行代表：** 来源系统 × 外部地点ID × 有效期一行
- **写入责任：** BakeryOps 主数据审核
- **读取项目：** 所有项目
- **数据来源：** 外部来源地点目录与人工证据
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 把 RES、Lark、财务模板等外部地点编号映射到统一 location_id，并保留有效期。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `location_id` → `ops_location.location_id`；`source_system_id` → `app_source_system.source_system_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_identity_mapping_gap`
- **唯一约束：** source_system_id + source_container_id + source_location_id + valid_from [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** NO_OVERLAP(source_system_id, COALESCE(source_container_id, ''), source_location_id, tstzrange(valid_from, valid_to, '[)')) WHERE mapping_status = 'CONFIRMED'
- **表级检查：** valid_to IS NULL OR valid_to > valid_from；source_container_id IS NULL OR source_container_id <> ''
- **特别说明：** RES 可将组织ID放入 source_container_id、shop ID 放入 source_location_id；Lark 地点专属 Bitable 映射把 Base app_token 放入 source_container_id、table_id 放入 source_location_id。两者都是可公开定位的对象ID，真实 app_secret/access_token 只能放密钥管理。evidence 只保存批准依据，不承载运行配置字段。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `location_source_identity_id` | 映射ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次地点来源映射稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `3b4b75a6-5944-5007-904f-323fde6b5087` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 映射后的企业统一地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 提供外部地点编号的来源系统。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_container_id` | 来源容器ID | `text` | 可空; 默认 — | 外部地点标识所在的组织、应用、Base 或其他命名空间原始ID；来源没有容器层时为空。 | 避免只在各自容器内唯一的地点/表ID发生冲突；这是公开对象标识，不是登录密钥。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `QkgDblq0qaLpRhsoWCpjHIoqpvb` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `source_location_id` | 外部地点ID | `text` | 非空; 默认 — | 来源系统在 source_container_id 范围内给出的地点、门店或地点专属集合标识，原样保存。 | 与来源系统和可选容器共同构成来源身份，不能用来源名称代替。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `shop_104883` | 这是来源系统证据，不等于企业统一身份。 |
| 6 | `source_location_name` | 外部地点名称 | `text` | 可空; 默认 — | 映射时来源显示的地点名称快照。 | 仅作证据和人工核对，不参与连接。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `吉隆坡Pavilion门店` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `valid_from` | 生效时间 | `timestamptz` | 非空; 默认 now() | 该映射开始有效的时间。 | 处理来源编号复用或组织调整。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2025-11-01T00:00:00+08:00` | ops_location_source_identity.valid_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `valid_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 该映射停止有效的时间。 | 历史事实仍按发生时的有效映射连接。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2027-01-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `mapping_status` | 映射状态 | `text` | 非空; 默认 'PENDING' | CONFIRMED、PENDING 或 REJECTED。 | 只有 CONFIRMED 可进入正式跨域分析。 | CHECK mapping_status IN ('CONFIRMED','PENDING','REJECTED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `CONFIRMED` | ops_location_source_identity.mapping_status 只表示本字段说明中的 映射状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `evidence` | 映射证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 人工确认所依据的来源 URL、截图哈希或业务说明。 | 禁止无证据按名称猜匹配。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"reason":"same RES shop id"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 11 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_product` — 统一产品主数据

- **用途：** 维护 HOT CRUSH 可销售、可生产产品的稳定身份，不等同于某门店 POS listing。
- **一行代表：** 每个企业产品一行
- **写入责任：** BakeryOps 产品主数据管理
- **读取项目：** 所有项目
- **数据来源：** 企业产品目录与人工审核
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 维护 HOT CRUSH 可销售、可生产产品的稳定身份，不等同于某门店 POS listing。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 永久保留；停产产品只改变状态
- **向外连接：** `base_unit_id` → `app_unit.unit_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `cost_card_recipe_version.output_product_id`；`finance_item_sales_monthly.product_id`；`mkt_reward.product_id`；`ops_business_rule.scope_product_id`；`ops_dispatch_line.product_id`；`ops_forecast_line.product_id`；`ops_operational_event_product.product_id`；`ops_product_alias.product_id`；`ops_production_plan_line.product_id`；`ops_production_run_line.product_id`；`ops_workload_line.product_id`；`pos_product_mapping.product_id`；`pos_product_mapping_review.candidate_product_id`
- **分析视图：** `v_product_identity`、`v_pos_member_order_item`、`v_ops_forecast_accuracy`、`v_ops_product_mix_daily`、`v_ops_holiday_factor`
- **唯一约束：** product_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** product_id <> '00000000-0000-0000-0000-000000000000'
- **特别说明：** 本表只保存跨地点稳定的产品主数据与固有生产属性。售价、陈列量、运营定位、目标占比、目标售罄时间、展示顺序和固定出货时刻会随地点或时间变化，进入 ops_business_rule 的 PRODUCT_LOCATION_PLANNING_POLICY 版本，不能污染全局产品行。平均销量、实际销售占比和排名由 POS current 事实视图派生。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `product_id` | 产品ID | `uuid` | 非空; 默认 gen_random_uuid() | 跨预测、销售、配方、成本和营销稳定不变的产品身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `e9c9e097-867a-5929-8bd8-84c74d45b5c4` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `product_code` | 产品代码 | `text` | 非空; 默认 — | 企业内部唯一不可变产品代码。 | 在导入和人工沟通中定位产品。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `HC-P-0042` | ops_product.product_code 只表示本字段说明中的 产品代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `product_name` | 产品名称 | `text` | 非空; 默认 — | 当前正式中文或主要展示名称。 | 只用于显示，不作为跨表连接条件。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `黑巧惠灵顿` | ops_product.product_name 只表示本字段说明中的 产品名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `english_name` | 英文名称 | `text` | 可空; 默认 — | 当前正式英文展示名称。 | 菜单和跨语言搜索。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `Dark Chocolate Wellington` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `product_type` | 产品类型 | `text` | 非空; 默认 — | SELLABLE、PRODUCED、SERVICE 或 BUNDLE。 | 决定是否需要配方、排产或仅用于销售。 | CHECK product_type IN ('SELLABLE','PRODUCED','SERVICE','BUNDLE') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `PRODUCED` | ops_product.product_type 只表示本字段说明中的 产品类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `category_code` | 品类代码 | `text` | 非空; 默认 — | 稳定的开放治理产品品类代码；历史成本卡尚未归类时保留 LEGACY_COST_CARD_UNCLASSIFIED。 | 用于品类占比和预测分层；该历史保留值表示待治理，不是封闭枚举或真实业务品类，不能用自由名称代替。 | CHECK category_code ~ '^[A-Z][A-Z0-9_]{1,63}$' | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `BAKERY_WELLINGTON` | ops_product.category_code 只表示本字段说明中的 品类代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `base_unit_id` | 基础单位ID | `uuid` | 非空; 默认 — | 产品计划、生产、配送和销售统一采用的受控计量单位。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `8d3eb6c1-1126-5b7c-9933-3b8c9028ae3d` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 8 | `pack_multiple` | 包装倍数 | `numeric(18,4)` | 非空; 默认 1 | 排产或配送允许的最小包装倍数。 | 把预测量转换为可执行整数包装量。 | CHECK pack_multiple > 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `6` | ops_product.pack_multiple 只表示本字段说明中的 包装倍数；必须在所属对象粒度内按 numeric(18,4) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `planning_rounding_mode` | 计划取整方式 | `text` | 非空; 默认 'BATCH_MULTIPLE' | BATCH_MULTIPLE 或 INDIVIDUAL；前者按 pack_multiple 取整，后者允许按单个基础单位调整。 | 无损承接现有 product.unit_type，并明确预估量如何转为可执行数量。 | CHECK planning_rounding_mode IN ('BATCH_MULTIPLE','INDIVIDUAL') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `BATCH_MULTIPLE` | ops_product.planning_rounding_mode 只表示本字段说明中的 计划取整方式；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `temperature_profile_code` | 冷热属性代码 | `text` | 可空; 默认 — | HOT、COLD、AMBIENT 或 MIXED。 | 决定补货提前期和生产提示；不是食品安全温度测量值。 | CHECK temperature_profile_code IS NULL OR temperature_profile_code IN ('HOT','COLD','AMBIENT','MIXED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `HOT` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `is_production_planned` | 是否参与排产 | `boolean` | 非空; 默认 false | 该产品是否进入生产预估和排产。 | 饮品或周边可销售但无需生产计划。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `true` | ops_product.is_production_planned 只表示本字段说明中的 是否参与排产；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `is_inventory_tracked` | 是否跟踪成品库存 | `boolean` | 非空; 默认 false | 是否需要记录成品库存或配送。 | 决定生产和仓储链路要求。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `true` | ops_product.is_inventory_tracked 只表示本字段说明中的 是否跟踪成品库存；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `status` | 产品状态 | `text` | 非空; 默认 'DRAFT' | DRAFT、ACTIVE、SUSPENDED 或 RETIRED。 | 停产不删除历史。 | CHECK status IN ('DRAFT','ACTIVE','SUSPENDED','RETIRED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | ops_product.status 只表示本字段说明中的 产品状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 14 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 16 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_product_alias` — 产品别名

- **用途：** 保存人工输入、Excel和历史系统中的产品别称，并明确归一到 product_id。
- **一行代表：** 来源范围 × 一个别名 × 有效期一行
- **写入责任：** BakeryOps 产品主数据管理
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 历史导入和人工确认
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `PARTIAL_FIELDS_DERIVED_IN_VIEW`
- **可派生字段/输出：** normalized_alias -> NORMALIZE_ALIAS(alias_text)
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存人工输入、Excel和历史系统中的产品别称，并明确归一到 product_id。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `product_id` → `ops_product.product_id`；`source_system_id` → `app_source_system.source_system_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** source_system_id + alias_text + valid_from [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** NO_OVERLAP(COALESCE(source_system_id, NIL_UUID), NORMALIZE_ALIAS(alias_text), daterange(valid_from, valid_to, '[)')) WHERE status = 'CONFIRMED'
- **表级检查：** valid_to IS NULL OR valid_to > valid_from；public.app_normalize_alias_v1(alias_text) <> ''
- **特别说明：** normalized_alias 不作为独立字段保存；确认冲突和候选检索统一调用版本锁定的 NORMALIZE_ALIAS(alias_text) 函数或函数索引，避免原文与派生副本漂移。标准化结果不能单独证明产品身份。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `product_alias_id` | 别名ID | `uuid` | 非空; 默认 gen_random_uuid() | 产品别名稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ccdac97b-1502-5f51-8eec-bf6ac296694a` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `product_id` | 产品ID | `uuid` | 非空; 默认 — | 别名明确指向的统一产品。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `e9c9e097-867a-5929-8bd8-84c74d45b5c4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 可空; 默认 — | 别名来自哪个系统；企业通用别名可以为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `alias_text` | 别名文本 | `text` | 非空; 默认 — | 来源中出现的原始产品写法。 | 只在明确范围内辅助匹配，不绕过正式映射。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `黑巧` | ops_product_alias.alias_text 只表示本字段说明中的 别名文本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `language_code` | 语言代码 | `text` | 可空; 默认 — | 别名语言，例如 zh-CN 或 en。 | 支持正确分词和展示。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `zh-CN` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `valid_from` | 生效日期 | `date` | 非空; 默认 CURRENT_DATE | 别名开始有效日期。 | 避免历史同名被错误映射。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-09` | ops_product_alias.valid_from 只表示本字段说明中的 生效日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `valid_to` | 失效日期上界 | `date` | 可空; 默认 — | 别名停止有效的日期上界，该日期本身不再有效。 | 以左闭右开区间保留历史并避免相邻版本重复命中。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2027-01-01` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `status` | 状态 | `text` | 非空; 默认 'PENDING' | CONFIRMED、PENDING 或 REJECTED。 | 只有确认别名可用于自动辅助匹配。 | CHECK status IN ('CONFIRMED','PENDING','REJECTED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `CONFIRMED` | ops_product_alias.status 只表示本字段说明中的 状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 11 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_stockout_event` — 商品断货事件

- **用途：** 记录人工确认或算法识别的断货时段、证据及估算损失。
- **一行代表：** 地点 × listing × 一次连续断货区间一行
- **写入责任：** BakeryOps 断货检测；人工可确认
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** POS 销售停止信号和人工确认
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 记录人工确认或算法识别的断货时段、证据及估算损失。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `location_id` → `ops_location.location_id`；`listing_id` → `pos_product_listing.listing_id`；`detected_job_run_id` → `app_job_run.job_run_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_ops_item_daily_pulse`
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** NO_OVERLAP(location_id, listing_id, tstzrange(started_at, ended_at, '[)')) WHERE status IN ('DETECTED','CONFIRMED','CLOSED')
- **表级检查：** ended_at IS NULL OR ended_at > started_at
- **特别说明：** 由 BakeryOps 依据 POS 信号与人工确认写入，因此按写入责任归入 ops_；POS 原始销售事实仍只由 res_api 写入 pos_。DETECTED 阶段可补证据和结束时间；CONFIRMED、REJECTED 或 CLOSED 后冻结，重算损失必须追加新事件或新估算版本。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `stockout_event_id` | 断货事件ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次连续断货事件稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `3700dc0d-2999-57be-bc2d-02457c6c2982` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 发生断货的门店。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `listing_id` | Listing ID | `uuid` | 非空; 默认 — | 断货商品的来源 listing。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_product_listing.listing_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `7c7d8100-8fc6-5c80-ae85-0969736fe572` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `detected_job_run_id` | 检测任务ID | `uuid` | 可空; 默认 — | 自动识别该事件的任务运行；纯人工录入可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `41633776-217b-51ad-b370-a9fbfefae000` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 断货主要归属营业日。 | 与销售、计划和复盘连接。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 6 | `started_at` | 断货开始 | `timestamptz` | 非空; 默认 — | 确认或估算的售罄开始时间。 | 估算后续损失销售。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-08T18:30:00+08:00` | ops_stockout_event.started_at 只表示本字段说明中的 断货开始；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `ended_at` | 断货结束 | `timestamptz` | 可空; 默认 — | 补货恢复或营业结束时间。 | 定义受影响区间。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-08T22:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `detection_method` | 识别方法 | `text` | 非空; 默认 — | AUTOMATIC、MANUAL 或 CONFIRMED_AUTOMATIC。 | 区分算法信号和人工事实。 | CHECK detection_method IN ('AUTOMATIC','MANUAL','CONFIRMED_AUTOMATIC') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `CONFIRMED_AUTOMATIC` | ops_stockout_event.detection_method 只表示本字段说明中的 识别方法；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `lost_quantity_estimate` | 估算损失数量 | `numeric(18,4)` | 可空; 默认 — | 按该 listing 的 POS 商品单位和批准算法估计因断货少卖的数量。 | 用于机会损失；未确认产品映射和单位时不得跨商品汇总。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `12` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `lost_sales_estimate` | 估算损失销售额 | `numeric(18,4)` | 可空; 默认 — | 按批准算法估计的销售额损失。 | 在报表中必须标记 ESTIMATED。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `336.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `currency` | 估算币种 | `char(3)` | 非空; 默认 'MYR' | lost_sales_estimate 采用的 ISO 4217 币种。 | 确保跨地点汇总前先处理币种。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `MYR` | ops_stockout_event.currency 只表示本字段说明中的 估算币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `estimation_version` | 估算算法版本 | `text` | 可空; 默认 — | 生成损失估算的算法版本。 | 支持重算和比较。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `stockout-loss-v3` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `evidence` | 事件证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 最后销售时刻、后续零销量、人工说明等证据。 | 让自动断货可审核。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `{"last_sale":"18:27"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 14 | `status` | 事件状态 | `text` | 非空; 默认 'DETECTED' | DETECTED、CONFIRMED、REJECTED 或 CLOSED。 | 只有确认事件进入正式损失分析。 | CHECK status IN ('DETECTED','CONFIRMED','REJECTED','CLOSED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `CONFIRMED` | ops_stockout_event.status 只表示本字段说明中的 事件状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 15 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 17 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_calendar_event` — 日历事件

- **用途：** 保存已解析的节假日、学校假期和其他可验证日历事件。
- **一行代表：** 辖区 × 日期 × 事件一行
- **写入责任：** BakeryOps 日历任务
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 已完成并获准使用的日历抓取任务
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_WORKFLOW` — 只允许批准的状态机迁移并记录操作者和时间
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_WORKFLOW_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存已解析的节假日、学校假期和其他可验证日历事件。；人工决定、批准、状态转换或业务副作用本身就是事实，不能从最终结果倒推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `job_run_id` → `app_job_run.job_run_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_ops_timeslot_sales_baseline`、`v_ops_holiday_factor`
- **唯一约束：** job_run_id + jurisdiction_code + event_date + event_name
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** R6 不再另建日历导入批次表：一次抓取就是 app_job_run；需求因子由销售事实、日历事件和算法版本视图计算，预测实际采用值冻结在 forecast_run/line。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `calendar_event_id` | 日历事件ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条日历事件稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `75dac9a4-d221-59b7-b201-b17b4f620bba` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `job_run_id` | 任务运行ID | `uuid` | 非空; 默认 — | 产生事件的日历抓取任务；来源网址、内容哈希、解析器版本和批准证据放在该运行的 input_manifest 与审计事件。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `jurisdiction_code` | 辖区代码 | `text` | 非空; 默认 — | 事件适用辖区。 | 与地点国家和地区匹配。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `MY-14` | ops_calendar_event.jurisdiction_code 只表示本字段说明中的 辖区代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `event_date` | 事件日期 | `date` | 非空; 默认 — | 事件在当地日历发生的日期。 | 与营业日期连接。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-31` | ops_calendar_event.event_date 只表示本字段说明中的 事件日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `event_type` | 事件类型 | `text` | 非空; 默认 — | PUBLIC_HOLIDAY、SCHOOL_HOLIDAY、EVENT 或 CLOSURE。 | 预测可按类型采用不同因子。 | CHECK event_type IN ('PUBLIC_HOLIDAY','SCHOOL_HOLIDAY','EVENT','CLOSURE') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `PUBLIC_HOLIDAY` | ops_calendar_event.event_type 只表示本字段说明中的 事件类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `event_code` | 事件代码 | `text` | 可空; 默认 — | 跨年份或来源可识别的标准事件代码。 | 比较同类事件历史影响。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `MY_NATIONAL_DAY` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `event_name` | 事件名称 | `text` | 非空; 默认 — | 来源确认的事件名称。 | 业务展示和人工核对。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `National Day` | ops_calendar_event.event_name 只表示本字段说明中的 事件名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `is_paid_holiday` | 是否法定带薪假 | `boolean` | 可空; 默认 — | 该地点员工是否按批准规则视为带薪公共假日。 | 供班表和薪资接口参考，不替代劳动规则引擎。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `true` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `status` | 事件状态 | `text` | 非空; 默认 'ACTIVE' | ACTIVE、CANCELLED 或 SUPERSEDED。 | 来源修正时保留旧事件。 | CHECK status IN ('ACTIVE','CANCELLED','SUPERSEDED') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `ACTIVE` | ops_calendar_event.status 只表示本字段说明中的 事件状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 11 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_operational_event` — 运营突发事件

- **用途：** 记录停电、设备故障、人流异常、促销或其他当日突发情况及人工证据。
- **一行代表：** 一个地点的一次连续运营事件一行
- **写入责任：** 门店或区域运营
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 人工确认；部分事件可由系统建议
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 记录停电、设备故障、人流异常、促销或其他当日突发情况及人工证据。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `location_id` → `ops_location.location_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `ops_operational_event_product.operational_event_id`
- **分析视图：** `v_business_timeline`
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** ended_at IS NULL OR ended_at > started_at
- **特别说明：** OPEN 阶段允许补充证据和结束时间；CONFIRMED、RESOLVED 或 REJECTED 后事件冻结，更正追加新事件或审计冲销，不原地改写历史。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `operational_event_id` | 运营事件ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次运营突发稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `79df84ae-cf8c-5dd1-a83b-106687f641c6` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 事件发生地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `event_type` | 事件类型 | `text` | 非空; 默认 — | POWER_OUTAGE、EQUIPMENT_FAILURE、PROMOTION、FOOTFALL_SURGE、STAFF_SHORTAGE 或 OTHER。 | 支持标准化影响分析。 | CHECK event_type IN ('POWER_OUTAGE','EQUIPMENT_FAILURE','PROMOTION','FOOTFALL_SURGE','STAFF_SHORTAGE','OTHER') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `EQUIPMENT_FAILURE` | ops_operational_event.event_type 只表示本字段说明中的 事件类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `event_title` | 事件标题 | `text` | 非空; 默认 — | 简短可读的事件概述。 | 供复盘和时间线展示。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `烤箱2号故障` | ops_operational_event.event_title 只表示本字段说明中的 事件标题；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `started_at` | 开始时间 | `timestamptz` | 非空; 默认 — | 事件实际或估计开始时间。 | 判断受影响销售和生产时段。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-08T13:20:00+08:00` | ops_operational_event.started_at 只表示本字段说明中的 开始时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `ended_at` | 结束时间 | `timestamptz` | 可空; 默认 — | 事件恢复时间；仍持续时为空。 | 计算影响持续时间。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-08T15:10:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `impact_direction` | 影响方向 | `text` | 非空; 默认 — | INCREASE、DECREASE、MIXED 或 UNKNOWN。 | 区分需求上涨和产能下降。 | CHECK impact_direction IN ('INCREASE','DECREASE','MIXED','UNKNOWN') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `DECREASE` | ops_operational_event.impact_direction 只表示本字段说明中的 影响方向；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `impact_summary` | 影响说明 | `text` | 非空; 默认 — | 对产能、销售、人员或服务的可读说明。 | 保留人工判断但不替代量化事实。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `黑巧产能下降约30%` | ops_operational_event.impact_summary 只表示本字段说明中的 影响说明；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `evidence` | 事件证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 照片链接哈希、设备工单或销售差异等脱敏证据。 | 支持审核。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `{"ticket":"EQ-20260808-2"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 10 | `status` | 事件状态 | `text` | 非空; 默认 'OPEN' | OPEN、CONFIRMED、RESOLVED 或 REJECTED。 | 只有确认事件影响正式复盘。 | CHECK status IN ('OPEN','CONFIRMED','RESOLVED','REJECTED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `CONFIRMED` | ops_operational_event.status 只表示本字段说明中的 事件状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_operational_event_product` — 运营事件受影响产品

- **用途：** 明确运营事件影响哪些产品以及影响方向和数量。
- **一行代表：** 运营事件 × 产品一行
- **写入责任：** 门店或区域运营
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 人工确认
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 明确运营事件影响哪些产品以及影响方向和数量。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `operational_event_id` → `ops_operational_event.operational_event_id`；`product_id` → `ops_product.product_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** operational_event_id + product_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 只允许在父事件 OPEN 阶段补充；父事件进入终态后本行冻结。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `operational_event_product_id` | 关系ID | `uuid` | 非空; 默认 gen_random_uuid() | 事件产品影响稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `ab2f2e1c-1030-5c0b-99cb-eb80870aa72b` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `operational_event_id` | 运营事件ID | `uuid` | 非空; 默认 — | 所属运营事件。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_operational_event.operational_event_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `79df84ae-cf8c-5dd1-a83b-106687f641c6` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `product_id` | 产品ID | `uuid` | 非空; 默认 — | 受影响统一产品。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `e9c9e097-867a-5929-8bd8-84c74d45b5c4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `impact_direction` | 影响方向 | `text` | 非空; 默认 — | INCREASE、DECREASE、UNAVAILABLE 或 UNKNOWN。 | 决定预测和复盘解释。 | CHECK impact_direction IN ('INCREASE','DECREASE','UNAVAILABLE','UNKNOWN') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `DECREASE` | ops_operational_event_product.impact_direction 只表示本字段说明中的 影响方向；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `estimated_quantity_impact` | 估计数量影响 | `numeric(18,4)` | 可空; 默认 — | 按事件发生时 product.base_unit 估计的少产或多卖数量，未知为空。 | 只能作为估算，不冒充实际销售或产出。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `-20` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `note` | 补充说明 | `text` | 可空; 默认 — | 产品层面的人工说明。 | 解释无法量化的影响。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `15:10后恢复` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 9 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_forecast_run` — 需求预测运行

- **用途：** 冻结一次预测使用的目标日期、算法、输入清单和结果状态。
- **一行代表：** 地点 × 目标营业日 × 一次算法运行一行
- **写入责任：** BakeryOps 预测任务
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** POS历史、日历、突发事件和业务规则
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_HISTORICAL_DECISION_FACT`；存储类别 `CORE_DECISION_OUTPUT`；可派生性 `CALCULABLE_BUT_CURRENT_INPUTS_CANNOT_RECREATE_PAST_DECISION`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 冻结一次预测使用的目标日期、算法、输入清单和结果状态。；虽然数值可计算，但该版本曾被提出、批准或用于触发行动，历史决定本身不可从当前输入反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `job_run_id` → `app_job_run.job_run_id`；`location_id` → `ops_location.location_id`
- **被谁连接：** `ops_forecast_line.forecast_run_id`；`ops_production_plan_version.forecast_run_id`
- **分析视图：** `v_ops_forecast_accuracy`
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `forecast_run_id` | 预测运行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次预测运行稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `cb2c16a4-7c8a-5bf8-b0f9-cb3e5de7b0db` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `job_run_id` | 任务运行ID | `uuid` | 非空; 默认 — | 执行预测的自动任务。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 预测目标门店或生产地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `target_business_date` | 目标营业日 | `date` | 非空; 默认 — | 预测要回答的营业日期。 | 连接预估单和实际销售。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-10` | ops_forecast_run.target_business_date 只表示本字段说明中的 目标营业日；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `algorithm_version` | 算法版本 | `text` | 非空; 默认 — | 预测算法和参数版本。 | 使结果可重现和比较。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `forecast-v4.2` | ops_forecast_run.algorithm_version 只表示本字段说明中的 算法版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `input_manifest` | 输入版本清单 | `jsonb` | 非空; 默认 — | 销售批次、日历批次、规则版本和人工事件 ID。 | 证明预测使用了哪些事实。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `{"sales_batch":"...","calendar_batch":"..."}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 7 | `status` | 运行状态 | `text` | 非空; 默认 — | RUNNING、SUCCEEDED、PARTIAL、FAILED 或 REJECTED。 | 控制结果能否生成计划。 | CHECK status IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED','REJECTED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `SUCCEEDED` | ops_forecast_run.status 只表示本字段说明中的 运行状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `started_at` | 开始时间 | `timestamptz` | 非空; 默认 — | 预测计算开始时间。 | 运行监控。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T08:00:00+08:00` | ops_forecast_run.started_at 只表示本字段说明中的 开始时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `completed_at` | 完成时间 | `timestamptz` | 可空; 默认 — | 预测计算结束时间。 | 判断新鲜度。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T08:00:12+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 11 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_forecast_line` — 产品预测行

- **用途：** 保存一次预测对每个产品的数量区间和解释。
- **一行代表：** 预测运行 × 产品一行
- **写入责任：** BakeryOps 预测任务
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 预测运行输出
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_HISTORICAL_DECISION_FACT`；存储类别 `CORE_DECISION_OUTPUT`；可派生性 `CALCULABLE_BUT_CURRENT_INPUTS_CANNOT_RECREATE_PAST_DECISION`
- **可派生字段/输出：** accuracy/error -> v_ops_forecast_accuracy
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存一次预测对每个产品的数量区间和解释。；虽然数值可计算，但该版本曾被提出、批准或用于触发行动，历史决定本身不可从当前输入反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `forecast_run_id` → `ops_forecast_run.forecast_run_id`；`product_id` → `ops_product.product_id`
- **被谁连接：** `ops_production_plan_line.forecast_line_id`
- **分析视图：** `v_ops_forecast_accuracy`
- **唯一约束：** forecast_run_id + product_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** lower_bound IS NULL OR lower_bound >= 0；upper_bound IS NULL OR upper_bound >= forecast_quantity

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `forecast_line_id` | 预测行ID | `uuid` | 非空; 默认 gen_random_uuid() | 产品预测行稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `29500033-82c1-5583-8dde-9f65c26caede` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `forecast_run_id` | 预测运行ID | `uuid` | 非空; 默认 — | 所属预测运行。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_forecast_run.forecast_run_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `cb2c16a4-7c8a-5bf8-b0f9-cb3e5de7b0db` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `product_id` | 产品ID | `uuid` | 非空; 默认 — | 被预测产品。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e9c9e097-867a-5929-8bd8-84c74d45b5c4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `forecast_quantity` | 预测数量 | `numeric(18,4)` | 非空; 默认 — | 按 forecast_run 执行时 product.base_unit 计算的中心预测数量。 | 计划量的建议起点，不是人工批准计划；产品基础单位变更必须形成新产品或受控版本。 | CHECK forecast_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `86` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 5 | `lower_bound` | 预测下界 | `numeric(18,4)` | 可空; 默认 — | 批准置信水平下的需求下界。 | 表达不确定性。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `72` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `upper_bound` | 预测上界 | `numeric(18,4)` | 可空; 默认 — | 批准置信水平下的需求上界。 | 表达不确定性。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `101` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `model_explanation` | 模型解释 | `jsonb` | 非空; 默认 '{}'::jsonb | 主要特征、日历因子和异常说明。 | 让运营理解建议来源；不得编造因果。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `{"holiday_factor":1.1}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 8 | `quality_status` | 质量状态 | `text` | 非空; 默认 'COMPLETE' | COMPLETE、LOW_HISTORY、UNMAPPED_INPUT 或 REJECTED。 | 低质量预测必须在计划界面显式提示。 | CHECK quality_status IN ('COMPLETE','LOW_HISTORY','UNMAPPED_INPUT','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `COMPLETE` | ops_forecast_line.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_production_plan_version` — 生产预估单版本

- **用途：** 直接保留某地点某营业日每次预测建议、人工调整、审批、发布或取消，不再为同一自然键另建空壳主单。
- **一行代表：** 生产地点 × 计划营业日 × 版本号一行
- **写入责任：** BakeryOps；审批人改变状态
- **读取项目：** BakeryOps、供应链、分析/BI
- **数据来源：** 预测或人工复制调整
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_HISTORICAL_DECISION_FACT`；存储类别 `CORE_DECISION_OUTPUT`；可派生性 `CALCULABLE_BUT_CURRENT_INPUTS_CANNOT_RECREATE_PAST_DECISION`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** R6_MERGE_INTO: absorb ops_production_plan; location + business date is the stable plan identity
- **为何存表而不是现算视图：** 直接保留某地点某营业日每次预测建议、人工调整、审批、发布或取消，不再为同一自然键另建空壳主单。；虽然数值可计算，但该版本曾被提出、批准或用于触发行动，历史决定本身不可从当前输入反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `location_id` → `ops_location.location_id`；`forecast_run_id` → `ops_forecast_run.forecast_run_id`；`based_on_version_id` → `ops_production_plan_version.production_plan_version_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `ops_production_plan_line.production_plan_version_id`；`ops_production_plan_version.based_on_version_id`；`ops_production_run.production_plan_version_id`；`ops_workload_run.production_plan_version_id`；`scm_material_requirement_run.production_plan_version_id`
- **分析视图：** `v_ops_item_daily_pulse`、`v_ops_plan_vs_production`、`v_cost_card_product_cost_component`、`v_business_timeline`
- **唯一约束：** location_id + plan_business_date + version_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** R6 终审将 ops_production_plan 合并到本表：location_id + plan_business_date 就是跨版本自然身份，另存主单 UUID 和可变头状态只会重复。草稿可受控修改；PUBLISHED、REJECTED、CANCELLED 或 SUPERSEDED 后冻结。任何数量调整或整单取消都追加新版本，产品级来源与理由保存在新版本的 ops_production_plan_line。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `production_plan_version_id` | 预估单版本ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版预估单稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `d945b30e-2375-5023-84db-ba7b76a30afe` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `location_id` | 生产地点ID | `uuid` | 非空; 默认 — | 执行生产的门店或中央厨房。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `plan_business_date` | 计划营业日 | `date` | 非空; 默认 — | 该版本计划产出服务的营业日期。 | 与销售、物料需求和班表使用同一 location_id + business_date 连接。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-10` | ops_production_plan_version.plan_business_date 只表示本字段说明中的 计划营业日；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `forecast_run_id` | 预测运行ID | `uuid` | 可空; 默认 — | 该版本起点的预测运行；纯人工版本可以为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_forecast_run.forecast_run_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `cb2c16a4-7c8a-5bf8-b0f9-cb3e5de7b0db` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `based_on_version_id` | 基础版本ID | `uuid` | 可空; 默认 — | 本版本从哪一旧版本复制或调整。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_production_plan_version.production_plan_version_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `81757317-1083-55c8-8bb6-8c96569edc65` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `version_no` | 版本号 | `integer` | 非空; 默认 — | 同一生产地点和计划营业日内从 1 递增的版本号。 | 清晰排序版本。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `3` | ops_production_plan_version.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `status` | 版本状态 | `text` | 非空; 默认 — | DRAFT、SUBMITTED、APPROVED、PUBLISHED、SUPERSEDED、REJECTED 或 CANCELLED。 | 只有 PUBLISHED 可触发正式物料需求和班表；取消计划必须追加 CANCELLED 版本。 | CHECK status IN ('DRAFT','SUBMITTED','APPROVED','PUBLISHED','SUPERSEDED','REJECTED','CANCELLED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `PUBLISHED` | ops_production_plan_version.status 只表示本字段说明中的 版本状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `change_summary` | 改动摘要 | `text` | 可空; 默认 — | 相对基础版本的人工或系统改动说明。 | 帮助审批者快速理解变化。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `黑巧+12，草莓塔-6` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 审批完成时间。 | 区分提交与批准。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T12:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准该版本的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `published_at` | 发布时间 | `timestamptz` | 可空; 默认 — | 版本成为正式下游输入的时间。 | 物料需求和班表读取的版本门禁。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T12:05:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 14 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_production_plan_line` — 生产预估单产品行

- **用途：** 保存某版本每个产品的计划数量和人工判断来源。
- **一行代表：** 预估单版本 × 产品一行
- **写入责任：** BakeryOps
- **读取项目：** BakeryOps、供应链、分析/BI
- **数据来源：** 预测行加人工调整
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_HISTORICAL_DECISION_FACT`；存储类别 `CORE_DECISION_OUTPUT`；可派生性 `CALCULABLE_BUT_CURRENT_INPUTS_CANNOT_RECREATE_PAST_DECISION`
- **可派生字段/输出：** adjustment_delta -> compare quantity with based_on_plan_line_id
- **R6 审计动作：** R6_MERGE_INTO: absorb ops_plan_adjustment reason and provenance into a new plan-version line; derive delta
- **为何存表而不是现算视图：** 保存某版本每个产品的计划数量和人工判断来源。；虽然数值可计算，但该版本曾被提出、批准或用于触发行动，历史决定本身不可从当前输入反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `production_plan_version_id` → `ops_production_plan_version.production_plan_version_id`；`product_id` → `ops_product.product_id`；`forecast_line_id` → `ops_forecast_line.forecast_line_id`；`based_on_plan_line_id` → `ops_production_plan_line.production_plan_line_id`；`unit_id` → `app_unit.unit_id`；`suggested_by_ai_call_id` → `ai_call.ai_call_id`；`confirmed_by_user_id` → `app_user.user_id`
- **被谁连接：** `ops_production_plan_line.based_on_plan_line_id`；`ops_production_plan_slot.production_plan_line_id`；`ops_production_run_line.production_plan_line_id`；`scm_material_requirement_component.production_plan_line_id`
- **分析视图：** `v_ops_item_daily_pulse`、`v_ops_plan_vs_production`、`v_scm_material_requirement_trace`、`v_cost_card_product_cost_component`
- **唯一约束：** production_plan_version_id + product_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** before quantity 和 delta 由 based_on_plan_line_id 与 planned_quantity 确定性派生；这里只保存不可派生的产品级决定、理由和来源。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `production_plan_line_id` | 计划行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条产品计划行稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `747a7590-ebe9-5a77-bc6c-c9769d1aff93` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `production_plan_version_id` | 预估单版本ID | `uuid` | 非空; 默认 — | 所属预估单版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_production_plan_version.production_plan_version_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `d945b30e-2375-5023-84db-ba7b76a30afe` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `product_id` | 产品ID | `uuid` | 非空; 默认 — | 计划生产的统一产品。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e9c9e097-867a-5929-8bd8-84c74d45b5c4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `forecast_line_id` | 预测行ID | `uuid` | 可空; 默认 — | 该计划行采用的预测建议；纯人工添加可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_forecast_line.forecast_line_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `29500033-82c1-5583-8dde-9f65c26caede` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `based_on_plan_line_id` | 基础计划行ID | `uuid` | 可空; 默认 — | 本产品行从上一版本哪一行复制或调整；首次或新增产品为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_production_plan_line.production_plan_line_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `278b6dbe-8186-5273-9050-e857c2c0d697` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `planned_quantity` | 计划数量 | `numeric(18,4)` | 非空; 默认 — | 该版本按本行 unit_id 批准准备的总数量。 | 物料需求、工作量和计划偏差的基准。 | CHECK planned_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `96` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 7 | `unit_id` | 计划单位ID | `uuid` | 非空; 默认 — | 计划数量采用的受控单位，发布时必须等于产品基础单位。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `3cf62aa7-6657-5f04-b833-b7d7163ad827` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 8 | `adjustment_reason_code` | 调整原因代码 | `text` | 可空; 默认 — | 若偏离预测，记录批准原因。 | 分析人工判断效果。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `HOLIDAY_UPLIFT` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `adjustment_note` | 调整依据说明 | `text` | 可空; 默认 — | 本产品相对基础行发生变化时的必要理由。 | 保留产品级人工判断，不把多个产品原因压到版本头。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `公共假日前一日客流通常上升` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `suggested_by_ai_call_id` | 建议AI调用ID | `uuid` | 可空; 默认 — | 若该产品数量来自 AI 建议，连接产生建议的调用。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ai_call.ai_call_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `56ac21ed-c901-5115-addc-a09330013082` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `confirmed_by_user_id` | 确认账号 | `uuid` | 可空; 默认 — | 确认采用该产品数量的应用账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `5f404280-ef9e-5df5-8e23-3f38a16d06d9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `note` | 计划备注 | `text` | 可空; 默认 — | 产品层面的简短执行说明。 | 传递不能结构化的必要信息。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `首批提前30分钟` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_production_plan_slot` — 生产时段计划

- **用途：** 把产品总计划拆到具体生产时段，解决总量正确但时段断货的问题。
- **一行代表：** 计划产品行 × 生产时段一行
- **写入责任：** BakeryOps
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 运营排产
- **实施层级：** `EXTENSION_PACK:PRODUCTION_EXECUTION`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 把产品总计划拆到具体生产时段，解决总量正确但时段断货的问题。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `production_plan_line_id` → `ops_production_plan_line.production_plan_line_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** production_plan_line_id + sequence_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** slot_end > slot_start

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `production_plan_slot_id` | 时段计划ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条时段计划稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `05d5cdb2-1362-5dde-9a66-cbacc21cb4be` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `production_plan_line_id` | 计划行ID | `uuid` | 非空; 默认 — | 所属产品计划行。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_production_plan_line.production_plan_line_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `747a7590-ebe9-5a77-bc6c-c9769d1aff93` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `slot_start` | 时段开始 | `time` | 非空; 默认 — | 当地营业日内生产时段开始时间。 | 决定实际生产顺序。 | — | 本地钟点；必须与地点时区和对应日期组合，不能单独视为绝对时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `08:00:00` | ops_production_plan_slot.slot_start 只表示本字段说明中的 时段开始；必须在所属对象粒度内按 time 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `slot_end` | 时段结束 | `time` | 非空; 默认 — | 生产时段结束时间。 | 定义时段边界。 | — | 本地钟点；必须与地点时区和对应日期组合，不能单独视为绝对时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `10:00:00` | ops_production_plan_slot.slot_end 只表示本字段说明中的 时段结束；必须在所属对象粒度内按 time 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `planned_quantity` | 时段计划数量 | `numeric(18,4)` | 非空; 默认 — | 按父计划行 unit_id 统计的本时段应完成数量。 | 与实际产出和断货时点比较；所有时段合计由视图核对父行数量。 | CHECK planned_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `36` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 6 | `sequence_no` | 执行顺序 | `integer` | 非空; 默认 — | 同产品时段的显示和执行顺序。 | 稳定排序。 | CHECK sequence_no > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1` | ops_production_plan_slot.sequence_no 只表示本字段说明中的 执行顺序；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_workload_run` — 工作量计算运行

- **用途：** 把已发布生产计划和预测销售转换为岗位/工位所需分钟，作为班表显式上游。
- **一行代表：** 地点 × 营业日 × 一次工作量计算一行
- **写入责任：** BakeryOps 工作量任务
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 已发布预估单、历史服务量和标准工时
- **实施层级：** `EXTENSION_PACK:SHIFT_AND_WORKFORCE`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 把已发布生产计划和预测销售转换为岗位/工位所需分钟，作为班表显式上游。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `job_run_id` → `app_job_run.job_run_id`；`location_id` → `ops_location.location_id`；`production_plan_version_id` → `ops_production_plan_version.production_plan_version_id`
- **被谁连接：** `ops_shift_plan_version.workload_run_id`；`ops_workload_line.workload_run_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `workload_run_id` | 工作量运行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次工作量计算稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `20faf3d2-8fd5-58a3-b654-7c3f56fe8805` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `job_run_id` | 任务运行ID | `uuid` | 非空; 默认 — | 执行计算的自动任务。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 工作量目标地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `production_plan_version_id` | 预估单版本ID | `uuid` | 可空; 默认 — | 工作量采用的已发布生产计划。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_production_plan_version.production_plan_version_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `d945b30e-2375-5023-84db-ba7b76a30afe` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 需要安排人员的日期。 | 连接班表主单。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-10` | 不要由 created_at 或 UTC 日期临时推导。 |
| 6 | `algorithm_version` | 算法版本 | `text` | 非空; 默认 — | 标准工时和转换规则版本。 | 支持重算和解释需求变化。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `workload-v1` | ops_workload_run.algorithm_version 只表示本字段说明中的 算法版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `input_manifest` | 输入清单 | `jsonb` | 非空; 默认 — | 计划版本、销售预测、营业时段和规则版本。 | 证明班表需求来源。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `{"plan_version":"..."}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 8 | `status` | 运行状态 | `text` | 非空; 默认 — | RUNNING、SUCCEEDED、PARTIAL、FAILED 或 REJECTED。 | 只有合格结果可进入班表。 | CHECK status IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED','REJECTED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `SUCCEEDED` | ops_workload_run.status 只表示本字段说明中的 运行状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 10 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_workload_line` — 岗位工作量行

- **用途：** 保存某工作量运行对岗位、工位及可选产品的需求分钟和数量依据。
- **一行代表：** 工作量运行 × 岗位 × 工位 × 可选产品一行
- **写入责任：** BakeryOps 工作量任务
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 工作量计算输出
- **实施层级：** `EXTENSION_PACK:SHIFT_AND_WORKFORCE`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 保存某工作量运行对岗位、工位及可选产品的需求分钟和数量依据。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `workload_run_id` → `ops_workload_run.workload_run_id`；`role_id` → `ops_role.role_id`；`station_id` → `ops_station.station_id`；`product_id` → `ops_product.product_id`
- **被谁连接：** `ops_shift_requirement.workload_line_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** workload_run_id + role_id + station_id + product_id + workload_unit [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** required_work_minutes 是按 algorithm_version 冻结的运行输出；因最低开岗、并行和取整不一定等于简单乘法，具体公式必须在 explanation 中可复算。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `workload_line_id` | 工作量行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条工作量需求稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `9381ed17-93e6-5b7f-b8b0-d319d4b1961d` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `workload_run_id` | 工作量运行ID | `uuid` | 非空; 默认 — | 所属工作量运行。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_workload_run.workload_run_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `20faf3d2-8fd5-58a3-b654-7c3f56fe8805` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `role_id` | 岗位ID | `uuid` | 非空; 默认 — | 需要人员履行的标准岗位。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_role.role_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `a28ce29f-93bc-5620-a42b-c652824558c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `station_id` | 工位ID | `uuid` | 可空; 默认 — | 工作发生工位；无具体工位可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_station.station_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `0750f6ee-4f5e-5628-aa23-27a9a4d0ec54` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `product_id` | 产品ID | `uuid` | 可空; 默认 — | 该工作量由特定产品产生时记录。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e9c9e097-867a-5929-8bd8-84c74d45b5c4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `workload_unit` | 工作量单位 | `text` | 非空; 默认 — | PRODUCT_EA、ORDER、CUSTOMER、OPEN_HOUR 或 MANUAL。 | 解释 workload_quantity。 | CHECK workload_unit IN ('PRODUCT_EA','ORDER','CUSTOMER','OPEN_HOUR','MANUAL') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `PRODUCT_EA` | ops_workload_line.workload_unit 只表示本字段说明中的 工作量单位；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `workload_quantity` | 工作量数量 | `numeric(18,4)` | 非空; 默认 — | 计划产品数、预测订单数等输入数量。 | 与标准分钟相乘。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `96` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `standard_minutes_per_unit` | 单位标准分钟 | `numeric(18,6)` | 非空; 默认 — | 每单位工作量所需标准分钟。 | 将业务量转换为用工需求。 | CHECK standard_minutes_per_unit >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1.250000` | ops_workload_line.standard_minutes_per_unit 只表示本字段说明中的 单位标准分钟；必须在所属对象粒度内按 numeric(18,6) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `required_work_minutes` | 需求工作分钟 | `numeric(18,4)` | 非空; 默认 — | 该行计算出的总需求分钟。 | 班表人数和时长的直接依据。 | CHECK required_work_minutes >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `120` | ops_workload_line.required_work_minutes 只表示本字段说明中的 需求工作分钟；必须在所属对象粒度内按 numeric(18,4) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `explanation` | 计算说明 | `jsonb` | 非空; 默认 '{}'::jsonb | 取整、并行、最低开岗等规则明细。 | 让排班者理解算法。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `{"minimum_staff":1}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_production_run` — 实际生产批次

- **用途：** 记录一次真实生产执行，不用计划数量冒充实际产出。
- **一行代表：** 生产地点 × 营业日 × 一次生产批次一行
- **写入责任：** 门店/厨房执行流程
- **读取项目：** BakeryOps、供应链、分析/BI
- **数据来源：** 生产人员确认或设备数据
- **实施层级：** `EXTENSION_PACK:PRODUCTION_EXECUTION`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 记录一次真实生产执行，不用计划数量冒充实际产出。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `location_id` → `ops_location.location_id`；`production_plan_version_id` → `ops_production_plan_version.production_plan_version_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `ops_dispatch.production_run_id`；`ops_production_run_line.production_run_id`；`scm_inventory_movement.production_run_id`
- **分析视图：** `v_ops_plan_vs_production`、`v_business_timeline`
- **唯一约束：** location_id + source_run_code [NULLS DISTINCT：仅非空值去重，允许多条空值]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** completed_at IS NULL OR completed_at >= started_at

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `production_run_id` | 生产批次ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次实际生产批次稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `3dda38c0-ed06-51d0-be35-80d796c36312` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `location_id` | 生产地点ID | `uuid` | 非空; 默认 — | 实际执行生产的地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `production_plan_version_id` | 预估单版本ID | `uuid` | 可空; 默认 — | 该批次执行的已发布计划版本；临时生产可为空并说明。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_production_plan_version.production_plan_version_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `d945b30e-2375-5023-84db-ba7b76a30afe` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 生产产出服务的营业日。 | 与销售和成本连接。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-10` | 不要由 created_at 或 UTC 日期临时推导。 |
| 5 | `source_run_code` | 执行批次代码 | `text` | 可空; 默认 — | 现场或设备使用的可读批次编号。 | 现场追踪和幂等。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `PAV-20260810-01` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `started_at` | 开始时间 | `timestamptz` | 非空; 默认 — | 实际开工时间。 | 分析延迟和产能。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-10T06:30:00+08:00` | ops_production_run.started_at 只表示本字段说明中的 开始时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `completed_at` | 完成时间 | `timestamptz` | 可空; 默认 — | 本批生产完成时间。 | 计算工时和及时率。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-10T08:20:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `status` | 执行状态 | `text` | 非空; 默认 — | IN_PROGRESS、COMPLETED、CANCELLED 或 REJECTED。 | 只有完成批次进入实际产出。 | CHECK status IN ('IN_PROGRESS','COMPLETED','CANCELLED','REJECTED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `COMPLETED` | ops_production_run.status 只表示本字段说明中的 执行状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `note` | 执行备注 | `text` | 可空; 默认 — | 异常或临时加产说明。 | 解释偏差。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `烤箱预热延迟10分钟` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 12 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_production_run_line` — 实际生产产品行

- **用途：** 保存实际生产的合格、报废和返工数量，并可追溯到计划行。
- **一行代表：** 生产批次 × 产品一行
- **写入责任：** 门店/厨房执行流程
- **读取项目：** BakeryOps、供应链、分析/BI
- **数据来源：** 生产人员确认或设备数据
- **实施层级：** `EXTENSION_PACK:PRODUCTION_EXECUTION`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 保存实际生产的合格、报废和返工数量，并可追溯到计划行。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `production_run_id` → `ops_production_run.production_run_id`；`product_id` → `ops_product.product_id`；`production_plan_line_id` → `ops_production_plan_line.production_plan_line_id`；`unit_id` → `app_unit.unit_id`
- **被谁连接：** `ops_dispatch_line.production_run_line_id`
- **分析视图：** `v_ops_item_daily_pulse`、`v_ops_plan_vs_production`、`v_ops_production_vs_dispatch`
- **唯一约束：** production_run_id + product_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `production_run_line_id` | 生产行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条实际产出稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `20715ec4-7921-5f62-bfad-44fd5a8b708e` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `production_run_id` | 生产批次ID | `uuid` | 非空; 默认 — | 所属实际生产批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_production_run.production_run_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `3dda38c0-ed06-51d0-be35-80d796c36312` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `product_id` | 产品ID | `uuid` | 非空; 默认 — | 实际生产产品。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e9c9e097-867a-5929-8bd8-84c74d45b5c4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `production_plan_line_id` | 计划行ID | `uuid` | 可空; 默认 — | 对应计划产品行；临时加产可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_production_plan_line.production_plan_line_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `747a7590-ebe9-5a77-bc6c-c9769d1aff93` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `good_quantity` | 合格数量 | `numeric(18,4)` | 非空; 默认 — | 按本行 unit_id 记录的可销售或可配送合格产出数量。 | 计划达成和库存增加。 | CHECK good_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `94` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 6 | `scrap_quantity` | 报废数量 | `numeric(18,4)` | 非空; 默认 0 | 按本行 unit_id 记录的生产阶段无法使用数量。 | 生产损耗和成本。 | CHECK scrap_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 7 | `rework_quantity` | 返工数量 | `numeric(18,4)` | 非空; 默认 0 | 按本行 unit_id 记录的需要返工但尚未报废数量。 | 避免把返工算作合格产出。 | CHECK rework_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `0` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `unit_id` | 数量单位ID | `uuid` | 非空; 默认 — | 实际产出采用的受控单位，必须与产品基础单位一致。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `3cf62aa7-6657-5f04-b833-b7d7163ad827` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_dispatch` — 地点间配送

- **用途：** 记录成品从中央厨房或门店发往另一地点的一次配送。
- **一行代表：** 发出地点 × 接收地点 × 一次配送批次一行
- **写入责任：** 配送执行流程
- **读取项目：** BakeryOps、供应链、分析/BI
- **数据来源：** 人工确认或物流系统
- **实施层级：** `EXTENSION_PACK:PRODUCTION_EXECUTION`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 记录成品从中央厨房或门店发往另一地点的一次配送。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `from_location_id` → `ops_location.location_id`；`to_location_id` → `ops_location.location_id`；`production_run_id` → `ops_production_run.production_run_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `ops_dispatch_line.dispatch_id`
- **分析视图：** `v_ops_production_vs_dispatch`、`v_business_timeline`
- **唯一约束：** dispatch_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** from_location_id <> to_location_id；received_at IS NULL OR received_at >= dispatched_at

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `dispatch_id` | 配送ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次地点间配送稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `dc9b1481-2796-59b8-bc87-be4cab44bcbe` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `from_location_id` | 发出地点ID | `uuid` | 非空; 默认 — | 成品发出地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `77f31b24-36f5-5ee1-87f7-be46d3e61aed` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `to_location_id` | 接收地点ID | `uuid` | 非空; 默认 — | 成品接收地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `65c0f94a-9db6-55cb-afad-69d11d70d100` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `production_run_id` | 生产批次ID | `uuid` | 可空; 默认 — | 配送主要来自的生产批次；混批可为空并由行级追踪。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_production_run.production_run_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `3dda38c0-ed06-51d0-be35-80d796c36312` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `dispatch_code` | 配送单号 | `text` | 非空; 默认 — | 现场或物流使用的唯一单号。 | 幂等和业务沟通。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `DSP-20260810-01` | ops_dispatch.dispatch_code 只表示本字段说明中的 配送单号；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 配送服务的营业日。 | 连接门店销售和计划。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-10` | 不要由 created_at 或 UTC 日期临时推导。 |
| 7 | `dispatched_at` | 发出时间 | `timestamptz` | 非空; 默认 — | 货物离开发出地点的时间。 | 计算在途和及时性。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-10T09:00:00+08:00` | ops_dispatch.dispatched_at 只表示本字段说明中的 发出时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `received_at` | 接收时间 | `timestamptz` | 可空; 默认 — | 接收地点确认到货时间。 | 闭环配送。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-10T09:35:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `status` | 配送状态 | `text` | 非空; 默认 — | PLANNED、DISPATCHED、RECEIVED、PARTIAL、CANCELLED。 | 区分计划、在途和实收。 | CHECK status IN ('PLANNED','DISPATCHED','RECEIVED','PARTIAL','CANCELLED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `RECEIVED` | ops_dispatch.status 只表示本字段说明中的 配送状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 12 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_dispatch_line` — 配送产品行

- **用途：** 保存配送中每个产品的发出、接收、拒收和差异数量。
- **一行代表：** 配送单 × 产品一行
- **写入责任：** 配送执行流程
- **读取项目：** BakeryOps、供应链、分析/BI
- **数据来源：** 发出与接收确认
- **实施层级：** `EXTENSION_PACK:PRODUCTION_EXECUTION`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 保存配送中每个产品的发出、接收、拒收和差异数量。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `dispatch_id` → `ops_dispatch.dispatch_id`；`product_id` → `ops_product.product_id`；`production_run_line_id` → `ops_production_run_line.production_run_line_id`；`unit_id` → `app_unit.unit_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_ops_item_daily_pulse`、`v_ops_production_vs_dispatch`
- **唯一约束：** dispatch_id + product_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `dispatch_line_id` | 配送行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条配送产品行稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e5a06d1f-0ff8-5515-a874-db562c08050b` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `dispatch_id` | 配送ID | `uuid` | 非空; 默认 — | 所属配送单。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_dispatch.dispatch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `dc9b1481-2796-59b8-bc87-be4cab44bcbe` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `product_id` | 产品ID | `uuid` | 非空; 默认 — | 配送产品。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e9c9e097-867a-5929-8bd8-84c74d45b5c4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `production_run_line_id` | 生产行ID | `uuid` | 可空; 默认 — | 来源生产行；无法唯一分配时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_production_run_line.production_run_line_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `20715ec4-7921-5f62-bfad-44fd5a8b708e` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `dispatched_quantity` | 发出数量 | `numeric(18,4)` | 非空; 默认 — | 按本行 unit_id 记录的发出地点确认数量。 | 在途和发出事实。 | CHECK dispatched_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `48` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 6 | `received_quantity` | 接收数量 | `numeric(18,4)` | 可空; 默认 — | 按本行 unit_id 记录的接收地点确认合格数量。 | 实际可售数量。 | CHECK received_quantity IS NULL OR received_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `47` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `rejected_quantity` | 拒收数量 | `numeric(18,4)` | 非空; 默认 0 | 按本行 unit_id 记录的接收时拒收或损坏数量。 | 配送损耗和责任分析。 | CHECK rejected_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `variance_reason` | 差异原因 | `text` | 可空; 默认 — | 发出与接收不一致的原因。 | 闭环异常。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `TRANSPORT_DAMAGE` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `unit_id` | 数量单位ID | `uuid` | 非空; 默认 — | 配送数量采用的受控单位，必须与产品基础单位一致。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `3cf62aa7-6657-5f04-b833-b7d7163ad827` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_daily_review` — 每日运营复盘

- **用途：** 保存某地点营业日的结构化复盘版本，区分人工事实、AI总结和采纳状态。
- **一行代表：** 地点 × 营业日 × 复盘版本一行
- **写入责任：** BakeryOps 复盘流程
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** POS、计划、生产、班表、突发与人工输入
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_WORKFLOW_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存某地点营业日的结构化复盘版本，区分人工事实、AI总结和采纳状态。；人工决定、批准、状态转换或业务副作用本身就是事实，不能从最终结果倒推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `location_id` → `ops_location.location_id`；`ai_call_id` → `ai_call.ai_call_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `ops_review_action.daily_review_id`
- **分析视图：** `v_ops_daily_review_current`
- **唯一约束：** location_id + business_date + version_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** (manager_avg_transaction IS NULL AND manager_avg_transaction_source IS NULL) OR (manager_avg_transaction IS NOT NULL AND manager_avg_transaction_source IS NOT NULL)
- **特别说明：** 保存只修改 DRAFT；提交/批准后冻结。若店长或 POS 后续更正，复制为 version_no+1 并将旧版标为 SUPERSEDED。manager_input 与 review_summary 必须分别按其 schema version 通过受控写函数校验，未知键拒绝。manager_avg_transaction 只承接带明确 source 的历史或人工独立报告值；新系统计算值由视图从 manager_revenue / manager_transaction_count 派生。正式 current 读取按 v_ops_daily_review_current 的确定性规则选版。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `daily_review_id` | 复盘ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版每日复盘稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `9a63d4e8-9124-5201-bc2e-ad02fad644ba` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 复盘地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 被复盘的营业日。 | 与全部经营事实连接。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 4 | `version_no` | 版本号 | `integer` | 非空; 默认 — | 同地点同日期的复盘版本。 | 人工修正不覆盖旧内容。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2` | ops_daily_review.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `ai_call_id` | AI调用ID | `uuid` | 可空; 默认 — | 生成或辅助该复盘的 AI 调用。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ai_call.ai_call_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `b54a374d-3dfa-5920-b9b1-67c507eefc5b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `manager_revenue` | 店长录入营收 | `numeric(18,4)` | 可空; 默认 — | 店长对该营业日确认或录入的营收金额。 | 与 POS 营收独立保存并用于差异核对，不能藏在 JSON 中。 | CHECK manager_revenue IS NULL OR manager_revenue >= 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `18520.40` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `manager_transaction_count` | 店长录入交易数 | `integer` | 可空; 默认 — | 店长确认的该营业日交易笔数。 | 与 POS 交易数核对。 | CHECK manager_transaction_count IS NULL OR manager_transaction_count >= 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `312` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `manager_avg_transaction` | 店长报告平均客单 | `numeric(18,4)` | 可空; 默认 — | 店长或现有来源独立报告的平均每笔交易金额；若只是 manager_revenue ÷ manager_transaction_count 的系统计算结果则必须留空。 | 无损保留历史独立观察值并与可派生客单核对，禁止重复存同一计算结果。 | CHECK manager_avg_transaction IS NULL OR manager_avg_transaction >= 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `59.36` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `manager_avg_transaction_source` | 店长客单来源 | `text` | 可空; 默认 — | manager_avg_transaction 非空时必须说明 INDEPENDENT_MANAGER_REPORT、INDEPENDENT_SOURCE_REPORT 或 MIGRATED_LEGACY。 | 用机器约束证明该值是独立观察而不是系统重复计算。 | CHECK manager_avg_transaction_source IS NULL OR manager_avg_transaction_source IN ('INDEPENDENT_MANAGER_REPORT','INDEPENDENT_SOURCE_REPORT','MIGRATED_LEGACY') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `INDEPENDENT_MANAGER_REPORT` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `manager_revenue_at` | 店长营收录入时间 | `timestamptz` | 可空; 默认 — | 店长营收数字被确认的绝对时间。 | 判断录入新鲜度和版本来源；不是营业日。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T09:15:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `manager_currency` | 店长金额币种 | `char(3)` | 非空; 默认 'MYR' | 店长录入营收和平均客单的币种。 | 防止跨币种错误核对。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `MYR` | ops_daily_review.manager_currency 只表示本字段说明中的 店长金额币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `manager_input_schema_version` | 店长补充输入结构版本 | `text` | 非空; 默认 'daily-review-manager-v1' | manager_input JSON 的批准结构版本。 | 允许新增低频原因时仍能解释历史 JSON。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `daily-review-manager-v1` | ops_daily_review.manager_input_schema_version 只表示本字段说明中的 店长补充输入结构版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `manager_input` | 店长补充输入 | `jsonb` | 非空; 默认 '{}'::jsonb | 店长确认的突发事件、原因、备注和暂未升格的低频信息。 | 补充结构化列；不得再次放入营收、交易数、客单价等稳定分析字段。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"event":"rain","tomorrow_action":"reduce_first_batch"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 14 | `review_summary_schema_version` | 复盘摘要结构版本 | `text` | 非空; 默认 'daily-review-summary-v1' | review_summary JSON 采用的批准结构版本。 | 保证历史复盘在结构升级后仍可验证和解释。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `daily-review-summary-v1` | ops_daily_review.review_summary_schema_version 只表示本字段说明中的 复盘摘要结构版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 15 | `review_summary` | 结构化复盘 | `jsonb` | 非空; 默认 — | 按批准 schema 保存结论、指标和证据引用。 | 支持稳定分析，不依赖自由文本解析。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"forecast_accuracy":0.82}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 16 | `status` | 复盘状态 | `text` | 非空; 默认 — | DRAFT、SUBMITTED、APPROVED 或 SUPERSEDED。 | 只有批准复盘进入正式改进行动。 | CHECK status IN ('DRAFT','SUBMITTED','APPROVED','SUPERSEDED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `APPROVED` | ops_daily_review.status 只表示本字段说明中的 复盘状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 17 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准复盘的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 复盘批准时间。 | 审计决策。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 20 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 21 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_review_action` — 复盘改进行动

- **用途：** 把复盘建议变成有负责人、期限和完成状态的动作。
- **一行代表：** 复盘 × 一项改进行动一行
- **写入责任：** 门店或区域运营
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 已批准复盘或人工创建
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 把复盘建议变成有负责人、期限和完成状态的动作。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `daily_review_id` → `ops_daily_review.daily_review_id`；`owner_employment_id` → `hr_employment.employment_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `msg_outbound_message.review_action_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `review_action_id` | 行动ID | `uuid` | 非空; 默认 gen_random_uuid() | 一项改进行动稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `faaa6821-9281-5916-94f4-07143f20a93e` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `daily_review_id` | 复盘ID | `uuid` | 非空; 默认 — | 行动来源复盘。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_daily_review.daily_review_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `9a63d4e8-9124-5201-bc2e-ad02fad644ba` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `action_type` | 行动类型 | `text` | 非空; 默认 — | PLAN_ADJUSTMENT、TRAINING、MAINTENANCE、SUPPLY、STAFFING 或 OTHER。 | 路由到正确业务模块。 | CHECK action_type IN ('PLAN_ADJUSTMENT','TRAINING','MAINTENANCE','SUPPLY','STAFFING','OTHER') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `PLAN_ADJUSTMENT` | ops_review_action.action_type 只表示本字段说明中的 行动类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `action_description` | 行动说明 | `text` | 非空; 默认 — | 具体、可验证的下一步。 | 避免只保存泛泛建议。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `明日黑巧首批增加12个` | ops_review_action.action_description 只表示本字段说明中的 行动说明；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `owner_employment_id` | 负责人雇佣ID | `uuid` | 可空; 默认 — | 负责完成行动的员工。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_employment.employment_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `24247fb7-99f1-5f0a-9124-5434f5cb8d36` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `due_at` | 截止时间 | `timestamptz` | 可空; 默认 — | 行动应完成时间。 | 跟踪逾期。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T18:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `status` | 行动状态 | `text` | 非空; 默认 'OPEN' | OPEN、IN_PROGRESS、COMPLETED、CANCELLED 或 REJECTED。 | 形成复盘闭环。 | CHECK status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED','REJECTED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `OPEN` | ops_review_action.status 只表示本字段说明中的 行动状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `completed_at` | 完成时间 | `timestamptz` | 可空; 默认 — | 行动实际完成时间。 | 计算执行及时率。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T17:20:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `completion_evidence` | 完成证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 相关新计划版本、培训结果或工单 ID。 | 证明行动真正落地。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `{"plan_version_id":"..."}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 10 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 12 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_business_rule` — 运营业务规则

- **用途：** 版本化保存企业级、地点级、产品级或地点产品级的排产阈值、产品策略、招聘可预约窗口和断货排除等低频配置。
- **一行代表：** 适用地点/产品组合或企业全局 × 规则代码 × 版本一行
- **写入责任：** BakeryOps 设置流程
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 管理员配置
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 版本化保存企业级、地点级、产品级或地点产品级的排产阈值、产品策略、招聘可预约窗口和断货排除等低频配置。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `scope_location_id` → `ops_location.location_id`；`scope_product_id` → `ops_product.product_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_cost_card_product_cost_snapshot`、`v_ops_timeslot_sales_baseline`、`v_ops_holiday_factor`
- **唯一约束：** scope_location_id + scope_product_id + rule_code + version_no [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** NO_OVERLAP(COALESCE(scope_location_id, NIL_UUID), COALESCE(scope_product_id, NIL_UUID), rule_code, tstzrange(valid_from, valid_to, '[)')) WHERE status = 'ACTIVE'
- **表级检查：** valid_to IS NULL OR valid_to > valid_from
- **特别说明：** DRAFT 可编辑；APPROVED 或 ACTIVE 后适用地点/产品、规则值、schema、版本号和生效起点冻结，修改必须发布新版本。同 rule_code 同时命中时按 地点+产品 > 地点 > 产品 > 企业全局 取最具体一条；同一具体范围禁止有效期重叠。ops_store.interview_windows/trial_windows 迁为地点级 HR_INTERVIEW_WINDOWS/HR_TRIAL_WINDOWS。现有 product 的地点敏感策略迁为 PRODUCT_LOCATION_PLANNING_POLICY；旧 product 行没有地点字段，只有来源部署/导入合同能唯一证明地点时才填 scope_location_id，不能默认扩散到新门店。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `business_rule_id` | 规则ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版业务规则稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `15c7e12e-981c-5363-82f3-30984880ca2a` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `scope_location_id` | 适用地点ID | `uuid` | 可空; 默认 — | 规则只适用于某门店、厨房或仓库时填写；企业全局规则为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `7febd863-b111-54b9-baa7-f0e2ab23a513` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `scope_product_id` | 适用产品ID | `uuid` | 可空; 默认 — | 规则只适用于某企业产品时填写；非产品规则或全产品规则为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ede36082-ab53-50f2-9440-ba860b9e49ee` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `rule_code` | 规则代码 | `text` | 非空; 默认 — | 程序读取的稳定规则名称。 | 避免散落硬编码。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `STOCKOUT_EXCLUDE_PRODUCTS` | ops_business_rule.rule_code 只表示本字段说明中的 规则代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `version_no` | 版本号 | `integer` | 非空; 默认 — | 规则代码内递增版本。 | 追溯历史计算。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `4` | ops_business_rule.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `rule_value` | 规则值 | `jsonb` | 非空; 默认 — | 符合 schema_version 所指固定 JSON Schema 的结构化规则内容；不接受未登记键。 | 承载低频、形状随 rule_code 变化但必须整体版本化的配置，避免为每种规则建一张表或把多门店配置塞入产品主档。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"planning_reference_price":28,"currency":"MYR","display_full_quantity":24,"positioning_code":"TOP","target_sales_mix_ratio":0.3,"legacy_target_tc_value":120,"audience_code":"ALL","stockout_target_time":"18:00:00","display_sort_order":10,"fixed_shipment_times":["10:00:00","14:00:00"]}` | PRODUCT_LOCATION_PLANNING_POLICY v1 必须逐键校验：价格/陈列量/旧TC值非负，currency 为 ISO 4217，positioning_code 为 TOP/POTENTIAL_TOP/OTHER，占比 0..1，时刻为地点本地 HH24:MI:SS，出货时刻升序去重。legacy_target_tc_value 只保留旧 target_tc 原值；周期和分母未确认前禁止参与自动决策。 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 7 | `schema_version` | 结构版本 | `text` | 非空; 默认 — | rule_value 的 JSON Schema 版本。 | 升级结构时保证解析。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `stockout-exclude-v1` | ops_business_rule.schema_version 只表示本字段说明中的 结构版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `valid_from` | 生效时间 | `timestamptz` | 非空; 默认 — | 规则开始用于新计算的时间。 | 历史计算使用当时版本。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-09T00:00:00+08:00` | ops_business_rule.valid_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `valid_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 规则停止生效时间。 | 保留历史。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-09-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `status` | 规则状态 | `text` | 非空; 默认 — | DRAFT、APPROVED、ACTIVE 或 RETIRED。 | 只有 ACTIVE 可被运行任务读取。 | CHECK status IN ('DRAFT','APPROVED','ACTIVE','RETIRED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ACTIVE` | ops_business_rule.status 只表示本字段说明中的 规则状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准规则的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 14 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_role` — 标准岗位

- **用途：** 维护排班、招聘和培训共同使用的标准岗位身份。
- **一行代表：** 一个标准岗位一行
- **写入责任：** BakeryOps 运营主数据
- **读取项目：** BakeryOps、HR、分析/BI
- **数据来源：** 运营与HR共同批准
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 维护排班、招聘和培训共同使用的标准岗位身份。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `created_by_user_id` → `app_user.user_id`
- **被谁连接：** `hr_job_requisition.role_id`；`hr_offer.role_id`；`hr_screening_rule.role_id`；`hr_timesheet_entry.role_id`；`ops_role_training_requirement.role_id`；`ops_shift_requirement.role_id`；`ops_workload_line.role_id`
- **分析视图：** `v_ops_shift_by_role`
- **唯一约束：** role_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `role_id` | 岗位ID | `uuid` | 非空; 默认 gen_random_uuid() | 跨招聘、培训和班表稳定岗位身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `a28ce29f-93bc-5620-a42b-c652824558c9` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `role_code` | 岗位代码 | `text` | 非空; 默认 — | 程序和业务共同使用的唯一代码。 | 跨模块连接。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `KITCHEN_BAKER` | ops_role.role_code 只表示本字段说明中的 岗位代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `role_name` | 岗位名称 | `text` | 非空; 默认 — | 当前岗位显示名称。 | 界面展示。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `烘焙师` | ops_role.role_name 只表示本字段说明中的 岗位名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `role_family` | 岗位族 | `text` | 非空; 默认 — | KITCHEN、FRONT、LOGISTICS、MANAGEMENT 或 SUPPORT。 | 组织分析和默认规则。 | CHECK role_family IN ('KITCHEN','FRONT','LOGISTICS','MANAGEMENT','SUPPORT') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `KITCHEN` | ops_role.role_family 只表示本字段说明中的 岗位族；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `is_critical` | 是否默认关键岗位 | `boolean` | 非空; 默认 false | 该岗位是否通常属于必须明确覆盖的关键岗位。 | 班表发布门禁的默认值，具体班次可覆盖。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `true` | ops_role.is_critical 只表示本字段说明中的 是否默认关键岗位；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `status` | 岗位状态 | `text` | 非空; 默认 'ACTIVE' | ACTIVE 或 RETIRED。 | 保留历史岗位。 | CHECK status IN ('ACTIVE','RETIRED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | ops_role.status 只表示本字段说明中的 岗位状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 9 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_station` — 标准工位

- **用途：** 维护地点内可排班的工位或工作区域。
- **一行代表：** 一个标准工位定义一行
- **写入责任：** BakeryOps 运营主数据
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 运营配置
- **实施层级：** `EXTENSION_PACK:SHIFT_AND_WORKFORCE`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 维护地点内可排班的工位或工作区域。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `default_location_id` → `ops_location.location_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `hr_timesheet_entry.station_id`；`ops_shift_requirement.station_id`；`ops_workload_line.station_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** station_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `station_id` | 工位ID | `uuid` | 非空; 默认 gen_random_uuid() | 工位稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `0750f6ee-4f5e-5628-aa23-27a9a4d0ec54` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `station_code` | 工位代码 | `text` | 非空; 默认 — | 企业范围唯一或按批准规则唯一的工位代码。 | 班表和工时连接。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `PAV_OVEN_1` | ops_station.station_code 只表示本字段说明中的 工位代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `station_name` | 工位名称 | `text` | 非空; 默认 — | 当前工位显示名称。 | 班表展示。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `烤箱一号位` | ops_station.station_name 只表示本字段说明中的 工位名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `station_type` | 工位类型 | `text` | 非空; 默认 — | PRODUCTION、SERVICE、CASHIER、CLEANING、LOGISTICS 或 OTHER。 | 工作量和人效分组。 | CHECK station_type IN ('PRODUCTION','SERVICE','CASHIER','CLEANING','LOGISTICS','OTHER') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `PRODUCTION` | ops_station.station_type 只表示本字段说明中的 工位类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `default_location_id` | 默认地点ID | `uuid` | 可空; 默认 — | 工位固定在某地点时记录；可复用标准工位为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `0b09965b-24cc-56e6-a623-bf5fbe497409` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `capacity` | 并发容量 | `integer` | 可空; 默认 — | 该工位可同时安排的最大人数。 | 防止超排。 | CHECK capacity IS NULL OR capacity > 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `status` | 工位状态 | `text` | 非空; 默认 'ACTIVE' | ACTIVE、MAINTENANCE 或 RETIRED。 | 维护期间不能排班。 | CHECK status IN ('ACTIVE','MAINTENANCE','RETIRED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | ops_station.status 只表示本字段说明中的 工位状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 10 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_role_training_requirement` — 岗位培训要求

- **用途：** 定义岗位需要哪些课程、是否强制和有效期规则。
- **一行代表：** 岗位 × 课程 × 生效区间一行
- **写入责任：** 运营与HR共同维护
- **读取项目：** BakeryOps、HR、分析/BI
- **数据来源：** 岗位资格政策
- **实施层级：** `EXTENSION_PACK:TRAINING_AND_ONBOARDING`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 定义岗位需要哪些课程、是否强制和有效期规则。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `role_id` → `ops_role.role_id`；`training_course_id` → `hr_training_course.training_course_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_hr_role_eligibility`
- **唯一约束：** role_id + training_course_id + valid_from
- **不可重叠约束：** NO_OVERLAP(role_id, training_course_id, daterange(valid_from, valid_to, '[)'))
- **表级检查：** valid_to IS NULL OR valid_to > valid_from

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `role_training_requirement_id` | 要求ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条岗位培训要求稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `14c4a266-1d2c-58df-b71b-c5e41cdbf2c0` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `role_id` | 岗位ID | `uuid` | 非空; 默认 — | 被约束岗位。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_role.role_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `a28ce29f-93bc-5620-a42b-c652824558c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `training_course_id` | 课程ID | `uuid` | 非空; 默认 — | 岗位要求课程。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_training_course.training_course_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ac8441cd-59f1-55fe-b5ec-b03825bcaac3` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `is_mandatory` | 是否强制 | `boolean` | 非空; 默认 true | 未满足时是否禁止排班到该岗位。 | 关键岗位资格门禁。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `true` | ops_role_training_requirement.is_mandatory 只表示本字段说明中的 是否强制；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `minimum_result` | 最低结果 | `text` | 非空; 默认 'PASS' | 通常 PASS；允许政策定义其他结果。 | 资格视图判断。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `PASS` | ops_role_training_requirement.minimum_result 只表示本字段说明中的 最低结果；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `valid_from` | 生效日期 | `date` | 非空; 默认 — | 要求开始生效日期。 | 历史班表按当时规则判断。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-01` | ops_role_training_requirement.valid_from 只表示本字段说明中的 生效日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `valid_to` | 失效日期上界 | `date` | 可空; 默认 — | 要求停止生效的日期上界，该日期本身不再适用。 | 以左闭右开区间保留历史并避免相邻规则重复命中。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2027-01-01` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 10 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_shift_plan_version` — 班表版本

- **用途：** 直接保留某地点某营业日班表每次草稿、资格校验、批准、发布或取消，不再另建空壳班表主单。
- **一行代表：** 地点 × 营业日 × 版本号一行
- **写入责任：** BakeryOps；审批人改变状态
- **读取项目：** BakeryOps、HR、财务网站、分析/BI
- **数据来源：** 工作量运行或上一版本
- **实施层级：** `EXTENSION_PACK:SHIFT_AND_WORKFORCE`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE; R6_MERGE_INTO: absorb ops_shift_plan; location + business date is the stable shift-plan identity
- **为何存表而不是现算视图：** 直接保留某地点某营业日班表每次草稿、资格校验、批准、发布或取消，不再另建空壳班表主单。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `location_id` → `ops_location.location_id`；`source_job_run_id` → `app_job_run.job_run_id`；`workload_run_id` → `ops_workload_run.workload_run_id`；`based_on_version_id` → `ops_shift_plan_version.shift_plan_version_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `ops_shift_plan_version.based_on_version_id`；`ops_shift_requirement.shift_plan_version_id`
- **分析视图：** `v_ops_shift_publish_readiness`、`v_business_timeline`
- **唯一约束：** location_id + business_date + version_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** R6 终审将 ops_shift_plan 合并到本表：location_id + business_date 就是跨版本自然身份，另存主单 UUID 与可变头状态没有新增事实。草稿和校验阶段可受控修改；PUBLISHED、REJECTED、CANCELLED 或 SUPERSEDED 后版本、需求和指派冻结，任何变更复制为新版本。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `shift_plan_version_id` | 班表版本ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版班表稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `76c728b6-2fd9-5d29-8d1f-6eb0e7f9f572` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 班表覆盖地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 班表服务的营业日。 | 与销售、生产计划和实际工时连接。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-10` | 不要由 created_at 或 UTC 日期临时推导。 |
| 4 | `source_job_run_id` | 来源导入任务ID | `uuid` | 可空; 默认 — | 班表由 Excel/Lark/其他批量来源导入时连接记录文件哈希、解析器版本和完成时间的任务运行；纯人工建立时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `e350efbd-17d9-5f80-b0d5-46779e431883` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `workload_run_id` | 工作量运行ID | `uuid` | 可空; 默认 — | 班表需求采用的工作量计算。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_workload_run.workload_run_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `20faf3d2-8fd5-58a3-b654-7c3f56fe8805` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `based_on_version_id` | 基础版本ID | `uuid` | 可空; 默认 — | 本版从哪一旧版复制。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_shift_plan_version.shift_plan_version_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `81757317-1083-55c8-8bb6-8c96569edc65` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `version_no` | 版本号 | `integer` | 非空; 默认 — | 同一地点和营业日内递增版本。 | 版本排序。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2` | ops_shift_plan_version.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `status` | 版本状态 | `text` | 非空; 默认 — | DRAFT、VALIDATING、APPROVED、PUBLISHED、SUPERSEDED、REJECTED 或 CANCELLED。 | 只有 PUBLISHED 才是正式班表；整日取消必须追加 CANCELLED 版本。 | CHECK status IN ('DRAFT','VALIDATING','APPROVED','PUBLISHED','SUPERSEDED','REJECTED','CANCELLED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `PUBLISHED` | ops_shift_plan_version.status 只表示本字段说明中的 版本状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `validation_summary` | 校验摘要 | `jsonb` | 非空; 默认 '{}'::jsonb | 关键岗位缺口、资格违规和人数差异。 | 发布前清楚展示门禁。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"critical_gaps":0}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 10 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准班表的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 班表批准时间。 | 审计。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T16:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `published_at` | 发布时间 | `timestamptz` | 可空; 默认 — | 班表正式对员工生效时间。 | 通知和后续实际对比起点。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T16:05:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 15 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_shift_requirement` — 班次岗位需求

- **用途：** 明确每个时段需要的岗位、工位、人数和关键岗位属性。
- **一行代表：** 班表版本 × 时段 × 岗位 × 工位一行
- **写入责任：** BakeryOps 排班流程
- **读取项目：** BakeryOps、HR、分析/BI
- **数据来源：** 工作量行加人工调整
- **实施层级：** `EXTENSION_PACK:SHIFT_AND_WORKFORCE`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 明确每个时段需要的岗位、工位、人数和关键岗位属性。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `shift_plan_version_id` → `ops_shift_plan_version.shift_plan_version_id`；`workload_line_id` → `ops_workload_line.workload_line_id`；`role_id` → `ops_role.role_id`；`station_id` → `ops_station.station_id`
- **被谁连接：** `ops_shift_assignment.shift_requirement_id`
- **分析视图：** `v_ops_shift_publish_readiness`、`v_ops_labor_productivity`、`v_ops_shift_by_role`
- **唯一约束：** shift_plan_version_id + shift_start + shift_end + role_id + station_id [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** shift_end > shift_start

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `shift_requirement_id` | 班次需求ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条岗位需求稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `43e09b91-5c59-592b-97ff-46a9b6e0ecf2` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `shift_plan_version_id` | 班表版本ID | `uuid` | 非空; 默认 — | 所属班表版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_shift_plan_version.shift_plan_version_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `76c728b6-2fd9-5d29-8d1f-6eb0e7f9f572` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `workload_line_id` | 工作量行ID | `uuid` | 可空; 默认 — | 产生该需求的工作量行；纯人工需求可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_workload_line.workload_line_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `9381ed17-93e6-5b7f-b8b0-d319d4b1961d` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `role_id` | 岗位ID | `uuid` | 非空; 默认 — | 必须覆盖的岗位。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_role.role_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `a28ce29f-93bc-5620-a42b-c652824558c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `station_id` | 工位ID | `uuid` | 可空; 默认 — | 具体工作工位；岗位级需求可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_station.station_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `0750f6ee-4f5e-5628-aa23-27a9a4d0ec54` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `shift_start` | 班次开始 | `timestamptz` | 非空; 默认 — | 需求时段绝对开始时间。 | 跨午夜不歧义。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-10T06:00:00+08:00` | ops_shift_requirement.shift_start 只表示本字段说明中的 班次开始；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `shift_end` | 班次结束 | `timestamptz` | 非空; 默认 — | 需求时段绝对结束时间。 | 计算需求工时。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-10T14:00:00+08:00` | ops_shift_requirement.shift_end 只表示本字段说明中的 班次结束；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `required_headcount` | 需求人数 | `integer` | 非空; 默认 — | 该时段岗位所需人数。 | 班表人员缺口。 | CHECK required_headcount > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2` | ops_shift_requirement.required_headcount 只表示本字段说明中的 需求人数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `required_work_minutes` | 需求分钟 | `numeric(18,4)` | 非空; 默认 — | 该需求行总工作分钟。 | 与分配和实际工时比较。 | CHECK required_work_minutes >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `960` | ops_shift_requirement.required_work_minutes 只表示本字段说明中的 需求分钟；必须在所属对象粒度内按 numeric(18,4) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `is_critical` | 是否关键岗位 | `boolean` | 非空; 默认 false | 本次班表中是否必须明确有人且满足资格。 | 发布硬门禁。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `true` | ops_shift_requirement.is_critical 只表示本字段说明中的 是否关键岗位；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `note` | 需求说明 | `text` | 可空; 默认 — | 人工调整或特殊要求。 | 解释偏离工作量结果。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `开店前必须两人` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ops_shift_assignment` — 班次员工指派

- **用途：** 把合资格员工明确指派到班表时段、岗位和工位。
- **一行代表：** 班次需求 × 雇佣关系 × 一段指派一行
- **写入责任：** BakeryOps 排班流程
- **读取项目：** BakeryOps、HR、财务网站、分析/BI
- **数据来源：** 人工排班或批准算法
- **实施层级：** `EXTENSION_PACK:SHIFT_AND_WORKFORCE`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 把合资格员工明确指派到班表时段、岗位和工位。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `shift_requirement_id` → `ops_shift_requirement.shift_requirement_id`；`employment_id` → `hr_employment.employment_id`；`override_approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `hr_timesheet_entry.shift_assignment_id`
- **分析视图：** `v_ops_shift_publish_readiness`、`v_ops_labor_productivity`、`v_ops_shift_by_role`
- **唯一约束：** shift_requirement_id + employment_id + assigned_start + assigned_end
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** assigned_end > assigned_start
- **特别说明：** 同一班表版本内，一个 employment_id 的有效指派不得时间重叠；由于 shift_plan_version_id 可经 requirement 确定，为避免重复外键，本表不再复制该字段，实施时由延迟约束触发器跨 requirement 校验。已发布版本冻结，改班必须生成新版本。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `shift_assignment_id` | 班次指派ID | `uuid` | 非空; 默认 gen_random_uuid() | 一段员工班次指派稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ee97e59a-19b1-5063-b05e-0ccd1374bcc1` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `shift_requirement_id` | 班次需求ID | `uuid` | 非空; 默认 — | 被覆盖的岗位需求。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_shift_requirement.shift_requirement_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `43e09b91-5c59-592b-97ff-46a9b6e0ecf2` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `employment_id` | 雇佣ID | `uuid` | 非空; 默认 — | 被安排员工。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_employment.employment_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7618a174-ddfa-5d06-8ce4-a8bfa1686a95` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `assigned_start` | 指派开始 | `timestamptz` | 非空; 默认 — | 员工在该岗位实际计划开始时间。 | 允许一人分段多岗位。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-10T06:00:00+08:00` | ops_shift_assignment.assigned_start 只表示本字段说明中的 指派开始；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `assigned_end` | 指派结束 | `timestamptz` | 非空; 默认 — | 员工在该岗位计划结束时间。 | 计算计划工时。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-10T10:00:00+08:00` | ops_shift_assignment.assigned_end 只表示本字段说明中的 指派结束；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `break_minutes` | 休息分钟 | `integer` | 非空; 默认 0 | 该指派内不计工作时间的计划休息。 | 计划净工时。 | CHECK break_minutes >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `30` | ops_shift_assignment.break_minutes 只表示本字段说明中的 休息分钟；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `eligibility_status` | 资格状态 | `text` | 非空; 默认 — | ELIGIBLE、MISSING_TRAINING、EXPIRED_TRAINING、INACTIVE_EMPLOYMENT 或 OVERRIDDEN。 | 关键岗位发布门禁。 | CHECK eligibility_status IN ('ELIGIBLE','MISSING_TRAINING','EXPIRED_TRAINING','INACTIVE_EMPLOYMENT','OVERRIDDEN') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ELIGIBLE` | ops_shift_assignment.eligibility_status 只表示本字段说明中的 资格状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `override_reason` | 资格例外原因 | `text` | 可空; 默认 — | 经批准绕过资格时的原因。 | 不得静默忽略培训要求。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `紧急支援，主管现场监督` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `override_approved_by_user_id` | 例外批准账号 | `uuid` | 可空; 默认 — | 批准资格例外的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `f96048d1-e476-54ff-8bc9-510cf05eccdd` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `note` | 指派说明 | `text` | 可空; 默认 — | 只属于该员工本段指派的来源备注或人工说明。 | 承接旧班表逐人 notes，避免误放到多人共享的岗位需求说明。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `临时换到收银台支援` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `status` | 指派状态 | `text` | 非空; 默认 'PLANNED' | PLANNED、CONFIRMED、CANCELLED、NO_SHOW 或 COMPLETED。 | 计划与实际对比。 | CHECK status IN ('PLANNED','CONFIRMED','CANCELLED','NO_SHOW','COMPLETED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `CONFIRMED` | ops_shift_assignment.status 只表示本字段说明中的 指派状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 14 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

# POS — POS目录、销售与会员

## `pos_ingest_batch` — POS导入批次

- **用途：** 记录每次 RES/POS 抓取的数据集、窗口、游标、校验值和完整性。
- **一行代表：** 某地点 × 某数据集 × 一次抓取或重跑一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** RES/POS API
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 记录每次 RES/POS 抓取的数据集、窗口、游标、校验值和完整性。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 永久保留批次摘要；原始大文件按合规策略外部归档
- **向外连接：** `job_run_id` → `app_job_run.job_run_id`；`source_system_id` → `app_source_system.source_system_id`；`location_id` → `ops_location.location_id`；`supersedes_pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`
- **被谁连接：** `pos_daily_breakdown.pos_ingest_batch_id`；`pos_ingest_batch.supersedes_pos_ingest_batch_id`；`pos_item_sales_hour.pos_ingest_batch_id`；`pos_item_waste.pos_ingest_batch_id`；`pos_member_balance_snapshot.pos_ingest_batch_id`；`pos_member_card_transaction.pos_ingest_batch_id`；`pos_member_daily_metric.pos_ingest_batch_id`；`pos_order.first_seen_pos_ingest_batch_id`；`pos_order_item.pos_ingest_batch_id`；`pos_payment.first_seen_pos_ingest_batch_id`；`pos_payment.last_seen_pos_ingest_batch_id`；`pos_refund.first_seen_pos_ingest_batch_id`；`pos_sales_day.pos_ingest_batch_id`；`pos_sales_hour.pos_ingest_batch_id`
- **分析视图：** `v_pos_sales_day_current`、`v_pos_sales_hour_current`、`v_pos_item_sales_hour_current`、`v_pos_daily_breakdown_current`、`v_pos_member_state_current`、`v_pos_member_daily_metric_current`、`v_pos_order_item_current`、`v_pos_item_waste_current`
- **唯一约束：** source_system_id + location_id + dataset_code + source_batch_id [NULLS DISTINCT：仅非空值去重，允许多条空值]；idempotency_key
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** window_end > window_start；supersedes_pos_ingest_batch_id IS NULL OR supersedes_pos_ingest_batch_id <> pos_ingest_batch_id；(dataset_code = 'ORDER_ITEM') = (coverage_scope IS NOT NULL)
- **特别说明：** 一个批次只能承载一个 dataset_code。RUNNING 批次可更新计数和状态；进入终态后冻结。更正必须创建新批次并显式 supersedes，事实表仍按 batch_id 追加。所有 current 视图必须同时按精确 dataset_code、SUCCEEDED、未被合格批次 supersedes，以及 completed_at/created_at/batch_id 的确定性顺序选版。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次 POS 导入批次稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `758664d3-e18d-51d0-8035-c811615389f4` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `job_run_id` | 任务运行ID | `uuid` | 非空; 默认 — | 执行本批次的自动任务。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 本批数据的 POS 来源。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 4 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 该批数据所属企业地点；未确认映射时批次进入失败或审核状态。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `supersedes_pos_ingest_batch_id` | 替代POS批次ID | `uuid` | 可空; 默认 — | 本批明确更正并替代的旧批次；首次采集或并行数据集为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `8611cb51-734a-5ff6-955a-4ecec62b6fcd` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `dataset_code` | 数据集代码 | `text` | 非空; 默认 — | 本批唯一的数据契约代码，只允许 PRODUCT_LISTING、SALES_DAY、SALES_HOUR、ITEM_SALES_HOUR、DAILY_BREAKDOWN、ITEM_WASTE、ORDER、ORDER_ITEM、MEMBER_PROFILE、MEMBER_CARD_TRANSACTION、MEMBER_DAILY_METRIC、PAYMENT 或 REFUND。 | 决定批次可写入哪类事实表，也是所有 current 选版视图的硬过滤条件；禁止自由文本和跨数据集混批。 | CHECK dataset_code IN ('PRODUCT_LISTING','SALES_DAY','SALES_HOUR','ITEM_SALES_HOUR','DAILY_BREAKDOWN','ITEM_WASTE','ORDER','ORDER_ITEM','MEMBER_PROFILE','MEMBER_CARD_TRANSACTION','MEMBER_DAILY_METRIC','PAYMENT','REFUND') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `ITEM_SALES_HOUR` | pos_ingest_batch.dataset_code 只表示本字段说明中的 数据集代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `coverage_scope` | 订单明细覆盖范围 | `text` | 可空; 默认 — | 该批次订单明细覆盖范围；旧会员标记订单只能 MEMBER_FLAGGED_ONLY，只有经完整性证明的全量批次才 ALL_ORDER_ITEMS，不可由单行反推。 | 约束 ORDER_ITEM 批次的全集边界，防止把会员消费子集误当成全部订单商品。 | CHECK coverage_scope IS NULL OR coverage_scope IN ('ALL_ORDER_ITEMS','MEMBER_FLAGGED_ONLY') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `MEMBER_FLAGGED_ONLY` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `parser_version` | 解析规则版本 | `text` | 非空; 默认 — | 把来源字段、原始枚举和金额符号解释为规范字段时采用的不可变解析器版本。 | 冻结 txn_type 等来源代码到标准语义的映射，保证同一批次以后仍可复现。 | CHECK parser_version ~ '^[a-z0-9][a-z0-9._-]{2,63}$' | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `res-pos-parser-2026.08.1` | pos_ingest_batch.parser_version 只表示本字段说明中的 解析规则版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `window_start` | 来源窗口开始 | `timestamptz` | 非空; 默认 — | 向来源请求的数据时间窗口起点。 | 解释批次覆盖范围。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-08T00:00:00+08:00` | pos_ingest_batch.window_start 只表示本字段说明中的 来源窗口开始；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `window_end` | 来源窗口结束 | `timestamptz` | 非空; 默认 — | 向来源请求的数据时间窗口终点，不包含该时刻。 | 避免相邻批次重叠或漏数。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T00:00:00+08:00` | pos_ingest_batch.window_end 只表示本字段说明中的 来源窗口结束；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `source_cursor` | 来源游标 | `text` | 可空; 默认 — | 分页或增量同步使用的来源游标。 | 支持从断点重试。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `cursor_20260808_23` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `source_batch_id` | 外部批次ID | `text` | 可空; 默认 — | 来源系统提供的稳定批次或报表任务 ID。 | 来源提供时用于幂等。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `report_100150_20260808` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `payload_sha256` | 原始内容校验值 | `char(64)` | 可空; 默认 — | 原始响应或规范化文件的 SHA-256。 | 识别来源内容在同一窗口是否改变。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `c1f7...64位十六进制` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `idempotency_key` | 批次幂等键 | `char(64)` | 非空; 默认 — | 按来源、地点、数据集、请求窗口、外部批次或内容校验值规范化计算的 SHA-256。 | 来源没有稳定 batch ID 时仍可阻止同一输入重复落库。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2d42...64位十六进制` | pos_ingest_batch.idempotency_key 只表示本字段说明中的 批次幂等键；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 15 | `expected_row_count` | 预期行数 | `bigint` | 可空; 默认 — | 来源声明或预检得到的行数。 | 与实际行数比较判断是否缺页。 | CHECK expected_row_count IS NULL OR expected_row_count >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `350` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `loaded_row_count` | 落库行数 | `bigint` | 非空; 默认 0 | 本批成功写入或确认幂等存在的行数。 | 批次完整性和对账。 | CHECK loaded_row_count >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `350` | pos_ingest_batch.loaded_row_count 只表示本字段说明中的 落库行数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 17 | `status` | 批次状态 | `text` | 非空; 默认 — | RUNNING、SUCCEEDED、PARTIAL、FAILED 或 REJECTED。 | 下游只读取达到其质量要求的批次。 | CHECK status IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED','REJECTED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `SUCCEEDED` | pos_ingest_batch.status 只表示本字段说明中的 批次状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 18 | `completed_at` | 完成时间 | `timestamptz` | 可空; 默认 — | 批次进入终态的时间。 | 判断数据新鲜度。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T00:03:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 20 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_product_listing` — POS商品listing

- **用途：** 保存某来源组织/门店菜单中的商品身份和当前目录属性，不直接等同于企业 product_id。
- **一行代表：** 来源系统 × 来源组织 × 外部商品ID一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** RES/POS 商品目录
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存某来源组织/门店菜单中的商品身份和当前目录属性，不直接等同于企业 product_id。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 永久保留；停用不删除
- **向外连接：** `source_system_id` → `app_source_system.source_system_id`；`location_id` → `ops_location.location_id`
- **被谁连接：** `ops_stockout_event.listing_id`；`pos_item_sales_hour.listing_id`；`pos_item_waste.listing_id`；`pos_order_item.listing_id`；`pos_product_mapping.listing_id`；`pos_product_mapping_review.listing_id`；`pos_refund.listing_id`
- **分析视图：** `v_identity_mapping_gap`、`v_product_identity`、`v_pos_item_sales_day`、`v_pos_order_item_current`
- **唯一约束：** source_system_id + source_organization_id + source_item_id；source_system_id + source_item_key
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 本表是来源目录的当前快照，不是成交事实，也不是企业产品或本库成本卡。source_total_cost/source_theoretical_cost 与 current_price 共用本行 currency，只保留当前可获得的 RES 观察；若未来来源能提供成本历史，必须另按来源记录ID/观察时点追加观察事实，不能回写覆盖历史成本分析。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `listing_id` | Listing ID | `uuid` | 非空; 默认 gen_random_uuid() | POS listing 在企业库内的稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7c7d8100-8fc6-5c80-ae85-0969736fe572` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 提供该商品目录的 POS 来源。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 3 | `location_id` | 地点ID | `uuid` | 可空; 默认 — | listing 所属地点；全组织 listing 可为空并通过来源组织解析。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `source_organization_id` | 来源组织ID | `text` | 非空; 默认 — | 来源系统中的组织或品牌标识。 | 与外部商品 ID 共同构成来源身份。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `org_8801` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `source_item_id` | 外部商品ID | `text` | 非空; 默认 — | 来源系统稳定商品标识，原样保存。 | 销售事实只需有 listing_id 即可安全入库。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `menu_item_33291` | 这是来源系统证据，不等于企业统一身份。 |
| 6 | `source_item_key` | 外部组合键 | `text` | 非空; 默认 — | 来源系统提供的完整 menu item key。 | 兼容现有 item_key；只在同一个 source_system_id 命名空间内唯一。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `8801-1-33291` | 这是来源系统证据，不等于企业统一身份。 |
| 7 | `source_organization_type_code` | 来源组织类型码 | `smallint` | 可空; 默认 — | RES/POS 返回的原始组织类型数值码。 | 保留来源目录语义；没有获批映射表前不得把数值码猜成企业地点类型。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `1` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `source_menu_item_code` | 来源菜单商品码 | `text` | 可空; 默认 — | RES/POS 目录中的原始菜单商品代码。 | 供来源排障和人工核对；跨模块连接仍使用 listing_id。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `MI-003291` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `source_name` | 来源商品名称 | `text` | 非空; 默认 — | 目录同步时的原始显示名称。 | 保留来源证据，不作为 product_id 匹配结论。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `Dark Chocolate Wellington` | 这是来源系统证据，不等于企业统一身份。 |
| 10 | `source_name_en` | 来源英文名 | `text` | 可空; 默认 — | RES/POS 返回的英文商品名称原值。 | 保留多语言目录证据；名称变化不改变 listing_id。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `Dark Chocolate Wellington` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `source_name_zh` | 来源中文名 | `text` | 可空; 默认 — | RES/POS 返回的中文商品名称原值。 | 用于展示和候选审核，不能作为产品身份键。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `黑巧惠灵顿` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `source_category` | 来源品类 | `text` | 可空; 默认 — | POS 目录中的原始品类。 | 可用于候选匹配和来源分析。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `Bakery` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `source_category_id` | 来源品类ID | `text` | 可空; 默认 — | RES/POS 返回的原始品类标识。 | 在来源命名空间内核对目录变化，不等于企业 category_code。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `cat_8802` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `source_category_en` | 来源英文品类 | `text` | 可空; 默认 — | RES/POS 返回的英文品类名称原值。 | 保留来源分类证据。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `Bakery` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `source_category_zh` | 来源中文品类 | `text` | 可空; 默认 — | RES/POS 返回的中文品类名称原值。 | 保留来源分类证据，不覆盖企业品类。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `烘焙` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `source_specification` | 来源规格 | `text` | 可空; 默认 — | RES/POS 目录返回的原始规格文本。 | 辅助来源商品核对；不能替代统一产品基础单位或配方产出单位。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `1 piece` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `current_price` | 目录当前售价 | `numeric(18,4)` | 可空; 默认 — | 目录同步时该 listing 的当前含义售价。 | 仅代表当前目录快照；实际销售金额以事实表为准。 | CHECK current_price IS NULL OR current_price >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `28.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 目录售价的 ISO 4217 币种。 | 解释 current_price。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `MYR` | pos_product_listing.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 19 | `source_cost_card_id` | 来源成本卡ID | `text` | 可空; 默认 — | RES 目录返回的成本卡外部标识。 | 追查 RES 成本配置；它不是本库 recipe_version_id，也不能直接作为外键。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `res_cc_33291` | 这是来源系统证据，不等于企业统一身份。 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 20 | `source_cost_spec_id` | 来源成本规格ID | `text` | 可空; 默认 — | RES 成本卡返回的规格外部标识。 | 与来源成本卡一起定位 RES 配置；不得冒充统一单位或配方组件。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `res_spec_8801` | 这是来源系统证据，不等于企业统一身份。 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 21 | `source_has_cost_card` | 来源是否有成本卡 | `boolean` | 可空; 默认 — | RES 目录同步时返回的是否已建成本卡标记；来源未返回时为空。 | 区分未配置与未知，不能由成本金额非空反推后覆盖来源值。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `true` | 这是来源系统证据，不等于企业统一身份。 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 22 | `source_total_cost` | 来源总成本 | `numeric(18,6)` | 可空; 默认 — | RES 目录在最近同步时返回的总成本观察原值。 | 只用于与企业成本卡派生值核对；不能作为本库成本权威值，也不能由售价或配方反推。 | CHECK source_total_cost IS NULL OR source_total_cost >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `9.650000` | 这是来源系统证据，不等于企业统一身份。 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 23 | `source_theoretical_cost` | 来源理论成本 | `numeric(18,6)` | 可空; 默认 — | RES 成本卡在最近同步时返回的理论成本观察原值。 | 保留外部系统独立观察，用于成本覆盖与差异分析；不覆盖本库配方派生成本。 | CHECK source_theoretical_cost IS NULL OR source_theoretical_cost >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `9.420000` | 这是来源系统证据，不等于企业统一身份。 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 24 | `source_status_code` | 来源状态码 | `smallint` | 可空; 默认 — | RES/POS 目录返回的原始商品状态数值码。 | 在解析词表未确认时仍保真；企业产品状态由独立治理流程决定。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `1` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 25 | `display_name_override` | 显示名人工覆盖 | `text` | 可空; 默认 — | 现有目录人工校正的中文显示名；为空时展示来源名称或企业产品名。 | 无损承接 pos_product.name_zh_display，但不参与身份映射。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `黑巧牛排惠灵顿` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 26 | `display_category_override` | 显示品类人工覆盖 | `text` | 可空; 默认 — | 现有目录人工校正的展示品类；为空时使用来源或企业品类。 | 无损承接 pos_product.category_display，但不改变来源品类或企业 category_code。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `惠灵顿` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 27 | `is_active` | 来源是否启用 | `boolean` | 非空; 默认 true | POS 当前是否允许销售该 listing。 | 停用 listing 仍保留历史销售连接。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `true` | pos_product_listing.is_active 只表示本字段说明中的 来源是否启用；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 28 | `first_seen_at` | 首次发现时间 | `timestamptz` | 非空; 默认 now() | 同步首次看到该 listing 的时间。 | 检测新品。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2025-11-01T00:00:00+08:00` | pos_product_listing.first_seen_at 只表示本字段说明中的 首次发现时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 29 | `last_seen_at` | 最近发现时间 | `timestamptz` | 非空; 默认 now() | 最近一次目录同步仍看到该 listing 的时间。 | 识别来源删除或长期未更新。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T00:00:00+08:00` | pos_product_listing.last_seen_at 只表示本字段说明中的 最近发现时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 30 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 31 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_product_mapping` — POS商品到统一产品映射

- **用途：** 版本化保存 listing 与 product_id 的确认关系，使历史销售按当时映射重现。
- **一行代表：** POS listing × 有效期一行
- **写入责任：** 产品身份审核流程
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 目录对照、成本卡证据和人工确认
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 版本化保存 listing 与 product_id 的确认关系，使历史销售按当时映射重现。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `listing_id` → `pos_product_listing.listing_id`；`product_id` → `ops_product.product_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_identity_mapping_gap`、`v_product_identity`、`v_pos_item_sales_day`、`v_pos_member_order_item`、`v_ops_timeslot_sales_baseline`、`v_pos_item_waste_mapped`
- **唯一约束：** listing_id + valid_from
- **不可重叠约束：** NO_OVERLAP(listing_id, tstzrange(valid_from, valid_to, '[)')) WHERE status = 'CONFIRMED'
- **表级检查：** valid_to IS NULL OR valid_to > valid_from

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `product_mapping_id` | 映射ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条 listing 映射稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ec2d71d8-8710-5a91-8f27-9ee170b0e3dd` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `listing_id` | Listing ID | `uuid` | 非空; 默认 — | 被映射的 POS listing。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_product_listing.listing_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `7c7d8100-8fc6-5c80-ae85-0969736fe572` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `product_id` | 产品ID | `uuid` | 非空; 默认 — | 确认后的企业统一产品。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `e9c9e097-867a-5929-8bd8-84c74d45b5c4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `valid_from` | 生效时间 | `timestamptz` | 非空; 默认 — | 映射开始用于业务事实的时间。 | 支持 listing 复用或产品拆分。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2025-11-01T00:00:00+08:00` | pos_product_mapping.valid_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `valid_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 映射停止有效时间。 | 历史报表仍使用原映射。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2027-01-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `mapping_method` | 映射方法 | `text` | 非空; 默认 — | MANUAL、SOURCE_ID、APPROVED_RULE 或 MIGRATION。 | 解释映射证据强度。 | CHECK mapping_method IN ('MANUAL','SOURCE_ID','APPROVED_RULE','MIGRATION') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `MANUAL` | pos_product_mapping.mapping_method 只表示本字段说明中的 映射方法；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `confidence` | 置信度 | `numeric(5,4)` | 可空; 默认 — | 候选或规则给出的 0 至 1 置信度。 | 只做审核排序，不能替代 confirmed 状态。 | CHECK confidence IS NULL OR (confidence >= 0 AND confidence <= 1) | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `1.0000` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `status` | 映射状态 | `text` | 非空; 默认 'PENDING' | CONFIRMED、PENDING 或 REJECTED。 | 只有 CONFIRMED 进入正式产品级分析。 | CHECK status IN ('CONFIRMED','PENDING','REJECTED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `CONFIRMED` | pos_product_mapping.status 只表示本字段说明中的 映射状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `evidence` | 映射证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 来源 ID、产品代码、人工说明等结构化证据。 | 禁止只按名称静默关联。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"approved_by":"owner"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 10 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 12 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_product_mapping_review` — POS商品映射审核队列

- **用途：** 保存无法自动唯一映射的 listing 候选和处理结论。
- **一行代表：** 一个 listing 的一次待审核问题一行
- **写入责任：** 产品身份审核流程
- **读取项目：** BakeryOps、财务网站
- **数据来源：** 映射质量检查
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_WORKFLOW` — 只允许批准的状态机迁移并记录操作者和时间
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_WORKFLOW_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存无法自动唯一映射的 listing 候选和处理结论。；人工决定、批准、状态转换或业务副作用本身就是事实，不能从最终结果倒推。
- **保留策略：** 永久保留审核结论
- **向外连接：** `listing_id` → `pos_product_listing.listing_id`；`candidate_product_id` → `ops_product.product_id`；`reviewed_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_identity_mapping_gap`
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `mapping_review_id` | 审核ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次商品映射审核稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2fbc79fa-ccd2-5859-94b6-dca11d59f13b` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `listing_id` | Listing ID | `uuid` | 非空; 默认 — | 需要审核的 POS listing。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_product_listing.listing_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `7c7d8100-8fc6-5c80-ae85-0969736fe572` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `candidate_product_id` | 候选产品ID | `uuid` | 可空; 默认 — | 算法或人工提出的候选产品；无候选时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `1f49bf06-14a5-5b4f-b073-61d5b42ac312` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `candidate_score` | 候选得分 | `numeric(5,4)` | 可空; 默认 — | 候选匹配模型或规则得分。 | 只用于排序，不自动确认身份。 | CHECK candidate_score IS NULL OR (candidate_score >= 0 AND candidate_score <= 1) | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `0.8700` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `reason_code` | 进入队列原因 | `text` | 非空; 默认 — | NO_CANDIDATE、MULTIPLE_CANDIDATES、CONFLICT 或 LOW_CONFIDENCE。 | 决定审核界面和阻断规则。 | CHECK reason_code IN ('NO_CANDIDATE','MULTIPLE_CANDIDATES','CONFLICT','LOW_CONFIDENCE') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `MULTIPLE_CANDIDATES` | pos_product_mapping_review.reason_code 只表示本字段说明中的 进入队列原因；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `evidence` | 候选证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 名称、来源 ID、售价、品类等候选证据。 | 让审核者理解为什么产生候选。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `{"same_name_count":2}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 7 | `status` | 审核状态 | `text` | 非空; 默认 'OPEN' | OPEN、APPROVED、REJECTED 或 DEFERRED。 | 决定是否生成正式 pos_product_mapping。 | CHECK status IN ('OPEN','APPROVED','REJECTED','DEFERRED') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `OPEN` | pos_product_mapping_review.status 只表示本字段说明中的 审核状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `reviewed_by_user_id` | 审核账号 | `uuid` | 可空; 默认 — | 完成审核的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `9f809e56-58de-53ea-9cc4-5a7f5116feb5` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `reviewed_at` | 审核时间 | `timestamptz` | 可空; 默认 — | 审核进入终态的时间。 | 审计映射处理时长。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-10T09:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `review_note` | 审核说明 | `text` | 可空; 默认 — | 人工结论与必要的业务解释。 | 处理无对应产品或拆分产品的例外。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `这是饮品，不参与烘焙排产` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_sales_day` — POS门店日销售事实

- **用途：** 保存某地点某营业日某批次的销售、折扣、订单和来源平均客单观察。
- **一行代表：** 地点 × 营业日 × POS批次一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** RES/POS 日汇总报表
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `PARTIAL_FIELDS_DERIVED_IN_VIEW`
- **可派生字段/输出：** average_order_value -> v_pos_sales_day_current
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存某地点某营业日某批次的销售、折扣、订单和来源平均客单观察。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 永久保留；更正以新批次追加，不覆盖旧批次
- **向外连接：** `pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`；`location_id` → `ops_location.location_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_pos_sales_day_current`
- **唯一约束：** location_id + business_date + pos_ingest_batch_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 这是 RES/POS 日汇总接口给出的独立来源事实。当前订单商品明细只覆盖会员标记订单，不能反推全店日总；即使未来取得完整订单明细，也保留本表作为来源对账观察，不把两种来源相加。average_order_value 始终由 net_sales / order_count 派生；source_average_order_value 只保存来源独立上报值，两者不得互相覆盖。gross/折扣/退款/订单/来源顾客计数缺失时保持 NULL，只有已证实零流水日才写事实 0。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `sales_day_id` | 日销售ID | `uuid` | 非空; 默认 gen_random_uuid() | 日销售事实稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `c3adcae0-1932-5912-9847-9074919b92f7` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 非空; 默认 — | 产生该事实的来源批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `758664d3-e18d-51d0-8035-c811615389f4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 销售发生的门店地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 按地点营业日切点归属的业务日期。 | 与计划、班表、成本和财务核对的共同日期键。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 5 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 所有金额的 ISO 4217 币种。 | 禁止把不同币种直接相加。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | pos_sales_day.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `gross_sales` | 流水金额 | `numeric(18,4)` | 可空; 默认 — | 折扣和退款处理前、按来源口径定义的销售金额；来源未返回时为空。 | 用于解释折扣和净销售；NULL 不得当成 0。 | CHECK gross_sales IS NULL OR gross_sales >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `55000.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `discount_amount` | 折扣金额 | `numeric(18,4)` | 可空; 默认 — | 当日来源直接返回或由该来源明确字段归一化的折扣总额；来源未返回时为空。 | 分析促销和净销售差异；NULL 表示未知，不表示没有折扣。 | CHECK discount_amount IS NULL OR discount_amount >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1250.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `refund_amount` | 退款金额 | `numeric(18,4)` | 可空; 默认 — | 当日来源明确计入本口径的退款总额；来源没有独立退款字段时为空。 | 与订单/退款明细核对；不得用 0 填补未知退款。 | CHECK refund_amount IS NULL OR refund_amount >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `80.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `net_sales` | 净销售额 | `numeric(18,4)` | 非空; 默认 — | 来源最终认定的当日销售额。 | 毛利、产品占比和经营报表分母。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `53670.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 10 | `order_count` | 订单数 | `integer` | 可空; 默认 — | 来源日汇总中的有效订单数量；来源未返回时为空。 | 计算客单价和核对小时汇总；NULL 不得当成零单。 | CHECK order_count IS NULL OR order_count >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `842` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `source_average_order_value` | 来源平均客单观察 | `numeric(18,4)` | 可空; 默认 — | 上游日汇总直接返回的平均客单原值；只有来源独立提供时才保存，系统自行相除得到的值不写入。 | 保留来源舍入和口径证据，并与 net_sales / order_count 的规范派生值核对。 | CHECK source_average_order_value IS NULL OR source_average_order_value >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `63.74` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `source_guest_count` | 来源顾客计数 | `integer` | 可空; 默认 — | 上游日汇总提供的顾客/人数原始计数；来源无值时为空。 | 只为来源对账保留；未经来源定义验证不得称为进店客流或去重顾客。 | CHECK source_guest_count IS NULL OR source_guest_count >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1012` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `quality_status` | 质量状态 | `text` | 非空; 默认 'COMPLETE' | COMPLETE、PARTIAL、RECONCILIATION_WARNING 或 REJECTED。 | 缺失来源时不允许把 0 冒充完整事实。 | CHECK quality_status IN ('COMPLETE','PARTIAL','RECONCILIATION_WARNING','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `COMPLETE` | pos_sales_day.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 14 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_sales_hour` — POS门店小时销售事实

- **用途：** 保存门店每个营业小时的销售和订单汇总。
- **一行代表：** 地点 × 营业日 × 营业小时 × POS批次一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** RES/POS 小时汇总报表
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存门店每个营业小时的销售和订单汇总。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 永久保留；更正以新批次追加
- **向外连接：** `pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`；`location_id` → `ops_location.location_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_pos_sales_hour_current`
- **唯一约束：** location_id + hour_started_at + pos_ingest_batch_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 这是 RES/POS 小时汇总接口的来源原值，不假设能由当前有限订单明细完整重算。日表与小时表只做同批次核对，不相加；小时客单价由 net_sales / order_count 派生。source_guest_count 只是 RES 的 num_of_guests 来源字段，不是经传感器或会员去重得到的真实客流。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `sales_hour_id` | 小时销售ID | `uuid` | 非空; 默认 gen_random_uuid() | 小时销售事实稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `411b10e3-601f-578d-accb-43068bf570d5` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 非空; 默认 — | 产生该事实的来源批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `758664d3-e18d-51d0-8035-c811615389f4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 销售发生的门店地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 该小时所属营业日。 | 与计划和班表按日连接。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 5 | `hour_started_at` | 小时开始时间 | `timestamptz` | 非空; 默认 — | 该统计桶的绝对开始时间。 | 避免仅存 0-23 导致跨时区或跨午夜歧义。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08T14:00:00+08:00` | pos_sales_hour.hour_started_at 只表示本字段说明中的 小时开始时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 金额币种。 | 保证汇总时币种一致。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | pos_sales_hour.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `gross_sales` | 流水金额 | `numeric(18,4)` | 非空; 默认 — | 该小时来源口径的流水金额。 | 分析时段表现。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `4800.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 8 | `discount_amount` | 来源折扣金额 | `numeric(18,4)` | 可空; 默认 — | 该小时 RES/POS 汇总直接返回的折扣金额；来源缺失时为空。 | 保留独立来源口径，不能假定等于 gross_sales-net_sales，因为退款、服务费或舍入口径可能不同。 | CHECK discount_amount IS NULL OR discount_amount >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `150.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `net_sales` | 净销售额 | `numeric(18,4)` | 非空; 默认 — | 该小时来源口径的净销售额。 | 与日销售和人效核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `4650.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 10 | `order_count` | 订单数 | `integer` | 非空; 默认 — | 该小时有效订单数量。 | 计算时段客单价。 | CHECK order_count >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `72` | pos_sales_hour.order_count 只表示本字段说明中的 订单数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `source_guest_count` | 来源顾客计数 | `integer` | 可空; 默认 — | 该小时 RES 字段 num_of_guests 的原始计数；来源无值时为空。 | 只为来源对账保留；当前代码证据显示它多数等于账单数，因此不得称为进店客流或独立人数。 | CHECK source_guest_count IS NULL OR source_guest_count >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `72` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_item_sales_hour` — POS商品小时销售事实

- **用途：** 保存 listing 在每个营业小时的销量和销售额；即使尚未映射 product_id 也能完整入库。
- **一行代表：** 地点 × 营业小时 × POS listing × POS批次一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** RES/POS 单品小时报表
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存 listing 在每个营业小时的销量和销售额；即使尚未映射 product_id 也能完整入库。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 永久保留；更正以新批次追加
- **向外连接：** `pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`；`location_id` → `ops_location.location_id`；`listing_id` → `pos_product_listing.listing_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_pos_item_sales_hour_current`
- **唯一约束：** location_id + hour_started_at + listing_id + pos_ingest_batch_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** gross_sales >= 0
- **特别说明：** 这是全商品小时报表的独立来源事实；pos_order_item 目前只覆盖会员标记订单，不能替代本表。产品级分析先经 pos_product_mapping 连接 product_id，未确认 listing 不得按名称猜配。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `item_sales_hour_id` | 商品小时销售ID | `uuid` | 非空; 默认 gen_random_uuid() | 商品小时事实稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `9f9000bc-76e6-59a6-ab18-2367c4dcad08` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 非空; 默认 — | 产生该事实的来源批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `758664d3-e18d-51d0-8035-c811615389f4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 销售发生的门店地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `listing_id` | Listing ID | `uuid` | 非空; 默认 — | 来源 POS 商品身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_product_listing.listing_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7c7d8100-8fc6-5c80-ae85-0969736fe572` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 该销售小时所属营业日。 | 连接预测、计划、成本和产品占比。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 6 | `hour_started_at` | 小时开始时间 | `timestamptz` | 非空; 默认 — | 统计桶绝对开始时间。 | 支持跨午夜营业和时区正确性。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08T14:00:00+08:00` | pos_item_sales_hour.hour_started_at 只表示本字段说明中的 小时开始时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 本行所有销售金额采用的 ISO 4217 币种。 | 禁止依赖地点当前默认币种解释历史金额。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | pos_item_sales_hour.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `quantity` | 销售数量 | `numeric(18,4)` | 非空; 默认 — | 该 listing 在该小时按 POS 商品销售单位统计的净数量，退款口径由来源定义。 | 映射确认后按 product.base_unit 分析；未确认单位时不得与其他 listing 直接相加。 | CHECK quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `18` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 9 | `gross_sales` | 商品流水金额 | `numeric(18,4)` | 非空; 默认 — | 该 listing 在该小时折扣前金额。 | 分析折扣影响。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `504.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 10 | `discount_amount` | 商品折扣金额 | `numeric(18,4)` | 可空; 默认 — | 该 listing 在该小时的来源折扣金额；来源未返回独立折扣时为空。 | 解释净销售；NULL 不得当成 0，也不得默认用 gross_sales-net_sales 代替。 | CHECK discount_amount IS NULL OR discount_amount >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `28.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `net_sales` | 商品净销售额 | `numeric(18,4)` | 非空; 默认 — | 该 listing 在该小时的最终销售额。 | 产品占比、毛利和促销分析的销售分子。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `476.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 12 | `source_name_snapshot` | 来源名称快照 | `text` | 非空; 默认 — | 抓取该事实时 POS 返回的商品名称。 | 保留来源证据，即使目录后来改名。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `Dark Chocolate Wellington` | 这是来源系统证据，不等于企业统一身份。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_daily_breakdown` — POS日销售维度拆分

- **用途：** 保存支付方式、就餐方式或渠道等日销售拆分，避免把不同维度做成固定宽列。
- **一行代表：** 地点 × 营业日 × 维度类型 × 维度值 × POS批次一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **数据来源：** RES/POS breakdown 报表
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存支付方式、就餐方式或渠道等日销售拆分，避免把不同维度做成固定宽列。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`；`location_id` → `ops_location.location_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_pos_daily_breakdown_current`
- **唯一约束：** location_id + business_date + dimension_type + dimension_value + pos_ingest_batch_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `daily_breakdown_id` | 拆分事实ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条日维度拆分稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2b9c9d66-fb1b-57c6-b67c-5f642de0d98f` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 非空; 默认 — | 产生该拆分的来源批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `758664d3-e18d-51d0-8035-c811615389f4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 拆分所属门店。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 拆分事实所属营业日。 | 与日销售汇总核对。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 5 | `dimension_type` | 维度类型 | `text` | 非空; 默认 — | PAYMENT_METHOD、DINING_TYPE、CHANNEL 或其他批准类型。 | 解释 dimension_value 的含义。 | CHECK dimension_type ~ '^[A-Z][A-Z0-9_]{1,63}$' | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `PAYMENT_METHOD` | pos_daily_breakdown.dimension_type 只表示本字段说明中的 维度类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `dimension_value` | 维度值 | `text` | 非空; 默认 — | 来源维度的原始或标准代码。 | 按支付、堂食或渠道聚合。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `Membership card balance` | pos_daily_breakdown.dimension_value 只表示本字段说明中的 维度值；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `quantity` | 业务数量 | `numeric(18,4)` | 可空; 默认 — | 该维度对应的订单、交易或其他来源数量。 | 在来源有数量口径时用于核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `42` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `quantity_unit` | 数量口径单位 | `text` | 可空; 默认 — | ORDER、TRANSACTION、GUEST 或来源批准的其他计数单位。 | 防止把订单数、交易数和人数直接相加。 | CHECK quantity_unit IS NULL OR quantity_unit ~ '^[A-Z][A-Z0-9_]{1,63}$' | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `TRANSACTION` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `gross_sales` | 流水金额 | `numeric(18,4)` | 可空; 默认 — | 该维度的流水金额。 | 与净销售及折扣核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2100.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `net_sales` | 净销售额 | `numeric(18,4)` | 非空; 默认 — | 该维度的净销售金额。 | 支付和渠道占比分析。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2000.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 11 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 金额币种。 | 保证正确汇总。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | pos_daily_breakdown.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_item_waste` — POS商品报废事实

- **用途：** 保存来源报废记录及标准原因，不把试吃等营销用途默认算作损失。
- **一行代表：** 地点 × 营业日 × listing × 来源报废记录 × POS批次一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** RES/POS 报废报表
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存来源报废记录及标准原因，不把试吃等营销用途默认算作损失。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`；`location_id` → `ops_location.location_id`；`listing_id` → `pos_product_listing.listing_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_pos_item_waste_current`
- **唯一约束：** pos_ingest_batch_id + source_row_fingerprint；pos_ingest_batch_id + source_waste_id [NULLS DISTINCT：仅非空值去重，允许多条空值]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** source_waste_amount 是来源报表观察值，不等于企业配方成本损失，也不一定等于实际成交单价×数量。经营损失需要在只读视图中按 is_financial_loss、有效成本与来源金额分别展示，不能把三种口径混成一个数字。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `waste_id` | 报废ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条报废事实稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `ee592a66-3284-550c-b22f-07f8721d44c2` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 非空; 默认 — | 产生该事实的来源批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `758664d3-e18d-51d0-8035-c811615389f4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 报废发生地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `listing_id` | Listing ID | `uuid` | 非空; 默认 — | 报废商品的来源 listing。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_product_listing.listing_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7c7d8100-8fc6-5c80-ae85-0969736fe572` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `source_waste_id` | 外部报废ID | `text` | 可空; 默认 — | 来源有稳定记录 ID 时原样保存。 | 提供来源侧精确追踪；来源无 ID 时保持为空，不能伪造业务编号。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `waste_880991` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `source_row_fingerprint` | 来源行指纹 | `char(64)` | 非空; 默认 — | 按本数据集固定版本的规范化规则，对原始来源行和稳定上下文计算的 SHA-256。 | 无论来源是否提供记录 ID，都作为批次内幂等键；它证明同一输入行，不冒充跨批次业务身份。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7ac4...64位十六进制` | 指纹字段集合、空值编码、时区和算法版本必须写入数据集契约；规则改变时创建新数据集版本。 这是来源系统证据，不等于企业统一身份。 |
| 7 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 报废归属营业日。 | 连接生产计划、实际产出和成本。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 8 | `occurred_at` | 发生时间 | `timestamptz` | 可空; 默认 — | 来源能提供时记录具体报废时刻。 | 分析时段性报废。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08T20:15:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `source_name_snapshot` | 来源商品名快照 | `text` | 非空; 默认 — | 报废报表该行返回的商品名称原文。 | 保留来源行证据；listing 后续改名或映射错误时仍能核对，但不能按名称跨表连接。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `Dark Chocolate Wellington` | 这是来源系统证据，不等于企业统一身份。 |
| 10 | `quantity` | 报废数量 | `numeric(18,4)` | 非空; 默认 — | 按该 listing 的 POS 商品单位记录的报废数量。 | 只有映射与单位确认后才能和产品计划量比较。 | CHECK quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 11 | `source_waste_amount` | 来源报废金额 | `numeric(18,4)` | 可空; 默认 — | RES/POS 报废报表直接返回的金额原值；来源无值时为空。 | 保留来源独立报废金额以便核对；不得用 quantity×当前售价或当前成本重建后覆盖。 | CHECK source_waste_amount IS NULL OR source_waste_amount >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `18.00` | 这是来源系统证据，不等于企业统一身份。 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `currency` | 报废金额币种 | `char(3)` | 非空; 默认 'MYR' | source_waste_amount 使用的 ISO 4217 币种。 | 保证跨门店和历史汇总时不会把不同币种直接相加。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | pos_item_waste.currency 只表示本字段说明中的 报废金额币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `reason_raw` | 来源原因 | `text` | 可空; 默认 — | POS 返回的原始报废原因。 | 保留证据。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `Expired` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `reason_code` | 标准原因代码 | `text` | 可空; 默认 — | 映射后的标准报废、试吃、质量、损坏等原因。 | 决定是否计入损失、营销或质量成本。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `EXPIRED` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `reason_mapping_version` | 原因映射版本 | `text` | 可空; 默认 — | 把 reason_raw 转为 reason_code 的规则版本。 | 历史重算和解释原因口径变化。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `waste-reason-v2` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `is_financial_loss` | 是否计入损失 | `boolean` | 非空; 默认 — | 该原因是否纳入经营损失计算。 | 避免把试吃或市场活动误记为报废损失。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `true` | pos_item_waste.is_financial_loss 只表示本字段说明中的 是否计入损失；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 17 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_order` — POS订单稳定身份

- **用途：** 只保存来源订单的稳定身份，不把尚未证明存在的订单头金额、状态或时间硬塞进同一行。
- **一行代表：** 来源系统 × 地点 × 外部订单ID一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** 财务网站、BakeryOps、HBTI、分析/BI
- **数据来源：** RES reportId=211 的 D_orderId；未来其他已验证订单来源
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 只保存来源订单的稳定身份，不把尚未证明存在的订单头金额、状态或时间硬塞进同一行。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `source_system_id` → `app_source_system.source_system_id`；`location_id` → `ops_location.location_id`；`first_seen_pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`
- **被谁连接：** `pos_member_card_transaction.order_id`；`pos_order_item.order_id`；`pos_payment.order_id`；`pos_refund.order_id`
- **分析视图：** `v_pos_order_item_current`、`v_pos_order_member_attribution`
- **唯一约束：** source_system_id + location_id + source_order_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 已确认 reportId=211 的 D_orderId 可与会员卡交易 order_id 桥接并可按日重跑；但只在一个已知 shop/date 样本核过 18/18，不能据此宣称跨所有门店全局唯一。会员归属、商品、金额和营业日由来源事实及治理视图计算，不冗余到身份行。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `order_id` | 订单ID | `uuid` | 非空; 默认 gen_random_uuid() | 企业库内订单稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `b0aa0291-4e86-5dc3-af1d-6f6b219be4bf` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 外部订单ID所属来源命名空间。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 订单发生门店。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `first_seen_pos_ingest_batch_id` | 首次发现POS批次ID | `uuid` | 非空; 默认 — | 第一次观察到该订单身份的合格批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `770e3d6a-1f5b-565c-8f1f-13c0b7a3255e` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `source_order_id` | 外部订单ID | `text` | 非空; 默认 — | 来源在同一来源系统和地点内跨分页、跨重跑稳定的订单ID。 | 把订单商品、会员卡流水、未来支付和退款连接到同一订单；不假设跨门店全局唯一。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2086078328225419855` | 这是来源系统证据，不等于企业统一身份。 |
| 6 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_order_item` — POS订单商品最小事实

- **用途：** 按一次来源批次保存订单内同一 listing 的合计数量与净额；这是当前可稳定重跑的最小商品粒度。
- **一行代表：** POS批次 × 订单 × listing 一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** 财务网站、BakeryOps、HBTI、分析/BI
- **数据来源：** RES reportId=211 商品行，先保留原行再按订单+商品 SUM
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 按一次来源批次保存订单内同一 listing 的合计数量与净额；这是当前可稳定重跑的最小商品粒度。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`；`order_id` → `pos_order.order_id`；`listing_id` → `pos_product_listing.listing_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_pos_order_item_current`
- **唯一约束：** pos_ingest_batch_id + order_id + listing_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 来源可能返回多条完全相同的订单+商品行；在没有稳定 source_order_item_id 时，不能凭值去重或伪造行号。每批先保留原始响应证据，再按订单+listing SUM 为一行并记录 source_row_count。批次不可变；来源历史更正创建新批次，由 current 视图选版，不能 upsert 覆盖后假装没有修订。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `order_item_id` | 订单商品事实ID | `uuid` | 非空; 默认 gen_random_uuid() | 某批次内一条订单商品合计事实的稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `18670155-6ea9-5fe4-967a-910d3a01d46a` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 非空; 默认 — | 产生该订单商品快照的来源批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `758664d3-e18d-51d0-8035-c811615389f4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `order_id` | 订单ID | `uuid` | 非空; 默认 — | 所属稳定订单身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_order.order_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `b0aa0291-4e86-5dc3-af1d-6f6b219be4bf` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `listing_id` | Listing ID | `uuid` | 非空; 默认 — | 来源 POS 商品身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_product_listing.listing_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7c7d8100-8fc6-5c80-ae85-0969736fe572` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 来源报表明确返回或按地点口径筛选的营业日。 | 会员商品、复购、产品组合和日级核对的时间键。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 6 | `source_item_key_snapshot` | 来源商品键快照 | `text` | 非空; 默认 — | 本批来源返回的 D_itemName 实值；在已验证报表中实际为 POS item_key，而不是展示名称。 | 保留原始连接证据；即使 listing 映射后续修复也能复核。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1990716608733069315-1-1993240842835603462` | 这是来源系统证据，不等于企业统一身份。 |
| 7 | `source_row_count` | 合并前来源行数 | `integer` | 非空; 默认 — | 本批同一订单和商品被 SUM 前的原始行数。 | 证明重复行被保留并聚合，而不是 DISTINCT 丢失；支持来源异常监测。 | CHECK source_row_count > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2` | 这是来源系统证据，不等于企业统一身份。 |
| 8 | `quantity` | 净数量 | `numeric(18,4)` | 非空; 默认 — | 该批同一订单和 listing 按 POS 商品单位统计的来源净数量合计。 | 会员偏好和购物篮基础量；映射或单位不明时不跨商品相加，未来完整来源允许负数更正。 | CHECK quantity <> 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 9 | `net_sales` | 商品净额 | `numeric(18,4)` | 非空; 默认 — | 该批同一订单和 listing 的 M_Item_SUM_netSales 合计，可为零或负数。 | 商品收入和会员关联订单金额；不能与会员卡核销额对账。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `50.40` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 10 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 净额币种。 | 防止跨币种误加。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | pos_order_item.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `member_consumption_flag` | 来源会员消费标记 | `boolean` | 非空; 默认 — | RES 的 D_isMemberConsume 口径；当前回填因过滤条件全部为 true。 | 说明数据集覆盖范围，但不证明能解析到具体会员，也不证明该会员本人消费了全部商品。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `true` | pos_order_item.member_consumption_flag 只表示本字段说明中的 来源会员消费标记；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | COMPLETE、PRODUCT_MAPPING_PENDING、PARTIAL 或 REJECTED。 | listing 已建立但尚未确认统一 product_id、分页不完整或来源异常时阻止正式产品分析。 | CHECK quality_status IN ('COMPLETE','PRODUCT_MAPPING_PENDING','PARTIAL','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `COMPLETE` | pos_order_item.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_payment` — POS支付记录

- **用途：** 保存订单的一次支付或支付状态变化。
- **一行代表：** 每个来源支付记录一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** 财务网站、分析/BI
- **数据来源：** RES/POS 支付接口
- **实施层级：** `SOURCE_CONDITIONAL`
- **生命周期：** `SOURCE_CONDITIONAL`
- **写入/修改策略：** `SOURCE_STATE_UNTIL_TERMINAL` — 忠实跟随来源系统的业务状态至终态，终态后不擅自改写
- **最小粒度终审：** `NOT_PHASE1_SOURCE_UNVERIFIED`；存储类别 `SOURCE_CONDITIONAL`；可派生性 `UNKNOWN_UNTIL_SOURCE_VERIFIED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DEFER_UNTIL_SOURCE_PROVEN
- **为何存表而不是现算视图：** 保存订单的一次支付或支付状态变化。；外部来源身份、粒度、权限和重跑契约尚未验证，当前只保留目标契约，不建正式表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `source_system_id` → `app_source_system.source_system_id`；`order_id` → `pos_order.order_id`；`first_seen_pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`；`last_seen_pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** source_system_id + source_payment_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 仅在支付接口的稳定ID、状态终态、整单重跑和撤销语义得到实测证明后实施；source_system_id、order_id 与两个批次必须属于同一来源命名空间。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `payment_id` | 支付ID | `uuid` | 非空; 默认 gen_random_uuid() | 企业库内支付稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `f45194ac-7e28-5b9a-abb7-4dd7cc001c97` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 外部支付ID所属来源命名空间。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 3 | `order_id` | 订单ID | `uuid` | 非空; 默认 — | 支付对应订单。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_order.order_id | 不适用。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `b0aa0291-4e86-5dc3-af1d-6f6b219be4bf` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `first_seen_pos_ingest_batch_id` | 首次发现POS批次ID | `uuid` | 非空; 默认 — | 第一次采集到该支付记录的批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `770e3d6a-1f5b-565c-8f1f-13c0b7a3255e` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `last_seen_pos_ingest_batch_id` | 最近发现POS批次ID | `uuid` | 非空; 默认 — | 最近一次确认支付状态的合格批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `25cc262a-1e3a-51ba-9fd2-aafad738ea0f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 6 | `source_payment_id` | 外部支付ID | `text` | 非空; 默认 — | 来源系统稳定支付记录ID。 | 保证支付幂等并支持多支付方式。 | — | 不适用。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `pay_88201` | 这是来源系统证据，不等于企业统一身份。 |
| 7 | `payment_method_code` | 支付方式代码 | `text` | 非空; 默认 — | 来源映射后的标准支付方式。 | 财务对账和会员卡核销分析。 | — | 不适用。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `CARD_BALANCE` | pos_payment.payment_method_code 只表示本字段说明中的 支付方式代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `amount` | 支付金额 | `numeric(18,4)` | 非空; 默认 — | 该支付记录实际支付金额。 | 订单净额和现金流核对。 | — | 不适用。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `50.40` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 9 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 支付金额币种。 | 防止跨币种误加。 | — | 不适用。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `MYR` | pos_payment.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `status` | 支付状态 | `text` | 非空; 默认 — | PENDING、CAPTURED、VOIDED 或 REFUNDED。 | 决定是否计入有效支付。 | CHECK status IN ('PENDING','CAPTURED','VOIDED','REFUNDED') | 不适用。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `CAPTURED` | pos_payment.status 只表示本字段说明中的 支付状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `paid_at` | 支付时间 | `timestamptz` | 非空; 默认 — | 支付成功或记录发生时间。 | 与订单和交易网关对账。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `2026-08-08T18:18:00+08:00` | pos_payment.paid_at 只表示本字段说明中的 支付时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 SOURCE_STATE_UNTIL_TERMINAL：忠实跟随来源系统的业务状态至终态，终态后不擅自改写。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_refund` — POS退款记录

- **用途：** 保存订单或订单行级退款，不用负销售行替代退款事实。
- **一行代表：** 每个来源退款记录一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **数据来源：** RES/POS 退款接口
- **实施层级：** `SOURCE_CONDITIONAL`
- **生命周期：** `SOURCE_CONDITIONAL`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_SOURCE_UNVERIFIED`；存储类别 `SOURCE_CONDITIONAL`；可派生性 `UNKNOWN_UNTIL_SOURCE_VERIFIED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DEFER_UNTIL_SOURCE_PROVEN
- **为何存表而不是现算视图：** 保存订单或订单行级退款，不用负销售行替代退款事实。；外部来源身份、粒度、权限和重跑契约尚未验证，当前只保留目标契约，不建正式表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `source_system_id` → `app_source_system.source_system_id`；`first_seen_pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`；`order_id` → `pos_order.order_id`；`listing_id` → `pos_product_listing.listing_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** source_system_id + source_refund_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 仅在退款接口的稳定ID、订单/商品定位、撤销与重跑语义得到实测证明后实施；来源更正不可覆盖原退款事实，具体事件模型以来源能力验收为准。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `refund_id` | 退款ID | `uuid` | 非空; 默认 gen_random_uuid() | 企业库内退款稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `894e17c5-84e8-5cd3-8b94-929bd1d2a3de` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 外部退款ID所属来源命名空间。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 3 | `first_seen_pos_ingest_batch_id` | 首次发现POS批次ID | `uuid` | 非空; 默认 — | 第一次采集到该退款事件的合格批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `770e3d6a-1f5b-565c-8f1f-13c0b7a3255e` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `order_id` | 订单ID | `uuid` | 非空; 默认 — | 退款对应订单。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_order.order_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `b0aa0291-4e86-5dc3-af1d-6f6b219be4bf` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `listing_id` | Listing ID | `uuid` | 可空; 默认 — | 退款能定位商品时连接来源 listing；整单退款或来源无商品键时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_product_listing.listing_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7c7d8100-8fc6-5c80-ae85-0969736fe572` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `source_refund_id` | 外部退款ID | `text` | 非空; 默认 — | 来源系统稳定退款记录ID。 | 保证退款幂等。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `refund_1201` | 这是来源系统证据，不等于企业统一身份。 |
| 7 | `quantity` | 退款数量 | `numeric(18,4)` | 可空; 默认 — | 订单行退款时按原 listing POS 商品单位记录的数量。 | 还原净销量；未连接 listing 时不得猜单位。 | CHECK quantity IS NULL OR quantity > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `amount` | 退款金额 | `numeric(18,4)` | 非空; 默认 — | 实际退款金额。 | 销售和支付对账。 | CHECK amount >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `28.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 9 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 退款金额币种。 | 保证正确汇总。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | pos_refund.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `reason_code` | 退款原因代码 | `text` | 可空; 默认 — | 标准退款原因。 | 质量和运营分析。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `CUSTOMER_RETURN` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `reason_raw` | 来源退款原因 | `text` | 可空; 默认 — | 来源原始退款说明；需防止 PII。 | 保留证据但不得未经检查进入普通分析。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `restricted` | `Customer return` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `refunded_at` | 退款时间 | `timestamptz` | 非空; 默认 — | 退款实际发生时间。 | 按发生期计入财务和销售口径。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08T20:00:00+08:00` | pos_refund.refunded_at 只表示本字段说明中的 退款时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_member` — POS会员主档

- **用途：** 只保存会员非敏感稳定身份和企业治理状态；每天变化的等级、积分、累计值和余额进入会员状态快照，联系方式另表隔离。
- **一行代表：** 每个企业内可识别的 POS 会员一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** 财务网站、HBTI、分析/BI
- **数据来源：** RES 客户档案与会员卡列表并集
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `PARTIAL_FIELDS_DERIVED_IN_VIEW`
- **可派生字段/输出：** has_card -> EXISTS(pos_member_card)；has_profile/last_snapshot_date/level/growth/points/lifetime amounts/current balances -> v_pos_member_state_current from append-only snapshots
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 只保存会员非敏感稳定身份和企业治理状态；每天变化的等级、积分、累计值和余额进入会员状态快照，联系方式另表隔离。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 按会员隐私政策保留；长期未出现先标 STALE，不自动删除事实
- **向外连接：** `source_system_id` → `app_source_system.source_system_id`；`home_location_id` → `ops_location.location_id`；`merged_into_member_id` → `pos_member.member_id`
- **被谁连接：** `app_one_time_token.member_id`；`mkt_campaign_member.member_id`；`msg_conversation.member_id`；`pos_member.merged_into_member_id`；`pos_member_balance_snapshot.member_id`；`pos_member_card.member_id`；`pos_member_card_transaction.member_id`；`pos_member_contact.member_id`
- **分析视图：** `v_pos_order_member_attribution`
- **唯一约束：** source_system_id + source_member_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 本表是稳定身份，不保存 has_card、has_profile、last_snapshot_date、等级、积分、余额或累计充值/消费。has_card 从 pos_member_card 派生；来源覆盖和所有时变值从 pos_member_balance_snapshot 及 v_pos_member_state_current 派生，避免同步重跑覆盖历史。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `member_id` | 会员ID | `uuid` | 非空; 默认 gen_random_uuid() | 企业库内会员稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ca70f98b-3820-5620-9a6b-71b5098f4e17` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 当前会员来源的 POS 系统。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 3 | `home_location_id` | 注册地点ID | `uuid` | 可空; 默认 — | 来源可确认的注册或主归属门店；未知为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `94ab4141-ba02-57af-a574-a8e82c4e01e4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `source_member_id` | 外部会员ID | `text` | 非空; 默认 — | POS customerId 等稳定会员标识。 | 与来源系统共同唯一，所有交易通过 member_id 连接。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `customer_81129` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `registered_on` | 注册日期 | `date` | 可空; 默认 — | 会员在来源系统登记日期。 | 会员生命周期分析；来源无档案时允许为空。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-01-12` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `source_type` | 会员来源类型 | `text` | 可空; 默认 — | POS 提供的注册来源或渠道代码。 | 分析获客渠道；缺失保持 NULL。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `In-store` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `status` | 治理状态 | `text` | 非空; 默认 'ACTIVE' | 企业内部治理状态：ACTIVE、BLOCKED 或 MERGED；它不是 POS 每日来源会员状态。 | 控制是否允许联系、合并和业务使用；来源是否仍有档案由快照派生。 | CHECK status IN ('ACTIVE','BLOCKED','MERGED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | pos_member.status 只表示本字段说明中的 治理状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `merged_into_member_id` | 合并目标会员ID | `uuid` | 可空; 默认 — | 重复会员合并后指向保留会员。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_member.member_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `9ca9a07e-8093-5d0c-a658-5bb9837b6554` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 10 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_member_contact` — 会员联系方式

- **用途：** 隔离存放业务明确批准保留的会员手机号，并支持换号历史。
- **一行代表：** 会员 × 联系方式类型 × 有效期一行
- **写入责任：** RES/POS 同步服务的受限写入路径
- **读取项目：** 授权会员运营
- **数据来源：** RES 客户档案接口
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 隔离存放业务明确批准保留的会员手机号，并支持换号历史。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 按会员隐私政策保留；失效后到期删除密文
- **向外连接：** `member_id` → `pos_member.member_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** member_id + lookup_hash + valid_from
- **不可重叠约束：** NO_OVERLAP(member_id, contact_type, tstzrange(valid_from, valid_to, '[)'))
- **表级检查：** valid_to IS NULL OR valid_to > valid_from
- **特别说明：** 来源身份、密文、哈希和 valid_from 写入后冻结；仅允许补写 verified_at 或关闭 valid_to，关闭后整行冻结。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `member_contact_id` | 联系方式ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条会员联系方式稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `61f844c7-e638-5041-8703-942c4eee2d51` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `member_id` | 会员ID | `uuid` | 非空; 默认 — | 联系方式所属会员。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_member.member_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ca70f98b-3820-5620-9a6b-71b5098f4e17` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `contact_type` | 联系方式类型 | `text` | 非空; 默认 'PHONE' | 当前批准 PHONE；未来扩展必须重新做字段隐私评审。 | 防止未经评审顺手加入姓名、邮箱等 PII。 | CHECK contact_type = 'PHONE' | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `PHONE` | pos_member_contact.contact_type 只表示本字段说明中的 联系方式类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `contact_ciphertext` | 加密联系方式 | `bytea` | 非空; 默认 — | 应用层加密后的 E.164 手机号。 | 仅授权联系流程可解密。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `secret` | `<encrypted bytes>` | pos_member_contact.contact_ciphertext 只表示本字段说明中的 加密联系方式；必须在所属对象粒度内按 bytea 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `lookup_hash` | 检索哈希 | `char(64)` | 非空; 默认 — | 标准化号码的带密钥哈希。 | 无需解密即可精确去重和查找。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `restricted` | `4e9a...64位十六进制` | pos_member_contact.lookup_hash 只表示本字段说明中的 检索哈希；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `country_calling_code` | 国家区号 | `text` | 可空; 默认 — | 非敏感的电话国家代码，例如 +60。 | 辅助格式和运营区域分析。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `personal` | `+60` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `valid_from` | 生效时间 | `timestamptz` | 非空; 默认 — | 号码开始被观察为当前号码的时间。 | 保留换号历史。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-01-12T00:00:00+08:00` | pos_member_contact.valid_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `valid_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 号码不再有效的时间。 | 阻止向旧号发送消息。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `verified_at` | 验证时间 | `timestamptz` | 可空; 默认 — | 号码经过验证码或权威来源确认的时间。 | 区分来源快照与主动验证。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 11 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_member_card` — 会员卡

- **用途：** 把一名会员的多张卡拆为独立身份，避免把卡余额永远聚合进会员主档。
- **一行代表：** 每张来源会员卡一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** 财务网站、HBTI、分析/BI
- **数据来源：** RES 会员卡列表
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 把一名会员的多张卡拆为独立身份，避免把卡余额永远聚合进会员主档。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `member_id` → `pos_member.member_id`；`source_system_id` → `app_source_system.source_system_id`；`issued_location_id` → `ops_location.location_id`
- **被谁连接：** `pos_member_card_transaction.member_card_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** source_system_id + source_card_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 外部卡号只在 source_system_id 命名空间内唯一；受控写入必须校验 member_id 对应会员的来源系统一致，禁止把不同 POS 的同号卡合并。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `member_card_id` | 会员卡ID | `uuid` | 非空; 默认 gen_random_uuid() | 企业库内会员卡稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `e7c40878-2388-55ca-ac44-00390949f04d` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `member_id` | 会员ID | `uuid` | 非空; 默认 — | 卡所属会员。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_member.member_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ca70f98b-3820-5620-9a6b-71b5098f4e17` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 该外部卡ID所属的来源命名空间。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 4 | `issued_location_id` | 发卡地点ID | `uuid` | 可空; 默认 — | 来源可确认的发卡地点；未知为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7179005b-f804-50c6-9281-e989f8b50b5e` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `source_card_id` | 外部卡ID | `text` | 非空; 默认 — | POS 中稳定的卡标识。 | 与来源系统共同连接卡级交易；当前会员余额快照是会员合计，不能通过该字段拆到卡。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `card_91821` | 这是来源系统证据，不等于企业统一身份。 |
| 6 | `card_type_code` | 卡类型代码 | `text` | 可空; 默认 — | 来源卡种或企业标准卡类型。 | 区分储值、赠送或其他卡。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `MEMBER_STORED_VALUE` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `issued_at` | 发卡时间 | `timestamptz` | 可空; 默认 — | 来源可提供时记录发卡时刻。 | 会员卡生命周期分析。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-01-12T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `expires_at` | 卡到期时间 | `timestamptz` | 可空; 默认 — | 卡的业务到期时间。 | 控制使用资格。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2028-01-12T23:59:59+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `status` | 卡状态 | `text` | 非空; 默认 'UNKNOWN' | ACTIVE、FROZEN、EXPIRED、CLOSED 或 UNKNOWN。 | 决定余额和交易使用。 | CHECK status IN ('ACTIVE','FROZEN','EXPIRED','CLOSED','UNKNOWN') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | pos_member_card.status 只表示本字段说明中的 卡状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `last_snapshot_date` | 最近快照日期 | `date` | 非空; 默认 — | 最近一次在卡列表观察到的日期。 | 识别过期来源数据。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-08` | pos_member_card.last_snapshot_date 只表示本字段说明中的 最近快照日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 12 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_member_balance_snapshot` — 会员状态与余额快照

- **用途：** 保存来源在某日直接观察到、无法从不完整流水可靠反推的会员等级、积分、累计值和会员名下全部卡余额。
- **一行代表：** 会员 × 快照日期 × POS批次一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** 财务网站、HBTI、分析/BI
- **数据来源：** RES 客户档案状态与余额快照
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `PARTIAL_FIELDS_DERIVED_IN_VIEW`
- **可派生字段/输出：** partial flag and missing fields -> nullable balances + pos_ingest_batch status
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存来源在某日直接观察到、无法从不完整流水可靠反推的会员等级、积分、累计值和会员名下全部卡余额。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `member_id` → `pos_member.member_id`；`pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_pos_member_state_current`
- **唯一约束：** member_id + snapshot_date + pos_ingest_batch_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 当前证据只证明 /crm 返回会员名下全部卡的聚合状态和余额，所以本表明确采用会员级快照粒度；不得把聚合余额复制给第一张卡或平均分摊。MEMBER_PROFILE 批次必须以客户档案与卡列表并集为成员全集：只有卡而无档案的会员也写 profile_present=false 快照，禁止用‘本批没有行’含糊表示档案不存在。未来只有在来源提供稳定 source_card_id 和卡级余额契约后，才另行评审卡级快照。字段缺失保留 NULL；完整性由字段 NULL 状态和 pos_ingest_batch.status 派生，不重复保存 is_partial/missing_sources。当前值只由 v_pos_member_state_current 确定性选出，绝不回写覆盖历史。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `member_balance_snapshot_id` | 余额快照ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条余额快照稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `58f15536-3a16-5f6c-a0ce-ba863627a468` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `member_id` | 会员ID | `uuid` | 非空; 默认 — | 余额所属会员；当前来源只证明会员名下全部卡合计，不能伪造到具体卡。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_member.member_id | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `ca70f98b-3820-5620-9a6b-71b5098f4e17` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 非空; 默认 — | 产生余额快照的来源批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `758664d3-e18d-51d0-8035-c811615389f4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `snapshot_date` | 快照日期 | `date` | 非空; 默认 — | 余额被来源观察到的营业日期。 | 月末储值负债和完整性分析。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `2026-08-08` | pos_member_balance_snapshot.snapshot_date 只表示本字段说明中的 快照日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `profile_present` | 客户档案是否存在 | `boolean` | 非空; 默认 true | 该批 MEMBER_PROFILE 抓取是否直接观察到该会员的客户档案。 | 区分只有卡身份的会员、档案真实存在和来源缺失；当前状态从最新合格快照派生。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `true` | pos_member_balance_snapshot.profile_present 只表示本字段说明中的 客户档案是否存在；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `level_name` | 来源会员等级 | `text` | 可空; 默认 — | 该快照日 POS 客户档案直接报告的会员等级原文。 | 保留等级历史；不得把等级名称当稳定ID或由消费额猜算。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `Gold` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `growth` | 来源成长值 | `integer` | 可空; 默认 — | 该快照日 POS 直接报告的当前成长值。 | 保留无法从本库交易完整重建的等级进度。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `1820` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `point_balance` | 来源积分余额 | `integer` | 可空; 默认 — | 该快照日 POS 直接报告的可用积分存量。 | 积分流水不完整时保留来源存量；不得按消费金额猜算。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `460` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `lifetime_topup_amount` | 来源累计充值金额 | `numeric(18,4)` | 可空; 默认 — | 该快照日 POS 直接报告的生命周期累计充值金额。 | 与本库明细复算值核对并保留来源口径历史，不覆盖来源原值。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `1280.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `lifetime_topup_count` | 来源累计充值次数 | `integer` | 可空; 默认 — | 该快照日 POS 直接报告的生命周期累计充值次数。 | 保留来源历史累计观察。 | CHECK lifetime_topup_count IS NULL OR lifetime_topup_count >= 0 | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `12` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `lifetime_consume_amount` | 来源累计消费金额 | `numeric(18,4)` | 可空; 默认 — | 该快照日 POS 直接报告的生命周期累计消费金额。 | 当前订单商品只覆盖部分会员消费，不能可靠反推此来源累计值。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `3520.40` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `lifetime_consume_count` | 来源累计消费次数 | `integer` | 可空; 默认 — | 该快照日 POS 直接报告的生命周期累计消费次数。 | 保留来源累计消费频次历史。 | CHECK lifetime_consume_count IS NULL OR lifetime_consume_count >= 0 | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `47` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `first_card_created_on` | 来源首卡创建日期 | `date` | 可空; 默认 — | 该快照日 POS 客户档案直接报告的最早会员卡创建日期。 | 卡列表可能不完整时保留来源生命周期观察；若能从全部卡确定性复算则用于核对，不覆盖原值。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `2026-01-12` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `last_recharge_at` | 来源最近充值时间 | `timestamptz` | 可空; 默认 — | 该快照日 POS 客户档案直接报告的最近充值时刻。 | 流水窗口不完整时保留来源新鲜度观察；不能用抓取时间填补。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `2026-07-31T18:20:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `last_transaction_at` | 来源最近交易时间 | `timestamptz` | 可空; 默认 — | 该快照日 POS 客户档案直接报告的最近交易时刻。 | 用于活跃度和来源累计值新鲜度核对；不能由有限滚动流水冒充完整历史。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `2026-08-06T12:05:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `cash_balance` | 现金储值余额 | `numeric(18,4)` | 可空; 默认 — | 会员实际充值现金形成的剩余余额。 | 与现金充值和核销分析。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `120.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `gift_balance` | 赠送余额 | `numeric(18,4)` | 可空; 默认 — | 促销赠送形成的剩余余额。 | 区别现金负债与赠送额度。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `20.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `frozen_balance` | 冻结余额 | `numeric(18,4)` | 可空; 默认 — | 来源直接报告、当前不可用的冻结余额。 | 区分可用余额与因风控或业务规则冻结的存量。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `0.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `total_balance` | 来源总余额 | `numeric(18,4)` | 可空; 默认 — | 来源直接报告的会员名下现金与赠送等余额总计。 | 作为独立来源总计与组成字段核对，不用组成相加覆盖原值。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `140.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 20 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 余额及累计充值、消费金额采用的 ISO 4217 币种。 | 禁止依赖地点当前币种重新解释历史来源金额。 | CHECK currency ~ '^[A-Z]{3}$' | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `MYR` | pos_member_balance_snapshot.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 21 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_member_card_transaction` — 会员卡交易流水

- **用途：** 保存充值、消费核销、退款和余额调整的不可变事件。
- **一行代表：** 每笔来源会员卡交易一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** 财务网站、HBTI、分析/BI
- **数据来源：** RES 会员卡交易报表
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存充值、消费核销、退款和余额调整的不可变事件。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 永久保留；不存手机号、姓名、邮箱或自由备注
- **向外连接：** `member_id` → `pos_member.member_id`；`member_card_id` → `pos_member_card.member_card_id`；`source_system_id` → `app_source_system.source_system_id`；`location_id` → `ops_location.location_id`；`pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`；`order_id` → `pos_order.order_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_pos_order_member_attribution`
- **唯一约束：** source_system_id + location_id + source_transaction_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** num_nonnulls(member_id, source_member_id, member_card_id, source_card_id) >= 1；currency ~ '^[A-Z]{3}$'
- **特别说明：** 订单会员归属不复制到 pos_order 或 pos_order_item。治理视图按 order_id 聚合不同 member_id：恰好一人才能解析，零人标 UNMATCHED，多人标 AMBIGUOUS 并保留全部候选流水。total_amount 是卡值变动，trade_amount 是类型相关来源金额，两者都不等于订单商品 net_sales。当前 source 字段由 pos_ingest_batch.dataset_code/source_system_id 承接，fetched_at 由批次完成时间承接；不在每条流水重复保存。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `member_card_transaction_id` | 卡交易ID | `uuid` | 非空; 默认 gen_random_uuid() | 企业库内卡交易稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `88496576-b66f-5395-9350-2dc66758b753` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `member_id` | 会员ID | `uuid` | 可空; 默认 — | 已成功解析到企业稳定会员身份时记录；来源缺失或会员快照尚未覆盖时为空，绝不猜配。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_member.member_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `ca70f98b-3820-5620-9a6b-71b5098f4e17` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `source_member_id` | 来源会员ID | `text` | 可空; 默认 — | 当前流水 member_id 的来源原值；来源为空则保持 NULL。 | 即使稳定 member_id 暂未解析也保留证据，后续可重放映射。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `internal` | `customer_81129` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `member_card_id` | 会员卡ID | `uuid` | 可空; 默认 — | 来源能确认时对应具体卡。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_member_card.member_card_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e7c40878-2388-55ca-ac44-00390949f04d` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `source_card_id` | 来源卡号 | `text` | 可空; 默认 — | 当前流水 card_no 的原始文本，可能是长数字、短数字或含字母。 | 在卡主档尚未同步或映射失败时仍无损保留卡身份证据。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `internal` | `A1222` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 外部交易和订单ID所属来源命名空间。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 7 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 交易发生或归属门店。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 8 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 非空; 默认 — | 采集该流水的来源批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `758664d3-e18d-51d0-8035-c811615389f4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 9 | `source_transaction_id` | 外部交易ID | `text` | 非空; 默认 — | 来源稳定交易标识。 | 实现跨重跑幂等。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `txn_100150_88192` | 这是来源系统证据，不等于企业统一身份。 |
| 10 | `source_transaction_type_code` | 来源交易类型码 | `smallint` | 非空; 默认 — | POS 原始 txn_type 数值代码，按来源原样保存；当前已观察 10、20、30、40、50、60，但不把未来未知代码拒绝或猜成现有类型。 | 保留最原始交易分类证据；标准 transaction_type 变化时仍能按批次 parser_version 重放。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `20` | 这是来源系统证据，不等于企业统一身份。 |
| 11 | `source_transaction_type_label` | 来源交易类型标签 | `text` | 非空; 默认 — | POS 同步结果中的 txn_type_label 原值。 | 保留来源/旧同步脚本已经给出的标签，供标准化规则核对；不能替代原始数值码。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `consume` | 这是来源系统证据，不等于企业统一身份。 |
| 12 | `transaction_type` | 标准交易类型 | `text` | 非空; 默认 — | 由原始代码和标签按批次 parser_version 规范成 TOP_UP、CONSUME、TOP_UP_REFUND、CONSUME_REFUND、ADJUST_UP、ADJUST_DOWN 或 UNKNOWN。 | 供跨来源统一计算；UNKNOWN 必须显式进入质量检查，禁止把未知代码猜进任何金额口径。 | CHECK transaction_type IN ('TOP_UP','CONSUME','TOP_UP_REFUND','CONSUME_REFUND','ADJUST_UP','ADJUST_DOWN','UNKNOWN') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `CONSUME` | pos_member_card_transaction.transaction_type 只表示本字段说明中的 标准交易类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `occurred_at` | 发生时间 | `timestamptz` | 可空; 默认 — | 来源 txn_at 经明确 KL 墙上时间规则转换后的绝对时刻；来源缺失时为空。 | 日内排序和会计期间核对；不得用抓取时间填补缺失业务时间。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08T15:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 按地点切点归属的营业日。 | 与销售和会员日指标连接。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 15 | `cash_amount` | 现金面值部分 | `numeric(18,4)` | 可空; 默认 — | 来源 money_amount 原值；表示交易中的现金储值或核销部分，来源缺失时保持 NULL。 | 区分现金负债；禁止把未知值默认成0。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `100.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `gift_amount` | 赠送面值部分 | `numeric(18,4)` | 可空; 默认 — | 来源 gift_amount 原值；表示交易中的赠送额度部分，来源缺失时保持 NULL。 | 区分促销成本；禁止把未知值默认成0。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `10.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `total_amount` | 卡值变动总额 | `numeric(18,4)` | 可空; 默认 — | 来源 total_amount 原值，当前来源定义为 money_amount + gift_amount，来源缺失时保持 NULL。 | 作为真正卡值变动与组成及前后余额核对；它不是订单商品净额。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `110.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `trade_amount` | 来源交易金额 | `numeric(18,4)` | 可空; 默认 — | 来源 trade_amount 原值；语义随原始类型变化：充值为本金、消费/退款为含赠送卡值、调整当前观察为0。 | 仅在明确交易类型范围内使用；当前只有原始类型20/40汇总可与会员卡支付拆分核对，禁止跨类型直接求和。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `110.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `before_money_balance` | 交易前现金余额 | `numeric(18,4)` | 可空; 默认 — | 来源在该交易发生前直接报告的卡现金余额。 | 证明单笔交易前状态并发现缺失或乱序流水；不能用当前余额倒推。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `220.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 20 | `after_money_balance` | 交易后现金余额 | `numeric(18,4)` | 可空; 默认 — | 来源在该交易发生后直接报告的卡现金余额。 | 与交易金额核对来源流水连续性。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `120.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 21 | `before_gift_balance` | 交易前赠送余额 | `numeric(18,4)` | 可空; 默认 — | 来源在该交易发生前直接报告的卡赠送余额。 | 保留赠送额度变化证据。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `30.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 22 | `after_gift_balance` | 交易后赠送余额 | `numeric(18,4)` | 可空; 默认 — | 来源在该交易发生后直接报告的卡赠送余额。 | 与 gift_amount 核对赠送额度变化。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `20.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 23 | `point_delta` | 积分变动 | `integer` | 可空; 默认 — | 来源随该交易直接报告的积分增加或扣减数量；无积分信息时为空。 | 形成积分变化的最小事件输入，不能按消费金额猜算。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `-40` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 24 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 交易金额币种。 | 保证正确汇总。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | pos_member_card_transaction.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 25 | `order_id` | 订单ID | `uuid` | 可空; 默认 — | 已解析到稳定订单身份时的强连接；充值等非订单流水或尚未解析时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_order.order_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `b0aa0291-4e86-5dc3-af1d-6f6b219be4bf` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 26 | `source_pos_order_no` | 来源POS订单号 | `text` | 可空; 默认 — | 当前表 pos_order_no 的原始文本；来源未提供或没有订单语义时为空。 | 保留与门店票据/报表使用的订单号证据，不与 source_order_id 强行合并。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `PAV-20260808-01892` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 27 | `source_order_id` | 来源订单ID | `text` | 可空; 默认 — | 当前表 order_id 的外部原值；没有订单语义时为空。 | 即使强映射暂缺也保留来源证据，并与 source_system_id、location_id 一起解析稳定 order_id。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2086078328225419855` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 28 | `source_code` | 来源记录代码 | `text` | 可空; 默认 — | 当前交易行 source_code 的原始值；来源为空则保持 NULL。 | 保留来源内部分类或追踪证据；语义未验证前不得进入金额或交易类型计算。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `CARD_CONSUME` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 29 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `pos_member_daily_metric` — 会员日指标

- **用途：** 保存会员人数、消费、充值、核销、调整和期末余额等来源日报原值；比率和可重算净额只在视图派生。
- **一行代表：** 地点 × 营业日 × POS批次一行
- **写入责任：** RES/POS 同步服务
- **读取项目：** 财务网站、HBTI、分析/BI
- **数据来源：** RES 会员相关日报接口
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `PARTIAL_FIELDS_DERIVED_IN_VIEW`
- **可派生字段/输出：** source/POS member-sales ratios -> v_pos_member_daily_summary；card payment net and source/POS ratios -> v_pos_member_daily_summary；topup total and stored-value face net -> v_pos_member_daily_summary；partial flag and missing fields -> nullable measures + pos_ingest_batch status
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存会员人数、消费、充值、核销、调整和期末余额等来源日报原值；比率和可重算净额只在视图派生。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `location_id` → `ops_location.location_id`；`pos_ingest_batch_id` → `pos_ingest_batch.pos_ingest_batch_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_pos_member_daily_metric_current`
- **唯一约束：** location_id + business_date + pos_ingest_batch_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 这是 RES 会员日报的独立来源观察，不是从 pos_order_item 或卡流水复制的系统汇总：当前订单商品事实只覆盖会员标记订单，卡交易金额也不等于商品净额。card_payment_net=redeem_amount+consume_refund、stored_value_face_net=topup_face_value+topup_refund+adjust_net-redeem_amount-consume_refund、topup_total=topup_face_value+topup_adjust_amount 均在视图派生，不物理重复。各指标缺失时保留 NULL；完整性由必需指标的 NULL 状态与 pos_ingest_batch.status 派生，不存 is_partial/missing_sources 副本。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `member_daily_metric_id` | 会员日指标ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条会员日指标稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `8f0df83e-d6f6-5555-addc-79b5c9c19c78` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 指标所属门店。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 非空; 默认 — | 产生指标的来源批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_ingest_batch.pos_ingest_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `758664d3-e18d-51d0-8035-c811615389f4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 指标所属营业日。 | 与 POS 日销售和财务日表核对。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 5 | `new_member_count` | 新增会员数 | `integer` | 可空; 默认 — | 来源日报直接报告的当日新增会员人数。 | 保留来源获客口径；不能按当前会员注册日反算。 | CHECK new_member_count IS NULL OR new_member_count >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `12` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `consumed_member_count` | 消费会员数 | `integer` | 可空; 默认 — | 来源日报直接报告的当日发生消费的去重会员数。 | 会员归属覆盖不完整时不可由订单明细可靠重建。 | CHECK consumed_member_count IS NULL OR consumed_member_count >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `186` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `recharged_member_count` | 充值会员数 | `integer` | 可空; 默认 — | 来源日报直接报告的当日发生充值的去重会员数。 | 衡量储值参与人数。 | CHECK recharged_member_count IS NULL OR recharged_member_count >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `9` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `points_member_count` | 积分变动会员数 | `integer` | 可空; 默认 — | 来源日报直接报告的当日发生积分变化的去重会员数。 | 保留积分活动覆盖面。 | CHECK points_member_count IS NULL OR points_member_count >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `142` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `member_sales` | 会员贡献销售额 | `numeric(18,4)` | 可空; 默认 — | 已识别会员订单的全部销售额，不限支付方式。 | 计算会员销售贡献占比。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `18000.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `total_consume_amount` | 来源总消费金额 | `numeric(18,4)` | 可空; 默认 — | 会员日报接口直接报告、用于其会员贡献率和卡支付率的当日总消费分母。 | 保留来源自身口径；不得默认等于 POS 日净销售。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `53680.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `topup_cash` | 充值现金本金 | `numeric(18,4)` | 可空; 默认 — | 来源日报直接报告的正常充值现金本金。 | 分析现金储值流入。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `800.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `topup_gift` | 充值赠送金额 | `numeric(18,4)` | 可空; 默认 — | 来源日报直接报告的充值赠送价值。 | 分析储值促销成本。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `80.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `topup_face_value` | 充值面值 | `numeric(18,4)` | 可空; 默认 — | 来源日报直接报告的正常充值总面值。 | 与现金和赠送组成核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `880.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `topup_count` | 充值笔数 | `integer` | 可空; 默认 — | 来源日报直接报告的正常充值交易笔数。 | 衡量充值频次。 | CHECK topup_count IS NULL OR topup_count >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `10` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `topup_refund` | 充值退款 | `numeric(18,4)` | 可空; 默认 — | 来源日报直接报告的充值退款金额；符号遵循来源。 | 解释储值面值净变化。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `-50.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `redeem_amount` | 卡核销总额 | `numeric(18,4)` | 可空; 默认 — | 来源日报直接报告的会员卡消费核销总额。 | 与卡支付拆分和交易流水独立核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `6250.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `redeem_cash` | 卡核销现金部分 | `numeric(18,4)` | 可空; 默认 — | 来源日报直接报告的核销现金余额部分。 | 区分现金负债释放。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `5900.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `redeem_gift` | 卡核销赠送部分 | `numeric(18,4)` | 可空; 默认 — | 来源日报直接报告的核销赠送余额部分。 | 区分赠送成本释放。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `350.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `redeem_count` | 卡核销笔数 | `integer` | 可空; 默认 — | 来源日报直接报告的会员卡核销交易笔数。 | 衡量卡支付频次。 | CHECK redeem_count IS NULL OR redeem_count >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `128` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 20 | `consume_refund` | 消费退款 | `numeric(18,4)` | 可空; 默认 — | 来源日报直接报告的卡消费退款金额；符号遵循来源。 | 与 redeem_amount 一起派生卡净核销。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `-50.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 21 | `adjust_net` | 后台调整净额 | `numeric(18,4)` | 可空; 默认 — | 来源日报直接报告的卡余额后台调增减净额。 | 保留无法从正常充值与消费类别替代的调整事实。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `30000.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 22 | `topup_adjust_amount` | 调整中认定为充值 | `numeric(18,4)` | 可空; 默认 — | 写入规则从后台调整中分类为客户预存的金额。 | 使对外充值口径可复核；分类规则版本必须在 POS 批次证据中冻结。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `30000.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 23 | `adjust_correction` | 调整中认定为纠错 | `numeric(18,4)` | 可空; 默认 — | 后台调整中不计入充值、被分类为补偿或纠错的金额。 | 与 topup_adjust_amount 共同解释 adjust_net。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `0.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 24 | `stored_value_cash_net` | 现金储值净额 | `numeric(18,4)` | 可空; 默认 — | 现金充值、退款和调整后的日净变化。 | 与财务模板的月度储值指标保持独立并用于核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `850.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 25 | `balance_end_total` | 期末储值总余额 | `numeric(18,4)` | 可空; 默认 — | 来源累计区间直接报告的期末现金加赠送余额总额。 | 作为独立来源总计与组成余额核对，不能用单日交易不完整反推。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `48450.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 26 | `balance_end_cash` | 期末现金余额 | `numeric(18,4)` | 可空; 默认 — | 当日抓取的会员卡现金余额总存量。 | 无法事后仅靠流水完整反推。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `40250.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 27 | `balance_end_gift` | 期末赠送余额 | `numeric(18,4)` | 可空; 默认 — | 当日抓取的会员卡赠送余额总存量。 | 衡量未来赠送核销负担。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `8200.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 28 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 所有金额币种。 | 保证正确汇总。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | pos_member_daily_metric.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 29 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

# HR — 人员、招聘、培训与工时

## `hr_person` — 自然人主数据

- **用途：** 为候选人和员工提供不随雇佣关系变化的稳定 person_id。
- **一行代表：** 每个自然人一行
- **写入责任：** HR 主数据流程
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 招聘、员工导入和人工去重
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 为候选人和员工提供不随雇佣关系变化的稳定 person_id。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 按马来西亚劳动和隐私要求保留；实施前由法务确认期限
- **向外连接：** `merged_into_person_id` → `hr_person.person_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `app_user.person_id`；`hr_application.person_id`；`hr_employment.person_id`；`hr_employment_mapping_review.candidate_person_id`；`hr_person.merged_into_person_id`；`hr_person_contact.person_id`；`msg_conversation.person_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** dedupe_fingerprint [NULLS DISTINCT：仅非空值去重，允许多条空值]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `person_id` | 人员ID | `uuid` | 非空; 默认 gen_random_uuid() | 自然人的稳定身份；一人多次应聘或入职仍使用同一 ID。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `974372c0-eeaf-573e-b810-7959c45598c9` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `display_name` | 显示姓名 | `text` | 非空; 默认 — | 日常业务界面使用的姓名。 | 只用于展示，不用于去重或跨表连接。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `personal` | `A. Rahman` | hr_person.display_name 只表示本字段说明中的 显示姓名；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `legal_name` | 法定姓名 | `text` | 可空; 默认 — | 合同或合规文件使用的姓名。 | 仅授权 HR/财务读取；不在普通分析中暴露。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `restricted` | `Abdul Rahman bin ...` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `preferred_name` | 常用名 | `text` | 可空; 默认 — | 本人希望在排班和内部沟通显示的名字。 | 减少对法定姓名的不必要暴露。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `personal` | `Rahman` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `dedupe_fingerprint` | 去重指纹 | `char(64)` | 可空; 默认 — | 由受控身份要素生成的不可逆去重哈希。 | 发现重复人员，不直接暴露证件或电话。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `restricted` | `19bc...64位十六进制` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `status` | 人员状态 | `text` | 非空; 默认 'ACTIVE' | ACTIVE、MERGED、DECEASED 或 RESTRICTED。 | 控制身份是否可继续使用；雇佣状态另存。 | CHECK status IN ('ACTIVE','MERGED','DECEASED','RESTRICTED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | hr_person.status 只表示本字段说明中的 人员状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `merged_into_person_id` | 合并目标人员ID | `uuid` | 可空; 默认 — | 重复身份合并后指向保留的 person_id。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_person.person_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `95a3d177-8d96-50ab-8ec3-235f78f0062a` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 10 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_person_contact` — 人员联系方式

- **用途：** 把电话和邮箱等联系方式从一般人员主档隔离，便于最小权限和历史管理。
- **一行代表：** 人员 × 联系方式类型 × 有效期一行
- **写入责任：** HR 主数据流程
- **读取项目：** 授权 HR、消息服务
- **数据来源：** 候选人或员工提供的信息
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 把电话和邮箱等联系方式从一般人员主档隔离，便于最小权限和历史管理。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 按招聘和雇佣隐私政策保留；到期删除密文但可保留去标识审计
- **向外连接：** `person_id` → `hr_person.person_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** person_id + contact_type + lookup_hash + valid_from
- **不可重叠约束：** NO_OVERLAP(person_id, contact_type, lookup_hash, tstzrange(valid_from, valid_to, '[)'))；NO_OVERLAP(person_id, contact_type, tstzrange(valid_from, valid_to, '[)')) WHERE is_primary = true
- **表级检查：** valid_to IS NULL OR valid_to > valid_from

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `person_contact_id` | 联系方式ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条联系方式稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `d1178f19-28d7-59c3-b27f-f0af5c0b46eb` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `person_id` | 人员ID | `uuid` | 非空; 默认 — | 联系方式所属自然人。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_person.person_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `974372c0-eeaf-573e-b810-7959c45598c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `contact_type` | 联系方式类型 | `text` | 非空; 默认 — | PHONE、EMAIL 或 OTHER。 | 决定加密、校验和使用方式。 | CHECK contact_type IN ('PHONE','EMAIL','OTHER') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `PHONE` | hr_person_contact.contact_type 只表示本字段说明中的 联系方式类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `contact_ciphertext` | 加密联系方式 | `bytea` | 非空; 默认 — | 由应用层加密后的电话或邮箱。 | 授权流程可解密联系；数据库不保存可直接使用的明文。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `secret` | `<encrypted bytes>` | hr_person_contact.contact_ciphertext 只表示本字段说明中的 加密联系方式；必须在所属对象粒度内按 bytea 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `lookup_hash` | 检索哈希 | `char(64)` | 非空; 默认 — | 标准化联系方式的带密钥哈希。 | 在不解密的情况下去重和精确查找。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `restricted` | `4a0d...64位十六进制` | hr_person_contact.lookup_hash 只表示本字段说明中的 检索哈希；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `is_primary` | 是否主要联系方式 | `boolean` | 非空; 默认 false | 是否为当前首选联系方式。 | 消息和招聘默认选择。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `true` | hr_person_contact.is_primary 只表示本字段说明中的 是否主要联系方式；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `verified_at` | 验证时间 | `timestamptz` | 可空; 默认 — | 通过验证码或人工核验的时间。 | 区分已验证和自报信息。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `valid_from` | 生效时间 | `timestamptz` | 非空; 默认 now() | 联系方式开始有效时间。 | 保留换号历史。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-01-01T00:00:00+08:00` | hr_person_contact.valid_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `valid_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 联系方式停止使用时间。 | 避免向旧号码发送消息。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 12 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_employment` — 雇佣关系

- **用途：** 把自然人与一次具体雇佣关系分开，支持离职后再次入职和跨地点调动。
- **一行代表：** 一个人从一次入职到一次离职的雇佣关系一行
- **写入责任：** HR 主数据流程
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** Offer 接受、员工导入或再入职
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 把自然人与一次具体雇佣关系分开，支持离职后再次入职和跨地点调动。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 按劳动法规保留；离职不删除
- **向外连接：** `person_id` → `hr_person.person_id`；`origin_application_id` → `hr_application.application_id`；`home_location_id` → `ops_location.location_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `hr_assessment.assessor_employment_id`；`hr_employee_event.employment_id`；`hr_employment_mapping_review.candidate_employment_id`；`hr_employment_source_identity.employment_id`；`hr_onboarding_task.employment_id`；`hr_timesheet_entry.employment_id`；`hr_training_assignment.employment_id`；`ops_review_action.owner_employment_id`；`ops_shift_assignment.employment_id`；`scm_goods_receipt.received_by_employment_id`
- **分析视图：** `v_hr_role_eligibility`
- **唯一约束：** employee_code；origin_application_id [NULLS DISTINCT：仅非空值去重，允许多条空值]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** ended_on IS NULL OR ended_on >= started_on

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `employment_id` | 雇佣ID | `uuid` | 非空; 默认 gen_random_uuid() | 连接培训、班表、工时、员工事件和人工成本的稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7618a174-ddfa-5d06-8ce4-a8bfa1686a95` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `person_id` | 人员ID | `uuid` | 非空; 默认 — | 这段雇佣关系对应的自然人。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_person.person_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `974372c0-eeaf-573e-b810-7959c45598c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `origin_application_id` | 来源申请ID | `uuid` | 可空; 默认 — | 该雇佣由某次候选申请转化时连接申请；导入、再入职或无招聘流程时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_application.application_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `53a3c0d8-5d5b-536b-a7d1-f10f95634f89` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `home_location_id` | 主要地点ID | `uuid` | 可空; 默认 — | 当前合同或组织归属的主要地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `94ab4141-ba02-57af-a574-a8e82c4e01e4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `employee_code` | 员工编号 | `text` | 非空; 默认 — | 企业内部员工编号。 | 供人事沟通和导入；跨表仍使用 employment_id。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `HC-MY-0129` | hr_employment.employee_code 只表示本字段说明中的 员工编号；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `employment_type` | 用工类型 | `text` | 非空; 默认 — | FULL_TIME、PART_TIME、CONTRACTOR、INTERN 或 CASUAL。 | 影响排班、成本和合规规则。 | CHECK employment_type IN ('FULL_TIME','PART_TIME','CONTRACTOR','INTERN','CASUAL') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `FULL_TIME` | hr_employment.employment_type 只表示本字段说明中的 用工类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `started_on` | 入职日期 | `date` | 非空; 默认 — | 本段雇佣关系开始日期。 | 限定班表和培训有效范围。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-06-18` | hr_employment.started_on 只表示本字段说明中的 入职日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `ended_on` | 离职日期 | `date` | 可空; 默认 — | 本段雇佣关系结束日期；在职为空。 | 阻止离职后排班，同时保留历史。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2027-03-31` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `status` | 雇佣状态 | `text` | 非空; 默认 — | PLANNED、ACTIVE、SUSPENDED、ENDED 或 CANCELLED。 | 各下游判断是否允许排班和计薪。 | CHECK status IN ('PLANNED','ACTIVE','SUSPENDED','ENDED','CANCELLED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | hr_employment.status 只表示本字段说明中的 雇佣状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `job_title` | 职位名称 | `text` | 可空; 默认 — | 合同或组织中的职位名称。 | 用于展示；实际班次岗位由 ops_role 单独记录。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `Kitchen Crew` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_employment_source_identity` — 雇佣来源身份映射

- **用途：** 把 Lark、工资表和历史员工表中的员工编号映射到 employment_id。
- **一行代表：** 来源系统 × 外部员工ID × 有效期一行
- **写入责任：** HR 身份审核
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** Lark、工资表或历史导入
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 把 Lark、工资表和历史员工表中的员工编号映射到 employment_id。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `employment_id` → `hr_employment.employment_id`；`source_system_id` → `app_source_system.source_system_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `hr_employment_mapping_review.confirmed_source_identity_id`
- **分析视图：** `v_identity_mapping_gap`
- **唯一约束：** source_system_id + source_employee_id + valid_from
- **不可重叠约束：** NO_OVERLAP(source_system_id, source_employee_id, tstzrange(valid_from, valid_to, '[)')) WHERE mapping_status = 'CONFIRMED'
- **表级检查：** valid_to IS NULL OR valid_to > valid_from

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `employment_source_identity_id` | 映射ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条员工来源映射稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `5c8b65b5-3575-539d-a83b-71231e591b63` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `employment_id` | 雇佣ID | `uuid` | 非空; 默认 — | 映射后的统一雇佣关系。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_employment.employment_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `7618a174-ddfa-5d06-8ce4-a8bfa1686a95` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 提供外部员工编号的来源系统。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_employee_id` | 外部员工ID | `text` | 非空; 默认 — | 来源系统的原始员工标识。 | 与来源系统共同唯一，绝不按姓名猜连接。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `ou_9f3...` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `valid_from` | 生效时间 | `timestamptz` | 非空; 默认 now() | 映射开始有效时间。 | 处理账号更换或重新入职。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-06-18T00:00:00+08:00` | hr_employment_source_identity.valid_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `valid_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 映射停止有效时间。 | 保留历史关联。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2027-03-31T23:59:59+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `mapping_status` | 映射状态 | `text` | 非空; 默认 'PENDING' | CONFIRMED、PENDING 或 REJECTED。 | 未确认身份不得进入正式工时和人工成本分析。 | CHECK mapping_status IN ('CONFIRMED','PENDING','REJECTED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `CONFIRMED` | hr_employment_source_identity.mapping_status 只表示本字段说明中的 映射状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `evidence` | 映射证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 员工编号、入职日期等脱敏核对证据。 | 让身份审核可复现。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `restricted` | `{"employee_code":"HC-MY-0129"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 9 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 11 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_employment_mapping_review` — 雇佣身份映射审核

- **用途：** 保存 Lark、工资表和历史员工来源无法自动确认到 employment_id 时的候选、证据和人工结论。
- **一行代表：** 来源系统 × 外部员工ID × 一次审核尝试一行
- **写入责任：** HR 身份审核
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 员工来源同步产生的未确认或冲突身份
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存 Lark、工资表和历史员工来源无法自动确认到 employment_id 时的候选、证据和人工结论。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 按雇佣身份和审计政策保留；敏感证据最小化
- **向外连接：** `source_system_id` → `app_source_system.source_system_id`；`candidate_person_id` → `hr_person.person_id`；`candidate_employment_id` → `hr_employment.employment_id`；`confirmed_source_identity_id` → `hr_employment_source_identity.employment_source_identity_id`；`reviewed_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_identity_mapping_gap`
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** status <> 'CONFIRMED' OR confirmed_source_identity_id IS NOT NULL
- **特别说明：** 姓名、手机号或相似字符串只能产生候选，不能直接创建 CONFIRMED 映射。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `employment_mapping_review_id` | 映射审核ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次雇佣身份审核的稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `8d5ec3b4-a32a-5783-b887-3813980d5519` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 提供外部员工身份的来源系统。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 3 | `source_employee_id` | 外部员工ID | `text` | 非空; 默认 — | 来源中的原始员工标识。 | 与来源系统共同定位待审核身份；不得用姓名替代。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `ou_9f3...` | 这是来源系统证据，不等于企业统一身份。 |
| 4 | `candidate_person_id` | 候选人员ID | `uuid` | 可空; 默认 — | 算法或人工认为可能匹配的自然人；没有候选时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_person.person_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `b92ebc37-09cd-5fb7-a067-9f6217dabc51` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `candidate_employment_id` | 候选雇佣ID | `uuid` | 可空; 默认 — | 算法或人工认为可能匹配的具体雇佣关系；没有候选时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_employment.employment_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7d739b9c-6bac-5ede-ae3b-4eebbd8ebda9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `match_method` | 候选方法 | `text` | 非空; 默认 — | EXACT_EMPLOYEE_CODE、SOURCE_LINK、MULTI_ATTRIBUTE 或 NO_CANDIDATE。 | 区分强标识匹配和仅供人工参考的多属性候选。 | CHECK match_method IN ('EXACT_EMPLOYEE_CODE','SOURCE_LINK','MULTI_ATTRIBUTE','NO_CANDIDATE') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `EXACT_EMPLOYEE_CODE` | hr_employment_mapping_review.match_method 只表示本字段说明中的 候选方法；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `evidence` | 审核证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 员工编号、入职日、地点等最小化且脱敏的匹配证据。 | 让确认或拒绝可以复核；不得保存不必要的身份证件原文。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `restricted` | `{"employee_code":"HC-MY-0129","started_on":"2026-06-18"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 8 | `status` | 审核状态 | `text` | 非空; 默认 'OPEN' | OPEN、CONFIRMED、REJECTED、SPLIT_REQUIRED 或 DISMISSED。 | 只有 CONFIRMED 才允许建立正式来源映射。 | CHECK status IN ('OPEN','CONFIRMED','REJECTED','SPLIT_REQUIRED','DISMISSED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `CONFIRMED` | hr_employment_mapping_review.status 只表示本字段说明中的 审核状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `confirmed_source_identity_id` | 确认映射ID | `uuid` | 可空; 默认 — | 审核确认后建立的正式雇佣来源映射；未确认时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_employment_source_identity.employment_source_identity_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `d2e456c2-47e2-5c24-adf5-35ccb401fcca` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `resolution_note` | 处理说明 | `text` | 可空; 默认 — | 确认、拒绝或拆分身份的业务理由。 | 保存必要的决策解释。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `员工编号与入职日期一致，已确认` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `reviewed_by_user_id` | 审核账号 | `uuid` | 可空; 默认 — | 作出当前审核结论的应用账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `9f809e56-58de-53ea-9cc4-5a7f5116feb5` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `reviewed_at` | 审核时间 | `timestamptz` | 可空; 默认 — | 进入终态的时间；未处理时为空。 | 计算映射积压时长和审计结论。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-10T09:20:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 15 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_job_requisition` — 招聘需求

- **用途：** 记录某地点、岗位所需人数、期限和批准状态，作为候选申请的业务来源。
- **一行代表：** 一个招聘需求一行
- **写入责任：** HR 招聘流程
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 业务部门提交并审批
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_WORKFLOW` — 只允许批准的状态机迁移并记录操作者和时间
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_WORKFLOW_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 记录某地点、岗位所需人数、期限和批准状态，作为候选申请的业务来源。；人工决定、批准、状态转换或业务副作用本身就是事实，不能从最终结果倒推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `location_id` → `ops_location.location_id`；`role_id` → `ops_role.role_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `hr_application.job_requisition_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** requisition_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 本表是招聘需求生命周期而不是版本表；重大人数或岗位变更应关闭旧需求并新建 requisition_code，普通状态推进进入审计。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `job_requisition_id` | 招聘需求ID | `uuid` | 非空; 默认 gen_random_uuid() | 招聘需求稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `0e962f96-91b7-5d2b-8916-d807ad5cc023` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 需求所属地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `role_id` | 岗位ID | `uuid` | 可空; 默认 — | 计划招聘的标准岗位。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_role.role_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `a28ce29f-93bc-5620-a42b-c652824558c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `requisition_code` | 需求代码 | `text` | 非空; 默认 — | 业务可读唯一需求编号。 | 连接外部招聘平台和申请。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `REQ-PAV-KITCHEN-202608` | hr_job_requisition.requisition_code 只表示本字段说明中的 需求代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `headcount_requested` | 需求人数 | `integer` | 非空; 默认 — | 批准前提出的招聘人数。 | 衡量缺口。 | CHECK headcount_requested > 0 | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `3` | hr_job_requisition.headcount_requested 只表示本字段说明中的 需求人数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `employment_type` | 用工类型 | `text` | 非空; 默认 — | FULL_TIME、PART_TIME、CONTRACTOR、INTERN 或 CASUAL。 | 筛选候选和 Offer。 | CHECK employment_type IN ('FULL_TIME','PART_TIME','CONTRACTOR','INTERN','CASUAL') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `FULL_TIME` | hr_job_requisition.employment_type 只表示本字段说明中的 用工类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `target_start_date` | 目标到岗日 | `date` | 可空; 默认 — | 希望新员工开始工作的日期。 | 招聘优先级和进度。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-09-01` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `status` | 需求状态 | `text` | 非空; 默认 — | DRAFT、APPROVED、OPEN、ON_HOLD、FILLED 或 CANCELLED。 | 只有 OPEN 可接受新申请。 | CHECK status IN ('DRAFT','APPROVED','OPEN','ON_HOLD','FILLED','CANCELLED') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `OPEN` | hr_job_requisition.status 只表示本字段说明中的 需求状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 招聘需求获批时间。 | 区分业务意向和正式需求。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准需求的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_application` — 候选申请

- **用途：** 记录自然人对一个招聘需求的一次申请身份和来源；阶段变化只追加到 hr_application_stage_event。
- **一行代表：** 人员 × 招聘需求 × 一次申请一行
- **写入责任：** HR 招聘流程
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** JobStreet、WhatsApp、人工录入或其他渠道
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 记录自然人对一个招聘需求的一次申请身份和来源；阶段变化只追加到 hr_application_stage_event。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `person_id` → `hr_person.person_id`；`job_requisition_id` → `hr_job_requisition.job_requisition_id`；`source_system_id` → `app_source_system.source_system_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `app_one_time_token.application_id`；`hr_application_stage_event.application_id`；`hr_appointment.application_id`；`hr_assessment.application_id`；`hr_employment.origin_application_id`；`hr_offer.application_id`；`msg_conversation.application_id`
- **分析视图：** `v_hr_application_current_stage`
- **唯一约束：** source_system_id + source_application_id [NULLS DISTINCT：仅非空值去重，允许多条空值]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 当前招聘阶段由 v_hr_application_current_stage 确定性派生；录用关系由 hr_employment.origin_application_id 单向连接，避免双向冗余外键。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `application_id` | 申请ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次候选申请稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `3564ea14-b3b1-590c-b1a9-1e4b50e3e6c1` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `person_id` | 人员ID | `uuid` | 非空; 默认 — | 申请人自然人身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_person.person_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `974372c0-eeaf-573e-b810-7959c45598c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `job_requisition_id` | 招聘需求ID | `uuid` | 非空; 默认 — | 申请对应正式需求。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_job_requisition.job_requisition_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `0e962f96-91b7-5d2b-8916-d807ad5cc023` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 提供申请的招聘渠道。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 5 | `source_application_id` | 外部申请ID | `text` | 可空; 默认 — | 招聘平台或来源中的稳定申请编号。 | 实现同步幂等。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `js_998120` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `applied_at` | 申请时间 | `timestamptz` | 非空; 默认 — | 候选人提交或被录入的时间。 | 招聘漏斗计时起点。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-08T15:00:00+08:00` | hr_application.applied_at 只表示本字段说明中的 申请时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 9 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_application_stage_event` — 候选申请阶段事件

- **用途：** 只追加保存候选申请每次进入新阶段的时间、原因、来源和操作者，使漏斗和停留时长可以重建。
- **一行代表：** 候选申请 × 一次阶段迁移一行
- **写入责任：** HR 招聘流程或渠道同步
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** HR操作、候选人动作或招聘渠道回执
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY_DECISION_RECORD` — 人工/系统决策只追加，原决定和差异永久可追溯
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_WORKFLOW_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 只追加保存候选申请每次进入新阶段的时间、原因、来源和操作者，使漏斗和停留时长可以重建。；人工决定、批准、状态转换或业务副作用本身就是事实，不能从最终结果倒推。
- **保留策略：** 按招聘隐私政策保留；分析可去标识，原始阶段事件不可覆盖
- **向外连接：** `application_id` → `hr_application.application_id`；`source_system_id` → `app_source_system.source_system_id`；`job_run_id` → `app_job_run.job_run_id`；`actor_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_hr_application_current_stage`
- **唯一约束：** event_key
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** from_stage IS NULL OR from_stage <> to_stage；num_nonnulls(source_system_id, job_run_id, actor_user_id) >= 1
- **特别说明：** from_stage 保存写入当刻声明的前置状态，用来检测并发或非法迁移；它不是当前阶段副本。v_hr_application_current_stage 从 to_stage 事件序列派生当前阶段，并核对相邻事件的 from_stage。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `application_stage_event_id` | 阶段事件ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次阶段迁移稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `ed31c750-d21c-5ea7-b042-857424297947` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `application_id` | 申请ID | `uuid` | 非空; 默认 — | 阶段变化所属候选申请。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_application.application_id | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `3564ea14-b3b1-590c-b1a9-1e4b50e3e6c1` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 可空; 默认 — | 阶段回执来自外部招聘平台时记录；内部人工动作可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `job_run_id` | 任务运行ID | `uuid` | 可空; 默认 — | 自动同步或规则推进阶段时连接具体任务运行。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `actor_user_id` | 操作账号ID | `uuid` | 可空; 默认 — | 人工确认阶段变化的应用账号；外部自动回执可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `e34d8b81-3f73-52c5-bfa0-158ba9c35656` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `event_key` | 阶段事件幂等键 | `text` | 非空; 默认 — | 写入方为本次业务迁移生成的全局唯一稳定键。 | 重试不重复制造阶段事件。 | UNIQUE | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `application:...:stage:INTERVIEW:20260810T090000Z` | hr_application_stage_event.event_key 只表示本字段说明中的 阶段事件幂等键；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `from_stage` | 原阶段 | `text` | 可空; 默认 — | 迁移前阶段；申请建立时的首个 NEW 事件可为空。 | 验证状态机顺序。 | — | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `CONTACTING` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `to_stage` | 新阶段 | `text` | 非空; 默认 — | NEW、CONTACTING、INTERVIEW、TRIAL、OFFER、HIRED、REJECTED、WITHDRAWN 或 TALENT_POOL。 | 形成唯一可重建的招聘漏斗事实。 | CHECK to_stage IN ('NEW','CONTACTING','INTERVIEW','TRIAL','OFFER','HIRED','REJECTED','WITHDRAWN','TALENT_POOL') | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `INTERVIEW` | hr_application_stage_event.to_stage 只表示本字段说明中的 新阶段；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `reason_code` | 阶段原因 | `text` | 可空; 默认 — | 拒绝、退出、停滞或人工推进的标准原因代码。 | 分析流程问题而不依赖自由文本。 | — | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `NO_RESPONSE` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `occurred_at` | 阶段发生时间 | `timestamptz` | 非空; 默认 — | 候选申请实际进入新阶段的时间。 | 计算各阶段停留时长。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `2026-08-10T09:00:00+08:00` | hr_application_stage_event.occurred_at 只表示本字段说明中的 阶段发生时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `evidence` | 阶段证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 不含非必要敏感信息的渠道回执、预约或审批引用。 | 支持复核而不把自由文本当连接键。 | — | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `internal` | `{"appointment_id":"..."}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_appointment` — 面试试工预约

- **用途：** 记录候选人面试、试工或文件办理的一次预约及其实际执行结果；试工不再另建一对一结果表。
- **一行代表：** 申请 × 一次预约一行
- **写入责任：** HR 招聘流程
- **读取项目：** BakeryOps
- **数据来源：** HR与候选人确认
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** R6_MERGE_INTO: absorb hr_trial execution timestamps, outcome and safety incident
- **为何存表而不是现算视图：** 记录候选人面试、试工或文件办理的一次预约及其实际执行结果；试工不再另建一对一结果表。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `application_id` → `hr_application.application_id`；`location_id` → `ops_location.location_id`；`confirmed_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `hr_assessment.appointment_id`；`msg_outbound_message.appointment_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** scheduled_end IS NULL OR scheduled_end > scheduled_start；actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start；trial_outcome IS NULL OR appointment_type = 'TRIAL'
- **特别说明：** 预约与实际执行是同一一对一生命周期；评估仍通过 hr_assessment.appointment_id 一对多连接。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `appointment_id` | 预约ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次预约稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `c38e70d2-c9d5-52b4-9121-b6507f575772` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `application_id` | 申请ID | `uuid` | 非空; 默认 — | 预约所属申请。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_application.application_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `3564ea14-b3b1-590c-b1a9-1e4b50e3e6c1` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 可空; 默认 — | 预约发生地点；线上预约可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `appointment_type` | 预约类型 | `text` | 非空; 默认 — | INTERVIEW、TRIAL、DOCUMENT 或 OTHER。 | 决定后续表和提醒。 | CHECK appointment_type IN ('INTERVIEW','TRIAL','DOCUMENT','OTHER') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `TRIAL` | hr_appointment.appointment_type 只表示本字段说明中的 预约类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `scheduled_start` | 计划开始 | `timestamptz` | 非空; 默认 — | 预约开始时间。 | 提醒和准时率。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-12T10:00:00+08:00` | hr_appointment.scheduled_start 只表示本字段说明中的 计划开始；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `scheduled_end` | 计划结束 | `timestamptz` | 可空; 默认 — | 预约结束时间。 | 资源安排。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-12T14:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `status` | 预约状态 | `text` | 非空; 默认 — | PROPOSED、CONFIRMED、COMPLETED、NO_SHOW、STOPPED、CANCELLED 或 RESCHEDULED。 | 招聘漏斗和到场率。 | CHECK status IN ('PROPOSED','CONFIRMED','COMPLETED','NO_SHOW','STOPPED','CANCELLED','RESCHEDULED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `CONFIRMED` | hr_appointment.status 只表示本字段说明中的 预约状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `confirmed_at` | 确认时间 | `timestamptz` | 可空; 默认 — | 候选人或HR确认时间。 | 区分已安排与已确认。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-10T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `confirmed_by_user_id` | 确认账号 | `uuid` | 可空; 默认 — | 内部确认该预约的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `5f404280-ef9e-5df5-8e23-3f38a16d06d9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `actual_start` | 实际开始 | `timestamptz` | 可空; 默认 — | 候选人实际到场开始时间；尚未开始为空。 | 计算准时率和实际时长。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-12T10:05:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `actual_end` | 实际结束 | `timestamptz` | 可空; 默认 — | 预约或试工实际结束时间。 | 计算执行时长。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-12T14:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `trial_outcome` | 试工结论 | `text` | 可空; 默认 — | 仅 TRIAL 类型使用：PASS、CONDITIONAL_PASS、FAIL 或 INCOMPLETE。 | 保留试工最终结果；结构化评分仍写 hr_assessment。 | CHECK trial_outcome IS NULL OR trial_outcome IN ('PASS','CONDITIONAL_PASS','FAIL','INCOMPLETE') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `PASS` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `safety_incident` | 是否安全事件 | `boolean` | 非空; 默认 false | TRIAL 类型期间是否发生安全或重大红线。 | 触发人工升级；非试工默认为 false。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `false` | hr_appointment.safety_incident 只表示本字段说明中的 是否安全事件；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 14 | `execution_note` | 执行说明 | `text` | 可空; 默认 — | 实际到场、异常或试工结论的必要补充。 | 保留执行证据，不重复结构化评分。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `personal` | `按SOP完成全部工序` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 17 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_assessment` — 候选人评估

- **用途：** 保存一次结构化评估的建议、红线结论、评估者和模板版本；总分由明细视图派生。
- **一行代表：** 申请 × 评估类型 × 一次评估一行
- **写入责任：** HR或业务面试官
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 面试、试工或审核
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `PARTIAL_FIELDS_DERIVED_IN_VIEW`
- **可派生字段/输出：** total_score -> v_hr_assessment_summary
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存一次结构化评估的建议、红线结论、评估者和模板版本；总分由明细视图派生。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `application_id` → `hr_application.application_id`；`appointment_id` → `hr_appointment.appointment_id`；`assessor_employment_id` → `hr_employment.employment_id`
- **被谁连接：** `hr_assessment_score.assessment_id`
- **分析视图：** `v_hr_assessment_summary`
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `assessment_id` | 评估ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次候选评估稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e547df2a-fce1-5e8b-9134-e56fedfbdaea` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `application_id` | 申请ID | `uuid` | 非空; 默认 — | 被评估候选申请。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_application.application_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `3564ea14-b3b1-590c-b1a9-1e4b50e3e6c1` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `appointment_id` | 预约ID | `uuid` | 可空; 默认 — | 对应面试/试工预约；无预约评估可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_appointment.appointment_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `c38e70d2-c9d5-52b4-9121-b6507f575772` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `assessor_employment_id` | 评估人雇佣ID | `uuid` | 非空; 默认 — | 执行评估的员工。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_employment.employment_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `b4a58207-e592-5092-a9b9-ef790441702c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `assessment_type` | 评估类型 | `text` | 非空; 默认 — | SCREENING、INTERVIEW、TRIAL、KPA 或 OTHER。 | 选择评分模板和口径。 | CHECK assessment_type IN ('SCREENING','INTERVIEW','TRIAL','KPA','OTHER') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `TRIAL` | hr_assessment.assessment_type 只表示本字段说明中的 评估类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `template_version` | 评分模板版本 | `text` | 非空; 默认 — | 本次使用的评分项模板版本。 | 历史分数可解释。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `trial-kitchen-v3` | hr_assessment.template_version 只表示本字段说明中的 评分模板版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `recommendation` | 评估建议 | `text` | 非空; 默认 — | STRONG_HIRE、HIRE、HOLD、NO_HIRE 或 INCOMPLETE。 | 形成标准化建议。 | CHECK recommendation IN ('STRONG_HIRE','HIRE','HOLD','NO_HIRE','INCOMPLETE') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `HIRE` | hr_assessment.recommendation 只表示本字段说明中的 评估建议；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `red_flag` | 是否触发红线 | `boolean` | 非空; 默认 false | 是否存在必须人工处理的红线项。 | 红线应阻断自动推进。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `false` | hr_assessment.red_flag 只表示本字段说明中的 是否触发红线；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `summary` | 评估总结 | `text` | 可空; 默认 — | 评估者的必要总结。 | 解释分数和建议。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `personal` | `操作规范，速度需提升` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `assessed_at` | 评估时间 | `timestamptz` | 非空; 默认 — | 评估完成时间。 | 招聘流程时长。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-12T14:00:00+08:00` | hr_assessment.assessed_at 只表示本字段说明中的 评估时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_assessment_score` — 评估项目得分

- **用途：** 逐项保存评分、权重、红线和证据，避免只有总分无法解释。
- **一行代表：** 评估 × 评分项目一行
- **写入责任：** HR或业务面试官
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 评估模板和评估者输入
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 逐项保存评分、权重、红线和证据，避免只有总分无法解释。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `assessment_id` → `hr_assessment.assessment_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_hr_assessment_summary`
- **唯一约束：** assessment_id + criterion_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** score IS NULL OR (score >= 0 AND score <= max_score)

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `assessment_score_id` | 评分行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条评分项目稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `99fae554-0ba5-5d16-ae35-5c6f60730f52` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `assessment_id` | 评估ID | `uuid` | 非空; 默认 — | 所属候选评估。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_assessment.assessment_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e547df2a-fce1-5e8b-9134-e56fedfbdaea` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `criterion_code` | 评分项代码 | `text` | 非空; 默认 — | 模板内稳定评分项代码。 | 跨评估比较同一能力。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `FOOD_SAFETY` | hr_assessment_score.criterion_code 只表示本字段说明中的 评分项代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `criterion_name` | 评分项名称 | `text` | 非空; 默认 — | 评估时的评分项名称快照。 | 模板改名后保留历史含义。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `食品安全意识` | hr_assessment_score.criterion_name 只表示本字段说明中的 评分项名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `score` | 得分 | `numeric(9,4)` | 可空; 默认 — | 该评分项实际得分。 | 形成总分和能力画像。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `8` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `max_score` | 满分 | `numeric(9,4)` | 非空; 默认 — | 该项可得最高分。 | 跨模板归一化。 | CHECK max_score > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `10` | hr_assessment_score.max_score 只表示本字段说明中的 满分；必须在所属对象粒度内按 numeric(9,4) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `weight` | 权重 | `numeric(9,6)` | 非空; 默认 1 | 该项进入总分的权重。 | 复现总分计算。 | CHECK weight >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1.5` | hr_assessment_score.weight 只表示本字段说明中的 权重；必须在所属对象粒度内按 numeric(9,6) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `is_red_flag` | 是否红线项 | `boolean` | 非空; 默认 false | 该项是否触发红线。 | 即使总分高也可阻断。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `false` | hr_assessment_score.is_red_flag 只表示本字段说明中的 是否红线项；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `evidence_note` | 评分证据 | `text` | 可空; 默认 — | 支持该分数的具体观察。 | 提高评分可审计性。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `personal` | `洗手流程完整` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_offer` — Offer版本

- **用途：** 版本化保存候选人的岗位、地点、薪酬摘要、有效期和接受状态。
- **一行代表：** 申请 × Offer版本一行
- **写入责任：** HR 招聘流程
- **读取项目：** BakeryOps、授权财务
- **数据来源：** 招聘审批
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_WORKFLOW_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 版本化保存候选人的岗位、地点、薪酬摘要、有效期和接受状态。；人工决定、批准、状态转换或业务副作用本身就是事实，不能从最终结果倒推。
- **保留策略：** 按劳动与招聘隐私政策保留
- **向外连接：** `application_id` → `hr_application.application_id`；`supersedes_offer_id` → `hr_offer.offer_id`；`location_id` → `ops_location.location_id`；`role_id` → `ops_role.role_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `hr_offer.supersedes_offer_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** application_id + version_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** DRAFT 只能通过受控函数按 compensation_schema_version 校验 compensation_summary，拒绝未知键和无币种金额；SENT 后岗位、地点、薪酬、版本号和到期时间冻结，只允许受控写入终态回应；条款变化必须新建 Offer 版本。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `offer_id` | Offer ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版 Offer 稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `37bc577f-fb47-5549-9e76-40a14a0c960c` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `application_id` | 申请ID | `uuid` | 非空; 默认 — | Offer 对应候选申请。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_application.application_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `3564ea14-b3b1-590c-b1a9-1e4b50e3e6c1` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `supersedes_offer_id` | 被替代Offer ID | `uuid` | 可空; 默认 — | 本版替代的上一版 Offer。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_offer.offer_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `8ee69132-a99b-5b5a-bdac-7f3951dcf093` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | Offer 主要工作地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `role_id` | 岗位ID | `uuid` | 可空; 默认 — | Offer 标准岗位。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_role.role_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `a28ce29f-93bc-5620-a42b-c652824558c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `version_no` | 版本号 | `integer` | 非空; 默认 — | 申请内 Offer 递增版本。 | 不覆盖谈判历史。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2` | hr_offer.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `employment_type` | 用工类型 | `text` | 非空; 默认 — | 拟议用工类型。 | 创建 employment 时继承。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `FULL_TIME` | hr_offer.employment_type 只表示本字段说明中的 用工类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `proposed_start_date` | 拟入职日 | `date` | 非空; 默认 — | Offer 中拟定的开始日期。 | 入职计划。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-09-01` | hr_offer.proposed_start_date 只表示本字段说明中的 拟入职日；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `compensation_schema_version` | 薪酬结构版本 | `text` | 非空; 默认 'offer-compensation-v1' | compensation_summary 对应的固定 JSON Schema 版本。 | 冻结币种、薪酬项目、周期和金额类型，避免合同与预算解释漂移。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `offer-compensation-v1` | hr_offer.compensation_schema_version 只表示本字段说明中的 薪酬结构版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `compensation_summary` | 薪酬摘要 | `jsonb` | 非空; 默认 — | 按 compensation_schema_version 校验的结构化薪酬项目和币种；未知键拒绝且仅授权人员可见。 | 支持合同和预算，但不把自由文本薪酬散落。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `restricted` | `{"currency":"MYR","monthly_base":2500}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 11 | `expires_at` | Offer到期时间 | `timestamptz` | 可空; 默认 — | 候选人最迟接受时间。 | 自动判断失效。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-20T23:59:59+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `status` | Offer状态 | `text` | 非空; 默认 — | DRAFT、SENT、ACCEPTED、DECLINED、EXPIRED、WITHDRAWN 或 SUPERSEDED。 | 招聘漏斗和入职门禁。 | CHECK status IN ('DRAFT','SENT','ACCEPTED','DECLINED','EXPIRED','WITHDRAWN','SUPERSEDED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `SENT` | hr_offer.status 只表示本字段说明中的 Offer状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `responded_at` | 候选回应时间 | `timestamptz` | 可空; 默认 — | 接受或拒绝时间。 | 招聘时长。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-15T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 16 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_onboarding_task` — 入职任务

- **用途：** 逐项跟踪合同、证件、系统账号、培训和门店准备等入职事项。
- **一行代表：** 雇佣关系 × 入职任务代码一行
- **写入责任：** HR 入职流程
- **读取项目：** BakeryOps
- **数据来源：** Offer接受后按模板生成
- **实施层级：** `EXTENSION_PACK:TRAINING_AND_ONBOARDING`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 逐项跟踪合同、证件、系统账号、培训和门店准备等入职事项。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `employment_id` → `hr_employment.employment_id`；`completed_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** employment_id + task_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `onboarding_task_id` | 入职任务ID | `uuid` | 非空; 默认 gen_random_uuid() | 一项入职任务稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `fe72b67c-d0c7-5ad0-b6b5-6b80d14db996` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `employment_id` | 雇佣ID | `uuid` | 非空; 默认 — | 任务所属新雇佣关系。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_employment.employment_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7618a174-ddfa-5d06-8ce4-a8bfa1686a95` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `task_code` | 任务代码 | `text` | 非空; 默认 — | 标准化入职任务代码。 | 跨员工统计完成率。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `FOOD_HANDLER_CERT` | hr_onboarding_task.task_code 只表示本字段说明中的 任务代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `task_name` | 任务名称 | `text` | 非空; 默认 — | 任务显示名称快照。 | 便于执行。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `食品处理证书核验` | hr_onboarding_task.task_name 只表示本字段说明中的 任务名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `due_at` | 截止时间 | `timestamptz` | 可空; 默认 — | 任务应完成时间。 | 判断是否阻断上岗。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-31T18:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `is_blocking` | 是否阻断上岗 | `boolean` | 非空; 默认 false | 未完成时是否禁止正式排班。 | 形成清晰上岗门禁。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `true` | hr_onboarding_task.is_blocking 只表示本字段说明中的 是否阻断上岗；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `status` | 任务状态 | `text` | 非空; 默认 'PENDING' | PENDING、IN_PROGRESS、COMPLETED、WAIVED 或 CANCELLED。 | 跟踪入职准备。 | CHECK status IN ('PENDING','IN_PROGRESS','COMPLETED','WAIVED','CANCELLED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `COMPLETED` | hr_onboarding_task.status 只表示本字段说明中的 任务状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `completed_at` | 完成时间 | `timestamptz` | 可空; 默认 — | 任务完成或豁免时间。 | 计算及时率。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-28T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `completed_by_user_id` | 确认账号 | `uuid` | 可空; 默认 — | 确认完成或豁免的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `bf19449d-3ef7-572c-a09d-ee2e487b7f1b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `evidence` | 完成证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 文件哈希、证书编号或系统账号引用。 | 证明任务完成且限制敏感附件暴露。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `restricted` | `{"certificate_ref":"..."}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 11 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_employee_event` — 员工事件

- **用途：** 记录转正、调动、停职、奖惩、离职等不可变人事事件。
- **一行代表：** 雇佣关系 × 一次事件一行
- **写入责任：** HR 人事流程
- **读取项目：** BakeryOps、授权财务、分析/BI
- **数据来源：** HR人工确认或批准流程
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY_DECISION_RECORD` — 人工/系统决策只追加，原决定和差异永久可追溯
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_WORKFLOW_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 记录转正、调动、停职、奖惩、离职等不可变人事事件。；人工决定、批准、状态转换或业务副作用本身就是事实，不能从最终结果倒推。
- **保留策略：** 按劳动法规永久或长期保留
- **向外连接：** `employment_id` → `hr_employment.employment_id`；`from_location_id` → `ops_location.location_id`；`to_location_id` → `ops_location.location_id`；`recorded_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 已批准的人事事件不可修改；错误通过新的纠正或冲销事件表达，禁止覆盖原事件。event_data 必须按 event_type + event_schema_version 的固定 schema 经受控写函数校验，未知键拒绝。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `employee_event_id` | 员工事件ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次人事事件稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `a128230d-2c65-510c-8430-b83e919a9b12` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `employment_id` | 雇佣ID | `uuid` | 非空; 默认 — | 事件所属雇佣关系。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_employment.employment_id | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `7618a174-ddfa-5d06-8ce4-a8bfa1686a95` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `event_type` | 事件类型 | `text` | 非空; 默认 — | CONFIRMATION、TRANSFER、PROMOTION、DISCIPLINE、SUSPENSION、RESIGNATION、TERMINATION 或 OTHER。 | 统一人事历史口径。 | CHECK event_type IN ('CONFIRMATION','TRANSFER','PROMOTION','DISCIPLINE','SUSPENSION','RESIGNATION','TERMINATION','OTHER') | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `TRANSFER` | hr_employee_event.event_type 只表示本字段说明中的 事件类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `effective_date` | 生效日期 | `date` | 非空; 默认 — | 事件业务生效日期。 | 与排班、组织和成本按有效期连接。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `2026-09-01` | hr_employee_event.effective_date 只表示本字段说明中的 生效日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `from_location_id` | 原地点ID | `uuid` | 可空; 默认 — | 调动前地点；不适用为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `77f31b24-36f5-5ee1-87f7-be46d3e61aed` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `to_location_id` | 新地点ID | `uuid` | 可空; 默认 — | 调动后地点；不适用为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `65c0f94a-9db6-55cb-afad-69d11d70d100` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `event_schema_version` | 事件结构版本 | `text` | 非空; 默认 'hr-employee-event-v1' | event_data 对应的事件类型结构版本。 | 保证批准的人事事件在字段扩展后仍可验证和解释。 | — | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `hr-employee-event-v1` | hr_employee_event.event_schema_version 只表示本字段说明中的 事件结构版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `event_data` | 事件结构数据 | `jsonb` | 非空; 默认 '{}'::jsonb | 按事件类型保存批准后的非通用字段。 | 避免无意义宽表，同时要求对应 JSON Schema。 | — | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `restricted` | `{"new_title":"Shift Lead"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 9 | `reason_code` | 原因代码 | `text` | 可空; 默认 — | 离职、处分等标准原因。 | 汇总分析且减少自由文本。 | — | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `personal` | `VOLUNTARY_RESIGNATION` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `note` | 事件说明 | `text` | 可空; 默认 — | 必要的受限说明。 | 审计例外。 | — | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `restricted` | `Approved transfer` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `recorded_by_user_id` | 登记账号 | `uuid` | 非空; 默认 — | 确认并登记该不可变人事事件的应用账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `288c7d39-7db7-531f-9c6b-29b2586e9933` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY_DECISION_RECORD：人工/系统决策只追加，原决定和差异永久可追溯。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_screening_rule` — 招聘筛选规则

- **用途：** 保存经人工批准、带证据和适用范围的招聘筛选规则。
- **一行代表：** 一个规则版本一行
- **写入责任：** HR规则审核流程
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 历史员工结果分析和人工批准
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存经人工批准、带证据和适用范围的招聘筛选规则。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `role_id` → `ops_role.role_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** rule_code + version_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** DRAFT 写入函数必须按 rule_type + rule_schema_version 校验 rule_definition、拒绝未知键和受保护歧视字段；APPROVED 或 ACTIVE 后规则定义、证据与版本号冻结，新结论必须新建版本。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `screening_rule_id` | 筛选规则ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版筛选规则稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `7b9ef0bf-b840-543d-a66e-72b6d0a5f0a0` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `rule_code` | 规则代码 | `text` | 非空; 默认 — | 稳定规则标识。 | 程序执行和版本管理。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `RETENTION_AVAILABILITY` | hr_screening_rule.rule_code 只表示本字段说明中的 规则代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `version_no` | 版本号 | `integer` | 非空; 默认 — | 规则代码内递增版本。 | 历史决策可解释。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2` | hr_screening_rule.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `role_id` | 适用岗位ID | `uuid` | 可空; 默认 — | 规则只适用某岗位时记录。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_role.role_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `a28ce29f-93bc-5620-a42b-c652824558c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `rule_type` | 规则类型 | `text` | 非空; 默认 — | ELIGIBILITY、RISK_SIGNAL 或 QUESTION_PROMPT。 | 禁止把弱相关信号变成自动拒绝。 | CHECK rule_type IN ('ELIGIBILITY','RISK_SIGNAL','QUESTION_PROMPT') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `RISK_SIGNAL` | hr_screening_rule.rule_type 只表示本字段说明中的 规则类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `rule_schema_version` | 筛选规则结构版本 | `text` | 非空; 默认 'hr-screening-rule-v1' | rule_definition 对应的固定 JSON Schema 版本。 | 冻结允许的输入字段、操作符和输出结构。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `hr-screening-rule-v1` | hr_screening_rule.rule_schema_version 只表示本字段说明中的 筛选规则结构版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `rule_definition` | 规则定义 | `jsonb` | 非空; 默认 — | 按 rule_type + rule_schema_version 校验的条件和输出；未知键及受保护歧视字段拒绝。 | 可测试执行；不得包含受保护歧视条件。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"field":"availability","operator":"contains"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 8 | `evidence_summary` | 证据摘要 | `text` | 非空; 默认 — | 规则依据、样本和限制。 | 明确相关不等于因果。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `样本15，需人工复核` | hr_screening_rule.evidence_summary 只表示本字段说明中的 证据摘要；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `sample_size` | 样本量 | `integer` | 可空; 默认 — | 提炼规则使用的样本数。 | 低样本警示。 | CHECK sample_size IS NULL OR sample_size > 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `15` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `confidence` | 置信度 | `numeric(5,4)` | 可空; 默认 — | 规则证据的 0 至 1 评分。 | 只决定提示强度。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `0.7200` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `status` | 规则状态 | `text` | 非空; 默认 — | DRAFT、APPROVED、ACTIVE 或 RETIRED。 | 只有 ACTIVE 才可提示。 | CHECK status IN ('DRAFT','APPROVED','ACTIVE','RETIRED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ACTIVE` | hr_screening_rule.status 只表示本字段说明中的 规则状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 人工批准规则的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 15 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_training_course` — 培训课程

- **用途：** 维护课程稳定身份，内容和考核规则放在版本表。
- **一行代表：** 一个培训课程一行
- **写入责任：** HR培训管理
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 培训负责人配置
- **实施层级：** `EXTENSION_PACK:TRAINING_AND_ONBOARDING`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 维护课程稳定身份，内容和考核规则放在版本表。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `created_by_user_id` → `app_user.user_id`
- **被谁连接：** `hr_training_course_version.training_course_id`；`ops_role_training_requirement.training_course_id`
- **分析视图：** `v_hr_role_eligibility`
- **唯一约束：** course_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `training_course_id` | 课程ID | `uuid` | 非空; 默认 gen_random_uuid() | 培训课程稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ac8441cd-59f1-55fe-b5ec-b03825bcaac3` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `course_code` | 课程代码 | `text` | 非空; 默认 — | 企业内部唯一课程代码。 | 岗位要求和培训指派的连接键。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `FOOD_SAFETY_L1` | hr_training_course.course_code 只表示本字段说明中的 课程代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `course_name` | 课程名称 | `text` | 非空; 默认 — | 当前显示名称。 | 界面和证书展示。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `食品安全一级` | hr_training_course.course_name 只表示本字段说明中的 课程名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `course_type` | 课程类型 | `text` | 非空; 默认 — | MANDATORY、ROLE_SKILL、LEADERSHIP 或 OTHER。 | 培训计划分层。 | CHECK course_type IN ('MANDATORY','ROLE_SKILL','LEADERSHIP','OTHER') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `MANDATORY` | hr_training_course.course_type 只表示本字段说明中的 课程类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `status` | 课程状态 | `text` | 非空; 默认 'DRAFT' | DRAFT、ACTIVE 或 RETIRED。 | 停用课程不删除历史结果。 | CHECK status IN ('DRAFT','ACTIVE','RETIRED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | hr_training_course.status 只表示本字段说明中的 课程状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 8 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_training_course_version` — 培训课程版本

- **用途：** 冻结课程内容、及格线、有效期和考核规则版本。
- **一行代表：** 课程 × 版本号一行
- **写入责任：** HR培训管理
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 培训负责人发布
- **实施层级：** `EXTENSION_PACK:TRAINING_AND_ONBOARDING`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 冻结课程内容、及格线、有效期和考核规则版本。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `training_course_id` → `hr_training_course.training_course_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `hr_training_assignment.training_course_version_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** training_course_id + version_no
- **不可重叠约束：** NO_OVERLAP(training_course_id, tstzrange(effective_from, effective_to, '[)')) WHERE status = 'PUBLISHED'
- **表级检查：** effective_to IS NULL OR effective_to > effective_from
- **特别说明：** DRAFT 可编辑；PUBLISHED 后课程内容哈希、及格线、资格有效期和生效起点冻结，更新必须新建版本。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `training_course_version_id` | 课程版本ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版课程稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `d92e8765-597d-5026-bb23-fdb85c1b213b` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `training_course_id` | 课程ID | `uuid` | 非空; 默认 — | 所属稳定课程。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_training_course.training_course_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ac8441cd-59f1-55fe-b5ec-b03825bcaac3` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `version_no` | 版本号 | `integer` | 非空; 默认 — | 课程内递增版本。 | 保留旧员工当时所学内容。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `3` | hr_training_course_version.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `content_uri` | 课程内容地址 | `text` | 可空; 默认 — | 受控文档或学习内容地址。 | 课程交付；访问权限另行控制。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `lark://doc/...` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `content_sha256` | 内容校验值 | `char(64)` | 可空; 默认 — | 课程内容文件或规范化文本的校验值。 | 证明员工完成的是哪个版本。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `09fd...64位十六进制` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `pass_score` | 及格分 | `numeric(9,4)` | 可空; 默认 — | 本版本考核及格线。 | 自动判定培训结果。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `80` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `validity_days` | 资格有效天数 | `integer` | 可空; 默认 — | 通过后资格有效天数；永久有效为空。 | 岗位资格到期判断。 | CHECK validity_days IS NULL OR validity_days > 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `365` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `effective_from` | 生效时间 | `timestamptz` | 非空; 默认 — | 新指派开始使用该版本的时间。 | 版本门禁。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-01T00:00:00+08:00` | hr_training_course_version.effective_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `effective_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 停止新指派的时间。 | 保留历史结果。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2027-01-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `status` | 版本状态 | `text` | 非空; 默认 — | DRAFT、PUBLISHED 或 RETIRED。 | 只有 PUBLISHED 可指派。 | CHECK status IN ('DRAFT','PUBLISHED','RETIRED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `PUBLISHED` | hr_training_course_version.status 只表示本字段说明中的 版本状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_training_assignment` — 培训指派

- **用途：** 记录员工被要求完成的具体课程版本、期限和原因。
- **一行代表：** 雇佣关系 × 课程版本 × 一次指派一行
- **写入责任：** HR或门店培训负责人
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 岗位要求、入职任务或人工安排
- **实施层级：** `EXTENSION_PACK:TRAINING_AND_ONBOARDING`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_WORKFLOW` — 只允许批准的状态机迁移并记录操作者和时间
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 记录员工被要求完成的具体课程版本、期限和原因。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `employment_id` → `hr_employment.employment_id`；`training_course_version_id` → `hr_training_course_version.training_course_version_id`；`assigned_by_user_id` → `app_user.user_id`
- **被谁连接：** `hr_training_result.training_assignment_id`
- **分析视图：** `v_hr_role_eligibility`
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `training_assignment_id` | 培训指派ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次培训指派稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `35b35b6b-32f8-52a6-8741-fdc241e17e99` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `employment_id` | 雇佣ID | `uuid` | 非空; 默认 — | 被指派员工。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_employment.employment_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `7618a174-ddfa-5d06-8ce4-a8bfa1686a95` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `training_course_version_id` | 课程版本ID | `uuid` | 非空; 默认 — | 必须完成的具体课程版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_training_course_version.training_course_version_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `d92e8765-597d-5026-bb23-fdb85c1b213b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `assignment_reason` | 指派原因 | `text` | 非空; 默认 — | ONBOARDING、ROLE_REQUIREMENT、RENEWAL、REMEDIAL 或 MANUAL。 | 解释为什么需要培训。 | CHECK assignment_reason IN ('ONBOARDING','ROLE_REQUIREMENT','RENEWAL','REMEDIAL','MANUAL') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `ROLE_REQUIREMENT` | hr_training_assignment.assignment_reason 只表示本字段说明中的 指派原因；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `assigned_at` | 指派时间 | `timestamptz` | 非空; 默认 now() | 培训要求产生时间。 | 计算培训周期。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-20T09:00:00+08:00` | hr_training_assignment.assigned_at 只表示本字段说明中的 指派时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `due_at` | 截止时间 | `timestamptz` | 可空; 默认 — | 培训应完成时间。 | 资格门禁和逾期提醒。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-31T18:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `status` | 指派状态 | `text` | 非空; 默认 'ASSIGNED' | ASSIGNED、IN_PROGRESS、COMPLETED、WAIVED、EXPIRED 或 CANCELLED。 | 培训进度。 | CHECK status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','WAIVED','EXPIRED','CANCELLED') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `ASSIGNED` | hr_training_assignment.status 只表示本字段说明中的 指派状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `assigned_by_user_id` | 指派账号 | `uuid` | 可空; 默认 — | 发起指派的账号；系统生成可为空并追踪 job_run。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `b5e2537e-80ec-5ec1-96e8-4c8312d3888e` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 10 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_training_result` — 培训结果

- **用途：** 保存一次课程学习或考试的分数、结果和资格有效期。
- **一行代表：** 培训指派 × 一次尝试一行
- **写入责任：** 培训系统或负责人
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 考试、实操或人工核验
- **实施层级：** `EXTENSION_PACK:TRAINING_AND_ONBOARDING`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 保存一次课程学习或考试的分数、结果和资格有效期。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `training_assignment_id` → `hr_training_assignment.training_assignment_id`；`verified_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_hr_role_eligibility`
- **唯一约束：** training_assignment_id + attempt_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `training_result_id` | 培训结果ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次培训尝试稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `3d198e3b-3d7f-5e5e-b7d4-3ea9168a091d` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `training_assignment_id` | 培训指派ID | `uuid` | 非空; 默认 — | 所属培训指派。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_training_assignment.training_assignment_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `35b35b6b-32f8-52a6-8741-fdc241e17e99` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `attempt_no` | 尝试次数 | `integer` | 非空; 默认 — | 该指派内从 1 开始的尝试序号。 | 保留补考历史。 | CHECK attempt_no > 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `1` | hr_training_result.attempt_no 只表示本字段说明中的 尝试次数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `score` | 得分 | `numeric(9,4)` | 可空; 默认 — | 考试或实操分数。 | 与课程版本及格线比较。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `86` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `result` | 结果 | `text` | 非空; 默认 — | PASS、FAIL、INCOMPLETE 或 WAIVED。 | 岗位资格判断。 | CHECK result IN ('PASS','FAIL','INCOMPLETE','WAIVED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `PASS` | hr_training_result.result 只表示本字段说明中的 结果；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `completed_at` | 完成时间 | `timestamptz` | 非空; 默认 — | 本次尝试完成时间。 | 资格生效起点。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-25T15:00:00+08:00` | hr_training_result.completed_at 只表示本字段说明中的 完成时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `valid_from` | 资格生效时间 | `timestamptz` | 可空; 默认 — | 通过后资格开始有效时间。 | 班表资格门禁。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-25T15:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `valid_to` | 资格失效时间 | `timestamptz` | 可空; 默认 — | 通过资格到期时间。 | 到期后不能继续安排关键岗位。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2027-08-25T15:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `verified_by_user_id` | 核验账号 | `uuid` | 可空; 默认 — | 人工核验结果的账号；自动考试可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `657d68b7-6271-56cd-af62-f6f757039940` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `evidence` | 结果证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 证书编号、答题摘要或实操核验引用。 | 支持资格审计。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `restricted` | `{"certificate":"FS-2026-129"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_timesheet_sync_batch` — 工时同步批次

- **用途：** 记录一次 Lark 或其他工时来源同步的窗口、解析版本和完整性。
- **一行代表：** 来源 × 时间窗口 × 一次同步一行
- **写入责任：** BakeryOps 工时同步任务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** Lark工时或批准来源
- **实施层级：** `SOURCE_CONDITIONAL`
- **生命周期：** `SOURCE_CONDITIONAL`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `NOT_PHASE1_SOURCE_UNVERIFIED`；存储类别 `SOURCE_CONDITIONAL`；可派生性 `UNKNOWN_UNTIL_SOURCE_VERIFIED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DEFER_UNTIL_SOURCE_PROVEN
- **为何存表而不是现算视图：** 记录一次 Lark 或其他工时来源同步的窗口、解析版本和完整性。；外部来源身份、粒度、权限和重跑契约尚未验证，当前只保留目标契约，不建正式表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `job_run_id` → `app_job_run.job_run_id`；`source_system_id` → `app_source_system.source_system_id`
- **被谁连接：** `hr_timesheet_entry.timesheet_sync_batch_id`
- **分析视图：** `v_hr_timesheet_entry_current`
- **唯一约束：** source_system_id + source_batch_id [NULLS DISTINCT：仅非空值去重，允许多条空值]；idempotency_key
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** window_end > window_start；source_batch_id IS NOT NULL OR payload_sha256 IS NOT NULL
- **特别说明：** 与 POS 增量相同，完全相同的来源输入和 parser_version 必须命中同一 idempotency_key；来源内容变化或解析规则变化才创建新批次。终态后冻结，重跑不得新增重复 entry。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `timesheet_sync_batch_id` | 工时批次ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次工时同步稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `5ac9a821-d6d9-5f45-ac7b-00caa6293377` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `job_run_id` | 任务运行ID | `uuid` | 非空; 默认 — | 执行同步的自动任务。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 提供工时记录的来源。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 4 | `window_start` | 同步窗口开始 | `timestamptz` | 非空; 默认 — | 请求工时数据的起点。 | 解释覆盖范围。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-01T00:00:00+08:00` | hr_timesheet_sync_batch.window_start 只表示本字段说明中的 同步窗口开始；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `window_end` | 同步窗口结束 | `timestamptz` | 非空; 默认 — | 请求工时数据的终点。 | 避免漏数或重复。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T00:00:00+08:00` | hr_timesheet_sync_batch.window_end 只表示本字段说明中的 同步窗口结束；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `source_batch_id` | 外部批次ID | `text` | 可空; 默认 — | 来源提供的稳定导出、报表或同步批次ID。 | 来源具备批次身份时直接用于跨重跑幂等。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `lark-attendance-export-20260808` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `payload_sha256` | 来源内容校验值 | `char(64)` | 可空; 默认 — | 本次工时响应或规范化文件的 SHA-256。 | 来源无稳定批次ID时识别同一内容，并检测同窗口内容更正。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `4c1a...64位十六进制` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `idempotency_key` | 批次幂等键 | `char(64)` | 非空; 默认 — | 按来源、窗口、外部批次ID或内容校验值及解析版本规范化计算的 SHA-256。 | 同一输入重跑必须恢复同一批次，不能让工时行数增长。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `91da...64位十六进制` | hr_timesheet_sync_batch.idempotency_key 只表示本字段说明中的 批次幂等键；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `parser_version` | 解析版本 | `text` | 非空; 默认 — | 把来源工时转成标准分钟的代码版本。 | 历史重现。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `lark-timesheet-v2` | hr_timesheet_sync_batch.parser_version 只表示本字段说明中的 解析版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `loaded_row_count` | 落库行数 | `bigint` | 非空; 默认 0 | 成功写入或确认幂等的工时行数。 | 完整性监控。 | CHECK loaded_row_count >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `220` | hr_timesheet_sync_batch.loaded_row_count 只表示本字段说明中的 落库行数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `status` | 批次状态 | `text` | 非空; 默认 — | RUNNING、SUCCEEDED、PARTIAL、FAILED 或 REJECTED。 | 下游只读取合格批次。 | CHECK status IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED','REJECTED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `SUCCEEDED` | hr_timesheet_sync_batch.status 只表示本字段说明中的 批次状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `completed_at` | 完成时间 | `timestamptz` | 可空; 默认 — | 同步完成时间。 | 数据新鲜度。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T01:05:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 14 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `hr_timesheet_entry` — 实际工时事实

- **用途：** 保存员工在地点、日期和工作区域的实际净工时原值与来源，不把班表当实际工时。
- **一行代表：** 来源工时记录 × 雇佣关系 × 地点 × 工作时段一行
- **写入责任：** BakeryOps 工时同步任务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** Lark工时或批准人工更正
- **实施层级：** `SOURCE_CONDITIONAL`
- **生命周期：** `SOURCE_CONDITIONAL`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_SOURCE_UNVERIFIED`；存储类别 `SOURCE_CONDITIONAL`；可派生性 `UNKNOWN_UNTIL_SOURCE_VERIFIED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DEFER_UNTIL_SOURCE_PROVEN
- **为何存表而不是现算视图：** 保存员工在地点、日期和工作区域的实际净工时原值与来源，不把班表当实际工时。；外部来源身份、粒度、权限和重跑契约尚未验证，当前只保留目标契约，不建正式表。
- **保留策略：** 按劳动法规保留；普通分析只读取去标识字段
- **向外连接：** `timesheet_sync_batch_id` → `hr_timesheet_sync_batch.timesheet_sync_batch_id`；`employment_id` → `hr_employment.employment_id`；`location_id` → `ops_location.location_id`；`shift_assignment_id` → `ops_shift_assignment.shift_assignment_id`；`role_id` → `ops_role.role_id`；`station_id` → `ops_station.station_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_hr_timesheet_entry_current`
- **唯一约束：** timesheet_sync_batch_id + source_entry_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** clock_out_at IS NULL OR clock_in_at IS NULL OR clock_out_at >= clock_in_at
- **特别说明：** 同一幂等批次内 (timesheet_sync_batch_id, source_entry_id) 唯一；完全相同输入重跑会复用批次，因此总行数不增长。来源同一 entry 后续被更正时，新 payload_sha256 产生新批次，由只读 current 视图按来源系统、source_entry_id 和获准批次选版。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `timesheet_entry_id` | 工时记录ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条实际工时稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `a98330e2-cbbc-5d9a-a1ff-2201bd21f062` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `timesheet_sync_batch_id` | 工时批次ID | `uuid` | 非空; 默认 — | 采集该记录的同步批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_timesheet_sync_batch.timesheet_sync_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `5ac9a821-d6d9-5f45-ac7b-00caa6293377` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `employment_id` | 雇佣ID | `uuid` | 非空; 默认 — | 实际工作的员工雇佣关系。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_employment.employment_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7618a174-ddfa-5d06-8ce4-a8bfa1686a95` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 实际工作地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `shift_assignment_id` | 班次指派ID | `uuid` | 可空; 默认 — | 能唯一匹配计划班次时记录；班表扩展包启用前必须为空且不创建该外键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | 延期FK → ops_shift_assignment.shift_assignment_id；激活=EXTENSION_PACK:SHIFT_AND_WORKFORCE | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `ee97e59a-19b1-5063-b05e-0ccd1374bcc1` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 该列在 EXTENSION_PACK:SHIFT_AND_WORKFORCE 未完整启用前必须为 NULL，届时也不得提前创建外键。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `role_id` | 实际岗位ID | `uuid` | 可空; 默认 — | 来源能确认的实际岗位；未知为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_role.role_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `a28ce29f-93bc-5620-a42b-c652824558c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `station_id` | 实际工位ID | `uuid` | 可空; 默认 — | 来源能确认的工作区域；未知为空；班表扩展包启用前必须为空且不创建该外键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | 延期FK → ops_station.station_id；激活=EXTENSION_PACK:SHIFT_AND_WORKFORCE | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `0750f6ee-4f5e-5628-aa23-27a9a4d0ec54` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 该列在 EXTENSION_PACK:SHIFT_AND_WORKFORCE 未完整启用前必须为 NULL，届时也不得提前创建外键。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `source_entry_id` | 外部工时ID | `text` | 非空; 默认 — | 来源系统稳定工时记录ID。 | 同步幂等。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `internal` | `lark_attendance_8812` | 这是来源系统证据，不等于企业统一身份。 |
| 9 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 按地点切点归属的工作日期。 | 与销售和班表连接。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 10 | `clock_in_at` | 上班打卡时间 | `timestamptz` | 可空; 默认 — | 来源记录的开始时间。 | 核对时段和迟到。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `personal` | `2026-08-08T08:01:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `clock_out_at` | 下班打卡时间 | `timestamptz` | 可空; 默认 — | 来源记录的结束时间。 | 核对时段和早退。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `personal` | `2026-08-08T17:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `reported_minutes` | 来源报告分钟 | `integer` | 非空; 默认 — | 来源系统返回的原始净工时分钟。 | 保留来源原值。 | CHECK reported_minutes >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `480` | hr_timesheet_entry.reported_minutes 只表示本字段说明中的 来源报告分钟；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `net_work_minutes` | 标准净工时分钟 | `integer` | 非空; 默认 — | 按批准解析规则标准化后的净工作分钟。 | 人效和财务人工核对的正式实际工时。 | CHECK net_work_minutes >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `480` | hr_timesheet_entry.net_work_minutes 只表示本字段说明中的 标准净工时分钟；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 14 | `break_minutes` | 实际休息分钟 | `integer` | 可空; 默认 — | 来源明确报告或批准解析规则能够确定的休息分钟；来源没有该值时为 NULL。 | 解释打卡跨度与净工时差，同时区分真实 0 分钟和来源缺失。 | CHECK break_minutes IS NULL OR break_minutes >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `60` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | COMPLETE、MISSING_IDENTITY、MISSING_CLOCK、OVERLAP 或 MANUAL_OVERRIDE。 | 问题记录进入质量队列。 | CHECK quality_status IN ('COMPLETE','MISSING_IDENTITY','MISSING_CLOCK','OVERLAP','MANUAL_OVERRIDE') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `COMPLETE` | hr_timesheet_entry.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 16 | `source_payload_ref` | 来源原值引用 | `text` | 可空; 默认 — | 外部加密文件或对象存储中的原始记录引用。 | 需要时复核，不在表内复制整份 PII。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `restricted` | `s3://.../hash` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

# SCM — 原料、库存、补货、采购与收货

## `scm_material` — 统一原料主数据

- **用途：** 统一表示原料、包材和半成品，不让供应链依赖财务成本卡内部编号。
- **一行代表：** 每个可采购、库存或作为配方组件的物料一行
- **写入责任：** 供应链主数据流程
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 供应商目录、配方和人工审核
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 统一表示原料、包材和半成品，不让供应链依赖财务成本卡内部编号。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 永久保留；停用只改变状态
- **向外连接：** `base_unit_id` → `app_unit.unit_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `cost_card_material_price.material_id`；`cost_card_recipe_component.material_id`；`cost_card_recipe_version.output_material_id`；`finance_inventory_flow_line.material_id`；`finance_inventory_snapshot_line.material_id`；`finance_order_logistics_line.material_id`；`finance_supplier_purchase_monthly.material_id`；`scm_goods_receipt_line.material_id`；`scm_inventory_count_line.material_id`；`scm_inventory_movement_line.material_id`；`scm_material_alias.material_id`；`scm_material_requirement_component.material_id`；`scm_material_source_identity.material_id`；`scm_material_unit_conversion.material_id`；`scm_replenishment_line.material_id`；`scm_supplier_item.material_id`；`scm_supplier_item_mapping_review.candidate_material_id`
- **分析视图：** `v_scm_material_requirement_line`、`v_scm_supplier_item_current_mapping`、`v_scm_supplier_price_current`、`v_cost_card_material_price_current`、`v_cost_card_recipe_expanded`
- **唯一约束：** material_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `material_id` | 原料ID | `uuid` | 非空; 默认 gen_random_uuid() | 连接配方、供应商 SKU、库存、订货、收货和采购价的稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `material_code` | 原料代码 | `text` | 非空; 默认 — | 企业内部唯一不可变原料代码。 | 在业务沟通和导入中定位物料。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `HC-MAT-0184` | scm_material.material_code 只表示本字段说明中的 原料代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `material_name` | 原料名称 | `text` | 非空; 默认 — | 当前正式显示名称。 | 只用于展示，不作为跨表连接条件。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `黑巧克力 70%` | scm_material.material_name 只表示本字段说明中的 原料名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `material_type` | 物料类型 | `text` | 非空; 默认 — | INGREDIENT、PACKAGING、SEMI_FINISHED、CONSUMABLE 或 FINISHED_GOOD。 | 决定配方、库存和采购规则。 | CHECK material_type IN ('INGREDIENT','PACKAGING','SEMI_FINISHED','CONSUMABLE','FINISHED_GOOD') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `INGREDIENT` | scm_material.material_type 只表示本字段说明中的 物料类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `base_unit_id` | 基础单位ID | `uuid` | 非空; 默认 — | 库存、配方和成本归一化采用的受控计量单位。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `8d3eb6c1-1126-5b7c-9933-3b8c9028ae3d` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 6 | `shelf_life_days` | 保质期天数 | `integer` | 可空; 默认 — | 未开封标准条件下的参考保质期。 | 补货和批次库存决策的输入。 | CHECK shelf_life_days IS NULL OR shelf_life_days > 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `365` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `is_lot_tracked` | 是否批次追踪 | `boolean` | 非空; 默认 false | 库存是否必须记录批号或效期。 | 决定收货和库存移动的字段门禁。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `true` | scm_material.is_lot_tracked 只表示本字段说明中的 是否批次追踪；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `status` | 原料状态 | `text` | 非空; 默认 'DRAFT' | DRAFT、ACTIVE、SUSPENDED 或 RETIRED。 | 停用物料但保留历史配方和采购事实。 | CHECK status IN ('DRAFT','ACTIVE','SUSPENDED','RETIRED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | scm_material.status 只表示本字段说明中的 原料状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 11 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_material_alias` — 原料别名

- **用途：** 保存供应商、财务模板和历史配方里的原料不同写法。
- **一行代表：** 来源范围 × 原料别名 × 有效期一行
- **写入责任：** 供应链主数据流程
- **读取项目：** BakeryOps、财务网站
- **数据来源：** 供应商报价、Excel和历史成本卡
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `PARTIAL_FIELDS_DERIVED_IN_VIEW`
- **可派生字段/输出：** normalized_alias -> NORMALIZE_ALIAS(alias_text)
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存供应商、财务模板和历史配方里的原料不同写法。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `material_id` → `scm_material.material_id`；`source_system_id` → `app_source_system.source_system_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** source_system_id + alias_text + valid_from [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** NO_OVERLAP(COALESCE(source_system_id, NIL_UUID), NORMALIZE_ALIAS(alias_text), daterange(valid_from, valid_to, '[)')) WHERE status = 'CONFIRMED'
- **表级检查：** valid_to IS NULL OR valid_to > valid_from；public.app_normalize_alias_v1(alias_text) <> ''
- **特别说明：** normalized_alias 不作为独立字段保存；确认冲突和候选检索统一调用版本锁定的 NORMALIZE_ALIAS(alias_text) 函数或函数索引，避免原文与派生副本漂移。标准化结果只能生成候选，不能自动确认 material_id。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `material_alias_id` | 别名ID | `uuid` | 非空; 默认 gen_random_uuid() | 原料别名稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `cd034b8f-7be3-5d39-ade8-e8c60a4543c8` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `material_id` | 原料ID | `uuid` | 非空; 默认 — | 别名明确指向的统一原料。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 可空; 默认 — | 别名来自的系统；企业通用别名可以为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `alias_text` | 别名文本 | `text` | 非空; 默认 — | 来源中的原始物料名称。 | 保留原文供人工审核。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `Dark choc 70 pct` | scm_material_alias.alias_text 只表示本字段说明中的 别名文本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `valid_from` | 生效日期 | `date` | 非空; 默认 CURRENT_DATE | 别名开始有效日期。 | 处理供应商改名。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-09` | scm_material_alias.valid_from 只表示本字段说明中的 生效日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `valid_to` | 失效日期上界 | `date` | 可空; 默认 — | 别名停止有效的日期上界，该日期本身不再有效。 | 以左闭右开区间保留历史并避免相邻版本重复命中。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2027-01-01` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `status` | 状态 | `text` | 非空; 默认 'PENDING' | CONFIRMED、PENDING 或 REJECTED。 | 限制自动匹配使用范围。 | CHECK status IN ('CONFIRMED','PENDING','REJECTED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `CONFIRMED` | scm_material_alias.status 只表示本字段说明中的 状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 10 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_material_source_identity` — 原料来源身份映射

- **用途：** 把成本卡迁移编号、WMS编号等外部物料身份映射到 material_id。
- **一行代表：** 来源系统 × 外部原料ID × 有效期一行
- **写入责任：** 供应链主数据审核
- **读取项目：** BakeryOps、财务网站
- **数据来源：** 外部物料目录与人工证据
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 把成本卡迁移编号、WMS编号等外部物料身份映射到 material_id。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `material_id` → `scm_material.material_id`；`source_system_id` → `app_source_system.source_system_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_identity_mapping_gap`
- **唯一约束：** source_system_id + source_material_id + valid_from
- **不可重叠约束：** NO_OVERLAP(source_system_id, source_material_id, tstzrange(valid_from, valid_to, '[)')) WHERE mapping_status = 'CONFIRMED'
- **表级检查：** valid_to IS NULL OR valid_to > valid_from

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `material_source_identity_id` | 映射ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条原料来源映射稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `42263450-14b5-53b1-b0b0-c6ab0da15ed2` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `material_id` | 原料ID | `uuid` | 非空; 默认 — | 映射后的统一原料。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 提供外部物料编号的来源系统。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_material_id` | 外部原料ID | `text` | 非空; 默认 — | 来源系统原始物料标识。 | 与来源系统共同唯一。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `cost_item:184` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `valid_from` | 生效时间 | `timestamptz` | 非空; 默认 now() | 映射开始有效时间。 | 保留来源变更历史。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-09T00:00:00+08:00` | scm_material_source_identity.valid_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `valid_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 映射停止有效时间。 | 历史事实仍按原有效期连接。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2027-01-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `mapping_status` | 映射状态 | `text` | 非空; 默认 'PENDING' | CONFIRMED、PENDING 或 REJECTED。 | 未确认原料不得进入正式成本和补货。 | CHECK mapping_status IN ('CONFIRMED','PENDING','REJECTED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `CONFIRMED` | scm_material_source_identity.mapping_status 只表示本字段说明中的 映射状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `evidence` | 映射证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 规格、单位、供应商等核对证据。 | 防止仅按名称猜匹配。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"unit":"kg","supplier":"ABC"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 9 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 11 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_material_unit_conversion` — 物料单位换算

- **用途：** 版本化维护某种原料或包材在采购包装、配方用量和库存基础单位之间的可审核换算。
- **一行代表：** 原料 × 起始单位 × 目标单位 × 生效区间一行
- **写入责任：** 供应链主数据审核
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 供应商规格、称量验证或批准的成本卡迁移
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 版本化维护某种原料或包材在采购包装、配方用量和库存基础单位之间的可审核换算。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 永久保留；新规格创建新生效区间，不覆盖旧系数
- **向外连接：** `material_id` → `scm_material.material_id`；`from_unit_id` → `app_unit.unit_id`；`to_unit_id` → `app_unit.unit_id`；`source_system_id` → `app_source_system.source_system_id`；`verified_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `cost_card_recipe_component.material_unit_conversion_id`；`scm_inventory_count_line.material_unit_conversion_id`；`scm_purchase_order_line.material_unit_conversion_id`；`scm_supplier_item.material_unit_conversion_id`；`scm_supplier_price_observation.material_unit_conversion_id`
- **分析视图：** `v_scm_supplier_item_current_mapping`、`v_scm_supplier_price_current`、`v_cost_card_recipe_expanded`
- **唯一约束：** material_id + from_unit_id + to_unit_id + valid_from
- **不可重叠约束：** NO_OVERLAP(material_id, from_unit_id, to_unit_id, tstzrange(valid_from, valid_to, '[)')) WHERE status = 'VERIFIED'
- **表级检查：** from_unit_id <> to_unit_id；valid_to IS NULL OR valid_to > valid_from；status <> 'VERIFIED' OR verified_at IS NOT NULL
- **特别说明：** kg↔g 等全局线性换算由 app_unit 管理；CASE、BAG 等与具体物料规格相关的换算必须在本表核验。PENDING 可补证据；VERIFIED、REJECTED 或 RETIRED 后冻结，包装变化新增生效区间。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `material_unit_conversion_id` | 物料单位换算ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条有生效期的物料单位换算稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `f9de28ad-8c05-5f0b-8036-b52fad4439cb` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `material_id` | 原料ID | `uuid` | 非空; 默认 — | 该换算仅适用的统一原料或包材。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `from_unit_id` | 起始单位ID | `uuid` | 非空; 默认 — | 原始数量使用的受控单位。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `b3dbfce6-b2ff-58a0-bc81-e3f889f467a8` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `to_unit_id` | 目标单位ID | `uuid` | 非空; 默认 — | 换算后数量使用的受控单位，通常为 material.base_unit_id。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `d577e723-ba03-540f-8db5-41ad622e3fb6` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `conversion_factor` | 换算系数 | `numeric(24,12)` | 非空; 默认 — | 一个 from_unit 等于多少个 to_unit。 | 统一配方、报价、下单、收货和盘点的数量口径。 | CHECK conversion_factor > 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `10000.000000000000` | scm_material_unit_conversion.conversion_factor 只表示本字段说明中的 换算系数；必须在所属对象粒度内按 numeric(24,12) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `valid_from` | 生效时间 | `timestamptz` | 非空; 默认 — | 该规格换算开始有效的时间。 | 供应商改包装后旧事实仍使用旧系数。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-01T00:00:00+08:00` | scm_material_unit_conversion.valid_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `valid_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 该换算停止适用的时间；仍有效时为空。 | 定义无重叠的历史区间。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-12-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `source_system_id` | 来源系统ID | `uuid` | 可空; 默认 — | 提供规格或换算证据的来源；纯人工称量可以为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `evidence` | 换算证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 包装净含量、称量记录、供应商规格或迁移来源。 | 使换算可以复核，不依赖口头约定。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"specification":"10 kg/case","net_weight_g":10000}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 10 | `status` | 换算状态 | `text` | 非空; 默认 'PENDING' | PENDING、VERIFIED、REJECTED 或 RETIRED。 | 只有 VERIFIED 且在生效期内的换算可进入正式成本和库存。 | CHECK status IN ('PENDING','VERIFIED','REJECTED','RETIRED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `VERIFIED` | scm_material_unit_conversion.status 只表示本字段说明中的 换算状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `verified_by_user_id` | 核验账号 | `uuid` | 可空; 默认 — | 确认该换算证据的应用账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `657d68b7-6271-56cd-af62-f6f757039940` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `verified_at` | 核验时间 | `timestamptz` | 可空; 默认 — | 换算进入 VERIFIED 的时间。 | 证明何时获准用于正式计算。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-02T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 15 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_supplier` — 供应商主数据

- **用途：** 维护供应商稳定身份、采购币种、付款条件和状态。
- **一行代表：** 一个法律或经营供应商一行
- **写入责任：** 供应链主数据流程
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 采购合同和人工审核
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 维护供应商稳定身份、采购币种、付款条件和状态。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 永久保留；停用不删除
- **向外连接：** `created_by_user_id` → `app_user.user_id`
- **被谁连接：** `finance_order_logistics_line.supplier_id`；`finance_supplier_purchase_monthly.supplier_id`；`scm_purchase_order_revision.supplier_id`；`scm_supplier_item.supplier_id`
- **分析视图：** `v_scm_supplier_item_current_mapping`、`v_scm_supplier_price_current`
- **唯一约束：** supplier_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `supplier_id` | 供应商ID | `uuid` | 非空; 默认 gen_random_uuid() | 跨报价、供应商SKU、PO、收货和财务核对的稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `e371d1ab-adb0-5313-9194-bda119e8f5ba` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `supplier_code` | 供应商代码 | `text` | 非空; 默认 — | 企业内部唯一不可变供应商代码。 | 导入和业务沟通使用。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `SUP-MY-0012` | scm_supplier.supplier_code 只表示本字段说明中的 供应商代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `supplier_name` | 供应商名称 | `text` | 非空; 默认 — | 当前正式显示名称。 | 展示和搜索，不作为跨表连接键。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ABC Ingredients Sdn Bhd` | scm_supplier.supplier_name 只表示本字段说明中的 供应商名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `legal_name` | 法定名称 | `text` | 可空; 默认 — | 合同和发票使用的法定实体名称。 | 财务核对和合同。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `ABC Ingredients Sdn. Bhd.` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `registration_no` | 注册编号 | `text` | 可空; 默认 — | 供应商公司注册或税务标识。 | 供应商去重和合规。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `restricted` | `202001234567` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `country_code` | 国家代码 | `char(2)` | 非空; 默认 'MY' | 供应商所在 ISO 国家代码。 | 采购提前期和税务规则。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `MY` | scm_supplier.country_code 只表示本字段说明中的 国家代码；必须在所属对象粒度内按 char(2) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `default_currency` | 默认币种 | `char(3)` | 非空; 默认 'MYR' | 报价和采购默认币种。 | 解释价格。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `MYR` | scm_supplier.default_currency 只表示本字段说明中的 默认币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `payment_terms_days` | 付款账期天数 | `integer` | 可空; 默认 — | 标准付款到期天数。 | 现金流计划。 | CHECK payment_terms_days IS NULL OR payment_terms_days >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `30` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `lead_time_days` | 默认提前期天数 | `integer` | 可空; 默认 — | 未在 SKU 层覆盖时的标准交货提前期。 | 补货建议。 | CHECK lead_time_days IS NULL OR lead_time_days >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `3` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `status` | 供应商状态 | `text` | 非空; 默认 'PENDING' | PENDING、ACTIVE、SUSPENDED 或 RETIRED。 | 停用供应商但保留采购历史。 | CHECK status IN ('PENDING','ACTIVE','SUSPENDED','RETIRED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | scm_supplier.status 只表示本字段说明中的 供应商状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `contact_data` | 受限联系信息 | `jsonb` | 非空; 默认 '{}'::jsonb | 采购联系人和渠道的受限结构化信息。 | 日常采购联系；普通分析不得读取。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `restricted` | `{"channel":"email"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 12 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 14 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_supplier_item` — 供应商商品

- **用途：** 以版本行维护供应商 SKU、对应统一物料、包装换算、MOQ和商业条件；规格变化新增版本，不再拆一张一对一映射表。
- **一行代表：** 供应商 × 外部SKU × 生效版本一行
- **写入责任：** 供应链主数据流程
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 供应商目录和人工审核
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `PARTIAL_FIELDS_DERIVED_IN_VIEW`
- **可派生字段/输出：** base_unit_quantity -> material unit conversion
- **R6 审计动作：** R6_MERGE_INTO: each row is an effective-dated supplier SKU/material/package version; no separate mapping table
- **为何存表而不是现算视图：** 以版本行维护供应商 SKU、对应统一物料、包装换算、MOQ和商业条件；规格变化新增版本，不再拆一张一对一映射表。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 永久保留；映射或包装变化新增生效区间，不覆盖旧映射
- **向外连接：** `supplier_id` → `scm_supplier.supplier_id`；`supersedes_supplier_item_id` → `scm_supplier_item.supplier_item_id`；`order_unit_id` → `app_unit.unit_id`；`material_id` → `scm_material.material_id`；`material_unit_conversion_id` → `scm_material_unit_conversion.material_unit_conversion_id`；`confirmed_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `scm_purchase_order_line.supplier_item_id`；`scm_replenishment_line.supplier_item_id`；`scm_supplier_item.supersedes_supplier_item_id`；`scm_supplier_item_mapping_review.supplier_item_id`；`scm_supplier_price_observation.supplier_item_id`
- **分析视图：** `v_scm_replenishment_trace`、`v_scm_supplier_item_current_mapping`、`v_scm_supplier_price_current`
- **唯一约束：** supplier_id + supplier_sku + valid_from
- **不可重叠约束：** NO_OVERLAP(supplier_id, supplier_sku, tstzrange(valid_from, valid_to, '[)')) WHERE mapping_status = 'CONFIRMED'
- **表级检查：** valid_to IS NULL OR valid_to > valid_from；mapping_status <> 'CONFIRMED' OR (material_id IS NOT NULL AND confirmed_at IS NOT NULL)
- **特别说明：** R6 将目录与其一对一物料/包装版本合并；同一 supplier_sku 规格变化时新增 supplier_item_id 并通过 supersedes 连接，禁止覆盖旧版本。每订购单位基础量不重复保存：order_unit_id 等于物料基础单位时派生为 1，否则由 material_unit_conversion_id 指向的已冻结系数计算。受控确认函数必须验证单位方向与 material_id 一致。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `supplier_item_id` | 供应商商品ID | `uuid` | 非空; 默认 gen_random_uuid() | 供应商 SKU 的一个有效版本身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `c5661f44-564f-5b4e-bdb9-8563d4a8702f` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `supplier_id` | 供应商ID | `uuid` | 非空; 默认 — | SKU所属供应商。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_supplier.supplier_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `e371d1ab-adb0-5313-9194-bda119e8f5ba` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `supersedes_supplier_item_id` | 被替代供应商商品ID | `uuid` | 可空; 默认 — | 本版本替代的上一版本；首次为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_supplier_item.supplier_item_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `3518e055-2f32-5ab8-a316-1f474179348f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `supplier_sku` | 供应商SKU | `text` | 非空; 默认 — | 供应商提供的稳定商品编号。 | 与供应商共同唯一。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `CHOCO70-5KG` | scm_supplier_item.supplier_sku 只表示本字段说明中的 供应商SKU；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `supplier_item_name` | 供应商商品名称 | `text` | 非空; 默认 — | 报价或目录中的原始名称。 | 保留来源证据。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `Dark Chocolate 70% 5kg` | scm_supplier_item.supplier_item_name 只表示本字段说明中的 供应商商品名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `order_unit_id` | 订购单位ID | `uuid` | 非空; 默认 — | PO 上使用的受控包装或计量单位。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `cf4ff92b-aa99-5ca0-b359-a901d8472c8f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 7 | `material_id` | 原料ID | `uuid` | 可空; 默认 — | 本版本确认对应的统一原料；尚未完成映射时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `material_unit_conversion_id` | 物料单位换算ID | `uuid` | 可空; 默认 — | 把订购单位换算到物料基础单位的已核验规格；尚未核验时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material_unit_conversion.material_unit_conversion_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `f9de28ad-8c05-5f0b-8036-b52fad4439cb` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `minimum_order_quantity` | 最小订购量 | `numeric(18,4)` | 可空; 默认 — | 供应商要求的最小 order_unit 数量。 | 补货取整。 | CHECK minimum_order_quantity IS NULL OR minimum_order_quantity > 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `order_multiple` | 订购倍数 | `numeric(18,4)` | 非空; 默认 1 | 允许下单数量的倍数。 | 把建议量转成可下单量。 | CHECK order_multiple > 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `1` | scm_supplier_item.order_multiple 只表示本字段说明中的 订购倍数；必须在所属对象粒度内按 numeric(18,4) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `lead_time_days` | SKU提前期天数 | `integer` | 可空; 默认 — | 该 SKU 特有交货提前期。 | 覆盖供应商默认值。 | CHECK lead_time_days IS NULL OR lead_time_days >= 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `5` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `valid_from` | 生效时间 | `timestamptz` | 非空; 默认 — | 该映射和包装规格开始可用于业务的时间。 | 按下单或观察发生时点选择正确映射。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-01T00:00:00+08:00` | scm_supplier_item.valid_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `valid_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 该映射停止适用的时间上界；仍有效时为空。 | 保留历史并允许相邻版本。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-12-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `mapping_status` | 映射状态 | `text` | 非空; 默认 'PENDING' | PENDING、CONFIRMED、REJECTED 或 RETIRED。 | 只有 CONFIRMED 且时点有效的映射可进入正式补货、PO和成本。 | CHECK mapping_status IN ('PENDING','CONFIRMED','REJECTED','RETIRED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `CONFIRMED` | scm_supplier_item.mapping_status 只表示本字段说明中的 映射状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 15 | `evidence` | 映射证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 供应商规格、包装照片、称量、目录或迁移证据。 | 证明不是按名称猜映射。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"pack":"5kg/case","verified_weight_g":5000}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 16 | `confirmed_by_user_id` | 确认账号 | `uuid` | 可空; 默认 — | 确认物料和包装规格的应用账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `5f404280-ef9e-5df5-8e23-3f38a16d06d9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `confirmed_at` | 确认时间 | `timestamptz` | 可空; 默认 — | 映射进入 CONFIRMED 的时间。 | 审计何时获准使用。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-02T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 20 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_supplier_item_mapping_review` — 供应商商品映射审核

- **用途：** 处理供应商 SKU 无法唯一映射到 material_id 的候选和证据。
- **一行代表：** 一个供应商SKU的一次待审核问题一行
- **写入责任：** 供应链主数据审核
- **读取项目：** BakeryOps、财务网站
- **数据来源：** 目录匹配质量检查
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_WORKFLOW` — 只允许批准的状态机迁移并记录操作者和时间
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 处理供应商 SKU 无法唯一映射到 material_id 的候选和证据。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 永久保留审核结论
- **向外连接：** `supplier_item_id` → `scm_supplier_item.supplier_item_id`；`candidate_material_id` → `scm_material.material_id`；`reviewed_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** OPEN 阶段允许补充候选证据；APPROVED、REJECTED 或 DEFERRED 后冻结结论。批准动作创建新的有效 scm_supplier_item 版本，不覆盖旧版本。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `supplier_item_mapping_review_id` | 审核ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次供应商商品映射审核稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `d61d4a2d-0009-5174-83fc-27f7a288b0b9` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `supplier_item_id` | 供应商商品ID | `uuid` | 非空; 默认 — | 待审核 SKU。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_supplier_item.supplier_item_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `c5661f44-564f-5b4e-bdb9-8563d4a8702f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `candidate_material_id` | 候选原料ID | `uuid` | 可空; 默认 — | 候选统一原料；无候选为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `4001bee4-c963-55e3-91fa-7746041d59e9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `reason_code` | 进入队列原因 | `text` | 非空; 默认 — | NO_CANDIDATE、MULTIPLE_CANDIDATES、UNIT_CONFLICT 或 SPEC_CONFLICT。 | 决定审核重点。 | CHECK reason_code IN ('NO_CANDIDATE','MULTIPLE_CANDIDATES','UNIT_CONFLICT','SPEC_CONFLICT') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `UNIT_CONFLICT` | scm_supplier_item_mapping_review.reason_code 只表示本字段说明中的 进入队列原因；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `candidate_score` | 候选得分 | `numeric(5,4)` | 可空; 默认 — | 匹配算法 0 至 1 得分。 | 只用于排序。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `0.8100` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `evidence` | 候选证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 名称、规格、包装和供应商证据。 | 禁止仅按名称自动确认。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `{"pack":"5kg"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 7 | `status` | 审核状态 | `text` | 非空; 默认 'OPEN' | OPEN、APPROVED、REJECTED 或 DEFERRED。 | 批准后创建新的有效供应商商品版本。 | CHECK status IN ('OPEN','APPROVED','REJECTED','DEFERRED') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `OPEN` | scm_supplier_item_mapping_review.status 只表示本字段说明中的 审核状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `reviewed_by_user_id` | 审核账号 | `uuid` | 可空; 默认 — | 完成审核的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `9f809e56-58de-53ea-9cc4-5a7f5116feb5` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `reviewed_at` | 审核时间 | `timestamptz` | 可空; 默认 — | 审核进入终态时间。 | 审计处理时长。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-10T09:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `review_note` | 审核说明 | `text` | 可空; 默认 — | 人工结论和必要说明。 | 处理新建原料或拒绝映射。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `包装单位需供应商确认` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_inventory_count` — 库存盘点单

- **用途：** 记录某地点某时点的一次完整或抽样盘点及批准状态。
- **一行代表：** 地点 × 盘点时点 × 一次盘点一行
- **写入责任：** 仓库或门店库存流程
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 人工盘点、WMS或导入
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 记录某地点某时点的一次完整或抽样盘点及批准状态。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `location_id` → `ops_location.location_id`；`source_system_id` → `app_source_system.source_system_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `scm_inventory_count_line.inventory_count_id`；`scm_inventory_movement.inventory_count_id`
- **分析视图：** `v_scm_inventory_balance`
- **唯一约束：** count_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `inventory_count_id` | 盘点单ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次库存盘点稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `f2554157-a273-5ba5-a23c-2a05faa5c8a6` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 被盘点门店、厨房或仓库。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 盘点来源；人工后台也作为来源注册。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 4 | `count_code` | 盘点单号 | `text` | 非空; 默认 — | 业务可读唯一盘点编号。 | 现场沟通和幂等。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `CNT-PAV-20260831` | scm_inventory_count.count_code 只表示本字段说明中的 盘点单号；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `counted_at` | 盘点时点 | `timestamptz` | 非空; 默认 — | 库存数量实际对应的时点。 | 不能用导入时间代替。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-31T22:00:00+08:00` | scm_inventory_count.counted_at 只表示本字段说明中的 盘点时点；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `count_type` | 盘点类型 | `text` | 非空; 默认 — | FULL、CYCLE、SPOT 或 IMPORTED_MONTH_END。 | 解释覆盖范围。 | CHECK count_type IN ('FULL','CYCLE','SPOT','IMPORTED_MONTH_END') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `FULL` | scm_inventory_count.count_type 只表示本字段说明中的 盘点类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `status` | 盘点状态 | `text` | 非空; 默认 — | DRAFT、SUBMITTED、APPROVED、REJECTED 或 SUPERSEDED。 | 只有 APPROVED 进入库存余额。 | CHECK status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','SUPERSEDED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `APPROVED` | scm_inventory_count.status 只表示本字段说明中的 盘点状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准盘点的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 盘点获批时间。 | 审计。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-09-01T09:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `note` | 盘点说明 | `text` | 可空; 默认 — | 范围、异常或来源说明。 | 解释抽样和差异。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `月末全盘` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_inventory_count_line` — 库存盘点行

- **用途：** 保存盘点时每种原料的实盘数量、批次和效期。
- **一行代表：** 盘点单 × 原料 × 可选批号一行
- **写入责任：** 仓库或门店库存流程
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 盘点记录
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 保存盘点时每种原料的实盘数量、批次和效期。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `inventory_count_id` → `scm_inventory_count.inventory_count_id`；`material_id` → `scm_material.material_id`；`raw_unit_id` → `app_unit.unit_id`；`material_unit_conversion_id` → `scm_material_unit_conversion.material_unit_conversion_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_scm_inventory_balance`
- **唯一约束：** inventory_count_id + material_id + lot_code [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** raw_quantity/raw_unit 保留来源原值，counted_quantity 是按当次批准换算与舍入规则形成、随后用于库存调整的正式基础单位数量；它属于获批盘点结果而非随当前换算表变化的缓存。conversion_factor_snapshot 让两者可核对。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `inventory_count_line_id` | 盘点行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条库存盘点行稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `bf95579b-f47a-592a-9f86-14301c7d698b` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `inventory_count_id` | 盘点单ID | `uuid` | 非空; 默认 — | 所属盘点单。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_inventory_count.inventory_count_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f2554157-a273-5ba5-a23c-2a05faa5c8a6` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `material_id` | 原料ID | `uuid` | 非空; 默认 — | 被盘点统一原料。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `lot_code` | 批号 | `text` | 可空; 默认 — | 批次追踪物料的供应商或内部批号。 | 效期和召回追踪。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `LOT-20260715-A` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `expiry_date` | 到期日期 | `date` | 可空; 默认 — | 该批原料到期日期。 | FEFO和报废预警。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2027-07-15` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `counted_quantity` | 实盘数量 | `numeric(18,6)` | 非空; 默认 — | 按 material.base_unit 归一化的盘点数量。 | 库存余额事实。 | CHECK counted_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `12500` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 7 | `raw_quantity` | 来源数量 | `numeric(18,6)` | 可空; 默认 — | 盘点表原始数量。 | 保留换算前证据。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2.5` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `raw_unit_text` | 来源原始单位文本 | `text` | 可空; 默认 — | 盘点来源原样提供的单位文本。 | 在单位未映射时仍保留证据；不得直接参与计算。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `kg` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `raw_unit_id` | 原始单位ID | `uuid` | 可空; 默认 — | 原始单位确认后对应的受控单位；未映射时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `27ea2bb4-6528-53ce-879e-3940a316ce53` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `material_unit_conversion_id` | 物料单位换算ID | `uuid` | 可空; 默认 — | 将原始单位换算到物料基础单位采用的已核验换算；全局单位换算可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material_unit_conversion.material_unit_conversion_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f9de28ad-8c05-5f0b-8036-b52fad4439cb` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `conversion_factor_snapshot` | 换算系数快照 | `numeric(24,12)` | 可空; 默认 — | 本次盘点实际使用的 raw_unit_id 到基础单位系数。 | 使历史盘点不受换算主数据后续版本变化影响。 | CHECK conversion_factor_snapshot IS NULL OR conversion_factor_snapshot > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1000.000000000000` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | COMPLETE、UNIT_UNMAPPED、MATERIAL_UNMAPPED 或 REJECTED。 | 不完整行进入质量队列。 | CHECK quality_status IN ('COMPLETE','UNIT_UNMAPPED','MATERIAL_UNMAPPED','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `COMPLETE` | scm_inventory_count_line.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_inventory_movement` — 库存移动单

- **用途：** 记录收货、领用、生产消耗、调整、报废或地点转移的一次库存事件。
- **一行代表：** 一个业务库存事件一行
- **写入责任：** 供应链库存服务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** PO收货、生产、盘点调整或人工批准
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 记录收货、领用、生产消耗、调整、报废或地点转移的一次库存事件。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 永久保留；已过账事件不更新数量，错误用冲销事件
- **向外连接：** `from_location_id` → `ops_location.location_id`；`to_location_id` → `ops_location.location_id`；`goods_receipt_id` → `scm_goods_receipt.goods_receipt_id`；`production_run_id` → `ops_production_run.production_run_id`；`inventory_count_id` → `scm_inventory_count.inventory_count_id`；`reverses_movement_id` → `scm_inventory_movement.inventory_movement_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `scm_inventory_movement.reverses_movement_id`；`scm_inventory_movement_line.inventory_movement_id`
- **分析视图：** `v_scm_inventory_balance`
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** from_location_id IS NOT NULL OR to_location_id IS NOT NULL；from_location_id IS NULL OR to_location_id IS NULL OR from_location_id <> to_location_id；num_nonnulls(goods_receipt_id, production_run_id, inventory_count_id) <= 1；movement_type <> 'RECEIPT' OR goods_receipt_id IS NOT NULL；movement_type <> 'PRODUCTION_CONSUMPTION' OR production_run_id IS NOT NULL；num_nonnulls(goods_receipt_id, production_run_id, inventory_count_id, manual_reason_code) >= 1
- **特别说明：** 删除 source_object_type/source_object_id 多态文本。DRAFT 可编辑；POSTED、REVERSED 或 REJECTED 后单头和行冻结。成品配送不直接作为物料库存来源，除非未来业务确认同一库存账确实管理成品。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `inventory_movement_id` | 库存移动ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次库存移动稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `57028256-80b5-50af-a22f-1e371864833d` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `from_location_id` | 发出地点ID | `uuid` | 可空; 默认 — | 库存减少地点；外部入库时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `77f31b24-36f5-5ee1-87f7-be46d3e61aed` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `to_location_id` | 接收地点ID | `uuid` | 可空; 默认 — | 库存增加地点；消耗或报废时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `65c0f94a-9db6-55cb-afad-69d11d70d100` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `movement_type` | 移动类型 | `text` | 非空; 默认 — | RECEIPT、TRANSFER、PRODUCTION_CONSUMPTION、ADJUSTMENT、WASTE 或 RETURN。 | 决定数量正负和来源要求。 | CHECK movement_type IN ('RECEIPT','TRANSFER','PRODUCTION_CONSUMPTION','ADJUSTMENT','WASTE','RETURN') | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `RECEIPT` | scm_inventory_movement.movement_type 只表示本字段说明中的 移动类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `goods_receipt_id` | 收货单ID | `uuid` | 可空; 默认 — | 收货触发库存增加时对应的明确收货单。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_goods_receipt.goods_receipt_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `6f0b541c-a936-5a5d-8b2f-a9e18fde3b41` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `production_run_id` | 生产运行ID | `uuid` | 可空; 默认 — | 生产领料或消耗触发库存减少时对应的明确生产运行；只有生产执行与采购库存两个扩展包同时启用后才允许写入并创建外键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | 延期FK → ops_production_run.production_run_id；激活=EXTENSION_PACK:PROCUREMENT_AND_INVENTORY+PRODUCTION_EXECUTION | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `3dda38c0-ed06-51d0-be35-80d796c36312` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 该列在 EXTENSION_PACK:PROCUREMENT_AND_INVENTORY+PRODUCTION_EXECUTION 未完整启用前必须为 NULL，届时也不得提前创建外键。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `inventory_count_id` | 盘点单ID | `uuid` | 可空; 默认 — | 批准盘点产生调整时对应的明确盘点单。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_inventory_count.inventory_count_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `f2554157-a273-5ba5-a23c-2a05faa5c8a6` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `manual_reason_code` | 人工事件原因代码 | `text` | 可空; 默认 — | TRANSFER、WASTE、RETURN、EMERGENCY_ADJUSTMENT 或 OTHER 等受控原因。 | 没有上游业务单据时仍说明为何发生，并由创建账号审计。 | CHECK manual_reason_code IS NULL OR manual_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$' | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `WASTE` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `occurred_at` | 发生时间 | `timestamptz` | 非空; 默认 — | 库存实际发生变化的时间。 | 按时点重建库存。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-10T09:30:00+08:00` | scm_inventory_movement.occurred_at 只表示本字段说明中的 发生时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 库存事件归属营业日。 | 与生产和销售连接。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-10` | 不要由 created_at 或 UTC 日期临时推导。 |
| 11 | `status` | 状态 | `text` | 非空; 默认 — | DRAFT、POSTED、REVERSED 或 REJECTED。 | 只有 POSTED 进入余额；更正用反向事件。 | CHECK status IN ('DRAFT','POSTED','REVERSED','REJECTED') | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `POSTED` | scm_inventory_movement.status 只表示本字段说明中的 状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `reverses_movement_id` | 冲销移动ID | `uuid` | 可空; 默认 — | 本事件冲销的原库存移动。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_inventory_movement.inventory_movement_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `64b6b158-1e2c-5d86-9620-ec8cc9d0edb8` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 15 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_inventory_movement_line` — 库存移动行

- **用途：** 保存库存事件中每种原料、批号和数量。
- **一行代表：** 库存移动单 × 原料 × 可选批号一行
- **写入责任：** 供应链库存服务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 对应业务来源行
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 保存库存事件中每种原料、批号和数量。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `inventory_movement_id` → `scm_inventory_movement.inventory_movement_id`；`material_id` → `scm_material.material_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_scm_inventory_balance`
- **唯一约束：** inventory_movement_id + material_id + lot_code [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `inventory_movement_line_id` | 库存移动行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条库存移动行稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `28ae6774-4aaa-5880-aae3-7449526c00f9` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `inventory_movement_id` | 库存移动ID | `uuid` | 非空; 默认 — | 所属库存移动事件。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_inventory_movement.inventory_movement_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `57028256-80b5-50af-a22f-1e371864833d` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `material_id` | 原料ID | `uuid` | 非空; 默认 — | 发生数量变化的统一原料。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `lot_code` | 批号 | `text` | 可空; 默认 — | 批次追踪物料的批号。 | 库存和召回。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `LOT-20260715-A` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `expiry_date` | 到期日期 | `date` | 可空; 默认 — | 该批物料到期日。 | FEFO。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2027-07-15` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `quantity` | 移动数量 | `numeric(18,6)` | 非空; 默认 — | 按基础单位记录的正数量；方向由单头 from/to 和类型决定。 | 避免同一字段混用正负语义。 | CHECK quantity > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `5000` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 7 | `unit_cost` | 移动单位成本 | `numeric(18,6)` | 可空; 默认 — | 移动时确认的基础单位成本；无法确认可为空。 | 库存价值和差异分析。 | CHECK unit_cost IS NULL OR unit_cost >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `0.085` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | unit_cost 币种。 | 保证价值计算。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | scm_inventory_movement_line.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_material_requirement_run` — 原料需求计算运行

- **用途：** 把已发布生产计划按生效配方展开成原料需求，并冻结输入版本。
- **一行代表：** 地点 × 计划营业日 × 一次需求计算一行
- **写入责任：** BakeryOps供应链任务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 已发布预估单和配方版本
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 把已发布生产计划按生效配方展开成原料需求，并冻结输入版本。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `job_run_id` → `app_job_run.job_run_id`；`location_id` → `ops_location.location_id`；`production_plan_version_id` → `ops_production_plan_version.production_plan_version_id`
- **被谁连接：** `scm_material_requirement_component.material_requirement_run_id`；`scm_replenishment_run.material_requirement_run_id`
- **分析视图：** `v_scm_material_requirement_line`、`v_scm_material_requirement_trace`
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** RUNNING 阶段只允许任务服务更新状态和运行元数据；进入 SUCCEEDED、PARTIAL、FAILED 或 REJECTED 后整次运行冻结，重算必须新增 run。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `material_requirement_run_id` | 需求运行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次原料需求计算稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `870d6837-36b3-54e9-ba47-301f4533c5f6` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `job_run_id` | 任务运行ID | `uuid` | 非空; 默认 — | 执行计算的自动任务。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 需求地点ID | `uuid` | 非空; 默认 — | 原料被消耗或需要备货的地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `production_plan_version_id` | 预估单版本ID | `uuid` | 非空; 默认 — | 需求采用的已发布计划版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_production_plan_version.production_plan_version_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `d945b30e-2375-5023-84db-ba7b76a30afe` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `requirement_date` | 需求日期 | `date` | 非空; 默认 — | 原料需可用的营业日期。 | 补货和采购到货目标。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-10` | scm_material_requirement_run.requirement_date 只表示本字段说明中的 需求日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `calculation_version` | 计算版本 | `text` | 非空; 默认 — | 配方展开、损耗和单位换算算法版本。 | 复现需求。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `mrp-v2` | scm_material_requirement_run.calculation_version 只表示本字段说明中的 计算版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `input_manifest` | 输入清单 | `jsonb` | 非空; 默认 — | 计划版本、配方版本、单位换算和规则版本。 | 完整血缘。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `{"plan_version":"..."}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 8 | `status` | 运行状态 | `text` | 非空; 默认 — | RUNNING、SUCCEEDED、PARTIAL、FAILED 或 REJECTED。 | PARTIAL 不得自动形成正式 PO。 | CHECK status IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED','REJECTED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `SUCCEEDED` | scm_material_requirement_run.status 只表示本字段说明中的 运行状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 10 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_material_requirement_component` — 原料需求组成血缘

- **用途：** 逐项保留需求运行中每个计划产品行展开出的一个原料贡献或一个明确质量阻断；原料总需求只从这些最细行汇总。
- **一行代表：** 需求运行 × 计划产品行 × 展开序号一行
- **写入责任：** BakeryOps供应链任务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 配方展开明细或质量阻断
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** planned product quantity -> immutable ops_production_plan_line；material total/base unit/quality summary -> v_scm_material_requirement_line
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 逐项保留需求运行中每个计划产品行展开出的一个原料贡献或一个明确质量阻断；原料总需求只从这些最细行汇总。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `material_requirement_run_id` → `scm_material_requirement_run.material_requirement_run_id`；`production_plan_line_id` → `ops_production_plan_line.production_plan_line_id`；`material_id` → `scm_material.material_id`；`recipe_component_id` → `cost_card_recipe_component.recipe_component_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_scm_material_requirement_line`、`v_scm_material_requirement_trace`
- **唯一约束：** material_requirement_run_id + production_plan_line_id + component_index
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** quality_status <> 'COMPLETE' OR (material_id IS NOT NULL AND recipe_component_id IS NOT NULL AND material_quantity IS NOT NULL)
- **特别说明：** scm_material_requirement_line 不再物理保存：gross_required_quantity、base_unit_id、quality_status 和组成行数都由本表与 material 主档派生。planned_product_quantity 也不复制，本行经 production_plan_line_id 读取已冻结计划量；只保存算法实际输出的 material_quantity、采用组件和阻断证据。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `material_requirement_component_id` | 需求组成ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条需求组成稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `8909b562-2d4d-5647-9be0-c90bb22be96b` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `material_requirement_run_id` | 需求运行ID | `uuid` | 非空; 默认 — | 所属需求计算运行。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material_requirement_run.material_requirement_run_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `870d6837-36b3-54e9-ba47-301f4533c5f6` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `production_plan_line_id` | 计划产品行ID | `uuid` | 非空; 默认 — | 产生需求的产品计划行。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_production_plan_line.production_plan_line_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `747a7590-ebe9-5a77-bc6c-c9769d1aff93` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `component_index` | 展开序号 | `integer` | 非空; 默认 — | 同一运行和计划行内从 1 递增的展开项序号；质量阻断也占一行。 | 稳定区分多个配方组件和无组件错误行。 | CHECK component_index > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1` | scm_material_requirement_component.component_index 只表示本字段说明中的 展开序号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `material_id` | 原料ID | `uuid` | 可空; 默认 — | 成功展开时得到的统一原料；缺配方或缺映射时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `recipe_component_id` | 配方组件ID | `uuid` | 可空; 默认 — | 实际采用的配方组件版本；缺配方或无法定位组件时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → cost_card_recipe_component.recipe_component_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `a23230e6-bc8a-5c55-9b0c-b0e081e2bec0` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `material_quantity` | 贡献原料数量 | `numeric(18,6)` | 可空; 默认 — | 该计划行和配方组件贡献的物料基础单位数量；质量阻断行为空。 | 按运行和 material_id 汇总得到毛需求。 | CHECK material_quantity IS NULL OR material_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `4800` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | COMPLETE、MISSING_RECIPE、MISSING_MAPPING、UNIT_ERROR 或 REJECTED。 | 任何非 COMPLETE 行都阻断该运行自动形成正式订货。 | CHECK quality_status IN ('COMPLETE','MISSING_RECIPE','MISSING_MAPPING','UNIT_ERROR','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `COMPLETE` | scm_material_requirement_component.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `warning_detail` | 质量说明 | `jsonb` | 非空; 默认 '{}'::jsonb | 缺配方、缺映射、单位错误或拒绝原因的结构化明细。 | 即使无法产生 material_id 也保留问题事实。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `{}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 10 | `calculation_detail` | 计算细节 | `jsonb` | 非空; 默认 '{}'::jsonb | 批产量、净得率、损耗和单位换算。 | 精确解释数量。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `{"loss_rate":0.02}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_replenishment_run` — 补货建议运行

- **用途：** 把原料需求、可用库存、在途、安全量、MOQ和提前期转换为建议订货。
- **一行代表：** 地点 × 需求日期 × 一次补货计算一行
- **写入责任：** BakeryOps供应链任务
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 原料需求、库存、PO和供应商条件
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 把原料需求、可用库存、在途、安全量、MOQ和提前期转换为建议订货。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `job_run_id` → `app_job_run.job_run_id`；`location_id` → `ops_location.location_id`；`material_requirement_run_id` → `scm_material_requirement_run.material_requirement_run_id`
- **被谁连接：** `scm_replenishment_line.replenishment_run_id`
- **分析视图：** `v_scm_material_requirement_reconciliation`、`v_scm_replenishment_trace`
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** RUNNING 阶段只允许任务服务更新；任何终态后冻结输入清单和结果，算法或输入变化必须新增 replenishment_run。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `replenishment_run_id` | 补货运行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次补货计算稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `71b0bd1c-d9d9-553d-82b7-a9c4540a2cd9` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `job_run_id` | 任务运行ID | `uuid` | 非空; 默认 — | 执行计算的自动任务。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 补货地点ID | `uuid` | 非空; 默认 — | 需要获得库存的地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `material_requirement_run_id` | 需求运行ID | `uuid` | 非空; 默认 — | 补货采用的原料需求计算。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material_requirement_run.material_requirement_run_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `870d6837-36b3-54e9-ba47-301f4533c5f6` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `target_date` | 目标日期 | `date` | 非空; 默认 — | 原料需要可用的日期。 | 计算提前期。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-10` | scm_replenishment_run.target_date 只表示本字段说明中的 目标日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `calculation_version` | 计算版本 | `text` | 非空; 默认 — | 安全量、在途和取整算法版本。 | 复现建议。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `replenishment-v2` | scm_replenishment_run.calculation_version 只表示本字段说明中的 计算版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `input_manifest` | 输入清单 | `jsonb` | 非空; 默认 — | 库存盘点、已过账移动、在途 PO 和规则版本。 | 解释建议差异。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `{"inventory_count":"..."}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 8 | `status` | 运行状态 | `text` | 非空; 默认 — | RUNNING、SUCCEEDED、PARTIAL、FAILED 或 REJECTED。 | 质量门禁。 | CHECK status IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED','REJECTED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `SUCCEEDED` | scm_replenishment_run.status 只表示本字段说明中的 运行状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 10 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_replenishment_line` — 补货建议行

- **用途：** 保存原料建议量、批准量、库存构成、MOQ取整和调整原因。
- **一行代表：** 补货运行 × 原料 × 供应商商品版本候选一行
- **写入责任：** BakeryOps计算；采购人员批准
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 补货计算和人工审批
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_WORKFLOW` — 只允许批准的状态机迁移并记录操作者和时间
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** approved minus suggested delta -> v_scm_replenishment_trace
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 保存原料建议量、批准量、库存构成、MOQ取整和调整原因。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `replenishment_run_id` → `scm_replenishment_run.replenishment_run_id`；`material_id` → `scm_material.material_id`；`supplier_item_id` → `scm_supplier_item.supplier_item_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `scm_purchase_order_line.replenishment_line_id`
- **分析视图：** `v_scm_material_requirement_reconciliation`、`v_scm_replenishment_trace`
- **唯一约束：** replenishment_run_id + material_id + supplier_item_id [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** status NOT IN ('APPROVED','ORDERED') OR (approved_quantity IS NOT NULL AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)；approved_quantity IS NULL OR approved_quantity = suggested_quantity OR adjustment_reason_code IS NOT NULL
- **特别说明：** 需求、库存、在途、安全量和 suggested_quantity 是该算法运行的冻结输入/输出，不是当前库存镜像；人工只填写批准量、原因和审批信息。delta_quantity 由 v_scm_replenishment_trace 计算。进入 ORDERED 后冻结。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `replenishment_line_id` | 补货行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条补货建议稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `e3929fb4-9239-5b11-927e-43f168fc6426` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `replenishment_run_id` | 补货运行ID | `uuid` | 非空; 默认 — | 所属补货计算。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_replenishment_run.replenishment_run_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `71b0bd1c-d9d9-553d-82b7-a9c4540a2cd9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `material_id` | 原料ID | `uuid` | 非空; 默认 — | 需要补货的统一原料。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `supplier_item_id` | 供应商商品ID | `uuid` | 可空; 默认 — | 建议采用的有效供应商SKU、物料和包装版本；未选定时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_supplier_item.supplier_item_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `c5661f44-564f-5b4e-bdb9-8563d4a8702f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `required_quantity` | 需求量 | `numeric(18,6)` | 非空; 默认 — | 来自原料需求的基础单位数量。 | 补货公式起点。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `12500` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 6 | `available_quantity` | 可用库存 | `numeric(18,6)` | 非空; 默认 — | 按 material.base_unit 冻结的批准盘点加已过账移动可用量。 | 从需求中扣除。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `4000` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 7 | `in_transit_quantity` | 在途数量 | `numeric(18,6)` | 非空; 默认 — | 按 material.base_unit 冻结的已批准且未完成收货 PO 数量。 | 避免重复订货。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2000` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `safety_quantity` | 安全量 | `numeric(18,6)` | 非空; 默认 0 | 按 material.base_unit 保存的批准规则额外缓冲量。 | 应对波动。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `1000` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 9 | `suggested_quantity` | 建议量 | `numeric(18,6)` | 非空; 默认 — | 公式计算并按包装/MOQ取整后的基础单位数量。 | 采购审批建议。 | CHECK suggested_quantity >= 0 | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `8000` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 10 | `approved_quantity` | 批准量 | `numeric(18,6)` | 可空; 默认 — | 采购人员最终按 material.base_unit 批准的数量。 | PO 行采用前再按 supplier_item 包装单位换算。 | CHECK approved_quantity IS NULL OR approved_quantity >= 0 | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `10000` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `adjustment_reason_code` | 调整原因代码 | `text` | 可空; 默认 — | MOQ、SUPPLIER_CAPACITY、MARKET_PRICE、STORAGE_LIMIT、JUDGEMENT 或 OTHER。 | 说明批准量变化。 | CHECK adjustment_reason_code IS NULL OR adjustment_reason_code IN ('MOQ','SUPPLIER_CAPACITY','MARKET_PRICE','STORAGE_LIMIT','JUDGEMENT','OTHER') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `MOQ` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `status` | 审批状态 | `text` | 非空; 默认 'SUGGESTED' | SUGGESTED、APPROVED、REJECTED 或 ORDERED。 | 只有 APPROVED 可生成 PO。 | CHECK status IN ('SUGGESTED','APPROVED','REJECTED','ORDERED') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `APPROVED` | scm_replenishment_line.status 只表示本字段说明中的 审批状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准订货量的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 批准订货量时间。 | 审计和提前期。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T11:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 17 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_purchase_order_revision` — 采购订单版本

- **用途：** 直接保留某采购单号每次草稿、审批、发送、供应商确认或取消，不再另建空壳采购主单。
- **一行代表：** 采购单号 × 版本号一行
- **写入责任：** 采购流程；审批人改变状态
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 补货批准或上一版本
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** header/line reconciliation -> v_scm_purchase_order_reconciliation
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE; R6_MERGE_INTO: absorb scm_purchase_order; purchase_order_code groups immutable supplier-confirmed revisions
- **为何存表而不是现算视图：** 直接保留某采购单号每次草稿、审批、发送、供应商确认或取消，不再另建空壳采购主单。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `supplier_id` → `scm_supplier.supplier_id`；`deliver_to_location_id` → `ops_location.location_id`；`based_on_revision_id` → `scm_purchase_order_revision.purchase_order_revision_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `scm_goods_receipt.purchase_order_revision_id`；`scm_purchase_order_line.purchase_order_revision_id`；`scm_purchase_order_revision.based_on_revision_id`
- **分析视图：** `v_scm_replenishment_trace`、`v_scm_purchase_order_reconciliation`、`v_business_timeline`
- **唯一约束：** purchase_order_code + revision_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** abs(total_amount - subtotal_amount - tax_amount) <= 0.01
- **特别说明：** R6 终审将 scm_purchase_order 合并到本表：没有业务事实应只引用抽象采购主单，收货必须指向供应商确认的具体版本。DRAFT 可编辑；提交审批后仅允许受控状态迁移。SENT、CONFIRMED、REJECTED、CANCELLED 或 SUPERSEDED 后本版本及其行冻结。已发送前的内容调整新增 revision_no；一旦任一版本已发送，变更供应商、交付地点或币种必须使用新 purchase_order_code，不能冒充原单修订。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `purchase_order_revision_id` | 采购版本ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版采购单稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `cae73af4-ea40-5fd8-8fff-0cb73c3fc954` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `purchase_order_code` | 采购单号 | `text` | 非空; 默认 — | 跨版本稳定且不可复用的企业采购单号。 | 与 revision_no 共同选择版本；供应商沟通和财务核对使用该代码。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `PO-20260809-001` | scm_purchase_order_revision.purchase_order_code 只表示本字段说明中的 采购单号；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `supplier_id` | 供应商ID | `uuid` | 非空; 默认 — | 本版本下单供应商；变更供应商必须生成新版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_supplier.supplier_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `e371d1ab-adb0-5313-9194-bda119e8f5ba` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `deliver_to_location_id` | 交付地点ID | `uuid` | 非空; 默认 — | 本版本要求送达的门店、厨房或仓库。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `67030580-325e-55a5-b4de-3f86cba58230` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `based_on_revision_id` | 基础版本ID | `uuid` | 可空; 默认 — | 本版从哪一版本修改。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_purchase_order_revision.purchase_order_revision_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `6440c2fe-a99a-5e9f-9605-ab1e5852afcd` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `revision_no` | 版本号 | `integer` | 非空; 默认 — | 采购单内递增版本。 | 排序和供应商确认。 | CHECK revision_no > 0 | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2` | scm_purchase_order_revision.revision_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 本版采购单全部行金额采用的 ISO 4217 币种。 | 行单价和单据合计统一解释；不同币种必须拆成不同采购单。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `MYR` | scm_purchase_order_revision.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `order_date` | 下单日期 | `date` | 可空; 默认 — | 本版正式下单日期。 | 采购期间归属。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-09` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `expected_delivery_date` | 预计到货日 | `date` | 可空; 默认 — | 供应商确认的预计交付日期。 | 在途和缺货风险。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-11` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `status` | 版本状态 | `text` | 非空; 默认 — | DRAFT、SUBMITTED、APPROVED、SENT、CONFIRMED、SUPERSEDED、REJECTED 或 CANCELLED。 | 只有批准/发送版本可收货。 | CHECK status IN ('DRAFT','SUBMITTED','APPROVED','SENT','CONFIRMED','SUPERSEDED','REJECTED','CANCELLED') | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `CONFIRMED` | scm_purchase_order_revision.status 只表示本字段说明中的 版本状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `subtotal_amount` | 未税小计 | `numeric(18,4)` | 非空; 默认 — | 本版所有行未税金额之和。 | 与行金额和财务核对。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `1250.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 12 | `tax_amount` | 税额 | `numeric(18,4)` | 非空; 默认 0 | 本版税额。 | 财务核对。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `0` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 13 | `total_amount` | 总金额 | `numeric(18,4)` | 非空; 默认 — | 本版最终应付总额。 | 现金流和财务采购核对。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `1250.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 14 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准本版本的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 本版本获批时间。 | 审计。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-09T12:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `sent_at` | 发送时间 | `timestamptz` | 可空; 默认 — | 版本正式发送给供应商的时间。 | 供应商响应和提前期。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-09T12:05:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 19 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_purchase_order_line` — 采购订单行

- **用途：** 保存采购版本中已确认的供应商商品版本、订购包装数量、单位价格和来源补货行。
- **一行代表：** 采购版本 × 供应商商品版本一行
- **写入责任：** 采购流程
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 批准补货或人工添加
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** base unit quantity -> order quantity × unit conversion；line currency -> referenced purchase-order revision
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 保存采购版本中已确认的供应商商品版本、订购包装数量、单位价格和来源补货行。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `purchase_order_revision_id` → `scm_purchase_order_revision.purchase_order_revision_id`；`supplier_item_id` → `scm_supplier_item.supplier_item_id`；`replenishment_line_id` → `scm_replenishment_line.replenishment_line_id`；`order_unit_id` → `app_unit.unit_id`；`material_unit_conversion_id` → `scm_material_unit_conversion.material_unit_conversion_id`
- **被谁连接：** `scm_goods_receipt_line.purchase_order_line_id`；`scm_supplier_price_observation.purchase_order_line_id`
- **分析视图：** `v_scm_replenishment_trace`、`v_scm_purchase_order_reconciliation`、`v_finance_purchase_reconciliation`
- **唯一约束：** purchase_order_revision_id + supplier_item_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 基础单位总数量不重复保存；由 order_quantity 与 material_unit_conversion_id 的冻结系数确定性派生。币种直接读取采购版本，不在行上复制。line_amount 仍保留，因为它是经批准并发送给供应商的舍入后单据行金额快照，必须由采购核对视图持续验证。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `purchase_order_line_id` | 采购行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条采购版本行稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e05036e6-f8aa-548f-aab7-7858367302a3` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `purchase_order_revision_id` | 采购版本ID | `uuid` | 非空; 默认 — | 所属采购订单版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_purchase_order_revision.purchase_order_revision_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `cae73af4-ea40-5fd8-8fff-0cb73c3fc954` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `supplier_item_id` | 供应商商品ID | `uuid` | 非空; 默认 — | 采购采用的供应商SKU、物料和包装有效版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_supplier_item.supplier_item_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `c5661f44-564f-5b4e-bdb9-8563d4a8702f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `replenishment_line_id` | 补货建议行ID | `uuid` | 可空; 默认 — | 该行来源的批准补货；纯人工采购可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_replenishment_line.replenishment_line_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e3929fb4-9239-5b11-927e-43f168fc6426` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `order_quantity` | 订购数量 | `numeric(18,4)` | 非空; 默认 — | 按 supplier_item.order_unit 的数量。 | 供应商订单事实。 | CHECK order_quantity > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 6 | `order_unit_id` | 订购单位ID | `uuid` | 非空; 默认 — | 本次下单采用的受控单位快照。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `cf4ff92b-aa99-5ca0-b359-a901d8472c8f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 7 | `material_unit_conversion_id` | 物料单位换算ID | `uuid` | 可空; 默认 — | 本行将订购单位换算到基础单位采用的已核验规格。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material_unit_conversion.material_unit_conversion_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f9de28ad-8c05-5f0b-8036-b52fad4439cb` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `unit_price` | 订购单位价格 | `numeric(18,6)` | 非空; 默认 — | 每 order_unit 的确认价格。 | 采购金额和价格观察。 | CHECK unit_price >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `625.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 9 | `line_amount` | 行金额 | `numeric(18,4)` | 非空; 默认 — | order_quantity × unit_price 按批准舍入得到。 | 与采购单小计核对。 | CHECK line_amount >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1250.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 10 | `note` | 采购行备注 | `text` | 可空; 默认 — | 替代规格或供应商确认说明。 | 必要例外。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `同品牌新包装` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_goods_receipt` — 采购收货单

- **用途：** 记录针对供应商确认采购版本的一次实际到货、验收和入库。
- **一行代表：** 采购版本 × 一次收货一行
- **写入责任：** 仓库或门店收货流程
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 现场验收或WMS
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 记录针对供应商确认采购版本的一次实际到货、验收和入库。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `purchase_order_revision_id` → `scm_purchase_order_revision.purchase_order_revision_id`；`location_id` → `ops_location.location_id`；`received_by_employment_id` → `hr_employment.employment_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `scm_goods_receipt_line.goods_receipt_id`；`scm_inventory_movement.goods_receipt_id`
- **分析视图：** `v_finance_purchase_reconciliation`、`v_business_timeline`
- **唯一约束：** receipt_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 收货头直接引用具体 purchase_order_revision_id；实施迁移必须创建可延迟约束触发器，逐行确认 goods_receipt_line.purchase_order_line_id 所属版本等于本头 purchase_order_revision_id，禁止把不同采购版本混在一张收货单。为保持最小粒度，不在收货行重复保存 purchase_order_revision_id。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `goods_receipt_id` | 收货单ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次采购收货稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `6f0b541c-a936-5a5d-8b2f-a9e18fde3b41` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `purchase_order_revision_id` | 采购版本ID | `uuid` | 非空; 默认 — | 供应商实际履约的 SENT 或 CONFIRMED 采购版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_purchase_order_revision.purchase_order_revision_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `cae73af4-ea40-5fd8-8fff-0cb73c3fc954` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 收货地点ID | `uuid` | 非空; 默认 — | 实际收货地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `receipt_code` | 收货单号 | `text` | 非空; 默认 — | 企业内部唯一可读收货编号。 | 现场和财务沟通。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `GR-20260811-001` | scm_goods_receipt.receipt_code 只表示本字段说明中的 收货单号；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `supplier_delivery_note` | 供应商送货单号 | `text` | 可空; 默认 — | 供应商提供的送货文件编号。 | 发票和采购核对。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `DO-99812` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `received_at` | 收货时间 | `timestamptz` | 非空; 默认 — | 货物实际到达并开始验收的时间。 | 交付及时率和价格生效。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-11T10:30:00+08:00` | scm_goods_receipt.received_at 只表示本字段说明中的 收货时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `status` | 收货状态 | `text` | 非空; 默认 — | DRAFT、POSTED、PARTIAL、REJECTED 或 REVERSED。 | 只有 POSTED/PARTIAL 生成库存移动。 | CHECK status IN ('DRAFT','POSTED','PARTIAL','REJECTED','REVERSED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `POSTED` | scm_goods_receipt.status 只表示本字段说明中的 收货状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `received_by_employment_id` | 收货员工雇佣ID | `uuid` | 可空; 默认 — | 现场确认收货的员工。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_employment.employment_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `f9df2da3-6c89-5dfc-8238-b77102642de9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `note` | 收货说明 | `text` | 可空; 默认 — | 异常、温度或文件说明。 | 解释拒收和差异。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `外箱一处破损` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 12 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_goods_receipt_line` — 采购收货行

- **用途：** 保存每个采购行的实收、拒收、批号、效期和实际价格。
- **一行代表：** 收货单 × 采购行 × 可选批号一行
- **写入责任：** 仓库或门店收货流程
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 现场验收
- **实施层级：** `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 保存每个采购行的实收、拒收、批号、效期和实际价格。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `goods_receipt_id` → `scm_goods_receipt.goods_receipt_id`；`purchase_order_line_id` → `scm_purchase_order_line.purchase_order_line_id`；`material_id` → `scm_material.material_id`
- **被谁连接：** `scm_supplier_price_observation.goods_receipt_line_id`
- **分析视图：** `v_scm_replenishment_trace`、`v_finance_purchase_reconciliation`
- **唯一约束：** goods_receipt_id + purchase_order_line_id + lot_code [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `goods_receipt_line_id` | 收货行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条收货明细稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `04cf9005-afa7-5bcc-98b7-53c51b827abd` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `goods_receipt_id` | 收货单ID | `uuid` | 非空; 默认 — | 所属收货单。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_goods_receipt.goods_receipt_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `6f0b541c-a936-5a5d-8b2f-a9e18fde3b41` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `purchase_order_line_id` | 采购行ID | `uuid` | 非空; 默认 — | 对应采购订单行。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_purchase_order_line.purchase_order_line_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e05036e6-f8aa-548f-aab7-7858367302a3` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `material_id` | 原料ID | `uuid` | 非空; 默认 — | 实收统一原料，必须与供应商 SKU 已确认映射一致。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `lot_code` | 批号 | `text` | 可空; 默认 — | 供应商批号。 | 召回和效期。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `LOT-20260801-A` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `expiry_date` | 到期日期 | `date` | 可空; 默认 — | 该批原料到期日。 | FEFO和验收。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2027-08-01` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `received_order_quantity` | 实收订购单位数 | `numeric(18,4)` | 非空; 默认 — | 按 PO order_unit 的实收数量。 | 供应商履约。 | CHECK received_order_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `accepted_base_quantity` | 合格基础量 | `numeric(18,6)` | 非空; 默认 — | 按 material.base_unit 的合格入库量。 | 库存增加。 | CHECK accepted_base_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `9800` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 9 | `rejected_base_quantity` | 拒收基础量 | `numeric(18,6)` | 非空; 默认 0 | 按 material.base_unit 记录的验收不合格数量。 | 供应商质量和采购差异。 | CHECK rejected_base_quantity >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `200` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 10 | `actual_unit_price` | 实际订购单位价 | `numeric(18,6)` | 非空; 默认 — | 收货或发票确认的每 order_unit 实际价格。 | 形成市场采购价观察和成本来源。 | CHECK actual_unit_price >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `630.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 11 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 实际价格币种。 | 价格归一化。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | scm_goods_receipt_line.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `variance_reason` | 数量价格差异原因 | `text` | 可空; 默认 — | 短收、拒收、涨价或替代规格原因。 | 采购复盘。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `PRICE_INCREASE` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `scm_supplier_price_observation` — 供应商市场价观察

- **用途：** 沉淀报价、PO或收货形成的原始和归一化采购价，供成本卡选择生效价格。
- **一行代表：** 供应商商品 × 观察时间 × 来源记录一行
- **写入责任：** 采购或收货流程
- **读取项目：** BakeryOps、财务网站、分析/BI
- **数据来源：** 供应商报价、PO或实际收货
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `PARTIAL_FIELDS_DERIVED_IN_VIEW`
- **可派生字段/输出：** normalized_price_myr -> raw price × FX rate ÷ unit conversion
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 沉淀报价、PO或收货形成的原始和归一化采购价，供成本卡选择生效价格。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `supplier_item_id` → `scm_supplier_item.supplier_item_id`；`source_system_id` → `app_source_system.source_system_id`；`goods_receipt_line_id` → `scm_goods_receipt_line.goods_receipt_line_id`；`purchase_order_line_id` → `scm_purchase_order_line.purchase_order_line_id`；`raw_price_unit_id` → `app_unit.unit_id`；`material_unit_conversion_id` → `scm_material_unit_conversion.material_unit_conversion_id`；`verified_by_user_id` → `app_user.user_id`
- **被谁连接：** `cost_card_material_price.supplier_price_observation_id`
- **分析视图：** `v_scm_supplier_price_current`
- **唯一约束：** source_system_id + source_record_id [NULLS DISTINCT：仅非空值去重，允许多条空值]；goods_receipt_line_id + observation_type [NULLS DISTINCT：仅非空值去重，允许多条空值]；purchase_order_line_id + observation_type [NULLS DISTINCT：仅非空值去重，允许多条空值]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** num_nonnulls(goods_receipt_line_id, purchase_order_line_id, source_record_id) >= 1；currency = 'MYR' OR fx_rate_to_myr IS NOT NULL；quality_status <> 'VERIFIED' OR verified_at IS NOT NULL
- **特别说明：** normalized_price_myr 不作为独立事实保存；视图按 raw_unit_price × COALESCE(fx_rate_to_myr,1) ÷ 已核验单位换算系数确定性计算。supplier_item_id 已指向有效期版本；只有该版本 material_id、包装换算、单位和证据齐全时才允许 VERIFIED，该跨表门禁由受控写入函数执行。原始价格和来源键一经写入不得修改；正式价格更正追加新 observation。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `supplier_price_observation_id` | 价格观察ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条采购价观察稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `cc31baf7-f683-561d-b88f-052398352318` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `supplier_item_id` | 供应商商品ID | `uuid` | 非空; 默认 — | 被观察的有效供应商 SKU、物料和包装版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_supplier_item.supplier_item_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `c5661f44-564f-5b4e-bdb9-8563d4a8702f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 产生报价、PO、收货或人工市场检查的注册来源；人工后台也必须注册为来源。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_record_id` | 来源记录ID | `text` | 可空; 默认 — | 来源中的报价编号、收货行号或人工检查幂等编号。 | 与来源系统共同防止同一价格证据被重复导入。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `QUOTE-20260811-17` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `goods_receipt_line_id` | 收货行ID | `uuid` | 可空; 默认 — | 实际收货价来源时对应收货行；采购库存扩展包启用前必须为空且不创建该外键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | 延期FK → scm_goods_receipt_line.goods_receipt_line_id；激活=EXTENSION_PACK:PROCUREMENT_AND_INVENTORY | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `04cf9005-afa7-5bcc-98b7-53c51b827abd` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 该列在 EXTENSION_PACK:PROCUREMENT_AND_INVENTORY 未完整启用前必须为 NULL，届时也不得提前创建外键。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `purchase_order_line_id` | 采购行ID | `uuid` | 可空; 默认 — | PO确认价来源时对应采购行；采购库存扩展包启用前必须为空且不创建该外键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | 延期FK → scm_purchase_order_line.purchase_order_line_id；激活=EXTENSION_PACK:PROCUREMENT_AND_INVENTORY | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `e05036e6-f8aa-548f-aab7-7858367302a3` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 该列在 EXTENSION_PACK:PROCUREMENT_AND_INVENTORY 未完整启用前必须为 NULL，届时也不得提前创建外键。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `observation_type` | 观察类型 | `text` | 非空; 默认 — | QUOTE、PO_CONFIRMED、RECEIPT_ACTUAL 或 MANUAL_MARKET_CHECK。 | 区分价格证据强度。 | CHECK observation_type IN ('QUOTE','PO_CONFIRMED','RECEIPT_ACTUAL','MANUAL_MARKET_CHECK') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `RECEIPT_ACTUAL` | scm_supplier_price_observation.observation_type 只表示本字段说明中的 观察类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `observed_at` | 观察时间 | `timestamptz` | 非空; 默认 — | 报价、确认或收货价格发生时间。 | 按时选择成本价。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-11T10:30:00+08:00` | scm_supplier_price_observation.observed_at 只表示本字段说明中的 观察时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `raw_unit_price` | 原始单价 | `numeric(18,6)` | 非空; 默认 — | 按供应商报价单位的原始价格。 | 保留来源原值。 | CHECK raw_unit_price >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `630.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 10 | `raw_price_unit_text` | 来源价格单位文本 | `text` | 非空; 默认 — | 报价、PO或收货来源原样提供的价格单位文本。 | 保留来源证据，不直接作为计算连接键。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `case` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 11 | `raw_price_unit_id` | 原始价格单位ID | `uuid` | 可空; 默认 — | 来源单位确认后对应的受控单位；未映射时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `75af84c1-2f91-5a87-b13e-54fc350423e4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `material_unit_conversion_id` | 物料单位换算ID | `uuid` | 可空; 默认 — | 将原始价格单位换算到物料基础单位所采用的已核验规格。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material_unit_conversion.material_unit_conversion_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `f9de28ad-8c05-5f0b-8036-b52fad4439cb` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `currency` | 原始币种 | `char(3)` | 非空; 默认 'MYR' | 原始价格币种。 | 汇率转换。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `MYR` | scm_supplier_price_observation.currency 只表示本字段说明中的 原始币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 14 | `fx_rate_to_myr` | 兑MYR汇率 | `numeric(18,8)` | 可空; 默认 — | 观察时原币种 1 单位可兑换的 MYR 数量；原币种为 MYR 时可为空并按 1 计算。 | 与原价和单位换算共同确定性派生 MYR 基础单价。 | CHECK fx_rate_to_myr IS NULL OR fx_rate_to_myr > 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `1.00000000` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `fx_source_ref` | 汇率来源引用 | `text` | 可空; 默认 — | 非 MYR 报价采用的汇率来源、日期和记录编号。 | 证明汇率而不把计算结果重复落库。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `BNM:2026-08-11:USD-MYR` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `normalization_detail` | 换算证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 包装、单位、汇率日期及舍入规则的脱敏证据。 | 复现归一化路径；数值输入仍使用结构化字段和单位换算外键。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `{"rounding":"HALF_UP_8DP"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 17 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | VERIFIED、UNVERIFIED、UNIT_ERROR、FX_MISSING 或 REJECTED。 | 只有符合政策的价格可进入成本卡。 | CHECK quality_status IN ('VERIFIED','UNVERIFIED','UNIT_ERROR','FX_MISSING','REJECTED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `VERIFIED` | scm_supplier_price_observation.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 18 | `verified_by_user_id` | 核验账号 | `uuid` | 可空; 默认 — | 人工确认单位、币种或手工报价时的应用账号；自动收货价可以为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `657d68b7-6271-56cd-af62-f6f757039940` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `verified_at` | 核验时间 | `timestamptz` | 可空; 默认 — | 价格证据进入 VERIFIED 的时间。 | 证明何时获准进入成本选择。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-11T11:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 20 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 21 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

# COST — 配方、采购价、成本快照与毛利

## `cost_card_recipe_version` — 配方版本

- **用途：** 一行冻结一个配方代码版本的名称、产出对象、批产量、生效区间、售价参考和发布状态；不再为只有版本表引用的配方另建主档。
- **一行代表：** 配方代码 × 版本号一行
- **写入责任：** 财务成本卡网站
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **数据来源：** 成本卡编辑和发布
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** R6_MERGE_INTO: absorb cost_card_recipe; recipe_code groups immutable versions
- **为何存表而不是现算视图：** 一行冻结一个配方代码版本的名称、产出对象、批产量、生效区间、售价参考和发布状态；不再为只有版本表引用的配方另建主档。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `output_product_id` → `ops_product.product_id`；`output_material_id` → `scm_material.material_id`；`yield_unit_id` → `app_unit.unit_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `cost_card_recipe_component.recipe_version_id`
- **分析视图：** `v_scm_material_requirement_trace`、`v_cost_card_recipe_current`、`v_cost_card_product_cost_component`、`v_cost_card_recipe_expanded`
- **唯一约束：** recipe_code + version_no
- **不可重叠约束：** NO_OVERLAP(recipe_code, tstzrange(effective_from, effective_to, '[)')) WHERE status = 'PUBLISHED'
- **表级检查：** (output_product_id IS NOT NULL) <> (output_material_id IS NOT NULL)；effective_to IS NULL OR effective_to > effective_from；effective_from IS NOT NULL OR (status = 'DRAFT' AND effective_to IS NULL)
- **特别说明：** R6 终审将 cost_card_recipe 合并到本表：没有任何业务事实只引用配方主档，所有生产、需求和成本都必须引用具体 recipe_version_id；recipe_code 已足够跨版本分组。历史迁移中唯一尚未生效的 DRAFT 可以保留 effective_from=NULL；非 DRAFT 不允许缺失生效时间。DRAFT 可编辑，PUBLISHED、ARCHIVED 或 REJECTED 后冻结，修改只新增 version_no。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `recipe_version_id` | 配方版本ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版配方稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `c1ca2e3f-26d2-5b36-a601-dd98b2c7a710` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `recipe_code` | 配方代码 | `text` | 非空; 默认 — | 跨版本稳定且不可复用的企业配方代码。 | 与 version_no 共同选择版本；跨表仍引用 recipe_version_id。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `RCP-DARK-WELLINGTON` | cost_card_recipe_version.recipe_code 只表示本字段说明中的 配方代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `recipe_name` | 配方名称快照 | `text` | 非空; 默认 — | 本版本发布时的配方显示名称。 | 名称变化不重写旧版本。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `黑巧惠灵顿标准配方` | cost_card_recipe_version.recipe_name 只表示本字段说明中的 配方名称快照；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `output_product_id` | 产出产品ID | `uuid` | 可空; 默认 — | 配方产出可售产品时填写。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `40de1993-f429-5da6-a1c6-7cb973bf8171` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `output_material_id` | 产出半成品原料ID | `uuid` | 可空; 默认 — | 配方产出半成品时填写。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `77367000-5fc6-52d6-bd6f-ebcfe3b7c918` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `version_no` | 版本号 | `integer` | 非空; 默认 — | 配方内递增版本。 | 历史成本重现。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `5` | cost_card_recipe_version.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `batch_yield_quantity` | 批产量 | `numeric(18,6)` | 非空; 默认 — | 一批配方产生的产出基础单位数量。 | 将总原料成本换算到单位成本。 | CHECK batch_yield_quantity > 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `24` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `yield_unit_id` | 产出单位ID | `uuid` | 非空; 默认 — | 批产量采用的受控单位；必须等于产出产品或半成品的基础单位。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2673b199-58d3-52ea-97a7-b179ee775094` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 9 | `reference_sale_price` | 参考售价 | `numeric(18,4)` | 可空; 默认 — | 发布时用于成本率评审的参考售价；实际销售以POS事实为准。 | 成本卡审核提示。 | CHECK reference_sale_price IS NULL OR reference_sale_price >= 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `28.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 参考售价币种。 | 解释参考售价。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `MYR` | cost_card_recipe_version.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `effective_from` | 生效时间 | `timestamptz` | 可空; 默认 — | 配方开始用于新生产和成本快照的时间；仅历史迁移且尚未生效的 DRAFT 可为空。 | 按交易日选择正确版本；不能为补齐历史而伪造日期。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `effective_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 配方停止生效时间。 | 保留历史。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-09-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `status` | 版本状态 | `text` | 非空; 默认 — | DRAFT、PUBLISHED、ARCHIVED 或 REJECTED。 | 只有 PUBLISHED 可进入物料需求和成本。 | CHECK status IN ('DRAFT','PUBLISHED','ARCHIVED','REJECTED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `PUBLISHED` | cost_card_recipe_version.status 只表示本字段说明中的 版本状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 14 | `notes` | 配方说明 | `text` | 可空; 默认 — | 本版本由成本卡人员录入的操作说明、适用边界或迁移备注。 | 承接旧配方 notes；不把稳定可计算字段塞进自由文本。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `节日礼盒版本，仅 Pavilion 使用` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `lock_version` | 草稿并发版本 | `integer` | 非空; 默认 1 | DRAFT 每次受控修改递增的乐观锁版本；发布后冻结。 | 避免两个编辑者互相覆盖尚未发布的配方草稿。 | CHECK lock_version > 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `4` | cost_card_recipe_version.lock_version 只表示本字段说明中的 草稿并发版本；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 16 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准配方版本的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 配方获批时间。 | 审计。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-07-31T12:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 20 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `cost_card_recipe_component` — 配方原料组件

- **用途：** 逐项保存配方版本的统一原料用量、损耗和净得率。
- **一行代表：** 配方版本 × 原料 × 序号一行
- **写入责任：** 财务成本卡网站
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **数据来源：** 成本卡配方输入
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `PARTIAL_FIELDS_DERIVED_IN_VIEW`
- **可派生字段/输出：** base_unit_quantity -> input quantity × unit conversion
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 逐项保存配方版本的统一原料用量、损耗和净得率。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `recipe_version_id` → `cost_card_recipe_version.recipe_version_id`；`material_id` → `scm_material.material_id`；`input_unit_id` → `app_unit.unit_id`；`material_unit_conversion_id` → `scm_material_unit_conversion.material_unit_conversion_id`
- **被谁连接：** `scm_material_requirement_component.recipe_component_id`
- **分析视图：** `v_scm_material_requirement_trace`、`v_cost_card_recipe_expanded`
- **唯一约束：** recipe_version_id + sequence_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** (condition_rule IS NULL) = (condition_schema_version IS NULL)；is_optional = (condition_rule IS NOT NULL)
- **特别说明：** base_unit_quantity 不重复保存；input_unit_id 等于物料基础单位时等于 input_quantity，否则由 material_unit_conversion_id 的冻结系数确定性派生。net_yield_rate 表示清洗/去皮后的可用比例，loss_rate 表示后续生产过程额外损耗，两者不是 1-x 的同一字段；可选组件必须按 condition_schema_version 经受控函数校验 condition_rule 并拒绝未知键；物料需求和成本视图按版本化公式顺序应用。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `recipe_component_id` | 配方组件ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条配方用料稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `a23230e6-bc8a-5c55-9b0c-b0e081e2bec0` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `recipe_version_id` | 配方版本ID | `uuid` | 非空; 默认 — | 所属配方版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → cost_card_recipe_version.recipe_version_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `c1ca2e3f-26d2-5b36-a601-dd98b2c7a710` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `material_id` | 原料ID | `uuid` | 非空; 默认 — | 配方使用的统一原料或半成品。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `sequence_no` | 顺序 | `integer` | 非空; 默认 — | 配方展示和执行顺序。 | 稳定排序。 | CHECK sequence_no > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1` | cost_card_recipe_component.sequence_no 只表示本字段说明中的 顺序；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `input_quantity` | 投料数量 | `numeric(18,8)` | 非空; 默认 — | 按 input_unit_id 的配方投料量。 | 原始配方事实。 | CHECK input_quantity > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `500` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 6 | `input_unit_id` | 投料单位ID | `uuid` | 非空; 默认 — | 配方投料采用的受控单位。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_unit.unit_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `d6960aef-d847-5bea-9e9d-8483130a45e8` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 7 | `material_unit_conversion_id` | 物料单位换算ID | `uuid` | 可空; 默认 — | 投料单位与物料基础单位不同时采用的已核验换算；全局单位换算可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material_unit_conversion.material_unit_conversion_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f9de28ad-8c05-5f0b-8036-b52fad4439cb` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `net_yield_rate` | 净得率 | `numeric(9,6)` | 非空; 默认 1 | 原料可用比例，0到1。 | 处理清洗、去皮等损耗。 | CHECK net_yield_rate > 0 AND net_yield_rate <= 1 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `0.980000` | cost_card_recipe_component.net_yield_rate 只表示本字段说明中的 净得率；必须在所属对象粒度内按 numeric(9,6) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `loss_rate` | 额外损耗率 | `numeric(9,6)` | 非空; 默认 0 | 生产过程额外损耗比例，0到1。 | 物料需求放大和成本。 | CHECK loss_rate >= 0 AND loss_rate < 1 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `0.020000` | cost_card_recipe_component.loss_rate 只表示本字段说明中的 额外损耗率；必须在所属对象粒度内按 numeric(9,6) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `is_optional` | 是否可选 | `boolean` | 非空; 默认 false | 组件是否仅在特定变体使用。 | 可选组件必须有规则，不能默认计入。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `false` | cost_card_recipe_component.is_optional 只表示本字段说明中的 是否可选；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `condition_schema_version` | 使用条件结构版本 | `text` | 可空; 默认 — | condition_rule 对应的固定 JSON Schema 版本；非可选组件为空。 | 冻结允许的变体维度、操作符和取值类型。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `recipe-condition-v1` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `condition_rule` | 使用条件 | `jsonb` | 可空; 默认 — | 可选组件按 condition_schema_version 校验的结构化条件；未知键拒绝。 | 复现产品变体成本。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `{"variant":"gift_pack"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `note` | 组件说明 | `text` | 可空; 默认 — | 只属于本配方组件的操作说明或迁移备注。 | 承接旧 cost_card_recipe_item.notes，不把数量、单位或损耗塞进文本。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `internal` | `装饰用，最后一步加入` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `cost_card_material_price` — 成本采用价

- **用途：** 从供应商价格观察或人工批准值中选择某地点、原料的有效成本价格。
- **一行代表：** 地点或全局 × 原料 × 生效区间一行
- **写入责任：** 财务成本卡网站
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **数据来源：** 收货价、PO价、报价或人工批准
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 从供应商价格观察或人工批准值中选择某地点、原料的有效成本价格。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `material_id` → `scm_material.material_id`；`location_id` → `ops_location.location_id`；`supplier_price_observation_id` → `scm_supplier_price_observation.supplier_price_observation_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_cost_card_product_cost_component`、`v_cost_card_material_price_current`
- **唯一约束：** material_id + location_id + effective_from [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** NO_OVERLAP(material_id, COALESCE(location_id, NIL_UUID), tstzrange(effective_from, effective_to, '[)')) WHERE quality_status IN ('VERIFIED','ESTIMATED','STALE')
- **表级检查：** effective_to IS NULL OR effective_to > effective_from
- **特别说明：** DRAFT 可补充证据；一旦质量状态进入可用或终态即冻结。迁移首日允许将现有 cost_card_item_price 作为 MIGRATED_MANUAL 启动价，但必须保留旧 price_id、原单位、换算和核验状态于 evidence；实际收货价出现后生成新生效区间，不原地改写历史。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `material_price_id` | 成本价格ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条有效成本采用价稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `a27d91fa-ea9b-5a2d-9eae-8e2e289da2f2` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `material_id` | 原料ID | `uuid` | 非空; 默认 — | 被定价统一原料。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 可空; 默认 — | 地点特有价格；企业通用价为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `supplier_price_observation_id` | 价格观察ID | `uuid` | 可空; 默认 — | 采用的供应商价格证据；纯人工价可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_supplier_price_observation.supplier_price_observation_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `cc31baf7-f683-561d-b88f-052398352318` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `price_myr_per_base_unit` | 每基础单位MYR价格 | `numeric(18,8)` | 非空; 默认 — | 用于成本计算的归一化 MYR 单价。 | 配方组件成本唯一价格输入。 | CHECK price_myr_per_base_unit >= 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `0.06300000` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 6 | `price_source` | 价格来源 | `text` | 非空; 默认 — | RECEIPT_ACTUAL、PO_CONFIRMED、QUOTE、MIGRATED_MANUAL、MANUAL 或 FALLBACK。 | 区分新供应链事实、现有成本卡启动价和无充分证据的兜底值。 | CHECK price_source IN ('RECEIPT_ACTUAL','PO_CONFIRMED','QUOTE','MIGRATED_MANUAL','MANUAL','FALLBACK') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `RECEIPT_ACTUAL` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 7 | `effective_from` | 生效时间 | `timestamptz` | 非空; 默认 — | 价格开始用于成本快照的时间。 | 按交易日选价。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-11T10:30:00+08:00` | cost_card_material_price.effective_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `effective_to` | 失效时间 | `timestamptz` | 可空; 默认 — | 价格停止生效时间。 | 保留采购价波动历史。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-08-20T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | VERIFIED、ESTIMATED、STALE、UNIT_ERROR 或 REJECTED。 | 决定毛利是否可信。 | CHECK quality_status IN ('VERIFIED','ESTIMATED','STALE','UNIT_ERROR','REJECTED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `VERIFIED` | cost_card_material_price.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `evidence` | 批准证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 人工覆盖原因、汇率和验证记录。 | 支持审计。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"receipt_line":"..."}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 11 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准该价格生效的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 14 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

# FINANCE — 财务来源事实与核对

## `finance_import_batch` — 财务导入批次

- **用途：** 记录财务模板、银行文件或人工数据每次导入的文件、期间、校验值和批准状态。
- **一行代表：** 来源文件或数据集 × 一次导入一行
- **写入责任：** 财务网站
- **读取项目：** 财务网站、分析/BI
- **数据来源：** 批准的财务模板或文件
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 记录财务模板、银行文件或人工数据每次导入的文件、期间、校验值和批准状态。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `source_system_id` → `app_source_system.source_system_id`；`job_run_id` → `app_job_run.job_run_id`；`scope_location_id` → `ops_location.location_id`；`supersedes_finance_import_batch_id` → `finance_import_batch.finance_import_batch_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `finance_cashflow_line.finance_import_batch_id`；`finance_import_batch.supersedes_finance_import_batch_id`；`finance_inventory_flow_line.finance_import_batch_id`；`finance_inventory_snapshot_line.finance_import_batch_id`；`finance_item_sales_monthly.finance_import_batch_id`；`finance_monthly_cost_line.finance_import_batch_id`；`finance_monthly_metric.finance_import_batch_id`；`finance_order_logistics_line.finance_import_batch_id`；`finance_sales_daily.finance_import_batch_id`；`finance_supplier_purchase_monthly.finance_import_batch_id`
- **分析视图：** `v_business_timeline`、`v_finance_import_batch_current`
- **唯一约束：** dataset_code + file_sha256 [NULLS DISTINCT：仅非空值去重，允许多条空值]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** period_end >= period_start；supersedes_finance_import_batch_id IS NULL OR supersedes_finance_import_batch_id <> finance_import_batch_id
- **特别说明：** status 表示导入技术流程，recognition_status 表示财务可用层级。治理视图同一数据集/地点/期间只选一个获准批次；被 supersedes 的批次仍保留但不得重复汇总。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `finance_import_batch_id` | 财务批次ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次财务导入稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `f70d48e6-c643-530c-a9b4-3acce3bbf42b` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 财务数据来源。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 3 | `job_run_id` | 任务运行ID | `uuid` | 可空; 默认 — | 自动导入任务；网页人工导入可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `scope_location_id` | 批次范围地点ID | `uuid` | 可空; 默认 — | 文件只覆盖一个地点时填写；明确为多地点或公司级数据时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `7febd863-b111-54b9-baa7-f0e2ab23a513` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `supersedes_finance_import_batch_id` | 替代财务批次ID | `uuid` | 可空; 默认 — | 本批明确更正并替代的旧批次；首次导入为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → finance_import_batch.finance_import_batch_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `0fe57fa2-6473-52db-85c1-3cc58e4ca459` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `dataset_code` | 数据集代码 | `text` | 非空; 默认 — | SALES_DAILY、MONTHLY_COST、CASHFLOW 等类型。 | 选择校验规则和目标表。 | CHECK dataset_code IN ('SALES_DAILY','ITEM_SALES_MONTHLY','MONTHLY_COST','CASHFLOW','ORDER_LOGISTICS','INVENTORY_SNAPSHOT','INVENTORY_FLOW','SUPPLIER_PURCHASE_MONTHLY','MONTHLY_METRIC') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `MONTHLY_COST` | finance_import_batch.dataset_code 只表示本字段说明中的 数据集代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `source_layer` | 来源层级 | `text` | 非空; 默认 — | OPERATIONAL_TEMPLATE、MANAGEMENT_REPORT、POSTED_LEDGER 或 BANK_STATEMENT。 | 区分运营原表、管理报表和已过账账簿，禁止把多个层级相加。 | CHECK source_layer IN ('OPERATIONAL_TEMPLATE','MANAGEMENT_REPORT','POSTED_LEDGER','BANK_STATEMENT') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `MANAGEMENT_REPORT` | 这是来源系统证据，不等于企业统一身份。 |
| 8 | `recognition_status` | 财务确认状态 | `text` | 非空; 默认 'SOURCE_ONLY' | SOURCE_ONLY、APPROVED_FOR_RECONCILIATION、POSTED_ACCOUNTING 或 EXCLUDED。 | 决定批次只能用于来源展示、可参与核对还是可作为已入账口径。 | CHECK recognition_status IN ('SOURCE_ONLY','APPROVED_FOR_RECONCILIATION','POSTED_ACCOUNTING','EXCLUDED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `APPROVED_FOR_RECONCILIATION` | finance_import_batch.recognition_status 只表示本字段说明中的 财务确认状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `source_filename` | 来源文件名 | `text` | 可空; 默认 — | 用户上传或同步文件的原始文件名。 | 业务核对。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `2026-07-Pavilion-PL.xlsx` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `file_sha256` | 文件校验值 | `char(64)` | 可空; 默认 — | 原始文件 SHA-256。 | 阻止同一文件重复导入。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `a91c...64位十六进制` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `period_start` | 期间开始 | `date` | 非空; 默认 — | 文件覆盖会计期间起点。 | 定义影响范围。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-07-01` | finance_import_batch.period_start 只表示本字段说明中的 期间开始；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `period_end` | 期间结束 | `date` | 非空; 默认 — | 文件覆盖会计期间终点。 | 定义影响范围。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-07-31` | finance_import_batch.period_end 只表示本字段说明中的 期间结束；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `template_version` | 模板版本 | `text` | 非空; 默认 — | 解析所依据的财务模板版本。 | 防止旧模板误解析。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `finance-template-v5` | finance_import_batch.template_version 只表示本字段说明中的 模板版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 14 | `loaded_row_count` | 落库行数 | `bigint` | 非空; 默认 0 | 导入成功或确认幂等的记录数。 | 空批次和缺行监控。 | CHECK loaded_row_count >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `125` | finance_import_batch.loaded_row_count 只表示本字段说明中的 落库行数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 15 | `status` | 批次状态 | `text` | 非空; 默认 — | UPLOADED、VALIDATED、APPROVED、LOADED、REJECTED 或 FAILED。 | 只有 APPROVED/LOADED 才进入正式财务读取。 | CHECK status IN ('UPLOADED','VALIDATED','APPROVED','LOADED','REJECTED','FAILED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `LOADED` | finance_import_batch.status 只表示本字段说明中的 批次状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 16 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准财务导入的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 批次通过财务校验的时间。 | 审计。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-05T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `validation_result` | 校验结果 | `jsonb` | 非空; 默认 '{}'::jsonb | 模板结构、合计、重复和映射检查结果。 | 明确拒绝或警告原因。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `{"totals_match":true}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 19 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 20 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 21 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `finance_sales_daily` — 财务日销售事实

- **用途：** 保存财务模板口径的门店日销售，保持与 POS 事实独立用于核对。
- **一行代表：** 财务批次 × 地点 × 日期一行
- **写入责任：** 财务网站
- **读取项目：** 财务网站、分析/BI
- **数据来源：** 财务销售模板
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存财务模板口径的门店日销售，保持与 POS 事实独立用于核对。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `finance_import_batch_id` → `finance_import_batch.finance_import_batch_id`；`location_id` → `ops_location.location_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_finance_sales_reconciliation`、`v_finance_margin_reconciliation`
- **唯一约束：** finance_import_batch_id + location_id + business_date
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 财务日销售是与 POS 独立的来源观察。gross_sales、discount_amount、net_sales、order_count 未提供时保持 NULL；只有来源明确报告零值才写 0。折扣率和平均客单价从本表分子分母派生，不重复存储。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `finance_sales_daily_id` | 财务日销售ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条财务日销售稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `10928949-336d-5f88-8296-56f5887d19b2` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `finance_import_batch_id` | 财务批次ID | `uuid` | 非空; 默认 — | 产生该事实的导入批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → finance_import_batch.finance_import_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f70d48e6-c643-530c-a9b4-3acce3bbf42b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 销售所属统一门店。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `business_date` | 营业日期 | `date` | 非空; 默认 — | 财务表认定的销售日期。 | 与 POS 日销售核对。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-07-20` | 不要由 created_at 或 UTC 日期临时推导。 |
| 5 | `gross_sales` | 财务流水 | `numeric(18,4)` | 可空; 默认 — | 财务模板口径流水金额；模板未提供时为空。 | 独立来源核对；NULL 不得当成 0。 | CHECK gross_sales IS NULL OR gross_sales >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `51000.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `discount_amount` | 财务折扣 | `numeric(18,4)` | 可空; 默认 — | 财务模板直接提供或由模板明确组成项归一化的折扣金额；模板未提供时为空。 | 净额和折扣率；NULL 表示未知，不表示没有折扣。 | CHECK discount_amount IS NULL OR discount_amount >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1000.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `net_sales` | 财务实收 | `numeric(18,4)` | 可空; 默认 — | 财务模板口径实收或收入；模板未提供时为空。 | 与 POS 净销售比较，不自动覆盖；NULL 不得当成 0。 | CHECK net_sales IS NULL OR net_sales >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `50000.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `order_count` | 财务订单数 | `integer` | 可空; 默认 — | 财务来源独立提供的订单或账单数量；来源不含该列时为空。 | 保留历史财务导入中的账单观察并派生财务客单价；不得从 POS 反填。 | CHECK order_count IS NULL OR order_count >= 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `805` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 金额币种。 | 保证核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | finance_sales_daily.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | COMPLETE、PARTIAL、UNMAPPED_LOCATION 或 REJECTED。 | 不完整数据不得伪装正式财务事实。 | CHECK quality_status IN ('COMPLETE','PARTIAL','UNMAPPED_LOCATION','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `COMPLETE` | finance_sales_daily.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `finance_item_sales_monthly` — 财务单品月销售

- **用途：** 保存财务模板中月度单品数量和金额，作为 POS 聚合的独立核对来源。
- **一行代表：** 财务批次 × 地点 × 月份 × 来源商品一行
- **写入责任：** 财务网站
- **读取项目：** 财务网站、分析/BI
- **数据来源：** 财务单品销售模板
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存财务模板中月度单品数量和金额，作为 POS 聚合的独立核对来源。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `finance_import_batch_id` → `finance_import_batch.finance_import_batch_id`；`location_id` → `ops_location.location_id`；`product_id` → `ops_product.product_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** finance_import_batch_id + location_id + business_month + source_item_name
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** EXTRACT(DAY FROM business_month) = 1

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `finance_item_sales_monthly_id` | 财务单品月销售ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条月单品销售稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `bd06de6c-19e1-55b0-9524-2dd29835317f` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `finance_import_batch_id` | 财务批次ID | `uuid` | 非空; 默认 — | 产生事实的导入批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → finance_import_batch.finance_import_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f70d48e6-c643-530c-a9b4-3acce3bbf42b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 销售所属门店。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `product_id` | 产品ID | `uuid` | 可空; 默认 — | 确认映射后的统一产品；未确认时为空并进入质量队列。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e9c9e097-867a-5929-8bd8-84c74d45b5c4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `business_month` | 业务月份 | `date` | 非空; 默认 — | 用月份第一日表示的会计月。 | 月度核对。 | — | 月份键，固定为该月第一天；不是某笔交易发生日。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-07-01` | finance_item_sales_monthly.business_month 只表示本字段说明中的 业务月份；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `source_item_name` | 来源商品名称 | `text` | 非空; 默认 — | 财务模板原始商品名称。 | 保留证据，禁止直接按名连接。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `黑巧惠灵顿` | 这是来源系统证据，不等于企业统一身份。 |
| 7 | `quantity` | 财务销量 | `numeric(18,4)` | 非空; 默认 — | 财务模板口径月销量。 | 与 POS 月聚合比较。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `850` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `source_unit` | 来源数量单位 | `text` | 可空; 默认 — | 财务模板原样提供的销量单位；模板未提供时为空。 | 单位未确认时只能在同一来源商品内比较数量，不能直接换算到 product.base_unit。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `ea` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `sales_amount` | 财务销售额 | `numeric(18,4)` | 非空; 默认 — | 财务模板口径单品销售额。 | 与 POS 产品销售核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23800.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 10 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 金额币种。 | 保证核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | finance_item_sales_monthly.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | COMPLETE、UNMAPPED_PRODUCT、PARTIAL 或 REJECTED。 | 未映射行不进入产品级正式分析。 | CHECK quality_status IN ('COMPLETE','UNMAPPED_PRODUCT','PARTIAL','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `COMPLETE` | finance_item_sales_monthly.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `finance_monthly_cost_line` — 财务月成本费用行

- **用途：** 用统一粒度保存材料、人工、仓运和期间费用，同时保留类别和组织来源。
- **一行代表：** 财务批次 × 地点 × 月份 × 成本域 × 类别 × 子类 × 组织或来源一行
- **写入责任：** 财务网站
- **读取项目：** 财务网站、分析/BI
- **数据来源：** 利润表、费用表和人工成本模板
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 用统一粒度保存材料、人工、仓运和期间费用，同时保留类别和组织来源。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `finance_import_batch_id` → `finance_import_batch.finance_import_batch_id`；`location_id` → `ops_location.location_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_finance_labor_reconciliation`
- **唯一约束：** finance_import_batch_id + source_row_ref
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** EXTRACT(DAY FROM business_month) = 1

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `finance_monthly_cost_line_id` | 月成本行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条财务月成本稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `25fcbb50-73ae-5e28-9777-d68dd56a7f6c` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `finance_import_batch_id` | 财务批次ID | `uuid` | 非空; 默认 — | 产生该成本事实的导入批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → finance_import_batch.finance_import_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f70d48e6-c643-530c-a9b4-3acce3bbf42b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_row_ref` | 来源行定位符 | `text` | 非空; 默认 — | 导入文件中的稳定行定位，例如工作表名与原始行号或来源记录号。 | 与批次共同实现重跑幂等，同时允许两条内容完全相同但位置不同的真实行并存。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `P&L!R42` | 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_row_fingerprint` | 来源行内容指纹 | `char(64)` | 非空; 默认 — | 按版本化规范对来源行原值计算的 SHA-256。 | 检测同一来源位置内容是否变化；不单独充当业务身份或去重键。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7ac4...64位十六进制` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 成本归属地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 6 | `business_month` | 业务月份 | `date` | 非空; 默认 — | 月份第一日。 | 月度损益连接。 | — | 月份键，固定为该月第一天；不是某笔交易发生日。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-07-01` | finance_monthly_cost_line.business_month 只表示本字段说明中的 业务月份；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `cost_domain` | 成本域 | `text` | 非空; 默认 — | MATERIAL、LABOR、LOGISTICS、OPERATING_EXPENSE 或 OTHER。 | 保持不同成本口径可区分。 | CHECK cost_domain IN ('MATERIAL','LABOR','LOGISTICS','OPERATING_EXPENSE','OTHER') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `LABOR` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 8 | `category_code` | 类别代码 | `text` | 非空; 默认 — | 标准成本类别代码。 | 期间费用和汇总口径。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `WAGES` | finance_monthly_cost_line.category_code 只表示本字段说明中的 类别代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `subcategory_code` | 子类代码 | `text` | 可空; 默认 — | 更细成本项目；无子类为空。 | 费用穿透。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `LOCAL_STAFF_WAGES` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `organization_code` | 组织代码 | `text` | 可空; 默认 — | 成本模板中的组织、资金来源或用工组织。 | 保留原财务拆分。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MY_OPERATIONS` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `source_label` | 来源标签 | `text` | 可空; 默认 — | 模板原始类别或支付渠道文本。 | 核对导入但不作为标准口径。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `银行流水` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `accounting_treatment` | 会计处理 | `text` | 非空; 默认 — | RAW_SOURCE、RECOGNIZED_EXPENSE、ACCRUAL、REVERSAL 或 EXCLUDED。 | 防止来源明细、已确认费用、计提和冲销在同一汇总中重复计算。 | CHECK accounting_treatment IN ('RAW_SOURCE','RECOGNIZED_EXPENSE','ACCRUAL','REVERSAL','EXCLUDED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `RECOGNIZED_EXPENSE` | finance_monthly_cost_line.accounting_treatment 只表示本字段说明中的 会计处理；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `amount` | 金额 | `numeric(18,4)` | 非空; 默认 — | 该成本行金额。 | 损益和财务核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `12500.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 14 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 金额币种。 | 保证正确汇总。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | finance_monthly_cost_line.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 15 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | COMPLETE、UNCLASSIFIED、PARTIAL 或 REJECTED。 | 未归类费用阻断正式利润表。 | CHECK quality_status IN ('COMPLETE','UNCLASSIFIED','PARTIAL','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `COMPLETE` | finance_monthly_cost_line.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 16 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `finance_cashflow_line` — 财务现金流行

- **用途：** 保存门店月度现金流项目和金额，不与收入或利润混用。
- **一行代表：** 财务批次 × 地点 × 月份 × 现金流项目一行
- **写入责任：** 财务网站
- **读取项目：** 财务网站、分析/BI
- **数据来源：** 现金流模板
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存门店月度现金流项目和金额，不与收入或利润混用。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `finance_import_batch_id` → `finance_import_batch.finance_import_batch_id`；`location_id` → `ops_location.location_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** finance_import_batch_id + location_id + business_month + cashflow_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** EXTRACT(DAY FROM business_month) = 1

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `finance_cashflow_line_id` | 现金流行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条现金流事实稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f98ce9a9-8786-5f0c-bd98-4cbe1accb8db` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `finance_import_batch_id` | 财务批次ID | `uuid` | 非空; 默认 — | 产生该事实的导入批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → finance_import_batch.finance_import_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f70d48e6-c643-530c-a9b4-3acce3bbf42b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 现金流归属地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `business_month` | 业务月份 | `date` | 非空; 默认 — | 月份第一日。 | 月度现金流。 | — | 月份键，固定为该月第一天；不是某笔交易发生日。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-07-01` | finance_cashflow_line.business_month 只表示本字段说明中的 业务月份；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `cashflow_code` | 现金流项目代码 | `text` | 非空; 默认 — | OPENING_BALANCE、CASH_IN、CASH_OUT、REFUND、BANK_DEPOSIT 或 CLOSING_BALANCE。 | 稳定现金流口径。 | CHECK cashflow_code IN ('OPENING_BALANCE','CASH_IN','CASH_OUT','REFUND','BANK_DEPOSIT','CLOSING_BALANCE') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `CASH_IN` | finance_cashflow_line.cashflow_code 只表示本字段说明中的 现金流项目代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `amount` | 金额 | `numeric(18,4)` | 非空; 默认 — | 该项目月度金额。 | 现金余额桥接。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `50000.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 7 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 金额币种。 | 正确汇总。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | finance_cashflow_line.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `finance_order_logistics_line` — 财务物流订货行

- **用途：** 保留财务模板中包含订货、付款、发货、到港、交付和入库日期的历史物流行。
- **一行代表：** 财务批次 × 来源订货单 × 来源商品行一行
- **写入责任：** 财务网站
- **读取项目：** 财务网站、供应链、分析/BI
- **数据来源：** 财务库存/物流模板
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保留财务模板中包含订货、付款、发货、到港、交付和入库日期的历史物流行。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `finance_import_batch_id` → `finance_import_batch.finance_import_batch_id`；`location_id` → `ops_location.location_id`；`supplier_id` → `scm_supplier.supplier_id`；`material_id` → `scm_material.material_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_finance_purchase_reconciliation`
- **唯一约束：** finance_import_batch_id + source_row_ref
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `finance_order_logistics_line_id` | 物流订货行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条历史物流行稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `3de8cc85-eecb-5f56-a50e-1e444393bcca` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `finance_import_batch_id` | 财务批次ID | `uuid` | 非空; 默认 — | 产生该事实的导入批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → finance_import_batch.finance_import_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f70d48e6-c643-530c-a9b4-3acce3bbf42b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_row_ref` | 来源行定位符 | `text` | 非空; 默认 — | 导入文件中的稳定行定位，例如工作表名与原始行号或来源记录号。 | 与批次共同实现重跑幂等，同时保留内容相同的真实重复行。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `Logistics!R18` | 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_row_fingerprint` | 来源行内容指纹 | `char(64)` | 非空; 默认 — | 按版本化规范对来源行原值计算的 SHA-256。 | 检测同一来源位置内容变化，不作为唯一业务身份。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7ac4...64位十六进制` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 订货服务地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 6 | `supplier_id` | 供应商ID | `uuid` | 可空; 默认 — | 确认映射的供应商；未知为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_supplier.supplier_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e371d1ab-adb0-5313-9194-bda119e8f5ba` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `material_id` | 原料ID | `uuid` | 可空; 默认 — | 确认映射的原料；未知为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `source_order_no` | 来源订单号 | `text` | 非空; 默认 — | 财务模板中的订货单编号。 | 历史单据核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `CN-PO-202606-18` | 这是来源系统证据，不等于企业统一身份。 |
| 9 | `source_supplier_name` | 来源供应商名称 | `text` | 可空; 默认 — | 财务物流模板中的供应商名称原文。 | 在 supplier_id 尚未确认时保留来源证据；不得按名称自动建立供应商身份。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `Supplier Sdn Bhd` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `source_item_name` | 来源商品名称 | `text` | 非空; 默认 — | 模板原始商品名称。 | 保留证据。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `巧克力原料` | 这是来源系统证据，不等于企业统一身份。 |
| 11 | `source_specification` | 来源规格 | `text` | 可空; 默认 — | 财务物流模板中的商品规格原文。 | 无损承接 finance_orders.spec，并辅助物料与供应商商品映射；不作为统一单位。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `5kg/case` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `source_category` | 来源类别 | `text` | 可空; 默认 — | 财务物流模板中的商品类别原文。 | 保留历史分类证据；正式分析类别必须通过治理映射，不按名称直连。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `进口原料` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `source_purchase_type` | 来源采购类型 | `text` | 可空; 默认 — | 财务物流模板 ptype 的原始值。 | 在来源词表未确认前原样保留；不得猜成 LOCAL/IMPORT 后覆盖原值。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `IMPORT` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `order_date` | 订货日期 | `date` | 非空; 默认 — | 财务模板认定的下单日期。 | 会计期间归属。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-06-12` | finance_order_logistics_line.order_date 只表示本字段说明中的 订货日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 15 | `payment_date` | 付款日期 | `date` | 可空; 默认 — | 实际付款日期。 | 现金流。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-06-13` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `shipped_date` | 发货日期 | `date` | 可空; 默认 — | 供应商发货日期。 | 物流提前期。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-06-15` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `arrived_port_date` | 到港日期 | `date` | 可空; 默认 — | 跨境采购到港日期。 | 跨境物流。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-06-25` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `delivered_date` | 交付日期 | `date` | 可空; 默认 — | 送达本地地点日期。 | 交付及时率。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-06-28` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `warehoused_date` | 入库日期 | `date` | 可空; 默认 — | 财务模板认定的入库日期。 | 库存期间。 | — | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-06-28` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 20 | `quantity` | 数量 | `numeric(18,4)` | 可空; 默认 — | 来源订货数量。 | 历史采购分析。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `10` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 21 | `source_unit` | 来源数量单位 | `text` | 可空; 默认 — | 财务模板原样提供的订货单位；未提供时为空。 | 解释数量并辅助与供应商包装单位映射。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `case` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 22 | `source_volume` | 来源体积数值 | `numeric(18,6)` | 可空; 默认 — | 财务物流模板 volume 的原始数值；来源为空时保持为空。 | 只为无损迁移和来源核对保留；旧模板没有证明单位，确认单位前不得与其他行求和或用于运费计算。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1.250000` | 实施门禁：必须向财务模板所有者确认 volume 是单件体积、总体积还是包装容量及其单位；未确认时 quality_status 不得为 COMPLETE。 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 23 | `amount` | 金额 | `numeric(18,4)` | 可空; 默认 — | 来源订货行金额。 | 采购核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `5000.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 24 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 金额币种。 | 正确汇总。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | finance_order_logistics_line.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 25 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | COMPLETE、UNMAPPED_SUPPLIER、UNMAPPED_MATERIAL、PARTIAL 或 REJECTED。 | 未映射历史行不伪装成 SCM PO。 | CHECK quality_status IN ('COMPLETE','UNMAPPED_SUPPLIER','UNMAPPED_MATERIAL','PARTIAL','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `PARTIAL` | finance_order_logistics_line.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 26 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `finance_inventory_snapshot_line` — 财务月库存快照行

- **用途：** 保存财务模板月末现存、在途、用量、规格和采购类型。
- **一行代表：** 财务批次 × 地点 × 月份 × 来源物料一行
- **写入责任：** 财务网站
- **读取项目：** 财务网站、供应链、分析/BI
- **数据来源：** 财务库存模板
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存财务模板月末现存、在途、用量、规格和采购类型。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `finance_import_batch_id` → `finance_import_batch.finance_import_batch_id`；`location_id` → `ops_location.location_id`；`material_id` → `scm_material.material_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** finance_import_batch_id + source_row_ref
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** EXTRACT(DAY FROM business_month) = 1

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `finance_inventory_snapshot_line_id` | 财务库存快照ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条财务库存快照稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `61c65258-9ce2-5fe6-b30a-b3f1c25a5386` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `finance_import_batch_id` | 财务批次ID | `uuid` | 非空; 默认 — | 产生该事实的导入批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → finance_import_batch.finance_import_batch_id | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `f70d48e6-c643-530c-a9b4-3acce3bbf42b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_row_ref` | 来源行定位符 | `text` | 非空; 默认 — | 导入文件中的稳定行定位，例如工作表名与原始行号或来源记录号。 | 与批次共同实现重跑幂等，同时保留内容相同的真实重复行。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `Inventory!R33` | 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_row_fingerprint` | 来源行内容指纹 | `char(64)` | 非空; 默认 — | 按版本化规范对来源行原值计算的 SHA-256。 | 检测同一来源位置内容变化，不作为唯一业务身份。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `7ac4...64位十六进制` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 库存归属地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 6 | `material_id` | 原料ID | `uuid` | 可空; 默认 — | 确认映射的统一原料；未知为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `business_month` | 业务月份 | `date` | 非空; 默认 — | 月末快照所属月份第一日。 | 与 SCM 盘点核对。 | — | 月份键，固定为该月第一天；不是某笔交易发生日。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `2026-07-01` | finance_inventory_snapshot_line.business_month 只表示本字段说明中的 业务月份；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `source_item_name` | 来源物料名称 | `text` | 非空; 默认 — | 财务模板原始名称。 | 保留证据。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `Dark Chocolate 70%` | 这是来源系统证据，不等于企业统一身份。 |
| 9 | `specification` | 规格 | `text` | 可空; 默认 — | 模板中的包装规格。 | 辅助映射和采购分析。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `5kg/case` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `source_category` | 来源类别 | `text` | 可空; 默认 — | 财务库存模板中的类别原文。 | 无损承接 finance_stock.category；正式类别需治理后再分析。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `巧克力` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `on_hand_quantity` | 现存数量 | `numeric(18,6)` | 可空; 默认 — | 模板口径月末现存量。 | 与 SCM 批准盘点独立核对。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `12` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `in_transit_quantity` | 在途数量 | `numeric(18,6)` | 可空; 默认 — | 模板口径在途量。 | 与 SCM 开放 PO 核对。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `4` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `monthly_usage_quantity` | 当月用量 | `numeric(18,6)` | 可空; 默认 — | 模板口径当月耗用。 | 与生产需求和库存移动核对。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `18` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `source_unit` | 来源单位 | `text` | 可空; 默认 — | 财务模板数量单位。 | 解释数量。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `case` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `source_unit_volume` | 来源单位容量数值 | `numeric(18,6)` | 可空; 默认 — | 财务库存模板 unit_volume 的原始数值；来源为空时保持为空。 | 保留旧模板包装换算线索；因旧字段没有单位，确认语义前不得作为正式换算系数。 | — | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `5.000000` | 只有在来源合同确认其量纲和单位，并建立 scm_material_unit_conversion 后，才能用于正式数量换算。 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `purchase_type` | 采购类型 | `text` | 可空; 默认 — | LOCAL、IMPORT 或 UNKNOWN。 | 采购结构分析。 | CHECK purchase_type IS NULL OR purchase_type IN ('LOCAL','IMPORT','UNKNOWN') | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `LOCAL` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | COMPLETE、UNMAPPED_MATERIAL、UNIT_UNMAPPED、PARTIAL 或 REJECTED。 | 正式物料核对门禁。 | CHECK quality_status IN ('COMPLETE','UNMAPPED_MATERIAL','UNIT_UNMAPPED','PARTIAL','REJECTED') | 不适用。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `COMPLETE` | finance_inventory_snapshot_line.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 18 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 快照事实；多个时间点可并存，不能只保留最后一行。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `finance_inventory_flow_line` — 财务月进销存行

- **用途：** 保存财务模板按仓别的期初、入库、领用和期末数量。
- **一行代表：** 财务批次 × 地点 × 月份 × 仓别 × 来源物料一行
- **写入责任：** 财务网站
- **读取项目：** 财务网站、供应链、分析/BI
- **数据来源：** 财务进销存模板
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存财务模板按仓别的期初、入库、领用和期末数量。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `finance_import_batch_id` → `finance_import_batch.finance_import_batch_id`；`location_id` → `ops_location.location_id`；`material_id` → `scm_material.material_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** finance_import_batch_id + source_row_ref
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** EXTRACT(DAY FROM business_month) = 1

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `finance_inventory_flow_line_id` | 财务进销存ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条月进销存稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `9119c522-8224-5542-b4ba-6b1af9defe3a` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `finance_import_batch_id` | 财务批次ID | `uuid` | 非空; 默认 — | 产生该事实的导入批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → finance_import_batch.finance_import_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f70d48e6-c643-530c-a9b4-3acce3bbf42b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_row_ref` | 来源行定位符 | `text` | 非空; 默认 — | 导入文件中的稳定行定位，例如工作表名与原始行号或来源记录号。 | 与批次共同实现重跑幂等，同时保留内容相同的真实重复行。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `StockFlow!R51` | 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_row_fingerprint` | 来源行内容指纹 | `char(64)` | 非空; 默认 — | 按版本化规范对来源行原值计算的 SHA-256。 | 检测同一来源位置内容变化，不作为唯一业务身份。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7ac4...64位十六进制` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 进销存归属地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 6 | `material_id` | 原料ID | `uuid` | 可空; 默认 — | 确认映射的统一原料；未知为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `business_month` | 业务月份 | `date` | 非空; 默认 — | 月份第一日。 | 月度库存桥接。 | — | 月份键，固定为该月第一天；不是某笔交易发生日。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-07-01` | finance_inventory_flow_line.business_month 只表示本字段说明中的 业务月份；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `warehouse_type` | 仓别 | `text` | 非空; 默认 — | AMBIENT、FROZEN、CHILLED 或 OTHER。 | 库存条件分析。 | CHECK warehouse_type IN ('AMBIENT','FROZEN','CHILLED','OTHER') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `FROZEN` | finance_inventory_flow_line.warehouse_type 只表示本字段说明中的 仓别；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `source_item_name` | 来源物料名称 | `text` | 非空; 默认 — | 模板原始物料名称。 | 保留映射证据。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `Butter` | 这是来源系统证据，不等于企业统一身份。 |
| 10 | `opening_quantity` | 期初数量 | `numeric(18,6)` | 非空; 默认 — | 模板口径期初库存。 | 进销存恒等式。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `20` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 11 | `received_quantity` | 入库数量 | `numeric(18,6)` | 非空; 默认 — | 模板口径本月入库。 | 采购核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `15` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 12 | `issued_quantity` | 领用数量 | `numeric(18,6)` | 非空; 默认 — | 模板口径本月领用。 | 生产消耗核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `18` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 13 | `closing_quantity` | 期末数量 | `numeric(18,6)` | 非空; 默认 — | 模板口径期末库存。 | 与次月期初核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `17` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 14 | `source_unit` | 来源单位 | `text` | 可空; 默认 — | 模板数量单位。 | 解释数量。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `kg` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | COMPLETE、BALANCE_MISMATCH、UNMAPPED_MATERIAL 或 REJECTED。 | 不平衡行进入质量队列。 | CHECK quality_status IN ('COMPLETE','BALANCE_MISMATCH','UNMAPPED_MATERIAL','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `COMPLETE` | finance_inventory_flow_line.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 16 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `finance_supplier_purchase_monthly` — 财务供应商月采购

- **用途：** 保存财务模板按月、供应商、物料和规格聚合的采购数量、单价和金额。
- **一行代表：** 财务批次 × 地点 × 月份 × 来源供应商 × 来源物料 × 规格一行
- **写入责任：** 财务网站
- **读取项目：** 财务网站、供应链、分析/BI
- **数据来源：** 财务供应价格与进销存模板
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存财务模板按月、供应商、物料和规格聚合的采购数量、单价和金额。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `finance_import_batch_id` → `finance_import_batch.finance_import_batch_id`；`location_id` → `ops_location.location_id`；`supplier_id` → `scm_supplier.supplier_id`；`material_id` → `scm_material.material_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_finance_purchase_reconciliation`
- **唯一约束：** finance_import_batch_id + source_row_ref
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** EXTRACT(DAY FROM business_month) = 1

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `finance_supplier_purchase_monthly_id` | 供应商月采购ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条月采购聚合稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f0c0f409-e97e-53a3-a6b5-1d5772164398` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `finance_import_batch_id` | 财务批次ID | `uuid` | 非空; 默认 — | 产生该事实的导入批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → finance_import_batch.finance_import_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f70d48e6-c643-530c-a9b4-3acce3bbf42b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_row_ref` | 来源行定位符 | `text` | 非空; 默认 — | 导入文件中的稳定行定位，例如工作表名与原始行号或来源记录号。 | 与批次共同实现重跑幂等，同时保留内容相同的真实重复行。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `SupplierPrice!R27` | 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_row_fingerprint` | 来源行内容指纹 | `char(64)` | 非空; 默认 — | 按版本化规范对来源行原值计算的 SHA-256。 | 检测同一来源位置内容变化，不作为唯一业务身份。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7ac4...64位十六进制` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 采购服务地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 6 | `supplier_id` | 供应商ID | `uuid` | 可空; 默认 — | 确认映射的供应商；未知为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_supplier.supplier_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e371d1ab-adb0-5313-9194-bda119e8f5ba` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `material_id` | 原料ID | `uuid` | 可空; 默认 — | 确认映射的原料；未知为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → scm_material.material_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `22fe2df0-9ba9-590c-9397-3af557c564ce` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `business_month` | 业务月份 | `date` | 非空; 默认 — | 月份第一日。 | 月采购核对。 | — | 月份键，固定为该月第一天；不是某笔交易发生日。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-07-01` | finance_supplier_purchase_monthly.business_month 只表示本字段说明中的 业务月份；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `source_supplier_name` | 来源供应商名称 | `text` | 非空; 默认 — | 财务模板原始供应商名称。 | 保留证据。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `ABC Ingredients` | 这是来源系统证据，不等于企业统一身份。 |
| 10 | `source_item_name` | 来源物料名称 | `text` | 非空; 默认 — | 财务模板原始物料名称。 | 保留证据。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `Dark Chocolate` | 这是来源系统证据，不等于企业统一身份。 |
| 11 | `specification` | 规格 | `text` | 可空; 默认 — | 模板原始规格。 | 辅助映射和价格解释。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `5kg/case` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `quantity` | 采购数量 | `numeric(18,6)` | 非空; 默认 — | 模板口径月采购数量。 | 与 SCM 收货聚合比较。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `10` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 13 | `source_unit` | 来源数量单位 | `text` | 可空; 默认 — | 模板原样提供的采购单位；未提供时为空。 | 数量、单价和规格只有在该单位下才可解释。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `case` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `unit_price` | 模板单价 | `numeric(18,6)` | 非空; 默认 — | 模板口径单价。 | 与收货实际价比较。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `630` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 15 | `amount` | 采购金额 | `numeric(18,4)` | 非空; 默认 — | 模板口径月采购金额。 | 采购财务核对。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `6300` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 16 | `currency` | 币种 | `char(3)` | 非空; 默认 'MYR' | 金额币种。 | 正确汇总。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | finance_supplier_purchase_monthly.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 17 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | COMPLETE、UNMAPPED_SUPPLIER、UNMAPPED_MATERIAL、PARTIAL 或 REJECTED。 | 映射不足时不伪装正式 SCM 事实。 | CHECK quality_status IN ('COMPLETE','UNMAPPED_SUPPLIER','UNMAPPED_MATERIAL','PARTIAL','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `COMPLETE` | finance_supplier_purchase_monthly.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 18 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `finance_target` — 财务经营目标

- **用途：** 保存地点、月份和指标的目标值及版本。
- **一行代表：** 地点 × 月份 × 指标代码 × 版本一行
- **写入责任：** 财务网站
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **数据来源：** 管理层批准目标
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存地点、月份和指标的目标值及版本。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `location_id` → `ops_location.location_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_finance_target_current`
- **唯一约束：** location_id + business_month + metric_code + version_no [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** EXTRACT(DAY FROM business_month) = 1
- **特别说明：** DRAFT 可编辑；APPROVED、ACTIVE 或 SUPERSEDED 后本版本冻结。正式读取通过 v_finance_target_current 确定唯一当前版本，调整目标新增 version_no。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `finance_target_id` | 目标ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版财务目标稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `64a2b56c-25f1-5820-9f69-34d64e1c4f1e` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `location_id` | 地点ID | `uuid` | 可空; 默认 — | 目标适用地点；公司总目标为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `business_month` | 目标月份 | `date` | 非空; 默认 — | 月份第一日。 | 月度计划对比。 | — | 月份键，固定为该月第一天；不是某笔交易发生日。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-01` | finance_target.business_month 只表示本字段说明中的 目标月份；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `metric_code` | 指标代码 | `text` | 非空; 默认 — | REVENUE、GROSS_MARGIN、LABOR_COST_RATE 等标准指标。 | 定义 target_value 含义。 | CHECK metric_code ~ '^[A-Z][A-Z0-9_]{1,63}$' | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `REVENUE` | finance_target.metric_code 只表示本字段说明中的 指标代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `version_no` | 版本号 | `integer` | 非空; 默认 — | 同地点、月份、指标内递增版本。 | 预算调整不覆盖历史。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2` | finance_target.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `target_value` | 目标值 | `numeric(24,8)` | 非空; 默认 — | 目标数值。 | 与 metric_code/unit 共同解释。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `1600000` | finance_target.target_value 只表示本字段说明中的 目标值；必须在所属对象粒度内按 numeric(24,8) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `unit` | 目标单位 | `text` | 非空; 默认 — | MYR、PERCENT、COUNT 等。 | 避免数值歧义。 | CHECK unit ~ '^[A-Z][A-Z0-9_]{1,31}$' | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `MYR` | finance_target.unit 只表示本字段说明中的 目标单位；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `status` | 目标状态 | `text` | 非空; 默认 — | DRAFT、APPROVED、ACTIVE 或 SUPERSEDED。 | 只有 ACTIVE 进入正式对比。 | CHECK status IN ('DRAFT','APPROVED','ACTIVE','SUPERSEDED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ACTIVE` | finance_target.status 只表示本字段说明中的 目标状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准目标的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 目标批准时间。 | 审计。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-07-28T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `finance_monthly_metric` — 财务月度指标值

- **用途：** 保存财务模板提供的营业利润、净利润、摊销费、储值净额等标准月指标。
- **一行代表：** 财务批次 × 地点 × 月份 × 指标代码一行
- **写入责任：** 财务网站
- **读取项目：** 财务网站、分析/BI
- **数据来源：** 财务利润表模板
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存财务模板提供的营业利润、净利润、摊销费、储值净额等标准月指标。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `finance_import_batch_id` → `finance_import_batch.finance_import_batch_id`；`location_id` → `ops_location.location_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_finance_margin_reconciliation`
- **唯一约束：** finance_import_batch_id + location_id + business_month + metric_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** EXTRACT(DAY FROM business_month) = 1
- **特别说明：** 这里只保存财务模板或已批准管理报表明确给出的来源指标，不把可由本库销售、成本行或工时确定性计算的 KPI 再复制进来。即使同名指标可由运营事实估算，两侧仍作为独立来源用于核对，禁止相加或互相覆盖。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `finance_monthly_metric_id` | 月指标ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条财务月指标稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `d05b5145-d66d-54cd-9cfc-42ed44b58acb` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `finance_import_batch_id` | 财务批次ID | `uuid` | 非空; 默认 — | 产生指标的导入批次。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → finance_import_batch.finance_import_batch_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `f70d48e6-c643-530c-a9b4-3acce3bbf42b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 非空; 默认 — | 指标归属地点。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `business_month` | 业务月份 | `date` | 非空; 默认 — | 月份第一日。 | 月度报表连接。 | — | 月份键，固定为该月第一天；不是某笔交易发生日。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-07-01` | finance_monthly_metric.business_month 只表示本字段说明中的 业务月份；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `metric_code` | 指标代码 | `text` | 非空; 默认 — | 财务指标稳定代码。 | 避免把中文标签当键。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `NET_PROFIT_WITH_STORED_VALUE` | finance_monthly_metric.metric_code 只表示本字段说明中的 指标代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `metric_name_snapshot` | 指标名称快照 | `text` | 非空; 默认 — | 导入时模板指标名称。 | 模板改名后仍可解释。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `净利润(含储值)` | finance_monthly_metric.metric_name_snapshot 只表示本字段说明中的 指标名称快照；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `metric_value` | 指标值 | `numeric(24,8)` | 非空; 默认 — | 该指标月度数值。 | 财务展示和目标对比。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `125000` | finance_monthly_metric.metric_value 只表示本字段说明中的 指标值；必须在所属对象粒度内按 numeric(24,8) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `unit` | 单位 | `text` | 非空; 默认 — | MYR、PERCENT、COUNT 等。 | 解释指标值。 | CHECK unit ~ '^[A-Z][A-Z0-9_]{1,31}$' | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `MYR` | finance_monthly_metric.unit 只表示本字段说明中的 单位；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `quality_status` | 质量状态 | `text` | 非空; 默认 — | COMPLETE、UNCLASSIFIED、PARTIAL 或 REJECTED。 | 正式财务输出门禁。 | CHECK quality_status IN ('COMPLETE','UNCLASSIFIED','PARTIAL','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `COMPLETE` | finance_monthly_metric.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `finance_period_category_map` — 期间费用归类规则

- **用途：** 版本化维护财务来源类别到销售、管理、财务、研发等期间费用口径的映射。
- **一行代表：** 来源大类 × 来源子类 × 生效区间一行
- **写入责任：** 财务网站
- **读取项目：** 财务网站、分析/BI
- **数据来源：** 财务人员批准
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 版本化维护财务来源类别到销售、管理、财务、研发等期间费用口径的映射。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** source_major + source_sub + valid_from [NULLS NOT DISTINCT：空值也参与去重]
- **不可重叠约束：** NO_OVERLAP(source_major, COALESCE(source_sub, WILDCARD), daterange(valid_from, valid_to, '[)')) WHERE status = 'ACTIVE'
- **表级检查：** valid_to IS NULL OR valid_to > valid_from；source_sub IS NULL OR source_sub <> '__HOTCRUSH_ALL__'
- **特别说明：** DRAFT 可编辑；ACTIVE 或 RETIRED 后冻结。归类变化新增生效区间，不能回写改变已出具期间的历史口径。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `period_category_map_id` | 归类规则ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条费用归类稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `37cb52ea-2d57-562b-8653-0ec69fd1861f` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `source_major` | 来源大类 | `text` | 非空; 默认 — | 财务模板原始费用大类。 | 匹配 finance_monthly_cost_line。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `其他费用` | 这是来源系统证据，不等于企业统一身份。 |
| 3 | `source_sub` | 来源子类 | `text` | 可空; 默认 — | 财务模板原始费用子类。 | 更细归类；通配规则需显式代码。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `市场活动` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `target_category` | 目标期间费用类别 | `text` | 非空; 默认 — | SELLING、ADMINISTRATIVE、FINANCE、R_AND_D 或 EXCLUDED。 | 正式利润表分层。 | CHECK target_category IN ('SELLING','ADMINISTRATIVE','FINANCE','R_AND_D','EXCLUDED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `SELLING` | finance_period_category_map.target_category 只表示本字段说明中的 目标期间费用类别；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `valid_from` | 生效日期 | `date` | 非空; 默认 — | 规则开始生效日期。 | 历史月份按当时规则重现。 | — | 生效区间起点，采用含起点语义。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2026-01-01` | finance_period_category_map.valid_from 只表示本字段说明中的 生效日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `valid_to` | 失效日期上界 | `date` | 可空; 默认 — | 规则停止生效的日期上界，该日期本身不再适用。 | 以左闭右开区间保留历史并避免相邻规则重复命中。 | — | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `2027-01-01` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `status` | 规则状态 | `text` | 非空; 默认 — | DRAFT、ACTIVE 或 RETIRED。 | 未命中或非 ACTIVE 规则进入待归类。 | CHECK status IN ('DRAFT','ACTIVE','RETIRED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ACTIVE` | finance_period_category_map.status 只表示本字段说明中的 规则状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准归类规则的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `note` | 规则说明 | `text` | 可空; 默认 — | 特殊归类和边界说明。 | 避免口径误解。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `仅达人券相关活动` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 12 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

# MKT — 营销、HBTI问卷与奖励

## `mkt_campaign_version` — 营销活动版本

- **用途：** 一行冻结一个活动代码版本的名称、类型、时间窗、适用地点、参与规则、问卷算法和奖励政策；不再为只有版本表引用的活动另建主档。
- **一行代表：** 活动代码 × 版本号一行
- **写入责任：** 营销/HBTI后台
- **读取项目：** HBTI、财务网站、BakeryOps、分析/BI
- **数据来源：** 营销配置和批准
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** R6_MERGE_INTO: absorb mkt_campaign; campaign_code groups immutable versions
- **为何存表而不是现算视图：** 一行冻结一个活动代码版本的名称、类型、时间窗、适用地点、参与规则、问卷算法和奖励政策；不再为只有版本表引用的活动另建主档。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 永久保留活动版本、参与、作答、结果和奖励连接
- **向外连接：** `location_id` → `ops_location.location_id`；`approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `mkt_campaign_member.campaign_version_id`；`mkt_reward_stock.campaign_version_id`；`mkt_survey_question.campaign_version_id`
- **分析视图：** `v_mkt_campaign_performance`
- **唯一约束：** campaign_code + version_no
- **不可重叠约束：** NO_OVERLAP(campaign_code, tstzrange(starts_at, ends_at, '[)')) WHERE status = 'PUBLISHED'
- **表级检查：** ends_at IS NULL OR ends_at > starts_at；starts_at IS NOT NULL OR (status = 'ARCHIVED' AND ends_at IS NULL)
- **特别说明：** R6 终审将 mkt_campaign 合并到本表：没有任何业务事实只引用活动主档，所有参与、问卷与奖励都必须引用具体 campaign_version_id；campaign_code 已足够跨版本分组。只有历史迁移且无法证明开始时点的 ARCHIVED 版本允许 starts_at=NULL 且 ends_at=NULL，活跃或可参与版本必须有开始时点。DRAFT 写入函数必须按 campaign_type + rule_schema_version 校验三类规则并拒绝未知键；DRAFT 以外规则冻结，任何规则变化都新增 version_no。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `campaign_version_id` | 活动版本ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版活动稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `37505ac6-358a-51de-8460-d3d06cda0ca3` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `campaign_code` | 活动代码 | `text` | 非空; 默认 — | 跨版本稳定且不可复用的活动代码。 | 与 version_no 共同选择版本；会员参与直接引用 campaign_version_id。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `HBTI_2026_PAV` | mkt_campaign_version.campaign_code 只表示本字段说明中的 活动代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `campaign_name` | 活动名称快照 | `text` | 非空; 默认 — | 本版本发布时展示的活动名称。 | 名称变化不重写旧参与和结果。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `HBTI 会员偏好调研` | mkt_campaign_version.campaign_name 只表示本字段说明中的 活动名称快照；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `campaign_type` | 活动类型 | `text` | 非空; 默认 — | SURVEY、PROMOTION、LOYALTY、COUPON 或 OTHER。 | 决定本版本允许的规则和事实要求。 | CHECK campaign_type IN ('SURVEY','PROMOTION','LOYALTY','COUPON','OTHER') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `SURVEY` | mkt_campaign_version.campaign_type 只表示本字段说明中的 活动类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `location_id` | 地点ID | `uuid` | 可空; 默认 — | 活动只适用某地点时填写；全企业活动为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `version_no` | 版本号 | `integer` | 非空; 默认 — | 活动内递增版本。 | 参与和作答永远引用具体版本。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `3` | mkt_campaign_version.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `starts_at` | 开始时间 | `timestamptz` | 可空; 默认 — | 活动版本允许参与的开始时间；只有无法证明开始时点的历史归档版本可为空。 | 资格判断；历史缺失必须显式保留未知，不能猜日期。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `ends_at` | 结束时间 | `timestamptz` | 可空; 默认 — | 活动版本停止接受新参与的时间。 | 资格判断。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-31T23:59:59+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `rule_schema_version` | 活动规则结构版本 | `text` | 非空; 默认 'campaign-rules-v1' | audience_rule、participation_rule 和 reward_rule 共用的固定 JSON Schema 版本。 | 冻结三类行为规则的键、类型和范围，升级结构时必须新建活动版本。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `campaign-rules-v1` | mkt_campaign_version.rule_schema_version 只表示本字段说明中的 活动规则结构版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `audience_rule` | 受众规则 | `jsonb` | 非空; 默认 '{}'::jsonb | 按 rule_schema_version 校验的会员状态、地点或邀请条件；未知键拒绝。 | 复现某会员为何有资格。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"member_status":"ACTIVE"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 11 | `participation_rule` | 参与规则 | `jsonb` | 非空; 默认 '{}'::jsonb | 按 rule_schema_version 校验的次数限制、完成条件和重复参与政策；未知键拒绝。 | HBTI 锁和完成状态依据。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"max_responses":1}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 12 | `result_algorithm_version` | 测评算法版本 | `text` | 可空; 默认 — | 本活动版本正式采用的答案到 result_code 算法版本；非测评活动可为空。 | 使奖励、展示和分析只选择活动批准的结果版本。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `hbti-score-v2` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `result_schema_version` | 测评结果结构版本 | `text` | 可空; 默认 — | result_dimensions 和展示字段遵循的结构版本；非测评活动可为空。 | 防止同名 JSON 字段在算法升级后含义漂移。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `hbti-result-schema-v1` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `reward_rule` | 奖励规则 | `jsonb` | 非空; 默认 '{}'::jsonb | 按 rule_schema_version 校验的奖励选择和库存扣减规则；未知键拒绝。 | 奖励发放可重现。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"reward_required":true}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 15 | `status` | 版本状态 | `text` | 非空; 默认 — | DRAFT、APPROVED、PUBLISHED、PAUSED、COMPLETED、ARCHIVED、SUPERSEDED 或 CANCELLED。 | 只有 PUBLISHED 接受新参与；暂停、完成或归档均追加新版本状态。 | CHECK status IN ('DRAFT','APPROVED','PUBLISHED','PAUSED','COMPLETED','ARCHIVED','SUPERSEDED','CANCELLED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `PUBLISHED` | mkt_campaign_version.status 只表示本字段说明中的 版本状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 16 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准该活动版本的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 活动版本获批时间。 | 审计。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-07-28T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 20 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `mkt_campaign_member` — 活动会员参与

- **用途：** 记录会员在某活动版本中的资格、邀请、开始、完成和取消历史，不再把活动状态覆盖在 pos_member 当前快照上。
- **一行代表：** 活动版本 × 会员一行
- **写入责任：** 营销/HBTI后台
- **读取项目：** HBTI、财务网站、分析/BI
- **数据来源：** 资格评估、邀请链接和会员操作
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_WORKFLOW` — 只允许批准的状态机迁移并记录操作者和时间
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_WORKFLOW_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 记录会员在某活动版本中的资格、邀请、开始、完成和取消历史，不再把活动状态覆盖在 pos_member 当前快照上。；人工决定、批准、状态转换或业务副作用本身就是事实，不能从最终结果倒推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `campaign_version_id` → `mkt_campaign_version.campaign_version_id`；`member_id` → `pos_member.member_id`
- **被谁连接：** `app_one_time_token.campaign_member_id`；`mkt_reward_claim.campaign_member_id`；`mkt_survey_response.campaign_member_id`；`msg_outbound_message.campaign_member_id`
- **分析视图：** `v_mkt_campaign_performance`、`v_business_timeline`
- **唯一约束：** campaign_version_id + member_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 本表保存参与流程的当前状态，因此允许受控状态更新；每次作答和测评结果分别在 response/result 表追加，不覆盖历史结果。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `campaign_member_id` | 活动会员ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次会员活动参与稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `7e810e39-f83d-5a4c-8626-de67f132680f` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `campaign_version_id` | 活动版本ID | `uuid` | 非空; 默认 — | 会员参与的具体活动版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_campaign_version.campaign_version_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `37505ac6-358a-51de-8460-d3d06cda0ca3` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `member_id` | 会员ID | `uuid` | 非空; 默认 — | 参与活动的 POS 会员。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_member.member_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `ca70f98b-3820-5620-9a6b-71b5098f4e17` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `eligibility_status` | 资格状态 | `text` | 非空; 默认 — | ELIGIBLE、INELIGIBLE、PENDING 或 OVERRIDDEN。 | 解释是否允许参与。 | CHECK eligibility_status IN ('ELIGIBLE','INELIGIBLE','PENDING','OVERRIDDEN') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `ELIGIBLE` | mkt_campaign_member.eligibility_status 只表示本字段说明中的 资格状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `eligibility_evidence` | 资格证据 | `jsonb` | 非空; 默认 '{}'::jsonb | 资格规则结果和输入快照。 | 重现资格判断。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `{"member_status":"ACTIVE"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 6 | `invited_at` | 邀请时间 | `timestamptz` | 可空; 默认 — | 首次发送活动邀请时间。 | 转化漏斗。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-05T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `started_at` | 开始时间 | `timestamptz` | 可空; 默认 — | 会员首次进入并开始活动的时间。 | 完成时长。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-06T11:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `completed_at` | 完成时间 | `timestamptz` | 可空; 默认 — | 满足活动完成条件的时间。 | 奖励资格和转化。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-06T11:05:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `status` | 参与状态 | `text` | 非空; 默认 'INVITED' | INVITED、STARTED、COMPLETED、EXPIRED、CANCELLED 或 BLOCKED。 | 活动流程当前状态。 | CHECK status IN ('INVITED','STARTED','COMPLETED','EXPIRED','CANCELLED','BLOCKED') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `COMPLETED` | mkt_campaign_member.status 只表示本字段说明中的 参与状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `completion_version` | 完成逻辑版本 | `text` | 可空; 默认 — | 判定完成时使用的服务或规则版本。 | 历史完成判定可解释。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `hbti-completion-v2` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 12 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `mkt_survey_question` — 问卷题目

- **用途：** 版本化保存活动问卷题目、类型、顺序和必答规则。
- **一行代表：** 活动版本 × 题目代码一行
- **写入责任：** 营销/HBTI后台
- **读取项目：** HBTI、分析/BI
- **数据来源：** 活动问卷配置
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 版本化保存活动问卷题目、类型、顺序和必答规则。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `campaign_version_id` → `mkt_campaign_version.campaign_version_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `mkt_survey_answer.survey_question_id`；`mkt_survey_question_option.survey_question_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** campaign_version_id + question_code；campaign_version_id + sequence_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 所属 campaign_version 处于 DRAFT 时可编辑；受控写入函数按 question_type + validation_schema_version 校验 validation_rule 并拒绝未知键；发布后题目冻结，任何改文案、类型、顺序或校验规则都必须创建新的活动版本。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `survey_question_id` | 题目ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条活动版本题目稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `1b6a01ed-214b-54ba-a71f-5763c3f06057` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `campaign_version_id` | 活动版本ID | `uuid` | 非空; 默认 — | 题目所属具体活动版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_campaign_version.campaign_version_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `37505ac6-358a-51de-8460-d3d06cda0ca3` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `question_code` | 题目代码 | `text` | 非空; 默认 — | 活动内稳定题目代码。 | 跨语言展示和答题连接。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `Q01_FLAVOR` | mkt_survey_question.question_code 只表示本字段说明中的 题目代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `question_text` | 题目文本 | `text` | 非空; 默认 — | 发布时展示的题目文本。 | 保留会员实际看到的内容。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `你更喜欢哪种口味？` | mkt_survey_question.question_text 只表示本字段说明中的 题目文本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `question_type` | 题目类型 | `text` | 非空; 默认 — | SINGLE_CHOICE、MULTIPLE_CHOICE、RATING、TEXT 或 BOOLEAN。 | 决定答案校验。 | CHECK question_type IN ('SINGLE_CHOICE','MULTIPLE_CHOICE','RATING','TEXT','BOOLEAN') | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `SINGLE_CHOICE` | mkt_survey_question.question_type 只表示本字段说明中的 题目类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `sequence_no` | 题目顺序 | `integer` | 非空; 默认 — | 问卷中的展示顺序。 | 重现交互。 | CHECK sequence_no > 0 | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `1` | mkt_survey_question.sequence_no 只表示本字段说明中的 题目顺序；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `is_required` | 是否必答 | `boolean` | 非空; 默认 true | 完成问卷是否必须回答该题。 | 完成门禁。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `true` | mkt_survey_question.is_required 只表示本字段说明中的 是否必答；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `validation_schema_version` | 答案校验结构版本 | `text` | 非空; 默认 'survey-validation-v1' | validation_rule 对应的固定 JSON Schema 版本。 | 让同一 question_type 的规则结构升级可追溯。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `survey-validation-v1` | mkt_survey_question.validation_schema_version 只表示本字段说明中的 答案校验结构版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `validation_rule` | 答案校验规则 | `jsonb` | 非空; 默认 '{}'::jsonb | 按 question_type + validation_schema_version 校验的分值范围、最大选择数或文本长度；未知键拒绝。 | 服务端验证。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `{"max_choices":1}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 10 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 12 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `mkt_survey_question_option` — 问卷选项

- **用途：** 保存选择题选项代码、文本、顺序和可选分析标签。
- **一行代表：** 题目 × 选项代码一行
- **写入责任：** 营销/HBTI后台
- **读取项目：** HBTI、分析/BI
- **数据来源：** 活动问卷配置
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存选择题选项代码、文本、顺序和可选分析标签。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `survey_question_id` → `mkt_survey_question.survey_question_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `mkt_survey_answer.selected_option_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** survey_question_id + option_code；survey_question_id + sequence_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 所属 campaign_version 处于 DRAFT 时可编辑；发布后选项冻结，避免历史答案连接到被改写的选项。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `survey_question_option_id` | 选项ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条题目选项稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `dceeb00b-942e-5cf3-9a17-bf60e9d81f6f` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `survey_question_id` | 题目ID | `uuid` | 非空; 默认 — | 选项所属题目。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_survey_question.survey_question_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `1b6a01ed-214b-54ba-a71f-5763c3f06057` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `option_code` | 选项代码 | `text` | 非空; 默认 — | 题目内稳定选项代码。 | 答案连接和跨语言分析。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `DARK_CHOCOLATE` | mkt_survey_question_option.option_code 只表示本字段说明中的 选项代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `option_text` | 选项文本 | `text` | 非空; 默认 — | 会员看到的选项文本。 | 保留发布内容。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `黑巧克力` | mkt_survey_question_option.option_text 只表示本字段说明中的 选项文本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `sequence_no` | 选项顺序 | `integer` | 非空; 默认 — | 题目内展示顺序。 | 重现交互。 | CHECK sequence_no > 0 | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `1` | mkt_survey_question_option.sequence_no 只表示本字段说明中的 选项顺序；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `analysis_tags` | 分析标签 | `text[]` | 非空; 默认 '{}'::text[] | 批准的产品偏好或分群标签。 | 避免后续从自由文本猜标签。 | — | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `{chocolate,dark}` | mkt_survey_question_option.analysis_tags 只表示本字段说明中的 分析标签；必须在所属对象粒度内按 text[] 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 9 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 DRAFT_MUTABLE_THEN_FROZEN：草稿可编辑；发布、发送或生效后冻结并新建版本。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `mkt_survey_response` — 问卷作答

- **用途：** 保存会员对某活动版本的一次完整、部分或仅有历史结果锚点的问卷尝试。
- **一行代表：** 活动会员 × 尝试次数一行
- **写入责任：** HBTI应用
- **读取项目：** HBTI、分析/BI
- **数据来源：** 会员提交
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存会员对某活动版本的一次完整、部分或仅有历史结果锚点的问卷尝试。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `campaign_member_id` → `mkt_campaign_member.campaign_member_id`；`source_system_id` → `app_source_system.source_system_id`
- **被谁连接：** `mkt_survey_answer.survey_response_id`；`mkt_survey_result.survey_response_id`
- **分析视图：** `v_mkt_campaign_performance`
- **唯一约束：** campaign_member_id + attempt_no [NULLS NOT DISTINCT：空值也参与去重]；source_system_id + source_response_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** started_at IS NOT NULL OR (submitted_at IS NOT NULL AND status IN ('SUBMITTED','VALIDATED','REJECTED'))
- **特别说明：** 新作答必须记录真实 started_at、真实来源作答ID和正数 attempt_no。历史迁移若只有已提交或已计算结果，可保留 started_at=NULL、attempt_no=NULL，并使用登记 legacy source_system + migration-only:typed-JCS UUIDv5 锚点；迁移清单必须保存公式、哈希和非来源观察标志。result-only 响应固定 SUBMITTED、validation_result=SOURCE_ANSWERS_UNAVAILABLE；它不等于证明完整问卷答案存在。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `survey_response_id` | 作答ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次问卷尝试稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `ace1b145-5557-5c8a-a68a-98c3c0e0a8d7` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `campaign_member_id` | 活动会员ID | `uuid` | 非空; 默认 — | 作答所属会员参与。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_campaign_member.campaign_member_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `7e810e39-f83d-5a4c-8626-de67f132680f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 外部作答ID所属的来源命名空间；纯内部首次作答也登记 HBTI 应用来源。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_response_id` | 来源作答或迁移锚点ID | `text` | 非空; 默认 — | 真实作答保存来源 attempt_id；只有历史 result-only 迁移允许保存 migration-only:<typed-JCS UUIDv5> 锚点，并在迁移清单标明它不是来源观察。 | 跨抓取和迁移实现幂等；迁移锚点不得冒充来源作答尝试，也不得据此反推答案。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `migration-only:3e1d9b19-31f4-5a6c-b5dd-27d40c61c674` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `attempt_no` | 尝试次数 | `integer` | 可空; 默认 — | 真实来源作答在同一参与中的正整数尝试序号；只有没有来源作答事实的 result-only 历史迁移锚点为空。 | 保留真实重试而非覆盖，并让无作答事实的迁移记录保持未知。 | CHECK attempt_no IS NULL OR attempt_no > 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `1` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `started_at` | 开始时间 | `timestamptz` | 可空; 默认 — | 本次作答开始时间；历史终态记录未保存开始时点时可为空。 | 完成时长；缺失时保持未知，不能用访问类别或结果时间倒推。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-06T11:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `submitted_at` | 提交时间 | `timestamptz` | 可空; 默认 — | 会员提交本次答案的时间。 | 完成判定。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-06T11:05:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `status` | 作答状态 | `text` | 非空; 默认 — | IN_PROGRESS、SUBMITTED、VALIDATED、REJECTED 或 ABANDONED。 | 只有 VALIDATED 进入正式活动分析。 | CHECK status IN ('IN_PROGRESS','SUBMITTED','VALIDATED','REJECTED','ABANDONED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `VALIDATED` | mkt_survey_response.status 只表示本字段说明中的 作答状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `validation_result` | 校验结果 | `jsonb` | 非空; 默认 '{}'::jsonb | 必答题、选项和重复提交检查。 | 解释拒绝或部分作答。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `{"required_complete":true}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 10 | `client_context` | 客户端上下文 | `jsonb` | 非空; 默认 '{}'::jsonb | 非敏感的应用版本、语言和流程版本。 | 排查交互问题；不得保存IP或设备指纹。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `{"app_version":"1.3"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 12 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `mkt_survey_answer` — 问卷题目答案

- **用途：** 逐个原子值保存选项、评分、布尔或文本答案；多选题每个被选选项各占一行，不把多个外键塞进数组。
- **一行代表：** 作答 × 题目 × 原子答案值一行
- **写入责任：** HBTI应用
- **读取项目：** HBTI、分析/BI
- **数据来源：** 会员提交
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_BASE_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 逐个原子值保存选项、评分、布尔或文本答案；多选题每个被选选项各占一行，不把多个外键塞进数组。；这是来源原值或最小业务事件，是多种派生分析的不可替代输入。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `survey_response_id` → `mkt_survey_response.survey_response_id`；`survey_question_id` → `mkt_survey_question.survey_question_id`；`selected_option_id` → `mkt_survey_question_option.survey_question_option_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** survey_response_id + survey_question_id + value_index
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** num_nonnulls(selected_option_id, rating_value, boolean_value, text_value) = 1
- **特别说明：** 多选题按 value_index 写多行；单选、评分、布尔和文本题只能写 value_index=1。受控写入函数还必须确认 selected_option_id 属于 survey_question_id，并按 question_type 限制允许的值类型。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `survey_answer_id` | 答案ID | `uuid` | 非空; 默认 gen_random_uuid() | 一个原子答案值的稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `5c25a91b-9c6a-5f44-a5bb-af8b137cab5c` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `survey_response_id` | 作答ID | `uuid` | 非空; 默认 — | 所属问卷作答。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_survey_response.survey_response_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `ace1b145-5557-5c8a-a68a-98c3c0e0a8d7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `survey_question_id` | 题目ID | `uuid` | 非空; 默认 — | 被回答的具体版本题目。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_survey_question.survey_question_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1b6a01ed-214b-54ba-a71f-5763c3f06057` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `value_index` | 答案值序号 | `integer` | 非空; 默认 1 | 同一次作答同一题内从 1 递增的原子值序号；单值题固定为 1。 | 让多选题可以逐个保存、逐个外键校验并保持稳定顺序。 | CHECK value_index > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1` | mkt_survey_answer.value_index 只表示本字段说明中的 答案值序号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `selected_option_id` | 所选选项ID | `uuid` | 可空; 默认 — | 单选或多选题本行选择的一个选项。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_survey_question_option.survey_question_option_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7ab34cc1-7ae8-55c1-a110-739e3be05cf9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `rating_value` | 评分值 | `numeric(9,4)` | 可空; 默认 — | 评分题的数值答案。 | 偏好和满意度分析。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `4` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `boolean_value` | 布尔答案 | `boolean` | 可空; 默认 — | 是非题答案。 | 结构化分析。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `true` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `text_value` | 文本答案 | `text` | 可空; 默认 — | 开放题回答；必须经过内容和 PII 策略。 | 定性分析，不应默认展示给所有分析用户。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `restricted` | `希望增加低糖选择` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `answered_at` | 回答时间 | `timestamptz` | 非空; 默认 — | 该题答案最后确认时间。 | 分析作答节奏。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-06T11:03:00+08:00` | mkt_survey_answer.answered_at 只表示本字段说明中的 回答时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `mkt_survey_result` — 问卷测评结果

- **用途：** 保存一次问卷作答锚点经具体算法版本计算或由历史来源迁入的 HBTI 类型及其他测评结果；历史结果可能缺少原答案，不能冒充可复算。
- **一行代表：** 问卷作答 × 结果类型 × 算法版本一行
- **写入责任：** HBTI结果计算服务
- **读取项目：** HBTI、财务网站、分析/BI
- **数据来源：** 已验证问卷答案、批准的评分算法或明确标记不完整的历史结果
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_HISTORICAL_DECISION_FACT`；存储类别 `CORE_DECISION_OUTPUT`；可派生性 `CALCULABLE_BUT_CURRENT_INPUTS_CANNOT_RECREATE_PAST_DECISION`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存一次问卷作答锚点经具体算法版本计算或由历史来源迁入的 HBTI 类型及其他测评结果；历史结果可能缺少原答案，不能冒充可复算。；虽然数值可计算，但该版本曾被提出、批准或用于触发行动，历史决定本身不可从当前输入反推。
- **保留策略：** 按活动分析与会员隐私政策保留；删除联系信息不应破坏去标识结果统计
- **向外连接：** `survey_response_id` → `mkt_survey_response.survey_response_id`；`source_system_id` → `app_source_system.source_system_id`
- **被谁连接：** `mkt_reward_claim.survey_result_id`
- **分析视图：** `v_mkt_campaign_performance`
- **唯一约束：** survey_response_id + result_type + algorithm_version；source_system_id + source_result_id [NULLS DISTINCT：仅非空值去重，允许多条空值]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** (source_system_id IS NULL) = (source_result_id IS NULL)；input_sha256 IS NOT NULL OR quality_status = 'INCOMPLETE_INPUT'
- **特别说明：** 结果是不可变事实，不反写 pos_member 当前列。只有存在真实答案且 input_sha256 非空的结果才可称为可复算；历史 result-only 迁移必须使用 quality_status='INCOMPLETE_INPUT'、input_sha256=NULL 和明确的历史算法版本，且不得反推答案。算法重跑追加新 algorithm_version；当前业务结果由 campaign_version.result_algorithm_version 明确选择，不回写旧结果为 SUPERSEDED。若新算法要改变会员展示或奖励规则，必须发布新活动版本。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `survey_result_id` | 测评结果ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次问卷测评结果稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `eb38ddbe-1657-5c5e-95a2-d2466e3a2a17` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `survey_response_id` | 作答ID | `uuid` | 非空; 默认 — | 产生该结果或承接历史结果的问卷作答锚点；不自动证明答案完整。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_survey_response.survey_response_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `ace1b145-5557-5c8a-a68a-98c3c0e0a8d7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `result_type` | 结果类型 | `text` | 非空; 默认 — | HBTI_PROFILE 或未来批准的其他测评类型。 | 同一作答可以产生不同业务定义的结果，但不可混用。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `HBTI_PROFILE` | mkt_survey_result.result_type 只表示本字段说明中的 结果类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `result_code` | 结果代码 | `text` | 非空; 默认 — | 算法输出的稳定类别代码；现有 hbti_code 迁入此列。 | 支持活动分群和历史分析，不依赖颜色或展示名称。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `HBTI_DARK_EXPLORER` | mkt_survey_result.result_code 只表示本字段说明中的 结果代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `result_label` | 结果展示名称 | `text` | 可空; 默认 — | 计算时面向用户显示的结果名称快照。 | 保留当时文案；分析连接使用 result_code。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `Dark Explorer` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `result_color` | 结果展示颜色 | `text` | 可空; 默认 — | 计算时使用的颜色代码或名称快照。 | 重现 HBTI 结果页，不作为结果身份。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `#5A3825` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `algorithm_version` | 结果算法版本 | `text` | 非空; 默认 — | 将答案转换为 result_code 的批准算法版本。 | 算法修改后可以重算并与旧结果并存。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `hbti-score-v2` | mkt_survey_result.algorithm_version 只表示本字段说明中的 结果算法版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `input_sha256` | 输入答案校验值 | `char(64)` | 可空; 默认 — | 按固定顺序规范化真实答案后的 SHA-256；历史来源没有答案时为空。 | 有值时证明结果对应哪组答案；不得从结果字段反推伪造答案哈希。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `a91f...64位十六进制` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `result_dimensions` | 结果维度 | `jsonb` | 非空; 默认 '{}'::jsonb | 算法输出的分数、维度或解释标签。 | 保存可扩展测评明细；稳定主类别仍使用 result_code。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `{"chocolate":0.82,"adventure":0.64}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 10 | `quality_status` | 结果质量状态 | `text` | 非空; 默认 — | VALID、INCOMPLETE_INPUT、ALGORITHM_ERROR 或 REJECTED。 | 只有 VALID 且算法版本等于 campaign_version.result_algorithm_version 的结果可触发正式分群或奖励。 | CHECK quality_status IN ('VALID','INCOMPLETE_INPUT','ALGORITHM_ERROR','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `VALID` | mkt_survey_result.quality_status 只表示本字段说明中的 结果质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `calculated_at` | 计算时间 | `timestamptz` | 非空; 默认 — | 该算法完成结果计算的绝对时间。 | 排序重算并审计延迟。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-06T11:05:02+08:00` | mkt_survey_result.calculated_at 只表示本字段说明中的 计算时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `source_system_id` | 历史来源系统ID | `uuid` | 可空; 默认 — | 迁移既有结果时标明旧结果ID所属命名空间；本系统新计算结果为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `source_result_id` | 历史来源结果ID | `text` | 可空; 默认 — | 迁移现有 HBTI 结果时保存旧记录稳定标识；新结果可为空。 | 旧新结果逐行核对并保证幂等。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `internal` | `fact_hbti_response:8812` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `mkt_reward` — 活动奖励主数据

- **用途：** 维护礼品、优惠券或权益的稳定身份。
- **一行代表：** 一个可发放奖励一行
- **写入责任：** 营销后台
- **读取项目：** HBTI、财务网站、分析/BI
- **数据来源：** 营销配置
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_MASTER_IDENTITY`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 维护礼品、优惠券或权益的稳定身份。；稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `product_id` → `ops_product.product_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `mkt_reward_claim.reward_id`；`mkt_reward_stock.reward_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** reward_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `reward_id` | 奖励ID | `uuid` | 非空; 默认 gen_random_uuid() | 奖励稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `fcbae7f4-f5c0-5317-83d0-833bb75c2868` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `reward_code` | 奖励代码 | `text` | 非空; 默认 — | 企业内部唯一奖励代码。 | 活动规则和库存连接。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `GIFT_COOKIE_BOX` | mkt_reward.reward_code 只表示本字段说明中的 奖励代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `reward_name` | 奖励名称 | `text` | 非空; 默认 — | 当前显示名称。 | 会员选择和报表。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `曲奇礼盒` | mkt_reward.reward_name 只表示本字段说明中的 奖励名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `reward_type` | 奖励类型 | `text` | 非空; 默认 — | PHYSICAL_GIFT、COUPON、POINTS 或 BENEFIT。 | 决定库存和发放流程。 | CHECK reward_type IN ('PHYSICAL_GIFT','COUPON','POINTS','BENEFIT') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `PHYSICAL_GIFT` | mkt_reward.reward_type 只表示本字段说明中的 奖励类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `product_id` | 关联产品ID | `uuid` | 可空; 默认 — | 奖励本身是企业产品时关联。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_product.product_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `e9c9e097-867a-5929-8bd8-84c74d45b5c4` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `status` | 奖励状态 | `text` | 非空; 默认 'ACTIVE' | ACTIVE、SUSPENDED 或 RETIRED。 | 控制新活动可选。 | CHECK status IN ('ACTIVE','SUSPENDED','RETIRED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ACTIVE` | mkt_reward.status 只表示本字段说明中的 奖励状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 9 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `mkt_reward_stock` — 活动奖励库存

- **用途：** 保存活动版本、地点和奖励的可用、预留和已发数量。
- **一行代表：** 活动版本 × 地点 × 奖励一行
- **写入责任：** HBTI/营销库存服务
- **读取项目：** HBTI、财务网站、分析/BI
- **数据来源：** 营销分配和奖励发放
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_WORKFLOW` — 只允许批准的状态机迁移并记录操作者和时间
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_WORKFLOW_FACT`；可派生性 `PARTIAL_FIELDS_DERIVED_IN_VIEW`
- **可派生字段/输出：** available quantity and counter reconciliation -> v_mkt_reward_stock_reconciliation
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存活动版本、地点和奖励的可用、预留和已发数量。；人工决定、批准、状态转换或业务副作用本身就是事实，不能从最终结果倒推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `campaign_version_id` → `mkt_campaign_version.campaign_version_id`；`location_id` → `ops_location.location_id`；`reward_id` → `mkt_reward.reward_id`
- **被谁连接：** `mkt_reward_claim(reward_stock_id+reward_id)`
- **分析视图：** `v_mkt_campaign_performance`、`v_mkt_reward_stock_reconciliation`
- **唯一约束：** campaign_version_id + location_id + reward_id [NULLS NOT DISTINCT：空值也参与去重]；reward_stock_id + reward_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** reserved_quantity + redeemed_quantity + damaged_quantity <= allocated_quantity；(unit_cost_estimate IS NULL) = (currency IS NULL)
- **特别说明：** unit_cost_estimate 是活动分配时不可反推的批准预算快照，因此放在本粒度，不放奖励主档；没有成本时 currency 也必须为空。四个数量虽可由分配/领取事实核算，但本表是并发预留的事务控制行，不是分析快照；更新必须使用 version_no 乐观锁并与有 reward_stock_id 的 reward_claim 同事务。stockless 外部履约不扣本表库存。v_mkt_reward_stock_reconciliation 持续检查缓存计数与有库存领取事实是否漂移。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `reward_stock_id` | 奖励库存ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条活动奖励库存稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `7173f2bb-2398-525d-acea-8023de261b97` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `campaign_version_id` | 活动版本ID | `uuid` | 非空; 默认 — | 库存分配给的活动版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_campaign_version.campaign_version_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `37505ac6-358a-51de-8460-d3d06cda0ca3` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `location_id` | 地点ID | `uuid` | 可空; 默认 — | 奖励可领取地点；数字权益可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_location.location_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `23e9d2d4-f525-5e85-9e18-ad25aadb718c` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `reward_id` | 奖励ID | `uuid` | 非空; 默认 — | 库存对应奖励。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_reward.reward_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `fcbae7f4-f5c0-5317-83d0-833bb75c2868` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `allocated_quantity` | 分配数量 | `integer` | 非空; 默认 — | 活动版本最初或追加分配的总数量。 | 库存上限。 | CHECK allocated_quantity >= 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `100` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 6 | `unit_cost_estimate` | 批准单位成本估算 | `numeric(18,4)` | 可空; 默认 — | 本活动版本和地点分配奖励时批准的单位预算成本。 | 冻结活动预算口径，避免奖励主档后来改价重写历史活动成本。 | CHECK unit_cost_estimate IS NULL OR unit_cost_estimate >= 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `8.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `currency` | 成本估算币种 | `char(3)` | 可空; 默认 — | 本次分配单位成本估算的 ISO 4217 币种；没有单位成本证据时为空。 | 仅在 unit_cost_estimate 存在时解释活动预算金额，不能因缺失成本自动制造 MYR。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `MYR` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `reserved_quantity` | 预留数量 | `integer` | 非空; 默认 0 | 已被会员选择但尚未发放的数量。 | 防止超卖。 | CHECK reserved_quantity >= 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `12` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 9 | `redeemed_quantity` | 已发数量 | `integer` | 非空; 默认 0 | 已完成发放的数量。 | 活动消耗。 | CHECK redeemed_quantity >= 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `45` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 10 | `damaged_quantity` | 损坏数量 | `integer` | 非空; 默认 0 | 不可发放的损坏或调整数量。 | 可用库存扣减。 | CHECK damaged_quantity >= 0 | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `1` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 11 | `version_no` | 并发版本 | `integer` | 非空; 默认 1 | 每次原子库存变更递增的乐观锁版本。 | 防止并发超发。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `58` | mkt_reward_stock.version_no 只表示本字段说明中的 并发版本；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 13 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `mkt_reward_claim` — 活动奖励领取

- **用途：** 记录会员选择、预留、发放、到期或取消一份奖励的完整状态。
- **一行代表：** 活动会员 × 一次奖励领取一行
- **写入责任：** HBTI/营销库存服务
- **读取项目：** HBTI、财务网站、分析/BI
- **数据来源：** 会员选择和现场核销
- **实施层级：** `CORE_BUSINESS`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_WORKFLOW` — 只允许批准的状态机迁移并记录操作者和时间
- **最小粒度终审：** `PASS_MINIMUM_PHYSICAL_FOUNDATION`；存储类别 `CORE_WORKFLOW_FACT`；可派生性 `NO`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 记录会员选择、预留、发放、到期或取消一份奖励的完整状态。；人工决定、批准、状态转换或业务副作用本身就是事实，不能从最终结果倒推。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `campaign_member_id` → `mkt_campaign_member.campaign_member_id`；`reward_id` → `mkt_reward.reward_id`；`survey_result_id` → `mkt_survey_result.survey_result_id`；`redeemed_by_user_id` → `app_user.user_id`；`source_system_id` → `app_source_system.source_system_id`；`(reward_stock_id + reward_id) → mkt_reward_stock(reward_stock_id + reward_id) MATCH SIMPLE`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_mkt_campaign_performance`、`v_mkt_reward_stock_reconciliation`
- **唯一约束：** idempotency_key；source_system_id + source_fulfillment_id [NULLS DISTINCT：仅非空值去重，允许多条空值]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** expires_at IS NULL OR (reserved_at IS NOT NULL AND expires_at > reserved_at)；(source_system_id IS NULL) = (source_fulfillment_id IS NULL)；reward_stock_id IS NOT NULL OR (source_system_id IS NOT NULL AND source_fulfillment_id IS NOT NULL)；status <> 'REDEEMED' OR redeemed_at IS NOT NULL
- **特别说明：** 有 reward_stock_id 的 claim 必须通过 (reward_stock_id,reward_id) 复合外键证明库存与奖励一致，并与 reward_stock 预留计数在同一事务内用 version_no 乐观锁更新；stockless 外部履约必须保存 source_system_id + source_fulfillment_id。REDEEMED 只证明实物/数字权益已发放，绝不证明 POS 消费。同一 idempotency_key 重跑只返回原 claim。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `reward_claim_id` | 领取ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次奖励领取稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `71452143-915f-5137-8f40-83c972ed5bd6` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `campaign_member_id` | 活动会员ID | `uuid` | 非空; 默认 — | 领取奖励的会员参与。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_campaign_member.campaign_member_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `7e810e39-f83d-5a4c-8626-de67f132680f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `reward_stock_id` | 奖励库存ID | `uuid` | 可空; 默认 — | 本次领取确实来自目标活动库存时填写；外部独立发券且没有可证明库存行时为空。 | 与 reward_id 共同通过复合外键证明库存身份；为空时必须以外部履约身份保证可追溯。 | TABLE FK (reward_stock_id + reward_id) → mkt_reward_stock(reward_stock_id + reward_id) MATCH SIMPLE | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `7173f2bb-2398-525d-acea-8023de261b97` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `reward_id` | 奖励ID | `uuid` | 非空; 默认 — | 本次领取或外部履约的直接奖励身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_reward.reward_id；TABLE FK (reward_stock_id + reward_id) → mkt_reward_stock(reward_stock_id + reward_id) MATCH SIMPLE | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `fcbae7f4-f5c0-5317-83d0-833bb75c2868` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 5 | `survey_result_id` | 测评结果ID | `uuid` | 可空; 默认 — | 奖励由具体问卷结果触发或选择时记录；与结果无关的活动可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_survey_result.survey_result_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `eb38ddbe-1657-5c5e-95a2-d2466e3a2a17` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `idempotency_key` | 领取幂等键 | `char(64)` | 非空; 默认 — | 按活动参与、奖励、触发结果或客户端请求号规范化计算的 SHA-256。 | 库存预留重试必须恢复同一 claim，防止重复扣减和重复发奖。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `internal` | `d72a...64位十六进制` | mkt_reward_claim.idempotency_key 只表示本字段说明中的 领取幂等键；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `quantity` | 领取数量 | `integer` | 非空; 默认 1 | 本次领取数量。 | 库存原子扣减。 | CHECK quantity > 0 | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `1` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `status` | 领取状态 | `text` | 非空; 默认 — | RESERVED、REDEEMED、EXPIRED、CANCELLED 或 REJECTED；REDEEMED 只表示奖励履约完成，数字券已发放，不证明会员已在 POS 消费。 | 区分预留和奖励履约结果，禁止把发券误读成消费。 | CHECK status IN ('RESERVED','REDEEMED','EXPIRED','CANCELLED','REJECTED') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `REDEEMED` | mkt_reward_claim.status 只表示本字段说明中的 领取状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `reserved_at` | 预留时间 | `timestamptz` | 可空; 默认 — | 来源明确保存库存成功预留时间时填写；外部来源没有真实预留时刻时为空。 | 并发和到期计时；不能用 completed_at、confirmedAt 或 redeemed_at 回填。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-06T11:05:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `expires_at` | 预留到期时间 | `timestamptz` | 可空; 默认 — | 未核销预留自动释放时间。 | 避免永久占库存。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-13T23:59:59+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `redeemed_at` | 履约完成时间 | `timestamptz` | 可空; 默认 — | 现场实物发放或数字权益/新券实例成功发出的时间；RES confirmedAt 迁入这里。 | 确认奖励履约发生；不证明该券后来被 POS 消费。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-08T15:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `redeemed_by_user_id` | 核销账号 | `uuid` | 可空; 默认 — | 现场确认发放的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `3ce36c26-6212-5f89-814f-408f55ec8ecf` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `source_system_id` | 履约来源系统ID | `uuid` | 可空; 默认 — | 外部系统完成奖励履约时标明 source_fulfillment_id 所属命名空间；内部库存领取可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `source_fulfillment_id` | 外部履约ID | `text` | 可空; 默认 — | 外部奖励履约或新券实例的来源内稳定ID，例如 RES newCouponId；绝不表示 POS 消费或券核销。 | 跨系统发奖幂等和履约对账。 | CHECK source_fulfillment_id IS NULL OR btrim(source_fulfillment_id) <> '' | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `new_coupon_8812` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 16 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

# MSG — 消息、会话与投递

## `msg_conversation` — 消息会话

- **用途：** 统一表示内部助手、候选人 WhatsApp 或会员活动的一段会话，并用类型化外键连接业务对象。
- **一行代表：** 一个渠道会话一行
- **写入责任：** BakeryOps消息服务
- **读取项目：** BakeryOps、HBTI、分析/BI
- **数据来源：** WhatsApp、应用聊天或活动入口
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE` — 主数据允许受权限、审计和并发控制的更新
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** last message display -> ordered msg_message
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 统一表示内部助手、候选人 WhatsApp 或会员活动的一段会话，并用类型化外键连接业务对象。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `application_id` → `hr_application.application_id`；`person_id` → `hr_person.person_id`；`member_id` → `pos_member.member_id`；`app_user_id` → `app_user.user_id`
- **被谁连接：** `msg_conversation_state.conversation_id`；`msg_message.conversation_id`；`msg_outbound_message.conversation_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** channel_code + external_conversation_id [NULLS DISTINCT：仅非空值去重，允许多条空值]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** closed_at IS NULL OR closed_at >= opened_at；num_nonnulls(application_id, person_id, member_id, app_user_id) >= 1
- **特别说明：** last_message_at 不重复保存；待跟进排序从 msg_message.occurred_at 的最大值派生并按性能证据决定是否建立物化索引视图。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `conversation_id` | 会话ID | `uuid` | 非空; 默认 gen_random_uuid() | 跨消息和状态稳定的会话身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `9cd2ab24-1a32-53ab-acaf-3e122829c899` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `channel_code` | 渠道代码 | `text` | 非空; 默认 — | WHATSAPP、WEB_CHAT、LARK 或 OTHER。 | 路由发送和解析。 | CHECK channel_code IN ('WHATSAPP','WEB_CHAT','LARK','OTHER') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `WHATSAPP` | msg_conversation.channel_code 只表示本字段说明中的 渠道代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `external_conversation_id` | 外部会话ID | `text` | 可空; 默认 — | 渠道提供的稳定会话或号码哈希标识。 | 同步幂等；不得保存明文手机号作为主键。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `restricted` | `wa_hash_...` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `application_id` | 候选申请ID | `uuid` | 可空; 默认 — | 招聘会话对应申请；不适用为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_application.application_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `3564ea14-b3b1-590c-b1a9-1e4b50e3e6c1` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `person_id` | 人员ID | `uuid` | 可空; 默认 — | 内部或候选人会话对应自然人；不适用为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_person.person_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `974372c0-eeaf-573e-b810-7959c45598c9` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `member_id` | 会员ID | `uuid` | 可空; 默认 — | 会员活动会话对应会员；不适用为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → pos_member.member_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `ca70f98b-3820-5620-9a6b-71b5098f4e17` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `app_user_id` | 应用账号ID | `uuid` | 可空; 默认 — | 内部用户助手会话对应账号；不适用为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `4fd6b173-c818-5b7b-8d90-254f85e85ad7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `status` | 会话状态 | `text` | 非空; 默认 'OPEN' | OPEN、WAITING_USER、WAITING_AGENT、CLOSED、OPTED_OUT 或 BLOCKED。 | 路由和合规。 | CHECK status IN ('OPEN','WAITING_USER','WAITING_AGENT','CLOSED','OPTED_OUT','BLOCKED') | 不适用。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `WAITING_USER` | msg_conversation.status 只表示本字段说明中的 会话状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `opened_at` | 开始时间 | `timestamptz` | 非空; 默认 — | 会话首次创建时间。 | 响应时长。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:00:00+08:00` | msg_conversation.opened_at 只表示本字段说明中的 开始时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `closed_at` | 关闭时间 | `timestamptz` | 可空; 默认 — | 会话结束时间。 | 生命周期。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 12 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE：主数据允许受权限、审计和并发控制的更新。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `msg_message` — 会话消息

- **用途：** 只追加保存会话中的入站、出站和系统消息及经过审核的正文。
- **一行代表：** 会话 × 一条消息一行
- **写入责任：** BakeryOps消息服务
- **读取项目：** BakeryOps、HBTI
- **数据来源：** 渠道入站或应用生成
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 只追加保存会话中的入站、出站和系统消息及经过审核的正文。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 按招聘、会员和内部会话类型分别设置；普通聊天不能无限期保留
- **向外连接：** `conversation_id` → `msg_conversation.conversation_id`；`outbound_message_id` → `msg_outbound_message.outbound_message_id`
- **被谁连接：** `msg_delivery_event.message_id`
- **分析视图：** `v_msg_delivery_current`
- **唯一约束：** conversation_id + external_message_id [NULLS DISTINCT：仅非空值去重，允许多条空值]；outbound_message_id [NULLS DISTINCT：仅非空值去重，允许多条空值]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** conversation_id 已提供渠道命名空间，因此 (conversation_id, external_message_id) 阻止重复入站；同一 outbound_message_id 只形成一条语义消息，渠道重试只写 msg_delivery_attempt，不复制正文。两种外键为空的内部 SYSTEM 消息仍由 message_id 区分。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `message_id` | 消息ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条消息稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `4f316b72-c476-537d-b016-35c45a6ec494` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `conversation_id` | 会话ID | `uuid` | 非空; 默认 — | 消息所属会话。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → msg_conversation.conversation_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `9cd2ab24-1a32-53ab-acaf-3e122829c899` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `outbound_message_id` | 外发消息ID | `uuid` | 可空; 默认 — | 该消息由队列发送时连接原外发任务；入站或系统消息为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → msg_outbound_message.outbound_message_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e337b2b5-c757-5333-bb78-4277def70e23` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `external_message_id` | 外部消息ID | `text` | 可空; 默认 — | 渠道提供的稳定消息ID。 | 同步幂等。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `wamid.HBg...` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `direction` | 方向 | `text` | 非空; 默认 — | INBOUND、OUTBOUND 或 SYSTEM。 | 区分用户和系统内容。 | CHECK direction IN ('INBOUND','OUTBOUND','SYSTEM') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `INBOUND` | msg_message.direction 只表示本字段说明中的 方向；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `sender_type` | 发送者类型 | `text` | 非空; 默认 — | PERSON、MEMBER、APP_USER、SERVICE 或 CHANNEL。 | 解释发送主体。 | CHECK sender_type IN ('PERSON','MEMBER','APP_USER','SERVICE','CHANNEL') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `PERSON` | msg_message.sender_type 只表示本字段说明中的 发送者类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `content_type` | 内容类型 | `text` | 非空; 默认 — | TEXT、IMAGE、FILE、AUDIO、TEMPLATE 或 EVENT。 | 选择存储和展示方式。 | CHECK content_type IN ('TEXT','IMAGE','FILE','AUDIO','TEMPLATE','EVENT') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `TEXT` | msg_message.content_type 只表示本字段说明中的 内容类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `content_text` | 消息文本 | `text` | 可空; 默认 — | 经过保留政策和必要脱敏的文本内容。 | 对话和流程理解；访问受限。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `restricted` | `我可以周三面试` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `content_ref` | 媒体引用 | `text` | 可空; 默认 — | 受控对象存储中的媒体或文件引用。 | 避免把大文件和秘密直接存数据库。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `restricted` | `s3://.../hash` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `occurred_at` | 消息发生时间 | `timestamptz` | 非空; 默认 — | 渠道认定的发送或接收时间。 | 会话排序。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:20:00+08:00` | msg_message.occurred_at 只表示本字段说明中的 消息发生时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `acceptance_status` | 首次接收状态 | `text` | 非空; 默认 — | RECEIVED、QUEUED、SENT、FAILED 或 REJECTED。 | 冻结消息首次进入本系统或渠道时的状态；后续 DELIVERED、READ 等变化写 delivery_event。 | CHECK acceptance_status IN ('RECEIVED','QUEUED','SENT','FAILED','REJECTED') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `RECEIVED` | msg_message.acceptance_status 只表示本字段说明中的 首次接收状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `metadata` | 消息元数据 | `jsonb` | 非空; 默认 '{}'::jsonb | 模板代码、语言和不含秘密的渠道属性。 | 保留必要渠道信息。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `{"language":"zh"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `msg_conversation_state` — 会话流程状态

- **用途：** 保存招聘或助手多轮流程的当前节点、已收集参数和到期时间；完成后仍保留最终状态摘要。
- **一行代表：** 会话 × 工作流代码一行
- **写入责任：** BakeryOps编排器
- **读取项目：** BakeryOps
- **数据来源：** 会话状态机
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_WORKFLOW` — 只允许批准的状态机迁移并记录操作者和时间
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 保存招聘或助手多轮流程的当前节点、已收集参数和到期时间；完成后仍保留最终状态摘要。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `conversation_id` → `msg_conversation.conversation_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** conversation_id + workflow_code
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 这是为恢复多轮会话而保存的当前检查点，不是完整状态历史；业务事实仍写各自业务表，消息过程写 msg_message，关键状态变更写 app_audit_event。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `conversation_state_id` | 流程状态ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条会话工作流状态稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `3591664d-4084-5611-a2ce-29e38709cef5` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `conversation_id` | 会话ID | `uuid` | 非空; 默认 — | 状态所属会话。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → msg_conversation.conversation_id | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `9cd2ab24-1a32-53ab-acaf-3e122829c899` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `workflow_code` | 工作流代码 | `text` | 非空; 默认 — | RECRUITMENT、DAILY_REVIEW、ORDERING 等稳定流程代码。 | 选择状态机定义。 | CHECK workflow_code ~ '^[A-Z][A-Z0-9_]{1,63}$' | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `RECRUITMENT` | msg_conversation_state.workflow_code 只表示本字段说明中的 工作流代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `workflow_version` | 工作流版本 | `text` | 非空; 默认 — | 状态机结构版本。 | 升级后仍可恢复旧会话。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `recruit-v4` | msg_conversation_state.workflow_version 只表示本字段说明中的 工作流版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `state_code` | 当前状态 | `text` | 非空; 默认 — | 工作流内当前节点代码。 | 决定下一步允许动作。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `WAITING_TRIAL_DATE` | msg_conversation_state.state_code 只表示本字段说明中的 当前状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `collected_data` | 已收集参数 | `jsonb` | 非空; 默认 '{}'::jsonb | 已通过 schema 校验的非敏感或受限参数。 | 跨轮次继续流程。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `restricted` | `{"preferred_date":"2026-08-12"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 7 | `pending_action` | 待确认动作 | `jsonb` | 可空; 默认 — | 需要用户确认后才执行的结构化动作。 | 防止未经确认直接写业务事实。 | — | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `internal` | `{"action":"BOOK_TRIAL"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `expires_at` | 状态到期时间 | `timestamptz` | 可空; 默认 — | 无活动时状态自动失效时间。 | 清理临时流程。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T10:40:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `status` | 状态记录状态 | `text` | 非空; 默认 'ACTIVE' | ACTIVE、COMPLETED、EXPIRED、CANCELLED 或 ERROR。 | 流程生命周期。 | CHECK status IN ('ACTIVE','COMPLETED','EXPIRED','CANCELLED','ERROR') | 不适用。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `ACTIVE` | msg_conversation_state.status 只表示本字段说明中的 状态记录状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 11 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_WORKFLOW：只允许批准的状态机迁移并记录操作者和时间。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `msg_outbound_message` — 外发消息队列

- **用途：** 保存待发送消息、业务推送自然键、最早发送时间、幂等键和队列状态；投递次数、最后错误和成功去重结论从投递事实派生。
- **一行代表：** 一次计划外发消息一行
- **写入责任：** BakeryOps消息服务
- **读取项目：** BakeryOps、HBTI
- **数据来源：** 招聘、运营推送或活动通知
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_QUEUE_STATE` — 只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** attempt count and last error -> ordered msg_delivery_attempt；successful daily-push deduplication -> queue natural key + delivery facts
- **R6 审计动作：** R6_MERGE_INTO: absorb msg_push_deduplication; queue natural key plus delivery facts determines success
- **为何存表而不是现算视图：** 保存待发送消息、业务推送自然键、最早发送时间、幂等键和队列状态；投递次数、最后错误和成功去重结论从投递事实派生。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `conversation_id` → `msg_conversation.conversation_id`；`job_run_id` → `app_job_run.job_run_id`；`review_action_id` → `ops_review_action.review_action_id`；`ai_call_id` → `ai_call.ai_call_id`；`appointment_id` → `hr_appointment.appointment_id`；`campaign_member_id` → `mkt_campaign_member.campaign_member_id`；`queued_by_user_id` → `app_user.user_id`
- **被谁连接：** `msg_delivery_attempt.outbound_message_id`；`msg_delivery_event.outbound_message_id`；`msg_message.outbound_message_id`
- **分析视图：** `v_msg_delivery_current`
- **唯一约束：** idempotency_key；push_kind + recipient_ref + business_date [NULLS DISTINCT：仅非空值去重，允许多条空值]
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** expires_at IS NULL OR expires_at > earliest_send_at；(push_kind IS NULL) = (business_date IS NULL)；(template_code IS NULL) = (template_version IS NULL)；num_nonnulls(conversation_id, job_run_id, review_action_id, ai_call_id, appointment_id, campaign_member_id, queued_by_user_id) >= 1
- **特别说明：** R6 终审将 msg_push_deduplication 合并到本表：push_kind + recipient_ref + business_date 是业务去重自然键，idempotency_key 是执行去重键；是否成功、尝试次数和最后错误分别从 msg_delivery_attempt 与可选 msg_delivery_event 确定性派生。payload 必须按 template_code + template_version 的固定 schema 经受控入队函数校验，未知键拒绝。失败重跑必须恢复同一 outbound_message，不新增重复消息。新模块要发消息时必须先增加明确 UUID 外键或专用关联表；禁止使用 extension_source_type/id 多态文本绕过稳定关系。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `outbound_message_id` | 外发消息ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次外发任务稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `e337b2b5-c757-5333-bb78-4277def70e23` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `conversation_id` | 会话ID | `uuid` | 可空; 默认 — | 消息所属会话；一次性广播可为空并由 recipient_ref 指定。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → msg_conversation.conversation_id | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `9cd2ab24-1a32-53ab-acaf-3e122829c899` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `job_run_id` | 任务运行ID | `uuid` | 可空; 默认 — | 由定时或批处理任务产生时连接具体运行。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `review_action_id` | 复盘行动ID | `uuid` | 可空; 默认 — | 消息用于推动某项复盘改进行动时连接该行动。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ops_review_action.review_action_id | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `faaa6821-9281-5916-94f4-07143f20a93e` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `ai_call_id` | AI调用ID | `uuid` | 可空; 默认 — | 消息内容由某次 AI 调用建议或生成时连接该调用。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ai_call.ai_call_id | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `b54a374d-3dfa-5920-b9b1-67c507eefc5b` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `appointment_id` | 预约ID | `uuid` | 可空; 默认 — | 招聘面试或试工提醒连接具体预约。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → hr_appointment.appointment_id | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `c38e70d2-c9d5-52b4-9121-b6507f575772` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `campaign_member_id` | 活动会员ID | `uuid` | 可空; 默认 — | 营销或 HBTI 通知连接具体会员活动参与。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → mkt_campaign_member.campaign_member_id | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `7e810e39-f83d-5a4c-8626-de67f132680f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `queued_by_user_id` | 入队账号 | `uuid` | 可空; 默认 — | 人工创建消息时记录操作账号；系统任务可为空并使用 job_run_id。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `f5a6c48b-8aa0-5399-a045-b8462af6dfb7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `channel_code` | 渠道代码 | `text` | 非空; 默认 — | WHATSAPP、LARK、EMAIL 或 OTHER。 | 选择发送适配器。 | CHECK channel_code IN ('WHATSAPP','LARK','EMAIL','OTHER') | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `WHATSAPP` | msg_outbound_message.channel_code 只表示本字段说明中的 渠道代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `recipient_ref` | 接收者引用 | `text` | 非空; 默认 — | 受控联系方式ID、渠道用户ID或哈希引用，不保存散落明文手机号。 | 发送器解析真实目标。 | — | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `restricted` | `person_contact:...` | msg_outbound_message.recipient_ref 只表示本字段说明中的 接收者引用；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `push_kind` | 业务推送类型 | `text` | 可空; 默认 — | MORNING_BRIEF、PRODUCTION_PLAN、ORDER_REMINDER 等稳定代码；非按日业务推送为空。 | 与 recipient_ref、business_date 构成可读业务自然键，不从幂等字符串反向解析。 | CHECK push_kind IS NULL OR push_kind ~ '^[A-Z][A-Z0-9_]{1,63}$' | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `MORNING_BRIEF` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `business_date` | 推送业务日期 | `date` | 可空; 默认 — | 该业务推送针对的营业或日历日期；非按日消息为空。 | 保证同一类每日推送可按结构化字段核对和去重。 | — | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `2026-08-10` | 不要由 created_at 或 UTC 日期临时推导。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `template_code` | 消息模板代码 | `text` | 可空; 默认 — | 批准模板代码；自由文本消息可为空。 | 内容治理和多语言。 | — | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `TRIAL_REMINDER_V2` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `template_version` | 消息模板版本 | `integer` | 可空; 默认 — | payload 校验与渲染采用的批准模板版本；自由文本消息为空。 | 冻结历史消息的参数结构，避免同一 template_code 升级后旧 payload 失去解释。 | CHECK template_version IS NULL OR template_version > 0 | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `2` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `payload` | 模板参数 | `jsonb` | 非空; 默认 '{}'::jsonb | 通过模板 schema 校验的参数。 | 渲染消息；敏感值最小化。 | — | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `restricted` | `{"date":"2026-08-12"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 16 | `idempotency_key` | 幂等键 | `text` | 非空; 默认 — | 业务生成的唯一去重键。 | 服务重启或重跑不重复发送。 | UNIQUE | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `trial-reminder:appointment:...:24h` | msg_outbound_message.idempotency_key 只表示本字段说明中的 幂等键；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 17 | `earliest_send_at` | 最早发送时间 | `timestamptz` | 非空; 默认 — | 消息允许发送的最早时间。 | 遵守业务时间窗和延迟。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `2026-08-11T10:00:00+08:00` | msg_outbound_message.earliest_send_at 只表示本字段说明中的 最早发送时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 18 | `expires_at` | 消息到期时间 | `timestamptz` | 可空; 默认 — | 超过此时间不再发送。 | 避免过期提醒。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `2026-08-12T09:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `priority` | 优先级 | `smallint` | 非空; 默认 100 | 数字越小优先级越高。 | 队列排序。 | — | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `50` | msg_outbound_message.priority 只表示本字段说明中的 优先级；必须在所属对象粒度内按 smallint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 20 | `status` | 队列状态 | `text` | 非空; 默认 'QUEUED' | QUEUED、PROCESSING、SENT、FAILED、CANCELLED 或 EXPIRED。 | 发送生命周期。 | CHECK status IN ('QUEUED','PROCESSING','SENT','FAILED','CANCELLED','EXPIRED') | 不适用。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `QUEUED` | msg_outbound_message.status 只表示本字段说明中的 队列状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 21 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 22 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_QUEUE_STATE：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `msg_delivery_attempt` — 消息投递尝试

- **用途：** 只追加记录外发消息每次调用渠道、结果、外部消息ID和脱敏错误。
- **一行代表：** 外发消息 × 一次发送尝试一行
- **写入责任：** BakeryOps消息worker
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 渠道发送结果
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 只追加记录外发消息每次调用渠道、结果、外部消息ID和脱敏错误。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `outbound_message_id` → `msg_outbound_message.outbound_message_id`
- **被谁连接：** `msg_delivery_event.delivery_attempt_id`
- **分析视图：** `v_msg_delivery_current`
- **唯一约束：** outbound_message_id + attempt_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** finished_at IS NULL OR finished_at >= started_at

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `delivery_attempt_id` | 投递尝试ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次发送尝试稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `22142b35-8c41-5197-8f9b-2f988d34b883` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `outbound_message_id` | 外发消息ID | `uuid` | 非空; 默认 — | 所属队列消息。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → msg_outbound_message.outbound_message_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e337b2b5-c757-5333-bb78-4277def70e23` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `attempt_no` | 尝试序号 | `integer` | 非空; 默认 — | 消息内从1递增的尝试次数。 | 重试排序。 | CHECK attempt_no > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `1` | msg_delivery_attempt.attempt_no 只表示本字段说明中的 尝试序号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `started_at` | 开始时间 | `timestamptz` | 非空; 默认 — | 调用渠道开始时间。 | 渠道延迟。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-11T10:00:01+08:00` | msg_delivery_attempt.started_at 只表示本字段说明中的 开始时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `finished_at` | 结束时间 | `timestamptz` | 可空; 默认 — | 渠道调用结束时间。 | 耗时和卡死检测。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-11T10:00:02+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `result` | 投递结果 | `text` | 非空; 默认 — | SENT、RETRYABLE_FAILURE、PERMANENT_FAILURE 或 UNKNOWN。 | 决定重试。 | CHECK result IN ('SENT','RETRYABLE_FAILURE','PERMANENT_FAILURE','UNKNOWN') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `SENT` | msg_delivery_attempt.result 只表示本字段说明中的 投递结果；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `external_message_id` | 渠道消息ID | `text` | 可空; 默认 — | 渠道成功返回的消息标识。 | 后续送达回执关联。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `wamid.HBg...` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `http_status` | HTTP状态 | `integer` | 可空; 默认 — | 渠道 API HTTP 状态码。 | 排障。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `200` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `error_code` | 错误代码 | `text` | 可空; 默认 — | 渠道或适配器标准错误代码。 | 重试分类。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `RATE_LIMITED` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `error_detail` | 错误摘要 | `text` | 可空; 默认 — | 经过脱敏的错误信息。 | 排障，不得保存令牌或完整消息正文。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `internal` | `429 from provider` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `msg_delivery_event` — 消息投递状态事件

- **用途：** 只追加保存渠道回执中的 SENT、DELIVERED、READ、FAILED 等状态变化，避免覆盖消息历史状态。
- **一行代表：** 外发消息 × 一次渠道状态事件一行
- **写入责任：** BakeryOps消息回执服务
- **读取项目：** BakeryOps、HBTI、分析/BI
- **数据来源：** WhatsApp、邮件或其他渠道 webhook/轮询回执
- **实施层级：** `EXTENSION_PACK:CHANNEL_RECEIPTS`
- **生命周期：** `PLANNED_MODULE`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `NOT_PHASE1_EXTENSION_ONLY`；存储类别 `EXTENSION_PACK`；可派生性 `NOT_APPLICABLE_UNTIL_MODULE_ENABLED`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** DESIGN_ONLY_DO_NOT_CREATE
- **为何存表而不是现算视图：** 只追加保存渠道回执中的 SENT、DELIVERED、READ、FAILED 等状态变化，避免覆盖消息历史状态。；只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建。
- **保留策略：** 按消息类型的保留策略保存；不得因清理正文而破坏投递审计
- **向外连接：** `outbound_message_id` → `msg_outbound_message.outbound_message_id`；`message_id` → `msg_message.message_id`；`delivery_attempt_id` → `msg_delivery_attempt.delivery_attempt_id`；`source_system_id` → `app_source_system.source_system_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** `v_msg_delivery_current`
- **唯一约束：** source_system_id + source_event_id
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** received_at >= occurred_at
- **特别说明：** 当前状态由事件时间、状态优先级和 delivery_event_id 确定性派生；迟到回执不会覆盖或删除旧事件。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `delivery_event_id` | 投递事件ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次渠道投递状态事件稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `fa4bafd2-c615-501a-8ebc-059f26d9900a` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `outbound_message_id` | 外发消息ID | `uuid` | 非空; 默认 — | 状态所属外发队列任务。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → msg_outbound_message.outbound_message_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `e337b2b5-c757-5333-bb78-4277def70e23` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `message_id` | 会话消息ID | `uuid` | 可空; 默认 — | 对应已持久化会话消息；回执早于消息落库时可为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → msg_message.message_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `4f316b72-c476-537d-b016-35c45a6ec494` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `delivery_attempt_id` | 投递尝试ID | `uuid` | 可空; 默认 — | 能确定由哪次发送尝试产生时连接；渠道未提供时为空。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → msg_delivery_attempt.delivery_attempt_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `22142b35-8c41-5197-8f9b-2f988d34b883` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `source_system_id` | 来源系统ID | `uuid` | 非空; 默认 — | 返回状态的注册消息渠道。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_source_system.source_system_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `7996d63a-5925-5972-9ea2-b51d0882c497` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 这是来源系统证据，不等于企业统一身份。 |
| 6 | `source_event_id` | 来源事件ID | `text` | 非空; 默认 — | 渠道 webhook 或回执的稳定事件编号。 | 与来源系统共同保证重复回调不会重复入库。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `internal` | `wa-status-998812` | 这是来源系统证据，不等于企业统一身份。 |
| 7 | `external_message_id` | 渠道消息ID | `text` | 可空; 默认 — | 渠道给该消息的稳定标识。 | 无法关联 attempt 时辅助进入映射/质量队列，但不单独作为跨域连接键。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `wamid.HBg...` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `event_type` | 投递事件类型 | `text` | 非空; 默认 — | SENT、DELIVERED、READ、FAILED、REJECTED 或 UNKNOWN。 | 按时间重建送达状态和失败漏斗。 | CHECK event_type IN ('SENT','DELIVERED','READ','FAILED','REJECTED','UNKNOWN') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `DELIVERED` | msg_delivery_event.event_type 只表示本字段说明中的 投递事件类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `occurred_at` | 渠道发生时间 | `timestamptz` | 非空; 默认 — | 渠道声明状态发生的绝对时间。 | 送达耗时和事件排序。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-11T10:00:04+08:00` | msg_delivery_event.occurred_at 只表示本字段说明中的 渠道发生时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `received_at` | 本系统接收时间 | `timestamptz` | 非空; 默认 now() | 本系统收到回执的绝对时间。 | 区分渠道延迟和摄取延迟。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-11T10:00:05+08:00` | msg_delivery_event.received_at 只表示本字段说明中的 本系统接收时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `payload_sha256` | 回执载荷哈希 | `char(64)` | 非空; 默认 — | 规范化渠道回执的 SHA-256，不保存秘密或完整原始载荷。 | 证明去重和排查解析差异。 | — | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `b82e...64位十六进制` | msg_delivery_event.payload_sha256 只表示本字段说明中的 回执载荷哈希；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

# AI — Prompt版本与AI调用

## `ai_prompt_segment` — Prompt片段版本

- **用途：** 一行冻结一个可复用 Prompt 片段版本的内容、变量结构和校验值；不在每个模板关联中重复复制内容。
- **一行代表：** Prompt片段代码 × 版本号一行
- **写入责任：** BakeryOps AI配置
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** AI管理员配置
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 一行冻结一个可复用 Prompt 片段版本的内容、变量结构和校验值；不在每个模板关联中重复复制内容。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `ai_prompt_template_segment.prompt_segment_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** segment_code + version_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 同一 segment_code 的内容变化只新增 version_no；模板关联只保存片段版本外键和组合顺序，不重复存 content、hash 或 variable_schema。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `prompt_segment_id` | 片段版本ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版 Prompt 片段稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ea942cf7-d8f8-5452-9441-f5dcd209a42f` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `segment_code` | 片段代码 | `text` | 非空; 默认 — | 程序引用的稳定片段代码。 | 与 version_no 共同选择具体内容。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `DAILY_REVIEW_RULES` | ai_prompt_segment.segment_code 只表示本字段说明中的 片段代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `version_no` | 片段版本号 | `integer` | 非空; 默认 — | 同一片段代码内从 1 递增的版本号。 | 内容改变时新增版本，不覆盖旧模板所用内容。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `3` | ai_prompt_segment.version_no 只表示本字段说明中的 片段版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `segment_name` | 片段名称 | `text` | 非空; 默认 — | 该版本发布时的显示名称。 | 配置界面和历史审计。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `每日复盘规则` | ai_prompt_segment.segment_name 只表示本字段说明中的 片段名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `segment_category` | 片段类别 | `text` | 非空; 默认 — | ROLE、RULE、KNOWLEDGE、CONTEXT 或 FORMAT。 | 控制组合顺序和审查。 | CHECK segment_category IN ('ROLE','RULE','KNOWLEDGE','CONTEXT','FORMAT') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `RULE` | ai_prompt_segment.segment_category 只表示本字段说明中的 片段类别；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `content` | 片段内容 | `text` | 非空; 默认 — | 本片段版本冻结的 Prompt 文本。 | 多个模板通过外键复用同一内容，旧调用不受后续版本影响。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `你是每日复盘助手...` | ai_prompt_segment.content 只表示本字段说明中的 片段内容；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `content_sha256` | 内容校验值 | `char(64)` | 非空; 默认 — | 片段内容 SHA-256。 | 验证部署和调用采用同一版本。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `21b0...64位十六进制` | ai_prompt_segment.content_sha256 只表示本字段说明中的 内容校验值；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `variable_schema` | 变量Schema | `jsonb` | 非空; 默认 '{}'::jsonb | 本片段允许注入的变量及类型。 | 防止未声明变量和提示注入。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"business_date":{"type":"string"}}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 9 | `status` | 版本状态 | `text` | 非空; 默认 'DRAFT' | DRAFT、APPROVED、ACTIVE、RETIRED 或 REJECTED。 | 只有 ACTIVE 可加入新模板；旧模板仍可引用已退役版本。 | CHECK status IN ('DRAFT','APPROVED','ACTIVE','RETIRED','REJECTED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ACTIVE` | ai_prompt_segment.status 只表示本字段说明中的 版本状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准该片段版本的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 该片段版本获批时间。 | 审计内容何时可用于生产。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-01T09:30:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 14 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ai_prompt_template` — Prompt模板版本

- **用途：** 一行冻结一个 AI 场景模板版本的模型、参数、输出 schema 和安全策略；不再为稳定模板头另拆版本表。
- **一行代表：** AI场景代码 × 版本号一行
- **写入责任：** BakeryOps AI配置
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** AI管理员发布
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `DRAFT_MUTABLE_THEN_FROZEN` — 草稿可编辑；发布、发送或生效后冻结并新建版本
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** R6_MERGE_INTO: each row is one immutable template version; no separate template-version table
- **为何存表而不是现算视图：** 一行冻结一个 AI 场景模板版本的模型、参数、输出 schema 和安全策略；不再为稳定模板头另拆版本表。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `approved_by_user_id` → `app_user.user_id`；`created_by_user_id` → `app_user.user_id`
- **被谁连接：** `ai_call.prompt_template_id`；`ai_prompt_template_segment.prompt_template_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** template_code + version_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 同一 template_code 的新配置只新增 version_no；ai_call 与片段行直接引用本版本主键。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `prompt_template_id` | 模板版本ID | `uuid` | 非空; 默认 gen_random_uuid() | 一版 Prompt 模板稳定身份。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `31a7e519-9430-5234-8d72-b3f041f8eee3` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `template_code` | 模板代码 | `text` | 非空; 默认 — | 程序调用的稳定 AI 场景代码。 | 与 version_no 共同选择具体版本。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `DAILY_REVIEW` | ai_prompt_template.template_code 只表示本字段说明中的 模板代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `version_no` | 版本号 | `integer` | 非空; 默认 — | 场景代码内递增版本。 | 历史调用可重现。 | CHECK version_no > 0 | 不适用。; 版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。 | `none` | `4` | ai_prompt_template.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `template_name` | 模板名称 | `text` | 非空; 默认 — | 该版本发布时的显示名称。 | 配置界面和审计。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `每日复盘` | ai_prompt_template.template_name 只表示本字段说明中的 模板名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `purpose` | 模板用途 | `text` | 非空; 默认 — | 该版本允许生成的内容和禁止用途。 | 降低场景误用。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `总结已确认经营事实并提出可验证行动` | ai_prompt_template.purpose 只表示本字段说明中的 模板用途；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `model_provider` | 模型提供方 | `text` | 非空; 默认 — | OPENAI、OPENROUTER、GEMINI 或批准提供方。 | 调用路由和成本。 | CHECK model_provider ~ '^[A-Z][A-Z0-9_]{1,31}$' | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `OPENROUTER` | ai_prompt_template.model_provider 只表示本字段说明中的 模型提供方；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `model_name` | 模型名称 | `text` | 非空; 默认 — | 发布时批准的具体模型标识。 | 历史调用解释。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `openai/gpt-5` | ai_prompt_template.model_name 只表示本字段说明中的 模型名称；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `temperature` | 温度 | `numeric(5,4)` | 非空; 默认 0 | 模型采样温度。 | 重现和风险控制。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `0.2` | ai_prompt_template.temperature 只表示本字段说明中的 温度；必须在所属对象粒度内按 numeric(5,4) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `top_p` | Top P | `numeric(5,4)` | 非空; 默认 1 | 核采样参数。 | 重现。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `1` | ai_prompt_template.top_p 只表示本字段说明中的 Top P；必须在所属对象粒度内按 numeric(5,4) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `output_schema` | 输出Schema | `jsonb` | 非空; 默认 '{}'::jsonb | 要求模型输出的 JSON Schema。 | 结构化结果验证。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `{"type":"object"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 11 | `safety_policy_version` | 安全策略版本 | `text` | 非空; 默认 — | PII、秘密、提示注入和输出使用限制版本。 | 证明调用采用的治理规则。 | — | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ai-safety-v3` | ai_prompt_template.safety_policy_version 只表示本字段说明中的 安全策略版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `status` | 版本状态 | `text` | 非空; 默认 — | DRAFT、APPROVED、ACTIVE、RETIRED 或 REJECTED。 | 只有 ACTIVE 可用于新调用。 | CHECK status IN ('DRAFT','APPROVED','ACTIVE','RETIRED','REJECTED') | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `ACTIVE` | ai_prompt_template.status 只表示本字段说明中的 版本状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `approved_by_user_id` | 批准账号 | `uuid` | 可空; 默认 — | 批准模板版本的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `none` | `bf26d5a4-c925-5882-9760-664e98c3efe7` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `approved_at` | 批准时间 | `timestamptz` | 可空; 默认 — | 模板版本获批时间。 | 审计。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-01T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `created_by_user_id` | 创建账号 | `uuid` | 可空; 默认 — | 触发该次人工或受控系统写入的应用账号。自动任务可以为空并由 job_run_id 追踪。 | 区分谁确认了业务事实与哪个服务实际执行 SQL。 | FK → app_user.user_id | 不适用。; 随所属版本或生效区间解释；历史行保留。 | `internal` | `018f7f12-7c40-7dc1-a2ac-4a7924c60b21` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 17 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 随所属版本或生效区间解释；历史行保留。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ai_prompt_template_segment` — 模板片段组合

- **用途：** 按顺序连接模板版本和已冻结片段版本，只保存组合关系及消息角色。
- **一行代表：** 模板版本 × 顺序一行
- **写入责任：** BakeryOps AI配置
- **读取项目：** BakeryOps、分析/BI
- **数据来源：** 批准的Prompt片段内容
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `APPEND_ONLY` — 写入后不可修改；更正追加新事实或冲销事件
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** content/hash/variable schema -> referenced ai_prompt_segment version
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 按顺序连接模板版本和已冻结片段版本，只保存组合关系及消息角色。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 业务存续期内保留；归档规则在实施前确认
- **向外连接：** `prompt_template_id` → `ai_prompt_template.prompt_template_id`；`prompt_segment_id` → `ai_prompt_segment.prompt_segment_id`
- **被谁连接：** 当前目标模型无入向外键
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** prompt_template_id + sequence_no
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** 无额外表级 CHECK
- **特别说明：** 最终 Prompt 内容由本行顺序连接 ai_prompt_segment.content 确定；禁止在关联表再复制片段文本、哈希或变量结构。

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `prompt_template_segment_id` | 模板片段行ID | `uuid` | 非空; 默认 gen_random_uuid() | 一条模板片段版本稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `49ea4df3-6b72-5441-92a5-b0b744637bb2` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `prompt_template_id` | 模板版本ID | `uuid` | 非空; 默认 — | 所属 Prompt 模板版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ai_prompt_template.prompt_template_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `31a7e519-9430-5234-8d72-b3f041f8eee3` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `prompt_segment_id` | 片段版本ID | `uuid` | 非空; 默认 — | 引用的已冻结 Prompt 片段版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ai_prompt_segment.prompt_segment_id | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `ea942cf7-d8f8-5452-9441-f5dcd209a42f` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 4 | `sequence_no` | 组合顺序 | `integer` | 非空; 默认 — | 片段进入最终 Prompt 的顺序。 | 重现完整 Prompt。 | CHECK sequence_no > 0 | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2` | ai_prompt_template_segment.sequence_no 只表示本字段说明中的 组合顺序；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `role` | 消息角色 | `text` | 非空; 默认 — | SYSTEM、DEVELOPER、USER 或 CONTEXT。 | 构造模型消息。 | CHECK role IN ('SYSTEM','DEVELOPER','USER','CONTEXT') | 不适用。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `SYSTEM` | ai_prompt_template_segment.role 只表示本字段说明中的 消息角色；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 APPEND_ONLY：写入后不可修改；更正追加新事实或冲销事件。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

## `ai_call` — AI调用流水

- **用途：** 记录一次模型调用的模板版本、调用方、输入引用、输出、token、成本、延迟和验证结果。
- **一行代表：** 一次模型请求一行
- **写入责任：** BakeryOps AI服务
- **读取项目：** BakeryOps、安全管理员、分析/BI
- **数据来源：** 应用AI调用
- **实施层级：** `CORE_PLATFORM`
- **生命周期：** `CORE_MIGRATION`
- **写入/修改策略：** `CONTROLLED_UPDATE_UNTIL_TERMINAL` — 运行或同步进入终态前可更新，终态后冻结并以新运行重算
- **最小粒度终审：** `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT`；存储类别 `CORE_PLATFORM_STATE`；可派生性 `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`
- **可派生字段/输出：** 无额外派生字段；按本表声明粒度作为基础/主数据/流程事实
- **R6 审计动作：** KEEP_IN_PHASE1
- **为何存表而不是现算视图：** 记录一次模型调用的模板版本、调用方、输入引用、输出、token、成本、延迟和验证结果。；身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表。
- **保留策略：** 脱敏正文按最短必要期限保留；结构化指标可长期保留
- **向外连接：** `prompt_template_id` → `ai_prompt_template.prompt_template_id`；`job_run_id` → `app_job_run.job_run_id`；`actor_user_id` → `app_user.user_id`
- **被谁连接：** `msg_outbound_message.ai_call_id`；`ops_daily_review.ai_call_id`；`ops_production_plan_line.suggested_by_ai_call_id`
- **分析视图：** 无直接视图；可由业务链中的上游视图消费
- **唯一约束：** 仅主键；业务去重由来源幂等键/状态规则决定
- **不可重叠约束：** 无有效区间排斥约束；不代表业务时间可任意重叠
- **表级检查：** completed_at IS NULL OR completed_at >= started_at

| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `ai_call_id` | AI调用ID | `uuid` | 非空; 默认 gen_random_uuid() | 一次模型调用稳定主键。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | PK | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `b54a374d-3dfa-5920-b9b1-67c507eefc5b` | 仅作稳定技术身份；业务展示应使用相应 code/name。 |
| 2 | `prompt_template_id` | 模板版本ID | `uuid` | 非空; 默认 — | 调用使用的已批准模板版本。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → ai_prompt_template.prompt_template_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `31a7e519-9430-5234-8d72-b3f041f8eee3` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 |
| 3 | `job_run_id` | 任务运行ID | `uuid` | 可空; 默认 — | 自动任务触发时对应运行。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_job_run.job_run_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2cff0e88-4f40-599c-b319-40b27b321617` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `actor_user_id` | 操作账号 | `uuid` | 可空; 默认 — | 人工触发调用的账号。 | 作为稳定连接键，避免使用名称、手机号或外部编号跨模块关联。 | FK → app_user.user_id | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `e34d8b81-3f73-52c5-bfa0-158ba9c35656` | 关联时使用该 ID，不要改用名称、手机号或外部编号。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `caller_code` | 调用方代码 | `text` | 非空; 默认 — | 发起调用的模块或函数稳定代码。 | 定位责任和成本。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `daily_review_chat` | ai_call.caller_code 只表示本字段说明中的 调用方代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `request_id` | 请求ID | `text` | 可空; 默认 — | 贯穿应用和数据库的请求追踪号。 | 关联日志。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `req_01J4...` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `model_provider` | 模型提供方 | `text` | 非空; 默认 — | 实际调用的提供方。 | 与模板批准值核对。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `OPENROUTER` | ai_call.model_provider 只表示本字段说明中的 模型提供方；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `model_name` | 实际模型 | `text` | 非空; 默认 — | 提供方最终返回的模型标识。 | 识别路由替换。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `openai/gpt-5` | ai_call.model_name 只表示本字段说明中的 实际模型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `prompt_redacted` | 脱敏Prompt | `text` | 非空; 默认 — | 经过批准规则脱敏后的最终 Prompt 或可审计摘要。 | 排查结果但不长期复制 PII 和秘密。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `restricted` | `<redacted prompt>` | ai_call.prompt_redacted 只表示本字段说明中的 脱敏Prompt；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `input_manifest` | 输入引用清单 | `jsonb` | 非空; 默认 '{}'::jsonb | 业务对象ID、版本和字段摘要。 | 优先引用事实而非复制全量敏感内容。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `internal` | `{"daily_review_id":"..."}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 11 | `response_redacted` | 脱敏响应 | `text` | 可空; 默认 — | 经过策略处理的模型原始输出。 | 离线复核。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `restricted` | `<redacted response>` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `parsed_output` | 结构化输出 | `jsonb` | 可空; 默认 — | 通过输出 Schema 解析的结果。 | 供下游建议界面使用；仍须人工门禁。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `{"actions":[]}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `validation_status` | 输出校验状态 | `text` | 非空; 默认 — | VALID、INVALID_SCHEMA、SAFETY_BLOCKED、INCOMPLETE 或 NOT_APPLICABLE。 | 无效输出不得写业务事实。 | CHECK validation_status IN ('VALID','INVALID_SCHEMA','SAFETY_BLOCKED','INCOMPLETE','NOT_APPLICABLE') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `VALID` | ai_call.validation_status 只表示本字段说明中的 输出校验状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 14 | `input_tokens` | 输入Token | `integer` | 可空; 默认 — | 提供方报告的输入 token 数。 | 成本分析。 | CHECK input_tokens IS NULL OR input_tokens >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `4200` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `output_tokens` | 输出Token | `integer` | 可空; 默认 — | 提供方报告的输出 token 数。 | 成本分析。 | CHECK output_tokens IS NULL OR output_tokens >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `620` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `cost_usd` | 调用成本USD | `numeric(18,8)` | 可空; 默认 — | 本次调用估算或实际美元成本。 | AI成本监控。 | CHECK cost_usd IS NULL OR cost_usd >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `0.01850000` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `latency_ms` | 延迟毫秒 | `integer` | 可空; 默认 — | 从请求到完整响应的耗时。 | 性能监控。 | CHECK latency_ms IS NULL OR latency_ms >= 0 | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `8420` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `status` | 调用状态 | `text` | 非空; 默认 — | RUNNING、SUCCEEDED、FAILED、CANCELLED 或 BLOCKED。 | 识别未终态调用。 | CHECK status IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED') | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `SUCCEEDED` | ai_call.status 只表示本字段说明中的 调用状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 19 | `started_at` | 开始时间 | `timestamptz` | 非空; 默认 — | AI请求开始时间。 | 运行时长。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:00:00+08:00` | ai_call.started_at 只表示本字段说明中的 开始时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 20 | `completed_at` | 结束时间 | `timestamptz` | 可空; 默认 — | 调用进入终态时间。 | 识别卡住调用。 | — | 绝对时间；展示或转营业日时必须使用地点时区。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:00:08+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 21 | `error_code` | 错误代码 | `text` | 可空; 默认 — | 失败时机器可读错误。 | 聚合排障。 | — | 不适用。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `PROVIDER_TIMEOUT` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 22 | `created_at` | 创建时间 | `timestamptz` | 非空; 默认 now() | 该行首次写入数据库的绝对时间。 | 用于审计写入先后、排查延迟；不能代替业务发生时间。 | — | 数据库首次写入时间；不是营业日、发生时间或生效时间。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T10:30:00+08:00` | 不要当作业务发生时间或版本生效时间。 |
| 23 | `updated_at` | 最后更新时间 | `timestamptz` | 非空; 默认 now() | 该行最后一次被允许修改的绝对时间。 | 用于增量同步和并发检查；事实发生时间仍应使用专门字段。 | — | 允许更新的最后落库时间；不能据此重建完整历史。; 写入策略为 CONTROLLED_UPDATE_UNTIL_TERMINAL：运行或同步进入终态前可更新，终态后冻结并以新运行重算。 | `none` | `2026-08-09T11:05:00+08:00` | 不要当作业务发生时间或版本生效时间。 |

# 只读治理视图

这些视图统一跨域分析口径，不允许任何项目写入。

## `v_identity_mapping_gap` — 身份映射缺口

- **用途：** 集中列出尚未确认的地点、POS商品、员工和原料来源身份，并估计影响范围。
- **一行代表：** 一个未确认来源身份或映射问题一行
- **读取项目：** 所有项目、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `UNDEFINED_GRAIN_KEY | AFFECTED_FACT_UNIVERSE_UNDEFINED | GAP_REASON_RULE_UNDEFINED`
- **粒度唯一键：** `UNDEFINED`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `ops_location_source_identity` → `pos_product_listing` → `pos_product_mapping` → `pos_product_mapping_review` → `hr_employment_source_identity` → `hr_employment_mapping_review` → `scm_material_source_identity`
- **物理基表闭包：** `hr_employment_mapping_review`、`hr_employment_source_identity`、`ops_location_source_identity`、`pos_product_listing`、`pos_product_mapping`、`pos_product_mapping_review`、`scm_material_source_identity`
- **说明：** 首期只从核心身份/映射事实确定性列出缺口。若未来由独立工单系统受理，只能引用本视图的规则和证据链接，不得反向成为本视图依赖；采购映射审核扩展也不得改变首期身份缺口口径。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `entity_type` | 身份类型 | `text` | 否 | LOCATION、PRODUCT、EMPLOYMENT 或 MATERIAL。 | 路由到正确审核队列。 | 不适用。 | `PRODUCT` | v_identity_mapping_gap.entity_type 只表示本字段说明中的 身份类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `source_system_id` | 来源系统ID | `uuid` | 否 | 问题来源系统。 | 定位来源责任。 | 不适用。 | `cc179b9f-5b40-5789-b0bc-58190727cd35` | 这是来源系统证据，不等于企业统一身份。 |
| 3 | `source_entity_id` | 外部对象ID | `text` | 否 | 来源系统原始标识。 | 人工审核定位。 | 不适用。 | `8801-1-33291` | 这是来源系统证据，不等于企业统一身份。 |
| 4 | `candidate_stable_id` | 候选稳定ID | `uuid` | 是 | 算法提出的候选统一身份。 | 只做审核提示。 | 不适用。 | `f0909782-8c2a-5491-b713-2d06d1bcee0b` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `reason_code` | 问题原因 | `text` | 否 | 未映射、冲突或低置信度原因。 | 确定修复动作。 | 不适用。 | `MULTIPLE_CANDIDATES` | v_identity_mapping_gap.reason_code 只表示本字段说明中的 问题原因；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `first_seen_at` | 首次发现 | `timestamptz` | 否 | 该缺口首次出现时间。 | 衡量积压时长。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-01T00:00:00+08:00` | v_identity_mapping_gap.first_seen_at 只表示本字段说明中的 首次发现；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `affected_row_count` | 影响行数 | `bigint` | 是 | 受该缺口影响的来源事实行数。 | 按业务影响排序。 | 不适用。 | `2297` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `affected_amount` | 影响金额 | `numeric(18,4)` | 是 | 可计算时受影响销售或采购金额。 | 优先处理有金额影响的问题。 | 不适用。 | `301698.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `v_product_identity` — 产品身份统一视图

- **用途：** 以 POS listing 为全集，显示发生时点有效的 product_id 及排产、品类和映射质量。
- **一行代表：** POS listing × 当前有效映射一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `FIX_MODEL_CONTRACT`
- **稳定阻断码：** `MAPPING_AS_OF_SEMANTICS_UNRESOLVED`
- **粒度唯一键：** `listing_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `pos_product_listing` → `pos_product_mapping` → `ops_product`
- **物理基表闭包：** `ops_product`、`pos_product_listing`、`pos_product_mapping`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `listing_id` | Listing ID | `uuid` | 否 | POS来源商品身份。 | 来源销售事实连接。 | 不适用。 | `f719aafd-2e51-595c-823f-c34aded761a9` | v_product_identity.listing_id 只表示本字段说明中的 Listing ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `location_id` | 地点ID | `uuid` | 是 | listing 所属地点。 | 门店级产品分析。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `source_item_key` | 来源商品键 | `text` | 否 | POS原始组合键。 | 兼容来源排查。 | 不适用。 | `8801-1-33291` | 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_name` | 来源名称 | `text` | 否 | POS当前名称。 | 显示来源。 | 不适用。 | `Dark Chocolate Wellington` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `product_id` | 产品ID | `uuid` | 是 | 已确认统一产品身份。 | 跨预测、成本和销售连接。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `product_code` | 产品代码 | `text` | 是 | 统一产品代码。 | 业务展示。 | 不适用。 | `HC-P-0042` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `product_name` | 产品名称 | `text` | 是 | 统一产品当前名称。 | 业务展示。 | 不适用。 | `黑巧惠灵顿` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `is_production_planned` | 是否排产 | `boolean` | 是 | 产品是否进入生产计划。 | 解释无预测是否正常。 | 不适用。 | `true` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `mapping_status` | 映射状态 | `text` | 是 | CONFIRMED、PENDING或缺失。 | 质量门禁。 | 不适用。 | `CONFIRMED` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `v_pos_sales_day_current` — 当前POS日销售

- **用途：** 为每个地点营业日选择最新且符合质量要求的 POS 日销售批次。
- **一行代表：** 地点 × 营业日一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `PASS_SELECT_SPEC`
- **稳定阻断码：** `NONE`
- **粒度唯一键：** `location_id + business_date`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `pos_sales_day` → `pos_ingest_batch`
- **物理基表闭包：** `pos_ingest_batch`、`pos_sales_day`
- **说明：** 确定性选版：只接受 batch.dataset_code='SALES_DAY'、batch.status='SUCCEEDED' 且 fact.quality_status='COMPLETE'；排除被另一合格 SALES_DAY 批次 supersedes 的批次；按 location_id,business_date 分组后依次按 batch.completed_at DESC NULLS LAST、batch.created_at DESC、batch.pos_ingest_batch_id DESC 取一行。没有合格批次则不返回 0，而由质量视图报告缺失。average_order_value 与 discount_rate 只在分子分母齐全且分母非零时派生；source_average_order_value 仅用于来源对账。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 销售地点。 | 跨域连接。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_sales_day_current.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 销售营业日。 | 跨域日期键。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `sales_day_id` | 日销售ID | `uuid` | 否 | 被选中的来源事实。 | 追溯原始批次。 | 不适用。 | `8aae4bfc-bcb4-5f8c-b9d9-08fb105f538d` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 4 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 否 | 被选中批次。 | 质量和重跑审计。 | 不适用。 | `338eeff7-033b-56b3-8bb0-aa9f36eb71a3` | v_pos_sales_day_current.pos_ingest_batch_id 只表示本字段说明中的 POS批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `gross_sales` | 流水金额 | `numeric(18,4)` | 是 | 当前有效日流水；来源未提供时为空。 | 经营展示；NULL 不得当成 0。 | 不适用。 | `55000` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `discount_amount` | 来源折扣金额 | `numeric(18,4)` | 是 | 当前有效日事实中的来源折扣原值。 | 促销分析；缺失保持 NULL。 | 不适用。 | `1250` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `refund_amount` | 来源退款金额 | `numeric(18,4)` | 是 | 当前有效日事实中的来源退款原值。 | 退款核对；缺失保持 NULL。 | 不适用。 | `80` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `net_sales` | 净销售额 | `numeric(18,4)` | 否 | 当前有效日净销售。 | 毛利和人效分母。 | 不适用。 | `53670` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 9 | `order_count` | 订单数 | `integer` | 是 | 当前有效来源订单数；来源未提供时为空。 | 客单价；NULL 不得当成零单。 | 不适用。 | `842` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `source_average_order_value` | 来源平均客单观察 | `numeric(18,4)` | 是 | 上游日汇总直接返回的平均客单原值；不是本视图计算值。 | 与规范派生客单核对来源舍入或口径差。 | 不适用。 | `63.74` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `average_order_value` | 平均客单价 | `numeric(18,4)` | 是 | net_sales 除 order_count；订单数为0时为空。 | 作为可重算展示指标，不在基础事实重复存储。 | 不适用。 | `63.74` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `discount_rate` | 折扣率 | `numeric(12,8)` | 是 | discount_amount 除 gross_sales；任一分子/分母缺失或分母为0时为空。 | 替代旧 discount_rate 缓存，并要求同时展示分子和分母。 | 不适用。 | `0.02272727` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `source_guest_count` | 来源顾客计数 | `integer` | 是 | 上游日汇总返回的顾客/人数原值；缺失时为空。 | 只做来源对账，不得解释为进店客流或去重顾客。 | 不适用。 | `1012` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `currency` | 币种 | `char(3)` | 否 | 金额币种。 | 防止跨币种误加。 | 不适用。 | `MYR` | v_pos_sales_day_current.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 15 | `quality_status` | 质量状态 | `text` | 否 | 被选中事实的完整性状态。 | 必须与金额共同展示。 | 不适用。 | `COMPLETE` | v_pos_sales_day_current.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_pos_sales_hour_current` — 当前POS小时销售

- **用途：** 为每个地点、营业日和小时只选择一批合格的 SALES_HOUR 来源事实，阻止日常重跑被重复汇总。
- **一行代表：** 地点 × 营业日 × 小时一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `PASS_SELECT_SPEC`
- **稳定阻断码：** `NONE`
- **粒度唯一键：** `location_id + business_date + hour_started_at`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `pos_sales_hour` → `pos_ingest_batch`
- **物理基表闭包：** `pos_ingest_batch`、`pos_sales_hour`
- **说明：** 只读取 dataset_code='SALES_HOUR' 且 batch.status='SUCCEEDED' 的批次；排除被另一合格 SALES_HOUR 批次 supersedes 的批次；按 location_id,business_date 先以 completed_at DESC NULLS LAST、created_at DESC、batch_id DESC 选唯一批次，再输出该批所有小时。若所选批次同一小时不唯一则整批质量失败，不用 DISTINCT 掩盖。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `sales_hour_id` | 小时销售ID | `uuid` | 否 | 被确定性选中的小时销售事实ID。 | 回查来源事实。 | 不适用。 | `1065c4ee-4c87-5a11-9347-e7c9d2b023c7` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 否 | 当前小时事实采用的唯一合格批次。 | 作为修订键和来源血缘。 | 不适用。 | `338eeff7-033b-56b3-8bb0-aa9f36eb71a3` | v_pos_sales_hour_current.pos_ingest_batch_id 只表示本字段说明中的 POS批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `location_id` | 地点ID | `uuid` | 否 | 销售发生地点。 | 门店分组和跨域连接。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_sales_hour_current.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `business_date` | 营业日期 | `date` | 否 | 该小时所属营业日。 | 与日销售、计划和工时连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 5 | `hour_started_at` | 小时开始时间 | `timestamptz` | 否 | 统计桶的绝对开始时间。 | 避免跨午夜和时区歧义。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-08T14:00:00+08:00` | v_pos_sales_hour_current.hour_started_at 只表示本字段说明中的 小时开始时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `gross_sales` | 流水金额 | `numeric(18,4)` | 否 | 当前批次的小时流水原值。 | 时段表现和日表核对。 | 不适用。 | `4800.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 7 | `discount_amount` | 来源折扣金额 | `numeric(18,4)` | 是 | 当前批次的小时折扣来源原值。 | 保留与日表独立的小时折扣口径；缺失保持 NULL。 | 不适用。 | `150.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `net_sales` | 净销售额 | `numeric(18,4)` | 否 | 当前批次的小时净销售原值。 | 日销售和人效核对。 | 不适用。 | `4650.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 9 | `order_count` | 订单数 | `integer` | 否 | 当前批次的小时有效订单数。 | 小时订单汇总和客单派生。 | 不适用。 | `72` | v_pos_sales_hour_current.order_count 只表示本字段说明中的 订单数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `source_guest_count` | 来源顾客计数 | `integer` | 是 | 当前批次 RES num_of_guests 原值；缺失时为空。 | 仅用于来源对账，不得解释为进店客流或去重顾客。 | 不适用。 | `72` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `average_order_value` | 小时平均客单价 | `numeric(18,4)` | 是 | net_sales 除以 order_count；订单数为0时为空。 | 替代旧 avg_order_net_sales 缓存，保证可重算。 | 不适用。 | `64.58` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `currency` | 币种 | `char(3)` | 否 | 小时金额币种。 | 防止跨币种相加。 | 不适用。 | `MYR` | v_pos_sales_hour_current.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_pos_item_sales_hour_current` — 当前POS商品小时销售

- **用途：** 为每个地点营业日只选择一批合格的 ITEM_SALES_HOUR 事实，并保留该批内每个 listing 小时行。
- **一行代表：** 地点 × 营业日 × 小时 × listing 一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `PASS_SELECT_SPEC`
- **稳定阻断码：** `NONE`
- **粒度唯一键：** `location_id + business_date + hour_started_at + listing_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `pos_item_sales_hour` → `pos_ingest_batch`
- **物理基表闭包：** `pos_ingest_batch`、`pos_item_sales_hour`
- **说明：** 只读取 dataset_code='ITEM_SALES_HOUR' 且 SUCCEEDED、未被合格同数据集批次 supersedes 的批次。按 location_id,business_date 用 completed_at、created_at、batch_id 确定性选择一个整日批次；禁止逐小时混选不同批次，否则无法证明一天数据来自同一修订。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `item_sales_hour_id` | 商品小时销售ID | `uuid` | 否 | 被选中的商品小时事实ID。 | 回查来源行。 | 不适用。 | `c49caf01-4198-5250-ae77-00c08abb8c9e` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 否 | 当前营业日采用的唯一商品小时批次。 | 作为整日修订键和来源血缘。 | 不适用。 | `338eeff7-033b-56b3-8bb0-aa9f36eb71a3` | v_pos_item_sales_hour_current.pos_ingest_batch_id 只表示本字段说明中的 POS批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `location_id` | 地点ID | `uuid` | 否 | 销售发生地点。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_item_sales_hour_current.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `business_date` | 营业日期 | `date` | 否 | 商品小时事实归属营业日。 | 日级聚合与计划连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 5 | `hour_started_at` | 小时开始时间 | `timestamptz` | 否 | 商品销售统计桶开始时刻。 | 时段分析。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-08T14:00:00+08:00` | v_pos_item_sales_hour_current.hour_started_at 只表示本字段说明中的 小时开始时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `listing_id` | Listing ID | `uuid` | 否 | 来源 POS 商品稳定身份。 | 连接发生时点产品映射。 | 不适用。 | `f719aafd-2e51-595c-823f-c34aded761a9` | v_pos_item_sales_hour_current.listing_id 只表示本字段说明中的 Listing ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `quantity` | 销售数量 | `numeric(18,4)` | 否 | 当前批次该 listing 小时净数量。 | 销量和预测输入。 | 不适用。 | `18` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `gross_sales` | 商品流水 | `numeric(18,4)` | 否 | 当前批次商品小时折扣前金额。 | 折扣分析。 | 不适用。 | `504.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 9 | `discount_amount` | 商品折扣 | `numeric(18,4)` | 是 | 当前批次商品小时来源折扣金额；来源未提供时为空。 | 解释净销售；NULL 不得当成 0。 | 不适用。 | `28.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `net_sales` | 商品净销售 | `numeric(18,4)` | 否 | 当前批次商品小时净额。 | 产品占比、毛利和促销分析。 | 不适用。 | `476.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 11 | `currency` | 币种 | `char(3)` | 否 | 商品销售金额币种。 | 防止跨币种相加。 | 不适用。 | `MYR` | v_pos_item_sales_hour_current.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `source_name_snapshot` | 来源名称快照 | `text` | 否 | 采集时 POS 商品名称原文。 | 目录改名后仍可追溯。 | 不适用。 | `Dark Chocolate Wellington` | 这是来源系统证据，不等于企业统一身份。 |

## `v_pos_daily_breakdown_current` — 当前POS日维度拆分

- **用途：** 为每个地点营业日选择一批合格 DAILY_BREAKDOWN 事实，向支付、渠道和就餐方式分析提供唯一版本。
- **一行代表：** 地点 × 营业日 × 维度类型 × 维度值一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `PASS_SELECT_SPEC`
- **稳定阻断码：** `NONE`
- **粒度唯一键：** `location_id + business_date + dimension_type + dimension_value`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `pos_daily_breakdown` → `pos_ingest_batch`
- **物理基表闭包：** `pos_daily_breakdown`、`pos_ingest_batch`
- **说明：** 只读取 dataset_code='DAILY_BREAKDOWN' 且 SUCCEEDED、未被合格同数据集批次 supersedes 的批次；按 location_id,business_date 用 completed_at、created_at、batch_id 选一个整日批次。下游不得直接读 pos_daily_breakdown 后自行 MAX(created_at)。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `daily_breakdown_id` | 拆分事实ID | `uuid` | 否 | 被选中的来源拆分行。 | 回查来源。 | 不适用。 | `20ee2bab-a206-5c77-8025-b726e6944cc4` | v_pos_daily_breakdown_current.daily_breakdown_id 只表示本字段说明中的 拆分事实ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 否 | 当前营业日拆分采用的唯一合格批次。 | 作为修订键和来源血缘。 | 不适用。 | `338eeff7-033b-56b3-8bb0-aa9f36eb71a3` | v_pos_daily_breakdown_current.pos_ingest_batch_id 只表示本字段说明中的 POS批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `location_id` | 地点ID | `uuid` | 否 | 拆分所属地点。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_daily_breakdown_current.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `business_date` | 营业日期 | `date` | 否 | 拆分所属营业日。 | 与日销售和会员日报核对。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 5 | `dimension_type` | 维度类型 | `text` | 否 | PAYMENT_METHOD、DINING_TYPE、CHANNEL 或已批准类型。 | 解释维度值的语义。 | 不适用。 | `PAYMENT_METHOD` | v_pos_daily_breakdown_current.dimension_type 只表示本字段说明中的 维度类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `dimension_value` | 维度值 | `text` | 否 | 该维度的来源/标准值。 | 支付、渠道或就餐方式分组。 | 不适用。 | `Membership card balance` | v_pos_daily_breakdown_current.dimension_value 只表示本字段说明中的 维度值；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `quantity` | 业务数量 | `numeric(18,4)` | 是 | 来源提供的订单、交易或人数。 | 数量核对；缺失保持 NULL。 | 不适用。 | `42` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `quantity_unit` | 数量口径单位 | `text` | 是 | ORDER、TRANSACTION、GUEST 或受控来源单位。 | 阻止不同数量口径相加。 | 不适用。 | `TRANSACTION` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `gross_sales` | 流水金额 | `numeric(18,4)` | 是 | 该维度的来源流水金额。 | 与净额、日表核对。 | 不适用。 | `2100.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `net_sales` | 净销售额 | `numeric(18,4)` | 否 | 该维度的来源净销售额。 | 支付或渠道占比。 | 不适用。 | `2000.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 11 | `ratio` | 维度占比 | `numeric(12,8)` | 是 | 该行 net_sales 除以同地点、营业日、维度类型和币种的 net_sales 合计；分母为0时为空。 | 替代旧 ratio 缓存，并要求分析同时展示分子和分母。 | 不适用。 | `0.32000000` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `currency` | 币种 | `char(3)` | 否 | 拆分金额币种。 | 防止跨币种相加。 | 不适用。 | `MYR` | v_pos_daily_breakdown_current.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_pos_item_sales_day` — POS产品日销售

- **用途：** 把商品小时销售按营业日聚合，并仅在发生时点映射确认后提供 product_id。
- **一行代表：** 地点 × 营业日 × listing × 可选产品一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `PASS_SELECT_SPEC`
- **稳定阻断码：** `NONE`
- **粒度唯一键：** `location_id + business_date + listing_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_pos_item_sales_hour_current` → `pos_product_mapping` → `pos_product_listing`
- **物理基表闭包：** `pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_listing`、`pos_product_mapping`
- **说明：** 只从 v_pos_item_sales_hour_current 的单一整日修订聚合，再按地点、营业日、listing 汇总；pos_ingest_batch_id 原样保留为日聚合修订键。未映射 listing 保留为 product_id=NULL 的独立桶，并输出 mapping_status，禁止 inner join 静默丢失。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 销售地点。 | 跨域连接。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_item_sales_day.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 销售营业日。 | 预测和成本连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 否 | 本次日聚合采用的唯一合格商品销售批次。 | 追溯销售修订。 | 不适用。 | `338eeff7-033b-56b3-8bb0-aa9f36eb71a3` | v_pos_item_sales_day.pos_ingest_batch_id 只表示本字段说明中的 POS批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `listing_id` | Listing ID | `uuid` | 否 | 来源POS商品。 | 完整保留未映射销售。 | 不适用。 | `f719aafd-2e51-595c-823f-c34aded761a9` | v_pos_item_sales_day.listing_id 只表示本字段说明中的 Listing ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `product_id` | 产品ID | `uuid` | 是 | 确认映射产品；未映射为空。 | 治理后产品分析。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `quantity` | 日销量 | `numeric(18,4)` | 否 | 小时销量日汇总。 | 预测准确率和成本。 | 不适用。 | `86` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 7 | `gross_sales` | 日流水 | `numeric(18,4)` | 否 | 商品日流水。 | 折扣分析。 | 不适用。 | `2408` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 8 | `net_sales` | 日净销售 | `numeric(18,4)` | 否 | 商品日净销售额。 | 产品占比和毛利。 | 不适用。 | `2300` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 9 | `mapping_status` | 映射状态 | `text` | 是 | 发生时点映射质量。 | 阻止未映射金额静默漏掉。 | 不适用。 | `CONFIRMED` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `v_pos_revenue_reconciliation` — POS收入对账

- **用途：** 比较日销售、小时销售和商品小时销售三种来源粒度，显示金额和订单差异。
- **一行代表：** 地点 × 营业日一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `RECONCILIATION_THRESHOLD_UNDEFINED | MISSING_SIDE_STATUS_PRECEDENCE_UNDEFINED`
- **粒度唯一键：** `location_id + business_date`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_pos_sales_day_current` → `v_pos_sales_hour_current` → `v_pos_item_sales_day`
- **物理基表闭包：** `pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_listing`、`pos_product_mapping`、`pos_sales_day`、`pos_sales_hour`
- **说明：** 三侧分别通过其 current 视图选定批次后再核对。小时侧必须来自同一个 SALES_HOUR 批次，商品侧必须来自同一个 ITEM_SALES_HOUR 批次；reconciliation_revision_key 显式冻结三侧修订组合，禁止跨批次静默混算。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 核对地点。 | 定位问题。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_revenue_reconciliation.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 核对营业日。 | 问题日期。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `day_pos_ingest_batch_id` | 日表批次ID | `uuid` | 否 | 日销售当前视图采用的批次。 | 证明日表修订血缘。 | 不适用。 | `9a1c376a-5d2c-5abf-b6b6-d05c6aa515ce` | v_pos_revenue_reconciliation.day_pos_ingest_batch_id 只表示本字段说明中的 日表批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `hour_pos_ingest_batch_id` | 小时表批次ID | `uuid` | 是 | 小时销售当前视图采用的整日批次；缺失时为空。 | 证明小时汇总修订血缘。 | 不适用。 | `9d4d3e9b-2b99-5f19-b075-3a3144a6c9bf` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `item_pos_ingest_batch_id` | 商品表批次ID | `uuid` | 是 | 商品小时当前视图采用的整日批次；缺失时为空。 | 证明商品汇总修订血缘。 | 不适用。 | `38f24cea-45af-503e-8fbd-c630426e9bb9` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `reconciliation_revision_key` | 核对修订键 | `char(64)` | 否 | 由地点、营业日和三侧批次ID规范化计算的 SHA-256。 | 同一组来源修订得到稳定核对身份，任何一侧重跑都会产生新键。 | 不适用。 | `21aa...64位十六进制` | v_pos_revenue_reconciliation.reconciliation_revision_key 只表示本字段说明中的 核对修订键；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `day_net_sales` | 日表净销售 | `numeric(18,4)` | 否 | 日销售来源净额。 | 权威日表一侧。 | 不适用。 | `53670` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 8 | `hour_net_sales` | 小时汇总净销售 | `numeric(18,4)` | 是 | 小时表汇总净额。 | 验证小时完整性。 | 不适用。 | `53670` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `item_net_sales` | 商品汇总净销售 | `numeric(18,4)` | 是 | 商品小时汇总净额。 | 验证商品明细完整性。 | 不适用。 | `53670` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `revenue_difference` | 金额差异 | `numeric(18,4)` | 是 | 最大来源净额差。 | 超过阈值创建质量问题。 | 不适用。 | `0` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `day_order_count` | 日表订单数 | `integer` | 是 | 日汇总订单数；来源未提供时为空。 | 订单核对；NULL 不得当成零单。 | 不适用。 | `842` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `hour_order_count` | 小时订单数 | `integer` | 是 | 小时汇总订单数。 | 解释无小时归属订单。 | 不适用。 | `842` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `quality_status` | 核对状态 | `text` | 否 | MATCH、KNOWN_GAP、WARNING或MISSING。 | 判断是否可下游消费。 | 不适用。 | `MATCH` | v_pos_revenue_reconciliation.quality_status 只表示本字段说明中的 核对状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_pos_member_state_current` — 当前会员状态与余额

- **用途：** 从不可变会员快照中为每个会员选出最新合格观察，提供当前等级、积分、累计值和会员级余额而不覆盖历史。
- **一行代表：** 会员一行
- **读取项目：** 财务网站、HBTI、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `MEMBER_PROFILE_BATCH_COVERAGE_UNPROVEN | STALE_THRESHOLD_UNDEFINED`
- **粒度唯一键：** `member_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `pos_member_balance_snapshot` → `pos_ingest_batch`
- **物理基表闭包：** `pos_ingest_batch`、`pos_member_balance_snapshot`
- **说明：** 只读取 dataset_code='MEMBER_PROFILE' 且 batch.status='SUCCEEDED'、未被合格同数据集批次 supersedes 的快照。合格批次必须覆盖客户档案与卡列表并集，并为仅有卡的会员写 profile_present=false。按 member_id 依次以 snapshot_date DESC、batch.completed_at DESC NULLS LAST、batch.created_at DESC、batch_id DESC、snapshot_id DESC 取一行。没有合格快照则不从 pos_member 主档猜当前等级或余额。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `member_balance_snapshot_id` | 会员快照ID | `uuid` | 否 | 被确定性选中的会员状态快照。 | 回查历史事实。 | 不适用。 | `7dec804b-c87c-5efd-977f-773112413675` | v_pos_member_state_current.member_balance_snapshot_id 只表示本字段说明中的 会员快照ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 否 | 当前状态采用的 MEMBER_PROFILE 批次。 | 作为状态修订键和解析血缘。 | 不适用。 | `338eeff7-033b-56b3-8bb0-aa9f36eb71a3` | v_pos_member_state_current.pos_ingest_batch_id 只表示本字段说明中的 POS批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `member_id` | 会员ID | `uuid` | 否 | 企业稳定会员身份。 | 连接卡交易、联系方式和营销。 | 不适用。 | `2c349fe5-f5b8-5586-8c8c-31a239f68dd0` | v_pos_member_state_current.member_id 只表示本字段说明中的 会员ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `snapshot_date` | 快照日期 | `date` | 否 | 来源观察该状态的日期。 | 判断新鲜度和历史轨迹。 | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。 | `2026-08-08` | v_pos_member_state_current.snapshot_date 只表示本字段说明中的 快照日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `profile_present` | 客户档案是否存在 | `boolean` | 否 | 当前合格快照是否直接观察到客户档案。 | 区分只有卡身份与客户档案覆盖。 | 不适用。 | `true` | v_pos_member_state_current.profile_present 只表示本字段说明中的 客户档案是否存在；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `level_name` | 来源会员等级 | `text` | 是 | 当前快照的来源等级原文。 | 展示来源当前等级；不作为稳定身份。 | 不适用。 | `Gold` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `growth` | 来源成长值 | `integer` | 是 | 当前快照的来源成长值。 | 等级进度展示和历史变化。 | 不适用。 | `1820` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `point_balance` | 来源积分余额 | `integer` | 是 | 当前快照的来源可用积分存量。 | 积分展示；不得由金额猜算。 | 不适用。 | `460` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `lifetime_topup_amount` | 来源累计充值金额 | `numeric(18,4)` | 是 | 当前快照的来源生命周期累计充值金额。 | 与流水复算独立核对。 | 不适用。 | `1280.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `lifetime_topup_count` | 来源累计充值次数 | `integer` | 是 | 当前快照的来源生命周期累计充值次数。 | 充值频次历史观察。 | 不适用。 | `12` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `lifetime_consume_amount` | 来源累计消费金额 | `numeric(18,4)` | 是 | 当前快照的来源生命周期累计消费金额。 | 与部分覆盖订单商品事实分开。 | 不适用。 | `3520.40` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `lifetime_consume_count` | 来源累计消费次数 | `integer` | 是 | 当前快照的来源生命周期累计消费次数。 | 支持来源口径的消费频次展示。 | 不适用。 | `47` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `first_card_created_on` | 来源首卡创建日期 | `date` | 是 | 当前快照的来源最早会员卡创建日期。 | 与卡列表最早 issued_at 独立核对。 | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。 | `2026-01-12` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `last_recharge_at` | 来源最近充值时间 | `timestamptz` | 是 | 当前快照的来源最近充值时刻。 | 滚动流水不完整时保留来源活跃度观察。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-07-31T18:20:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `last_transaction_at` | 来源最近交易时间 | `timestamptz` | 是 | 当前快照的来源最近交易时刻。 | 会员活跃度和快照新鲜度。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-06T12:05:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `cash_balance` | 现金储值余额 | `numeric(18,4)` | 是 | 会员名下全部卡现金余额合计。 | 现金储值负债分析。 | 不适用。 | `120.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `gift_balance` | 赠送余额 | `numeric(18,4)` | 是 | 会员名下全部卡赠送余额合计。 | 促销余额分析。 | 不适用。 | `20.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `frozen_balance` | 冻结余额 | `numeric(18,4)` | 是 | 来源直接报告的会员级冻结余额。 | 识别不可用存量。 | 不适用。 | `0.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `total_balance` | 来源总余额 | `numeric(18,4)` | 是 | 来源直接报告的会员级总余额。 | 与组成独立核对，不用相加值覆盖。 | 不适用。 | `140.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 20 | `currency` | 币种 | `char(3)` | 否 | 累计金额和余额币种。 | 防止跨币种相加。 | 不适用。 | `MYR` | v_pos_member_state_current.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 21 | `quality_status` | 质量状态 | `text` | 否 | COMPLETE、PARTIAL 或 STALE。 | 当前值必须连同完整性与新鲜度展示。 | 不适用。 | `COMPLETE` | v_pos_member_state_current.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_pos_member_daily_metric_current` — 当前会员日报原值

- **用途：** 为每个地点营业日选择一个合格 MEMBER_DAILY_METRIC 批次，并原样输出所有不可可靠重算的来源日报字段。
- **一行代表：** 地点 × 营业日一行
- **读取项目：** 财务网站、HBTI、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `PASS_SELECT_SPEC`
- **稳定阻断码：** `NONE`
- **粒度唯一键：** `location_id + business_date`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `pos_member_daily_metric` → `pos_ingest_batch`
- **物理基表闭包：** `pos_ingest_batch`、`pos_member_daily_metric`
- **说明：** 只读取 dataset_code='MEMBER_DAILY_METRIC' 且 SUCCEEDED、未被合格同数据集批次 supersedes 的批次；按 location_id,business_date 用 completed_at、created_at、batch_id 选一行。任何 required 来源指标重复或同批多行都使批次失败，不用 MAX/SUM 掩盖。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `member_daily_metric_id` | 会员日报ID | `uuid` | 否 | 被选中的会员日报事实。 | 回查来源行。 | 不适用。 | `c566193a-7c5e-500e-8c22-2adc8acc582c` | v_pos_member_daily_metric_current.member_daily_metric_id 只表示本字段说明中的 会员日报ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 否 | 当前营业日采用的唯一会员日报批次。 | 作为修订键和解析血缘。 | 不适用。 | `338eeff7-033b-56b3-8bb0-aa9f36eb71a3` | v_pos_member_daily_metric_current.pos_ingest_batch_id 只表示本字段说明中的 POS批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `location_id` | 地点ID | `uuid` | 否 | 会员日报所属地点。 | 门店连接。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_member_daily_metric_current.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `business_date` | 营业日期 | `date` | 否 | 会员日报所属营业日。 | 销售与财务核对。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 5 | `new_member_count` | 新增会员数 | `integer` | 是 | 来源直接报告的新增会员人数。 | 获客趋势。 | 不适用。 | `12` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `consumed_member_count` | 消费会员数 | `integer` | 是 | 来源直接报告的消费去重会员人数。 | 会员活跃度。 | 不适用。 | `186` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `recharged_member_count` | 充值会员数 | `integer` | 是 | 来源直接报告的充值去重会员人数。 | 储值参与度。 | 不适用。 | `9` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `points_member_count` | 积分变动会员数 | `integer` | 是 | 来源直接报告的积分变化去重人数。 | 积分覆盖面。 | 不适用。 | `142` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `member_sales` | 会员销售额 | `numeric(18,4)` | 是 | 来源识别会员订单的全部销售额。 | 会员贡献率分子。 | 不适用。 | `18000.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `total_consume_amount` | 来源总消费分母 | `numeric(18,4)` | 是 | 来源日报直接报告的总消费口径。 | 复现来源比例；不默认等于 POS 日净销售。 | 不适用。 | `53680.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `topup_cash` | 充值现金本金 | `numeric(18,4)` | 是 | 来源正常充值的现金本金。 | 现金储值流入。 | 不适用。 | `800.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `topup_gift` | 充值赠送金额 | `numeric(18,4)` | 是 | 来源正常充值的赠送价值。 | 促销成本。 | 不适用。 | `80.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `topup_face_value` | 充值面值 | `numeric(18,4)` | 是 | 来源正常充值总面值。 | 与现金、赠送组成核对。 | 不适用。 | `880.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `topup_count` | 充值笔数 | `integer` | 是 | 来源正常充值交易笔数。 | 充值频次。 | 不适用。 | `10` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `topup_refund` | 充值退款 | `numeric(18,4)` | 是 | 来源充值退款金额，符号遵循来源。 | 充值净额派生输入。 | 不适用。 | `-50.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `redeem_amount` | 卡核销总额 | `numeric(18,4)` | 是 | 来源卡消费核销总额。 | 卡支付核对。 | 不适用。 | `6250.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `redeem_cash` | 卡核销现金部分 | `numeric(18,4)` | 是 | 来源核销现金余额部分。 | 现金负债释放。 | 不适用。 | `5900.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `redeem_gift` | 卡核销赠送部分 | `numeric(18,4)` | 是 | 来源核销赠送余额部分。 | 赠送成本释放。 | 不适用。 | `350.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `redeem_count` | 卡核销笔数 | `integer` | 是 | 来源会员卡核销交易笔数。 | 卡支付频次。 | 不适用。 | `128` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 20 | `consume_refund` | 消费退款 | `numeric(18,4)` | 是 | 来源卡消费退款金额，符号遵循来源。 | 卡净核销派生输入。 | 不适用。 | `-50.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 21 | `adjust_net` | 后台调整净额 | `numeric(18,4)` | 是 | 来源卡余额后台调整净额。 | 保留正常充值/消费无法替代的调整事实。 | 不适用。 | `30000.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 22 | `topup_adjust_amount` | 调整中认定为充值 | `numeric(18,4)` | 是 | 按批次解析规则认定为客户预存的调整金额。 | 对外充值口径派生输入。 | 不适用。 | `30000.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 23 | `adjust_correction` | 调整中认定为纠错 | `numeric(18,4)` | 是 | 后台调整中认定为补偿或纠错的金额。 | 解释 adjust_net。 | 不适用。 | `0.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 24 | `stored_value_cash_net` | 现金储值净额 | `numeric(18,4)` | 是 | 来源日报直接报告的现金储值日净变化。 | 与可重算组成独立核对。 | 不适用。 | `850.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 25 | `balance_end_total` | 期末储值总余额 | `numeric(18,4)` | 是 | 来源日报直接报告的门店期末总余额。 | 门店日存量核对。 | 不适用。 | `48450.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 26 | `balance_end_cash` | 期末现金余额 | `numeric(18,4)` | 是 | 来源日报直接报告的门店期末现金余额。 | 现金存量。 | 不适用。 | `40250.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 27 | `balance_end_gift` | 期末赠送余额 | `numeric(18,4)` | 是 | 来源日报直接报告的门店期末赠送余额。 | 赠送存量。 | 不适用。 | `8200.00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 28 | `currency` | 币种 | `char(3)` | 否 | 日报所有金额币种。 | 防止跨币种相加。 | 不适用。 | `MYR` | v_pos_member_daily_metric_current.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_pos_member_daily_summary` — 会员日经营摘要

- **用途：** 把会员贡献、卡核销、充值净额和余额质量放在同一门店营业日行。
- **一行代表：** 地点 × 营业日一行
- **读取项目：** 财务网站、HBTI、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `CARD_PAYMENT_BREAKDOWN_MAPPING_UNDEFINED | STORED_VALUE_FORMULA_UNDEFINED | PARTIAL_STATUS_RULE_UNDEFINED`
- **粒度唯一键：** `location_id + business_date`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_pos_member_daily_metric_current` → `v_pos_sales_day_current` → `v_pos_daily_breakdown_current`
- **物理基表闭包：** `pos_daily_breakdown`、`pos_ingest_batch`、`pos_member_daily_metric`、`pos_sales_day`
- **说明：** card_payment_net、topup_total 和 stored_value_face_net 只由同一已选会员日报批次的基础分项派生；source_*_ratio 使用来源 total_consume_amount，pos_*_ratio 使用当前合格 POS 日净销售。三侧批次ID和 summary_revision_key 必须随结果输出。任一输入缺失或分母为0时返回 NULL，不补0，也不把两种口径混称同一指标。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 会员指标地点。 | 门店分析。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_member_daily_summary.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 指标日期。 | 与销售连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `member_metric_pos_ingest_batch_id` | 会员日报批次ID | `uuid` | 否 | 会员日报 current 视图采用的批次。 | 证明会员来源修订血缘。 | 不适用。 | `80c3ffbb-4c03-57e2-9bdc-b111ff6c328d` | v_pos_member_daily_summary.member_metric_pos_ingest_batch_id 只表示本字段说明中的 会员日报批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `sales_day_pos_ingest_batch_id` | POS日销售批次ID | `uuid` | 是 | POS 日销售 current 视图采用的批次；缺失时为空。 | 证明 POS 分母修订血缘。 | 不适用。 | `083627fe-b6d1-56ff-bedd-8ad1cfdb56b1` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `breakdown_pos_ingest_batch_id` | 日拆分批次ID | `uuid` | 是 | 支付拆分 current 视图采用的批次；缺失时为空。 | 证明支付核对修订血缘。 | 不适用。 | `8e88b3da-6d81-5172-aa98-ad6e7ffa34da` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `summary_revision_key` | 摘要修订键 | `char(64)` | 否 | 由地点、营业日和三侧批次ID规范化计算的 SHA-256。 | 任一来源重跑即形成新摘要修订，避免跨批次结果看似不变。 | 不适用。 | `98f2...64位十六进制` | v_pos_member_daily_summary.summary_revision_key 只表示本字段说明中的 摘要修订键；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `new_member_count` | 新增会员数 | `integer` | 是 | 来源日报新增会员人数。 | 获客趋势。 | 不适用。 | `12` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `consumed_member_count` | 消费会员数 | `integer` | 是 | 来源日报消费去重会员人数。 | 会员活跃度。 | 不适用。 | `186` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `recharged_member_count` | 充值会员数 | `integer` | 是 | 来源日报充值去重会员人数。 | 储值参与度。 | 不适用。 | `9` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `points_member_count` | 积分变动会员数 | `integer` | 是 | 来源日报积分变化去重会员人数。 | 积分活动覆盖。 | 不适用。 | `142` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `member_sales` | 会员销售额 | `numeric(18,4)` | 是 | 会员订单全部销售。 | 会员贡献率。 | 不适用。 | `18000` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `total_consume_amount` | 来源总消费分母 | `numeric(18,4)` | 是 | 来源日报用于比例计算的总消费金额。 | 解释 source_* 比率。 | 不适用。 | `53680` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `source_member_sales_ratio` | 来源会员贡献率 | `numeric(9,6)` | 是 | member_sales 除来源日报 total_consume_amount；分母缺失或为0时为空。 | 复现 RES 会员日报自身口径。 | 不适用。 | `0.335320` | 这是来源系统证据，不等于企业统一身份。 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `pos_member_sales_ratio` | POS口径会员贡献率 | `numeric(9,6)` | 是 | member_sales 除当前合格 POS 日净销售；分母缺失或为0时为空。 | 与来源日报口径并列核对，不混称一个指标。 | 不适用。 | `0.335382` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `card_payment_net` | 卡净核销 | `numeric(18,4)` | 是 | 卡余额支付减消费退款。 | 支付对账。 | 不适用。 | `6200` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `source_card_payment_ratio` | 来源卡支付占比 | `numeric(9,6)` | 是 | 卡净核销除来源日报 total_consume_amount；分母缺失或为0时为空。 | 复现来源卡支付口径。 | 不适用。 | `0.115499` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 17 | `pos_card_payment_ratio` | POS口径卡支付占比 | `numeric(9,6)` | 是 | 卡净核销除当前合格 POS 日净销售；分母缺失或为0时为空。 | 与来源比率并列展示。 | 不适用。 | `0.115521` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 18 | `topup_total` | 对外充值总额 | `numeric(18,4)` | 是 | topup_face_value 加 topup_adjust_amount；任一输入缺失则为空。 | 避免只看正常充值而漏掉经规则认定的后台预存。 | 不适用。 | `30880` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 19 | `stored_value_cash_net` | 现金储值净额 | `numeric(18,4)` | 是 | 现金充值相关日净变化。 | 储值分析。 | 不适用。 | `850` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 20 | `stored_value_face_net` | 面值储值净额 | `numeric(18,4)` | 是 | 按充值面值、退款、调整与核销组成确定性派生；任一输入缺失则为空。 | 衡量含赠送价值的储值变化。 | 不适用。 | `930` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 21 | `balance_end_total` | 期末总余额 | `numeric(18,4)` | 是 | 来源日报直接报告的期末总储值余额。 | 与现金、赠送组成独立核对。 | 不适用。 | `48450` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 22 | `balance_end_cash` | 期末现金余额 | `numeric(18,4)` | 是 | 日末现金储值余额。 | 存量负债分析。 | 不适用。 | `40250` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 23 | `balance_end_gift` | 期末赠送余额 | `numeric(18,4)` | 是 | 日末赠送储值余额。 | 促销负担分析。 | 不适用。 | `8200` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 24 | `is_partial` | 是否缺失 | `boolean` | 否 | 会员来源是否部分失败。 | NULL不能解释为0。 | 不适用。 | `false` | v_pos_member_daily_summary.is_partial 只表示本字段说明中的 是否缺失；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_pos_order_item_current` — 当前订单商品最小事实

- **用途：** 为每个地点和营业日选择一个合格订单商品批次，保留订单×listing最小粒度且避免重跑重复计算。
- **一行代表：** 地点 × 营业日 × 订单 × listing 一行
- **读取项目：** BakeryOps、财务网站、HBTI、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `FULL_ORDER_ITEM_SOURCE_NOT_PROVEN | COVERAGE_PRIORITY_SELECTION_REQUIRES_SOURCE_EVIDENCE`
- **粒度唯一键：** `location_id + business_date + order_id + listing_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `pos_order_item` → `pos_order` → `pos_product_listing` → `pos_ingest_batch`
- **物理基表闭包：** `pos_ingest_batch`、`pos_order`、`pos_order_item`、`pos_product_listing`
- **说明：** 确定性选版：只读取 dataset_code='ORDER_ITEM'。同地点/营业日优先选合格的 ALL_ORDER_ITEMS 批次；不存在时才选最新合格 MEMBER_FLAGGED_ONLY 批次。批次必须 SUCCEEDED、未被合格 ORDER_ITEM 批次 supersedes，并按 completed_at、created_at、batch_id 破平。只返回所选批次事实，因此同日重跑不会重复累计；来源删除的行通过新整批快照自然消失，而不是依赖 upsert 留下旧行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `order_item_id` | 订单商品事实ID | `uuid` | 否 | 被确定性选中的订单商品事实。 | 回查具体来源行。 | 不适用。 | `33dab219-1783-551a-be34-d3f44487289c` | v_pos_order_item_current.order_item_id 只表示本字段说明中的 订单商品事实ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 否 | 当前采用的来源批次。 | 证明数据版本并避免重复汇总重跑批次。 | 不适用。 | `338eeff7-033b-56b3-8bb0-aa9f36eb71a3` | v_pos_order_item_current.pos_ingest_batch_id 只表示本字段说明中的 POS批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `order_id` | 订单ID | `uuid` | 否 | 企业库内稳定订单身份。 | 连接会员卡流水、未来支付和退款。 | 不适用。 | `1cbda741-dd91-5a71-8cd4-554dc91f1578` | v_pos_order_item_current.order_id 只表示本字段说明中的 订单ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `location_id` | 地点ID | `uuid` | 否 | 订单发生门店。 | 多门店分组和权限。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_order_item_current.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `business_date` | 营业日期 | `date` | 否 | 来源订单商品归属营业日。 | 日级报告和跨域连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 6 | `listing_id` | Listing ID | `uuid` | 否 | 来源 POS 商品身份。 | 连接统一产品映射。 | 不适用。 | `f719aafd-2e51-595c-823f-c34aded761a9` | v_pos_order_item_current.listing_id 只表示本字段说明中的 Listing ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `source_item_key_snapshot` | 来源商品键快照 | `text` | 否 | 采集时原始 item_key。 | 映射修复和来源核查。 | 不适用。 | `1990716608733069315-1-1993240842835603462` | 这是来源系统证据，不等于企业统一身份。 |
| 8 | `source_row_count` | 来源行数 | `integer` | 否 | SUM 合并前的来源行数。 | 监测重复行结构变化并证明没有 DISTINCT 丢量。 | 不适用。 | `2` | 这是来源系统证据，不等于企业统一身份。 |
| 9 | `quantity` | 净数量 | `numeric(18,4)` | 否 | 订单和商品维度的来源净数量。 | 购物篮、复购和产品偏好基础量。 | 不适用。 | `2` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 10 | `net_sales` | 商品净额 | `numeric(18,4)` | 否 | 订单和商品维度的来源净额，可为零或负数。 | 商品收入；不能解释为会员卡支付额。 | 不适用。 | `50.40` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 11 | `currency` | 币种 | `char(3)` | 否 | 商品净额币种。 | 正确汇总金额。 | 不适用。 | `MYR` | v_pos_order_item_current.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `member_consumption_flag` | 来源会员消费标记 | `boolean` | 否 | RES 来源的会员消费维度值。 | 描述来源筛选范围，不直接解析会员。 | 不适用。 | `true` | v_pos_order_item_current.member_consumption_flag 只表示本字段说明中的 来源会员消费标记；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `coverage_scope` | 覆盖范围 | `text` | 否 | ALL_ORDER_ITEMS 或 MEMBER_FLAGGED_ONLY。 | 阻止把会员筛选数据误称全量订单商品。 | 不适用。 | `MEMBER_FLAGGED_ONLY` | v_pos_order_item_current.coverage_scope 只表示本字段说明中的 覆盖范围；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 14 | `quality_status` | 质量状态 | `text` | 否 | 当前事实和 listing 映射的完整性状态。 | 正式派生前门禁。 | 不适用。 | `COMPLETE` | v_pos_order_item_current.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_pos_order_member_attribution` — 订单会员归属判断

- **用途：** 从会员卡交易的订单连接计算唯一、歧义或未匹配归属，不在订单商品事实里复制会员ID。
- **一行代表：** 一个稳定订单一行
- **读取项目：** HBTI、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `PASS_SELECT_SPEC`
- **稳定阻断码：** `NONE`
- **粒度唯一键：** `order_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `pos_order` → `pos_member_card_transaction` → `pos_member`
- **物理基表闭包：** `pos_member`、`pos_member_card_transaction`、`pos_order`
- **说明：** 仅聚合已通过 source_system_id+location_id+source_order_id 解析到 order_id 的会员卡流水。恰好一个不同 member_id 才输出 resolved_member_id；多会员保留在基础流水并标 AMBIGUOUS，零匹配标 UNMATCHED。该关系证明会员账号与订单有关联，不证明该会员本人吃掉、喝掉或使用了订单内全部商品。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `order_id` | 订单ID | `uuid` | 否 | 被判断归属的稳定订单。 | 连接订单商品。 | 不适用。 | `1cbda741-dd91-5a71-8cd4-554dc91f1578` | v_pos_order_member_attribution.order_id 只表示本字段说明中的 订单ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `location_id` | 地点ID | `uuid` | 否 | 订单发生地点。 | 多门店分析。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_order_member_attribution.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `source_order_id` | 外部订单ID | `text` | 否 | 来源订单原始标识。 | 核查卡交易桥接证据。 | 不适用。 | `2086078328225419855` | 这是来源系统证据，不等于企业统一身份。 |
| 4 | `resolved_member_id` | 唯一解析会员ID | `uuid` | 是 | 候选会员恰好一人时输出该 member_id；否则为空。 | 个性化报告唯一允许采用的会员连接。 | 不适用。 | `920a2a36-1dea-518d-8fb3-96b255cae157` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `candidate_member_count` | 候选会员数 | `integer` | 否 | 该订单关联的不同会员数。 | 0=未匹配，1=唯一，多于1=歧义。 | 不适用。 | `1` | v_pos_order_member_attribution.candidate_member_count 只表示本字段说明中的 候选会员数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `linked_card_transaction_count` | 关联卡交易数 | `integer` | 否 | 参与归属判断的会员卡交易记录数。 | 区分一名会员多笔交易与多会员冲突。 | 不适用。 | `2` | v_pos_order_member_attribution.linked_card_transaction_count 只表示本字段说明中的 关联卡交易数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `attribution_status` | 归属状态 | `text` | 否 | UNIQUE、AMBIGUOUS 或 UNMATCHED。 | 控制是否可进入个人报告。 | 不适用。 | `UNIQUE` | v_pos_order_member_attribution.attribution_status 只表示本字段说明中的 归属状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `attribution_basis` | 归属依据 | `text` | 否 | 当前为 MEMBER_CARD_TRANSACTION_ORDER_ID。 | 防止把推断误称下单人事实。 | 不适用。 | `MEMBER_CARD_TRANSACTION_ORDER_ID` | v_pos_order_member_attribution.attribution_basis 只表示本字段说明中的 归属依据；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_pos_member_order_item` — 会员关联订单商品

- **用途：** 把当前订单商品、可解释会员归属和发生时点产品映射组合成个性化分析的唯一只读入口。
- **一行代表：** 地点 × 营业日 × 订单 × listing 一行
- **读取项目：** HBTI、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `MAPPING_OCCURRENCE_TIMESTAMP_MISSING`
- **粒度唯一键：** `location_id + business_date + order_id + listing_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_pos_order_item_current` → `v_pos_order_member_attribution` → `pos_product_mapping` → `ops_product`
- **物理基表闭包：** `ops_product`、`pos_ingest_batch`、`pos_member`、`pos_member_card_transaction`、`pos_order`、`pos_order_item`、`pos_product_listing`、`pos_product_mapping`
- **说明：** 个人报告必须同时满足 attribution_status='UNIQUE'、产品映射达到所需质量和批次完整。推荐文案是“与你会员账号关联的订单中记录了…”，不能从数据库事实跳跃成“你亲自喝了/吃了…”。企业团购、家庭共享卡和多人订单是明确反例。负净额和零净额行保留在基础事实，派生指标必须声明是否纳入。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `order_id` | 订单ID | `uuid` | 否 | 稳定订单身份。 | 追溯归属和来源。 | 不适用。 | `1cbda741-dd91-5a71-8cd4-554dc91f1578` | v_pos_member_order_item.order_id 只表示本字段说明中的 订单ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `location_id` | 地点ID | `uuid` | 否 | 订单地点。 | 门店报告和权限。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_member_order_item.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `business_date` | 营业日期 | `date` | 否 | 订单商品营业日。 | 年度、季度和复购窗口。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 4 | `resolved_member_id` | 解析会员ID | `uuid` | 是 | 唯一归属时的会员；歧义或未匹配为空。 | 个性化分组。 | 不适用。 | `920a2a36-1dea-518d-8fb3-96b255cae157` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `attribution_status` | 归属状态 | `text` | 否 | UNIQUE、AMBIGUOUS 或 UNMATCHED。 | 正式个人报告只用 UNIQUE。 | 不适用。 | `UNIQUE` | v_pos_member_order_item.attribution_status 只表示本字段说明中的 归属状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `listing_id` | Listing ID | `uuid` | 否 | 来源商品身份。 | 保留未统一产品的基础事实。 | 不适用。 | `f719aafd-2e51-595c-823f-c34aded761a9` | v_pos_member_order_item.listing_id 只表示本字段说明中的 Listing ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `product_id` | 产品ID | `uuid` | 是 | 发生时点确认映射的企业产品。 | 连接成本、品类、预测和营销。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `product_mapping_status` | 产品映射状态 | `text` | 是 | CONFIRMED、PENDING 或缺失。 | 未确认商品不得静默进入产品排行。 | 不适用。 | `CONFIRMED` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `quantity` | 净数量 | `numeric(18,4)` | 否 | 该订单商品净数量。 | 最常关联商品、复购和组合分析。 | 不适用。 | `2` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 10 | `net_sales` | 商品净额 | `numeric(18,4)` | 否 | 该订单商品净额，可为零或负数。 | 关联订单消费价值分析，不等于卡核销。 | 不适用。 | `50.40` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 11 | `currency` | 币种 | `char(3)` | 否 | 净额币种。 | 正确汇总。 | 不适用。 | `MYR` | v_pos_member_order_item.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `source_row_count` | 来源行数 | `integer` | 否 | 聚合前来源行数。 | 异常和来源结构解释。 | 不适用。 | `2` | 这是来源系统证据，不等于企业统一身份。 |
| 13 | `coverage_scope` | 覆盖范围 | `text` | 否 | 全量订单商品或仅会员标记商品。 | 报告必须披露口径。 | 不适用。 | `MEMBER_FLAGGED_ONLY` | v_pos_member_order_item.coverage_scope 只表示本字段说明中的 覆盖范围；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 14 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 否 | 当前采用批次。 | 重跑与更正追溯。 | 不适用。 | `338eeff7-033b-56b3-8bb0-aa9f36eb71a3` | v_pos_member_order_item.pos_ingest_batch_id 只表示本字段说明中的 POS批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_ops_forecast_accuracy` — 预测准确率

- **用途：** 将预测行与实际产品日销量配对，区分高估、低估、未计划和未映射。
- **一行代表：** 地点 × 目标营业日 × 产品 × 预测运行一行
- **读取项目：** BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `ERROR_RATE_DENOMINATOR_UNDEFINED | FORECAST_ACTUAL_MATCH_RULE_UNDEFINED`
- **粒度唯一键：** `forecast_run_id + product_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `ops_forecast_run` → `ops_forecast_line` → `v_pos_item_sales_day` → `ops_product`
- **物理基表闭包：** `ops_forecast_line`、`ops_forecast_run`、`ops_product`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_listing`、`pos_product_mapping`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 预测和销售地点。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_ops_forecast_accuracy.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 预测目标日。 | 时间序列。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `forecast_run_id` | 预测运行ID | `uuid` | 否 | 产生本预测行的预测运行稳定ID。 | 区分同地点同目标日的多次算法运行，并连接 ops_forecast_run.forecast_run_id。 | 不适用。 | `e470cc29-e57c-57ca-b359-a936a4ed1e72` | v_ops_forecast_accuracy.forecast_run_id 只表示本字段说明中的 预测运行ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `product_id` | 产品ID | `uuid` | 否 | 统一产品。 | 产品级比较。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | v_ops_forecast_accuracy.product_id 只表示本字段说明中的 产品ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `forecast_quantity` | 预测数量 | `numeric(18,4)` | 否 | 预测中心值。 | 比较基准。 | 不适用。 | `90` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 6 | `actual_quantity` | 实际销量 | `numeric(18,4)` | 是 | POS确认产品销量。 | 实际结果。 | 不适用。 | `86` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `absolute_error` | 绝对误差 | `numeric(18,4)` | 是 | 预测与实际差的绝对值。 | 准确率指标。 | 不适用。 | `4` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `error_rate` | 误差率 | `numeric(12,6)` | 是 | 按批准分母计算的误差比例。 | 跨产品比较。 | 不适用。 | `0.046512` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `direction` | 偏差方向 | `text` | 否 | OVER、UNDER、MATCH、NO_ACTUAL或NO_MAPPING。 | 决策类型。 | 不适用。 | `OVER` | v_ops_forecast_accuracy.direction 只表示本字段说明中的 偏差方向；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `quality_status` | 质量状态 | `text` | 否 | 预测和销售是否可比。 | 防止缺数据伪装准确。 | 不适用。 | `COMPLETE` | v_ops_forecast_accuracy.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_ops_item_daily_pulse` — 产品每日全景

- **用途：** 把计划、实际产出、配送、销售、报废、断货和成本质量放到同一产品日行。
- **一行代表：** 地点 × 营业日 × 产品一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:PRODUCTION_EXECUTION`
- **粒度唯一键：** `location_id + business_date + product_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `ops_production_plan_line` → `ops_production_plan_version` → `ops_production_run_line` → `ops_dispatch_line` → `v_pos_item_sales_day` → `v_pos_item_waste_mapped` → `ops_stockout_event`
- **物理基表闭包：** `ops_dispatch_line`、`ops_production_plan_line`、`ops_production_plan_version`、`ops_production_run_line`、`ops_stockout_event`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_item_waste`、`pos_product_listing`、`pos_product_mapping`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 经营地点。 | 门店/厨房分析。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_ops_item_daily_pulse.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 经营日期。 | 共同日期键。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `product_id` | 产品ID | `uuid` | 否 | 统一产品。 | 共同产品键。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | v_ops_item_daily_pulse.product_id 只表示本字段说明中的 产品ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `planned_quantity` | 计划数量 | `numeric(18,4)` | 是 | 已发布预估单计划量。 | 计划基准。 | 不适用。 | `96` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `produced_quantity` | 实际产出 | `numeric(18,4)` | 是 | 合格生产数量。 | 执行结果。 | 不适用。 | `94` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `received_quantity` | 门店实收 | `numeric(18,4)` | 是 | 配送到门店的实收数量。 | 中央厨房模式可售供给。 | 不适用。 | `47` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `sold_quantity` | 实际销量 | `numeric(18,4)` | 是 | POS映射后的销量。 | 销售结果。 | 不适用。 | `45` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `waste_quantity` | 报废数量 | `numeric(18,4)` | 是 | 计入经营损失的报废数量。 | 损耗。 | 不适用。 | `1` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `stockout_estimated_quantity` | 断货估损数量 | `numeric(18,4)` | 是 | 确认断货事件的估算损失。 | 必须标估算。 | 不适用。 | `3` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `quality_status` | 质量状态 | `text` | 否 | 身份和来源覆盖是否完整。 | 决定是否可行动。 | 不适用。 | `COMPLETE` | v_ops_item_daily_pulse.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_ops_plan_vs_production` — 计划与生产达成

- **用途：** 比较已发布生产计划和实际合格产出。
- **一行代表：** 地点 × 营业日 × 产品一行
- **读取项目：** BakeryOps、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:PRODUCTION_EXECUTION`
- **粒度唯一键：** `location_id + business_date + product_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `ops_production_plan_version` → `ops_production_plan_line` → `ops_production_run` → `ops_production_run_line`
- **物理基表闭包：** `ops_production_plan_line`、`ops_production_plan_version`、`ops_production_run`、`ops_production_run_line`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 生产地点。 | 分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_ops_plan_vs_production.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 计划日期。 | 时间连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-10` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `product_id` | 产品ID | `uuid` | 否 | 统一产品。 | 产品连接。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | v_ops_plan_vs_production.product_id 只表示本字段说明中的 产品ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `planned_quantity` | 计划数量 | `numeric(18,4)` | 否 | 发布计划量。 | 基准。 | 不适用。 | `96` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 5 | `good_quantity` | 合格产出 | `numeric(18,4)` | 是 | 实际合格数量。 | 执行结果。 | 不适用。 | `94` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `variance_quantity` | 数量差异 | `numeric(18,4)` | 是 | 实际减计划。 | 达成差异。 | 不适用。 | `-2` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `attainment_rate` | 达成率 | `numeric(12,6)` | 是 | 实际除计划。 | 跨产品比较。 | 不适用。 | `0.979167` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `quality_status` | 质量状态 | `text` | 否 | 计划和实际是否完整可比。 | 门禁。 | 不适用。 | `COMPLETE` | v_ops_plan_vs_production.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_ops_production_vs_dispatch` — 生产与配送差异

- **用途：** 比较生产地点的合格产出、发出和接收数量。
- **一行代表：** 发出地点 × 接收地点 × 营业日 × 产品一行
- **读取项目：** BakeryOps、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:PRODUCTION_EXECUTION`
- **粒度唯一键：** `from_location_id + to_location_id + business_date + product_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `ops_production_run_line` → `ops_dispatch` → `ops_dispatch_line`
- **物理基表闭包：** `ops_dispatch`、`ops_dispatch_line`、`ops_production_run_line`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `from_location_id` | 发出地点ID | `uuid` | 否 | 生产或发货地点。 | 来源分组。 | 不适用。 | `34b542c7-5a8f-5297-b278-40a1d5ba82e6` | v_ops_production_vs_dispatch.from_location_id 只表示本字段说明中的 发出地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `to_location_id` | 接收地点ID | `uuid` | 否 | 门店或接收地点。 | 目的地分组。 | 不适用。 | `9d80f944-46d9-59f5-bc16-12fb8d4fd187` | v_ops_production_vs_dispatch.to_location_id 只表示本字段说明中的 接收地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `business_date` | 营业日期 | `date` | 否 | 配送服务日期。 | 日期连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-10` | 不要由 created_at 或 UTC 日期临时推导。 |
| 4 | `product_id` | 产品ID | `uuid` | 否 | 统一产品。 | 产品连接。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | v_ops_production_vs_dispatch.product_id 只表示本字段说明中的 产品ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `produced_quantity` | 合格产出 | `numeric(18,4)` | 是 | 来源生产数量。 | 供给基准。 | 不适用。 | `94` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `dispatched_quantity` | 发出数量 | `numeric(18,4)` | 是 | 配送发出数量。 | 在途。 | 不适用。 | `48` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `received_quantity` | 接收数量 | `numeric(18,4)` | 是 | 门店确认合格接收数量。 | 可售供给。 | 不适用。 | `47` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `transit_variance` | 运输差异 | `numeric(18,4)` | 是 | 接收减发出。 | 配送损耗。 | 不适用。 | `-1` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `v_ops_product_mix_daily` — 产品日销售占比

- **用途：** 计算产品销量和销售额占地点日总量的比例及环比变化。
- **一行代表：** 地点 × 营业日 × 产品一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `SHARE_DENOMINATOR_UNDEFINED | PRIOR_PERIOD_SELECTION_UNDEFINED`
- **粒度唯一键：** `location_id + business_date + product_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_pos_item_sales_day` → `v_pos_sales_day_current` → `ops_product`
- **物理基表闭包：** `ops_product`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_listing`、`pos_product_mapping`、`pos_sales_day`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 销售地点。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_ops_product_mix_daily.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 销售日期。 | 时间序列。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `product_id` | 产品ID | `uuid` | 否 | 统一产品。 | 产品连接。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | v_ops_product_mix_daily.product_id 只表示本字段说明中的 产品ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `quantity` | 销量 | `numeric(18,4)` | 否 | 产品日销量。 | 数量占比。 | 不适用。 | `86` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 5 | `net_sales` | 净销售额 | `numeric(18,4)` | 否 | 产品日净销售。 | 销售额占比。 | 不适用。 | `2300` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 6 | `quantity_share` | 数量占比 | `numeric(12,8)` | 是 | 产品销量除可比总销量。 | 产品结构变化。 | 不适用。 | `0.08400000` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `sales_share` | 销售额占比 | `numeric(12,8)` | 是 | 产品净销售除门店日净销售。 | 产品结构变化。 | 不适用。 | `0.04285600` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `sales_share_change` | 占比变化 | `numeric(12,8)` | 是 | 相对批准比较期的销售占比变化。 | 识别上涨或下降。 | 不适用。 | `0.00420000` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `quality_status` | 质量状态 | `text` | 否 | 映射和分母是否完整。 | 防止漏商品扭曲占比。 | 不适用。 | `COMPLETE` | v_ops_product_mix_daily.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_hr_application_current_stage` — 候选申请当前阶段

- **用途：** 从不可变阶段事件中确定性选出每个候选申请当前阶段，同时保留最新事件血缘。
- **一行代表：** 候选申请一行
- **读取项目：** BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `STAGE_SEQUENCE_VALIDATION_UNDEFINED | STAGE_QUALITY_STATUS_PRECEDENCE_UNDEFINED`
- **粒度唯一键：** `application_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `hr_application` → `hr_application_stage_event`
- **物理基表闭包：** `hr_application`、`hr_application_stage_event`
- **说明：** 按 application_id 分组，依次按 occurred_at DESC、application_stage_event_id DESC 取一行；相同时间由UUID稳定决胜。阶段顺序异常不自动修复，进入质量队列。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `application_id` | 申请ID | `uuid` | 否 | 候选申请稳定身份。 | 招聘流程连接。 | 不适用。 | `9c0084be-8e1a-5a7b-9c50-05aa41d211d8` | v_hr_application_current_stage.application_id 只表示本字段说明中的 申请ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `person_id` | 人员ID | `uuid` | 否 | 申请人自然人身份。 | 人员连接。 | 不适用。 | `2b8b6c93-c5a2-5e92-94c5-534b04d1a538` | v_hr_application_current_stage.person_id 只表示本字段说明中的 人员ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `job_requisition_id` | 招聘需求ID | `uuid` | 否 | 申请对应的招聘需求。 | 岗位和地点连接。 | 不适用。 | `24c6e580-770e-5e36-a01f-4454b5454615` | v_hr_application_current_stage.job_requisition_id 只表示本字段说明中的 招聘需求ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `application_stage_event_id` | 当前阶段事件ID | `uuid` | 是 | 被确定性选中的最新阶段事件。 | 回查阶段证据。 | 不适用。 | `ec0fdd8f-bb4d-5804-b641-1067f6650876` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `current_stage` | 当前阶段 | `text` | 是 | 最新事件的 to_stage；尚无事件时为空并触发质量问题。 | 漏斗和待办。 | 不适用。 | `INTERVIEW` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `stage_reason_code` | 阶段原因 | `text` | 是 | 最新阶段事件的标准原因。 | 解释拒绝、退出或停滞。 | 不适用。 | `NO_RESPONSE` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `stage_occurred_at` | 阶段发生时间 | `timestamptz` | 是 | 进入当前阶段的业务时间。 | 计算停留时长。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-10T09:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `quality_status` | 质量状态 | `text` | 否 | COMPLETE、NO_STAGE_EVENT 或 INVALID_TRANSITION。 | 禁止把缺失阶段默认为NEW。 | 不适用。 | `COMPLETE` | v_hr_application_current_stage.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_hr_assessment_summary` — 候选评估汇总

- **用途：** 从逐项评分派生加权总分、满分和得分率，并与评估建议及红线结论一起展示。
- **一行代表：** 一次候选评估一行
- **读取项目：** BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `FIX_MODEL_CONTRACT`
- **稳定阻断码：** `ASSESSMENT_QUALITY_STATUS_PRECEDENCE_UNDEFINED`
- **粒度唯一键：** `assessment_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `hr_assessment` → `hr_assessment_score`
- **物理基表闭包：** `hr_assessment`、`hr_assessment_score`
- **说明：** total_score 不落基础表。recommendation 和 red_flag 是人的决策事实，不允许仅由 score_rate 反推或覆盖。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `assessment_id` | 评估ID | `uuid` | 否 | 候选评估稳定身份。 | 连接逐项评分。 | 不适用。 | `3a095d3d-e9eb-56f1-aa32-614e93f0e446` | v_hr_assessment_summary.assessment_id 只表示本字段说明中的 评估ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `application_id` | 申请ID | `uuid` | 否 | 被评估候选申请。 | 招聘漏斗连接。 | 不适用。 | `9c0084be-8e1a-5a7b-9c50-05aa41d211d8` | v_hr_assessment_summary.application_id 只表示本字段说明中的 申请ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `scored_item_count` | 已评分项目数 | `integer` | 否 | score 非空的评分项目数。 | 判断评估是否完整。 | 不适用。 | `8` | v_hr_assessment_summary.scored_item_count 只表示本字段说明中的 已评分项目数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `weighted_score` | 加权得分 | `numeric(18,6)` | 是 | 逐项 score × weight 之和。 | 保留模板内原始加权结果。 | 不适用。 | `72.0` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `weighted_max_score` | 加权满分 | `numeric(18,6)` | 是 | 逐项 max_score × weight 之和。 | 得分率分母。 | 不适用。 | `80.0` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `score_rate` | 得分率 | `numeric(12,8)` | 是 | 加权得分除加权满分；无有效分母时为空。 | 跨模板谨慎比较。 | 不适用。 | `0.90000000` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `recommendation` | 评估建议 | `text` | 否 | 评估主表保存的结构化建议。 | 决策参考，不从分数自动推断。 | 不适用。 | `HIRE` | v_hr_assessment_summary.recommendation 只表示本字段说明中的 评估建议；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `red_flag` | 是否红线 | `boolean` | 否 | 评估主表的红线结论或评分项红线。 | 即使得分高也必须人工处理。 | 不适用。 | `false` | v_hr_assessment_summary.red_flag 只表示本字段说明中的 是否红线；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `quality_status` | 质量状态 | `text` | 否 | COMPLETE、MISSING_SCORE、ZERO_WEIGHT 或 RED_FLAG。 | 解释总分是否可用。 | 不适用。 | `COMPLETE` | v_hr_assessment_summary.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_hr_role_eligibility` — 员工岗位资格

- **用途：** 按当前日期汇总员工对岗位的培训要求、通过结果和有效期。
- **一行代表：** 雇佣关系 × 岗位一行
- **读取项目：** BakeryOps、HR、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:TRAINING_AND_ONBOARDING`
- **粒度唯一键：** `employment_id + role_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `hr_employment` → `ops_role_training_requirement` → `hr_training_course` → `hr_training_assignment` → `hr_training_result`
- **物理基表闭包：** `hr_employment`、`hr_training_assignment`、`hr_training_course`、`hr_training_result`、`ops_role_training_requirement`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `employment_id` | 雇佣ID | `uuid` | 否 | 员工雇佣关系。 | 班表指派。 | 不适用。 | `e3bfa5c1-327a-548c-9fa5-473d7d1aa16e` | v_hr_role_eligibility.employment_id 只表示本字段说明中的 雇佣ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `role_id` | 岗位ID | `uuid` | 否 | 标准岗位。 | 班表需求。 | 不适用。 | `09f16903-340c-50f3-acd6-30b573a18dde` | v_hr_role_eligibility.role_id 只表示本字段说明中的 岗位ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `mandatory_course_count` | 强制课程数 | `integer` | 否 | 当前岗位必须课程数量。 | 资格分母。 | 不适用。 | `3` | v_hr_role_eligibility.mandatory_course_count 只表示本字段说明中的 强制课程数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `valid_course_count` | 有效通过数 | `integer` | 否 | 当前仍有效的通过课程数。 | 资格判断。 | 不适用。 | `3` | v_hr_role_eligibility.valid_course_count 只表示本字段说明中的 有效通过数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `missing_course_codes` | 缺失课程 | `text[]` | 否 | 未通过或未完成课程代码。 | 修复动作。 | 不适用。 | `{}` | v_hr_role_eligibility.missing_course_codes 只表示本字段说明中的 缺失课程；必须在所属对象粒度内按 text[] 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `expired_course_codes` | 过期课程 | `text[]` | 否 | 资格已过期课程代码。 | 续训动作。 | 不适用。 | `{}` | v_hr_role_eligibility.expired_course_codes 只表示本字段说明中的 过期课程；必须在所属对象粒度内按 text[] 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `eligibility_status` | 资格状态 | `text` | 否 | ELIGIBLE、MISSING_TRAINING、EXPIRED或INACTIVE。 | 班表硬门禁。 | 不适用。 | `ELIGIBLE` | v_hr_role_eligibility.eligibility_status 只表示本字段说明中的 资格状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `valid_until` | 资格最早到期 | `timestamptz` | 是 | 所有必要资格中的最早到期时间。 | 提前续训。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2027-08-25T15:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `v_ops_shift_publish_readiness` — 班表发布就绪

- **用途：** 汇总班表版本的关键岗位覆盖、资格违规、需求人数和重叠指派。
- **一行代表：** 班表版本一行
- **读取项目：** BakeryOps、HR、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:SHIFT_AND_WORKFORCE | EXTENSION_PACK_NOT_ACTIVATED:TRAINING_AND_ONBOARDING`
- **粒度唯一键：** `shift_plan_version_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `ops_shift_plan_version` → `ops_shift_requirement` → `ops_shift_assignment` → `v_hr_role_eligibility`
- **物理基表闭包：** `hr_employment`、`hr_training_assignment`、`hr_training_course`、`hr_training_result`、`ops_role_training_requirement`、`ops_shift_assignment`、`ops_shift_plan_version`、`ops_shift_requirement`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `shift_plan_version_id` | 班表版本ID | `uuid` | 否 | 待校验班表版本。 | 发布对象。 | 不适用。 | `21d36074-0241-548f-ab55-c23c66656ea9` | v_ops_shift_publish_readiness.shift_plan_version_id 只表示本字段说明中的 班表版本ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `location_id` | 地点ID | `uuid` | 否 | 班表地点。 | 范围。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_ops_shift_publish_readiness.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `business_date` | 营业日期 | `date` | 否 | 班表日期。 | 日期连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-10` | 不要由 created_at 或 UTC 日期临时推导。 |
| 4 | `required_headcount` | 总需求人数时段数 | `integer` | 否 | 需求行人数总和。 | 覆盖基准。 | 不适用。 | `18` | v_ops_shift_publish_readiness.required_headcount 只表示本字段说明中的 总需求人数时段数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `assigned_headcount` | 已指派人数时段数 | `integer` | 否 | 合格指派总数。 | 覆盖结果。 | 不适用。 | `18` | v_ops_shift_publish_readiness.assigned_headcount 只表示本字段说明中的 已指派人数时段数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `critical_gap_count` | 关键岗位缺口 | `integer` | 否 | 关键岗位未覆盖数量。 | 必须为0才可发布。 | 不适用。 | `0` | v_ops_shift_publish_readiness.critical_gap_count 只表示本字段说明中的 关键岗位缺口；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `eligibility_violation_count` | 资格违规数 | `integer` | 否 | 强制培训未满足指派数量。 | 必须为0或有批准例外。 | 不适用。 | `0` | v_ops_shift_publish_readiness.eligibility_violation_count 只表示本字段说明中的 资格违规数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `overlap_count` | 重叠班次数 | `integer` | 否 | 同一员工时间重叠数量。 | 排班错误门禁。 | 不适用。 | `0` | v_ops_shift_publish_readiness.overlap_count 只表示本字段说明中的 重叠班次数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `readiness_status` | 就绪状态 | `text` | 否 | READY、BLOCKED或WARNING。 | 发布门禁。 | 不适用。 | `READY` | v_ops_shift_publish_readiness.readiness_status 只表示本字段说明中的 就绪状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_hr_timesheet_entry_current` — 当前有效工时记录

- **用途：** 对来源系统同一工时记录的多次获准采集确定性选出当前版本，避免重跑或更正被重复计入人效。
- **一行代表：** 来源系统 × 外部工时ID一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** SOURCE_CONDITIONAL
- **SELECT规格准备度：** `DEFER_SOURCE`
- **稳定阻断码：** `SOURCE_CONTRACT_NOT_VERIFIED:HR_TIMESHEET_ENTRY`
- **粒度唯一键：** `source_system_id + source_entry_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `hr_timesheet_sync_batch` → `hr_timesheet_entry`
- **物理基表闭包：** `hr_timesheet_entry`、`hr_timesheet_sync_batch`
- **说明：** 只读取 SUCCEEDED 或按规则允许的 PARTIAL 批次；按 source_system_id、source_entry_id 分组，以批次 completed_at DESC、timesheet_sync_batch_id DESC 确定性选版。同一 idempotency_key 不产生第二批。来源撤销/删除语义未获证前，本视图和两张工时表均保持 SOURCE_CONDITIONAL。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `timesheet_entry_id` | 工时记录ID | `uuid` | 否 | 被选中的最细工时版本。 | 回查该次规范化结果。 | 不适用。 | `fb3c71ea-09f9-55d3-9e9a-c6c3682e2c62` | v_hr_timesheet_entry_current.timesheet_entry_id 只表示本字段说明中的 工时记录ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `timesheet_sync_batch_id` | 工时批次ID | `uuid` | 否 | 产生当前版本的获准幂等批次。 | 批次完整性和解析版本追踪。 | 不适用。 | `ebab8cfd-fc07-5847-bbd8-c31a869387f9` | v_hr_timesheet_entry_current.timesheet_sync_batch_id 只表示本字段说明中的 工时批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `source_system_id` | 来源系统ID | `uuid` | 否 | 经同步批次取得的来源命名空间。 | 与外部工时ID共同确定业务身份。 | 不适用。 | `cc179b9f-5b40-5789-b0bc-58190727cd35` | 这是来源系统证据，不等于企业统一身份。 |
| 4 | `source_entry_id` | 外部工时ID | `text` | 否 | 来源内稳定工时记录ID。 | 跨更正版本分组。 | 不适用。 | `lark_attendance_8812` | 这是来源系统证据，不等于企业统一身份。 |
| 5 | `employment_id` | 雇佣ID | `uuid` | 否 | 当前版本映射到的员工雇佣关系。 | 连接人员、班表和人效。 | 不适用。 | `e3bfa5c1-327a-548c-9fa5-473d7d1aa16e` | v_hr_timesheet_entry_current.employment_id 只表示本字段说明中的 雇佣ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `location_id` | 地点ID | `uuid` | 否 | 当前版本认定的工作地点。 | 销售和班表共同维度。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_hr_timesheet_entry_current.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `business_date` | 营业日期 | `date` | 否 | 当前版本归属的营业日。 | 日级人效。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 8 | `clock_in_at` | 上班打卡时间 | `timestamptz` | 是 | 当前来源版本开始时间。 | 迟到和时段核对。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-08T08:01:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `clock_out_at` | 下班打卡时间 | `timestamptz` | 是 | 当前来源版本结束时间。 | 早退和时段核对。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-08T17:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `net_work_minutes` | 标准净工时分钟 | `integer` | 否 | 当前获准解析版本的净工作分钟。 | 人效与人工成本核对。 | 不适用。 | `480` | v_hr_timesheet_entry_current.net_work_minutes 只表示本字段说明中的 标准净工时分钟；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `quality_status` | 质量状态 | `text` | 否 | 当前版本的身份、时间和重叠质量结论。 | 不合格记录不得进入正式汇总。 | 不适用。 | `COMPLETE` | v_hr_timesheet_entry_current.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `revision_count` | 采集版本数 | `bigint` | 否 | 该来源工时ID保留的获准版本数量。 | 识别来源更正。 | 不适用。 | `2` | v_hr_timesheet_entry_current.revision_count 只表示本字段说明中的 采集版本数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_ops_labor_productivity` — 门店人效

- **用途：** 在地点营业日粒度比较实际净工时与 POS 净销售；不伪造产品级人工成本。
- **一行代表：** 地点 × 营业日一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** SOURCE_CONDITIONAL
- **SELECT规格准备度：** `DEFER_SOURCE`
- **稳定阻断码：** `SOURCE_CONTRACT_NOT_VERIFIED:HR_TIMESHEET_ENTRY | EXTENSION_PACK_NOT_ACTIVATED:SHIFT_AND_WORKFORCE`
- **粒度唯一键：** `location_id + business_date`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_hr_timesheet_entry_current` → `v_pos_sales_day_current` → `ops_shift_assignment` → `ops_shift_requirement`
- **物理基表闭包：** `hr_timesheet_entry`、`hr_timesheet_sync_batch`、`ops_shift_assignment`、`ops_shift_requirement`、`pos_ingest_batch`、`pos_sales_day`
- **说明：** 仅在 location_id + business_date 粒度计算。没有批准的产品人工分摊规则前，不输出产品级人工成本。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 人效地点。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_ops_labor_productivity.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 工时和销售日期。 | 共同粒度。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `net_sales` | 净销售额 | `numeric(18,4)` | 是 | POS当前有效净销售。 | 人效分子。 | 不适用。 | `53670` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `net_work_minutes` | 实际净工时分钟 | `bigint` | 是 | 合格工时记录总分钟。 | 人效分母。 | 不适用。 | `7200` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `net_work_hours` | 实际净工时小时 | `numeric(18,4)` | 是 | 分钟除60。 | 易读展示。 | 不适用。 | `120` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `sales_per_work_hour` | 每工时销售 | `numeric(18,4)` | 是 | 净销售除实际工时小时。 | 门店级人效。 | 不适用。 | `447.25` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `scheduled_minutes` | 计划分钟 | `bigint` | 是 | 正式班表计划净分钟。 | 计划与实际比较。 | 不适用。 | `7100` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `quality_status` | 质量状态 | `text` | 否 | 销售和工时身份、来源是否完整。 | 必须与人效共同展示。 | 不适用。 | `COMPLETE` | v_ops_labor_productivity.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_scm_material_requirement_line` — 原料需求派生汇总

- **用途：** 从最细需求组成行按运行和原料汇总毛需求、基础单位与运行质量，不保存第二份汇总事实。
- **一行代表：** 需求运行 × 原料一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY`
- **粒度唯一键：** `material_requirement_key`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `scm_material_requirement_run` → `scm_material_requirement_component` → `scm_material`
- **物理基表闭包：** `scm_material`、`scm_material_requirement_component`、`scm_material_requirement_run`
- **说明：** 只汇总 quality_status='COMPLETE' 且 material_id/material_quantity 非空的组成行；run_issue_count 对整个运行计数，因此不能因某种原料自身完整而掩盖另一计划产品缺配方。无组成行时不伪造0需求。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `material_requirement_key` | 派生需求键 | `char(64)` | 否 | 由 material_requirement_run_id 与 material_id 规范化计算的 SHA-256。 | 下游核对和导出稳定定位；不是物理主键。 | 不适用。 | `c41e...64位十六进制` | v_scm_material_requirement_line.material_requirement_key 只表示本字段说明中的 派生需求键；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `material_requirement_run_id` | 需求运行ID | `uuid` | 否 | 需求计算运行。 | 版本和输入血缘。 | 不适用。 | `083d036f-534a-5b5b-975e-9c7660a42b1e` | v_scm_material_requirement_line.material_requirement_run_id 只表示本字段说明中的 需求运行ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `location_id` | 需求地点ID | `uuid` | 否 | 运行对应生产或备货地点。 | 库存和补货连接。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_scm_material_requirement_line.location_id 只表示本字段说明中的 需求地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `requirement_date` | 需求日期 | `date` | 否 | 原料必须可用的营业日期。 | 补货和采购到货目标。 | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。 | `2026-08-10` | v_scm_material_requirement_line.requirement_date 只表示本字段说明中的 需求日期；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `material_id` | 原料ID | `uuid` | 否 | 成功展开得到的统一原料。 | 采购、库存和成本连接。 | 不适用。 | `8c355ce8-319e-59d1-adae-a774f7e4d708` | v_scm_material_requirement_line.material_id 只表示本字段说明中的 原料ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `gross_required_quantity` | 毛需求量 | `numeric(18,6)` | 否 | 所有 COMPLETE 组成行 material_quantity 的合计。 | 补货计算的派生输入。 | 不适用。 | `12500` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 7 | `base_unit_id` | 基础单位ID | `uuid` | 否 | 直接读取 material.base_unit_id。 | 解释毛需求数量单位，不在需求输出重复存。 | 不适用。 | `d14b77c4-31d3-5801-a1cc-06c69aab9b6b` | v_scm_material_requirement_line.base_unit_id 只表示本字段说明中的 基础单位ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `component_count` | 组成行数 | `bigint` | 否 | 参与该原料汇总的 COMPLETE 组成行数。 | 解释汇总来源。 | 不适用。 | `14` | v_scm_material_requirement_line.component_count 只表示本字段说明中的 组成行数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `run_issue_count` | 运行阻断数 | `bigint` | 否 | 同一运行中所有非 COMPLETE 组成/错误行数。 | 任一阻断都禁止自动形成正式订货。 | 不适用。 | `0` | v_scm_material_requirement_line.run_issue_count 只表示本字段说明中的 运行阻断数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `quality_status` | 质量状态 | `text` | 否 | COMPLETE 或 BLOCKED。 | 补货门禁必须与数量共同读取。 | 不适用。 | `COMPLETE` | v_scm_material_requirement_line.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_scm_material_requirement_trace` — 原料需求穿透

- **用途：** 逐行展示需求运行实际产出的原料贡献或质量阻断，并穿透到计划产品和配方组件。
- **一行代表：** 需求组成行一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY`
- **粒度唯一键：** `material_requirement_component_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `scm_material_requirement_run` → `scm_material_requirement_component` → `ops_production_plan_line` → `cost_card_recipe_component` → `cost_card_recipe_version`
- **物理基表闭包：** `cost_card_recipe_component`、`cost_card_recipe_version`、`ops_production_plan_line`、`scm_material_requirement_component`、`scm_material_requirement_run`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `material_requirement_component_id` | 需求组成ID | `uuid` | 否 | 最细运行输出行。 | 精确定位贡献或错误。 | 不适用。 | `7c9ea8c8-86aa-517d-b7c7-558f2f464526` | v_scm_material_requirement_trace.material_requirement_component_id 只表示本字段说明中的 需求组成ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `material_requirement_run_id` | 需求运行ID | `uuid` | 否 | 需求计算。 | 版本追踪。 | 不适用。 | `083d036f-534a-5b5b-975e-9c7660a42b1e` | v_scm_material_requirement_trace.material_requirement_run_id 只表示本字段说明中的 需求运行ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `material_id` | 原料ID | `uuid` | 是 | 成功展开时的统一原料；阻断行可为空。 | 采购和库存连接。 | 不适用。 | `8c355ce8-319e-59d1-adae-a774f7e4d708` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `product_id` | 产品ID | `uuid` | 否 | 产生需求的计划产品。 | 解释需求来源。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | v_scm_material_requirement_trace.product_id 只表示本字段说明中的 产品ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `production_plan_line_id` | 计划行ID | `uuid` | 否 | 计划产品数量来源。 | 穿透到预估单。 | 不适用。 | `211f5b06-87e3-5558-b5c7-ebbd51f71cee` | v_scm_material_requirement_trace.production_plan_line_id 只表示本字段说明中的 计划行ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `recipe_version_id` | 配方版本ID | `uuid` | 是 | 成功采用的配方版本；缺配方时为空。 | 解释配方波动和缺口。 | 不适用。 | `e1625bd2-6bdd-5c0d-b520-86dc36181c5b` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `recipe_component_id` | 配方组件ID | `uuid` | 是 | 成功采用的原料组件；阻断行可为空。 | 解释用量。 | 不适用。 | `0ffec6cc-f473-5df3-961c-0014694b5c7a` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `planned_product_quantity` | 计划产品数 | `numeric(18,4)` | 否 | 计算输入数量。 | 复现需求。 | 不适用。 | `96` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 9 | `material_quantity` | 原料贡献量 | `numeric(18,6)` | 是 | 该计划和组件贡献需求；阻断行为空。 | 汇总派生。 | 不适用。 | `4800` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `quality_status` | 质量状态 | `text` | 否 | COMPLETE、MISSING_RECIPE、MISSING_MAPPING、UNIT_ERROR 或 REJECTED。 | 采购门禁。 | 不适用。 | `COMPLETE` | v_scm_material_requirement_trace.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `warning_detail` | 质量说明 | `jsonb` | 否 | 质量阻断的结构化证据。 | 修复定位。 | 不适用。 | `{}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |

## `v_scm_material_requirement_reconciliation` — 原料需求到补货输入核对

- **用途：** 比较派生原料毛需求与后续补货运行冻结的 required_quantity，识别跨步骤复制漂移。
- **一行代表：** 需求运行 × 原料 × 可选补货行一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY`
- **粒度唯一键：** `material_requirement_key + replenishment_line_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_scm_material_requirement_line` → `scm_replenishment_run` → `scm_replenishment_line`
- **物理基表闭包：** `scm_material`、`scm_material_requirement_component`、`scm_material_requirement_run`、`scm_replenishment_line`、`scm_replenishment_run`
- **说明：** 先要求 replenishment_run.material_requirement_run_id 精确相同，再按 material_id 连接；需求运行有阻断时为 BLOCKED，尚无补货行为 NO_DOWNSTREAM。绝不把不同运行的相似数量视为同一来源。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：replenishment_line_id；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `material_requirement_key` | 派生需求键 | `char(64)` | 否 | 需求运行与原料的派生键。 | 核对定位。 | 不适用。 | `c41e...64位十六进制` | v_scm_material_requirement_reconciliation.material_requirement_key 只表示本字段说明中的 派生需求键；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `material_requirement_run_id` | 需求运行ID | `uuid` | 否 | 原料需求运行。 | 上游版本。 | 不适用。 | `083d036f-534a-5b5b-975e-9c7660a42b1e` | v_scm_material_requirement_reconciliation.material_requirement_run_id 只表示本字段说明中的 需求运行ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `material_id` | 原料ID | `uuid` | 否 | 被核对原料。 | 物料分组。 | 不适用。 | `8c355ce8-319e-59d1-adae-a774f7e4d708` | v_scm_material_requirement_reconciliation.material_id 只表示本字段说明中的 原料ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `gross_required_quantity` | 派生毛需求量 | `numeric(18,6)` | 否 | 由最细组成行汇总的需求量。 | 唯一需求汇总口径。 | 不适用。 | `12500` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 5 | `replenishment_line_id` | 补货行ID | `uuid` | 是 | 采用该需求运行的后续补货建议行；尚未运行补货时为空。 | 下游定位。 | 不适用。 | `8033fdf8-8447-574a-a538-31e9bb60bc7d` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `replenishment_required_quantity` | 补货冻结需求量 | `numeric(18,6)` | 是 | 补货算法运行时复制并冻结的需求输入。 | 证明下游采用了多少。 | 不适用。 | `12500` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `difference_quantity` | 传递差异 | `numeric(18,6)` | 是 | 补货冻结需求量减派生毛需求量。 | 非0表示跨步骤漂移或不同输入版本。 | 不适用。 | `0` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `reconciliation_status` | 核对状态 | `text` | 否 | MATCH、NO_DOWNSTREAM、DRIFT 或 BLOCKED。 | 正式补货质量门禁。 | 不适用。 | `MATCH` | v_scm_material_requirement_reconciliation.reconciliation_status 只表示本字段说明中的 核对状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_scm_replenishment_trace` — 订货建议穿透

- **用途：** 把原料需求、库存、在途、安全量、建议量、批准量、PO和收货串成一行。
- **一行代表：** 补货运行 × 原料 × 可选供应商商品版本一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY`
- **粒度唯一键：** `replenishment_line_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `scm_replenishment_run` → `scm_replenishment_line` → `scm_supplier_item` → `scm_purchase_order_line` → `scm_purchase_order_revision` → `scm_goods_receipt_line`
- **物理基表闭包：** `scm_goods_receipt_line`、`scm_purchase_order_line`、`scm_purchase_order_revision`、`scm_replenishment_line`、`scm_replenishment_run`、`scm_supplier_item`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `replenishment_line_id` | 补货行ID | `uuid` | 否 | 补货建议行。 | 主追踪对象。 | 不适用。 | `8033fdf8-8447-574a-a538-31e9bb60bc7d` | v_scm_replenishment_trace.replenishment_line_id 只表示本字段说明中的 补货行ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `location_id` | 地点ID | `uuid` | 否 | 补货地点。 | 门店/仓库连接。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_scm_replenishment_trace.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `material_id` | 原料ID | `uuid` | 否 | 统一原料。 | 需求和采购连接。 | 不适用。 | `8c355ce8-319e-59d1-adae-a774f7e4d708` | v_scm_replenishment_trace.material_id 只表示本字段说明中的 原料ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `supplier_item_id` | 供应商商品版本ID | `uuid` | 是 | 建议采用的供应商SKU、物料与包装有效版本。 | 保证建议、下单和价格采用同一版本。 | 不适用。 | `9ad313b3-7d82-5f49-838c-cfc5e5304b94` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `required_quantity` | 需求量 | `numeric(18,6)` | 否 | 计划配方需求。 | 公式输入。 | 不适用。 | `12500` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 6 | `available_quantity` | 可用量 | `numeric(18,6)` | 否 | 计算时库存。 | 公式输入。 | 不适用。 | `4000` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 7 | `in_transit_quantity` | 在途量 | `numeric(18,6)` | 否 | 未收PO数量。 | 公式输入。 | 不适用。 | `2000` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `suggested_quantity` | 建议量 | `numeric(18,6)` | 否 | 算法建议。 | 审批比较。 | 不适用。 | `8000` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 9 | `approved_quantity` | 批准量 | `numeric(18,6)` | 是 | 人工批准。 | PO来源。 | 不适用。 | `10000` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `delta_quantity` | 人工增减量 | `numeric(18,6)` | 是 | approved_quantity 减 suggested_quantity；未批准时为空。 | 衡量人工调整，不在基础表重复存储。 | 不适用。 | `2000` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `ordered_base_quantity` | 已订基础量 | `numeric(18,6)` | 是 | 正式采购行数量。 | 执行闭环。 | 不适用。 | `10000` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `received_base_quantity` | 已收基础量 | `numeric(18,6)` | 是 | 合格收货数量。 | 交付闭环。 | 不适用。 | `9800` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `quality_status` | 质量状态 | `text` | 否 | 映射、单位和审批是否完整。 | 行动门禁。 | 不适用。 | `COMPLETE` | v_scm_replenishment_trace.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_scm_inventory_balance` — 库存余额

- **用途：** 从最近批准盘点和之后已过账库存移动推导地点、原料和批号余额。
- **一行代表：** 地点 × 原料 × 可选批号一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY`
- **粒度唯一键：** `location_id + material_id + lot_code + expiry_date`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `scm_inventory_count` → `scm_inventory_count_line` → `scm_inventory_movement` → `scm_inventory_movement_line`
- **物理基表闭包：** `scm_inventory_count`、`scm_inventory_count_line`、`scm_inventory_movement`、`scm_inventory_movement_line`
- **说明：** 只读分析接口，不允许作为业务事实写入口。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：lot_code, expiry_date；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 库存地点。 | 分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_scm_inventory_balance.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `material_id` | 原料ID | `uuid` | 否 | 统一原料。 | 采购和配方连接。 | 不适用。 | `8c355ce8-319e-59d1-adae-a774f7e4d708` | v_scm_inventory_balance.material_id 只表示本字段说明中的 原料ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `lot_code` | 批号 | `text` | 是 | 批次追踪物料批号。 | 效期和召回。 | 不适用。 | `LOT-20260715-A` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `expiry_date` | 到期日期 | `date` | 是 | 批号到期日。 | FEFO。 | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。 | `2027-07-15` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `last_counted_at` | 最近盘点时点 | `timestamptz` | 是 | 余额起点盘点时间。 | 新鲜度。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-31T22:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `counted_quantity` | 盘点起点量 | `numeric(18,6)` | 是 | 批准盘点数量。 | 余额基线。 | 不适用。 | `12500` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `movement_net_quantity` | 盘点后净移动 | `numeric(18,6)` | 否 | 盘点后已过账入减出。 | 余额桥接。 | 不适用。 | `-2500` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `on_hand_quantity` | 当前推导余额 | `numeric(18,6)` | 是 | 盘点起点加净移动。 | 补货可用量。 | 不适用。 | `10000` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `quality_status` | 质量状态 | `text` | 否 | 有无有效盘点、单位或批号问题。 | 库存可信度。 | 不适用。 | `COMPLETE` | v_scm_inventory_balance.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_scm_purchase_order_reconciliation` — 采购单版本金额核对

- **用途：** 比较采购单批准版本的冻结单头金额与最小采购行汇总，保留正式单据同时证明合计没有漂移。
- **一行代表：** 采购订单版本一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY`
- **粒度唯一键：** `purchase_order_revision_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `scm_purchase_order_revision` → `scm_purchase_order_line`
- **物理基表闭包：** `scm_purchase_order_line`、`scm_purchase_order_revision`
- **说明：** 单头合计作为已批准/已发送文档快照可以保留，但不是另一套独立事实；DRAFT提交前和每次读取正式版本时都应核对采购行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `purchase_order_revision_id` | 采购版本ID | `uuid` | 否 | 被核对的采购单版本。 | 版本定位。 | 不适用。 | `8226cd04-8374-5f9c-9f2e-d930dcb17398` | v_scm_purchase_order_reconciliation.purchase_order_revision_id 只表示本字段说明中的 采购版本ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `purchase_order_code` | 采购单号 | `text` | 否 | 跨版本稳定采购单代码。 | 供应商单据和版本分组。 | 不适用。 | `PO-20260809-001` | v_scm_purchase_order_reconciliation.purchase_order_code 只表示本字段说明中的 采购单号；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `revision_no` | 版本号 | `integer` | 否 | 采购单版本序号。 | 供应商单据识别。 | 不适用。 | `2` | v_scm_purchase_order_reconciliation.revision_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `header_subtotal_amount` | 单头未税小计 | `numeric(18,4)` | 否 | 批准版本冻结的未税小计。 | 保留供应商收到的单据金额。 | 不适用。 | `1250.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 5 | `line_amount_sum` | 采购行金额合计 | `numeric(18,4)` | 是 | 全部采购行 line_amount 之和。 | 最小行事实核对。 | 不适用。 | `1250.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `subtotal_difference` | 小计差异 | `numeric(18,4)` | 是 | 单头小计减采购行合计。 | 舍入容差外必须阻断发送。 | 不适用。 | `0` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `header_tax_amount` | 单头税额 | `numeric(18,4)` | 否 | 批准版本冻结税额。 | 正式单据税额。 | 不适用。 | `0` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 8 | `header_total_amount` | 单头总额 | `numeric(18,4)` | 否 | 批准版本冻结总额。 | 付款和财务核对。 | 不适用。 | `1250.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 9 | `expected_total_amount` | 应有总额 | `numeric(18,4)` | 是 | 采购行合计加单头税额。 | 独立复算总额。 | 不适用。 | `1250.00` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `reconciliation_status` | 核对状态 | `text` | 否 | MATCH、ROUNDING_WARNING、MISMATCH 或 NO_LINES。 | 提交、批准和发送门禁。 | 不适用。 | `MATCH` | v_scm_purchase_order_reconciliation.reconciliation_status 只表示本字段说明中的 核对状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_scm_supplier_item_current_mapping` — 当前供应商商品物料映射

- **用途：** 按查询时点从供应商商品版本中返回每个供应商SKU唯一有效且已确认的物料和包装规格。
- **一行代表：** 供应商 × 供应商SKU一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `FIX_MODEL_CONTRACT`
- **稳定阻断码：** `AS_OF_SEMANTICS_UNRESOLVED`
- **粒度唯一键：** `supplier_id + supplier_sku`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `scm_supplier` → `scm_supplier_item` → `scm_material` → `scm_material_unit_conversion`
- **物理基表闭包：** `scm_material`、`scm_material_unit_conversion`、`scm_supplier`、`scm_supplier_item`
- **说明：** scm_supplier_item 本身就是有效期版本，不再另设映射表。base_unit_quantity 从 order_unit_id、material.base_unit_id 和 material_unit_conversion_id 确定性派生。以查询 as_of 时点应用 valid_from <= as_of AND (valid_to IS NULL OR as_of < valid_to)，只接受 CONFIRMED；无有效版本时按供应商目录业务键报告 MISSING，不按名称猜填。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `supplier_item_id` | 供应商商品版本ID | `uuid` | 是 | 当前有效的供应商SKU版本。 | 补货、采购和价格锁定的版本键。 | 不适用。 | `9ad313b3-7d82-5f49-838c-cfc5e5304b94` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 2 | `supplier_id` | 供应商ID | `uuid` | 否 | SKU所属供应商。 | 供应商分组。 | 不适用。 | `e8805f51-3cde-5a40-90ec-b8b364468f7b` | v_scm_supplier_item_current_mapping.supplier_id 只表示本字段说明中的 供应商ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `supplier_sku` | 供应商SKU | `text` | 否 | 供应商原始商品编码。 | 跨版本稳定业务键。 | 不适用。 | `FLOUR-25KG` | v_scm_supplier_item_current_mapping.supplier_sku 只表示本字段说明中的 供应商SKU；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `material_id` | 原料ID | `uuid` | 是 | 当前确认的统一物料。 | 需求、库存和成本连接。 | 不适用。 | `8c355ce8-319e-59d1-adae-a774f7e4d708` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `material_unit_conversion_id` | 物料单位换算ID | `uuid` | 是 | 当前包装换算证据。 | 单位治理。 | 不适用。 | `f9a81ba2-3965-5023-b2aa-3e2c6bd19731` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `base_unit_quantity` | 每订购单位基础量 | `numeric(18,6)` | 是 | order_unit 等于物料基础单位时取1，否则由当前版本的物料单位换算系数计算。 | MOQ取整和价格归一化；不是供应商商品表中的重复存储值。 | 不适用。 | `5000` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `valid_from` | 生效时间 | `timestamptz` | 是 | 映射版本生效起点。 | 时点选择。 | 生效区间起点，采用含起点语义。 | `2026-08-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `valid_to` | 失效时间 | `timestamptz` | 是 | 映射版本失效上界。 | 历史解释。 | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。 | `2026-12-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `mapping_status` | 映射状态 | `text` | 否 | CONFIRMED 或 MISSING。 | 未映射SKU不得正式采购。 | 不适用。 | `CONFIRMED` | v_scm_supplier_item_current_mapping.mapping_status 只表示本字段说明中的 映射状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_scm_supplier_price_current` — 当前供应商采购价

- **用途：** 为每个供应商商品选择最新合格价格观察并显示来源和归一化单价。
- **一行代表：** 供应商商品一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `AS_OF_SEMANTICS_UNRESOLVED | NORMALIZED_PRICE_FORMULA_INPUTS_INCOMPLETE`
- **粒度唯一键：** `supplier_item_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `scm_supplier` → `scm_supplier_item` → `scm_material` → `scm_material_unit_conversion` → `scm_supplier_price_observation`
- **物理基表闭包：** `scm_material`、`scm_material_unit_conversion`、`scm_supplier`、`scm_supplier_item`、`scm_supplier_price_observation`
- **说明：** normalized_price_myr = raw_unit_price × COALESCE(fx_rate_to_myr,1) ÷ 单位换算系数；任一必需输入缺失即为 NULL。仅候选 quality_status='VERIFIED' 且 supplier_item 在 observed_at 时点有效并为 CONFIRMED；按供应商SKU业务键分组，依次按 observed_at DESC、证据强度 RECEIPT_ACTUAL>PO_CONFIRMED>QUOTE>MANUAL_MARKET_CHECK、supplier_price_observation_id DESC 取一行。无合格价返回 NULL，不补0。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `supplier_item_id` | 供应商商品版本ID | `uuid` | 否 | 价格证据采用的供应商SKU、物料和包装有效版本。 | 采购、成本和单位连接。 | 不适用。 | `9ad313b3-7d82-5f49-838c-cfc5e5304b94` | v_scm_supplier_price_current.supplier_item_id 只表示本字段说明中的 供应商商品版本ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `supplier_id` | 供应商ID | `uuid` | 否 | 供应商。 | 分组。 | 不适用。 | `e8805f51-3cde-5a40-90ec-b8b364468f7b` | v_scm_supplier_price_current.supplier_id 只表示本字段说明中的 供应商ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `material_id` | 原料ID | `uuid` | 是 | 映射原料。 | 成本连接。 | 不适用。 | `8c355ce8-319e-59d1-adae-a774f7e4d708` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `supplier_price_observation_id` | 价格观察ID | `uuid` | 是 | 当前选中价格证据。 | 追溯。 | 不适用。 | `78d932f4-c520-5edc-93f7-dafce0787d54` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `observed_at` | 观察时间 | `timestamptz` | 是 | 价格证据时间。 | 新鲜度。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-11T10:30:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `normalized_price_myr` | MYR基础单价 | `numeric(18,8)` | 是 | 原始单价乘兑MYR汇率后除以已核验单位换算系数的派生结果。 | 供应商比较；不在价格观察表重复保存。 | 不适用。 | `0.063` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `observation_type` | 来源类型 | `text` | 是 | 收货、PO、报价或人工市场检查。 | 证据强度。 | 不适用。 | `RECEIPT_ACTUAL` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `quality_status` | 质量状态 | `text` | 是 | 价格验证状态。 | 成本采用门禁。 | 不适用。 | `VERIFIED` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `v_cost_card_recipe_current` — 当前生效配方

- **用途：** 按时点选择产品或半成品当前已发布配方版本。
- **一行代表：** 产品或半成品一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `FIX_MODEL_CONTRACT`
- **稳定阻断码：** `AS_OF_SEMANTICS_UNRESOLVED`
- **粒度唯一键：** `output_product_id + output_material_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `cost_card_recipe_version`
- **物理基表闭包：** `cost_card_recipe_version`
- **说明：** 以查询 as_of 时点应用半开区间 effective_from <= as_of AND (effective_to IS NULL OR as_of < effective_to)，仅 status='PUBLISHED'；按产出对象分组并按 effective_from DESC、version_no DESC、recipe_version_id DESC 取一行。每行必须满足 num_nonnulls(output_product_id, output_material_id) = 1。任何两个已发布版本有效期重叠必须先生成 BLOCKER，不能靠排序掩盖。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：output_product_id, output_material_id；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `recipe_version_id` | 配方版本ID | `uuid` | 否 | 当前生效版本。 | 需求和成本输入。 | 不适用。 | `e1625bd2-6bdd-5c0d-b520-86dc36181c5b` | v_cost_card_recipe_current.recipe_version_id 只表示本字段说明中的 配方版本ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `recipe_code` | 配方代码 | `text` | 否 | 跨版本稳定配方代码。 | 业务展示和跨版本分组。 | 不适用。 | `RCP-DARK-WELLINGTON` | v_cost_card_recipe_current.recipe_code 只表示本字段说明中的 配方代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `recipe_name` | 配方名称快照 | `text` | 否 | 当前版本发布时名称。 | 旧版本名称不被当前名称覆盖。 | 不适用。 | `黑巧惠灵顿标准配方` | v_cost_card_recipe_current.recipe_name 只表示本字段说明中的 配方名称快照；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `output_product_id` | 产出产品ID | `uuid` | 是 | 产品配方产出。 | 产品连接。 | 不适用。 | `47d1b643-4027-5330-b49b-4f7bbd911849` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `output_material_id` | 产出半成品ID | `uuid` | 是 | 半成品配方产出。 | 多层配方连接。 | 不适用。 | `fb16f7c0-a40b-5dc8-bbba-4ee166a67674` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `batch_yield_quantity` | 批产量 | `numeric(18,6)` | 否 | 当前版本批产量。 | 单位成本和需求。 | 不适用。 | `24` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 7 | `effective_from` | 生效时间 | `timestamptz` | 否 | 版本生效时间。 | 历史口径。 | 生效区间起点，采用含起点语义。 | `2026-08-01T00:00:00+08:00` | v_cost_card_recipe_current.effective_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `effective_to` | 失效时间 | `timestamptz` | 是 | 版本失效时间。 | 历史口径。 | 生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。 | `2026-09-01T00:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `v_cost_card_product_cost_component` — 产品成本组件明细

- **用途：** 按营业日和地点把生效配方递归展开到最终原料，并选择当时有效的成本采用价；全部结果可由配方、价格和规则重算，不落第二份成本事实。
- **一行代表：** 地点或全局 × 营业日 × 产品 × 配方路径 × 最终原料一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `BLOCKED_RECIPE_EXPANSION_DEPENDENCY | PRODUCT_DATE_UNIVERSE_UNDEFINED | COST_COMPONENT_FORMULA_UNDEFINED | LOCATION_PRICE_FALLBACK_RULE_UNDEFINED`
- **粒度唯一键：** `location_id + business_date + product_id + recipe_version_id + path_component_ids + material_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_cost_card_recipe_expanded` → `cost_card_recipe_version` → `cost_card_material_price` → `v_pos_item_sales_day` → `ops_production_plan_version` → `ops_production_plan_line` → `ops_location`
- **物理基表闭包：** `cost_card_material_price`、`cost_card_recipe_component`、`cost_card_recipe_version`、`ops_location`、`ops_production_plan_line`、`ops_production_plan_version`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_listing`、`pos_product_mapping`、`scm_material`、`scm_material_unit_conversion`
- **说明：** 日期范围由已有销售日与已发布计划日按需形成，不生成永久日历笛卡尔积。地点价优先于全局价；同优先级有效期重叠是BLOCKER，不能静默择一。组件缺价时保留该行并令 component_cost_myr 为 NULL。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：location_id；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 是 | 成本适用地点；企业通用计算为空。 | 优先采用地点价，没有地点价时才按批准规则回退全局价。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 成本评估日期，来自销售日期或已发布计划日期。 | 按时点选择配方和价格。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-11` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `product_id` | 产品ID | `uuid` | 否 | 顶层可售产品。 | 连接销售、计划和毛利。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | v_cost_card_product_cost_component.product_id 只表示本字段说明中的 产品ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `recipe_version_id` | 配方版本ID | `uuid` | 否 | 该营业日生效的顶层配方版本。 | 解释配方变化。 | 不适用。 | `e1625bd2-6bdd-5c0d-b520-86dc36181c5b` | v_cost_card_product_cost_component.recipe_version_id 只表示本字段说明中的 配方版本ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `path_component_ids` | 配方组件路径 | `uuid[]` | 否 | 从顶层产品到最终原料的全部组件ID。 | 支持多层半成品成本穿透并检测循环。 | 不适用。 | `{...}` | v_cost_card_product_cost_component.path_component_ids 只表示本字段说明中的 配方组件路径；必须在所属对象粒度内按 uuid[] 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `material_id` | 最终原料ID | `uuid` | 否 | 递归展开后的叶子原料。 | 连接成本采用价。 | 不适用。 | `8c355ce8-319e-59d1-adae-a774f7e4d708` | v_cost_card_product_cost_component.material_id 只表示本字段说明中的 最终原料ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `material_price_id` | 成本价格ID | `uuid` | 是 | 在地点和营业日有效的批准价格；缺价为空。 | 精确追溯价格波动来源。 | 不适用。 | `c4a11622-b1e0-598a-8164-bd1309a5ed84` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `base_unit_quantity_per_output` | 单位产品原料量 | `numeric(18,10)` | 否 | 每一个产品基础单位所需的最终原料基础单位数量。 | 成本数量乘数。 | 不适用。 | `50` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 9 | `price_myr_per_base_unit` | 原料基础单价 | `numeric(18,8)` | 是 | 被选成本价格的MYR基础单价。 | 成本金额乘数。 | 不适用。 | `0.063` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `component_cost_myr` | 单位产品组件成本 | `numeric(18,8)` | 是 | 单位产品原料量乘原料基础单价。 | 产品材料成本最小派生组成。 | 不适用。 | `3.15` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `price_quality_status` | 价格质量状态 | `text` | 否 | VERIFIED、ESTIMATED、STALE或MISSING。 | 决定该组件是否可进入可信成本。 | 不适用。 | `VERIFIED` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 12 | `calculation_version` | 计算逻辑版本 | `text` | 否 | 配方展开、选价和舍入规则版本。 | 允许复现不同算法口径。 | 不适用。 | `cost-view-v1` | v_cost_card_product_cost_component.calculation_version 只表示本字段说明中的 计算逻辑版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_cost_card_product_cost_snapshot` — 产品成本派生快照

- **用途：** 从产品成本组件明细汇总某地点、营业日和产品的单位材料成本，并用批准的成本范围规则明确是否可称为总成本。
- **一行代表：** 地点或全局 × 营业日 × 产品一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `BLOCKED_COST_COMPONENT_DEPENDENCY | COST_SCOPE_RULE_UNDEFINED | QUALITY_STATUS_PRECEDENCE_UNDEFINED`
- **粒度唯一键：** `location_id + business_date + product_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_cost_card_product_cost_component` → `ops_business_rule`
- **物理基表闭包：** `cost_card_material_price`、`cost_card_recipe_component`、`cost_card_recipe_version`、`ops_business_rule`、`ops_location`、`ops_production_plan_line`、`ops_production_plan_version`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_listing`、`pos_product_mapping`、`scm_material`、`scm_material_unit_conversion`
- **说明：** 这是可重算读模型，不是会计过账事实。cost_revision_key 标识输入集合而非物理运行；若管理报告需要冻结，导出时保存该键、配方版本、价格ID清单、计算版本和导出时间。没有批准间接成本规则时只能报告材料贡献毛利，不得标成完整会计毛利。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：location_id；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 是 | 成本适用地点；企业通用计算为空。 | 门店销售与计划连接。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 成本评估日期。 | 与销售、计划按同一业务日期连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-11` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `product_id` | 产品ID | `uuid` | 否 | 统一可售产品。 | 跨销售、计划和成本连接。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | v_cost_card_product_cost_snapshot.product_id 只表示本字段说明中的 产品ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `recipe_version_id` | 配方版本ID | `uuid` | 是 | 该日采用的顶层配方版本。 | 解释单位成本因配方变化而变化。 | 不适用。 | `e1625bd2-6bdd-5c0d-b520-86dc36181c5b` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `unit_material_cost` | 单位材料成本 | `numeric(18,8)` | 是 | 所有有价最终原料组件成本之和；组件不全时仅为部分金额。 | 材料成本分析。 | 不适用。 | `8.75` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `unit_overhead_cost` | 单位间接成本 | `numeric(18,8)` | 是 | 只有存在批准且可追溯的分摊规则时才计算，否则为空而不是0。 | 避免把材料成本伪装成完整COGS。 | 不适用。 | `0.90` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `unit_total_cost` | 单位总成本 | `numeric(18,8)` | 是 | 材料成本加批准的间接成本；缺任一必需输入时为空。 | 用于有口径标记的经营毛利。 | 不适用。 | `9.65` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `cost_scope` | 成本范围 | `text` | 是 | MATERIAL_ONLY或APPROVED_COGS_POLICY。 | 明确当前数字是否覆盖完整批准成本口径。 | 不适用。 | `APPROVED_COGS_POLICY` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `component_count` | 组件数 | `integer` | 否 | 展开后的最终原料组件总数。 | 价格覆盖率分母。 | 不适用。 | `12` | v_cost_card_product_cost_snapshot.component_count 只表示本字段说明中的 组件数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `priced_component_count` | 有价组件数 | `integer` | 否 | 找到合格价格的组件数。 | 价格覆盖率分子。 | 不适用。 | `12` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 11 | `price_coverage_rate` | 价格覆盖率 | `numeric(12,8)` | 是 | 有价组件数除组件总数。 | 必须与成本金额共同展示。 | 不适用。 | `1` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `calculation_version` | 计算逻辑版本 | `text` | 否 | 组件计算和成本范围规则版本。 | 历史复算。 | 不适用。 | `cost-view-v1` | v_cost_card_product_cost_snapshot.calculation_version 只表示本字段说明中的 计算逻辑版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `cost_revision_key` | 成本修订键 | `char(64)` | 否 | 由配方版本、排序后的价格ID、成本规则ID和计算版本规范化计算的SHA-256。 | 不另建成本运行表也能识别输入修订。 | 不适用。 | `c41e...64位十六进制` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 14 | `quality_status` | 质量状态 | `text` | 否 | TRUSTED、ESTIMATED、MISSING_RECIPE、MISSING_PRICE或UNIT_ERROR。 | 成本和毛利使用门禁。 | 不适用。 | `TRUSTED` | v_cost_card_product_cost_snapshot.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_cost_card_product_cost_quality` — 产品成本质量

- **用途：** 显示产品当前成本、组件覆盖、价格新鲜度和可信状态。
- **一行代表：** 地点或全局 × 营业日 × 产品一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `FIX_MODEL_CONTRACT`
- **稳定阻断码：** `QUALITY_PROJECTION_SOURCE_CONTRACT_UNVERIFIED`
- **粒度唯一键：** `location_id + business_date + product_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_cost_card_product_cost_snapshot`
- **物理基表闭包：** `cost_card_material_price`、`cost_card_recipe_component`、`cost_card_recipe_version`、`ops_business_rule`、`ops_location`、`ops_production_plan_line`、`ops_production_plan_version`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_listing`、`pos_product_mapping`、`scm_material`、`scm_material_unit_conversion`
- **说明：** 直接核对可重算成本视图的组件覆盖、价格质量和成本范围。不得因为存在部分组件金额就把质量标为TRUSTED，也不得把 MATERIAL_ONLY 口径展示成完整COGS。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：location_id；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 是 | 地点特有成本；全局为空。 | 门店毛利。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 成本适用日。 | 销售连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-11` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `product_id` | 产品ID | `uuid` | 否 | 统一产品。 | 产品连接。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | v_cost_card_product_cost_quality.product_id 只表示本字段说明中的 产品ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `unit_total_cost` | 单位总成本 | `numeric(18,8)` | 是 | 快照单位成本。 | COGS。 | 不适用。 | `9.65` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `component_count` | 组件数 | `integer` | 是 | 配方组件总数。 | 覆盖分母。 | 不适用。 | `12` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `priced_component_count` | 有价组件数 | `integer` | 是 | 有合格价格组件数。 | 覆盖分子。 | 不适用。 | `12` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `price_coverage_rate` | 价格覆盖率 | `numeric(12,8)` | 是 | 有价组件占比。 | 质量展示。 | 不适用。 | `1` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `quality_status` | 质量状态 | `text` | 否 | TRUSTED、ESTIMATED、缺价、缺配方等。 | 定价和毛利门禁。 | 不适用。 | `TRUSTED` | v_cost_card_product_cost_quality.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_cost_card_product_daily_margin` — 产品当日毛利

- **用途：** 连接产品日销量和当天成本快照，计算销售额、COGS、毛利和覆盖率。
- **一行代表：** 地点 × 营业日 × 产品一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `BLOCKED_COST_SNAPSHOT_DEPENDENCY | MARGIN_QUALITY_RULE_UNDEFINED`
- **粒度唯一键：** `location_id + business_date + product_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_pos_item_sales_day` → `v_cost_card_product_cost_snapshot`
- **物理基表闭包：** `cost_card_material_price`、`cost_card_recipe_component`、`cost_card_recipe_version`、`ops_business_rule`、`ops_location`、`ops_production_plan_line`、`ops_production_plan_version`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_listing`、`pos_product_mapping`、`scm_material`、`scm_material_unit_conversion`
- **说明：** 这是可修订的当前经营分析读模型，不是已过账会计凭证。POS批次或成本输入变化后 margin_revision_key 改变；需要冻结的管理报告必须保存 pos_ingest_batch_id、cost_revision_key、计算版本和导出时间。cost_scope=MATERIAL_ONLY 时只能称材料贡献毛利。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 销售地点。 | 门店毛利。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_cost_card_product_daily_margin.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 销售和成本日期。 | 时间连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-11` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `product_id` | 产品ID | `uuid` | 否 | 统一产品。 | 产品连接。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | v_cost_card_product_daily_margin.product_id 只表示本字段说明中的 产品ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 否 | 本行销量采用的合格来源批次。 | 销售修订血缘。 | 不适用。 | `338eeff7-033b-56b3-8bb0-aa9f36eb71a3` | v_cost_card_product_daily_margin.pos_ingest_batch_id 只表示本字段说明中的 POS批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `cost_revision_key` | 成本修订键 | `char(64)` | 是 | 本行成本采用的配方、价格、规则和计算版本输入哈希。 | 成本修订血缘。 | 不适用。 | `c41e...64位十六进制` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `quantity` | 销量 | `numeric(18,4)` | 否 | 产品日销量。 | COGS数量。 | 不适用。 | `86` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 7 | `net_sales` | 净销售额 | `numeric(18,4)` | 否 | 产品日净销售。 | 毛利收入。 | 不适用。 | `2300` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 8 | `unit_total_cost` | 单位成本 | `numeric(18,8)` | 是 | 当天成本快照。 | COGS单价。 | 不适用。 | `9.65` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `cogs` | 销售成本 | `numeric(18,4)` | 是 | 销量乘单位成本。 | 毛利计算。 | 不适用。 | `829.9` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `gross_margin` | 毛利额 | `numeric(18,4)` | 是 | 净销售减COGS。 | 经营结果。 | 不适用。 | `1470.1` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `gross_margin_rate` | 毛利率 | `numeric(12,8)` | 是 | 毛利额除净销售。 | 产品盈利能力。 | 不适用。 | `0.639174` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `quality_status` | 质量状态 | `text` | 否 | 销售映射和成本是否可信。 | 必须随毛利展示。 | 不适用。 | `TRUSTED` | v_cost_card_product_daily_margin.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `cost_scope` | 成本范围 | `text` | 是 | MATERIAL_ONLY或APPROVED_COGS_POLICY。 | 判断结果是材料贡献毛利还是批准成本口径毛利。 | 不适用。 | `APPROVED_COGS_POLICY` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `margin_revision_key` | 毛利修订键 | `char(64)` | 否 | 由地点、营业日、产品、POS批次和成本修订键规范化计算的SHA-256。 | 识别同一历史日期因来源更正产生的新分析版本。 | 不适用。 | `b17c...64位十六进制` | v_cost_card_product_daily_margin.margin_revision_key 只表示本字段说明中的 毛利修订键；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_finance_sales_reconciliation` — 财务销售核对

- **用途：** 比较财务日销售与POS日销售，保留两侧口径和差异而不互相覆盖。
- **一行代表：** 地点 × 营业日一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `RECONCILIATION_THRESHOLD_UNDEFINED | CURRENCY_MATCH_RULE_UNDEFINED | RECONCILIATION_STATUS_PRECEDENCE_UNDEFINED`
- **粒度唯一键：** `location_id + business_date`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `finance_sales_daily` → `v_finance_import_batch_current` → `v_pos_sales_day_current`
- **物理基表闭包：** `finance_import_batch`、`finance_sales_daily`、`pos_ingest_batch`、`pos_sales_day`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 核对地点。 | 门店定位。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_finance_sales_reconciliation.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 核对日期。 | 时间定位。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-07-20` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `pos_net_sales` | POS净销售 | `numeric(18,4)` | 是 | POS当前有效净销售。 | 运营口径。 | 不适用。 | `50020` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `finance_net_sales` | 财务实收 | `numeric(18,4)` | 是 | 财务模板净销售。 | 财务口径。 | 不适用。 | `50000` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `difference_amount` | 金额差异 | `numeric(18,4)` | 是 | 财务减POS。 | 对账差异。 | 不适用。 | `-20` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `difference_rate` | 差异率 | `numeric(12,8)` | 是 | 差异相对批准分母的比例。 | 跨日比较。 | 不适用。 | `-0.0004` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `reconciliation_status` | 核对状态 | `text` | 否 | MATCH、WARNING、MISSING_POS、MISSING_FINANCE或BLOCKED。 | 财务处理。 | 不适用。 | `MATCH` | v_finance_sales_reconciliation.reconciliation_status 只表示本字段说明中的 核对状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `quality_detail` | 质量明细 | `jsonb` | 否 | 两侧批次和口径说明。 | 可追溯。 | 不适用。 | `{}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |

## `v_finance_purchase_reconciliation` — 财务采购核对

- **用途：** 比较SCM实际收货采购额与财务供应商月采购和物流订货事实。
- **一行代表：** 地点 × 月份 × 供应商 × 原料一行
- **读取项目：** 财务网站、供应链、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY`
- **粒度唯一键：** `location_id + business_month + supplier_id + material_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `scm_goods_receipt` → `scm_goods_receipt_line` → `scm_purchase_order_line` → `finance_supplier_purchase_monthly` → `finance_order_logistics_line` → `v_finance_import_batch_current`
- **物理基表闭包：** `finance_import_batch`、`finance_order_logistics_line`、`finance_supplier_purchase_monthly`、`scm_goods_receipt`、`scm_goods_receipt_line`、`scm_purchase_order_line`
- **说明：** 只读分析接口，不允许作为业务事实写入口。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：supplier_id, material_id；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 采购地点。 | 分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_finance_purchase_reconciliation.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_month` | 业务月份 | `date` | 否 | 核对月份。 | 时间分组。 | 月份键，固定为该月第一天；不是某笔交易发生日。 | `2026-07-01` | v_finance_purchase_reconciliation.business_month 只表示本字段说明中的 业务月份；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `supplier_id` | 供应商ID | `uuid` | 是 | 统一供应商。 | 供应商分组。 | 不适用。 | `e8805f51-3cde-5a40-90ec-b8b364468f7b` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `material_id` | 原料ID | `uuid` | 是 | 统一原料。 | 原料分组。 | 不适用。 | `8c355ce8-319e-59d1-adae-a774f7e4d708` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `scm_receipt_amount` | SCM收货金额 | `numeric(18,4)` | 是 | 实际合格/确认收货金额。 | 运营采购事实。 | 不适用。 | `6300` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `finance_purchase_amount` | 财务采购金额 | `numeric(18,4)` | 是 | 财务模板月采购金额。 | 财务口径。 | 不适用。 | `6300` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `difference_amount` | 金额差异 | `numeric(18,4)` | 是 | 财务减SCM。 | 核对差异。 | 不适用。 | `0` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `reconciliation_status` | 核对状态 | `text` | 否 | MATCH、WARNING、UNMAPPED或MISSING。 | 处理门禁。 | 不适用。 | `MATCH` | v_finance_purchase_reconciliation.reconciliation_status 只表示本字段说明中的 核对状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_finance_labor_reconciliation` — 财务人工核对

- **用途：** 在地点月份粒度比较实际工时与财务人工成本，保持数量和金额两个事实独立。
- **一行代表：** 地点 × 月份一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** SOURCE_CONDITIONAL
- **SELECT规格准备度：** `DEFER_SOURCE`
- **稳定阻断码：** `SOURCE_CONTRACT_NOT_VERIFIED:HR_TIMESHEET_ENTRY`
- **粒度唯一键：** `location_id + business_month`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_hr_timesheet_entry_current` → `finance_monthly_cost_line` → `v_finance_import_batch_current`
- **物理基表闭包：** `finance_import_batch`、`finance_monthly_cost_line`、`hr_timesheet_entry`、`hr_timesheet_sync_batch`
- **说明：** 只在地点月份粒度核对。未定义且未批准分摊规则前，不将财务人工成本分摊到产品。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 人工成本地点。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_finance_labor_reconciliation.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_month` | 业务月份 | `date` | 否 | 核对月份。 | 时间分组。 | 月份键，固定为该月第一天；不是某笔交易发生日。 | `2026-07-01` | v_finance_labor_reconciliation.business_month 只表示本字段说明中的 业务月份；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `actual_work_minutes` | 实际工时分钟 | `bigint` | 是 | 合格工时月汇总。 | 劳动投入数量。 | 不适用。 | `186000` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `actual_work_hours` | 实际工时小时 | `numeric(18,4)` | 是 | 分钟除60。 | 易读展示。 | 不适用。 | `3100` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `finance_labor_amount` | 财务人工成本 | `numeric(18,4)` | 是 | 财务月成本中LABOR金额。 | 人工成本金额。 | 不适用。 | `68000` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `cost_per_work_hour` | 每工时成本 | `numeric(18,4)` | 是 | 财务人工成本除实际工时。 | 整体人工效率。 | 不适用。 | `21.94` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `reconciliation_status` | 核对状态 | `text` | 否 | COMPLETE、MISSING_HOURS、MISSING_COST或WARNING。 | 质量门禁。 | 不适用。 | `COMPLETE` | v_finance_labor_reconciliation.reconciliation_status 只表示本字段说明中的 核对状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `quality_detail` | 质量明细 | `jsonb` | 否 | 缺身份、工时来源和财务批次说明。 | 可追溯。 | 不适用。 | `{}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |

## `v_finance_margin_reconciliation` — 财务毛利核对

- **用途：** 比较产品日毛利聚合与财务月度利润指标，并显示成本覆盖。
- **一行代表：** 地点 × 月份一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `BLOCKED_DAILY_MARGIN_DEPENDENCY | FINANCE_MARGIN_SOURCE_MAPPING_UNDEFINED | RECONCILIATION_THRESHOLD_UNDEFINED`
- **粒度唯一键：** `location_id + business_month`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_cost_card_product_daily_margin` → `finance_monthly_metric` → `finance_sales_daily` → `v_finance_import_batch_current`
- **物理基表闭包：** `cost_card_material_price`、`cost_card_recipe_component`、`cost_card_recipe_version`、`finance_import_batch`、`finance_monthly_metric`、`finance_sales_daily`、`ops_business_rule`、`ops_location`、`ops_production_plan_line`、`ops_production_plan_version`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_listing`、`pos_product_mapping`、`scm_material`、`scm_material_unit_conversion`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 核对地点。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_finance_margin_reconciliation.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_month` | 业务月份 | `date` | 否 | 核对月份。 | 时间分组。 | 月份键，固定为该月第一天；不是某笔交易发生日。 | `2026-07-01` | v_finance_margin_reconciliation.business_month 只表示本字段说明中的 业务月份；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `ops_net_sales` | 运营净销售 | `numeric(18,4)` | 是 | 产品日销售月汇总。 | 运营收入。 | 不适用。 | `1500000` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `ops_cogs` | 运营COGS | `numeric(18,4)` | 是 | 有成本覆盖产品的销售成本。 | 运营成本。 | 不适用。 | `480000` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `ops_gross_margin` | 运营毛利 | `numeric(18,4)` | 是 | 运营净销售减COGS。 | 运营口径毛利。 | 不适用。 | `1020000` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `cost_coverage_rate` | 成本覆盖率 | `numeric(12,8)` | 是 | 有成本产品销售占总销售比例。 | 解释运营毛利可信度。 | 不适用。 | `0.88` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `trusted_coverage_rate` | 可信覆盖率 | `numeric(12,8)` | 是 | TRUSTED成本销售占比。 | 定价决策门禁。 | 不适用。 | `0.68` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `finance_margin_value` | 财务毛利指标 | `numeric(18,4)` | 是 | 财务模板月毛利或相关指标。 | 财务口径。 | 不适用。 | `980000` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `difference_amount` | 差异金额 | `numeric(18,4)` | 是 | 财务与运营毛利差。 | 核对。 | 不适用。 | `-40000` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `reconciliation_status` | 核对状态 | `text` | 否 | MATCH、LOW_COVERAGE、WARNING或MISSING。 | 处理优先级。 | 不适用。 | `LOW_COVERAGE` | v_finance_margin_reconciliation.reconciliation_status 只表示本字段说明中的 核对状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_mkt_campaign_performance` — 活动效果

- **用途：** 汇总活动版本的资格、邀请、开始、完成、奖励和库存结果。
- **一行代表：** 活动版本 × 可选地点一行
- **读取项目：** HBTI、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `CAMPAIGN_LOCATION_ATTRIBUTION_UNDEFINED | RATE_DENOMINATOR_UNDEFINED | CAMPAIGN_QUALITY_STATUS_RULE_UNDEFINED`
- **粒度唯一键：** `campaign_version_id + location_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `mkt_campaign_version` → `mkt_campaign_member` → `mkt_survey_response` → `mkt_survey_result` → `mkt_reward_claim` → `mkt_reward_stock`
- **物理基表闭包：** `mkt_campaign_member`、`mkt_campaign_version`、`mkt_reward_claim`、`mkt_reward_stock`、`mkt_survey_response`、`mkt_survey_result`
- **说明：** 只统计 campaign_version.result_algorithm_version 明确批准的 VALID 结果；离线重算版本保留但不自动改变会员、奖励或历史漏斗。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：location_id；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `campaign_version_id` | 活动版本ID | `uuid` | 否 | 具体活动版本。 | 版本级分析。 | 不适用。 | `1f438b80-b164-5f84-98bc-20bb4ea65e53` | v_mkt_campaign_performance.campaign_version_id 只表示本字段说明中的 活动版本ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `location_id` | 地点ID | `uuid` | 是 | 地点活动范围。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `eligible_members` | 合资格会员数 | `bigint` | 否 | 资格状态ELIGIBLE人数。 | 漏斗分母。 | 不适用。 | `1000` | v_mkt_campaign_performance.eligible_members 只表示本字段说明中的 合资格会员数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `invited_members` | 已邀请会员数 | `bigint` | 否 | 已发送邀请人数。 | 触达率。 | 不适用。 | `800` | v_mkt_campaign_performance.invited_members 只表示本字段说明中的 已邀请会员数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `started_members` | 开始人数 | `bigint` | 否 | 进入活动人数。 | 开始转化。 | 不适用。 | `420` | v_mkt_campaign_performance.started_members 只表示本字段说明中的 开始人数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `completed_members` | 完成人数 | `bigint` | 否 | 完成活动人数。 | 完成率。 | 不适用。 | `380` | v_mkt_campaign_performance.completed_members 只表示本字段说明中的 完成人数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `valid_result_count` | 有效结果数 | `bigint` | 否 | quality_status=VALID 且 algorithm_version 等于活动版本批准算法的测评结果数。 | 核对完成活动是否都有可解释的正式结果，避免一次作答多次重算造成重复计数。 | 不适用。 | `378` | v_mkt_campaign_performance.valid_result_count 只表示本字段说明中的 有效结果数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `result_coverage_rate` | 结果覆盖率 | `numeric(12,8)` | 是 | 有效结果数除已完成作答数。 | 发现 HBTI 结果漏算或算法失败。 | 不适用。 | `0.99473684` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `reward_reserved_quantity` | 奖励预留数 | `bigint` | 否 | 已预留奖励数量。 | 库存占用。 | 不适用。 | `370` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 10 | `reward_redeemed_quantity` | 奖励核销数 | `bigint` | 否 | 实际发放数量。 | 活动成本。 | 不适用。 | `320` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 11 | `completion_rate` | 完成率 | `numeric(12,8)` | 是 | 完成人数除批准分母。 | 活动表现。 | 不适用。 | `0.45238` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `quality_status` | 质量状态 | `text` | 否 | 会员身份、作答和库存是否完整。 | 防止漏数。 | 不适用。 | `COMPLETE` | v_mkt_campaign_performance.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_mkt_reward_stock_reconciliation` — 奖励库存计数核对

- **用途：** 比较奖励库存事务控制行与领取事实按状态汇总的数量，识别并发失败或异常修复造成的漂移。
- **一行代表：** 活动版本 × 地点 × 奖励一行
- **读取项目：** HBTI、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `PASS_SELECT_SPEC`
- **稳定阻断码：** `NONE`
- **粒度唯一键：** `campaign_version_id + location_id + reward_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `mkt_reward_stock` → `mkt_reward_claim`
- **物理基表闭包：** `mkt_reward_claim`、`mkt_reward_stock`
- **说明：** SELECT 规格固定为 stock-driven：以 mkt_reward_stock 为全集 LEFT JOIN 仅 reward_stock_id 非空且等于库存行的 mkt_reward_claim，再按 claim.status 汇总 quantity；stockless 外部履约不进入库存核对。来源审计中的 Butterfly 库存 issued=1 但无对应 claim，必须输出 DRIFT，禁止为了 MATCH 伪造 claim。reward_stock 的计数因并发控制需要物理保存，但它不是唯一分析事实。location_id 是 nullable grain key，物化唯一语义必须使用 NULLS NOT DISTINCT。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：location_id；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `reward_stock_id` | 奖励库存ID | `uuid` | 否 | 被核对的库存控制行。 | 异常修复定位。 | 不适用。 | `4aa7e140-3bd6-5243-a096-703da8848f1e` | v_mkt_reward_stock_reconciliation.reward_stock_id 只表示本字段说明中的 奖励库存ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `campaign_version_id` | 活动版本ID | `uuid` | 否 | 奖励所属活动版本。 | 活动连接。 | 不适用。 | `1f438b80-b164-5f84-98bc-20bb4ea65e53` | v_mkt_reward_stock_reconciliation.campaign_version_id 只表示本字段说明中的 活动版本ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `location_id` | 地点ID | `uuid` | 是 | 奖励领取地点；数字权益可为空。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `reward_id` | 奖励ID | `uuid` | 否 | 被核对奖励。 | 奖励连接。 | 不适用。 | `8097b265-c550-5a65-ab76-866ca376a863` | v_mkt_reward_stock_reconciliation.reward_id 只表示本字段说明中的 奖励ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `cached_reserved_quantity` | 缓存预留数 | `integer` | 否 | reward_stock 中事务控制的预留计数。 | 并发可用量计算。 | 不适用。 | `12` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 6 | `fact_reserved_quantity` | 事实预留数 | `bigint` | 否 | 仅汇总 reward_stock_id 等于本库存行且状态为 RESERVED 的 reward_claim.quantity。 | 独立核对缓存；stockless 外部履约不参与。 | 不适用。 | `12` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 7 | `cached_redeemed_quantity` | 缓存核销数 | `integer` | 否 | reward_stock 中事务控制的已发计数。 | 并发可用量计算。 | 不适用。 | `45` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `fact_redeemed_quantity` | 事实履约数 | `bigint` | 否 | 仅汇总 reward_stock_id 等于本库存行且状态为 REDEEMED 的 reward_claim.quantity。 | 独立核对缓存；外部发券但无库存身份的 claim 不参与。 | 不适用。 | `45` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 9 | `available_quantity` | 可用数量 | `integer` | 否 | allocated 减缓存预留、核销和损坏。 | 在线预留提示。 | 不适用。 | `42` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 10 | `reconciliation_status` | 核对状态 | `text` | 否 | MATCH、DRIFT 或 OVERALLOCATED。 | DRIFT 必须告警，不能静默改写领取事实。 | 不适用。 | `MATCH` | v_mkt_reward_stock_reconciliation.reconciliation_status 只表示本字段说明中的 核对状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_msg_delivery_current` — 消息当前投递状态

- **用途：** 从外发队列、不可变投递尝试和可选渠道回执中确定性选出当前状态、重试摘要与业务推送成功去重结论。
- **一行代表：** 外发消息一行
- **读取项目：** BakeryOps、HBTI、分析/BI
- **实施层级：** EXTENSION_PACK
- **SELECT规格准备度：** `DEFER_EXTENSION`
- **稳定阻断码：** `EXTENSION_PACK_NOT_ACTIVATED:CHANNEL_RECEIPTS`
- **粒度唯一键：** `outbound_message_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `msg_outbound_message` → `msg_message` → `msg_delivery_attempt` → `msg_delivery_event`
- **物理基表闭包：** `msg_delivery_attempt`、`msg_delivery_event`、`msg_message`、`msg_outbound_message`
- **说明：** 渠道回执存在时先按 occurred_at，再按批准的状态优先级，最后按 delivery_event_id 打破平局；无回执时只允许从成功 delivery_attempt/队列状态判断 SENT，绝不推断 DELIVERED 或 READ。attempt_count、last_error_code 和 is_successful_business_push 都由底层事实派生。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `outbound_message_id` | 外发消息ID | `uuid` | 否 | 外发队列任务。 | 连接消息业务来源。 | 不适用。 | `c122acbc-dc1b-5edc-8b4c-09309ca4f897` | v_msg_delivery_current.outbound_message_id 只表示本字段说明中的 外发消息ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `message_id` | 会话消息ID | `uuid` | 是 | 已落库会话消息；尚未形成时为空。 | 会话展示。 | 不适用。 | `0c40865e-7f37-50e4-8b03-0c968be3bc6a` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `push_kind` | 业务推送类型 | `text` | 是 | 每日业务推送类型；普通消息为空。 | 按业务语义核对重复。 | 不适用。 | `MORNING_BRIEF` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `business_date` | 推送业务日期 | `date` | 是 | 业务推送针对日期；普通消息为空。 | 与运营事实按日连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-10` | 不要由 created_at 或 UTC 日期临时推导。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `recipient_ref_hash` | 接收者引用哈希 | `char(64)` | 否 | recipient_ref 的受控不可逆哈希。 | 允许去重分析而不向普通报表暴露联系方式引用。 | 不适用。 | `4e9a...64位十六进制` | v_msg_delivery_current.recipient_ref_hash 只表示本字段说明中的 接收者引用哈希；必须在所属对象粒度内按 char(64) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `attempt_count` | 投递尝试次数 | `bigint` | 否 | msg_delivery_attempt 的行数。 | 重试和死信监控，不在队列表重复计数。 | 不适用。 | `1` | v_msg_delivery_current.attempt_count 只表示本字段说明中的 投递尝试次数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `last_error_code` | 最后错误代码 | `text` | 是 | 最后一次失败尝试的机器可读错误。 | 重试策略和排障。 | 不适用。 | `CHANNEL_RATE_LIMIT` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `current_delivery_status` | 当前投递状态 | `text` | 否 | 按事件发生时间和状态优先级选出的 SENT、DELIVERED、READ、FAILED 等状态。 | 发送监控和触达漏斗。 | 不适用。 | `DELIVERED` | v_msg_delivery_current.current_delivery_status 只表示本字段说明中的 当前投递状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `status_occurred_at` | 当前状态发生时间 | `timestamptz` | 否 | 所选当前状态在渠道发生的时间。 | 计算送达延迟。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-11T10:00:04+08:00` | v_msg_delivery_current.status_occurred_at 只表示本字段说明中的 当前状态发生时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `latest_delivery_event_id` | 最新投递事件ID | `uuid` | 是 | 最终选择对应的不可变渠道事件；渠道回执扩展未启用或尚无回执时为空。 | 结果可追溯。 | 不适用。 | `2b5bc9c4-fc04-5379-ac85-f6cebc958aff` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `is_successful_business_push` | 是否成功业务推送 | `boolean` | 否 | 存在 push_kind/business_date 且已至少发送成功。 | 替代独立 msg_push_deduplication 表的确定性结论。 | 不适用。 | `true` | v_msg_delivery_current.is_successful_business_push 只表示本字段说明中的 是否成功业务推送；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `quality_status` | 质量状态 | `text` | 否 | COMPLETE、NO_RECEIPT、OUT_OF_ORDER 或 UNMAPPED。 | 暴露缺失和乱序，不猜测送达。 | 不适用。 | `COMPLETE` | v_msg_delivery_current.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_app_data_quality_summary` — 数据质量总览

- **用途：** 把各业务域只读核对视图的当前质量结论汇总成统一看板，不复制业务对象、不保存多态 entity_type/entity_id 工单。
- **一行代表：** 来源质量视图 × 业务域 × 规则 × 严重度 × 质量状态一行
- **读取项目：** 所有项目、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `BLOCKED_QUALITY_VIEW_DEPENDENCY | QUALITY_RULE_MAPPING_UNDEFINED | SEVERITY_MAPPING_UNDEFINED`
- **粒度唯一键：** `source_view_name + domain_code + rule_code + severity + quality_status`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_identity_mapping_gap` → `v_pos_revenue_reconciliation` → `v_pos_member_daily_summary` → `v_cost_card_product_cost_quality` → `v_finance_sales_reconciliation` → `v_mkt_reward_stock_reconciliation`
- **物理基表闭包：** `cost_card_material_price`、`cost_card_recipe_component`、`cost_card_recipe_version`、`finance_import_batch`、`finance_sales_daily`、`hr_employment_mapping_review`、`hr_employment_source_identity`、`mkt_reward_claim`、`mkt_reward_stock`、`ops_business_rule`、`ops_location`、`ops_location_source_identity`、`ops_production_plan_line`、`ops_production_plan_version`、`pos_daily_breakdown`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_member_daily_metric`、`pos_product_listing`、`pos_product_mapping`、`pos_product_mapping_review`、`pos_sales_day`、`pos_sales_hour`、`scm_material`、`scm_material_source_identity`、`scm_material_unit_conversion`
- **说明：** 这是 UNION ALL + 聚合的可重算视图：每个分支必须显式给出 source_view_name、rule_code、severity 映射和金额币种。首期只依赖首期可用质量视图；采购、生产、班表等扩展包启用时用独立迁移追加对应 UNION 分支。人工受理、负责人、备注和解决历史属于未来工单系统，不得塞回本视图或跨域多态表。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `source_view_name` | 来源质量视图 | `text` | 否 | 生成该汇总结论的受治理只读视图名。 | 回到可复算的具体质量证据，禁止把汇总当事实来源。 | 不适用。 | `v_pos_revenue_reconciliation` | 这是来源系统证据，不等于企业统一身份。 |
| 2 | `domain_code` | 业务域 | `text` | 否 | 结论所属 POS、OPS、HR、SCM、COST、FINANCE、MKT、MSG、AI 或 APP 域。 | 责任分组。 | 不适用。 | `POS` | v_app_data_quality_summary.domain_code 只表示本字段说明中的 业务域；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `rule_code` | 规则代码 | `text` | 否 | 从来源视图与质量判断固定映射的规则代码。 | 跨日统计同类质量缺口。 | 不适用。 | `POS_REVENUE_MISMATCH` | v_app_data_quality_summary.rule_code 只表示本字段说明中的 规则代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `severity` | 严重度 | `text` | 否 | 按已批准规则映射为 INFO、WARNING、ERROR 或 BLOCKER。 | 排序和门禁；不是人工随意填写。 | 不适用。 | `BLOCKER` | v_app_data_quality_summary.severity 只表示本字段说明中的 严重度；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `quality_status` | 质量状态 | `text` | 否 | 来源核对视图直接输出的当前状态，例如 MATCH、MISSING 或 BLOCKED。 | 保留域内精确语义，不伪造成工单处理状态。 | 不适用。 | `MISSING` | v_app_data_quality_summary.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `issue_count` | 问题数 | `bigint` | 否 | 当前来源视图中命中该规则和状态的行数。 | 衡量当前问题规模；重算后可变化。 | 不适用。 | `12` | v_app_data_quality_summary.issue_count 只表示本字段说明中的 问题数；必须在所属对象粒度内按 bigint 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `affected_row_count` | 影响事实行数 | `bigint` | 是 | 来源视图能够确定时汇总的受影响最细事实行数。 | 按数据影响排序；不能确定时为空。 | 不适用。 | `2297` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `affected_amount` | 影响金额 | `numeric(18,4)` | 是 | 来源视图能够确定且币种范围一致时汇总的影响金额。 | 金额优先级；不能证明口径或币种时为空。 | 不适用。 | `301698` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `currency` | 影响金额币种 | `char(3)` | 是 | affected_amount 的币种；无金额时为空。 | 禁止跨币种合计。 | 不适用。 | `MYR` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `latest_business_date` | 最新影响营业日 | `date` | 是 | 该质量桶当前包含的最新营业日期；非日粒度问题为空。 | 判断问题是否仍影响最近经营数据。 | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。 | `2026-08-08` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `v_business_timeline` — 统一经营时间线

- **用途：** 按地点和营业日统一索引计划、生产、销售、人员、采购、成本、财务和活动事件。
- **一行代表：** 地点 × 营业日 × 一个领域事件一行
- **读取项目：** 所有项目、分析/BI
- **实施层级：** SOURCE_CONDITIONAL
- **SELECT规格准备度：** `DEFER_SOURCE`
- **稳定阻断码：** `SOURCE_CONTRACT_NOT_VERIFIED:HR_TIMESHEET_ENTRY | EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY | EXTENSION_PACK_NOT_ACTIVATED:PRODUCTION_EXECUTION | EXTENSION_PACK_NOT_ACTIVATED:SHIFT_AND_WORKFORCE`
- **粒度唯一键：** `event_domain + event_type + event_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_pos_sales_day_current` → `ops_operational_event` → `ops_production_plan_version` → `ops_production_run` → `ops_dispatch` → `ops_shift_plan_version` → `v_hr_timesheet_entry_current` → `scm_purchase_order_revision` → `scm_goods_receipt` → `v_cost_card_product_cost_snapshot` → `finance_import_batch` → `mkt_campaign_member`
- **物理基表闭包：** `cost_card_material_price`、`cost_card_recipe_component`、`cost_card_recipe_version`、`finance_import_batch`、`hr_timesheet_entry`、`hr_timesheet_sync_batch`、`mkt_campaign_member`、`ops_business_rule`、`ops_dispatch`、`ops_location`、`ops_operational_event`、`ops_production_plan_line`、`ops_production_plan_version`、`ops_production_run`、`ops_shift_plan_version`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_listing`、`pos_product_mapping`、`pos_sales_day`、`scm_goods_receipt`、`scm_material`、`scm_material_unit_conversion`、`scm_purchase_order_revision`
- **说明：** 这是只读索引视图，不建立多态写入表，也不允许反向成为任何业务事实来源。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 是 | 事件地点。 | 共同空间键。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 2 | `business_date` | 营业日期 | `date` | 是 | 事件业务日期。 | 共同时间键。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-10` | 不要由 created_at 或 UTC 日期临时推导。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `event_domain` | 事件业务域 | `text` | 否 | POS、OPS、HR、SCM、COST、FINANCE、MKT等。 | 时间线分组。 | 不适用。 | `OPS` | v_business_timeline.event_domain 只表示本字段说明中的 事件业务域；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `event_type` | 事件类型 | `text` | 否 | 计划发布、生产完成、收货等标准代码。 | 筛选。 | 不适用。 | `PRODUCTION_PLAN_PUBLISHED` | v_business_timeline.event_type 只表示本字段说明中的 事件类型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `event_id` | 事件对象ID | `uuid` | 否 | 原业务对象主键。 | 跳转原事实。 | 不适用。 | `f9d3b2f8-8f1f-5715-979b-0b519780d739` | v_business_timeline.event_id 只表示本字段说明中的 事件对象ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `product_id` | 产品ID | `uuid` | 是 | 事件直接涉及产品时提供。 | 产品时间线。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `material_id` | 原料ID | `uuid` | 是 | 事件直接涉及原料时提供。 | 原料时间线。 | 不适用。 | `8c355ce8-319e-59d1-adae-a774f7e4d708` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `employment_id` | 雇佣ID | `uuid` | 是 | 事件直接涉及员工时提供。 | 人员时间线。 | 不适用。 | `e3bfa5c1-327a-548c-9fa5-473d7d1aa16e` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `occurred_at` | 发生时间 | `timestamptz` | 否 | 业务事件发生或发布时刻。 | 排序。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-09T12:05:00+08:00` | v_business_timeline.occurred_at 只表示本字段说明中的 发生时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 10 | `quality_status` | 质量状态 | `text` | 否 | 事件是否正式、估算或存在质量问题。 | 读取门禁。 | 不适用。 | `CONFIRMED` | v_business_timeline.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `source_ref` | 来源引用 | `jsonb` | 否 | 原表、批次和版本引用。 | 追溯。 | 不适用。 | `{"table":"ops_production_plan_version"}` | 这是来源系统证据，不等于企业统一身份。 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |

## `v_ops_timeslot_sales_baseline` — 时段销售基线

- **用途：** 按地点、产品、日型和营业时段计算批准窗口内的滚动销量基线。
- **一行代表：** 地点 × 产品 × 日型 × 时段一行
- **读取项目：** BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `DAY_TYPE_RULE_UNDEFINED | TIMESLOT_BOUNDARY_RULE_UNDEFINED | BASELINE_WINDOW_RULE_UNDEFINED | MINIMUM_SAMPLE_RULE_UNDEFINED`
- **粒度唯一键：** `location_id + product_id + day_type + slot_start + slot_end`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_pos_item_sales_hour_current` → `pos_product_mapping` → `ops_calendar_event` → `ops_location` → `ops_business_rule`
- **物理基表闭包：** `ops_business_rule`、`ops_calendar_event`、`ops_location`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_mapping`
- **说明：** 时段基线只能读取 v_pos_item_sales_hour_current；每个营业日必须先固定唯一 ITEM_SALES_HOUR 批次，再进入历史窗口。基线版本还需冻结窗口、日型、异常排除和最小样本规则，禁止直接扫描所有重跑批次。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 销售地点。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_ops_timeslot_sales_baseline.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `product_id` | 产品ID | `uuid` | 否 | 统一产品。 | 计划产品连接。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | v_ops_timeslot_sales_baseline.product_id 只表示本字段说明中的 产品ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `day_type` | 日型 | `text` | 否 | WEEKDAY、WEEKEND、HOLIDAY或批准类型。 | 区分需求模式。 | 不适用。 | `WEEKEND` | v_ops_timeslot_sales_baseline.day_type 只表示本字段说明中的 日型；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `slot_start` | 时段开始 | `time` | 否 | 当地营业时段开始。 | 排产时段连接。 | 本地钟点；必须与地点时区和对应日期组合，不能单独视为绝对时间。 | `14:00:00` | v_ops_timeslot_sales_baseline.slot_start 只表示本字段说明中的 时段开始；必须在所属对象粒度内按 time 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `slot_end` | 时段结束 | `time` | 否 | 当地营业时段结束。 | 时段边界。 | 本地钟点；必须与地点时区和对应日期组合，不能单独视为绝对时间。 | `16:00:00` | v_ops_timeslot_sales_baseline.slot_end 只表示本字段说明中的 时段结束；必须在所属对象粒度内按 time 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `sample_days` | 样本天数 | `integer` | 否 | 参与基线的有效营业日数。 | 可信度。 | 不适用。 | `8` | v_ops_timeslot_sales_baseline.sample_days 只表示本字段说明中的 样本天数；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `average_quantity` | 平均销量 | `numeric(18,4)` | 否 | 批准窗口内时段平均销量。 | 时段预测基线。 | 不适用。 | `18.5` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 8 | `baseline_version` | 基线版本 | `text` | 否 | 窗口和异常剔除规则版本。 | 复现结果。 | 不适用。 | `timeslot-56d-v2` | v_ops_timeslot_sales_baseline.baseline_version 只表示本字段说明中的 基线版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `quality_status` | 质量状态 | `text` | 否 | 样本和映射是否充分。 | 低样本提示。 | 不适用。 | `COMPLETE` | v_ops_timeslot_sales_baseline.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_cost_card_daily_margin` — 门店当日毛利汇总

- **用途：** 按地点和营业日汇总产品毛利，同时给出全部成本覆盖和可信成本覆盖。
- **一行代表：** 地点 × 营业日一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `BLOCKED_PRODUCT_MARGIN_DEPENDENCY | COVERAGE_STATUS_THRESHOLD_UNDEFINED`
- **粒度唯一键：** `location_id + business_date`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_cost_card_product_daily_margin` → `v_pos_sales_day_current`
- **物理基表闭包：** `cost_card_material_price`、`cost_card_recipe_component`、`cost_card_recipe_version`、`ops_business_rule`、`ops_location`、`ops_production_plan_line`、`ops_production_plan_version`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_listing`、`pos_product_mapping`、`pos_sales_day`、`scm_material`、`scm_material_unit_conversion`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 销售地点。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_cost_card_daily_margin.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 毛利日期。 | 日报连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-11` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `net_sales` | 净销售额 | `numeric(18,4)` | 否 | 全部产品净销售。 | 毛利分母。 | 不适用。 | `53670` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 4 | `costed_sales` | 有成本销售额 | `numeric(18,4)` | 否 | 找到任意成本快照的产品销售额。 | 一般覆盖率分子。 | 不适用。 | `47000` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 5 | `trusted_sales` | 可信成本销售额 | `numeric(18,4)` | 否 | 成本状态TRUSTED产品销售额。 | 可信覆盖率分子。 | 不适用。 | `36500` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 6 | `cogs` | 销售成本 | `numeric(18,4)` | 是 | 有成本覆盖产品的COGS。 | 毛利计算。 | 不适用。 | `16500` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `gross_margin` | 毛利额 | `numeric(18,4)` | 是 | 有成本范围净销售减COGS。 | 经营结果。 | 不适用。 | `30500` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `gross_margin_rate` | 毛利率 | `numeric(12,8)` | 是 | 有成本范围毛利率。 | 必须连同覆盖率展示。 | 不适用。 | `0.648936` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `cost_coverage_rate` | 成本覆盖率 | `numeric(12,8)` | 是 | 有成本销售占总销售。 | 完整性。 | 不适用。 | `0.875722` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `trusted_coverage_rate` | 可信覆盖率 | `numeric(12,8)` | 是 | 可信成本销售占总销售。 | 定价决策底座。 | 不适用。 | `0.680082` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `quality_status` | 质量状态 | `text` | 否 | TRUSTED、LOW_COVERAGE或ESTIMATED。 | 报表门禁。 | 不适用。 | `LOW_COVERAGE` | v_cost_card_daily_margin.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_ops_holiday_factor` — 节假日需求因子

- **用途：** 从节假日日历与历史产品日销售按批准窗口即时计算地点、产品或品类需求因子，不保存第二份观察结果。
- **一行代表：** 事件 × 地点 × 产品或品类一行
- **读取项目：** BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `LOCATION_EVENT_APPLICABILITY_UNDEFINED | BASELINE_WINDOW_RULE_UNDEFINED | MINIMUM_SAMPLE_RULE_UNDEFINED | FACTOR_FALLBACK_RULE_UNDEFINED`
- **粒度唯一键：** `calendar_event_id + location_id + product_id + category_code`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `ops_calendar_event` → `v_pos_item_sales_day` → `ops_product` → `ops_business_rule` → `ops_location`
- **物理基表闭包：** `ops_business_rule`、`ops_calendar_event`、`ops_location`、`ops_product`、`pos_ingest_batch`、`pos_item_sales_hour`、`pos_product_listing`、`pos_product_mapping`
- **说明：** 每行必须满足 num_nonnulls(product_id, category_code) = 1。factor=observed_quantity/NULLIF(baseline_quantity,0)，计算规则来自带有效期的 ops_business_rule。低样本、缺映射和兜底必须显式标记；FALLBACK 不是历史实测。若未来要冻结模型训练集，应新增经批准的模型数据集版本，而不是把每次可重算因子都落成业务表。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：product_id, category_code；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `calendar_event_id` | 日历事件ID | `uuid` | 否 | 被估计事件。 | 预测输入。 | 不适用。 | `92a7ace3-e76f-5b4b-aa7b-1bbbe35758a4` | v_ops_holiday_factor.calendar_event_id 只表示本字段说明中的 日历事件ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `algorithm_version` | 算法版本 | `text` | 否 | 历史窗口、日型匹配、异常排除和舍入规则版本。 | 历史复现与版本比较。 | 不适用。 | `holiday-factor-view-v1` | v_ops_holiday_factor.algorithm_version 只表示本字段说明中的 算法版本；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `location_id` | 地点ID | `uuid` | 否 | 因子适用地点。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_ops_holiday_factor.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `product_id` | 产品ID | `uuid` | 是 | 产品级因子。 | 产品预测。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `category_code` | 品类代码 | `text` | 是 | 品类级因子。 | 品类预测。 | 不适用。 | `BAKERY_WELLINGTON` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `baseline_window_start` | 基线窗口开始 | `date` | 否 | 用于对照的历史营业日起点。 | 复现样本范围。 | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。 | `2026-05-01` | v_ops_holiday_factor.baseline_window_start 只表示本字段说明中的 基线窗口开始；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `baseline_window_end` | 基线窗口结束 | `date` | 否 | 用于对照的历史营业日终点。 | 复现样本范围。 | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。 | `2026-07-31` | v_ops_holiday_factor.baseline_window_end 只表示本字段说明中的 基线窗口结束；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `baseline_quantity` | 基线销量 | `numeric(18,4)` | 是 | 相同日型非事件样本的批准统计量。 | 需求倍率分母。 | 不适用。 | `100` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `observed_quantity` | 事件销量 | `numeric(18,4)` | 是 | 历史同类事件样本的批准统计量。 | 需求倍率分子。 | 不适用。 | `128` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `factor` | 需求倍率 | `numeric(12,6)` | 是 | observed_quantity 除 baseline_quantity；基线为0时为空。 | 预测调整；作为可重算视图字段不在基础表重复存储。 | 不适用。 | `1.28` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 11 | `factor_source` | 因子来源 | `text` | 否 | OBSERVED、LOW_SAMPLE或FALLBACK。 | 不能让1.0兜底伪装实测。 | 不适用。 | `OBSERVED` | v_ops_holiday_factor.factor_source 只表示本字段说明中的 因子来源；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 12 | `sample_size` | 样本量 | `integer` | 是 | 因子样本数。 | 可信度。 | 不适用。 | `3` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 13 | `quality_status` | 质量状态 | `text` | 否 | 是否允许进入正式预测。 | 预测门禁。 | 不适用。 | `LOW_SAMPLE` | v_ops_holiday_factor.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_pos_item_waste_current` — 当前POS商品报废

- **用途：** 为每个地点营业日选择一批合格 ITEM_WASTE 事实，保留所选批次内每条最细来源报废记录。
- **一行代表：** 地点 × 营业日 × listing × 来源报废记录一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `PASS_SELECT_SPEC`
- **稳定阻断码：** `NONE`
- **粒度唯一键：** `waste_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `pos_item_waste` → `pos_ingest_batch`
- **物理基表闭包：** `pos_ingest_batch`、`pos_item_waste`
- **说明：** 只读取 dataset_code='ITEM_WASTE' 且 SUCCEEDED、未被合格同数据集批次 supersedes 的批次；按 location_id,business_date 用 completed_at、created_at、batch_id 选一个整日批次，再输出该批事实。来源更正通过新整批自然移除旧行，禁止在不同批次间逐行拼接。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `waste_id` | 报废ID | `uuid` | 否 | 被选中的来源报废事实。 | 回查来源行。 | 不适用。 | `ecf7de3e-329c-5e7f-bbd2-221da4f1234b` | v_pos_item_waste_current.waste_id 只表示本字段说明中的 报废ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 否 | 当前营业日采用的唯一报废批次。 | 作为整日修订键和来源血缘。 | 不适用。 | `338eeff7-033b-56b3-8bb0-aa9f36eb71a3` | v_pos_item_waste_current.pos_ingest_batch_id 只表示本字段说明中的 POS批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `location_id` | 地点ID | `uuid` | 否 | 报废发生地点。 | 门店连接。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_item_waste_current.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `business_date` | 营业日期 | `date` | 否 | 报废归属营业日。 | 计划、成本和销售连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 5 | `listing_id` | Listing ID | `uuid` | 否 | 报废商品的来源 POS 身份。 | 连接发生时点产品映射。 | 不适用。 | `f719aafd-2e51-595c-823f-c34aded761a9` | v_pos_item_waste_current.listing_id 只表示本字段说明中的 Listing ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `source_waste_id` | 来源报废ID | `text` | 是 | 来源提供的稳定报废ID；没有则为空。 | 来源侧追踪。 | 不适用。 | `waste_880991` | 这是来源系统证据，不等于企业统一身份。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `source_row_fingerprint` | 来源行指纹 | `char(64)` | 否 | 按批次数据契约对来源行计算的 SHA-256。 | 无来源ID时仍能在同批次幂等定位。 | 不适用。 | `7ac4...64位十六进制` | 这是来源系统证据，不等于企业统一身份。 |
| 8 | `occurred_at` | 发生时间 | `timestamptz` | 是 | 来源提供的具体报废时刻。 | 时段损耗分析；缺失保持 NULL。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-08T20:15:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `source_name_snapshot` | 来源商品名快照 | `text` | 否 | 被选中来源行的商品名称原文。 | 目录改名后仍可核对；不能作为连接键。 | 不适用。 | `Dark Chocolate Wellington` | 这是来源系统证据，不等于企业统一身份。 |
| 10 | `quantity` | 报废数量 | `numeric(18,4)` | 否 | 按 listing 来源单位记录的报废数量。 | 损耗计算。 | 不适用。 | `2` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 11 | `source_waste_amount` | 来源报废金额 | `numeric(18,4)` | 是 | 当前批次 RES/POS 返回的报废金额原值。 | 来源核对；不得由数量和当前售价重建。 | 不适用。 | `18.00` | 这是来源系统证据，不等于企业统一身份。 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `currency` | 币种 | `char(3)` | 否 | 来源报废金额币种。 | 跨地点汇总门禁。 | 不适用。 | `MYR` | v_pos_item_waste_current.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `reason_raw` | 来源原因 | `text` | 是 | POS 返回的报废原因原文。 | 保留映射证据。 | 不适用。 | `Expired` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 14 | `reason_code` | 标准原因代码 | `text` | 是 | 按规则版本映射的原因代码。 | 区分损失、试吃和营销。 | 不适用。 | `EXPIRED` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 15 | `reason_mapping_version` | 原因映射版本 | `text` | 是 | reason_raw 到 reason_code 的规则版本。 | 历史重放。 | 不适用。 | `waste-reason-v2` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 16 | `is_financial_loss` | 是否经营损失 | `boolean` | 否 | 该原因是否计入经营损失。 | 避免把试吃默认记损失。 | 不适用。 | `true` | v_pos_item_waste_current.is_financial_loss 只表示本字段说明中的 是否经营损失；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_pos_item_waste_mapped` — 已治理商品报废

- **用途：** 为报废事实补充发生时点已确认product_id和标准损失分类，同时保留未映射行。
- **一行代表：** 一条POS报废事实一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `PASS_SELECT_SPEC`
- **稳定阻断码：** `NONE`
- **粒度唯一键：** `waste_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_pos_item_waste_current` → `pos_product_mapping`
- **物理基表闭包：** `pos_ingest_batch`、`pos_item_waste`、`pos_product_mapping`
- **说明：** 只为 current 报废事实补充发生时点有效的确认映射；pos_ingest_batch_id、source_name_snapshot、source_waste_amount 和 currency 必须原样透传。未映射 listing 仍保留 product_id=NULL，不允许 inner join 或按名称猜配。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `waste_id` | 报废ID | `uuid` | 否 | 原报废事实。 | 追溯。 | 不适用。 | `ecf7de3e-329c-5e7f-bbd2-221da4f1234b` | v_pos_item_waste_mapped.waste_id 只表示本字段说明中的 报废ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `pos_ingest_batch_id` | POS批次ID | `uuid` | 否 | 当前采用的报废整日批次。 | 证明修订血缘并支持同日重跑核对。 | 不适用。 | `338eeff7-033b-56b3-8bb0-aa9f36eb71a3` | v_pos_item_waste_mapped.pos_ingest_batch_id 只表示本字段说明中的 POS批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `location_id` | 地点ID | `uuid` | 否 | 报废地点。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_pos_item_waste_mapped.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `business_date` | 营业日期 | `date` | 否 | 报废日期。 | 计划和成本连接。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 5 | `listing_id` | Listing ID | `uuid` | 否 | 来源商品身份。 | 完整保留来源。 | 不适用。 | `f719aafd-2e51-595c-823f-c34aded761a9` | v_pos_item_waste_mapped.listing_id 只表示本字段说明中的 Listing ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `product_id` | 产品ID | `uuid` | 是 | 确认统一产品。 | 产品分析。 | 不适用。 | `f53ead8e-1390-57b7-917e-7e4dfd18edd7` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `source_name_snapshot` | 来源商品名快照 | `text` | 否 | 报废来源行的商品名称原文。 | 保留来源证据，不按名称猜映射。 | 不适用。 | `Dark Chocolate Wellington` | 这是来源系统证据，不等于企业统一身份。 |
| 8 | `quantity` | 数量 | `numeric(18,4)` | 否 | 报废数量。 | 损耗计算。 | 不适用。 | `2` | 使用前确认该表约定的单位；不同单位不得直接相加。 |
| 9 | `source_waste_amount` | 来源报废金额 | `numeric(18,4)` | 是 | RES/POS 返回且由 current selector 选中的报废金额。 | 与派生成本损失并列核对，不相互覆盖。 | 不适用。 | `18.00` | 这是来源系统证据，不等于企业统一身份。 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 10 | `currency` | 币种 | `char(3)` | 否 | 来源报废金额币种。 | 防止跨币种误加。 | 不适用。 | `MYR` | v_pos_item_waste_mapped.currency 只表示本字段说明中的 币种；必须在所属对象粒度内按 char(3) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 11 | `reason_code` | 标准原因 | `text` | 是 | 标准化报废原因。 | 损失分类。 | 不适用。 | `EXPIRED` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 12 | `is_financial_loss` | 是否经营损失 | `boolean` | 否 | 是否计入经营损失。 | 排除试吃等营销用途。 | 不适用。 | `true` | v_pos_item_waste_mapped.is_financial_loss 只表示本字段说明中的 是否经营损失；必须在所属对象粒度内按 boolean 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 13 | `mapping_status` | 映射状态 | `text` | 是 | 产品映射质量。 | 未映射提示。 | 不适用。 | `CONFIRMED` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `v_ops_manager_sales_reconciliation` — 店长输入与POS核对

- **用途：** 比较复盘中店长确认的营业额与POS实测，显示差异而不覆盖任一来源。
- **一行代表：** 地点 × 营业日 × 复盘版本一行
- **读取项目：** BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `RECONCILIATION_THRESHOLD_UNDEFINED | RECONCILIATION_STATUS_PRECEDENCE_UNDEFINED`
- **粒度唯一键：** `daily_review_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `v_ops_daily_review_current` → `v_pos_sales_day_current`
- **物理基表闭包：** `ops_daily_review`、`pos_ingest_batch`、`pos_sales_day`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 核对地点。 | 门店定位。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_ops_manager_sales_reconciliation.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 核对日期。 | 时间定位。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `daily_review_id` | 复盘ID | `uuid` | 否 | 人工输入来源复盘版本。 | 追溯。 | 不适用。 | `52357c7b-d797-5e3c-8089-44077df37877` | v_ops_manager_sales_reconciliation.daily_review_id 只表示本字段说明中的 复盘ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `manager_net_sales` | 店长确认营业额 | `numeric(18,4)` | 是 | 复盘人工输入中的营业额。 | 人工来源。 | 不适用。 | `55000` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `pos_net_sales` | POS净销售 | `numeric(18,4)` | 是 | POS当前有效净销售。 | 自动来源。 | 不适用。 | `53670` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `difference_amount` | 差异金额 | `numeric(18,4)` | 是 | 人工减POS。 | 识别漏渠道或口径差。 | 不适用。 | `1330` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `difference_rate` | 差异率 | `numeric(12,8)` | 是 | 差异相对批准分母。 | 跨日比较。 | 不适用。 | `0.02478` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `reconciliation_status` | 核对状态 | `text` | 否 | MATCH、WARNING或MISSING。 | 复盘提示。 | 不适用。 | `WARNING` | v_ops_manager_sales_reconciliation.reconciliation_status 只表示本字段说明中的 核对状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_ops_shift_by_role` — 岗位工时分布

- **用途：** 按地点、营业日和标准岗位汇总计划与实际工时。
- **一行代表：** 地点 × 营业日 × 岗位一行
- **读取项目：** BakeryOps、HR、财务网站、分析/BI
- **实施层级：** SOURCE_CONDITIONAL
- **SELECT规格准备度：** `DEFER_SOURCE`
- **稳定阻断码：** `SOURCE_CONTRACT_NOT_VERIFIED:HR_TIMESHEET_ENTRY | EXTENSION_PACK_NOT_ACTIVATED:SHIFT_AND_WORKFORCE`
- **粒度唯一键：** `location_id + business_date + role_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `ops_shift_assignment` → `ops_shift_requirement` → `v_hr_timesheet_entry_current` → `ops_role`
- **物理基表闭包：** `hr_timesheet_entry`、`hr_timesheet_sync_batch`、`ops_role`、`ops_shift_assignment`、`ops_shift_requirement`
- **说明：** 只读分析接口，不允许作为业务事实写入口。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 工作地点。 | 门店分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_ops_shift_by_role.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 工时日期。 | 时间分组。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `role_id` | 岗位ID | `uuid` | 否 | 标准岗位。 | 岗位分组。 | 不适用。 | `09f16903-340c-50f3-acd6-30b573a18dde` | v_ops_shift_by_role.role_id 只表示本字段说明中的 岗位ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `role_code` | 岗位代码 | `text` | 否 | 标准岗位代码。 | 业务显示。 | 不适用。 | `KITCHEN_BAKER` | v_ops_shift_by_role.role_code 只表示本字段说明中的 岗位代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `scheduled_minutes` | 计划分钟 | `bigint` | 是 | 正式班表该岗位净分钟。 | 人员计划。 | 不适用。 | `960` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `actual_minutes` | 实际分钟 | `bigint` | 是 | 工时记录该岗位净分钟。 | 实际投入。 | 不适用。 | `930` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `variance_minutes` | 工时差异 | `bigint` | 是 | 实际减计划。 | 执行偏差。 | 不适用。 | `-30` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `employment_count` | 实际人数 | `bigint` | 是 | 有实际工时的不同雇佣关系数量。 | 人员覆盖。 | 不适用。 | `2` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `quality_status` | 质量状态 | `text` | 否 | 岗位和工时映射是否完整。 | 解读门禁。 | 不适用。 | `COMPLETE` | v_ops_shift_by_role.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_cost_card_material_price_current` — 当前成本采用价

- **用途：** 为每个地点或全局原料选择当前生效的批准成本价格并显示来源质量。
- **一行代表：** 地点或全局 × 原料一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `FIX_MODEL_CONTRACT`
- **稳定阻断码：** `AS_OF_SEMANTICS_UNRESOLVED`
- **粒度唯一键：** `location_id + material_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `cost_card_material_price` → `scm_material`
- **物理基表闭包：** `cost_card_material_price`、`scm_material`
- **说明：** 以查询 as_of 时点应用半开区间 effective_from <= as_of AND (effective_to IS NULL OR as_of < effective_to)，排除 REJECTED/UNIT_ERROR；按 location_id(含全局NULL),material_id 分组，依次按 effective_from DESC、质量 VERIFIED>ESTIMATED>STALE、created_at DESC、material_price_id DESC 取一行。有效期重叠进入 BLOCKER，禁止静默择一。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：location_id；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 是 | 地点特有价；全局为空。 | 门店成本。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 2 | `material_id` | 原料ID | `uuid` | 否 | 统一原料。 | 配方连接。 | 不适用。 | `8c355ce8-319e-59d1-adae-a774f7e4d708` | v_cost_card_material_price_current.material_id 只表示本字段说明中的 原料ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 3 | `material_price_id` | 成本价格ID | `uuid` | 否 | 当前采用价记录。 | 追溯。 | 不适用。 | `c4a11622-b1e0-598a-8164-bd1309a5ed84` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 4 | `price_myr_per_base_unit` | MYR基础单价 | `numeric(18,8)` | 否 | 当前成本单价。 | 成本计算。 | 不适用。 | `0.063` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 5 | `price_source` | 价格来源 | `text` | 否 | 收货、PO、报价、人工或兜底。 | 证据强度。 | 不适用。 | `RECEIPT_ACTUAL` | 聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。 |
| 6 | `effective_from` | 生效时间 | `timestamptz` | 否 | 当前价格起始。 | 新鲜度。 | 生效区间起点，采用含起点语义。 | `2026-08-11T10:30:00+08:00` | v_cost_card_material_price_current.effective_from 只表示本字段说明中的 生效时间；必须在所属对象粒度内按 timestamptz 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `quality_status` | 质量状态 | `text` | 否 | VERIFIED、ESTIMATED、STALE等。 | 毛利门禁。 | 不适用。 | `VERIFIED` | v_cost_card_material_price_current.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_cost_card_recipe_expanded` — 配方展开

- **用途：** 递归展开产品和半成品配方到最终统一原料，并保留路径和累计用量。
- **一行代表：** 顶层配方版本 × 路径 × 最终原料一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `BLOCK_MISSING_FACT_OR_RULE`
- **稳定阻断码：** `RECIPE_RECURSION_RULE_UNDEFINED | UNIT_CONVERSION_PATH_RULE_UNDEFINED`
- **粒度唯一键：** `root_recipe_version_id + path_component_ids + material_id`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `cost_card_recipe_version` → `cost_card_recipe_component` → `scm_material` → `scm_material_unit_conversion`
- **物理基表闭包：** `cost_card_recipe_component`、`cost_card_recipe_version`、`scm_material`、`scm_material_unit_conversion`
- **说明：** 只读分析接口，不允许作为业务事实写入口。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：material_id；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `root_recipe_version_id` | 顶层配方版本ID | `uuid` | 否 | 被展开产品配方版本。 | 成本和需求入口。 | 不适用。 | `70c4cad1-0573-5203-adf6-1929911d490f` | v_cost_card_recipe_expanded.root_recipe_version_id 只表示本字段说明中的 顶层配方版本ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `output_product_id` | 产出产品ID | `uuid` | 是 | 顶层可售产品。 | 产品连接。 | 不适用。 | `47d1b643-4027-5330-b49b-4f7bbd911849` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `material_id` | 最终原料ID | `uuid` | 是 | 展开后的叶子原料。 | 价格和库存连接。 | 不适用。 | `8c355ce8-319e-59d1-adae-a774f7e4d708` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 4 | `path_recipe_version_ids` | 配方路径 | `uuid[]` | 否 | 从顶层到叶子的配方版本路径。 | 循环和来源解释。 | 不适用。 | `{...}` | v_cost_card_recipe_expanded.path_recipe_version_ids 只表示本字段说明中的 配方路径；必须在所属对象粒度内按 uuid[] 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `path_component_ids` | 组件路径 | `uuid[]` | 否 | 对应配方组件路径。 | 精确血缘。 | 不适用。 | `{...}` | v_cost_card_recipe_expanded.path_component_ids 只表示本字段说明中的 组件路径；必须在所属对象粒度内按 uuid[] 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `base_unit_quantity_per_output` | 单位产出原料量 | `numeric(18,10)` | 是 | 每单位顶层产出所需最终原料量。 | 需求和成本。 | 不适用。 | `50` | 使用前确认该表约定的单位；不同单位不得直接相加。 NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `depth` | 展开层级 | `integer` | 否 | 叶子距离顶层层数。 | 检测异常复杂或循环。 | 不适用。 | `2` | v_cost_card_recipe_expanded.depth 只表示本字段说明中的 展开层级；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `quality_status` | 质量状态 | `text` | 否 | COMPLETE、CYCLE、MISSING_RECIPE或UNIT_ERROR。 | 计算门禁。 | 不适用。 | `COMPLETE` | v_cost_card_recipe_expanded.quality_status 只表示本字段说明中的 质量状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |

## `v_ops_daily_review_current` — 当前批准运营复盘

- **用途：** 为每个地点营业日选择唯一、最新的已批准复盘版本，并保留店长结构化核对数字。
- **一行代表：** 地点 × 营业日一行
- **读取项目：** BakeryOps、财务网站、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `FIX_MODEL_CONTRACT`
- **稳定阻断码：** `NULL_APPROVAL_TIMESTAMP_SELECTION_UNDEFINED | APPROVED_VERSION_CONFLICT_OUTPUT_MISSING`
- **粒度唯一键：** `location_id + business_date`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `ops_daily_review`
- **物理基表闭包：** `ops_daily_review`
- **说明：** 只接受 status='APPROVED'；按 location_id,business_date 分组，依次按 approved_at DESC、version_no DESC、daily_review_id DESC 取一行。DRAFT/SUBMITTED 不进入正式分析；没有批准版本时返回缺失而不是默认选择草稿。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `location_id` | 地点ID | `uuid` | 否 | 复盘地点。 | 连接POS、计划、班表和财务核对。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | v_ops_daily_review_current.location_id 只表示本字段说明中的 地点ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `business_date` | 营业日期 | `date` | 否 | 被复盘营业日。 | 共同日期键。 | 地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。 | `2026-08-08` | 不要由 created_at 或 UTC 日期临时推导。 |
| 3 | `daily_review_id` | 复盘ID | `uuid` | 否 | 被选中的批准版本。 | 追溯人工和AI证据。 | 不适用。 | `52357c7b-d797-5e3c-8089-44077df37877` | v_ops_daily_review_current.daily_review_id 只表示本字段说明中的 复盘ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `version_no` | 版本号 | `integer` | 否 | 被选中复盘版本号。 | 明确更正顺序。 | 不适用。 | `2` | v_ops_daily_review_current.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `manager_revenue` | 店长录入营收 | `numeric(18,4)` | 是 | 店长独立确认的营收。 | 与POS核对。 | 不适用。 | `18520.40` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 6 | `manager_transaction_count` | 店长交易数 | `integer` | 是 | 店长独立确认的交易笔数。 | 与POS核对。 | 不适用。 | `312` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 7 | `manager_avg_transaction` | 店长平均客单 | `numeric(18,4)` | 是 | 店长口径平均客单。 | 与POS核对并发现录入差异。 | 不适用。 | `59.36` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 8 | `manager_revenue_at` | 店长录入时间 | `timestamptz` | 是 | 店长数字确认时间。 | 新鲜度审计。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-09T09:15:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 9 | `manager_input` | 店长补充输入 | `jsonb` | 否 | 突发事件、原因和动作说明。 | 复盘上下文，不替代结构化数字。 | 不适用。 | `{"event":"rain"}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 10 | `review_summary` | 结构化复盘 | `jsonb` | 否 | 批准的复盘结果。 | 下游动作与分析。 | 不适用。 | `{"forecast_accuracy":0.82}` | 只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。 |
| 11 | `approved_at` | 批准时间 | `timestamptz` | 是 | 版本批准时间。 | 确定当前版本和审计。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-09T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `v_finance_import_batch_current` — 当前获准财务批次

- **用途：** 为每个财务数据集、来源、地点范围、期间和来源层级选择唯一获准且未被替代的批次。
- **一行代表：** 来源 × 数据集 × 地点范围 × 期间 × 来源层级一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `FIX_MODEL_CONTRACT`
- **稳定阻断码：** `NULL_APPROVAL_TIMESTAMP_SELECTION_UNDEFINED`
- **粒度唯一键：** `source_system_id + dataset_code + scope_location_id + period_start + period_end + source_layer`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `finance_import_batch`
- **物理基表闭包：** `finance_import_batch`
- **说明：** 只接受 status IN ('APPROVED','LOADED') 且 recognition_status IN ('APPROVED_FOR_RECONCILIATION','POSTED_ACCOUNTING')；排除被另一合格批次 supersedes 的批次；按来源、数据集、scope_location_id、期间、source_layer 分组后依次按 approved_at DESC、created_at DESC、finance_import_batch_id DESC 取一行。SOURCE_ONLY 与 POSTED_ACCOUNTING 绝不在同一指标中相加。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：scope_location_id；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `finance_import_batch_id` | 财务批次ID | `uuid` | 否 | 被选中的获准财务批次。 | 所有财务事实通过该ID进入核对视图。 | 不适用。 | `e302e8bd-5a6c-53b0-a4ae-4aea333105c8` | v_finance_import_batch_current.finance_import_batch_id 只表示本字段说明中的 财务批次ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `source_system_id` | 来源系统ID | `uuid` | 否 | 财务数据来源。 | 区分不同权威来源。 | 不适用。 | `cc179b9f-5b40-5789-b0bc-58190727cd35` | 这是来源系统证据，不等于企业统一身份。 |
| 3 | `dataset_code` | 数据集代码 | `text` | 否 | 批次数据集类型。 | 选择对应事实表。 | 不适用。 | `MONTHLY_COST` | v_finance_import_batch_current.dataset_code 只表示本字段说明中的 数据集代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `scope_location_id` | 批次范围地点ID | `uuid` | 是 | 单地点范围；多地点或公司级为空。 | 防止不同门店文件互相替代。 | 不适用。 | `6492cd18-7001-5b36-a14c-dd25c18f847c` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 5 | `period_start` | 期间开始 | `date` | 否 | 批次覆盖期间起点。 | 财务期间连接。 | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。 | `2026-07-01` | v_finance_import_batch_current.period_start 只表示本字段说明中的 期间开始；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `period_end` | 期间结束 | `date` | 否 | 批次覆盖期间终点。 | 财务期间连接。 | 无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。 | `2026-07-31` | v_finance_import_batch_current.period_end 只表示本字段说明中的 期间结束；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `source_layer` | 来源层级 | `text` | 否 | 运营模板、管理报表、过账账簿或银行流水。 | 禁止跨层级相加。 | 不适用。 | `MANAGEMENT_REPORT` | 这是来源系统证据，不等于企业统一身份。 |
| 8 | `recognition_status` | 财务确认状态 | `text` | 否 | 批准核对或已过账状态。 | 决定允许的财务用途。 | 不适用。 | `APPROVED_FOR_RECONCILIATION` | v_finance_import_batch_current.recognition_status 只表示本字段说明中的 财务确认状态；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 9 | `approved_at` | 批准时间 | `timestamptz` | 是 | 批次财务批准时间。 | 确定最新获准批次。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-08-05T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |

## `v_finance_target_current` — 当前财务经营目标

- **用途：** 为每个地点或公司、月份和指标选择唯一当前生效的批准目标版本。
- **一行代表：** 地点或公司 × 月份 × 指标一行
- **读取项目：** 财务网站、BakeryOps、分析/BI
- **实施层级：** PHASE1
- **SELECT规格准备度：** `FIX_MODEL_CONTRACT`
- **稳定阻断码：** `NULL_APPROVAL_TIMESTAMP_SELECTION_UNDEFINED | ACTIVE_VERSION_CONFLICT_OUTPUT_MISSING`
- **粒度唯一键：** `location_id + business_month + metric_code`
- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。
- **血缘：** `finance_target`
- **物理基表闭包：** `finance_target`
- **说明：** 只接受 status='ACTIVE'；按 location_id（NULL作为公司范围）、business_month、metric_code 分组，依次按 version_no DESC、approved_at DESC、finance_target_id DESC 取一行。多条ACTIVE本身是质量错误，不靠排序掩盖。 粒度键中的可空字段按 PostgreSQL NULLS NOT DISTINCT / IS NOT DISTINCT FROM 语义分组和去重，包括：location_id；不得让 NULL 绕过去重或产生重复业务行。

| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `finance_target_id` | 目标ID | `uuid` | 否 | 被选中的目标版本。 | 回查批准记录。 | 不适用。 | `f00e9acf-67d4-56db-a52f-426472faea4a` | v_finance_target_current.finance_target_id 只表示本字段说明中的 目标ID；必须在所属对象粒度内按 uuid 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 2 | `location_id` | 地点ID | `uuid` | 是 | 地点目标；公司总目标为空。 | 范围分组。 | 不适用。 | `122b374d-3a95-5bd4-8a1b-6a4ec95a06f8` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
| 3 | `business_month` | 目标月份 | `date` | 否 | 目标所属月份第一日。 | 实际对比。 | 月份键，固定为该月第一天；不是某笔交易发生日。 | `2026-08-01` | v_finance_target_current.business_month 只表示本字段说明中的 目标月份；必须在所属对象粒度内按 date 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 4 | `metric_code` | 指标代码 | `text` | 否 | 目标指标稳定代码。 | 连接实际指标。 | 不适用。 | `REVENUE` | v_finance_target_current.metric_code 只表示本字段说明中的 指标代码；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 5 | `version_no` | 版本号 | `integer` | 否 | 被选中目标版本号。 | 明确调整顺序。 | 不适用。 | `2` | v_finance_target_current.version_no 只表示本字段说明中的 版本号；必须在所属对象粒度内按 integer 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 6 | `target_value` | 目标值 | `numeric(24,8)` | 否 | 批准目标数值。 | 计划与实际比较。 | 不适用。 | `1600000` | v_finance_target_current.target_value 只表示本字段说明中的 目标值；必须在所属对象粒度内按 numeric(24,8) 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 7 | `unit` | 目标单位 | `text` | 否 | MYR、PERCENT、COUNT 等。 | 避免数值歧义。 | 不适用。 | `MYR` | v_finance_target_current.unit 只表示本字段说明中的 目标单位；必须在所属对象粒度内按 text 读取，不得借同名字段跨表猜口径、补值或充当连接键。 |
| 8 | `approved_at` | 批准时间 | `timestamptz` | 是 | 目标批准时间。 | 确定性选版和审计。 | 绝对时间；展示或转营业日时必须使用地点时区。 | `2026-07-28T10:00:00+08:00` | NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。 |
