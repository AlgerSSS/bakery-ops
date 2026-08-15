# Ask Claude artifact — HOT CRUSH 152 表最小粒度审计

- User task: 独立审核 R4 的 152 张目标表是否均为最小颗粒、识别可派生/视图化/合并/拆分/延后项，并遵守第一性原则和事实边界。
- Backend: Claude Code CLI
- Model: claude-fable-5
- Effort: max
- Permission mode: plan
- Allowed tools: Read, Grep, Glob
- Invocation status: exit 0
- Prompt summary: 只读交叉核对目标模型、43 个视图、表/字段 CSV、蓝图与第一性原则文档；必须逐表覆盖恰好 152、verdict 计数闭合、列出字段冗余/生命周期冲突/15 条链路影响和待验证问题。
- Raw CLI output note: CLI 在本任务终端返回了完整 152 行正文；Claude 同步写出的原始本地审计摘要如下。完整逐表正文同时进入本轮生成的 07 审计交付物，不以此摘要代替最终裁决。

## Raw advisor output (Claude-written local audit summary)

# HOT CRUSH 目标数据库蓝图第一性原则审计（R4，152 表）

## Context

对 `docs/database/hotcrush-core-v1/` 的 R4 目标模型（152 表 + 43 视图）做独立只读架构审计：逐表验证"不可替代最小事实粒度"，识别可派生、应改视图、应合并/拆分/延后的对象，以及字段级派生冗余与 mutation policy 冲突。审计以 `model/*.py` 为基准（`validate_model()` 通过；catalog/field-dictionary CSV 与模型经机器比对零偏差，2212 行 = 1824 表字段 + 388 视图字段全对齐）。

## A. 结论

**152 张不全部满足，但偏差很小且不在"表太多"：149 张在各自 KEEP 理由下满足最小粒度；1 张应 SPLIT（scm_supplier_item），2 张应 DEFER（pos_payment、pos_refund）；REPLACE_VIEW=0、MERGE=0 是审查结论而非默认**——可派生结果已被 43 个 v_* 视图吸收（毛利、库存余额、排行、当前选版、会员归属全部为视图，无一物理化），未发现合并能减少歧义的组合。最重要的不满足原因是三类：①供应商 SKU→material 身份映射无有效期（违反自家门禁 8，历史价格观察会被重映射改写归属）；②支付/退款来源能力未证且唯一键缺 source_system 命名空间、退款无批次血缘；③需求因子表是算法输出却无 run/算法版本血缘（违反自家门禁"派生必须可追溯"）。另有约 20 处字段级缺陷（缺等式 CHECK、无效 UQ、当前态缓存未注明、政策冲突），属加固而非重构。

## B. 逐表审计（152 行）

见最终报告正文（与本文件同内容），verdict 分布：KEEP_MASTER 53 / KEEP_BASE 46 / KEEP_WORKFLOW 26 / KEEP_FROZEN_DERIVED 13 / KEEP_TECHNICAL 11 / SPLIT 1 / DEFER 2 / REPLACE_VIEW 0 / MERGE 0，合计 152，无重复无遗漏（与模型表名逐一对应）。

## E. 若批准进入修模，按此优先级改 model/*.py（结构缺陷）

1. **scm_supplier_item**：拆出 `scm_supplier_item_material_mapping`（supplier_item × material × [valid_from, valid_to) + 防重叠 + 状态），或在本表加有效期并禁止原地改 material_id；`tables_scm_finance.py`。
2. **scm_inventory_movement**：`source_object_type/id` 多态文本改显式可空 FK 组（goods_receipt_id / production_run_id / inventory_count_id / dispatch_id）+ num_nonnulls CHECK，比照 `msg_outbound_message` 模式。
3. **pos_refund / pos_payment**（DEFER 期内）：退款补 `source_system_id` + `first_seen_pos_ingest_batch_id`；两表 UQ 改 (source_system_id, source_payment_id/source_refund_id)。
4. **ops_demand_factor_observation**：补 `job_run_id` FK、`algorithm_version`（及可选批准字段）。
5. **finance 5 张行表**（monthly_cost_line / order_logistics_line / inventory_snapshot_line / inventory_flow_line / supplier_purchase_monthly）：补 `source_row_fingerprint` + 批次内 UQ（照 pos_item_waste 模式）。
6. **hr_application**：补 stage 变更事件（专表或明确走 app_audit_event 的约定）。
7. 政策修正：app_session→CONTROLLED_UPDATE_UNTIL_TERMINAL；hr_employee_event→APPEND_ONLY_DECISION_RECORD；mkt_survey_question/option→随父版本 DRAFT_MUTABLE_THEN_FROZEN；hr_offer→DRAFT_MUTABLE_THEN_FROZEN；ops_operational_event / ops_stockout_event 增加终态冻结说明。

仅加约束/注释（不改结构）：delta/line_amount/total 等式 CHECK 系列（scm_replenishment_line、scm_purchase_order_revision/line、cost_card_product_cost_snapshot、ops_workload_line、hr_assessment、ops_daily_review、ops_demand_factor_observation）；清理 3 个含 PK 的无效 UQ（forecast_run / workload_run / material_requirement_run）；ops_shift_requirement 行级 UQ；锚表 status（production_plan / shift_plan / purchase_order）注明缓存语义或删除；缓存字段（listing.current_price、member.has_*、conversation.last_message_at、outbound.attempt_count 等）注明非事实；mkt_reward_stock 与 claim 的对账视图；finance_target 当前版选择视图。

## 验证方式

改模后运行 `PYTHONDONTWRITEBYTECODE=1 python3 -m model.target_model`（validate_model 必须零 errors），并重新生成 catalog/dictionary CSV（tools/ 下生成器）后 diff 核对表数与字段数变化是否与本清单一致。本审计本身为只读，未改任何文件。


## Codex summary

- Claude 判定原 R4 不是 152/152 全部合格：149 KEEP、1 SPLIT、2 DEFER。
- 结构优先项：供应商 SKU 物料映射有效期、库存移动显式来源 FK、支付/退款命名空间和批次血缘、需求因子运行血缘、HR 申请阶段事件。
- 字段级优先项：可派生比率/差额、当前态缓存、无效或缺失唯一约束、发布后冻结策略。
- Claude 的结论是独立意见，不直接等于最终模型；Codex 将逐项采纳、修正或拒绝并记录理由。

## Action items

1. 不保留 R4 数量目标，先修复表粒度与历史血缘。
2. 为每张最终表生成机器可核对的 storage audit 行。
3. 把可直接派生的比率、差额与当前态移到治理视图；仅保留有来源保真、决策复现或事务并发理由的冻结派生字段。
4. 更新模型、15 条链路、字段字典、Draw.io 和桌面评审包，再做计数与链接验收。

