最终结论：PASS_WITH_CHANGES

# 1. 阻断项

无。上一轮 B1–B4 全部关闭。以下各项按本包自身规则计入后，构成交付老板批准前必须先修的强制修订，但不构成结构性 FAIL。

# 2. 非阻断但交付前应修项

按风险排序，来自对 1,757 个物理字段与 939 个现库字段的扫描：

1. **`item_waste.amount` 静默丢失。** 目标 `pos_item_waste` 无金额列，对象规则未提金额。报废金额是 RES 报告的来源事实，不能由 quantity × 价目可靠重建。必须加列或写明批准弃用理由。
2. **`hourly_sales_summary.num_of_guests` 与 `total_discount` 静默丢失。** 目标 `pos_sales_hour` 只有 gross/net/order_count；小时客流不可重建，小时折扣在存在退款口径时不等于 gross−net。规则文本未声明去向。
3. **`product` 表人工决定属性无去向。** `positioning`、`audience`、`target_tc`、`cold_hot`、`time_slots`、`break_stock_time`、`display_full_quantity`、`sort_order`、`unit_type`、`price` 在目标 `ops_product` 中无对应列；`avg_*`、`baseline_*`、`sales_ratio` 属可派生缓存，丢弃合理但须显式标 DERIVE/RETIRE。
4. **`pos_product.res_total_cost`、`res_theoretical_cost`、`res_cost_card_id`、`res_spec_id`、`has_cost_card` 无去向。** RES 侧成本观察是外部不可重建观察值；`pos_product_listing` 无对应列，规则未声明归档或弃用。
5. **`ops_store.lark_base_token` 路由指向不存在的目标。** 规则写“拆入应用配置”，但目标不是模型内对象；秘密必须显式声明移出数据库/密钥库处置，不得写入目标表。
6. **次级弱声明：** `daily_breakdown.bill_count/ratio`、`finance_orders.spec/category/ptype/volume`、`finance_stock.category/unit_volume` 的去向不够具体；`hbti_auth_token.token_hash` 的字段级 `PRESERVE_IF_SEMANTICS_MATCH` 与对象级 `REISSUE_NOT_MIGRATE` 冲突。
7. **README 旧数字：** 仍出现“138 张目标表”和“53 个视图”，应改为 137 与 59。

观察项：归档 R5 PDF 的文件名与实际页数不一致但已隔离；`pos_product_listing.source_item_key` 的唯一性在未来第二 POS 来源接入时应扩大到来源系统；会员卡交易四个来源金额全空时的拒绝规则需在实施前做数据剖析。

# 3. B1–B4、N1–N5 关闭情况

| 项 | 判定 | 摘要 |
|---|---|---|
| B1 卡交易保真 | CLOSED | 卡交易已保留原始交易类型、来源订单/代码、金额与前后余额；金额空值不冒充 0，业务时间不冒充抓取时间。 |
| B2 会员状态历史 | CLOSED | 动态会员状态已移至会员×日期×批次快照，稳定会员表不再保存当前动态值；已有 current selector。 |
| B3 当前版本入口 | CLOSED | 追加/更正型 POS 事实已有 current selector，下游视图通过正确数据集选版并暴露 lineage。 |
| B4 跨层 FK 闭包 | CLOSED | 416 个 FK 中 411 个即时激活、5 个显式延迟，校验器会拒绝未声明跨层 FK。 |
| N1 质量多态表 | CLOSED | 物理质量问题表已删除，质量摘要由域视图派生；审计多态字段受限且不作为业务关系。 |
| N2 受控词表 | CLOSED | 闭集生成 CHECK，开放治理代码使用格式约束。 |
| N3 卡注释 | CLOSED | 卡级交易与会员汇总余额快照的边界已说清。 |
| N4 外键数字 | CLOSED | 文档与独立重算均为 416。 |
| N5 旧图卫生 | CLOSED | R5 图已归档且标记不得批准；当前兼容 HTML 与 R6 HTML 字节一致。 |

