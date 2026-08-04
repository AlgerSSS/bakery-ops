# 交接（HANDOFF）

> **开工第一件事：读本文件。收工最后一件事：更新本文件。**
> 这是唯一的交接凭证——不要让下一个 agent 去翻你的对话记录，也不要假设别人记得你做过什么。
> 规则见 [AGENTS.md](AGENTS.md) 第 0 节。

---

## HBTI 上线加固已合入 main（2026-08-04，Codex，已推送，未部署）

全量门禁在本机通过：`npx tsc --noEmit`、`npx eslint .`（0 error / 0 warning）、
`npx vitest run`（29 文件 287 用例全过，含真库集成）、`npx next build`、
`npx playwright test`（42 条 e2e 全过）。集成用例需要一次性 Postgres：
`docker run --rm --name hbti-test-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hbti_test -p 127.0.0.1:55432:5432 postgres:17-alpine`，
再按 059/060/063/066（财务站 `sql/`）+ 077/078/101（`bakery-ops/src/modules/data/migrations/`）
顺序灌一遍 schema，跑测试时带 `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/hbti_test DATABASE_SSL=disable`。

本轮改了什么：

- **Postgres 连接**：Vercel 上强制 `:6543` 事务池 + 已核验的池主机名，`ssl: "verify-full"`。
  之前是 `ssl: "require"`——postgres.js 3.4.9 在该模式下 `rejectUnauthorized = false`，
  等于加密但不验证证书，中间人可冒充库。回归见 `tests/postgres-tls-config.test.ts`。
- **发码限流**：手机号「每日 5 次」额度只在分钟桶与 IP 桶都放行后才自增。
  修复前，攻击者用同一号码在一分钟内狂点就能把受害者当天的 OTP 配额耗光。
- **客户端 IP 信任**：只在 `VERCEL=1` 时信任 `x-forwarded-for` 最后一跳，`x-real-ip` 一律不认，
  其余环境落固定兜底桶——避免伪造头轮换出无限桶。
- **告警出口**：`ALERT_WEBHOOK` 现在必须是不带用户名/口令的 HTTPS URL，否则视为未配置，
  `/api/health` 返回 503 挡住发券批次。review 告警在 Cron 侧并行发送、失败保持 `pending` 可重试，
  历史四字段 review 行会被就地补齐 `attemptId/baselineCouponIds/rewardContext` 再发。
- **RES 请求超时**：`ResApiClient` 接受路由级 `AbortSignal`，与 `maxDuration` 对齐
  （complete 24s / status 20s / cron 40s），不再出现路由已返回、RES 调用还在跑的悬挂写。
- **JSON 入参**：四个变更路由对畸形 JSON 统一返回 400 `INVALID_REQUEST`，不再落成 503。
- **邀请链接彻底下线**：删除 `src/lib/member-link/{crypto,schema}.ts` 与其测试；
  `/api/session` 保留 410 存根（老链接仍会被点开），脚本改名
  `scripts/create-member-link.mjs` → `scripts/print-hbti-urls.mjs`（只印 `/` 与 `/demo`）。
  测试里 `HBTI_LINK_SECRET`、`HBTI_MEMBER_HASH_SECRET` 的桩已清干净。

已确认的线上事实：

- **推送不会触发部署**。`vercel project inspect hotcrush-hbti` 没有 Git 连接，最新生产部署
  是 4 小时前的 `hotcrush-hbti-5gclm5rpc`（CLI 手动）。推 main 之后线上 `/api/health` 仍返回
  200 且**响应里没有 `alert` 字段**——加固版一定带这个字段，所以线上跑的还是旧包，
  `ALERT_WEBHOOK` 的 503 门禁尚未生效。
- **三个退休变量已从 Vercel 生产删除**（本轮执行）：`HBTI_LINK_SECRET`、
  `HBTI_LINK_TTL_SECONDS`、`HBTI_MEMBER_HASH_SECRET`。删前确认 hot 仓库、财务站、
  Contabo `/opt/hotcrush` 均无读者。生产现存 HBTI_* 只剩 `HBTI_AUTH_SECRET`、
  `HBTI_LINK_BASE_URL`、`HBTI_CAMPAIGN_VERSION`。

**告警通道盘点（找过了，没有现成的）**：`/opt/hotcrush/*/.env` 里 `ALERT_WEBHOOK=` 是空的，
服务器上不存在任何 `open-apis/bot/v2/hook` 地址。唯一在用的 Lark 投递是**应用 API**
（`scripts/recruit_*.py` → `/im/v1/messages`，凭据在 Contabo `/opt/hotcrush/scripts/lark_app.json`，
600 权限，只发 4 个个人 open_id，没有群 chat_id）。复用它得把 app_secret 放进 Vercel 或另建中转，
都不如给一个群机器人 hook。

顺带修掉一个会「静默成功」的坑：四个告警发送点原本都发 `{"text":…}`（Slack 形状），
而飞书/Lark 群机器人**不吃这个形状**——它照样回 HTTP 200，只把错误号放在包体 `code` 里。
现在 `hbti-web/src/lib/alert.ts` 与 `res_api/daily-refresh.sh`、`ops/hbti-token/{run,keepalive}.sh`
都按目的地选形状（URL 含 `/open-apis/bot/v2/hook/` 就发 `{"msg_type":"text","content":{"text":…}}`），
并且都核对回执：hbti-web 只有 `code === 0` 才算 sent、读不出回执按失败让 Cron 重试；
三个 shell 读不到 `"code":0` 就往 `LAST_FAILURE` / `KEEPALIVE_LAST_BAD` 追加一行
「告警未送达 + 原始回执」，不再 `>/dev/null || true` 一扔了事。

同一处还修了个 locale 炸弹：`exit=$CODE，日志` 里 `$CODE` 紧贴中文逗号，**UTF-8 locale 下**
bash 会把逗号首字节吃进变量名，配 `set -u` 就是在告警那一步直接崩掉（服务器 cron 没有 LANG、
跑在 C locale 下才一直没暴露；人手在 SSH 里跑就会炸）。已改成 `${CODE}` / `${LOG}`。
本地用假 Lark 端点实跑过三个脚本的告警片段：`code:0` 静默通过，`code:19024` 落哨兵行。

**告警目的地已经打通并人工验收（2026-08-04）**。没有等群机器人：这台服务器上本来就有
一条在用的 Lark 应用 API 通道（招聘早报天天在发），于是加了个中转把 webhook 翻译过去。

- 服务：`/opt/hotcrush/alert-relay/server.mjs` + systemd `hotcrush-alert-relay`，
  只听 `127.0.0.1:8791`；仓库副本在 `ops/alert-relay/`（含 README 与 unit 文件）。
- 入口：Caddy 在既有的 `gw.hotcrush.net` 上加了 `handle_path /hbti-alert/*`。
  改前备份了 Caddyfile，`caddy validate` 通过，reload 后确认 AI 网关根路径仍 200。
- 凭据：URL 路径里的随机段（`/opt/hotcrush/alert-relay/.env` 的 `ALERT_PATH_TOKEN`）。
  **完整 URL 不入库**。收件人 `ALERT_OPEN_IDS` 当前只有本人，要加人从
  `/opt/hotcrush/scripts/lark_app.json` 的 recipients 取 open_id。
- 四处都已配好并各发过一条 canary，**用户在 Lark 里逐条确认收到**：
  hbti-web 形状、POS 每晚刷新、令牌轮换、令牌保温。后三条是直接抽**线上脚本原文**
  的告警段执行的，不是仿写；中转日志的「已送达」计数增量对得上。
- 三个脚本已 scp 到位，线上与仓库 md5 一致（`daily-refresh.sh 72470585`、
  `run.sh 5a65f33d`、`keepalive.sh c2d01f8a`）。`ALERT_WEBHOOK` 也已写进 Vercel 生产，
  **但要下一次部署才会生效**——hbti-web 目前线上仍是旧包。
- 判定规则四处一致：HTTP 2xx 才算送到；Lark 群机器人另外要包体 `code:0`。
  中转拒收时回 502，脚本会往 LAST_FAILURE / KEEPALIVE_LAST_BAD 记「告警未送达 + 回执」。
  五种结局都实测过：Lark code:0 / code:19024 / 中转 200 / 中转 502 / 端口不通(http=000)。

以后要换成群机器人：把 hook URL 直接填进那四处 `ALERT_WEBHOOK` 即可，中转可停用——
四个发送点本来就认 Lark 形状。

**上线前复检又挡下两个会直接打挂线上的东西（2026-08-04，均已修）**：

1. **池主机名钉错了**。`postgres.ts` 里写死的是 `aws-0-ap-southeast-1.pooler.supabase.com`，
   那字符串只出现在我自己写的测试夹具里；共享库 `ecsgqcmwtjmcpzqytdqw` 的真实池主机是
   **`aws-1-us-east-1.pooler.supabase.com`**（res_api 与 bakery-ops 的 `.env` 都连它）。
   按原样部署 = 每次取连接都抛异常。改成校验域名后缀 `.pooler.supabase.com` + 端口 6543，
   不再钉死我无法核对的区域。
2. **`ssl: "verify-full"` 对这个库根本连不上**。Supabase 用自签根签发数据库证书
   （链：`*.pooler.supabase.com` ← `Supabase Intermediate 2021 CA` ← `Supabase Root 2021 CA`），
   公共 CA 库里没有它，实测报 `self-signed certificate in certificate chain`。
   退回 `require` 又等于不校验证书（就是本轮要修的洞）。正解是显式带上那张根：
   已内联在 `src/lib/db/supabase-ca.ts`（公开证书，可入库；下载源与握手送来的根 SHA-256
   逐字节一致，2031-04-26 过期，到期前必须换）。实测用 getDb() 的同一套参数打真库
   `select` 成功，且把 servername 改错会被拒——主机名校验确实生效。

   > 内联而不是读 `certs/*.crt`：Vercel 打包不保证带上散文件，读文件会在运行时才炸。

**仍未核实的一项**：Vercel 生产的 `DATABASE_URL` 是只写变量（`vercel env pull` 返回
`[SENSITIVE]`），所以**没人能确认它现在是不是 `:6543`**。新版对端口 fail closed——
若线上填的是 `:5432`，部署后每个请求都会抛。上线前必须二选一：
人工到 Vercel 面板确认 host/port，或者用 res_api/.env 里那套同一个共享库凭据
把它重设为 `…@aws-1-us-east-1.pooler.supabase.com:6543/postgres`（该组合已实测可连）。

下一步（尚未做，需要人):

1. **RES 持久凭证——原样卡着，本轮没有进展，别被下面这条探测误导**。
   `RES_VULCAN_TOKEN` **不是服务凭证**，是从 BO 浏览器会话里借出来的令牌
   （见 `ops/hbti-token/rotate.mjs` 开头注释与第 81–92 行「借 BO 会话里的 vulcan-token」），
   靠 keepalive 每 30 分钟保温、run.sh 每 6 小时重借。
   本轮顺手探过一次：拿它打 `POST /api/report/data/queryData`（report 211，只读）返回
   **HTTP 401 `未授权`**。这**只**说明这枚借来的令牌连报表都读不了，
   **不能**据此推出「RES 有一套受限服务令牌机制、只差报表作用域」——那是两回事，
   报表作用域跟 HBTI 用的会员查询/券模板/发券/回读也没有关系。
   诉求仍然是原来那句：**请 RES 为 HBTI 的那几个接口发一枚长期有效的受限凭证**
   （按手机号查会员、按名称查券模板、发一张券、回读券列表；corporation 450020844 /
   shop 406994127）。在拿到之前，轮换 + 保温这套**不能删**，它是目前唯一让线上
   `res: ok` 的东西。
2. 部署仍是显式动作：`hbti-web` 走 `npx vercel --prod`（`deploy.sh` 只部署 bakery-ops/res_api）。
   现在 `ALERT_WEBHOOK` 已配，部署后 `/api/health` 应当返回 200 且 `alert: ok`。

---

## Codex 已复核 Kimi、Claude 架构图和 Lark 实际工时表（2026-08-03，未提交）

用户澄清：需要的不是“加班表”，也不是预排班 Excel，而是 Lark 上的月度**实际工时**在线表；
每天填写、每天读取，记录某员工在哪天实际上班及实际工作时长。用户已确认这是实际工时来源，
并提供了后厨与前场两本 Lark Sheets。

本轮只读复核了 Kimi §10、Claude《HOT CRUSH 星型模型目标结构图》、四个数据库消费者、
现有 RES 账单探针、生产预估单模板/生成代码、员工/`staff`/财务人工成本结构及导入链路。
两本 Lark 表均通过 bot 只读访问，没有写入：按月分 sheet，第 5 行字段为 No./Name/Position、
1–31 日、Total Actual Hours、Required Hours、Variance、Leave/Exception Notes；每日单元格同时存在
数字、空白、0 和 OFF/假期等文本。两表都没有稳定 Employee ID 和 Store Code；前场样例中的
Required Hours 还出现与表头公式口径不一致的手填数，因此合计列只能作为校验，不能直接当事实。

