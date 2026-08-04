# HOT CRUSH 数据库与代码连接图

用 [drawio-skill](https://github.com/Agents365-ai/drawio-skill) 生成。数据取自 2026-08-04 的生产库
（`pg_dump --schema-only` + `pg_constraint` / `pg_depend` 实测），不是手画的示意图。

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
