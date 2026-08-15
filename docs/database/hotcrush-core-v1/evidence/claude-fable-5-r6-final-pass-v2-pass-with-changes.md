# Claude Code Fable 5 R6 V2 终审（修订前）

最终结论：PASS_WITH_CHANGES

本轮使用本机 Claude Code `claude-fable-5`、`max` 推理强度和只读 plan 权限执行。Claude 独立重算并确认：137 张潜在物理表；首期 100（81 业务 + 19 平台）；扩展 33；来源条件 4；59 个视图；1,797 个物理字段；642 个视图字段；2,439 个字段说明；196 个对象说明；418 个 FK；939 个现库字段一一有去向；154 条旧方案处置完整；Draw.io/PDF 61 页、4 张 6000px PNG。上一轮三项必修均判定 CLOSED。

Claude 仍提出 3 项交付前必修，因此本版本禁止交付：

1. **M1：关键旧表仍存在对象级字段迁移兜底。** `item_hourly_sales`、`employees`、`cost_card_item_price`、`staff`、`cost_card_recipe` 必须逐字段指向真实目标、明确派生或明确不迁移；`finance_revenue_daily`、`fact_hbti_response`、`fact_shift` 的对象规则也存在字段契约矛盾或缺口。验证器的关键对象白名单必须同步扩充。
2. **M2：来源缺失被静默补零。** 来源条件表 `hr_timesheet_entry.break_minutes` 仍为 `NOT NULL DEFAULT 0`，必须改成可空、无 0 默认和空值安全约束；计划表 `ops_shift_assignment.break_minutes` 的第一方计划零值不属于该问题。
3. **M3：另有行为驱动 JSON 缺 Schema 门禁。** `mkt_campaign_version.audience_rule/participation_rule/reward_rule`、`hr_screening_rule.rule_definition`、`mkt_survey_question.validation_rule`、`cost_card_recipe_component.condition_rule` 必须增加版本判别、受控校验、未知键拒绝和阻断绕过直写的实施门禁；验证器不能再只靠说明里出现 `schema` 一词判断。

Claude 另外确认：在不丢失独有不可重建事实或混合粒度的前提下，没有证据支持把首期 100 张再机械压缩；表少本身不应取代粒度和事实保真。聚合哈希虽然由本地连续两次运行复现，但当时尚未作为包内可独立执行的门禁，PDF 的墙钟元数据也必须排除或规范化。

> 证据边界：这是 Claude 原始终审结论的忠实压缩记录，保留了 verdict、精确计数、三项必修和无法验证边界；完整终端输出未把设计评审误写成生产已执行验证。