在 `docs/star-schema-plan.md` 末尾新增“## 十一、Codex 对 Kimi 版本的逐条复核与落地建议”
（§11.1–11.8，共 184 行），并在 §11.8 逐项复核 Claude 架构图。
Claude、此前 Codex、Kimi 的原有 689 行没有改动；追加前文件 SHA-256 为
`2578d6f544bc6073f9f8b0b9547800bf4b6c63ed19e95051a5bf8a3f1552e45e`，追加后重新计算
前 689 行 hash 相同。所有新增意见均以加粗 `（Codex 意见：…）` 或
`（Codex 意见—主题：…）` 标注。

本轮收敛的关键结论：

- 推荐“单库 + public 域前缀 + 分域单写 + 精简核心 v2 + mart 后置”，不直接执行 Claude/Kimi 原迁移表。
- Lark 实际工时落 `hr_timesheet_sync_batch` + `hr_timesheet_entry`，引用稳定
  `hr_employment_id`；当前唯一粒度为雇佣关系×门店×日期×工作区域/来源流，避免同一员工
  同日在前场、后厨两本表出现时相互覆盖；`staff` 仅用于同步/批准操作人。未来若有预排班，再独立建
  `ops_shift_plan/_assignment`，实际工时、计划排班、OT、工资与财务人工成本不混用。
- 生产预估单的计划量与“实际出货”是不同字段；confirmed/published 只表示获批计划。
  只有实际出货明确填写才产生 `ops_production_output/_line`，且实际出货仍不自动等同实际烘烤。
- Kimi 的 26,683 行不是稳定账单，而是 `businessDate+openedTime` 时间桶；样本实际含
  26,741 单、57 个桶多单。目标仍为 order + order_item + payment + refund，先验证 report 211。
- `finance_labor_detail` 只有人工成本金额，没有员工或工时；Kimi 的“月工时互校”不成立。
- `cost_card_product_link` 已存在，不能重建同名表；“成本只能连 2.6%”也已过时。
- 最小运行权限建议拆为 migrator、RES、Bakery Ops、HBTI、Finance、readonly 六个表级身份。
- Claude 架构图可保留为分析层初稿，但“运营核心不重构、第二家店才加 store_key、固定 4 维
  9 事实、只画销售/会员两颗星”不适合作为企业终态；v3 应先画来源批次、身份映射、规范化核心、
  生产/工时闭环和权限边界，再把各主题 mart 作为下游投影。

本轮没有修改应用代码、没有执行数据库 DDL/DML、没有部署，也没有提交。当前工作区仍有
HBTI 的其他未提交改动，`docs/star-schema-plan.md` 仍是未跟踪文件；不要运行 `deploy.sh`。
下一步应先由用户审阅 §11。实施前仍需补稳定 Employee ID（或经人工确认的身份映射）、确认
每日数字工时是否已经扣除表头所写的 1 小时休息，以及确认预估单“实际出货”日常何时填写；
随后另写 v3 物理模型和迁移清单，不能把本轮文档批注视为已部署。

---

## Kimi 对星型方案的评审已追加（2026-08-03，Kimi，文档批注，未提交）

用户要求在 `docs/star-schema-plan.md` 的 Codex 批注之后追加 Kimi 的建议，出发点是
「数据量小、允许大改，目标模型要符合业务」。已新增文档末尾「## 十、Kimi 的建议」一节
（§10.1–10.6）。写之前独立复查了四个数据库使用方（res_api / bakery-ops / hbti-web /
财务站，财务站在 iCloud 路径 `…/雅楠需求/门店财务AI分析系统`，只读），并参考了
`~/Desktop/04-数据库理想终态蓝图-大重构版.md`（0727 实测修订版）。

核心结论：Claude 方案作为止血清单 8/10、作为目标模型 3/10；两份文档共同的最大盲区是
**排产计划与实际生产零落库**（`plan-generator.ts` 纯函数无 INSERT，sell-through 分母不存在）。
主要新主张：① 销售事实按账单级建模（`scrape-order-analysis.mjs` 已实测可抓 26,683 行/30 天，
从未入库），订单行级列为待验证；② 角色拆 3 个就够（站 0727 方案，不同意 Codex 的 per-app
角色）；③ 批 A 止血单独放行，不等业务模型审批；④ 迁移治理用 0727 方案的 advisory lock
20 行解法，而非「从 102 起」；⑤ 目标三层模型（pos_ingest_batch 来源层 → 含
`ops_production_plan/_actual` 的规范化核心层 → 数量不预设的 mart_ 视图层）；⑥ 利用
「数据少可重抓回填」红利，核心事实重建回填优于兼容视图体操。

新发现的事实性更正（批注里已写）：HBTI 是 12 列不是 8 列、13 题原始答案完全不落库、
礼品库存纯计数器无流水；dining 日数据是 30 天总比摊到每天的伪造精度；单品折扣抓了没存、
退款只进 CSV；SCM/MKT 域表已死（真实流程在 WMS/金山文档）。

**用户已拍板（同日，已写进 §10.3/10.4/10.6-1）**：生产数据来源 = 用户每日上传生产预估单
Excel，上传即产生 `excel_upload` 来源的 `ops_production_plan` 版本，**confirmed 版本即实际
生产记录，不另建 actual 表**；终态等预测模型准了之后改由 `ops_forecast_run` 自动生成
（`source='forecast_auto'`，上传降级为人工修正入口），所以 source/status 两列必须第一天就在。
另新增需求：**班表也由用户每日上传 Excel**，落 `hr_shift_schedule`（店×日×员工×班次，
关联 `staff`，带 batch_id），用于人效分析并与 `finance_labor_detail` 月工时互相校验。
待实施时确认：两份 Excel 的模板列、同日重复上传的覆盖语义（建议同日常态覆盖、跨天只读）。
⚠ §10.6 决策点 2–5（账单级抓取入每晚链路、store_id 现在建、财务月结 closed、三方案归一）
仍待用户拍板。

本次只改了 `docs/star-schema-plan.md`（未跟踪文件）和本文件，未提交、未动代码、未碰数据库。
下一步：用户审阅三方意见并拍板 §10.6 剩余决策点后，建议合并出一份 v3 目标模型文档，
三份旧方案归档；执行前仍需先做 0727 方案 4.1 的迁移治理六条（至今未执行）。

---

## Claude 星型方案逐项批注（2026-08-03，Codex，只读审计后文档批注）

用户要求在 Claude 的原方案上逐条加入 Codex 建议。已保留
`docs/star-schema-plan.md` 的 Claude 原文，并新增 **110 处**加粗的
`（Codex 的建议：…）` / 逐项批注，覆盖：总体判断、四个数据库消费者、七条兼容契约、
Phase 0 的每个迁移、4 个维度、9 个事实/指标对象、消费者切换、“不做”边界和 D1–D5 时间线。

批注的总判断：本文适合作为止血修复和迁移风险附录，不适合作为允许大改后的全业务目标模型；
保留一个 PostgreSQL 和分析层星型思路，但必须先建立门店、企业商品/SKU、来源身份、采集批次及
规范化业务核心层。原定迁移 102/105、Phase 1–3 和 D1–D5 均标为暂停或重写。

本次没有修改应用代码、没有执行数据库 DDL/DML、没有部署。`docs/star-schema-plan.md` 原本及现在
均为未跟踪文件；本节 HANDOFF 修改也未提交，因为用户只要求文档批注、没有要求提交。
当前 HBTI 代码和 `hbti-web/src/lib/alert.ts` 的既有未提交改动不属于本次工作，未改动或还原。
在这些改动隔离或提交前，**不要运行 `deploy.sh`**。下一步应由用户先审阅批注；若认可，再另写
v3 目标业务模型和新版架构图，不要直接执行原方案迁移。

---

## 迁移 101：给 hbti_gift_stock 补 RLS（2026-08-03，已在生产执行）

077 建 `hbti_gift_stock` 时漏了财务站迁移 059 立的不变量——**共用库 public 下每张普通表
都要启用 RLS**。是财务站的 `db-integration --all` 门禁（`tables_without_rls`）先发现的。

已执行 `bakery-ops/src/modules/data/migrations/101_hbti_gift_stock_rls.sql`：
public 下现在 0 张表未启用 RLS；库存表照常可读（9 行 / 初始 1376 件 / 已发 1 件）。

安全性依据：同为本项目所建的 `hbti_auth_token`、`hbti_rate_limit` 本来就是 `rls=true`
且零策略、一直正常；各项目都以 `postgres` 连库，该角色 `rolbypassrls=true`；
`anon`/`authenticated` 在这张表上本来就没有任何授权。RLS 在这里是「关掉默认敞开」的兜底。

> ⚠️ **两条共用库的规矩，下次建表前先看：**
> 1. **新建表必须 `ENABLE ROW LEVEL SECURITY`**，否则又要靠对方的门禁来发现。
> 2. **号段：财务站 001-099、bakery-ops 100-199、res_api 200-299**
>    （`100_beverage_caliber.sql` 里定的）。077/078 当时越进了财务站号段，已应用不追改；
>    本次回到 101。新建迁移前先 `SELECT max(version) FROM schema_migrations` 确认。


## HBTI 发券 503 定因并修复：RES 令牌是**空闲超时**（2026-08-02/03，已上线）

08-01、08-02 两次发券中断，`/api/health` 503。此前仓库里到处写着「令牌约 24 小时自然失效」，
据此把轮换从 12 小时加密到 6 小时 —— **这个前提是错的，加密轮换只是碰巧塞了个新令牌进去。**

**做了两轮实验（脚本已用完删除，日志留在服务器 `logs/ttl-cohort.log`、`logs/ttl-crossed.log`）：**

实验一：同时借 6 个令牌，5 个各自闲置到不同时长才查一次，1 个每 15 分钟调用。

| 空闲 1h | 空闲 2h | 空闲 4h | 空闲 6h | 空闲 8h | 每 15 分钟调用 |
|---|---|---|---|---|---|
| OK | OK | **401** | **401** | **401** | 8 小时全程 OK |

实验一有个混淆：活跃的那个恰好是**最后**借的，所以「活跃存活」也能解释成
「最新的没被并发会话上限挤掉」。于是做实验二交叉对照，把两个变量拆开（+4.5h 判读）：

| | ACTIVE（每 15 分钟调用） | IDLE（完全不碰） |
|---|---|---|
| **OLD**（先借） | OK | **401（复查确认）** |
| **NEW**（后借） | OK | **401（复查确认）** |

**最旧的令牌只要在用就活着，最新的闲着也死** → 排除「新登录顶掉旧令牌」和「按创建顺序驱逐」。

**结论：RES 会话是空闲超时，不是固定寿命。致死窗口 2~4 小时。**
这解释了为什么两次故障距轮换的间隔对不上任何周期（2h32m 和 7h19m）：
它取决于最后一次 RES 调用的时间，也就是取决于流量。HBTI 流量低，顾客之间隔几小时没人答题，
令牌就闲死了。

**修复：保温，而不是加频轮换。**
`/api/health` 会用生产令牌打一次 RES，所以定时 curl 它就等于替令牌续命 —— 不用部署、
本机不用持有凭证。新增 `ops/hbti-token/keepalive.sh`，cron `7,37 * * * *`（每 30 分钟，
对 2 小时下限有 4 倍余量；用 7/37 分错开整点轮换）。轮换 `0 3,9,15,21` 保留作兜底。

已验收：cron 自己跑过的班次（01:37 / 02:07 / 02:37 UTC）全部 HTTP 200 `{"db":"ok","res":"ok"}`；
失败路径本地实测 exit 1 + 建哨兵、恢复后清哨兵；告警去重实测「连续 3 次失败只发 1 条，
恢复后再失败才再发」。`install-cron.sh` 改成每条目各自守卫（原来单一守卫会因轮换已存在而
整块跳过，保温永远装不上），在「轮换已装、保温未装」的生产实况下实测幂等。

> ⚠️ **告警实际上没有出口。** `ALERT_WEBHOOK` 在服务器 `.env` 里**没配**，轮换和保温都一样：
> 失败只会留下 `logs/LAST_FAILURE` / `logs/KEEPALIVE_LAST_BAD` 哨兵文件，**没有人会被通知**。
> 想要通知就往 `/opt/hotcrush/hbti-token/.env` 填一个 webhook 地址（代码路径已实测可用）。
> 在那之前，这套东西的兜底仍然是「用户报障」。

