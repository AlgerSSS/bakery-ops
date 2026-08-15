# HOT CRUSH 数据库与代码连接图

用 [drawio-skill](https://github.com/Agents365-ai/drawio-skill) 生成。数据取自 2026-08-04 的生产库
（`pg_dump --schema-only` + `pg_constraint` / `pg_depend` 实测），不是手画的示意图。

## 未来数据库蓝图（目标结构，尚未实施）

`HOTCRUSH未来数据库蓝图.drawio` 是 5 页可编辑目标蓝图，基于 2026-08-05 完成的生产库与
业务来源只读审核，把老板关于预估单、班表、关键岗位、供应链、成本卡、产品 ID 和当日毛利的
建议落成可执行结构。完整决策依据见 `HOTCRUSH未来数据库蓝图说明.md`。

| 页 | 内容 |
|---|---|
| 01 老板视角总览 | 明日计划、关键岗位、订货、销售与毛利如何形成同一事实链 |
| 02 营运 | 节假日/突发 → 预测 → 预估单版本 → 实际发出 → 销售/报废 → 复盘 |
| 03 供应链与成本 | 发布计划 → 配方 → 原料需求 → 订货版本 → 收货实价 → 成本快照 → 毛利 |
| 04 人事与班表 | 应聘评分 → 雇佣 → 培训资格 → 关键岗位班表 → 实际工时 → 人效 |
| 05 身份与治理 | `store_id` / `product_id` / `employment_id` / `material_id`、人工输入边界与写者治理 |

交付格式包括多页 `.drawio`、逐页 PNG/SVG、多页 PDF 和可搜索的单文件 HTML。生成脚本是
`build_future_blueprint.py`；它使用 drawio-skill 的 Graphviz 自动布局和结构校验流程。

### 未来数据库物理 ERD（表、关键列、外键与视图血缘）

`HOTCRUSH未来数据库物理ERD.drawio` 在上面 5 页业务蓝图基础上进一步展开为 11 页物理 ERD，
完整覆盖 **73 张未来核心表、16 个关键只读视图**。每张表标明业务粒度、关键 PK/FK/UQ、写入者和
`EXISTING / UPGRADE / NEW / CONDITIONAL` 状态；跨页 `REF` 卡可点击跳转。

成本计算与财务核对被分成独立页面：前者负责配方、采购价、成本快照和当日产品毛利，后者只做
POS、SCM、HR 与现有财务事实的四条只读核对链。四张 POS 订单级表只有来源存在稳定 ID 时才启用。

完整对象清单、人工与自动录入边界、黑巧 / 草莓塔端到端示例和三项数据质量门禁见
`HOTCRUSH未来数据库物理ERD说明.md`。交付包括 `.drawio`、单文件 HTML、11 页 PDF、逐页 PNG/SVG；
生成脚本为 `build_future_physical_erd.py`。

> 这里的“未来蓝图”与下面的“生产库现状全图”用途不同。前者是目标模型，不能当作已经存在的表；
> 后者是 2026-08-04 实测现状。

## 源文件

`HOTCRUSH数据库全图.drawio` —— 10 页，用 draw.io 打开可编辑。每页另有同名 PNG 与 SVG。
**大图建议看 SVG**（可无损缩放），PNG 用于快速预览。

| 页 | 内容 |
|---|---|
| 01 外键总览 | 全库 42 条外键，只画参与外键的 34 张表（不带字段） |
| 02–08 各域 ER | 一域一页，**每张表列出全部字段**：`◆` 是主键，虚线框是视图，边上标的是外键列名 |
| 09 代码 → 数据域 | 5 个代码库分别读/写哪些数据域，边上是表数量 |
| 10 代码 → 每张表 | 同上的明细版，一张表一个节点 |

## 图例

- **实线框** = 表，**虚线框 + ▷** = 视图（不占存储，查询时现算）
- 颜色按域：销售运营 / 会员与活动 / 成本卡·供应链 / 财务 / 人事与排班 / 商品与门店 / 平台设施
- 表名后的数字是实测行数（`count(*)`，不是 `reltuples` 估算）

## 两页比例偏长，是数据本身的形状

- **05 财务**：18 张表**零外键**，dot 只能把它们排成一行
- **10 代码 → 每张表**：5 个仓库扇出到 84 个对象，天然是又高又窄的二部图

两页看 SVG 或在 draw.io 里缩放即可。

## 重新生成

```bash
# 1. 导出当前 schema
pg_dump "$DATABASE_URL" --schema-only --schema=public --no-owner --no-acl -f schema.sql
# 2. 拉元数据（外键 / 视图依赖 / 行数）→ dbmeta.json
# 3. node mkgraph.js  → 各页的 graph JSON
# 4. python3 autolayout.py <graph.json> -o <page>.drawio   # 需要 graphviz
# 5. 合并 <diagram> 元素成多页 mxfile
# 6. drawio -x -f png|svg -p <N> -o out.png all.drawio     # 需要 draw.io desktop
```

⚠️ `sqlerd.py` 对本库不适用：pg_dump 把外键放在独立的 `ALTER TABLE ... ADD CONSTRAINT` 里，
而它只解析内联 `REFERENCES`，直接跑会得到 0 条边。边是从 `pg_constraint` 取的。

⚠️ `autolayout.py` 的节点默认 120×60，多行标签必然溢出重叠。必须按标签内容算 `width`/`height`
（中日韩字符按 2 个字宽算）再传进去。
