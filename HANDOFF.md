# 交接（HANDOFF）

> **开工第一件事：读本文件。收工最后一件事：更新本文件。**
> 这是唯一的交接凭证——不要让下一个 agent 去翻你的对话记录，也不要假设别人记得你做过什么。
> 规则见 [AGENTS.md](AGENTS.md) 第 0 节。

---

## 当前状态

| | |
|---|---|
| 最后更新 | 2026-07-25 by Claude Code |
| 当前分支 | `refactor/architecture-review`（领先 `origin/main` 2 个提交） |
| 工作区 | **不干净 —— 有他人未提交的在途改动，见下** |
| 线上（Contabo） | 未知，无法从 git 得知（`/opt/hotcrush/*` 下没有 `.git`） |

---

## ⚠ 在途未提交改动（不是我留的，动之前先确认归属）

7/21 之后无人再碰，至今 4 天。**在搞清楚这是谁的、做到哪一步之前，不要 `git checkout`、不要 `git stash`、不要跑 `./deploy.sh`。**

```
 M bakery-ops/src/__tests__/unit/daily-push.test.ts
 M bakery-ops/src/bootstrap.ts
 M bakery-ops/src/modules/domain/forecast/stockout-detector.service.ts
 M bakery-ops/src/modules/domain/notifications/morning-brief.service.ts
?? bakery-ops/src/__tests__/unit/stockout-store-only.test.ts
共 165 行新增 / 54 行删除
```

看起来是**断货检测 + 晨报推送**方向的改动，与分支上已提交的两个「复盘拒绝陈旧输入」提交是同一条线索。真实意图不明——原作者没有留下任何记录，这正是本文件要杜绝的情况。

另有 **164 个未跟踪文件**，绝大多数是 `res_api/_*.mjs`、`res_api/_*.png` 这类调试草稿。`deploy.sh` 已经用 `--exclude '_*'` 把它们排除在部署之外，所以不影响上线，但它们让 `git status` 无法一眼看清真正的改动。建议清理或加进 `.gitignore`。

---

## 在做什么 / 做到哪

（当前没有由 Claude Code 发起的进行中任务）

---

## ⚠ 待执行：改名切换窗口（顺序不能反）

分支 `claude/rename-ops-tables` 已把三处表名改成新名，`tsc` 通过、501 个测试全绿，
但**尚未部署**。数据库侧 `stores → ops_store` 已完成（旧名 `stores` 保留为兼容视图），
`users` / `audit_log` 还没改。

**必须先跑迁移，再部署。反过来会让 WhatsApp 认人直接报 `relation does not exist`。**

```
1. 在财务仓库把 048 加进 scripts/apply-migrations.js 的 MIGRATION_FILES
2. node scripts/apply-migrations.js          ← users → ops_user、audit_log → ops_audit_log
3. 立刻 cd ~/hot && git merge claude/rename-ops-tables && ./deploy.sh core
4. 看 Contabo 日志确认无 relation does not exist / ON CONFLICT 报错
```

第 2 步到第 3 步之间有几分钟窗口：旧代码读走兼容视图正常，**写会失败**——
因为 PostgreSQL 的视图不支持 `ON CONFLICT`。两处 upsert 都包在 try/catch 里只记日志
（`user.repository.ts:84`、`audit-log.repository.ts:35`），所以窗口内最坏结果是
用户资料不刷新、审计日志少几条，**不会中断服务**。建议在 KL 时间上午做。

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

0. **POS 商品命名 2026-07 从中文换成英文，所有跨表关联必须走 `product.name_en` 桥。**
   已修的六处都用同一套归一化（`beverage-caliber.ts` 的 `NORM_SQL` / `normCaliberName`，
   含 `chr(160)` 处理——Postgres 的 `[[:space:]]` 不含 U+00A0，不处理会漏掉尾部带 tab 的品名）。
   **写任何按商品名 JOIN 的新代码前，先确认两侧语种一致。**
   还没修、优先级较低的三处：`ops-data-query.ts:32`（经营问答 ILIKE 中文恒 0 行）、
   `use-review.ts:134`（人工录入断货损失恒 0）、财务站 `sql/alias.js`（7 款改名后的品缺中文名）。

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
| 2026-07-25 | Claude Code | 修复 POS 改名引发的 6 处静默失效：饮品误报断货、预测复盘实卖恒 0、排产报废告警不触发、水吧营业额恒 RM0、预估单预计销售恒 0、AI 加产指令被误报污染；拆掉两处 daily_sales_record 整表删除 |
| 2026-07-25 | Claude Code | 建立交接机制（本文件 + AGENTS.md 第 0 节）；审查并重写数据库治理方案 v2 |
| 2026-07-21 | 未记录 | `refactor/architecture-review` 分支两个提交：复盘拒绝陈旧输入；之后留下 165 行未提交改动 |
| 2026-07-06 | 未记录 | 核心指标表补全实收/水吧的上周同天+变化 |