顺带修正了几处已被实验证伪的注释：`ops/hbti-token/rotate.mjs`、
`hbti-web/scripts/refresh-res-token.mjs`、`run.sh`、`cron.example`，以及服务器 crontab 里
那句「跑在 intraday-refresh 之前的话令牌可能被新会话顶掉」。留着会让下一个人得到两套互相矛盾的
根因，进而可能把保温当成多余的东西删掉。

**根治仍然是向 RES 申请受限服务凭证** —— 保温只是让借来的会话不闲死，凭证本身的性质没变。


## HBTI 页面改版（2026-07-31，已部署 Vercel）

「你是哪种咖啡人」→「货架上的 16 种人」全站文案替换，照抄 hbti-copy-redesign.md：

- 6 道题 prompt + 选项三语替换（★零代码子集，不改计分逻辑）
- 16 型完全重写为面包人格（清醒贝果/碱水战友/深夜巴斯克…）
- 界面 20 个 key 文案替换（「认领我的面包」「出炉！」…）
- 测试同步更新文案断言，180/180 全绿

部署：origin main = 26d9c47，Vercel = hotcrush-hbti-dbilrrdb3。

## 六组表合并（2026-07-31，配合财务库迁移 067-074）

 bakery-ops / res_api 侧代码已同步并部署 Contabo（origin main = f4375be）：
 - `product_strategy`/`product_sales_baseline`/`fixed_shipment_schedule` 成为 `product` 的列；
   策略导入唯一写路径 `importStrategies`（API 上传与 data 目录自动导入共用）；
   **产品 Excel 导入从 DELETE+INSERT 改为 upsert**（整表 DELETE 会抹掉合并进列的配置）。
 - `item_alias`/`item_category` → `pos_product`（中文名 `COALESCE(name_zh_display, name_zh)`，
   分类 `COALESCE(category_display, category_en, category_zh)`）。
 - `daily_sales_record`/`timeslot_sales_record` 变视图：sync-to-db 九步变七步，
   两个写入步删除，时段 Excel 导入不再落库；测试有 neverWriteViews 守卫。
 - `daily_payment_breakdown`/`daily_dining_breakdown` → `daily_breakdown(dim_type, dim_value)`，
   读侧 SQL 别名保持下游列名不变。
 - `manager_review` → `daily_review.manager_text/manager_insight`；`review_json`/`suggestions_json`
   转 jsonb，读侧 `asJson` 兼容 text 与对象两种形态。
 - `ops_user`+`team_member` → `staff`：user.repository 限定 `phone IS NOT NULL`，
   team.repository 限定 `lark_open_id IS NOT NULL`（setAllInactive 不会误停 WhatsApp 员工），
   `TeamMemberRow` 接口用 SQL 别名保持不变。3 个 WhatsApp 员工的 lark_open_id 待人工关联。
 - 顺带修复：设置页 product_config 标签一直在查不存在的表，已改读写 `product`。
 - 删除 backfill-daily-sales.js（目标表已变视图）。

 门禁：tsc 0 + vitest 503/503 + next build 通过；res_api 119/119。
 明早看一眼今晚 23:00 新管线第一跑：daily_breakdown 应有当晚 payment/dining 行。

## 当前状态

> ✅ **HBTI 已收进会员表（2026-07-31，迁移 066）。** `hbti_completion` 的内容成为
> `pos_member` 上的列，幂等键从 HMAC(手机号) 换成 **member_id**（顺带堵掉换号可重复领券的洞）。
> `hbti_auth_challenge` + `hbti_auth_session` 合并为 `hbti_auth_token`。**4 张 → 2 张。**
> 剩下的 `hbti_auth_token` / `hbti_rate_limit` **不是会员数据**：发码时还不知道是谁、
> 一个会员可持多个会话、限流桶有一半按 IP 分——所以没有跟着进会员表。
> `HBTI_MEMBER_HASH_SECRET` 已无读者，从 server-config 与 .env.example 摘除
> （Vercel 上那条变量可以删了）。
> 线上 `hotcrush-hbti-9ua71sr8g`，health 200，四仓库门禁全绿。


> ✅ **产品身份重构已上线（2026-07-31，迁移 064/065）。**
> `res_api/sync-to-db.js` 过去拿到 RES 的稳定商品键后翻译成显示名就丢弃，导致
> POS 销售能连回成本卡的只有 **2.6%**。现在保留键并写入 `item_key`，覆盖率 **95.3%**
> （可算成本 92.5%）。新建 `pos_product` 作为全库唯一商品身份权威（211 条，158 条已建卡）。
> **新代码请用 `item_key` 关联，不要再按名字 JOIN。**
>
> 顺带修掉一个丢数据 bug：按 `date|hour|显示名` 去重，而有 3 组不同商品共用同一显示名，
> 第二个商品的销量被静默丢弃。已改按稳定键去重。
>
> ⚠️ **今晚 23:00 是第一次带 `item_key` 的自动运行**（已 rsync 到 Contabo）。
> 明早确认 `select count(*) filter (where item_key is null) from item_hourly_sales where date=当日`
> 应接近 0（只剩 3 组重名 + 新品）。
>
> 目录同步：`node --env-file=.env sync-catalog.mjs`（尚未接进 run-refresh.mjs 的每日步骤，
> 目前需要手工跑；RES 上新品或改价后应重跑）。

| | |
|---|---|
| 最后更新 | 2026-07-31 by Claude Code（Postgres 迁移侧） |
| 当前分支 | `codex/hbti-launch-ready`（领先 origin/main 7 个提交，**未 push**） |
| 工作区 | 干净 |
| 线上（Vercel） | `hbti-test.hotcrush.net` = `hotcrush-hbti-d67rzzup9`（**Postgres 版，已彻底摘除 Mongo**），`/api/health` 200 |
| 线上（Contabo） | res_api + bakery-ops 已于 2026-07-31 重新 rsync，`hotcrush-core` active，role=all |

> ✅ **HBTI 切库已全部完成并上线，MongoDB 已彻底摘除（2026-07-31 16:3x）。**
> 拆除前审计过 Mongo 剩余内容：`completions` 1 条（已迁移且哈希与 `hbti_completion` 一致）、
> `auth_rate_limits` 2 条（分钟级失效的限流窗口计数）、其余集合皆空——没有任何还有价值的数据。
> 已删除：Vercel 的 `MONGODB_URI`、`mongodb` devDependency、一次性迁移脚本。
> **删除后重新部署并验收，`/api/health` 仍为 200** ——这一步是有意为之：`MONGODB_URI` 已不存在，
> 如果还有任何代码路径依赖它，这次部署就会暴露。
>
> ⚠️ 连接串仍保留在**未跟踪的 `hbti-web/.env.local`** 里，这是刻意的：删掉我们最后一份副本
> 并不会删除 Atlas 上的顾客数据，只会让我们再也够不到它。**等 Atlas 上的库真正销毁之后，
> 再把 `.env.local` 里那一行删掉。**

---

## HBTI 切库：四步已全部执行（2026-07-31）

1. **迁移 063 已执行** —— `schema_migrations` 62 → 63，public 表 105 → 109，
   `pos_member` 26 → 34 列，行数仍 4838。只统计原有 26 列的全表 digest 执行前后完全相同
   （`4ebcc95a3c2f66d0b0d6e2d807db09b3`），**既有数据零变化**。四张新表 RLS 开启、零 policy、匿名零权限。
   `node test/db-integration.js --all` 通过。
   执行时间 KL 16:19，超出文档建议窗口——判断依据与前后对照见财务仓库 HANDOFF「迁移 063 执行记录」。

2. **Vercel 变量已配** —— `DATABASE_URL` 已加到 **Production + Development**。
   Preview 未加：Vercel 要求 preview 变量绑定到具体 git 分支，生产部署用不到。
   `HBTI_MEMBER_STORE` **刻意不设**：已核实 `res_api/.env` 没有覆盖 `MEMBER_STORE`，
   走的是 `sync-member.mjs:24` 的默认值 `吉隆坡Pavilion门店`，而库里 4838 行的 `store` 也全是这个值——
   两侧默认值一致，多设一个变量只会多一个漂移点。

3. **历史幂等记录已搬** —— Mongo 里那 1 条 `issued`（`2026-08-pistachio-v1` /
   `Pistachio Green Jewel`，确认于 2026-07-30 16:29 MYT）已进 `hbti_completion`。
   `member_id` 为空，符合预期：`rewardContext` 只存在于 prepared 态，issued 记录里本来就没有会员 ID，
   手机号又是 HMAC、反查不回来。它的作用是防重复发券，这一点不受影响。
   同键重放实测 0 行受影响，脚本可安全重跑。

4. **已部署** —— `dpl_B5yHQEEENcBZd2ZoStGQcTGprY4R`，已别名到 `hbti-test.hotcrush.net`。

**上线后验收**：`/api/health` 连测三次全 200 —— 这条是决定性证据，因为它执行的是
`SELECT 1 FROM hbti_completion`，**只有 Postgres 版真的上线且连上库才可能返回 200**。
`/`、`/demo` 200；`/api/session` 410（已退役的 token 入口）；`/api/auth/session` 无 cookie 返回
`{"authenticated":false}`；`/api/complete` 空请求体 400。
库内状态：`pos_member` 4838 行、画像 0 条、`snapshot_date` 为空 0 行（还没有顾客完成），
`hbti_completion` 1 条，三张认证/限流表 0 条。

### 还剩一件没做完

- **`/api/cron/reconcile` 没能主动验证。** `CRON_SECRET` 在 Vercel 上是 Sensitive 类型，
  `vercel env pull` 拉回来是空值（设计如此，不是故障），所以本地无法带凭证去打它。
  无凭证访问返回 401，说明鉴权分支是通的。它调用的 `reconcilePendingCompletions` 与 `purgeExpired`
  都已在 `tests/pg-stores.integration.test.ts` 里对真实库验证过，且当前 prepared 记录为 0、无事可做。
  **首次真实运行是每天 19:00 UTC（03:00 MYT）的 Vercel Cron——第二天早上去 Vercel 日志确认一次。**

> **回滚预案**：迁移 063 是纯增量（新表 + 可空新列），所以回滚只需在 Vercel 控制台把
> **上一个 Postgres 版部署**（`hotcrush-hbti-b6iqhi0yi`）Promote 回生产，数据库不用动、不丢数据。
> ⚠️ **不要再回滚到更早的 Mongo 版部署**：`MONGODB_URI` 已从 Vercel 删除，那些构建启动即失败。
> 真要退回 Mongo，得先把连接串（还在 `hbti-web/.env.local`）重新加回 Vercel。

> ✅ **已解决（2026-07-31 15:5x）：`RES_VULCAN_TOKEN` 过期已换新，`/api/health` 从 503 回到 200。**
> 旧令牌是 2026-07-30 16:23 抓的后台会话，对 BO 接口返回 401。
> （当时写的是「约 24 小时后自然失效」——**08-02 实验已证伪**：它是空闲 2~4 小时超时，
> 不是固定寿命。详见本文件顶部那条。）
> 影响面确认过：顾客登录/OTP 走 H5 每请求现取的访客令牌，**不依赖这个后台令牌**，所以登录和答题一直是好的；
> 断的只是提交之后的发券，以及做券模板只读探测的 `/api/health`。
>
> 处置过程中发现旧的换令牌脚本（`/tmp/sync-fresh-res-token-to-vercel.mjs`）**本身有个会挡住修复的 bug**：
> 它断言「抓到的会话头 == 配置的头」，而**刚 `login.js` 完的会话落在集团级作用域**
> （`organization-type=0`、没有 `brand-id`），于是每次重新登录后都会拒绝写入一个完全可用的令牌。
> 这个前提本来就不成立——hbti-web 在 `src/lib/res/client.ts:317-321` 是拿自己 env 里的作用域头发请求的，
> 只有 `vulcan-token` 来自会话。已改写并落进仓库：**`hbti-web/scripts/refresh-res-token.mjs`**
> （只校验租户边界 `corporation-id` + `shop-id`，真正把关交给「用运行时头查券模板」的只读验证，支持 `--dry-run`）。
>
> 手动换令牌三步（**现在通常用不到**：服务器 keepalive.sh 每 30 分钟保温、
> run.sh 每 6 小时兜底轮换。这三步留给两者都失灵时的应急）：
> ```bash
> node ~/hot/res_api/login.js
> cd ~/hot/hbti-web && node --env-file=.env.local scripts/refresh-res-token.mjs
> npx vercel redeploy <当前生产 URL> --scope algersss-projects
> ```
> ⚠ 第三步**必须用 `redeploy`**，不要在 hbti-web 目录跑 `vercel --prod`——那会从本地工作树重新打包，
> 在迁移 063 执行之前会把 Postgres 版推上生产、整站挂掉。`redeploy` 只复用源码重新注入环境变量。
>
> **根治方案仍是向 RES 申请受限服务凭证。**
> （原话是「别再依赖每天要人工续一次、且没有任何告警的后台会话」——前半句已过时：
> 现在服务器每 30 分钟保温、每 6 小时兜底轮换，不需要人工续。后半句仍然成立：
> `ALERT_WEBHOOK` 没配，失败只留哨兵文件，没有主动通知。）

