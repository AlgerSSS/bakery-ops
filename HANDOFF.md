# 交接（HANDOFF）

> **开工第一件事：读本文件。收工最后一件事：更新本文件。**
> 这是唯一的交接凭证——不要让下一个 agent 去翻你的对话记录，也不要假设别人记得你做过什么。
> 规则见 [AGENTS.md](AGENTS.md) 第 0 节。

---

## 当前状态

| | |
|---|---|
| 最后更新 | 2026-07-25 by Claude Code |
| 当前分支 | `main`（已合并全部修复并部署） |
| 工作区 | 干净 |
| 线上（Contabo） | 未知，无法从 git 得知（`/opt/hotcrush/*` 下没有 `.git`） |

---

## 在做什么 / 做到哪

（当前没有由 Claude Code 发起的进行中任务）

---

## 下一步

- **数据库治理 P0 切片**，方案见 `~/Downloads/企业级数据库重构与全代码数据访问改造总控Prompt.md`（v2 修订版）。
  与本仓库直接相关的两片：
  - **S1** —— 把 `bakery-ops/src/modules/data/migrations/005_schema_separation.sql`、`006_lark_sync.sql`
    移入 `migrations/archive/` 并登记为「已废弃、不得应用」。
    这两个迁移从未被应用（`schema_migrations` 实测序列 `1,2,3,4,7…24`，缺 5、6），
    而 005 的内容是把 `employees`/`suppliers`/`supply_orders` 等一批表 `SET SCHEMA` 搬出 `public`。
    **任何「重放迁移链」的动作都会引爆它，当场打断 Vercel 上的财务站。**
  - **S2** —— `timeslot_sales_record` 止血（见下面「坑」第 1 条）。
- 清理上面那批在途改动：确认归属 → 提交或丢弃。

---

## 坑（别人容易踩的）

0. **POS 商品命名 2026-07 从中文换成英文，所有跨表关联必须走桥。**
   两座桥各管一半，缺一不可：`item_alias`（en→cn，覆盖近 90 天 93 品里的 88 品，**含饮品**）、
   `product.name_en`（只有排产用的烘焙品，查「拿铁」是 0 条）。
   归一化统一用 `beverage-caliber.ts` 的 `NORM_SQL` / `normCaliberName`，含 `chr(160)` 处理——
   Postgres 的 `[[:space:]]` 不含 U+00A0，不处理会漏掉尾部带 tab 的品名。
   **写任何按商品名 JOIN 的新代码前，先确认两侧语种一致。** 已知的九处全部修完并部署。

1. **`timeslot_sales_record` 现在每天在丢数据。** 三个写入点全是「清空再写」，跨两个仓库：
   - `res_api/sync-to-db.js:134` —— `TRUNCATE ... RESTART IDENTITY`，每晚 KL 23:00 跑
   - `bakery-ops/src/modules/data/repositories/sales-baseline.repository.ts:64` —— `DELETE FROM`
   - `bakery-ops/src/modules/data/repositories/forecast-calc.repository.ts:317` —— `DELETE FROM`

   两边写的是两套不相交的命名空间（爬虫写 POS 英文名，bakery-ops 从 Excel 导入中文名），
   却共用唯一键 `(product_name, day_type, time_slot)`。实测该表 1832 行、**中文名 0 行**——爬虫一直在赢。
   **在 S2 修好之前，不要往这张表加任何逻辑。**

2. **迁移编号空间与财务仓库冲突。** `schema_migrations` 是两个仓库共用的一张表：
   1–24 属本仓库，27–45 属财务仓库，**27 号双占**——本仓库的 `027_product_cost.sql` 永远登记不上。
   加新迁移前先看 S3 切片有没有做完。

3. **`./deploy.sh` 从本地工作树 rsync，不经过 git。** 工作区不干净就跑 = 把半成品推上 Contabo。
   分支不构成任何保护——只要 checkout 在本地，deploy 就会带上去。

4. **数据库只有生产库**，没有 staging、没有脱敏副本。只读查询随便跑，DDL/DML 一律先写成迁移文件交给人执行。

5. **爬虫写入窗口是 KL 时间每晚 23:00 前后**，任何 DDL 都要避开，建议 01:00–13:00 之间做。

---

## 最近改动

| 日期 | 谁 | 做了什么 |
|---|---|---|
| 2026-07-25 | Claude Code | 补完剩余 3 处：经营问答中文查询（蛋挞 0→58 行）、item_alias 补 5 款改名品、res_api 草稿加 .gitignore（164→0 未跟踪） |
| 2026-07-25 | Claude Code | 修复 POS 改名引发的 6 处静默失效：饮品误报断货、预测复盘实卖恒 0、排产报废告警不触发、水吧营业额恒 RM0、预估单预计销售恒 0、AI 加产指令被误报污染；拆掉两处 daily_sales_record 整表删除 |
| 2026-07-25 | Claude Code | 建立交接机制（本文件 + AGENTS.md 第 0 节）；审查并重写数据库治理方案 v2 |
| 2026-07-21 | 未记录 | `refactor/architecture-review` 分支两个提交：复盘拒绝陈旧输入；之后留下 165 行未提交改动 |
| 2026-07-06 | 未记录 | 核心指标表补全实收/水吧的上周同天+变化 |
