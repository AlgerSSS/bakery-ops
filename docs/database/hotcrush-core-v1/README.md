# HOT CRUSH Core V1 — R6 最小物理基座评审包

> 这是设计评审资产，不是执行授权。当前没有修改生产库、没有生成生产迁移、没有改变四个项目的读写代码。
> 41 个 Phase1 视图只是设计候选；其中 10 个 PASS_SELECT_SPEC 仅表示 SELECT 规格足够，不表示已经创建或运行验证；当前已创建并验证的 SQL view = 0。

## 推荐阅读顺序

1. `HOTCRUSH-Core-V1-R6-最小物理基座评审稿.html`：可搜索的整合评审页面；逐表、逐字段和实施层级在同一页面。
2. `diagrams/HOTCRUSH-Core-V1-R6-最小物理基座蓝图.drawio`：61页可编辑总图、业务域关系图和15条链路。
3. `diagrams/HOTCRUSH-Core-V1-R6-最小物理基座蓝图-总览.png` / `...-会员订单.png` / `...-采购订单.png` / `...-派生成本.png` / `...-完整61页.pdf` / `...-网页交互版.html`：高清评审与交互版本。
4. `00-review-baseline.md`：本轮数据库快照、代码扫描、Git HEAD 和脏工作区边界。
5. `01-current-database-audit.md`：当前事实、推测、待验证与 97 个对象目录。
6. `02-target-database-blueprint.md`：目标原则、身份脊柱、项目边界和 15 条链路。
7. `03-table-and-field-dictionary.md`：137 表 + 59 视图逐字段解释。
8. `04-current-to-target-matrix.md`：76 表 + 21 视图全部去向、回填和兼容规则。
9. `05-project-compatibility-matrix.md`：BakeryOps、RES/POS、财务网站、HBTI 的访问核查清单。
10. `06-first-principles-decision-review.md`：错误前提、合理/不合理之处、Claude意见取舍和批准门禁。
11. `08-r6-minimal-physical-foundation.md`：解释R5为何错误、首期 100 张如何得出，以及154个原对象的合并/派生/删除/扩展/延后结论。
12. `09-implementation-guardrails-and-security.md`：现库索引/约束/触发器/RLS逐项承接，以及137张潜在物理表的实施门禁。
13. `r5-to-r6-disposition.csv`：原154个对象逐项唯一去向，并严格区分Claude原判与最终覆盖。
14. `evidence/p0c-source-fidelity-and-reward-2026-08-10.md`：当前、生成式且明确非独立的来源保真/奖励履约证据；它取代旧final acceptance作为当前入口。
15. `11-r6a1-physical-storage-reaudit.md`：按最小事实原则重审 R6A1 的物理存储必要性；仍是设计输入，不是执行授权。
16. `12-fabric-agent-platform-target-architecture.md`：结合 2026-08-16 生产库、空 Green、Fabric 与 DeepSeek Harness 的目标分层、Agent 表、同步方式和蓝绿迁移门禁；仍是设计草案，不会创建 Fabric 资产或修改数据库。
17. `../../agent-platform/hotcrush-deepseek-harness-blueprint.md`：基于 HOT 当前 15 个 Skill、渠道、权限、审计与后台任务的 Harness 专项设计；明确 Supabase 保留、Fabric 非依赖，以及 Query/Draft/Command/Worker 的迁移边界。

## 可机器核对的数据

- `current-object-catalog.csv` / `current-field-dictionary.csv`
- `target-table-catalog.csv` / `target-field-dictionary.csv`
- `target-view-catalog.csv`（59个视图的实施层级、准备度、稳定阻断码、粒度键、直接血缘与物理基表闭包）
- `target-comments-contract.sql`（全部目标表、视图及字段的 COMMENT 契约；设计稿，不会自动执行）
- `target-storage-necessity-audit.csv`（每张目标表的最小粒度、可派生性、物理存储理由和Claude对照）
- `r5-to-r6-disposition.csv`（原154个候选对象的R6唯一处置）
- `current-to-target-matrix.csv` / `current-field-to-target-matrix.csv` / `project-compatibility-matrix.csv`（现有对象及每个现有字段均有非静默去向）
- `current-guardrail-to-target-matrix.csv`（现库约束、索引、触发器、RLS逐项去向）
- `target-table-implementation-guardrails.csv`（每张目标表的FK索引、RLS、冻结与特殊约束要求）
- `target-model.json`
- `evidence/current-schema-snapshot.json` / `evidence/code-access-snapshot.json` / `evidence/review-baseline.json`
- `evidence/p0c-source-fidelity-and-reward-2026-08-10.md`（当前superseding证据；包含只读source_ref查询/hash、471路由、HBTI锚点、10项奖励fixture hash与Butterfly DRIFT）
- `evidence/claude-fable-5-r6-minimal-foundation.md`（Claude只读独立审计原始输出及最终方案分歧说明）

## 生成与校验

```bash
python3 docs/database/hotcrush-core-v1/tools/generate-review-artifacts.py
python3 docs/database/hotcrush-core-v1/tools/generate-drawio-blueprint.py
python3 docs/database/hotcrush-core-v1/tools/validate-review-package.py
python3 docs/database/hotcrush-core-v1/tools/hash-review-package.py
```

当前生成模型：首期 100 张物理表（81业务 + 19平台侧车）；完整目录 137 张潜在物理契约、59 个视图设计契约（Phase1候选41 / 扩展13 / 来源条件5）、2455 个逐字段说明、420 个外键；Phase1需 224 个未被PK/UQ前缀覆盖的支持索引。

任何模型调整都应修改 `model/` 后重新生成，禁止只手改某一份文档或图片。
确定性哈希只覆盖声明式模型、生成工具、冻结证据、生成文本契约和 Draw.io 源文件；PNG/PDF/网页交互版因第三方导出元数据单独验收，具体边界见 `09-implementation-guardrails-and-security.md`。