> **2026-07-31 by Claude Code —— 本地视觉预览用的假环境文件正在生效，注意别被它坑到。**
> 新增 `hbti-web/.env.development.local`（gitignored，全部假值）。Next 的加载优先级是
> `.env.development.local` > `.env.local`，所以**只要这个文件还在，`npm run dev` 就跑在假配置上**：
> Mongo 指向没人监听的 `127.0.0.1:27099`，`RES_BASE_URL` / `RES_H5_BASE_URL` 被故意设成通不过
> `server-config.ts` 校验的值，于是发短信、建会员、发券三条路在发出任何网络请求之前就抛错。
> 实测 `/api/health` 返回 503 degraded，dev 启动日志确认 `Environments: .env.development.local, .env.local`。
> **要用真配置调试就先 `rm hbti-web/.env.development.local`。** 未改任何应用代码，未部署。
>
> 顺带处理的两件事：① 杀掉了 Codex 会话遗留的孤儿 dev server（PID 41382，7-30 19:21 起在 3200 端口
> 挂着**真实生产凭证**跑了约 40 小时）；② `rm -rf hbti-web/.next` 清掉 Turbopack 陈旧缓存 ——
> 症状是 `/` 报 `Could not find the module ".../global-error.js#default" in the React Client Manifest`
> 并白屏，清缓存重启即恢复，**是 dev bundler 的已知问题，不是应用 bug**。
> 另：dev 下 console 恒有一条 `eval() is not supported…` 报错，是 React 开发模式撞上应用自设的 CSP，
> 生产不出现，不用管。

### 零之〇、hbti-web 存储层 MongoDB → 共享 Postgres（2026-07-31，代码完成、未部署）

HBTI 原本自带一个 MongoDB，而这门生意里其他所有系统都跑在同一个 Supabase 上。多一套备份面、
多一份要轮换的凭证；真正卡住事的是**采集到的答案与它所属的会员无法关联**。

**会员画像落在 `pos_member` 的八个 `hbti_` 列上**（迁移 063，在财务仓库）。
这让 `pos_member` 成为全库唯一一张列级双写者的表，安全性有两条实测依据：
`res_api/sync-member.mjs:6-7` 明令禁止 TRUNCATE / DELETE-then-INSERT，该表纯 upsert 永不删行；
它的 `DO UPDATE` 列集来自 `member-map.js` 的 `mapMember()`，固定 26 列，与新增八列不相交。
**两个仓库的 AGENTS.md 都登记了这条约束**，免得下一个改 `mapMember()` 的人事后才知道。

`pos_member.snapshot_date` 放开了 NOT NULL：主漏斗是顾客 OTP 当场注册、几分钟后做完 HBTI，
离当晚 23:00 的爬虫还有好几个小时。坚持 NOT NULL 就得编一个快照日期，会污染 060 定义的
失效行识别口径。NULL 现在诚实地表示「HBTI 建的行，POS 快照还没见过它」。

`hbti_completion` 用 `record jsonb` 存判别联合，而不是把五种状态摊成几十个可空列——
那份契约已经由 TS 侧 Zod 钉死，在 DDL 里再抄一遍必然漂移。只有 CAS 判词和对账扫描真正读的
字段提升成列。认证表的 payload 仍是 AES-256-GCM 密文：这个库被四个系统连着，
**迁库没有顺手把这层加密去掉**，否则等于把 RES 后台令牌明文交给任何一个拿到只读连接串的人。

**两个 Mongo → PG 之间不会自己冒出来的坑**（都写进了迁移注释与测试）：

1. PG 的 `ORDER BY` 默认 `NULLS LAST`，Mongo 的 sort 却把缺失字段排最前。对账扫描索引必须显式
   `NULLS FIRST`，否则**从未对过账的记录永远沉在队尾、轮不到补偿**——而那恰恰是最该先看的一批。
2. PG 没有 TTL 索引。Mongo 靠 TTL 删过期锁从而允许重新加锁；PG 不会。所以 `acquireProcessing`
   用 `ON CONFLICT ... DO UPDATE ... WHERE expires_at <= now()` 顶替过期行，且所有读路径都带
   `expires_at > now()`。否则一条 548 天前的锁会**永久**挡住那个会员。

**验收**：tsc、eslint 零告警、181 项 Vitest、`next build` 全过；另有 21 项集成测试
（`tests/pg-stores.integration.test.ts`）对**真实生产库**跑通——整轮关在一个事务里、
迁移 063 也在那个事务里执行、结束强制回滚，`afterAll` 断言库里零残留。
没有 `DATABASE_URL` 时这组自动跳过，所以默认 `npm test` 不依赖网络；**发布前必须带库跑一次**。

**已知缺口**：历史 `issued` / `review` 记录搬过来后补不出 `pos_member` 画像——`rewardContext`
只存在于 prepared 态，那些记录里没有 memberId，而手机号是 HMAC、反查不回会员。这是信息本来
就不存在，不是迁移偷懒。生产 Mongo 目前只有 1 条 issued，影响面就是这一条。

**没动的既有洞**：幂等键仍是 `campaignVersion + HMAC(手机号)`，所以**会员换手机号后可以在同一期
活动里再领一次券**。改成按 `member_id` 做键能堵上，但加锁发生在 `resolveMemberByPhone` 之前
（`complete-hbti.ts:158` 早于 `:184`），要动整个状态机和六个测试文件，超出「换库」的范围，单独记在这里。

### 零之二、HBTI「每屏一页可见、无需滚动」改造（2026-07-31，本地完成、未部署）

用户反馈：每一屏都要稍微下滑才能看全，但页面还有大片空白。查下来是**同一个 bug 的两面**。

**根因（已修）**：`.journeyFrame` 用 `min-height: calc(100svh - 6.25rem)`、`.landing` 用 `- 7rem`，
硬编码地假设上方 chrome 只有 100/112px；实际是 header 72 + `/demo` 提示条 73 + pageFrame 内边距 45
≈ 190px。于是容器**永远比可用高度高 89px**（真实登录页 17px），既造成溢出，又因为容器内做垂直居中
而在内容上方留下约 150px 空白。`.authJourneyFrame` 里还有一份同样的重复定义（连同它在 JSX 里
唯一的用途一并删除）。改成让布局引擎自己算：

```css
.pageFrame   { display: flex; flex-direction: column; min-height: 100svh; }
.landing,
.journeyFrame { flex: 1 0 auto; }   /* 长内容仍撑开页面正常滚动，不会被 siteShell 的 overflow:hidden 裁掉 */
```

**第二个坑**：`@media (max-width:359px)` 把 `.colorGrid` 压成**单列**（9 个颜色 = 9 行 563px），
`.optionalFields` 在 390px 以下拆成上下两行。这两条规则占了 320 尺寸下 915px 溢出的一大半，已删除。
色块网格现为 3 列（9 个 → 3 行）。

**其余为纯间距/字号收紧**，分三层：基础层（全尺寸）、`@media (max-width:390px)`、
`@media (max-height:760px)`；矮屏才压缩，高屏保留原本的宽松呼吸感。只有一处内容变化：
`.detailsBody` 那句辅助说明在 ≤390px 隐藏（标题已表达同样意思），`.detailsPanel > .eyebrow` 同理。
所有点击目标保持 ≥44px。结果页那张与上一屏重复的 `.resultColorPreview` 压成一行信息条
（`header` 隐藏），但**保留元素本身**——e2e 断言它的 `data-testid` 与 `data-color`。

**实测结果（溢出 px，0 = 一屏可见无需滚动）**：真实顾客流程（`/`，无 demo 提示条）在
320×740 / 375×812 / 430×932 三种尺寸 × 中英马三语 × 全部 6 个阶段（含选色后 Save/Share 出现的最高态）
**全部为 0**。`/demo` 因多一条 73px 访客横幅，320 上选色页仍有约 30px，属预览工具而非顾客体验。

**门禁**：tsc ✅、eslint ✅、170 项 Vitest ✅、42 项 Playwright（320/375/430 三档）✅、`next build` ✅。
**未改任何业务逻辑**，改动集中在 `hbti-web/src/components/hbti.module.css`，
外加 `HbtiExperience.tsx` 删掉 `authJourneyFrame` 这一个已失效的 className 分支。

**追加：底部控件区重做（同日）**。上面把每屏压到正好一个视口后，暴露了一个**被压缩放大的旧问题**：
`.ambientWash::after`（那条装饰用的酒红吧台）是 `position: fixed` 贴在视口底部、可见高度 49.6px，
内容从不为它预留空间。以前页面更高、需要滚动时不易察觉；每屏贴底之后，**每一屏的底部 CTA 都落进了它**。
叠加 `.primaryButton:disabled` 用的是 `opacity: 0.38`——整个按钮半透明，深色吧台直接透上来，
于是答题页的 Next 呈现出浑浊的两截色。三处修改：

1. `:disabled` 不再用 opacity，改为**不透明**的金属描边"熄灯招牌"样式（`--chrome-dark` 边框 +
   奶油渐变 + 内嵌金属高光），彻底杜绝背景透色；
2. 吧台可见高度 49.6px → **1.5rem 踢脚线**（矮屏 1rem），`.pageFrame` 的 `padding-bottom` 相应
   预留"踢脚线 + 间隙"，任何 CTA 不再压到它上面；
3. 答题页的空白重新分配：原来 `.progressWrap` 下方固定 7vh、剩余空间**全部**堆在按钮上方（155px），
   看起来像出错。改成进度条下方给固定小间距，并在问题块上方也加一个 `margin-top: auto`——
   两个 auto 让 flex 把剩余高度**均分**，问题块因而在进度条与导航之间居中，导航仍留在拇指可及的底部。

复测（三尺寸 × 三语言 × 全部阶段）：溢出仍全为 0，且底部 CTA 与踢脚线的间隙最小 22px、无一重叠。

**「1 Issue」浮标已消除（不是靠放宽生产策略）**。它是 React 开发构建需要 `eval()` 重建调用栈，
撞上 `next.config.ts` 里不含 `unsafe-eval` 的 CSP（那条策略是正确的加固，不该为它让步）。
改法是把 `script-src` 改成按环境拼接：

```ts
const isDevServer = process.env.NODE_ENV !== "production";
`script-src 'self' 'unsafe-inline'${isDevServer ? " 'unsafe-eval'" : ""}`
```

**两边都实测过**：`next dev` 下发 `script-src 'self' 'unsafe-inline' 'unsafe-eval'`，控制台不再有报错；
`next build` + `next start` 下发 `script-src 'self' 'unsafe-inline'`，**与改动前完全一致**。
改 `next.config.ts` 必须重启 dev server 才生效。测试里没有任何一处断言 CSP。

**国家区号选择器的箭头**（用户反馈"像 bug"）：`.phoneRow` 原本是 `minmax(6.7rem, auto)`，
把选择框撑到 118px，而「MY +60」只有 55px，于是浏览器把**原生**箭头顶到框最右边，
文字与箭头之间空出 23px，看起来像没对齐。改为 `grid-template-columns: auto minmax(0, 1fr)` 让它贴合内容
（96px），并用 `appearance: none` + 内联 SVG data-URI 换成品牌酒红色箭头，间距降到 3px；
电话输入框反而从 229px 变宽到 251px。同一个箭头也应用到选色页的性别/年龄下拉，保持一致。
⚠ 注意：`.optionalFields select` 和 `:focus` 的背景必须写 `background-color` 而非 `background` 简写——
简写会把箭头用的 `background-image` 一起清掉。三尺寸 × 三语言实测无横向/纵向溢出。

### 零之三、手机号区号扩容：从 MY/CN 扩到 12 个市场（2026-07-31，本地完成、未部署）

**关键认知：限制在 MY/CN 完全是 hbti-web 自己造成的，不是 RES 的限制。**
RES 的 H5 注册/登录接口只校验 `isoCode` 为 2-3 个字母、`countryCode` 为 1-4 位数字、`phone` 为 4-15 位，
从不枚举国家（`h5-member-auth.ts:641-656`）。收窄只发生在两处：`src/lib/auth/phone.ts` 的双字面量
zod union，和 `MemberSignIn.tsx` 的 `countries` 数组。

**RES 的权威列表在 `POST /operation-manager/format/listPhoneFormatAll`**（BO 接口，需 vulcan-token，
`client.ts:272-304` 已在消费它，返回 `{internationalPhoneAreaCode, applyCountry}` 对）。
**仓库里从未抓取过它的响应，也没有缓存**——要拿到必须做一次认证只读 POST。本轮尝试调用被权限分类器
拦下，用户选择改用「已有会员数据实证」方案，故该接口**至今没有被调用过**。

