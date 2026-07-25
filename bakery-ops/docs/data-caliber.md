# 数据口径说明（Data Caliber）

> 2026-07-02 数据修真（IMPROVEMENT-PLAN G1）前后，各表口径发生过变化。
> 做任何跨 2026-07-02 的分析、或引用历史数据训练/调参前，先读本文。

## daily_sales_record（单品日销）

| 时期 | 口径 |
|---|---|
| 2026-07-02 回填后（现状） | **全表 183+ 天均为真实日销**：由 `item_hourly_sales`（POS 逐时真值）按 (品, 日) 求和而来；此后每晚由 `res_api/sync-to-db.js` 以同口径增量写入 |
| 2026-07-02 之前（历史事实，已被覆盖） | POS 同步期（约 2026-04 起）写入的是 **30 天滚动均值冒充当日值**（`totalQty/30` 打当天日期）——周内波动被抹平；更早为 Excel 手工导入 |

- 修复动作：`res_api/backfill-daily-sales.js`（2026-07-02 执行，5,386 → 9,436 行）。
- **修复前原值备份在 `daily_sales_record_backup_g1`**，回滚命令见脚本头注释。
- `day_of_week`：回填后按数据日期计算（此前错误地用同步日）。

## timeslot_sales_record（时段基线）

- **现状**（2026-07-02 起）：每晚从 `item_hourly_sales` 近 56 天窗口按真实星期分桶重建；`day_type` 值为驼峰 `mondayToThursday`/`friday`/`weekend`（与 TS 引擎一致）；`sample_count` = 该日型窗口内真实天数。
- **此前**：同一个 30 天均值复制给三种日型（三者必然相等），且写蛇形 `monday_to_thursday` 导致引擎周一至周四永远匹配不到。该表每晚 TRUNCATE 重建，无历史残留。

## 仍是近似口径的表（未修，分析时注意）

- **daily_dining_breakdown**：堂食/外带比例是 **30 天静态比例抹到每一天**（`sync-to-db.js` 注释自认），不是真实逐日值。做外卖渠道分析前先修口径。
- **item_waste**：`waste_reason` 在 2026-01～03 有 67 行旧中文值 `排产报损`，之后统一为 `scheduling`——所有"排产报废"统计只认 `scheduling`，早期三个月不参与近 7/30 天窗口，跨期年度汇总需两值都算。

## 一直真实的表

`daily_revenue`（含 member_sales_ratio/discount_rate）、`hourly_sales_summary`、`item_hourly_sales`（2026-01-01 起）、`daily_payment_breakdown`——逐日/逐时真值，无口径问题。

## 其他标记与孤儿

- **out_of_stock_record**：`input_name='auto'` 的行来自断货自动检测（F5，2026-07-02 起）；其余为网页手工录入。表无独立来源列，以此区分。
- **prophet_trend_cache**：孤儿表——写入方 `/api/prophet-trend` 已于 2026-07-02 删除（装饰链路，无读取方）；表内数据无消费者，可择机 DROP。
- **forecast_snapshot**（2026-07-02 新增）：每日预估建议的当日最后一版快照，供"预测复盘"对账；**不要用它重算历史建议**（基线滚动更新，重算≠当时建议——这正是建表原因）。
- **schema_migrations**：005/006 **有意未回填**（确证未应用；005 现在补跑会把 daily_review 挪进 forecast schema、破坏现有裸表名查询）。

## 预测调参提醒

跨 2026-07-02 的模型/系数评估要分段：修复前的 daily_sales_record 段（已被覆盖，如需原值查备份表）学不到周内规律是数据假象，不是需求真相。`prophetDowWeights`（设置页可调的周一至四系数）默认值源自早年一次拟合，数据修真后如需重估，现在有 183+ 天真值可用。