# 4. 独立精确计数

| 项目 | 独立重算 |
|---|---:|
| 潜在物理表 | 137 |
| 首期 | 100（81 业务 + 19 平台） |
| 扩展包表 | 33 |
| 来源条件表 | 4 |
| 视图 | 59（41 首期 / 13 扩展 / 5 来源条件） |
| 物理字段 / 视图字段 | 1757 / 627 |
| 字段注释 | 2384，空注释 0 |
| 对象注释 | 196 |
| FK 字段 | 416（411 即时 + 5 延迟） |
| 原 154 项去向 | 100 + 33 + 4 + 11 + 4 + 2 = 154 |
| 当前字段矩阵 | 939，零重复、零缺失 |
| Draw.io / PDF 页数 | 61 / 61 |

# 5. 137 张物理表最小性结论

- CORE_PLATFORM 19 张均 KEEP：保存 schema 迁移、作业、审计、账号权限、安全令牌/会话、速率限制、消息副作用、AI prompt 版本与调用事实。
- CORE_BUSINESS 81 张均 KEEP，但 `ops_product`、`pos_sales_hour`、`pos_item_waste` 需要补齐上述来源事实或明确处置。
- EXTENSION_PACK 33 张均 EXTENSION_ONLY，不应在首期一次性创建。
- SOURCE_CONDITIONAL 4 张均 DEFER_SOURCE，必须等支付/退款/Lark 工时来源契约证实。
- 审计者尝试把 `pos_order` 并入订单行、把投递尝试并入事件、把评分/业务关系 JSON 化或把平台状态外置，均会丢失独立事实、混合粒度或引入无治理 JSON，因此没有建议继续减少物理表。

# 6. 全字段与 939 字段迁移矩阵结论

审计者报告全量扫描了 1,757 个物理字段：JSON 字段均有受限结构声明；业务多态只剩受约束审计元数据；金额、币种、单位与时间链未发现新的结构阻断。真实命中即第 2 节列出的字段去向缺口。

当前快照 939 个字段与矩阵集合相等、零重复、零缺失。`pos_member`、`pos_member_daily`、`pos_member_card_txn` 共 97 个字段已经逐字段显式映射。其余对象级规则中约 20 个字段不足以指导无损迁移，对应第 2 节问题，因此当前只能判 `PASS_WITH_CHANGES`。

# 7. 注释、关系、幂等与实施边界

- 196 个对象和 2,384 个字段注释无空缺；字段字典的中文名、存放内容、作用、类型、空值、默认、键、来源、时间、敏感性、示例和误用风险均非空。
- 416 个 FK 都指向存在对象；5 个跨层 FK 明确延迟激活。
- POS/财务/工时摄取事实具有批次或来源自然键；版本表具有版本号和替代关系。
- 生成器不连接数据库，所有状态仍是设计/未执行；静态审计不能证明生产 RLS、触发器、索引、回填、双写、对账或回滚已生效。

# 8. 事实边界与交付许可

已确认的是：设计文件内部计数、字段/对象注释覆盖、FK 闭包、939 字段集合对齐、61 页图文与此前阻断项关闭。

合理推测是：若不修复第 2 节的来源字段去向，实施时会出现静默丢字段。

暂无法验证的是：四个生产部署的动态 SQL、来源系统更正/删除契约、支付/退款/Lark 工时能力、这些缺口字段的真实数据分布，以及迁移/回填/双写/回滚运行效果。

**当前不允许直接作为等待批准的最终设计包交付。** 完成第 2 节全部修订、重新生成并通过再次独立审计后才允许交付。即使最终通过，也只能声称设计评审包内部自洽且与静态快照逐字段对齐，不能声称已批准、已部署或生产兼容已经运行验证。

> 归档说明：本文件是 Claude Fable 5 对修复后 R6 包的原始结论整理，判定仍为 PASS_WITH_CHANGES。为便于复核，保留了所有问题、计数、关闭项和事实边界；措辞仅做了格式压缩，未改变结论。