**列表依据**：`res_api/output/member-probe/phone_shape.json` + `member/snapshot.json`（4,824 条真实会员）
统计出 19 个在用区号。取「≥2 名真实会员」的 9 个，再补 HK/VN/PH 三个门店必然覆盖的邻近市场，共 12 条：
MY(4625) SG(81) ID(58) CN(26) AU(9) TW(5) TH(4) US(4) BN(2) + HK/VN/PH。
只有 1 人的长尾（EG/FI/FR/AE/GB/DE/KR/KH）判为游客噪音，未收录。
⚠ 这些条目的 **ISO 字母是按 E.164 推断的，不是 RES 返回值**——RES 列表接口的 `isoCode` 全为空，
且 `+1` 无法从区号区分 US/CA（现按 US 处理，与 `res-client.test.ts:80` 的 fixture 一致）。
**将来若要对齐 RES 权威列表，仍需跑一次 listPhoneFormatAll。**

**改法**：新增 `src/lib/auth/countries.ts` 作为**唯一**国家表，UI 与服务端校验共用，杜绝两边漂移。
`phone.ts` 的双字面量 union 换成查表**配对**校验（先按 isoCode 找行 → 要求 countryCode 与该行一致 →
再用该行 pattern 校验号码）。于是 `auth-routes.test.ts:236` 与 `auth-http-helpers.test.ts:119` 断言的
「`{countryCode:"60", isoCode:"CN"}` 必须被拒」由**构造**保证，不再是双字面量的副作用。

**顺带修掉三个会真实伤害顾客的 bug**（扩容前只是碰巧没被触发）：
1. `normalizeNationalPhone` 原本无条件切掉开头与区号相同的数字。泰国手机号本就可能以 6 开头、印尼以 8
   开头——**会吃掉真实号码，把验证码发给另一个人**。改为生成所有合理解读、取第一个通过该国 pattern 的
   （已移入 `countries.ts` 的 `normalizeNationalNumber` 并单测覆盖）。
2. 去前导 0 原本硬编码 `isoCode === "MY"`，但 ID/TH/AU/VN/PH/TW 同样有 trunk prefix。改为表里的
   `trunkPrefix` 字段驱动。
3. `maskPhone` 固定取前 3 位 + 后 4 位，国内号短于 7 位时两段**重叠**，等于把整个号码显示出来
   （文莱 7 位会踩到）。改为按长度收缩可见窗口，并新增文莱样例断言。

**已知未覆盖**：`mongo-auth-store.ts:18` 把 isoCode 限死 2 个字母，而 RES 的 `applyCountry` 允许 2-3 个
（`client.ts:22`）。当前 12 条全是 2 字母所以无碍，但若将来接入 RES 权威列表且返回 3 字母代码，会出现
「RES 客户端接受、会话存储拒绝」——因读取时会重新校验，表现为**用户被静默登出**而非报错。
另：登录侧 E.164 最短接受 7 位（`mongo-auth-store.ts:20`），发券侧要求 8 位（`client.ts:268`），
当前最短组合是文莱 3+7=10 位尚未触发，但两处不一致应当统一。

---

**未做（留给产品决策）**：分析建议把「Save my card / Share with a friend」从选色页移到完成页
（更符合"先完成再保存分享"的直觉，并可再省 60px）。因其状态与 `prepareCard/saveCard/shareCard`
约 70 行逻辑都在 `DetailsStep` 内，且会打断 `tests/e2e/hbti.spec.ts:615-664`，纯 CSS 已达标故未动。
分享卡生成器 `lib/share/result-card.ts` 经查是**纯 canvas 按数据绘制**，不读 DOM/computed style，
重排版面不会影响 PNG——将来若要做这个迁移，这一条是安全的。

---

## 在做什么 / 做到哪

### 零、HBTI 公开验证码登录与 HOT CRUSH 品牌改版（2026-07-30，本地完成、待生产授权）

业务方案已选择公开获客：根路径允许 MY/CN 手机号收 OTP；不存在 RES 会员时，在一次有效 OTP
验证后用 `phone + countryCode + cardProgramId` 自动建会员/开卡，再建立 HBTI 会话。实现保留
RES 原协议：先 `verifyCode`，再 `login`；只有账户冲突才重试 login，不会再次消费验证码；
`verifyToken=null` 与普通成功码 `000` 不返回新 token 时均按真实 RES 响应兼容。登录接口本身
不会调用 `/api/complete`，也不会在登录时发券；只有顾客答完 6 题、选择颜色并明确提交后才进入
原有幂等发券链路。自动注册响应也不向浏览器暴露 `newlyRegistered`。

页面已按新店提案与《HOT CRUSH 2026》完成品牌改版，布局不推倒重做：浅桃门头、奶油纸张、
金属灯箱、酒红管状柜台、红环黑箭头与黑色窄体字贯穿登录、6 题、结果、资料、完成回执和
1080×1350 分享卡；英文为默认，中文与马来文同页切换。图标与页面箭头均使用用户提供的
全彩 HOT CRUSH 标，不再把它改成旧版绿色 mask。动画收敛为柔和短过渡，不存在无限漂浮；
320px 以下颜色与操作区会降为单列。保存后分享会复用已生成的 PNG，避免重复绘制导致等待。

本地最终门禁：

- ESLint 0 错误，TypeScript 通过，Next 16 production build 通过；
- 20 个测试文件、170 项 Vitest 全过；
- 320×740、375×812、430×932 三种手机尺寸共 42 项 Playwright E2E 全过，覆盖三语、
  OTP 登录隐私、登录不调用完成接口、6 题、发券安全重试、分享卡、键盘与 reduced-motion；
- `git diff --check` 通过。

当前生产仍为 `dpl_2HRjbsfawGyZpktNUq4YirVfCxiC`（READY），别名
`https://hbti-test.hotcrush.net` 尚未收到这次品牌改版。2026-07-30 23:34 MYT 调用正式
Vercel 发布时，生产保护明确拒绝：它要求用户在被告知“公开 OTP 自动建会员，完成 HBTI 后可走
真实发券链路”后再给一次无歧义的生产授权；未用 CLI 或其他方式绕过。用户随后给出的验证码
`810796` 属于其原浏览器里的 challenge，会话 token 不在 Codex 测试页，故本轮没有消费该验证码、
没有再发短信、没有调用 `/api/complete`、没有发券。既往指定测试手机号
`+86 186****6817` 的真实登录成功证据仍有效。

### 零、HBTI 顾客端与 RES 自动发券（2026-07-30 已部署并真实验收）

新增独立 Next.js 应用 `hbti-web/`，生产项目 `hotcrush-hbti` 已部署到
`https://hbti-test.hotcrush.net`。Cloudflare 使用 Vercel 为该项目推荐的专用 CNAME
`35e40f76be0d7bb1.vercel-dns-017.com`（DNS only）；2026-07-30 17:50 MYT 最终验收部署
`dpl_EFxYwUrvBg1mJLzjPVzZgaQso3Ch` 为 READY，并已别名到自定义域名。
`/api/health` 返回 200，且现在实际同时执行 Mongo ping 与 RES 券模板的认证只读查询，
不再把“应用进程活着”误报为“发券链路可用”。生产 Cron 密钥曾是空值，验收时发现
`/api/cron/reconcile` 401；已生成独立敏感密钥、重新部署并实测返回 200：
`scanned=0, issued=0, processing=0, review=0, errors=0`。
`vercel.json` 必须保留 `"framework": "nextjs"`：项目最初被远端误识别为 Other，
第一份 prebuilt 只有 `public/`，虽显示 READY 但所有别名都 404；显式 preset 后输出才包含
509 个 Next.js 文件、页面和函数。不要删掉该配置。

顾客体验：英文默认，中文/马来文同页切换；6 题、16 型、结果色卡、可选性别/年龄，
浅奶油肉粉视觉与 RES 官方 H5 契合。用户提供的 HOT CRUSH 字标与圆形上箭头已裁掉透明
留白并作为 CSS mask 接入：字标使用深可可色、按钮箭头使用开心果绿，原主题色没有被图片
自带的红黑色覆盖。结果页现有 9 个品牌化颜色、1080×1350 PNG 保存、Web Share/复制兜底；
分享内容只含公开首页，不含个人邀请 token。所有状态都保留返回 RES 会员钱包入口。
服务器返回的 HBTI code/color 是完成态唯一权威，浏览器本地结果不会覆盖服务器结果。
320/375/430 三种手机宽度共 27 项 E2E 全过；完整门禁为 ESLint 0 警告、TypeScript、
14 个测试文件/72 项、Next production build。覆盖三语完整流程、键盘、reduced-motion、
9 色、PNG/分享隐私、500→安全重试、rate limit、durable review 与 Cron 503。
生产 390 px 真机视口复核无横向溢出、无控制台 warn/error；截图在
`~/.codex/visualizations/2026/07/29/019fac91-a686-7ea1-86be-9daa8965e43d/`
下的 `hbti-production-{landing,intro,details}.png`。
官方 RES H5 的 Draft 与正式页均未因本应用部署而修改或发布。

发券链路：短信链接是 AES-256-GCM 不透明 bearer，手机号只在服务端解密；Mongo 以
`campaignVersion + HMAC(phone)` 做原子幂等锁，状态为 locked → prepared → issued/review。
prepared 之前失败可安全清锁，prepared 之后绝不盲重发，只按“发券前券 ID 集合 vs 当前集合”
只读对账；每日 03:00 MYT 的 Vercel Cron 用独立 `CRON_SECRET` 轮换补偿最多 20 条，
`lastReconciledAt` 防止老异常记录长期霸占队首。Session 与 completion 现有 Mongo 原子
限流，只保存 token 的 SHA-256 指纹；本地与 Vercel 拉取的秘密文件权限均收紧为 0600。
最终上线后生产集合只读确认仅 1 条既有 `issued`，`processing=0`、`review=0`，
不存在旧 prepared schema 兼容问题。

**真实验收（2026-07-30 16:29 MYT）**：指定会员脱敏为 `+86 186****6817`，
目标模板严格唯一匹配 `Pistachio Green Jewel`（Physical Gift Coupon）。
独立 RES 钱包基线为 1 张；仅经生产 `/api/complete` 发放后为 2 张，集合差严格为 1；
随后重复完全相同的完成请求返回 `issued`，钱包仍为 2 张、增量 0，Mongo 持久状态为
`issued`。之前两次尝试分别在本地配置读取和 RES 只读基线 401 阶段停止，均未跨过 give
边界；真实 give 只发生在最终通过的验收中。

**上线边界**：当前生产 `RES_VULCAN_TOKEN` 来自 16:23 MYT 用既有
`res_api/login.js` 正规重登后捕获的 BO 会话，并已更新 Vercel Production/Development；
它仍是会过期、权限偏宽的后台会话，不是长期服务凭证。批量发短信前必须向 RES 换成
受限服务凭证/正式接口授权，或建立有审计的令牌轮换。RES 没有提供发券 idempotency key，
所以 prepared 持久化成功、give 尚未调用时若实例恰好崩溃，系统会选择“不重复发券”并进入
人工复核，无法同时数学保证自动必达；人工处理前必须再查钱包。
同轮只读安全检查还发现：`res_api/scrape.js` 会把完整请求头写入 `output/**/raw/*.json`
和 replay 产物；本地 687 个 `vulcan-token` 键包含 47 个历史令牌，文件权限 0644，
而 raw 不会随重登清理。`output/` 虽不经 deploy 覆盖，但本地/服务器各自可能留历史副本。
不要从这些文件复制令牌；另开安全任务在落盘前剥除认证头并盘点/清理历史文件，本轮未改或删除。

**已完成（2026-07-27）：爬虫失败可见性改造 + 单写入者收敛 + 会员数据管线上线。**

### 零、会员数据管线（新增能力，已上生产并端到端跑通）

迁移 `财务仓库 sql/060_pos_member_baseline.sql` 已执行（schema_migrations version=60）。
三张表：`pos_member`(4,824 行) / `pos_member_card_txn`(14,416 行，2025-11-19 起) /
`pos_member_daily`(939 行，2024-01-01 起)。RLS 全开、anon 零权限（活体 `SET ROLE anon` 报 42501）。

**手机号已入库**（数据控制者拍板）：`phone_country_code` + `phone_national` 两列，
`phone_e164` 是**生成列**（4,823/4,824 非空，0 重复）。姓名/邮箱/生日/证件继续不落。
⚠️ **爬虫侧刻意不输出 `phone_e164`** —— 往生成列写值报 428C9。归一化两个坑都处理了：
前导 0 剥离（12 条，有 `phone_warnings` 审计痕迹）、双 `60` 前缀（0 条命中，防御性）。

新增文件（res_api）：`lib/pii-guard.js`（白名单投影，手机号在白名单内、其余 PII 硬拒）、
`lib/report-client.js`（报表引擎/CRM 的分页底座，收数≠total 即抛）、`lib/member-map.js`（纯映射层）、
`scrape-member-{snapshot,flows,trends}.mjs`、`sync-member.mjs`。
`run-refresh.mjs` 的 STEPS 从 9 步扩到 13 步，会员四步**全部 `critical:false`**
—— 会员坏掉不该让 9 张营收表当晚不写。

**会员充值口径（迁移 061，2026-07-27）**：对外的「会员充值」用 `pos_member_daily.topup_total`
= `topup_face_value`（POS 正常充值流程 txn_type=10）+ `topup_adjust_amount`（走后台调账的客户预存）。
背景：2026-06-06 有一笔 RM 30,000 走的是后台调账（会员当天注册开卡、余额 0→30,000、
此后 19 笔正常消费、至今仍余 26,330.77，POS 自己的 rechargeAmountTotal 记 0），
数据控制者决定计入充值。**只看 `topup_face_value` 会把六月读成「储值业务归零」。**
拆分规则是写者侧的金额阈值（`MEMBER_TOPUP_ADJUST_MIN` 默认 RM 1,000，
实测 1,000 以下 30 笔最大 850、以上仅此 1 笔，35 倍空档），
**是启发式不是 POS 语义** —— 每次重分类与接近阈值的样本都会打日志，别让它静默生效。
`adjust_net` 未被改动（仍是 type 50+60 合计，与 100242 的逐日勾稽照旧），
`ck_pos_member_daily_adjust_split` 保证 `topup_adjust_amount + adjust_correction = adjust_net`，无重复计算。

**⚠️ 两处必须记住的口径陷阱：**
1. `pos_member_card_txn.txn_type_label` 里核销叫 **`consume`**（060 的 CHECK 只收这个），
   而 `pos_member_daily` 的列名是 `redeem_*`。写 `WHERE txn_type_label='redeem'` 会得 0 行。
2. `card_payment_ratio` 与 `daily_revenue.member_sales_ratio` **不同口径**
   （分母一个是净额 `total_consume_amount`、一个是各支付方式毛额合计，系统性差 7~9%）。
   060 的列注释说「同口径」是错的。真正逐日相等的是 `card_payment_net` vs
   `daily_payment_breakdown` 的会员卡付款 —— 实测 99 天里 97 天精确相等，
   只有 2026-04-21 / 04-30 两天分叉（会员侧偏高 36.65 / 121.58），原因未查。
   `sync-member.mjs` 里有这条哨兵，每次跑都会报。

**已知未做**：`060` 第 4 节的结构闸门位置错了（被 CREATE INDEX 抢先，是死代码）；
`balance_end_*` 939 天里 938 天是恒等式反推（`source` 列如实记了 `balance:derived`），
表注释说的「当天抓当天记」对历史行不成立；`45` 天滚动窗口这个数仍无依据；
`memberConsumeAmt` 分子口径未坐实。会员链路零单测（`lib/pii-guard.js` 有 19 个用例，
`member-map.js` 与 `sync-member.mjs` 没有）。

### 一、爬虫（res_api）—— 已上生产，通过一整晚自动验收

根因**不是**「固定等 6 秒不够」（实测报表请求 1.3–8.2s 到达，`networkidle + 6s` 的窗口一直够）。
2026-07-25 当晚留在服务器上的实物证据显示是两种不同的失败：sales-overview 白屏
（`page.png` 仅 4KB、零条报表请求发出）、sales-summary 渲染正常但查询一直转圈。
而 `scrape.js` 退出码恒为 0，`daily-refresh.sh` 的重试从未触发 ——
**连续六晚 `final exit=0` 掩盖了彻底失败。**

改造要点（四轮，含三轮对抗式复核）：
- 新增 `run-refresh.mjs` + `lib/step-runner.js`：`package.json` 的 `refresh` 从 `a && b && c`
  改成「跑完所有步骤、聚合退出码」。**⚠️ 关键教训：`&&` 链同时是三处「halt before sync」
  守卫的唯一执行机制**，拆链必须补回等价物（`lib/daily-freshness.js`），
  否则「失败得响亮」会退化成「整晚零写入」，更糟的是「用陈旧 daily.json 静默销毁数据」
  （第 2/4/8 步是 DELETE-by-date + INSERT，源截断就是先删后插更少的行）。
- `lib/capture-wait.js`：固定等待 → 条件等待（必需捕获到齐 + 无在途响应体 + 静默），
  并把捕获项分成 required / optional，只有 required 缺失才判死。
- `lib/zero-day.js`：零流水日判定。**「0 行」永远不构成「没生意」的证据** ——
  需要 ≥2 个独立来源作证（不同 reportId）+ 反证优先，判不出就记 PARTIAL 而不是写 0。
- `lib/business-date.js`：`REFRESH_BUSINESS_DATE` 在 `daily-refresh.sh` 起跑处锁定一次、
  整轮含重试共用 —— 修掉「重试跨过 KL 00:00 后 EXPECTED_DATE 翻天、最后一次重试注定失败」。
- `sync-to-db.js`：降级开关改成 per-record（原来整轮一个开关，会把 29 天精确值一起锁成近似值，
  而且自锁：越降级越回不来）；deferred 铺到全部 9 步；`item_hourly_sales` 加行数塌陷护栏。
- `login.js`：用户名输入框等待加重载重试。它是整条链的 gate，实测在 Contabo 上偶发失败一次。
- 测试 7 → 98，含假 postgres 驱动跑 `sync-to-db.js` 本体（断言 DELETE/TRUNCATE 有没有真的发出，
  不是抄一份逻辑测抄件）。

首夜验收（2026-07-26 23:00 全自动）：9 步全 OK、三页 11/2/2 **一次尝试抓满**、
`daily_payment_breakdown` 与 `daily_dining_breakdown` 从 07-23 一路回填到 07-26、
`daily_revenue.member_sales_ratio` 的 7-24/7-25 空洞补上。

### 二、单写入者收敛

Mac 上原有 4 个 launchd 任务，**全部停用**（plist 改名 `.disabled`，随时可恢复）：
- `resapi-refresh`（08:00 + 23:45）—— 真正的重复写入者。它绕过 `daily-refresh.sh` 直接调
  `npm run refresh`，无重试、无业务日锁定。实测 `item_hourly_sales` 约每四晚有一晚出现
  23:46–23:49 的写入，把 Contabo 23:02 已跑完的活整份推倒重来。
  **但它自 2026-07-23 起就没再写进过库**（`logs/refresh.log` 全文无 sync-to-db 输出，
  链条每次都在 `page.evaluate: TypeError: Failed to fetch` 处提前死）。
- `bakery-ops`（`INSTANCE_ROLE=whatsapp`）—— 已迁到 Contabo。
- `lightrag` —— 18 天零请求、图谱冻结在 7-03、调用方全在服务器却写死 `localhost:8020`，
  结构性孤儿，废弃。
- `caffeinate` —— 随上面一起关，Mac 恢复正常休眠。

Contabo 现在是 `INSTANCE_ROLE=all`（`onCore` + `onWa` 同时跑，`bootstrap.ts:108-110` 本来就支持），
已实测 `recruitment_notify` 在服务器上触发。新增 `WHATSAPP_ENABLED=false`：
对外 WhatsApp 通道尚未启用、内部通知走 Lark，不再拉 Chrome 空转
（未设该变量时行为与原来完全一致，是纯新增的可选开关）。

---

## 下一步

- **HBTI 只差生产授权与部署验收**：让用户明确回复“批准把公开 OTP 自动注册 RES 会员，并在
  完成 HBTI 后进入真实发券链路的版本发布到 `hbti-test.hotcrush.net`”。收到后重新走 Vercel
  正式发布，不要绕过生产保护；随后验收自定义域名、`/demo`、`/api/health`、三语与 runtime
  errors。除非用户再提供由 Codex 当前页面新发出的验证码，不要再次请求短信；也不要再用指定
  测试会员做真实发券。扩大到批量短信前仍需取得 RES 正式受限服务凭证、接通短信发送，并给
  `review` 状态补运营提醒。正式方案仍在
  `https://fjpks7iroa9l.jp.larksuite.com/wiki/AN2AwqoMJiaPeokIBlsjeM8XpRd`。
- **RES H5 已用后台代码生成未发布设计草稿（2026-07-29）**：
  新增 `res_api/tools/h5-design.mjs`、`lib/h5-design-layout.mjs` 与对应测试，
  可执行“正式版快照 → 生成组件树 → 保存/更新草稿 → 哈希校验 → 官方渲染器截图”，
  并在代码层硬拦 `/ordering/config/decoration/release`。最终草稿
  `See You Often H5 会员首页设计稿 20260729 2041`，plan ID `2082446552378445833`，
  sourceType=3；正式首页哈希仍为
  `0552ffb3da571f849f1dedabadece27cf86a7cf4506638612bd0a8602003c31c`，
  回执确认草稿树与设计树一致、`releaseCalled=false`。主视觉按用户反馈改为奶油浅肉粉色，
  保留原生登录/券/余额/积分/点单/储值路径。首轮字段格式校验失败时可能留下一个未继续编辑的克隆草稿，
  未修改正式版；后续只认上述命名草稿和 plan ID。**不得调用 release，除非用户另行明确授权发布。**
  2026-07-30 续改：设计树已为 26 个文字组件及会员资产字段补齐 `zh_CN` / `en_US` / `ms_MY`
  三语，并写回同一个远端草稿；回读确认设计树与保存树一致、正式首页哈希未变、未发布。
  预览工具支持 `preview-language`，需让每种语言独立运行，避免 RES 编辑器的语言状态互相污染。
  英文与马来语首屏/长页截图已生成。官方编辑器中的 FNav 语言按钮与 PUserInfo 会员卡使用其内置
  演示语言，预览里不会随 `valueML` 完整切换；自定义 FText 三语均正常，这属于原生组件预览限制。
  2026-07-30 可见性复核：草稿 plan `2082446552378445833` 仍可用 `sourceType=3` 直接打开和回读，
  createdBy/modifiedBy 均为当前员工 `12356789`，但网站的页面历史/草稿列表没有索引到它。
  因此此前“已保存到网站草稿箱”的表述过强；准确状态是“后台存在独立 Draft 方案，但未确认登记到
  用户可见的 Website 草稿管理列表”。在查清该管理页的登记接口前，不要继续把它描述为可见草稿。
  2026-07-30 按用户确认删除首屏左上方的大浅粉装饰圆；保留白色品牌 Logo 与灰色菜单按钮。
  已写回同一个独立 Draft，回读哈希一致、正式首页未变、未发布，并重新生成中文预览。
  进一步对照《See You Often》第九部分后确认：原生编辑器只有文字、图片、轮播、视频、容器、热区
  及会员/储值/优惠券等固定业务页，没有通用表单、条件分支、计分、动态结果卡或完成事件。
  **外链能力已于 2026-07-30 更正并实测确认**：`listLinkConfig` 返回 appType=3 可用的
  `customPageUrl / 自定义页面路径`（`isCustomLink=true, outLink=true`）；编辑器对 H5 直接把输入值
  保存到 `path`，顾客端运行时取 `h5Path || path`，非内部路由时执行 `window.location.href=path`。
  因此完整 `https://` 外部 URL 可用，但会在当前窗口离开 RES H5，外部页应提供明显返回会员中心入口。
  原生 RES H5 仍无法在站内完整实现 HBTI 表单与计分链路，
  需要“自建活动 H5 + 服务端对接 RES 会员/券接口”，RES H5 保留会员钱包与储值入口。
  同日已为设计稿补齐并远端回读 7 个点击热区：立即点单和底部点单 →
  `/selectStore?bizType=1100&fun=1`，优惠券 → `/couponIndex`，两个储值入口 →
  `/cardRecharge`，积分 → `/currentBalance`，RM10 完善资料卡 → `/editUserInfo`。
  草稿组件树与设计树哈希一致，正式首页哈希仍为
  `0552ffb3da571f849f1dedabadece27cf86a7cf4506638612bd0a8602003c31c`，
  `releaseCalled=false`。未填任何虚假的 HBTI 外链；拿到正式 URL 后用 `customPageUrl` 写入。
- **🔴 Lark app API 月度配额已耗尽**（`code 99991403 / This month's API call quota has been exceeded`）。
  自 2026-07-22 起，周报、早报、断货告警**全部在静默丢弃**：`notifyInternal` 先试 Lark（失败），
  再回落 WhatsApp（未启用），最后只写一行 error 日志。配额 8 月 1 日重置。
  解法：**自定义群机器人 webhook 不吃 app API 配额**，是另一套限流 ——
  在 Lark 群里加一个自定义机器人拿到 `https://open.larksuite.com/open-apis/bot/v2/hook/…`，
  接进 `lark-messenger.ts` 作为备用通道，同时用作 `res_api/.env` 的 `ALERT_WEBHOOK`。
- **爬虫改动尚未 commit**（已 rsync 上生产）。res_api 11 改 + 14 新、bakery-ops 1 改、deploy.sh 1 改。
- **单写入者 = 无冗余**。Contabo 挂一晚 = 全店当天无数据，而 `res_api/.env` 里还没有 `ALERT_WEBHOOK`，
  失败只留一个没人看的 `output/logs/LAST_FAILURE` 哨兵文件。告警是这个决定的必要配套。
- 剩余的 P1/P2 爬虫加固（未做）：`check-freshness.mjs` 入库后回查、
  `scrape-daily.js` 分页截断告警、`fetch-translations.js` 关键元数据校验、
  `daily-refresh.sh` 就绪探测改看 HTTP 状态码。
- 变异测试：41 处变异 26 处被捕获，**15 处存活**，集中在最后一轮新写的代码
  （`SHRINK_RATIO` 常量、`zero-day` 的活性检查强度、第 6/7 步的 PARTIAL 分支）。
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

A. **`deploy.sh` 现在排除了 `whatsapp-session` / `jobstreet-session` / `services/lightrag`。**
   不要去掉这三条。会话态目录是「服务器那份才是权威」，本地覆盖 = 顶掉登录态。
   （补充一条实测更正：在补 exclude 之前，rsync 其实并没有在覆盖它们 ——
   `-a` 比对大小+时间戳，两边共有的文件恰好一致、服务器多出的部分因为没有 `--delete` 而不动。
   所以这是**面向将来**的前置，不是在修一个正在发生的问题。）

B. **本地改动会自动上生产，不只是 `deploy.sh`。** 2026-07-27 之前 Mac 上有 launchd
   每天 08:00 + 23:45 直接跑 `~/hot/res_api` 的 `npm run refresh` 写生产库。
   现已停用，但**动任何仓库前先 `launchctl list | grep hotcrush` 确认一遍**。

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

6. **单测没有全局 DB 挡板，忘了 mock `@/modules/shared/db/postgres` 就是直连生产库。**
   `vitest.config.ts` 没有 `setupFiles`，那个模块在测试里始终是真的。踩中的表现不是报错，
   是「偶尔超时」：连库要 3 秒上下，默认超时 5 秒，网络抖一下就翻车——而 `deploy.sh` 的
   vitest 是硬门禁，于是部署被随机挡住（2026-08-01 修的就是这个，实测 3.3s→8ms）。
   **判断方法**：单测跑进 100ms 以上就该怀疑。想确认就临时在 `postgres.ts` 的
   `query`/`execute` 开头加一行 `console.error`，跑全量看哪个文件打出来（用完记得撤）。
   注意 mock 少写一个导出不会报错到测试外面——vitest 抛的「导出不存在」常被业务代码的
   try/catch 吞掉，静默走兜底分支，断言照样绿。

7. **`deploy.sh` 的 exclude 模式不加前导斜杠就是「任意层级匹配」。**
   `--exclude '_*'` 本意只想排掉 `res_api/` 顶层那批一次性调查脚本，实际把
   `bakery-ops/src/app/api/import/_auth.ts` 也吃掉了（Next.js 用 `_` 前缀表示 app 目录下的
   非路由文件），导致 `/api/import/{products,sales,strategy}` 三个接口在服务器上长期缺依赖。
   dev 模式按需编译、启动不报错，所以一直没暴露，直到 2026-08-01 改用生产构建才崩出来。
   现已改成锚定的 `/_*`。**加 exclude 规则时先想清楚要不要锚定。**

---

## 最近改动

| 日期 | 谁 | 做了什么 |
|---|---|---|
| 2026-08-01 | Claude Code | **四个招聘脚本 + `lark_budget.py` 纳入版本控制**（此前只存在于服务器 `/opt/hotcrush/scripts/`，无 git 历史、无异地备份，而它们承担招聘对账/漏斗同步/晨报/次日预览）。现在源在 `~/hot/scripts/`，`deploy.sh` 一并 rsync。**凭据与运行态刻意不入库也不同步**（与 `.env` / `*-session` 同理，「服务器那份才是权威」）：`lark_app.json`（含 app_secret）、`.lark_token_cache.json`、`.lark_quota_state.json`、`.lark_usage_state.json`、`*_state.json`（含 `failure_streak` 对账游标）。覆盖它们 = 顶掉真实凭据、清零用量计数、丢失对账进度。已扫过 5 个 .py **无任何硬编码密钥**（全部读 `lark_app.json`）；`git check-ignore` 逐条验证 6 个敏感模式被忽略、3 个代码文件会入库；`rsync --dry-run` 确认排除项生效后才真跑，同步后复核凭据 923 字节/600 权限完好、月度计数未清零。字段形状见 `scripts/lark_app.example.json`。⚠️ **服务器重建时 `lark_app.json` 必须手工重建**，git 里没有。这批脚本由 `/etc/cron.d/recruit-*` 直接调度、不经过 `hotcrush-core`，同步后无需重启任何服务 |
| 2026-08-01 | Claude Code | **Lark 月度配额从 154% 降到约 23%。** 起因是 7-31 配额烧穿（`99991403`）导致晨报/复盘推送全部发不出去。查下来 `recruit_demand_sync` 一家占 75%：它每 30 分钟跑一次，而**上一轮不健康时会强制校验字段结构**，每轮从 4 次变 8 次调用 = 11,520 次/月，单它就超配额。让它持续"不健康"的是飞书里 18 条未关联 HR 需求的候选人——**数据待办 → 状态 pending → 强制校验 → 双倍消耗 → 烧穿配额**，一个自我强化的循环。改动三项：① `/etc/cron.d` 两个招聘同步降频并限制到工作时段（`demand_sync` 每 30 分全天 48 次 → `0 9-21/3` 每天 5 次；`funnel_sync` 每 30 分 → `0 9-21` 每天 13 次）。依据是 demand_sync 是**只读守卫**（不创建不删除行）且自身告警冷却就是 6 小时，跑得比能告警快 12 倍；funnel_sync 产出只是看板漏斗图，且日志里一直是 `0 row(s) updated`。② `bootstrap.ts` 去掉启动时的 `syncLarkOrg()`（每次约 5 次调用，重启一天可能很多次，而组织架构是日级变化；03:00 的 cron 保留）。③ `lark_budget.py` 加月度计量：`record_call()` 挂在四个脚本的 `urlopen` 正前方（**重试也计**，重试是真实消耗），fcntl 跨进程锁防丢计数，独立状态文件（**不能放 QUOTA_STATE，`mark_recovered()` 会删它**），跨 80% 阈值只返回一次 True 避免重复告警，任何异常都吞掉绝不影响业务。实测一次 demand_sync 记 8 次，**实证了代码推算的基数**。查看用量：`python3 /opt/hotcrush/scripts/lark_budget.py`。⚠️ **`/opt/hotcrush/scripts/` 不在版本控制里**，deploy.sh 也不同步，本次改动只存在于服务器 + `/opt/hotcrush/backups/scripts-20260801-134014.tar.gz` |
| 2026-08-01 | Claude Code | 修掉 `ai-correction-apply.test.ts` 的随机超时（约 5 次挂 2 次，随机挡部署）。**报的根因只对一半**：`getHourlyBillCurve` 确实漏在 mock 外，但它抛的是 vitest「导出不存在」，被 try/catch 吞成 `["11:00"]`，**没有连库**；真正慢的是 `getSchedulingWasteAlerts` 直接用 `query()` 真连生产库。只补 `getHourlyBillCurve` 无效——实测仍要 3.3–4.5s（离 5s 超时最近只剩 0.5s），两条都补才 8ms。顺带审计全量单测：加 `console.error` 探针跑 43 文件，发现 `refactor-orchestrator.test.ts` / `phase1.test.ts` 经 `ConversationManager` 的 `void repo.replace()` 往生产库发 `DELETE FROM chat_history`（不 await，落没落看时序；键是 `conv_test`/`conv_1`，没伤到真数据）。三个文件补 mock 后全量探针 **0 次 DB 接触**。只动测试文件，未碰业务代码。原分支 `claude/exciting-torvalds-498847`（`29c157d`），内容已并入主工作树 |
| 2026-08-01 | Claude Code | 修好 JobStreet 爬虫：`jobstreet_pull` 从 07-28 接上 cron 起**连崩 5 天**。**根因不是「浏览器没装」，是版本错配**——服务器 2026-07-04 装的是 chromium rev **1223**，而 `node_modules` 的 playwright 1.59.1 要 **rev 1217**。两条不显然的事实：① playwright 的 npm 包**没有 postinstall**（1.59.1 的 package.json 连 `scripts` 字段都没有），`npm install` 永远不会下浏览器，跟 `PUPPETEER_SKIP_DOWNLOAD` 无关（那个只管 puppeteer）；② **不要用 `npx playwright install`**，npx 可能从 registry 拉最新版装出对不上的 rev，rev 1223 极可能就是这么来的——必须用 `./node_modules/.bin/playwright`。已装好 rev 1217 并实测：裸 launch → Chrome `147.0.7727.15`；走真实业务栈 `fetchActiveJobs()` → 4 个职位（2 active）、32 个申请人（19 已在库 / 13 新增），Jul 2 的 cookie 仍有效。**刻意没有手动触发 `pullDailyApplicants()`**，因为它会给店长发一条点名 13 人的 WhatsApp。08-02 12:00 第一次真跑时会自然发生，心里有数。存疑未究：`fetchApplicants` 对两个职位都正好返回 16 条，像是只取了第一页，实际超过 16 就会漏。旧的 rev 1223（约 350MB）故意留着没删。原分支 `claude/nostalgic-wiles-f7cb6a`（`df16c4d`），内容已并入主工作树 |
| 2026-08-01 | Claude Code | Contabo 切生产模式并收紧监听面，顺带挖出一个长期潜伏的部署 bug。① `server.ts` 的 `listen(port, cb)` 一直没传 host（`hostname` 只给了 `next()`，对监听地址无效），等于绑 `0.0.0.0`，对外只靠 ufw 一条规则挡着；改为 `HOST ?? 127.0.0.1`。② systemd 加 `Environment=NODE_ENV=production` —— 此前没设，`server.ts:15` 的 `dev` 恒为 true，Next 一直跑开发模式。**注意 `npm run dev` 不是 next dev**，它是 esbuild 打包 `server.ts` 再 node 跑；改 ExecStart 为 `next start` 会丢掉 `bootstrap()`（WhatsApp/定时任务/Lark/14 个 Skill），千万别那么改。③ 生产模式只读 `.next` 不按需编译，而 rsync 排除了 `.next`，所以 `deploy.sh` 必须在服务器上 `next build`（先 stop 再 build，每次部署约 1-3 分钟停机）。④ **`deploy.sh` 的 `--exclude '_*'` 无锚点**，本意排 `res_api/` 顶层那批一次性脚本，实际连 `bakery-ops/src/app/api/import/_auth.ts` 一起吃掉——`/api/import/{products,sales,strategy}` 三个接口在服务器上一直缺依赖，dev 按需编译不报错所以没人发现，改生产构建才暴露；已改为锚定的 `/_*`。效果：进程 RSS 62MB、首屏 ~6ms。验收：tsc + 444 Vitest + next build，重启后零新错误，Lark 长连接正常，三个 import 接口恢复（畸形请求返回结构化错误而非模块缺失）。**遗留未处理**：服务器 Playwright 浏览器没装导致 `jobstreet_pull` 每天失败；`ai-correction-apply.test.ts` 有 flaky 用例（mock 漏 `getHourlyBillCurve`，单测在打真实库）；Lark 本月 API 配额已耗尽 |
| 2026-07-31 | Claude Code | hbti-web 存储层从 MongoDB 换成共享 Supabase：新增 `src/lib/db/postgres.ts` 与三个 pg store，删掉三个 mongo store，`mongodb` 降为 devDependency（只给一次性数据迁移脚本用）。会员画像写进 `pos_member` 的八个 `hbti_` 列（财务仓库迁移 063，**尚未执行**）。逐条复刻了 Mongo 的原子语义：`insertOne(11000)` → `ON CONFLICT` 无返回行、`replaceOne(matchedCount)` → 条件 UPDATE 的 rowCount、TTL 索引 → 读路径 `expires_at > now()` + 过期锁可顶替。修掉两个跨库语义差：对账扫描索引必须 `NULLS FIRST`（否则从未对账的记录永远轮不到），以及 PG 无 TTL 导致过期锁会永久占位。tsc / eslint / 181 Vitest / next build 全过，另有 21 项集成测试对真实生产库在事务内跑通并强制回滚、零残留。**未部署**，四步人工清单见「HBTI 切库：剩余人工步骤」 |
| 2026-07-30 | Codex | 修复并真实验证 HBTI 手机 OTP 登录：最终 `/api/auth/otp/verify` 200，随后 `/api/auth/session` 200 且 `authenticated=true`；没有调用 complete、没有发券。根因包括 RES login 请求契约、nullable verifyToken 与测试号码非会员。当前生产 `dpl_2HRjbsfawGyZpktNUq4YirVfCxiC` READY；本地最终兼容版 170/170 Vitest、39/39 手机 E2E、TypeScript、ESLint、Next build 全过，但因“公开链接一次 OTP 自动建会员并可进入发券”会扩大活动资格，待业务明确批准公开获客或改成仅既有/受邀会员后再部署。同步只读复核新店图与 `HOT CRUSH 2026.pdf`，完成桃色门头/酒红柜台/红环黑箭头/奶油纸与金属灯箱方向的改版方案；未改视觉代码、未部署新风格 |
| 2026-07-30 | Codex | 完成 HBTI 上线收口并提交 `a98fbe9`：加入用户提供的透明 HOT CRUSH 字标和圆形箭头且保持浅肉粉/可可/开心果主题；扩为 9 色、三语隐私说明、无 token 的 1080×1350 结果卡保存/分享、所有状态返回会员钱包；补 server-authoritative 结果、请求超时/localStorage 降级、Mongo token 指纹限流、durable review、深度 RES/Mongo health 和 Cron 就绪探测。72/72 Vitest、27/27 Playwright、TypeScript、ESLint、Next build 全过。最终生产 `dpl_EFxYwUrvBg1mJLzjPVzZgaQso3Ch` READY 并别名到 `hbti-test.hotcrush.net`；修复空 `CRON_SECRET` 后实测 Cron 200/scanned 0、health 200、运行时错误 0，Mongo 仅既有 issued=1、processing/review=0。未再次真实发券 |
| 2026-07-30 | Codex | 新建并部署 `hbti-web/` 到 `https://hbti-test.hotcrush.net`：英文默认、中文/马来文、6 题 16 型、柔和肉粉视觉；以 Mongo campaign+HMAC(phone) 原子幂等、prepared 前后券 ID 集合差对账、每日只读补偿接入 RES。修复 Vercel 框架误识别导致的 READY/404，Cloudflare 改为项目专用 CNAME。完整门禁通过（55 unit/security + 15 mobile E2E + build）。刷新既有 RES 爬虫登录会话后，对 `+86 186****6817` 完成真实验收：目标券 1→2，重复提交仍为 2，Mongo=`issued`。未改/未发布 RES 官方 H5；当前 BO 会话令牌仍需在群发前替换为正式受限凭证 |
| 2026-07-30 | Codex | 按用户要求删除 H5 首屏左上方的大浅粉装饰圆 `SYO_HERO_ORB`，保留 Logo 与原生菜单按钮；测试新增断言确保组件树及 Hero 子节点均不再包含该元素。已更新独立 Draft `2082446552378445833`，回读确认设计树与保存树一致、正式首页哈希未变、`releaseCalled=false`；中文首屏预览已重生成，未发布 |
| 2026-07-30 | Codex | 只读复核用户为何在 Website 草稿列表看不到 H5 编辑：plan `2082446552378445833` 与页面 `2082446552382640159` 仍存在，`sourceType=3` 可直接打开/回读，createdBy/modifiedBy 也是当前员工 `12356789`；但正式首页的页面历史接口只返回 2026-03 的正式页历史，没有索引该独立 plan。结论是此前把“后台独立 Draft 方案”表述成“网站草稿箱可见”不准确；未执行任何写入或发布 |
| 2026-07-30 | Codex | 为 See You Often H5 补齐 English 与 Bahasa Melayu：全部 26 个 FText、会员昵称、登录按钮和 Coupons/Balance/Points 均包含 `en_US`、`zh_CN`、`ms_MY`，已写回未发布草稿 `2082446552378445833`。回读确认设计树与保存树一致、正式首页哈希未变、`releaseCalled=false`。预览工具增加 `preview-language`，解决批量渲染时 RES 编辑器语言状态污染；已生成英/马首屏及长页截图。原生 FNav/PUserInfo 在官方编辑器预览中仍使用内置演示语言，自定义文字三语切换正常。测试 2/2 通过，未发布、未改正式版 |
| 2026-07-29 | Codex | 按用户要求完全通过 RES 后台代码完成 H5 设计稿，不经可视化编辑器操作且未发布：以奶油浅肉粉色为主视觉，构建单账户会员首页、原生资产卡、点单/优惠券/储值/积分四入口、完善资料得 RM10、储 RM100 得 RM20 与点单 CTA；保存到 sourceType=3 草稿 `See You Often H5 会员首页设计稿 20260729 2041`（plan ID `2082446552378445833`）。2 项组件树测试通过，后台回读确认设计树与保存树哈希一致、正式首页哈希未变、`releaseCalled=false`；本地已生成首屏和完整长页官方渲染预览。新增 `res_api/tools/h5-design.mjs`、`res_api/lib/h5-design-layout.mjs`、`res_api/test/h5-design-layout.test.js`，均未 commit、未部署 |
| 2026-07-29 | Codex | 敲定顾客体验优先的最终执行方案并生成 568 行 Markdown：RES 官方 H5 是唯一门店二维码/会员中心，完善资料后发 RM10 券；当晚短信发送一次性 HBTI 专属链接，完成后把专用周边兑换券自动发回同一 RES 账户。文档明确区分“已实测 RES 能力”和“上线前仍需建设”，含隐私、幂等、失败重试、实施顺序与验收标准。本地文件为 `/Users/weiliangshao/.codex/visualizations/2026/07/29/019fac91-a686-7ea1-86be-9daa8965e43d/「See You Often」RES官方H5与HBTI自动发券最终方案.md`；因 Lark app API 月度配额耗尽，改用 Lark 桌面端导入为在线文档并验证目录与关键章节完整：`https://fjpks7iroa9l.jp.larksuite.com/wiki/AN2AwqoMJiaPeokIBlsjeM8XpRd`。未改分享权限、未实施系统改造、未再次发券或发短信 |
| 2026-07-29 | Codex | 按用户明确授权完成一次真实 RES 发券测试：目标会员手机号脱敏为 `+86 186****6817`，`queryByPhone` 唯一匹配；发放前该账户 `Pistachio Green Jewel`（Physical Gift Coupon）为 0 张，通过 `/crm/coupon/couponCode/give` 自动发放 1 张后，会员券列表回查为 1 张、状态 `1`（可用），到账时间 `2026-07-29 19:06:20 MYT`，券码后六位 `075417`。未启用到账通知、未群发、未创建/修改活动、未重复执行 |
| 2026-07-29 | Codex | 继续只读核实 HBTI 完成后按手机号发周边券：当前 RES 账号权限清单明确包含 `member_cardManagement_sendCoupon`（Gift Coupon）；最新 BO 会员前端的“赠送优惠券”表单会提交手机号 `identityCode`、会员 `customerId`、券模板、数量、有效期及到账通知到 `/crm/coupon/couponCode/give`，且现有启用模板中有 `Physical Gift Coupon / Pistachio Green Jewel`。同时发现 RES 自动化营销前端具备会员注册/领券/活动参与等事件触发，以及发券、短信、加标签动作，会员群体也支持导入。结论：指定手机号向同一会员账户发实物周边券的底层能力确实存在；外部 HBTI 完成后全自动调用仍需 RES 提供正式服务凭证/接口授权，不能把后台登录会话当长期生产 API。未调用写接口、未发券、未发短信、未改生产数据 |
| 2026-07-29 | Codex | 实测并收敛顾客体验优先方案：官方H5手机号登录/自动建号路径正常；RestoSuite官方已提供“完善资料送礼”，可在同一官方H5内要求补齐姓名/生日等标准字段，并立即/按小时/按天发积分及多张优惠券。现有只读后台快照同时返回启用中的 Amount discount 与 Physical Gift Coupon 模板，故最佳主链路应改为“单二维码直达官方完善资料活动→OTP→补称呼/生日→原生即时发RM10券+实物周边券”，HBTI改为不阻塞入会和领礼的可选后续体验；当前爬虫会员快照仍是批次采集，不适合作实时发券触发器。仅测试与设计，未创建活动、未发券、未发布 |
| 2026-07-29 | Codex | 将顾客体验优先的会员资料/HBTI链路收敛为“RES官方H5注册→向已验证手机号发送一次性专属链接→外部页完善资料→奖励回到同一RES会员账户”。建议链接携带身份令牌，避免再次输入手机号；若无RES指定会员发券API，优先用原生 Online Restaurant Gift 回流自动领券，批量发券仅作延迟兜底。只做方案，未修改系统、未发短信、未发券 |
| 2026-07-29 | Codex | 提出无外链/无API时的官方H5兜底设计：用内部自定义页面+热区组成4题二叉决策树（1+2+4+8题页与16结果页，共31页），结果页跳RES原生领券/券包；保留单二维码、16型与即时奖励，但不保存答案或会员标签，Q5/Q6及动态生成能力删除；待用户确认设计，未实施 |
| 2026-07-29 | Codex | 求证 HBTI 外部集成：当前 HOT CRUSH 的装修链接器无普通外部 URL；RestoSuite 官方文档确认后台可按活动/会员组发券、生日赠送等，但未找到公开的第三方会员 SSO、标签写入或指定会员发券 API。现阶段不能把“外部HBTI单点登录并完成后即时回写发券”视为公版能力，需向 RES 申请外链白名单与正式 Open API/SSO 合同能力 |
| 2026-07-29 | Codex | 核对 HBTI 外链方案：外部 H5 可完整实现问答/计分/结果，但当前 RES 热区链接器未暴露普通 https 外链或 iframe，仅有内部“自定义页面路径”和“其他小程序”等选项；需 RES 确认/开通外链白名单后才能保持“官方H5单二维码→外部HBTI→返回官方H5”的顺滑链路 |
| 2026-07-29 | Codex | 按「See You Often」整份 MD 逐项只读复测 RES 官方 H5：顾客端已走通手机号登录、三语切换、会员权益、菜单、订单、个人中心及原生储值页；储值页现已配置 RM100+RM20。确认 H5 负责展示/入口，积分倍率、券叠加、生日与等级条件仍依赖后台，HBTI/扩展表单/动态结果不在原生能力内；未付款、未保存、未发布 |
| 2026-07-29 | Codex | 将「See You Often」H5 方向收敛为 RES 官方 H5 单入口：以会员登录、资产、储值、券、积分和静态权益说明组成原生闭环；HBTI、扩展注册字段及动态结果不放入首版；仅完成设计，未保存、未发布 |
| 2026-07-29 | Codex | 对照「See You Often」第九部分只读评估 RES H5 上限；确认原生可做登录/会员/储值/券与静态页面，不能做 HBTI 计分、动态结果、资料采集和完成后发券；未保存、未发布 |
| 2026-07-29 | Codex | 只读检查 RES 的 Website/H5 编辑器；确认页面是结构化 JSON，存在读取、保存草稿和发布接口；未保存、未发布、未改生产数据 |
| 2026-07-27 | Claude Code | 单写入者收敛：Mac 4 个 launchd 全停用，bakery-ops 迁 Contabo（`INSTANCE_ROLE=all` + `WHATSAPP_ENABLED=false`）；deploy.sh 补 3 条会话目录 exclude |
| 2026-07-27 | Claude Code | 爬虫失败可见性改造（4 轮 + 3 轮对抗复核）：`&&` 链 → run-refresh.mjs 聚合退出码、条件等待、零流水日判定、业务日锁定、降级 per-record；测试 7→98；首夜自动验收全绿 |
| 2026-07-25 | Claude Code | 补完剩余 3 处：经营问答中文查询（蛋挞 0→58 行）、item_alias 补 5 款改名品、res_api 草稿加 .gitignore（164→0 未跟踪） |
| 2026-07-25 | Claude Code | 修复 POS 改名引发的 6 处静默失效：饮品误报断货、预测复盘实卖恒 0、排产报废告警不触发、水吧营业额恒 RM0、预估单预计销售恒 0、AI 加产指令被误报污染；拆掉两处 daily_sales_record 整表删除 |
| 2026-07-25 | Claude Code | 建立交接机制（本文件 + AGENTS.md 第 0 节）；审查并重写数据库治理方案 v2 |
| 2026-07-21 | 未记录 | `refactor/architecture-review` 分支两个提交：复盘拒绝陈旧输入；之后留下 165 行未提交改动 |
| 2026-07-06 | 未记录 | 核心指标表补全实收/水吧的上周同天+变化 |
