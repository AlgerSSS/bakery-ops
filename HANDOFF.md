# 交接（HANDOFF）

> **开工第一件事：读本文件。收工最后一件事：更新本文件。**
> 这是唯一的交接凭证——不要让下一个 agent 去翻你的对话记录，也不要假设别人记得你做过什么。
> 规则见 [AGENTS.md](AGENTS.md) 第 0 节。

---

## R6 Green 独立 Supabase 数据平台基座（2026-08-20，Codex，已实施/未切库）

用户最终收紧本阶段边界：先重建独立的 `hotcrush-core-r6-green`
（project ref `tmmkknnkcptunxbfjxqn`），不得修改旧应用数据库连接、启用持续 shadow/POS worker，或把现网
切到新库。旧生产真源是 `supabase-yellow-crystal`（project ref `ecsgqcmwtjmcpzqytdqw`），不是早期文档
写的失活项目 `txaawdpmyjnmhihjkpud`。本地 BakeryOps 与 `res_api` 的 `DATABASE_URL` 收工时仍解析到旧库；
两份 `.env` 均没有 `R6_*` 运行开关或密钥。本轮没有修改 `.env`、Vercel、systemd 或 `DATABASE_URL`；
一次性迁移/对账脚本对旧库的第一条事务语句固定为 `SET TRANSACTION READ ONLY`，只把结果写入 R6。
此前已在 tokyo-01 核验旧服务连接和无 R6 drop-in；最后一次 SSH 重试因本机 DNS 无法解析该主机而未
重复取证，未据此改动任何配置。

R6 Green 现由 20 个可重放 Supabase migration 完整定义，远端为 14 张平台/业务表、2 个 POS current
view、33 个 `ops_*`/`ai_*` 受控函数、7 个私有 Storage bucket、7 个 NOLOGIN capability role、6 个
pg_cron job；`vector` 位于 `extensions` schema，Realtime 只发布 3 张运行状态表。物理分层为：
`ops_raw_batch/object` 原始证据与 `ops_processing_run` 租约队列 → 版本化 `pos_sales_day/hour` 与 RAG
文档/chunk/vector → 追加式 Agent run/event → RPC/Realtime 用户交互契约。没有为单店阶段引入 Fabric、
CDC、独立数仓或多项目同步。

本轮补齐了结构化 POS worker、文件大小/SHA-256 校验、来源合同、专用 pipeline claim、可逆 quarantine/
restore、平台健康快照、受限单日对账 RPC，以及只读旧库/只写 R6 的一天回填和自动对账 CLI。POS worker
现在只接受显式 `R6_SUPABASE_URL`/`R6_SUPABASE_SERVICE_KEY`，不会在缺变量时回退到旧 `SUPABASE_*`。
`res_api` 的连续 Raw shadow 仍默认关闭；但启用后会正确排入 `pos_daily_sales`，不再只落 Raw 而没有处理
run。

真实远端演练包含一个反例和一个成功样本：此前 2026-07-26 RES Raw 抓取只覆盖半天，处理虽成功但净额
38,021.26 与旧库最终日额 63,075.06 不符，已将 batch
`24bdf0c8-0422-4e17-9607-a0d2f46a7f02` 隔离；30 条日版本和 43 条小时版本保留用于审计，不进入 current。
随后用显式 `LEGACY_POS_EXPORT` 从旧库只读导出最终日数据，batch
`0471f653-0035-49cc-9621-cb80be43d5f2` 成功生成 1 条日事实和 11 条小时事实；自动对账逐字段 0 差异。
该已接受 batch 的远端 quarantine → current 消失 → 历史保留 → restore → current 恢复演练也已通过，
恢复后再次对账仍为 0 差异。R6 当前健康状态有意显示 `degraded`，唯一原因是保留了上述不完整 batch 的
quarantine 记录；处理、RAG、Agent 失败/过期租约及 Storage 血缘缺口均为 0，6 个 cron 均活跃。

CLI 验收结果：本地与远端 migration 20/20 对齐；远端 `public,private` lint 无错误；
`supabase db diff --linked --schema public,private` 返回 `No schema changes found`；7 个 pgTAP 文件共 63 项
全部通过。`res_api` API 22/22、Node unit 125/125 通过；Python RAG/POS worker Ruff 与 pytest 19/19
通过；提交前 `git diff --check` 和变更文件密钥扫描均通过。此前基座验收的 BakeryOps TypeScript、Vitest
（45 files / 463 tests）与 Next build 仍沿用；本轮没有改这些代码。Next build 既存 Turbopack warning 与
Python PyMuPDF/SWIG 弃用 warning 不影响本轮结果。

PDF/RAG 已完成一份 3 页样本的真实远端闭环：私有 bucket → 文档登记 → worker 解析/切块 → 6 chunks →
1536 维 embedding → 发布 READY → RPC 检索，精确页内问题能返回第 2 页。宽泛语义查询排序尚未达到业务
验收标准，因此只能确认技术链路可用，不能声称检索质量或桌面 `brain` 全量导入已完成。R6 独立 RAG
worker 使用 systemd encrypted credentials，只连接 R6，不改变旧应用数据库配置。

仍未做：历史 POS 批量回填、持续旧源增量、应用 shadow read、任何消费者切换、完整 `brain` PDF 分类与
质量验收。下一步在当前边界内可继续按日小批量执行“旧库只读 → R6 Raw → Processed → 自动对账”，每批
失败即 quarantine；不得直接改 `DATABASE_URL`。旧生产只读审计还发现
`mkt_birthday_profile`、`mkt_birthday_reservation` 未启用 RLS；不能只开 RLS 而没有配套 policy，否则可能
直接阻断现有调用，须另开变更窗口确认读写者与策略后处理。实施主文档为
`docs/database/hotcrush-r6-green-database-blueprint-v1.md`，CLI 手册为
`docs/database/hotcrush-r6-green-cli-runbook.md`，PNG/SVG/Mermaid 汇报图在 `docs/database/diagrams/`。

---

## See You Often 会员体系接管与生产差距审计（2026-08-20，Codex，在途/只读）

用户要求接管 WorkBuddy「查找关于H5页面制作的对话记录」，以 Lark《「See You Often」日常储值方案-
完整版》为权威方案，逐项确认歧义后完成 RES 等级/积分/储值/营销、RES 官方 H5、HBTI 发券和生日权益
全部落地。本轮已读原会话与 Lark 当前修订、核对本仓库和 RES 生产后台；没有执行 RES 写入、发券、
数据库 DDL/DML、部署或 H5 发布。Lark/RES 凭证只通过既有安全配置或临时进程使用，未写进仓库。

已确认的生日触达时点：定制生日蛋糕预约提前 5 天；免费巴斯克预约提前 2 天；生日贺卡网页与对应
生日券必须在生日当天发放。现有生日站点可复用，但当前只有手工签名链接生成、预约 API 与预约后 Lark
门店通知，没有 T-5/T-2/当天三段式会员触达调度；页面的统一取货窗口默认为提前 2 天至未来 30 天，
也尚未按蛋糕类型拆分。

生日代码与现网存在必须按用户确认修正的旧规则：`points_450` 当前为年度不限次、最多同时 3 个有效
预约；免费巴斯克与积分蛋糕互不排斥。生产表仅有“免费巴斯克每会员每年一次”的部分唯一索引，没有
积分蛋糕年度上限或两类权益二选一约束。生产聚合回读为 2026 年 1 条 `points_450/reserved/sent` 预约、
生日资料 0 条；未读取会员身份。当前待用户逐项确认的第一项仍是：Lv3/Lv4 的 450 积分升级是否都
每年生日限一次，或 Lv4 不限次数；确认前不改代码或生产约束。

HBTI 周边发券并非未实现：完成接口已接 9 种周边库存池，按实时剩余量加权随机抽取，再通过 RES 发
对应实体券，并带幂等、发券前后回读和人工复核状态。生产奖池 9/9 品项启用，初始库存合计 1,376，
当前 `issued_count` 合计 2；会员完成状态中本期有 4 条 `issued`。线上 `/api/health` 的 alert/db/res/
signIn 四项均为 ok。后续仍需做“奖池扣减数、RES 实际券、完成终态”的正式对账验收，不能只凭健康
检查宣称整条活动完成。

RES 生产只读审计结论沿用：等级阈值已建但权益为空；RM1=1 只证实成长值，不等于积分规则；滚动前
12 个自然月、降级、生日月锁级未配置；积分商城启用但 0 商品；相关券模板存在但营销触发链路缺失；
RES 官方正式 H5 尚未展示 First/Sweet/Hot/Forever Crush 等级品牌。下一步在逐项业务确认并行期间，
继续把 RES 原生能力与外接调度边界拆清，再按可回滚顺序实施。

---

## Supabase 企业数据架构与全代码访问审计（2026-08-20，Codex，只读/未实施）

用户要求质疑附件 `hotcrush_supabase_enterprise_data_architecture_v1.md`，并结合所有本地可发现的数据库
连接代码评估可行性、给出数据库重构方案。本轮读完附件、现有 R6/R6A1 设计与 gate，扫描
BakeryOps、`res_api`、HBTI、财务网站、根目录脚本以及新发现的 `/Users/weiliangshao/hr-agent`，并只读
查询 Source 生产库和 R6 Green；没有执行 DDL/DML、迁移、部署、环境变量修改或外部写入。

现网于 `2026-08-20T05:24Z` 核验：PostgreSQL 17.6，约 97.2 MiB，`public` 为 130 表/21 视图/
1,621 列；128 表启用 RLS、52 表 FORCE RLS、142 条 policy，缺 RLS 的是
`mkt_birthday_profile` 与 `mkt_birthday_reservation`。7 表无主键：
`app_user_role_pre083`、`cost_card_product_link_pre080`、`daily_revenue`、`finance_revenue_daily`、
`pos_member`、`pos_member_card_txn`、`pos_member_daily`。声称存在的表所有权注册表实际不存在；
`public.schema_migrations` 仍是全仓库共享整数版本，90 行、1–300，27 已被财务占用，且新 CN HR
迁移没有进入这张账本。旧 R6 快照只有 76 表/21 视图/939 列；现网相对它新增 54 张表且无删除，
正好是 52 张 `cn_hr_`/`cn_trn_` 加 2 张生日表，因此旧矩阵只覆盖 97/151 个当前对象。

活跃度不是假设：POS/会员/预测事实已写到 2026-08-19；`item_hourly_sales` 86,327 行、
`pos_member` 4,850 行、`pos_member_card_txn` 15,005 行、`forecast_snapshot` 2,304 行。CN HR/培训
52 表共 148 行、35 表非空；Auth 1 个用户，三个私有 Storage bucket 共 10 个对象。未安装
`vector`，`public` 无 publication table，故附件里的 pgvector/Realtime 目前只是愿景，不是现状。
R6 Green 于 `2026-08-20T05:24Z` 再核验仍为约 18.8 MiB、100 表/1,374 列/0 视图、业务估算行为空；
R6A1 gate 仍为 `BLOCKED / DESIGN_ONLY_NOT_COMPILED / NOT_APPLY_COMPATIBLE`，不能接管生产。

代码证据中的主要风险：`daily_revenue` 仍有 POS 与财务旧客户端两条写路径；`pos_member` 由
`res_api` 和 HBTI 靠“不相交列集”共同写；`daily_breakdown` 的 dining 数据把 30 日比例扇出成逐日行，
不能迁成真正日事实；BakeryOps/`res_api`/财务的直连配置分散且本地连接均使用共享 `postgres` 身份。
HR Agent 的通用 `supabaseAdmin` 在 65 个运行时文件出现，server context 默认注入 service-role，worker
也直接使用 service-role；现网确认 `service_role` BYPASSRLS 且不是 `cn_hr_worker` 成员，所以已有
`cn_hr_worker` 窄权限设计实际上没有约束当前 worker。商品身份并非全面失控：
`v_product_identity` 211 个 listing 中仅 47 已映射，但排产所需 47/47 全部已映射；应优先解决
25 个断货名差异，而不是立即创建通用 `mdm.item/product/sku` 大模型。

审计结论：附件可保留单写者、稳定身份、Owner/Writer/Grain/Source/Retention/PII、AI 不直写事实、
Batch 先于 CDC 等原则；但不能作为实施稿。`daily_revenue → mart_store_daily` 混淆来源事实与 Mart，
`sales.order/payment/refund` 在缺少完整原子来源时不可从汇总反推；Phase 1 先拆十多个 schema 与当前
`public` 前缀治理及所有调用方式冲突；Analytics 双项目、CDC、pgvector、Realtime 应按真实负载和用例
触发，不应因 Supabase 提供就全开。建议继续把当前 Source 作为唯一 OLTP 真源，R6 Green 只作无真实
PII 的迁移演练库，按“治理/权限 → POS 垂直切片 → 会员/HBTI 单写者 → 财务边界 → CN HR service-role
收敛 → 可选分析副本”顺序 expand/verify/contract；不要部署旧 R6 的 100+ 表包。

本轮仓库内只追加本交接节。开工时已有 `HANDOFF.md` 未提交改动且当前分支是既有活跃分支
`codex/fabric-agent-blueprint`；未覆盖或拆分他人记录，本文件继续作为该分支已登记的唯一未提交变更。
审计工具意外忽略 `--help` 并刷新过旧 `code-access-snapshot.json`，该本轮副作用已完整撤销，证据快照保持原状。

---

## 单店 Supabase 分级架构建议（2026-08-20，Codex，只读/未实施）

用户进一步明确：重点不是照搬 Microsoft Fabric，而是保留截图中的分层思想，在目前仅一家店的规模下尽量
统一使用 Supabase。建议采用“单一 Supabase 生产项目 + 外部轻量 worker”的模块化数据单体：Supabase
统一承载 PostgreSQL 真源、Auth、Storage、短任务调度、认证指标视图与 Agent 状态；POS 爬虫、Playwright、
长时间 AI/消息任务继续在 tokyo-01/Vercel worker 运行，只把状态、队列、审计与结果写回 Supabase。不能把
“统一数据平台”误解为“全部计算都塞进 Edge Functions”。

推荐的数据可信度分级为：L0 来源证据/批次，L1 经约束的业务事实，L2 认证指标视图/必要时物化视图，
L3 预测、告警与建议，L4 经审批的动作和反馈；AI 只读 L2、写 L3/L4，不改 L1。当前先做治理与权限、
POS 垂直切片、认证指标和 Agent 闭环，不建 Fabric、独立数仓/Analytics 项目、CDC、读副本、分区或通用
MDM。第二家店仍应在同库用 `location_id` 扩展；只有分析负载实测干扰 OLTP、恢复/合规边界改变或团队需要
独立发布节奏时，才拆分析库/数仓。

本轮只查看用户截图、复用同日只读审计，并核对 Supabase 官方定价、Branching、Cron、Queues、Edge
Functions、备份与物化视图文档；未执行数据库写入、文件代码修改、部署、分支切换或外部写入。仓库内只
追加本交接节，既有 `HANDOFF.md` 未提交状态与 `codex/fabric-agent-blueprint` 活跃分支保持不变。

---

## Brain PDF / pgvector 知识库设计（2026-08-20，Codex，只读/未实施）

用户确认大量未入库 PDF 位于桌面 Brain 文件夹。实际路径不是普通 Desktop 目录，而是 iCloud Obsidian
仓库 `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw`。只读盘点到
165 份 PDF、逻辑大小约 68.45 MiB：HR 114、General 42、Marketing 2、Supply_Chain 7。按路径关键词粗分：
候选人/简历/Offer 49，薪酬/工资/绩效 27，财务凭证/报销 25，制度/手册/组织 46，合同/授权/入离职表单
8，营销/品牌 2，知识库/技能资料 2，其他 6。基于同文件名+同逻辑大小识别 41 组/86 个重复候选；这只是
候选，不是已确认重复，因为开始盘点时 161/165 个文件是未本地化的 iCloud placeholder，批量 SHA-256
读取会等待云下载，已终止该只读进程，未伪称完成哈希去重。

为验证管线差异，本轮仅请求 iCloud 下载 5 个代表样本到本机缓存，没有修改云端文件；连同原本本地化的
4 个样本做 PDF 文本与页面渲染检查。确认至少有五种不同形态：67 页制度手册约 73,934 可提取字符；
1 页简历样本仅 1 个可提取字符、必须 OCR；3 页工资汇总约 20,952 字符且为密集表格；25 页品牌手册约
9,688 字符但图像主导；8 页组织架构约 11,647 字符且为关系图。另有 11 页文本合同、可提取文本的
一页价格对比表及两份表单渲染版本。结论是不能统一走 `pdftotext -> 固定切块 -> embedding`：制度/SOP
按标题切块；图像简历走 OCR 后抽取结构化候选人字段；工资/发票优先写受控业务事实而非全文 RAG；品牌
手册逐页 OCR+视觉摘要；组织架构抽关系；合同按条款切块且仅限法务权限。

推荐所有原件进 Supabase 私有 Storage，不把 PDF 二进制放 PostgreSQL；按权限边界分
`kb-internal`、`hr-recruiting-private`、`hr-payroll-private`、`finance-private`、`legal-private` 五个 bucket，
对象路径使用不含姓名的 `space_id/document_id/version/original.pdf`。数据库采用 `ai_` 写者域：
`ai_knowledge_space`、`ai_space_member`、`ai_document`、`ai_document_version`、`ai_ingest_run`、
`ai_document_page`、`ai_document_chunk`、`ai_embedding_model`、`ai_chunk_embedding`、
`ai_retrieval_event`、`ai_retrieval_hit`。原件、版本、页、块、embedding 分离；只查询 current/published
版本；同一安全空间内按 SHA-256 去重；跨权限空间不共用物理对象。检索采用权限/有效期过滤后的
全文+向量混合检索，V1 建议评估 BGE-M3 1024 维；初期块数很小先精确向量扫描，不提前建 HNSW，达到
约 100k 块或实测延迟不达标后再建。C3/C4 PII 文件默认不 embedding，或只对脱敏文本在受限空间建索引。

本轮没有上传任何 PDF 到 Supabase、未启用 `vector` 扩展、未执行 DDL/DML、未创建迁移、未改业务代码、
未部署。只追加本交接节；PDF 渲染中间文件在完成视觉检查后删除。最终答复提供可用于汇报的 Mermaid
数据结构图。

概念澄清：上述整体是“文档治理 + 多类型解析 + 权限感知的混合 RAG”平台；只有 chunk/全文索引、
embedding、检索、上下文注入和带引用生成属于 RAG。Storage、版本、去重、RLS、OCR，以及工资/凭证/简历
抽取到结构化业务表，分别属于文档管理、治理和 ETL，不应全部笼统称为 RAG。

---

## Supabase + PDF/RAG 架构蓝图与 CLI 可行性验证（2026-08-20，Codex，本地验证/未实施生产）

用户要求开始设计单项目 Supabase 架构，并验证整条流程能否全部通过 CLI 完成。本轮完成两份正式设计稿：
`docs/database/supabase-rag-v1/README.md` 与 `docs/database/supabase-rag-v1/CLI-RUNBOOK.md`。结论需要严格
区分：整条流程可以由命令行组合自动化，但不能只依赖 Supabase 官方 CLI。Supabase CLI 负责本地栈、迁移、
测试、类型、函数、密钥和 Storage；PDF 盘点、人工分级、OCR、版面/表格解析、切块和 embedding 仍需计划中的
`brainctl` 与外部受控 worker。Supabase 是统一数据/治理平面，不是长耗时计算容器。

蓝图采用一个生产 Supabase 项目、`public` schema 前缀治理和 L0 来源证据/L1 业务事实/L2 认证指标与知识检索/
L3 AI 建议/L4 审批动作分级。PDF 按 C1 内部、C2 受限、C3 个人机密、C4 密封分级，继续使用五个私有 bucket；
设计了 12 张 `ai_` 表，覆盖知识空间、成员、文档、来源、版本、摄取运行、页、chunk、embedding 模型/向量及
检索事件/命中。C4 禁止 chunk/embedding，C3 默认禁止；检索必须先过滤调用者可访问的 space，再做全文与
pgvector 排名并保留页码引用。初期 exact vector scan，不提前建 HNSW。

发现并纳入重构的现有冲突：`bakery-ops/services/lightrag` 已有 LightRAG，但 21 份 full docs 和图/向量均存在
本机忽略目录的 JSON/GraphML 中，使用 OpenRouter 1536 维 embedding；不能和 Supabase pgvector 同时作为知识
真源。方案把它定义为待迁移派生索引：先审查 C1/C3 内容，只重嵌合规材料，BakeryOps 切换到 Supabase RPC 后
再停写和清理。

平台原语在完全隔离的 `/tmp` Supabase 项目中实测，未连接生产：Docker 默认 54322 被现有 `aural` 本地项目
占用，因此改用 55320–55329 端口，未停止或修改 `aural`。Supabase CLI 2.115.0 下，Postgres 17、Storage/API、
`vector` 扩展、`tsvector`+GIN、cosine 查询、RLS enable、完整 `db diff`、`db reset --local`、`db lint`、
security advisor、TypeScript 类型生成和 pgTAP 均跑通；私有 `kb-internal` bucket 也成功用仓库内非敏感架构
PDF完成本地上传/列举/`storage.objects` 回读。隔离容器已停止，临时目录已删除。

两个 CLI 限制已实证：① `db diff --schema cli_validation,extensions` 会漏掉 `vector` 扩展依赖并失败，完整 diff
才成功，因此 pgvector 扩展迁移必须手写并用 reset/test 验证；② `storage cp/ls` 在 2.115.0 仍强制要求
`--experimental`，正式 Brain 导入不应直接递归复制，而应使用有 manifest、hash、分类阻断和幂等补偿的
`brainctl`。另一个小坑是 `supabase test new` 生成的 pgTAP 模板只有 `plan(1)` 没有断言，直接运行必失败；
加入真实断言后才通过。

当前仅创建设计文档并更新本交接，没有创建正式 migration/worker、没有上传 Brain 文件、没有执行生产 DDL/DML、
没有重链 CLI 项目或部署。根目录 `supabase/.temp/linked-project.json` 仍指向 `hotcrush-core-r6-green`，任何远程
命令前必须核对目标。当前活跃分支仍是 `codex/fabric-agent-blueprint`；`HANDOFF.md` 的既有未提交审计记录和本轮
两份新文档继续作为同一设计工作在途，未提交是为了避免把多个尚待用户确认的架构主题打包成一个提交。

---

## 五层 Supabase 内部总体架构收敛（2026-08-20，Codex，设计完成/未实施）

用户指出上一版把主架构与 RAG 表级治理混在一起，正确主线应是“统一写入入口 → Raw → 预处理/RAG → Agent
→ 用户交互”。该批评成立；但“一个写入源”已校正为逻辑统一入口与每表唯一写者，而不是所有程序共享一个
超级账号或单进程。新主文档为 `docs/database/hotcrush-supabase-internal-architecture-v1.md`，原
`docs/database/supabase-rag-v1/README.md` 已明确降为 PDF/RAG 详细附录。

新架构把 Auth、RLS、Storage policy、审计、迁移和备份作为贯穿能力，不再画成业务层。Supabase 内部只保留
一条数据链：外部来源经 Ingestion Gateway 进入 Raw；Raw 包含 Storage 原始对象、批次/hash 元数据和与来源
同粒度的关系事实；预处理层只产出业务域事实、认证指标 view 与 RAG 知识；Agent 只读预处理层、写运行与
追加事件；Web/Lark/WhatsApp/报表通过 RLS/RPC 交互。tokyo-01/Vercel/Mac 只是计算或交互节点，Supabase 是
唯一数据真源。

V1 新增表从上一版 12 张 RAG 表收敛为总共 10 张：Raw 控制的 `ops_raw_batch`/`ops_raw_object`；RAG 的
`ai_knowledge_space`、`ai_space_member`、`ai_raw_document`、`ai_ingest_run`、`ai_document_chunk`、
`ai_chunk_embedding`；Agent 的 `ops_agent_run`/`ops_agent_event`。结构化处理结果写回既有 `pos_`、`ops_`、
`hr_`、`scm_`、`mkt_`、`finance_` 等域，不建通用 `processed_data`；指标优先建 view；现有 `ai_call_log`、
`pipeline_health` 和消息状态表复用，不造重复表。RAG V1 不拆 document/version/page/retrieval-hit 表，逐页 OCR
产物进 Storage，chunk 直接存页码；只有真实需求出现才拆。

文档同时给出完整 Supabase 组件映射、六个预计私有 bucket、统一写入契约、角色/RLS 矩阵、RPC 边界、任务
租约、索引策略、审计/恢复、部署拓扑、POS/PDF/工资三条端到端数据流、五阶段实施顺序和明确不建设清单。
本轮没有执行工具能力复测、正式 migration、生产 DDL/DML、文件上传、CLI 重链或部署。当前工作树的两份
RAG 文档、新总体架构与 HANDOFF 仍属同一尚待用户确认的设计工作，继续保留未提交状态并已登记。

后续向用户澄清了 Supabase Dashboard 中的物理呈现：五层不是五个 schema 或五组可折叠目录；在继续采用
单一 `public` schema 的前提下，Table Editor 会把现有表与 V1 的 10 张新增表按前缀/名称展示。Raw、RAG、
Agent 主要落为 `ops_`/`ai_` 表，业务处理结果继续落在现有域表，认证指标落为 view/materialized view；PDF
原件在 Storage 的私有 bucket，RPC 在 Database Functions，`vector` 在 Extensions，RLS 在各表 Policies，
Edge Functions 与 Realtime 分别在控制台对应页面。若现网 130 张表不先清理，V1 单纯新增 10 张后约为
140 张表；该数字是基于当前快照的实施估算，并非已落地事实。已用 Supabase 官方 Dashboard/Table Editor、
Storage bucket、Database Functions、RLS/Data API 文档复核上述控制台映射；未执行任何生产写入或迁移。

进一步澄清了层间自动交互：不采用“定期把 Raw 全量复制到上一层”，而采用“写入完成即建立 PENDING 任务、
外部 worker 增量领取并幂等发布、Supabase Cron 定时唤醒/回收过期租约/补漏对账”的混合模式。普通 view 无需
刷新，materialized view 才需在上游成功后或 Cron 中刷新；Agent run 由业务计划或用户动作创建，审批/反馈以
`ops_agent_event` 追加并通过 Realtime 回显。PDF 上传后由 `ai_ingest_run` 记录完整状态机，OCR/版面解析/
embedding 继续由 tokyo-01 worker 执行，不放进受运行时限制的 Edge Function。

该问题暴露了当前 10 表蓝图的一个边界：`ai_ingest_run` 足以追踪 RAG，但 `ops_raw_batch` 只能粗略表示结构化
导入状态；当一个非文档 Raw 批次会扇出多个 processor 时，需要逐处理器的运行/租约/重试记录。实施前应先
审计现有 `pipeline_health` 是否可兼容承担运行账本；若不能，建议新增第 11 张 `ops_processing_run`，一行代表
`raw_batch × pipeline_key × pipeline_version`。单店 V1 不建议同时再启用 PGMQ 队列，避免任务表和消息队列
双重状态；只有并发和吞吐实测需要时再引入 Supabase Queues。已复核官方 Cron、Queues、Database Webhooks、
Edge Function 调度/限制文档；本轮未改正式架构文档、未创建迁移、未执行生产写入或部署。

## Supabase 数据平台实施蓝图 v2（2026-08-20，Codex，设计完成/未实施）

用户要求把前述概念收敛为“当前生产库到目标蓝图”的详细修改方案，包含新数据如何自动进入上层、新 PDF
如何自动 RAG、定时任务、表结构、代码改造和迁移顺序。新的实施主文档为
`docs/database/hotcrush-supabase-implementation-blueprint-v2.md`（1,265 行）；旧
`hotcrush-supabase-internal-architecture-v1.md` 已标为概念背景，RAG README 已标为早期 12 表历史，CLI
RUNBOOK 只保留已实测能力和门禁。若文档冲突，以 v2 为准。

关键结构决定已经从“10 张核心表”正式更新为 11 张：`ops_raw_batch`、`ops_raw_object`、
`ops_processing_run`；六张 RAG 表 `ai_knowledge_space`、`ai_space_member`、`ai_raw_document`、
`ai_ingest_run`、`ai_document_chunk`、`ai_chunk_embedding`；两张 Agent 表 `ops_agent_run`、
`ops_agent_event`。本轮读到 `pipeline_health` 的真实 DDL：它是空表、没有消费者/写入方，只能按
`source_key` 保存最近一次状态，无法表示逐批次 processor、版本、租约、重试和输出水位，因此不能复用为
运行账本；v2 将其扩展为由 run 汇总的健康摘要。若当前 130 张表不先清理，单纯新增 11 张后约为 141 张；
这是基于 2026-08-20 快照的估算，实施前必须重查。

自动化主模式为“完成 Raw 批次/受控 PDF 上传时幂等创建 PENDING run；tokyo-01 worker 用 RPC +
`FOR UPDATE SKIP LOCKED` 和租约增量领取；输出按自然键 UPSERT/分批暂存；最后短事务原子发布；Supabase
Cron 每 5 分钟回收过期租约和补漏、每 10 分钟汇总健康、每日 00:30 KL 对账血缘”。普通 view 不刷新，
物化 view 才在上游成功后刷新并由 Cron 兜底。当前不启用 PGMQ，避免任务表和队列双重状态。

PDF 新流程是“签名路径 → private Storage → `ai_finalize_document_upload` → 分类策略 → `ai_ingest_run` →
外部 worker OCR/版面解析/切块/embedding → 50–100 chunk 分批 stage → `ai_publish_ingest_run` 原子切换”。
只有已批准 C1/C2 自动 RAG；C3 默认复核/只允许脱敏文本，C4 禁止 chunk/embedding。Dashboard 随手上传不
视为正式入口，初始 Brain 必须走计划中的 `brainctl inventory/classify/review/upload/validate`。向量列 v2
暂定沿用现有可用的 1536 维模型以减少实施变量，但中文/英文/马来文仍必须通过 30–50 个真实问题 golden set；
未通过时必须在正式向量 migration 前换模型，不能把暂定值冒充最佳模型。

v2 同时列明当前库修改：独立修复两张生日表 RLS；让 `res_api` 成为 `daily_revenue` 唯一写者，财务站停止
写；把 HBTI 状态从 `pos_member` 移回现有营销事实；给首批 POS 活跃链加 nullable batch/run 血缘；扩展
`ai_call_log` 做 Agent 引用、脱敏和保留；验证后补五张活跃无 PK 表，两个 `_pre*` 历史表另行处置；冻结多
仓库整数 migration，采用根目录 Supabase 官方迁移账本。代码改造按 `res_api`、BakeryOps、财务站、HBTI、
HR Agent、brainctl/AI worker 分责，并以 Phase 0 治理 → 控制表 → POS 垂直切片 → C1 RAG → Agent闭环 →
Cron/LightRAG切换 → 权限收紧顺序 expand/verify/contract。

文档已检查 11/11 表名、40 个 Markdown fence 和 tracked diff，均通过；没有创建正式 migration/RPC/Cron/
worker，没有安装生产扩展，没有连接或修改生产库、R6 Green、Storage、Brain 文件或部署。当前仍在既有
`codex/fabric-agent-blueprint` 分支；`HANDOFF.md` 与 `docs/database/` 下三组未提交设计文档属于同一持续
架构主题，已登记但未提交，避免在用户尚未批准实施前把设计稿误作生产变更。

---

## 海外业务运营与招聘复盘周会纪要（2026-08-17，Codex，已发布到 Lark）

用户提供一份将多人语音合并到 Kevin 名下的会议摘要，并给出 7 个 Lark 链接（其中财务周报
`Sr1vwBjTQixNLjkIrdXj8i2xpZg` 重复，实际为 6 份唯一材料），要求根据每个人的真实工作重新归属，
生成可直接提交的正式会议纪要。本轮使用 `hot-crush-weekly-report` 技能，通过 Lark API 实时读取并
锁定六份来源修订：牛梦珊/营运、Kevin Liu/人事招聘与工签、黄婧雯/培训、张雅楠/财务与公司注册、
邵伟亮/技术与数据架构、邵雨珠/市场投放；没有沿用错误的 Kevin 单一发言人标签。

成品已发布：`https://fjpks7iroa9l.jp.larksuite.com/docx/FhxTdghSkokHQzxxDGfjTxiNpyb`。文档标题为
“8.17 海外业务运营与招聘复盘周会纪要”，使用 68 个原生 Lark 文档块，包含会议核心结论、六位负责人
复盘、13 项行动项与截止时间、风险管理要求及六份依据材料。指定用户已获 `full_access`，组织内链接
权限为 `tenant_editable`；发布后回读 revision 5，标题、六位发言人、关键事项、来源修订和权限检查
全部通过，且成品不含“确认/推断/待确认”等内部判断标签。

用户随后反馈正文全是文字、阅读负担高，要求提供一个清晰表格。本轮先重新读取在线 revision 5，确认
用户尚未做新的人工修改；随后在文档最前面新增“快速阅读版 → 负责人工作总表”，表格为 `7×5`：
表头是负责人、职责领域、关键进展、下一步、截止，六位发言人各占一行。原会议基本信息与提示仍在
最上方，原 68 个详细正文块整体后移且内容、顺序、来源链接均未改变；最终回读 revision 15，表格
逐格与预期完全一致且只出现一次。第一次尝试批量创建三张表时 Lark 返回
`1770001 invalid param`，该失败调用没有写入；按官方表格创建规则改为单表、逐行扩展后成功，没有
盲目重试失败请求。成品链接保持不变：
`https://fjpks7iroa9l.jp.larksuite.com/docx/FhxTdghSkokHQzxxDGfjTxiNpyb`。

事实修正：市场原摘要混用了不同截止口径。按 8/3、8/6、8/10、8/13 四个投放节点明细相加，统一写为
投入 RM11,526、目标曝光 500 万、实际约 713 万、达成率约 142.6%，没有继续使用互不匹配的
“RM9,300/目标400万/实际714万”。同时将“工程方责任、门店不承担费用”改为顾客处理、证据固定、
工程追偿并行，最终责任以合同、调查和法律意见为准；工签过渡方案增加持牌服务商/当地律师审核条件，
没有把未经核验的签证操作写成既定合规方案。

本轮没有修改业务代码、数据库或部署。辅助读取/发布脚本放在既有 Lark 任务目录
`/Users/weiliangshao/Documents/Codex/2026-08-03/lark-lark-cli-appid-cli-aa82af2c7878de17/`，凭证仅通过
无回显交互输入进入临时进程，未写入脚本、命令参数、产物或交接文件。开工时仓库位于既有活跃分支
`codex/fabric-agent-blueprint` 且工作区干净；本轮仓库内只更新本交接文件，故不把非代码 Lark 任务
提交混入该主题分支，`HANDOFF.md` 将作为已登记的唯一未提交变更保留。

---

## AI 招聘流程图纵向极简版（2026-08-16，Codex，已生成/未部署）

用户提供参考截图，明确要纵向黑白极简流程而非横向信息图。已查看参考图并重绘 9:21（1152×2688）
版本：`output/imagegen/hot-crush-ai-recruitment-flow-vertical.{png,svg}`；采用白底、浅灰圆角框、细灰
箭头、左右决策分支，每个节点内以浅灰小字写负责工具，完整覆盖 Boss → boss-cli → 简历/硬条件 →
Aural → Lark/面试官 → 二面预约。imagegen 仍因 TeamoRouter 缺 active Codex base_url/api_key 无法
连接，且无 Action URL，故按已告知的回退方案用 SVG 精确绘制并本地渲染检查。无生产代码/数据库/部署
变更。

---

## AI 招聘流程图工具责任标注版（2026-08-16，Codex，已生成/未部署）

用户要求在流程图上标出各环节负责工具。imagegen 再次因 TeamoRouter 缺 active Codex
base_url/api_key 无法连接，按已告知的回退方案直接编辑 SVG；新增节点级责任徽标与图例，区分 Boss
平台、boss-cli、HOT 招聘 Agent、Aural、Lark/面试官。标注版 PNG 位于
`output/imagegen/hot-crush-ai-recruitment-flow-tools.png`，可编辑 SVG 同目录；原始无标注 PNG 仍保留。
已本地渲染检查中文与布局。没有修改生产代码、数据库或部署。

---

## AI 招聘 Agent 流程图图片（2026-08-16，Codex，已生成/未部署）

用户要求把上一节完整招聘流程变成图片。imagegen 技能因 TeamoRouter 未连接（缺 active Codex
base_url/api_key）无法调用，已明确告知并改用本地 SVG 矢量绘制；生成 2048×1152 PNG 与可编辑 SVG：
`output/imagegen/hot-crush-ai-recruitment-flow.{png,svg}`。图片包含 Boss 新消息、简历获取/筛选、
Aural AI 面试、逐题评分、Lark 人工审批、Agent 约二面和自动提醒，并用珊瑚色/金色区分 AI 自动执行与
人工决策点。已用本地渲染检查中文、布局和分支连线；没有修改生产代码、数据库或部署。

---

## Boss Agent 全招聘链路 + 开源 AI 面试研究（2026-08-16，Codex，只读研究/未实施）

用户提出 Boss 简历获取 → 筛选 → AI 初面 → 评分 → Lark 面试官审批 → Agent 回 Boss 约二面的
完整闭环。本轮核对现有招聘代码、boss-cli 与开源/商业 AI 面试产品，没有安装依赖、登录 Boss、发送
消息、执行 DDL/DML、修改生产代码或部署。结论是链路可实现，但 boss-cli 当前仅明确支持读取未读、
发文本、索要/预览简历和打招呼，未证明可稳定下载完整简历、提供消息事件或处理验证码；实施前必须做
真实账号 P0 spike。现有 candidate scorer、application/appointment、WhatsApp FSM、Lark recruitment
service 可复用，Boss 应作为可暂停的渠道适配器，状态机与审计留在 HOT 系统。

AI 面试首选评估 Aural（MIT，Next.js + Supabase，自托管，中英、语音/文字/视频、分享链接、逐题评分、
报告、REST/OpenAPI）；备选 FoloUp（MIT、关注度高，但语音依赖 Retell 且集成 API 较弱）。建议 Aural
作为 tokyo-01 独立服务，不直接共享业务表，通过受限 API/回调接入；先做文字/语音结构化初面，不做
表情、口音或情绪推断。商业备选公开价：InterviewAI Async $19/$39/$99 每月，Interview Express
约 $1.50/30 分钟 AI 面试，Odevio $0.05/分钟（Pro $100/月另加分钟费），InterviewAgent $149/月
100 场、$399/月 500 场，Hyring $79/$239 月但信用点消耗需另核实。下一步若批准，只做 P0：一个岗位、
测试账号、10 名内部候选人，验证 Boss 简历取得/外链、Aural API、评分一致性、Lark 审批与幂等二面消息。

---

## boss-cli / 猎聘同类工具核验（2026-08-16，Codex，只读研究/未实施）

核对 boss-cli 当前仓库：它可用 `boss send` 向当前会话发消息、`list --unread` 读未读、
`action resume` 索要简历、`greet` 打招呼，并可供外层 Agent/定时器编排；但自身是纯 CLI，README
未提供常驻监听/自动回复 daemon，也未说明验证码处理，因此“自动回复”需要另写轮询、状态机、限流与
人工接管。它通过 CDP 控制本机 Chrome、复用登录态，并非官方 API。猎聘未找到成熟的同等级开源
CLI；目前可见替代包括猎聘官方 AI 账号/AI 招聘顾问，以及八爪鱼 RPA 的猎聘自动打招呼/追聊应用，
后者同样是预登录浏览器 RPA、非官方 API。没有安装、登录、发消息或修改生产代码。

---

## Boss / 猎聘自动回复外部申请链接核验（2026-08-16，Codex，只读研究/未实施）

承接上节继续核验。公开官方资料可确认 Boss 有站内直聊、推荐与双方同意后收简历，猎聘有站内沟通
以及“多面”ATS/AI 面试产品；但截至本轮未找到两平台公开的企业消息 API，也未找到官方明确承诺
普通企业账号可以无人值守自动回复并发送第三方申请链接。第三方 Boss 自动化工具确实能通过
Chrome/CDP 发消息、索取简历，但不等于平台授权，不能据此判断合规或封号风险。建议用真实企业
账号向两平台商务书面确认消息 API/ATS 对接、自动回复、外链、简历导出与海外处理五项；确认前采用
AI 生成回复、人工一键发送，链接后的申请/筛选/AI 面试全自动。

---

## Boss / 猎聘 AI 招聘替代研究（2026-08-16，Codex，只读研究/未实施）

用户希望用 AI 替代搜简历与面试，重点是 Boss 直聘、猎聘。本轮只读核对仓库现状、平台公开能力与
中国个人信息/自动化决策规则；没有登录或操作平台，没有抓取简历、发送消息、执行 DDL/DML、修改
生产代码或部署。结论：面试前筛与结构化面试可高度自动化，但录用/淘汰不应纯自动；搜简历的核心
瓶颈是平台授权和数据权，不是模型。优先向两平台申请企业级正式集成/导出能力，并以人工触发的
浏览器副驾驶作过渡；不把无人值守爬虫、验证码绕过或批量自动招呼作为生产核心。仓库已有
JobStreet connector、JD parser、candidate scorer/deduper、WhatsApp FSM、appointments 与招聘日报，
可复用为统一 ATS 中台；Boss/猎聘仅做渠道适配器。建议先选一个高频岗位做 4 周 shadow pilot，
以合格到面率、人工复核推翻率、每个到面成本、爽约率和试工通过率验收。

---

## HOT CRUSH DeepSeek Harness 专项蓝图（2026-08-16，Codex，设计完成/未实施）

用户在决定保留 Supabase、暂不把 Fabric 作为前置依赖后，要求基于 `hot` 当前代码设计
DeepSeek Harness。已在活跃分支 `codex/fabric-agent-blueprint` 新增
`docs/agent-platform/hotcrush-deepseek-harness-blueprint.md`，并从 Core V1 `README.md`
登记入口。本轮只读检查代码和官方 DeepSeek Harness 资料：**没有安装 Harness、没有修改
生产代码、没有 DDL/DML、没有切换模型/连接串、没有部署。**

已确认的代码事实：

- 当前 15 个 Skill + 三层 IntentRouter + 多轮状态已经是一套轻量自研 Harness；真正缺口是统一、
  不可绕过的身份、Tool 权限、审批、幂等和事务审计，而不是先增加更多 Agent。
- `SkillDefinition.permissions/riskLevel/requiresConfirmation` 没有形成中央执行管线；
  `employee_management`、`resume_upload` 等真实写入能力仍标为 low/no-confirm，部门解析也有
  observe-only/fail-open 路径，不能用于企业写操作。
- 当前 AI Provider 会把完整 Prompt/响应写 `ai_call_log`；HR/简历/电话和经营数据接入 Harness 前
  必须先经统一 Model Gateway 与脱敏策略。
- Lark/WhatsApp、Web、Agent 和 Cron 目前混部；候选人状态机、Cron、Outbox 和外部重试应继续用
  确定性代码，不应包装成自治 Agent。

专项设计结论：

- Supabase PostgreSQL 继续是唯一事务真源；Fabric 仅是未来可选分析层，不进入 Agent 在线链路。
- 锁定 DeepSeek Harness commit，通过 HOT Bundle/Context/Policy/Domain Tools/Audit 插件接入，
  不 fork；生产 Profile 明确移除 Bash、FS write、任意 Web、Subagent 和通用数据库执行器。
- 15 个 Skill 全部映射为 Query / Draft / Command / Publish / Worker；首批只接
  `ops.get_daily_facts`、`forecast.get_review`、`inventory.get_stock`、`knowledge.search` 四个 R0 Tool。
- 首期只设 `hc-ops-readonly`、`hc-production-draft`、`hc-hr-coordinator` 三个服务器选择的 Profile，
  不建设多 Agent 自由协作。
- R2/R3 必须采用 prepare → 人工批准精确 payload hash → 幂等事务 commit → Outbox 的统一管线；
  解雇、提权、批量人员变更等保持双人审批或只生成操作单。
- 建议先在 tokyo-01 以 localhost 独立进程运行，旧 Orchestrator 保持整会话回退；Phase 0–5 依次为
  特征冻结、影子路由、只读、草稿、HR 敏感解析、正式 Command。

核验：15/15 Skill 均有唯一处置；DeepSeek 官方 `apps/cli/package.json` 与根 `package.json` 均为
`0.1.0-rc.5`，仓库为 developer preview；官方 Node 要求为 `^22.19.0 || >=24.0.0`，本地
`v24.4.1` 满足但 tokyo-01 尚未核对；文档 `git diff --check` 通过。未跑应用测试，因为只新增
架构 Markdown 和索引入口，没有改运行代码。

下一步若用户批准实施，只做第一条竖切：渠道消息 → ActorContext → `hc-ops-readonly` → 单个有限
Query Tool → 带日期/范围/来源的回答；先写 Profile 能力快照、权限矩阵、数字忠实性和 PII 泄漏测试，
再安装锁定版本，不要先建 10 张表或重写全部 Skill。

---

## Fabric + DeepSeek Harness + PostgreSQL 目标架构（2026-08-16，Codex，设计完成/未实施）

用户要求基于当前项目、生产库、R6 Green 和最小事实原则设计 Fabric 与企业 Agent 平台。
已在活跃分支 `codex/fabric-agent-blueprint` 新增
`docs/database/hotcrush-core-v1/12-fabric-agent-platform-target-architecture.md`，并登记到该目录
`README.md`。本轮只做只读核验和设计：**没有执行 DDL/DML、没有创建 Fabric 资产、没有激活
Fabric Trial、没有切换连接串或部署。**

关键事实与结论：

- 2026-08-16 只读实时核验：生产 PostgreSQL 17.6 约 92.6 MiB，`public` 78 表/21 视图，
  68 张表有数据；最大表 `item_hourly_sales` 85,132 行；已有一条真实生日预约。此前“项目均未落地”
  不成立，迁移必须保 POS/会员、HBTI/生日、招聘、财务/成本和消息功能。
- R6 Green 约 18.8 MiB，100 表/1,374 列/0 视图，业务表为空；100/100 表强制 RLS 但 0 policy，
  尚无应用连接。R6A1 是 105 表/1,470 列的设计 overlay，明确不可直接应用。因此先冻结 R6A2，
  再重建空 Green、确定性回填、shadow read、分域蓝绿切换。
- PostgreSQL 保持唯一 OLTP 事务真源；Fabric 只承接 Data Factory 增量复制 → OneLake/Lakehouse
  replica → Warehouse 认证视图 → Power BI 语义模型。不要把现有 PostgreSQL 改成 Fabric SQL
  Database，也不要做 Fabric → PostgreSQL 通用回写。
- DeepSeek Harness 最大化复用但不 fork：锁定版本，通过 HOT CRUSH identity/policy/domain-tool/
  approval/audit/session-export 插件接入。Agent 无裸 SQL、裸 Bash 或数据库凭据；业务写动作只能走
  类型化 Command API、幂等、审批、事务、outbox 和审计。
- 设计补齐 10 张 `ai_` 运行契约表、4 个首期 Agent/路由角色、R0–R4 工具风险、Fabric Workspace/
  Lakehouse/Warehouse/semantic model 结构，以及 Phase 0–6 的迁移与验收门禁。
- 旧 current-to-target 矩阵只冻结了 76 张表，当前生产已是 78 张；R6A2 必须刷新矩阵并覆盖新增生日表，
  不能沿用旧数字宣称覆盖完成。

下一步仅建议做设计/迁移准备包：① 冻结 R6A2 权威模型；② 生成 10 张 Agent 表的声明模型和
**未执行**迁移草案；③ 给四个消费者建立 SQL/功能契约测试；④ 在 Fabric Trial 激活前批准区域、
数据驻留和成本边界。该分支为已登记的活跃设计分支，待用户评审后再决定是否继续 R6A2 编译。

---

## 权益分配二次修订：L1 只有贺卡、L2 只有免费巴斯克、L3/L4 二选一（2026-08-15，DSH，已合入并部署）

用户再次修订生日权益分配，已实现上线：

- **L1 初见**：只有电子贺卡，没有任何蛋糕权益（权益屏显示贺卡说明 + 升级提示，
  预约屏显示「贺卡已经送到，不用预约」）；
- **L2 心动**：只有免费巴斯克（每年一份）；
- **L3 热爱 / L4 挚爱**：**二选一**——免费巴斯克（每年一份）**或** 450 积分兑换
  （L3 限自己、L4 可送亲友）。两者独立判定：免费巴斯克领过只灰掉免费选项，
  积分选项不受影响（反之亦然）。
- 实现：权益模型从「等级→单一规则」改为「等级→可选权益组（数组）」，
  `resolveBenefits` 返回数组、`listBirthdayOptions` 逐规则展开；
  `BIRTHDAY_BENEFITS_JSON` 覆盖也改为数组形状（值必须是数组否则配置报错）；
  未知等级保险丝默认 = 空组（只有贺卡）。
- 线上验证：Nicole（L4 挚爱）返回双选项——免费巴斯克（已领过 #1，灰显）+
  450 积分兑换（可送亲友，可选）。
- 门禁：tsc/eslint/vitest **336 过 39 跳过**/build 全绿。新部署
  `hotcrush-hbti-ojb3ix3yg-algersss-projects.vercel.app`（两域名已指到）。

---

## 会员等级按用户定版 + 权益分配收紧（2026-08-15，DSH，已合入并部署）

用户定版会员等级与生日权益，已实现上线：

- **等级升级线（年累计实付消费，实时计算，不再看 RES 等级名 VIP1）**：
  Lv1 初见会员 First Crush（注册 RM0）→ Lv2 心动会员 Sweet Crush（RM250）→
  Lv3 热爱会员 Hot Crush（RM750）→ Lv4 挚爱会员 Forever Crush（RM1,500）。
  消费口径 = pos_member_order_item 的 net_sales 当年累计（与年度回顾同源）。
- **权益分配**：L1/L2 **只有免费巴斯克**（每年一份）；L3/L4 **才有 450 积分兑换**
  （L3 限自己、L4 可送亲友）。此前「有积分就能兑换」的临时口径作废。
- `/api/birthday/view` 返回 `member.level`（key/中英文名/annualSpend/next.gap 升级差），
  前端封面与权益屏显示等级名与「再花 RMx 升 LvN」提示；reserve 用同口径判定并
  把派生等级落 `level_snapshot`（Lark 通知里的「等级」也是它）。
- 线上验证：Nicole 年度消费 RM4290.45 → **Lv4 挚爱会员**，仅 450 积分兑换选项
  （可送亲友）。注意：她 8-17 的免费巴斯克预约（#1）是按旧口径下的单，保留有效；
  按新规则 L4 无免费巴斯克，后续到店处理时心里有数。
- 门禁：tsc/eslint/vitest **333 过 39 跳过**/build 全绿。新部署
  `hotcrush-hbti-p9oyc6z0z-algersss-projects.vercel.app`（两域名已指到）。

---

## 生日域名提交被 INVALID_ORIGIN 拦截的修复（2026-08-15，DSH，已修复上线）

用户走真实流程到确认页点「留好我的生日礼」报「没留上，稍后再试一次」。复现：
birthday.hotcrush.net 上的 profile/reserve 提交返回 403 INVALID_ORIGIN——Origin 校验
只认 `HBTI_LINK_BASE_URL`（hbti-test.hotcrush.net），生日域名的同源提交被当跨站拒绝
（数据库无落单，失败发生在 Origin 关之前）。

修复（`749e156`，`2fcb22a` 合入）：`getJsonMutationRejection` 的允许名单改为
`HBTI_LINK_BASE_URL` + `HBTI_EXTRA_ORIGINS`（逗号分隔）的并集，并收紧语义为
「请求主机 ∈ 名单 且 Origin 头 === 请求主机」。Vercel 生产已配
`HBTI_EXTRA_ORIGINS=https://birthday.hotcrush.net`（本地 .env.local 同步）。

验证：生日域名提交由 403 变 400（过 Origin 关、到日期校验）；hbti-test 行为不变；
陌生 Origin 仍 403。新部署 `hotcrush-hbti-fmwd9xk5x-algersss-projects.vercel.app`
（两域名已指到它）。门禁全绿（332 过 39 跳过）。
⚠️ 给后人的话：**同一应用多加一个自有域名时，除了 DNS/别名，还要把这个域名加进
HBTI_EXTRA_ORIGINS**，否则所有 POST 全 403。

---

## 生日礼双选项 + 折叠日历 + 服务器 Lark 通知 relay（2026-08-15，DSH，已合入并部署）

用户三项要求全部落地：

1. **Lark 机器人配置**：用 lark-cli（app cli_aa82af2c7878de17，bot 身份）创建私有群
   「HOT CRUSH 生日礼预约」（chat_id `oc_9d0e91b9f8206ef474ed213f150ddb72`），
   机器人设为群管理、邀请邵伟亮；更多成员用群分享链接拉入即可。
2. **450 积分兑换选项**：权益模型从「等级 → 单一权益」改为选项列表
   （`listBirthdayOptions`）：免费巴斯克仍是等级权益（每年一份），450 积分兑换
   对积分 ≥450 的会员开放（积分在门店 POS 结算，H5 不扣）；/api/birthday/view
   返回 `options`，reserve 请求带 `giftType`；前端权益屏双卡片可选、预约/确认屏
   随所选显示。迁移 111 已执行（`notify_attempts` 列）。
3. **日期选择折叠**：预约屏只展示最近 7 天胶囊，其余收进「想选更后面的日子 ▾」
   展开（两月网格仍在，默认收起）。

**通知发送上服务器（Vultr tokyo-01，用户要求）**：
- Vercel 侧不再发通知：`BIRTHDAY_NOTIFY_WEBHOOK` 未配时 reserve 保持
  `notify_status='pending'`；
- 新脚本 `scripts/birthday-notify.mjs` 每 2 分钟（`/etc/cron.d/hotcrush-birthday`，
  2026-08-15 首单实测发现 15 分钟延迟对门店太慢，改 2 分钟）轮询 pending 行，经
  `lark_app.json`（与招募脚本共用 app cli_aa82af2c7878de17）取 tenant token
  （磁盘缓存 2h）发到群，置 sent；失败 attempts+1、满 3 置 failed。
  服务器配置 `/opt/hotcrush/scripts/birthday-notify.env`（DATABASE_URL + chat id，
  600 权限，不入 git；模板 `birthday-notify.env.example` 入库，随 deploy.sh 的
  scripts rsync 段上线）。
- 已实测：本地与服务器各发一条测试消息进群；服务器 `--dry-run` 读生产库正常；
  **首单真实预约（#1，Nicole，8-17 午间免费巴斯克）已由 relay 发送进群并置 sent**。

**部署与验收**：
- 门禁：tsc / eslint / vitest **330 过 39 跳过** / next build 全绿；凭据扫描干净。
- Vercel 新生产部署 `hotcrush-hbti-hw85hmtso-algersss-projects.vercel.app`，
  hbti-test 与 birthday 两个域名均已指到它。⚠️ 经验：`vercel deploy --prod`
  只自动移项目原生域名（hbti-test），birthday 域名每次部署后要手动
  `vercel alias set <新部署> birthday.hotcrush.net`。
- 线上验证：view API 对 Nicole（4944 分）返回两个选项且积分选项 available；
  Playwright 真机流程断言权益屏双卡片、4944 积分文案、预约屏 7 天胶囊 +
  展开出现次月日历，全部通过。
- ⚠️ 仍未做真实预约写入（会落真实记录 + 群通知），首单建议人工点一遍。

---

## 生日贺卡动态化全量上线（2026-08-15，DSH，已执行）

用户指示「全部自己执行」后，把上节的 6 项上线待办全部完成并逐项验收：

1. **迁移 110**——查证生产库 `schema_migrations` 已有版本 110，`mkt_birthday_profile` /
   `mkt_birthday_reservation` 两表已建、列/索引与迁移文件逐项一致、当前 0 行
   （更早的会话已执行过；本次只读核验，未重复执行）。
2. **Vercel 环境变量**——hotcrush-hbti 生产环境新增 `BIRTHDAY_LINK_SECRET`
   （64 hex = 32 字节随机串）与 `BIRTHDAY_CAMPAIGN_YEAR=2026`；同值写入本地
   `hbti-web/.env.local`（gitignored）供链接生成脚本使用。
   `BIRTHDAY_NOTIFY_WEBHOOK` **未配置**：缺一个门店用的 Lark 群机器人地址，
   拿到后 `vercel env add BIRTHDAY_NOTIFY_WEBHOOK production` 再 `vercel redeploy` 即生效；
   未配置期间预约照常落库、通知记 skipped。
3. **部署**——`vercel build --prod` + `vercel deploy --prebuilt --prod`：
   新生产部署 `hotcrush-hbti-h752wzi63-algersss-projects.vercel.app`（含全部生日路由），
   已别名 `hbti-test.hotcrush.net`。
4. **域名切换**——`birthday.hotcrush.net` 从静态项目 hotcrush-birthday-card 移除别名，
   重新别名到上述新部署（域名在团队内已验证，DNS 与证书均未动；
   证书 cert_z0teWyJCbiAUPhG451Nu0kkl 正常）。静态归档部署
   `dpl_JDvL861xWm8d2uWiETD1aE93WKjB` 保留作回滚。
5. **端到端验收**（全部真实生产路径）：
   - `/api/health` 四检全绿；`/api/birthday/view` 无身份 401、坏令牌 401、过期 410；
   - 用 `scripts/generate-birthday-links.mjs` 为会员 2063178969381101576（VIP1）生成
     30 天签名链接，`/api/birthday/view?t=` 200：真实年度回顾（2026 年 29 单 /
     RM4290.45 / 最爱「趁热心动蛋挞」139 件）、免费巴斯克权益、取货窗口
     2026-08-17~09-14；hbti-test 与 birthday 两个域名均 200；
   - 页面 `cache-control: private, no-store` 生效；`birthday.hotcrush.net` TLS 校验通过、
     标题「生日快乐 — Hot Crush」。
   - ⚠️ **未做真实预约写入**（会落一条真实预约记录）：写路径由 39 例单测覆盖，
     首单真实预约建议人工点一遍。
6. **推送**——已随本 HANDOFF 更新一起 push origin/main。

**回滚方法（两步）**：
1. `cd ~/hot/hbti-web && vercel alias rm birthday.hotcrush.net`
2. 在 `vercel link --project hotcrush-birthday-card` 的目录里
   `vercel alias set hotcrush-birthday-card-1i3cd8ad3-algersss-projects.vercel.app birthday.hotcrush.net`
（hbti-test 域名回滚用 `vercel promote hotcrush-hbti-oeq4tt1pw-algersss-projects.vercel.app --yes`。）

---

## 生日贺卡动态化完成并合入 main（2026-08-15，DSH，已合入 main 并推送）

接替上一 DSH 会话在 `dsh/birthday-dynamic` 独立 worktree 的在途实现，收尾并合入 main：
静态烘焙的生日贺卡改为按会员动态生成——专属签名链接进卡、年度消费回顾、资料收集、
生日礼预约与门店通知。

**做了什么**（3 个提交 `9cba8f0` / `0738fbb` / `4146913`，`04b4c6e` --no-ff 合入 main）：

- 新增 `hbti-web/src/app/birthday/` 多屏 H5（封面/信/年度回顾/权益/资料/预约/确认/完成，
  视觉复刻原静态卡）与 `/api/birthday/{view,profile,reserve,otp/verify}` 四个接口；
- `src/lib/birthday/`：HMAC 签名链接（30 天过期、不含 PII、常数时间比对）、等级→权益
  判定、预约落库（免费巴斯克每年一份靠部分唯一索引兜底幂等）、Lark 门店通知
  （通知失败不回滚预约，只记 notify_status）；
- `src/proxy.ts` 按域名分发：birthday.hotcrush.net 的页面请求重写到 /birthday，
  hbti-test.hotcrush.net 行为不变、/api/* 两域名共享；/birthday 路由强制
  `Cache-Control: private, no-store`；
- 权益规则（2026-08-15 用户口述）：L1/L2 免费巴斯克每年一份；L3 450 积分限自己；L4 可送亲友。
  现网等级只有 VIP1，桥接到默认权益；全部走环境变量可配；
- 短信验证兜底**不再为非会员静默开户**（防批量养号薅免费蛋糕），RES 无会员返回 404 引导入会；
- 迁移 `110_birthday_card.sql`：`mkt_birthday_profile` / `mkt_birthday_reservation`
  （**尚未执行**，DDL 交人执行）。

**门禁**：tsc、eslint、vitest **318 过 / 39 跳过**（生日专项 39 例）、next build 全绿；
提交前凭据扫描干净。分支已删，worktree 已移除（其 .env.local 与主工作树逐字节一致，无丢失）。
✅ **推送完成**：经 `127.0.0.1:7897` 代理推送 `a38fb53..04b4c6e`，origin/main 已同步。

### 上线待办（✅ 已于同日由 DSH 全部执行，见上一节；以下保留原始清单备查）

1. **执行迁移 110**（DDL 交人执行，避开 KL 23:00 爬虫窗口，建议 01:00–13:00）：
   建 `mkt_birthday_profile` / `mkt_birthday_reservation` 两张表。
2. **Vercel 环境变量**（hotcrush-hbti 项目）：`BIRTHDAY_LINK_SECRET`（≥32 字节随机串，
   与生成链接侧一致）、`BIRTHDAY_NOTIFY_WEBHOOK`（Lark 自定义群机器人，可不配）；
   其余 `BIRTHDAY_CAMPAIGN_YEAR / BIRTHDAY_PICKUP_LEAD_DAYS / BIRTHDAY_PICKUP_WINDOW_DAYS /
   BIRTHDAY_BENEFITS_JSON` 有默认值，需要再配。
3. **部署**：`vercel build` + `vercel deploy --prebuilt`（沿用 OIDC token 流程）；
   之后把 `birthday.hotcrush.net` 从静态归档项目切到 hotcrush-hbti 的本次部署
   （proxy.ts 按域名分发，切域名即生效；静态归档版保留作回滚）。
4. **生成专属链接**：`node hbti-web/scripts/generate-birthday-links.mjs --member <id>`
   （需 BIRTHDAY_LINK_SECRET；`--top N` 灰度用，需 DATABASE_URL；输出绝不打印手机号）。
5. **预约状态推进**（fulfilled/cancelled）暂无后台界面，先用 SQL 手工维护；
   门店按 `ix_mkt_birthday_reservation_pickup` 的看板是下一迭代。

---

## 分支大扫除 + 工作树清零 + deploy.sh 合并东京版（2026-08-15，Kimi，已完成）

用户要求收编全部未提交改动并重排分支；随后确认 main 推送选方案 B（接受 birthday-web
会员数据进 GitHub 私有仓）、deploy 脚本合并一起做。

**工作树收编（11 个提交，原 codex/r6-green-implementation 上）**：gitignore 增补
（`__pycache__`/`supabase/.temp`/`output/`——薪资 PDF 含个人数据不入库）；bakery-ops
意图路由与 forecast 取数（相关单测 23/23 已跑过）；ops 脚本三件套；res_api 会员订单
商品采集；R6A1 修订包与 ETL 契约；物理存储重审；蓝图图稿；AI 服务商清单；迁移总计划；
Claude 评审归档；HANDOFF 多段。全部脏文件提交前过凭据扫描，无真实密钥。

**分支治理**：删 11 个本地分支（9 个已并入 main；`claude/exciting-torvalds-498847` 与
`claude/nostalgic-wiles-f7cb6a` 的修复经逐文件 diff=0 验证已被 main 吸收）；
`codex/r6-green-implementation` 以 --no-ff 合入 main（HANDOFF 冲突按两边全保留解决）
并删除。AGENTS.md 0.2 新增分支生命周期规则：合并即删、开工 rebase、收工两态、
常态检出 main。

✅ **GitHub 推送完成（2026-08-15，Codex）**：通过本机 `127.0.0.1:7897` HTTP 代理
与 HTTP/1.1 将 main 领先的 28 个提交推送到 origin（`d9ed5a9..d44d4dd`，实际 pack
107.85 MiB）；已删除远程 `claude/hbti-launch-hardening`、`claude/rename-ops-tables`、
`codex/schema-consolidation`、`refactor/architecture-review` 四个已合并分支。验收：
`fetch --prune` 后 `origin/main...main` 为 `0 0`，远程查询上述分支均不存在。

**deploy.sh 合并**：实测 Contabo（62.72.46.80）SSH 超时仍失联，tokyo-01 上
hotcrush-core / hotcrush-res-api / hotcrush-alert-relay 三服务 active。deploy-tokyo.sh
内容并入 deploy.sh（唯一入口，头部有沿革注释），deploy-tokyo.sh 删除；AGENTS.md 0.3/0.4
与 CLAUDE.md 同步更正（Contabo → tokyo-01）。**本轮没有执行部署**。

⚠️ 下次 deploy 注意：main 现在包含 bakery-ops 意图路由/forecast 改动（a88b8df），
相关单测已过但全量门禁未跑——deploy.sh 默认含门禁，别用 --skip-gate。
终态：本地主工作树检出 main 且干净；`origin/main` 已与本地 main 同步，上述 4 个
远程旧分支已删除。此前登记的 `dsh/birthday-dynamic` 分支同日晚间已由 DSH 收尾合入
main（见上一节），分支与 worktree 均已移除。

---

## 生日贺卡源码归档入库（2026-08-15，DSH，已合入 main）

生日贺卡 H5 此前由 Claude Code 在 /tmp 临时 scratchpad 开发并直接部署，源码从未入库；
2026-08-15 临时目录被系统清理后，Vercel 部署产物成为唯一副本。本轮从线上
https://birthday.hotcrush.net/ 抓取回收，经独立分支 `dsh/archive-birthday-web`
以 --no-ff 合入 main，归档在 `birthday-web/`：

- `birthday-web/index.html`：与当时线上响应字节一致，
  sha256 5e2bd978e458d1f8996f1d4cd577dfa444a32822407d00e4677bd81134120a55（70525 字节）。
  已实测部署中只有这一个文件（favicon/图片目录/字体路径均 404，Logo 为内联 SVG+base64）。
- `birthday-web/fonts/`：页面引用的两个品牌字体（NeutraTextDemiAlt.woff2 / OPPOSans-M-2.woff2），
  来自与 hbti-web/globals.css 同源的腾讯 COS；线上 HTML 仍引用 CDN，本地副本是容灾归档。
- `birthday-web/README.md`：来历、Vercel 项目/部署/证书/DNS 信息、重新部署方法、隐患清单。

注意：当前线上版本是为会员 Nicole 静态烘焙的单人页，无后端取数接口，含真实会员消费数据，
不要再发到第二个公开渠道。今后改生日页一律以 `birthday-web/` 为准，不要再从线上抓取。

归档全程在独立 worktree 完成，主工作树（检出 codex/r6-green-implementation、含各 agent 在途改动）
未切分支、未被触碰。合并后 main 领先 origin/main 2 个提交（含此前 1 个未推送提交），**尚未 push**，
由用户决定推送时机。未改部署、DNS、证书、数据库。

---

## 「可计算不落库」硬规则重审 + AI 服务商清单重标（2026-08-15，Kimi，已完成）

用户确认执行两件事：A= 按最终裁定的硬规则重审 R6A1 蓝图物理存储必要性；B= 把 Lark 在线数据清单的
"数据形态"列按新业务标签组重标。硬规则原文：凡能从完整、不可变的最小事实和版本化规则中确定性重建的
数据一律不落库（输入完整、公式版本明确、币种/舍入/时区口径固定、历史可重现才算"可计算"）；例外仅
POS 独立上报值（进隔离来源审计层）、历史审批结果（动作落库、可重算值不重复存）、曾驱动实际行动的
决策快照（须标明非标准事实）。

**A 交付**：`docs/database/hotcrush-core-v1/11-r6a1-physical-storage-reaudit.md`。对 R6A1 resolved
目录 105 张 PHASE1 表逐表判定：标准事实层 59（33 身份/规则 + 26 原子事件/人工行为/状态变化）、
来源汇总观察层 15（POS 日/小时/商品小时/维度拆分/会员日指标/余额快照 + 财务模板 9 张，
reconciliation_only、禁止与订单行重算结果相加）、决策快照层 5、摄取台账 2、平台侧车 19、结构契约 5。
结论：字段级纪律已大体合规（10 张 PARTIAL 表派生字段均已在视图），主要修复是分层与语义标签
（新增 `fact_kind`/`value_role`、4 条治理门禁），真实内容收紧只有 2 处：`mkt_survey_result`
（新计算行应转视图，历史缺答案行保留为来源观察）和 `mkt_reward_stock`（计数器改流水+视图派生）。
边界待用户拍板：行内标准化列（reason_code、transaction_type、business_date 等）建议物理保留并标
`derived_from_source_normalization`。

**B 交付**：Lark 在线文档 `RHp0dGYzioIOLEx4GMwjoWJFpRg`（wiki CChXw92fOiSExzkkNhqjQQ7Ep6d）
223 项"数据形态"重标完成，修订 30 → 35。写入前先回读确认用户最新修订为 30（标签与 Codex 上次
写入一致，未覆盖用户改动）。新标签计数：最小事实 84、来源汇总 65、计算派生 32、口径待确认 2、
外部来源 2、尚未形成 30，另新增第 7 个标签**决策快照 8**（预测建议、出货建议、生产预估、断货损失
估算×2、每日运营复盘、次日建议、AI 经营复盘建议）——用户原则要求这类数据"必须标明不是标准事实"，
原 6 标签组无法诚实表达，已在交付说明中向用户标明该新增。重点变化：每日/每小时的流水、实收、折扣额、
账单数、商品逐小时量额、支付/就餐方式汇总从"直接落库"改标"来源汇总"；每日折扣率、客单价、每小时
平均消费改标"计算派生"；两个顾客计数标"口径待确认"；POS 商品与排产产品对应关系从"计算派生"改标
"最小事实"（人工审核映射）。验收：写后全文回读，223/223 项新标签与计划逐项一致，数据名称与状态列
零变化，11 表结构不变。

本轮没有执行生产 DDL/DML、没有改声明模型/生成器/门禁/蓝图文件、没有 stage/commit；工作区原有大量
Codex 未提交内容原样保留。Lark 写入经 `lark-cli api .../blocks/batch_update`（本地装于
/tmp/larkcli，重启后需重装；npm 全局缓存有 root 属主文件，需 `npm_config_cache` 绕行）。
挂起事项沿用：数据库凭据轮换仍未做；R6A1 版本冻结（1,469/1,470 冲突）与门禁测试修复仍属 P0。

---

## 两个会员网页自定义域名上线（2026-08-15，Codex，已完成）

HBTI 继续使用生产部署 `dpl_2Uo6DHchgHxhW21JdPCWz2jfSHN9`，正式地址为
`https://hbti-test.hotcrush.net/`；首页 HTTPS 200，`/api/health` HTTPS 200，
`alert/db/res/signIn` 四项均为 `ok`。

生日贺卡复用已存在且 Ready 的生产部署 `dpl_JDvL861xWm8d2uWiETD1aE93WKjB`，没有从未知本地源码
重建。已把 `birthday.hotcrush.net` 别名挂到该部署，并在 Cloudflare 仅新增一条 DNS-only A 记录：
`birthday` → `76.76.21.21`，TTL Auto；未改其他 DNS。Cloudflare 两台权威 DNS、1.1.1.1 与 8.8.8.8
均已回读为该地址。最初外部 TLS 失败的根因不是部署或 DNS，而是 Vercel 尚未签发该子域名证书；已执行
`vercel certs issue birthday.hotcrush.net`，生成可自动续期的证书 `cert_z0teWyJCbiAUPhG451Nu0kkl`。

修复后验收：直连 Vercel 返回 HTTP/2 200、`server: Vercel`、HSTS、标题“生日快乐 — Hot Crush”；
Globalping 测量 `2caNCNNWrz5lxCyME00020wy7` 从洛杉矶、新加坡、德国三处均解析到 `76.76.21.21`，
HTTPS 200、TLS authorized，证书 CN 为 `birthday.hotcrush.net`。本机默认解析器仍保留变更前的 NXDOMAIN
负缓存，未为此刷新整台机器 DNS；不影响权威/公共 DNS 和外部用户。独立应用内浏览器两次加载超时，
因此没有虚报可视自动化通过；生产 HTML、标题、TLS 和三个外部地区已实测通过。

本轮没有修改网页源码、Vercel 环境变量、数据库或服务器，也没有重新部署构建产物；只做 Vercel
域名/证书、Cloudflare DNS 和本交接更新。共享工作树及 `HANDOFF.md` 开工前已有其他未提交改动，故未
stage/commit，也未回退或夹带其他人的内容。Cloudflare 保存弹窗曾长期显示 Loading，但权威 DNS 已落表；
不要因该 UI 状态重复新增同名记录。

---

## AI 服务商业务数据清单（2026-08-14，Codex，已完成）

用户要求按未来 R6 业务版图盘点“目前有哪些数据”，但对外只展示营业额、班表、会员消费等业务名称，
不出现数据库表名、字段名或 SQL。已只读核对当前生产库对象与精确行数、现有派生数据、R6 未来目录及
Lark 实际工时边界，交付：

- `docs/ai-vendor/HOT_CRUSH_AI服务商数据清单.md`

文档按门店/产品、销售、运营、会员、HR、供应链、成本、财务、AI/消息和数据质量组织，使用“已有真实
数据 / 部分或有限数据 / 敏感数据 / 未来规划未形成”四种状态。明确指出：计划班表当前无真实记录；
实际工时只有 Lark 来源、尚未标准化入生产库；正式生产计划、实际生产、配送、逐笔支付/退款、正式采购
订单与收货等也不能宣称已有。另给出 AI 服务商首轮评估优先级和三层分享边界。

验收：Markdown 351 行、16 个二级标题；所有表格均为两列；自动扫描确认正文未出现现库或目标库任何
对象名称，也没有 SQL、连接串或技术字段标识；`git diff --check` 通过。本轮没有导出原始数据、读取或
写出个人明细、执行数据库 DDL/DML、修改应用或部署。共享工作树原有大量其他 agent 的未提交内容；本轮
只新增上述 Markdown 并追加本交接段，未整体 stage/commit，也不得为“清理”回退其他改动。

同日后续以用户已编辑的在线版为新权威源继续处理：

- Wiki：`https://fjpks7iroa9l.jp.larksuite.com/wiki/CChXw92fOiSExzkkNhqjQQ7Ep6d`
- 当前 docx：`RHp0dGYzioIOLEx4GMwjoWJFpRg`

写入前重新读取在线修订 14，确认用户版为 11 个表、223 个数据项；没有用本地 Markdown 覆盖。已在每个
现有表格末尾增加“数据形态”列，共更新 234 个新单元格（223 项 + 11 个表头），并按当前真实形态标为：
直接落库 165 项、计算派生 26 项、外部来源 2 项、尚未形成 30 项。Lark 实际工时及请假/休息/异常备注
标为外部来源；未来清单均标为尚未形成；销售日/小时对账、预测准确率、成本/毛利和数据质量指标等标为
计算派生，其余当前物理记录标为直接落库。

首次写入因文档块权限返回 `403 / 1770032`，失败发生在第一列插入前；回读确认修订仍为 14、没有半成品。
用户恢复权限后重试成功，当前修订为 28。独立回读验收：11/11 个表均为三列，223 项数量不变；标题、
表 ID、行数、原“数据名称/状态”两列、正文块与链接均保持不变；新增列内容逐项匹配，未发现重复或漏填。
本次没有同步回写本地 Markdown（在线版现为权威），临时编辑脚本已删除；未执行数据库 DDL/DML、应用
修改、部署、stage 或 commit。

同日用户复核销售区后指出，“直接落库”只说明物理保存状态，不能回答数据是不是最小事实或可计算指标。
本轮按来源、粒度、公式和口径重新做了只读核验，尚未再次修改在线文档：

- 当前日客单价来源字段是折后口径，规范关系为实收营业额 ÷ 账单数；247 条可检验日数据中 246 条在 1.1 分
  以内吻合，2026-04-12 有一条约 RM3.04 的来源差异，应保留为来源对账异常，不能把来源观察直接当规范指标。
- 当前小时平均消费同样是折后实收 ÷ 账单数；2623 条可检验小时数据中 2622 条在 1.1 分以内吻合，
  2026-06-15 19 时有一条约 RM0.11 的来源差异。部分经营复盘代码另用折前流水 ÷ 账单数展示“客单价”，
  因而现有系统存在同名不同口径，供应商文档必须拆成“折前客单价/折后客单价”或只保留规范定义。
- 日折扣率 246/246 条均等于折扣金额 ÷ 总流水；它是确定性派生指标，即使当前被物理缓存也不能标成
  最小事实。当前 247 条日数据和 2653 条小时数据都满足总流水－实收＝折扣金额，但未来不能把这当无条件
  恒等式；退款、服务费、税费或舍入口径出现后可能失效。
- 日汇总没有独立的 POS 顾客计数字段；小时来源计数 2653 条均有值，其中 2459 条等于账单数、194 条不同。
  日值只能由小时来源计数相加得到，且来源定义未证明为去重顾客或进店客流。建议改名为“POS 来源顾客计数
  （口径待确认）”，小时项标来源汇总，日项标计算派生。
- 未来规范应分三层：订单/商品行/折扣/支付/退款等为业务最小事实；POS 已返回的日、小时、商品小时数字
  属于“来源汇总事实”，可保留作血缘和对账；客单价、折扣率及由日/小时汇总得到的经营指标属于“计算派生”。
  在线清单已有“状态”列表示是否可用，因此“数据形态”不应再重复“直接落库”；建议统一改用“最小事实、
  来源汇总、计算派生、口径待确认、外部来源、尚未形成”这组业务标签，并重标整份 223 项清单。

本轮生产库查询均在只读事务中完成，无 DDL/DML；在线文档没有写入，下一步需先回读用户的最新在线修订，
再按用户确认的分类标准做最小增量更新。安全事项：一次本地文本搜索的工具输出意外带出了 `.env` 中的数据库
连接凭据；没有在 HANDOFF 复写该值，但应尽快轮换数据库密码并同步各消费者配置。

---

## 老板“蜘蛛网数据蓝图 + 权限圈层”构想评审（2026-08-14，Codex，只读完成）

用户转述老板对 R6 数据蓝图的新构想：中心节点权限最高，按部门向外扩展、按圈层授权，表节点之间以字段
连接。本轮使用 PDF 审阅流程核对桌面 61 页评审包的总体蓝图、账号角色权限、受限人员联系信息、统一身份
连接脊柱和四项目写入边界，并对照当前 R6 字典与 Phase 1 安全 SQL；没有修改蓝图、声明模型、生成器、
数据库、应用或部署。

结论：老板抓到的是正确的“关系可视化 + 圈层治理”方向，但必须把数据关系网与权限网分开。物理数据库
不应建立一个万能中心事实表，也不应让日常“最高权限”账号默认读取密码哈希、令牌、HR 联系信息等全部
原始数据。建议采用“一核双网四圈”：中心是小型治理控制核（账号、角色、权限、范围、审计和数据资源
目录），第一圈为地点/产品/人员与雇佣/原料/来源等稳定身份，第二圈为各部门原始事实与流程，第三圈为
认证只读视图，最外圈为外部系统/AI/导出；部门是扇区，地点/组织/敏感级别/生效期共同决定访问范围。

现有 R6 已具备 `app_user`、`app_role`、`app_user_role`、`app_user_location_scope`、
`app_audit_event` 和稳定身份脊柱；但 `app_permission`、`app_role_permission` 仍标为
`EXTENSION_PACK:FINE_GRAINED_ACCESS`，Phase 1 `080_security.sql` 是 100 表 revoke + forced RLS 的默认拒绝
外壳，没有 `CREATE POLICY`。同时现模型只有地点范围，没有正式组织/部门范围或数据资源/字段目录。因此
老板构想若获认可，最小设计增量应是：补权威组织单元表（由 HR 还是身份治理写入决定 `hr_`/`app_`
前缀）与账号角色组织范围；增加生成式
`app_data_resource`/关系目录（真实 FK 仍是权威，目录不得成为第二真源）；把原子权限提升为可实施契约，
按“角色 × 动作 × 资源 × 组织/地点 × 敏感级别 × 生效期”生成和验收 RLS/受控函数；另设带批准、理由、
到期和全审计的 break-glass 机制，而非长期超级管理员。

建议下一步先交付三张评审页，不直接重画 61 页：一页老板视角蜘蛛网、一页角色权限矩阵、一页 R6
最小增量与不变项。获老板确认“中心代表组织、治理控制还是业务总览”以及真实部门/跨部门/地点范围后，
再修订声明模型、Draw.io、字典、门禁和迁移文件。本轮工作树原本已有大量其他 agent 的未提交内容；除本
交接段外未新增或修改仓库文件，不应整体 stage、回退或捆绑提交。

---

## BISHENG / 餐饮 AI 合作方案评估（2026-08-14，Codex，只读完成）

用户提供某 AI 公司到访交流速记，要求结合 HOT CRUSH 诉求评价其“数据治理 + BI + Agent +
生命周期应用 + 数字人 + 门店视觉”合作主张。本轮只读核对当前 R6 评审与 Green Phase 1 证据、
BakeryOps 现有 Agent/业务模块及供应链库存缺口，并核实 BISHENG 官方能力、百胜中国/星巴克餐饮 AI
一手材料、YOLO 跟踪/姿态边界及马来西亚个人数据保护官方材料。

结论：对方对“先把稳定身份、来源、口径、接口和数据治理做准”的问题判断正确，BISHENG也适合作为
RAG、文档审核、人机工作流和 Agent 应用层；但会议内容把数据基座、主数据、BI语义、Agent平台、
业务应用和计算机视觉混为一个项目，且未提供 HOT CRUSH 现状适配、客户生产证据、ROI基线、SLA、
验收和退出方案。建议只进入小范围、里程碑、可退出试点，不批准全链路总包。首个90天边界应为：
一条“门店×营业日×商品”的认证数据链（销售/报废/断货/成本/毛利）+ 一个只读业务Agent；合同预审
可作为并行平台能力验证，门店视觉和数字人后置。供应商必须复用R6与现有BakeryOps，不得另建第二套
事实库、指标库或重复Agent。

可分享报告位于
`/Users/weiliangshao/.codex/visualizations/2026/08/14/019fff95-f275-7f52-a0c2-6d481cf678f2/bisheng-partnership-review/report.html`；
对应 `artifact.json` 与 `source-notes.md` 在同目录。报告打包验收为 validation/package/verification 全部
passed，含17个内容块、1张判断图、3张决策表，来源弹窗与键盘交互通过，1440px与390px视口通过。

本轮没有执行生产 DDL/DML、数据回填、应用修改、依赖安装、服务器变更或部署。共享工作区已有其他
agent的大量未提交内容，本轮除本交接段外未改仓库文件，也未整体 stage/commit。

---

## 多国家汇率与成本基座审计（2026-08-11，Codex，设计完成、未应用）

用户要求结合 Claude「店铺历史数据分析预测」中的成本卡问题，判断当前 R6 是否能解决未来多国家
汇率。已只读核对该历史正文、旧生产成本价、Green catalog、R6 声明模型和成本写入代码，并交付
Data Analytics 技术报告；详细可复核设计见
`docs/database/hotcrush-core-v1/10-multi-country-fx-and-cost-foundation-review.md`。

结论：当前 R6 只能承接现有 MYR/g 简单路径，不能宣称多国家可用。旧库
`cost_card_item_price` 当前 344/344 为 MYR、0/344 有 `exchange_rate_id`、344/344 按现公式重算一致；
Phase 1 DDL 仍有 22 个 `DEFAULT 'MYR'`，且模型把 `fx_rate_to_myr`、
`price_myr_per_base_unit` 写进物理结构。Claude 对话中的 `×1.7` 是旧成品层投料量/版本污染，不是
汇率；对话所述修复是否覆盖全部批次仍应以当前 audit/version 事实为准。

建议在任何真实成本回填前修订声明模型：新增 `app_currency`、`finance_legal_entity`、
`finance_fx_rate_observation`、`finance_currency_policy` 四张不同粒度的核心表；把采购价改成纯原币
物料价格观察，把成本采用价改成原价/单位换算/汇率/政策的选择关系，不物理重复 MYR 派生值；移除
22 个 MYR 静默默认。Phase 1 暂定 100→104、完整目标 137→141；到岸收费与收货行分摊两表只有在
发票、运单、收货来源到位后才启用。法律实体结构可先为空，但不得伪造默认主体。

本轮没有修改权威声明模型、生成 DDL/manifest、连接或写入 Green、回填价格、切换应用或部署。
新增设计文件仍未提交；共享工作树同时存在其他 agent 的大量在途改动，不能整体 stage/commit。

---

## R6 Green Supabase 项目已创建（2026-08-10，Codex，已完成、尚未迁数）

用户明确回复“按推荐创建”，授权在当前生产项目所在组织创建同区域的独立 R6 目标项目。已通过
Supabase CLI 创建 `hotcrush-core-r6-green`：project ref `tmmkknnkcptunxbfjxqn`，区域 `us-east-1`，
控制面状态 `ACTIVE_HEALTHY`，PostgreSQL 17。创建时未指定付费 compute size、未启用高可用，也没有
自动执行套餐升级；实际额度/账单仍应以后在 Supabase/Vercel 组织账单页核对。

新项目数据库密码由本机随机生成，只保存在 macOS Keychain：account
`hotcrush-core-r6-green`、service
`com.hotcrush.supabase.hotcrush-core-r6-green.db-password`；密码值未写入仓库、环境文件、交接文件或
聊天。新库只读连接验收通过：数据库 `postgres`、PostgreSQL 17.6、大小 10,423,443 bytes，`public`
为 0 表/0 视图。正确的 Session Pooler 是 `aws-0-us-east-1.pooler.supabase.com:5432`；最初按旧项目的
`aws-1` 编号试连返回 tenant not found，官方 direct host 当时尚未解析，均未造成数据库写入或配置修改。

现有运行时没有切换：`bakery-ops/.env` 和 `res_api/.env` 的 `DATABASE_URL` 都仍指向旧生产 project
`ecsgqcmwtjmcpzqytdqw`。另发现 `bakery-ops/.env` 的 `SUPABASE_URL` 仍指向已停用的
`whatsapp-agent` project `zpplbzrtdenvpfhaysij`；代码搜索只在旧迁移注释里找到该变量，本轮没有把它
当成生产数据库连接，也没有擅自修改。

本轮没有执行 `supabase link`、目标库 DDL/DML、旧库导出、数据恢复、应用连接串修改或部署。下一步
应先生成并验收源库一致性快照/迁移清单，再决定是先落现库兼容副本还是直接应用 R6 expand-only
迁移；在任何数据写入前保留旧库为唯一生产真源。

---

## Supabase CLI 登录完成（2026-08-10，Codex，已完成、未创建项目）

用户批准开始蓝绿数据库迁移，并要求第一步先登录 Supabase CLI。本轮使用 Supabase CLI 2.113.0 的
官方浏览器授权流程完成登录；一次性验证码与最终 access token 均未写入仓库、交接文件或聊天回复，
令牌只保存在本机 CLI 配置中。

登录后只读验收确认账号下有 2 个组织、3 个项目。当前 `bakery-ops/.env` 的生产连接 project ref 与
账号中的 `supabase-yellow-crystal` 一致，项目位于 `us-east-1`、状态 `ACTIVE_HEALTHY`、Postgres 17；
另外两个项目状态为 `INACTIVE`。仓库当前尚未执行 `supabase link`，也没有创建新 Supabase project、
修改套餐、生成数据库密码、导出/写入数据、执行 DDL/DML、改任何项目连接串或部署。

下一步在创建新项目之前，需要确定目标组织、项目名和费用边界。建议新项目放在当前生产项目所在组织、
同为 `us-east-1`，并明确命名为 R6 非生产迁移目标；创建成功后仍保持所有现有项目指向旧库，只做目标
结构、回填和单向追平。

---

## 新 Supabase 蓝绿数据库迁移方案评估（2026-08-10，Codex，待确认、未实施）

用户提出在 Supabase 新建一个独立数据库，把现库数据迁入，但所有项目先继续使用旧库，待新库建好后再
逐步切换。结论是方向可行，但必须改成“旧库单一真源 + 新库持续单向追平”的蓝绿迁移；只做一次导入
后慢慢切换会从旧库下一次写入开始产生数据分叉，不能作为安全方案。

本轮通过现有 `bakery-ops/.env` 做了只读实时核对：源库为 PostgreSQL 17.6，数据库大小
95,980,691 bytes（约 91.5 MiB），`public` 有 76 张表、21 个视图；Supabase Auth 用户、Storage bucket/
object、Realtime subscription、Vault secret、cron job 和 publication table 均为 0，仅检测到空的
`supabase_vault` 扩展。因此目前迁移规模很小，主要风险是四个代码库/多个部署目标的写入边界和增量
一致性，而不是数据量。没有执行 DDL/DML、导出生产数据、改连接串或部署。

Supabase 官方当前模型是：若需要 Dashboard/API/Auth 等完整集成的独立数据库，应新建独立 Supabase
project，而不是在原 project 内手工 `CREATE DATABASE`。官方“Restore to a New Project”只能制作某个
时间点的数据库副本，且要求付费计划和 physical backups；Storage 文件、Edge Functions、Auth/API、
Realtime 与部分扩展设置仍需另配，新 project 也会增加费用。若该能力不可用，可以用 Supabase CLI
的 roles/schema/data 逻辑备份与恢复路线。

建议的实施顺序：新建独立 project并保留现有契约作为兼容落点 → 只通过迁移文件扩展 R6 目标结构 →
按迁移矩阵回填与逐表对账 → 建立旧库到新库的幂等增量/删除处理 → shadow read 与指标核对 → 先迁
只读消费者 → 每个业务域先迁完全部消费者，再短暂停写、终增量、切换该域唯一写者 → 旧库保留只读
回滚窗口。任何时刻同一事实只能有一个权威写者，不能无边界双写。

当前阻塞不是技术问题：终端可使用 Supabase CLI 2.113.0，但没有登录或配置
`SUPABASE_ACCESS_TOKEN`，无法核对组织、套餐、可用 project 名额或创建项目；同时用户还需明确新库
是“现库一比一副本”还是“R6 目标结构”。结合前序批准包，建议采用后者，并把旧契约只作为迁移期
兼容层。项目和数据都尚未创建/复制，下一步等待用户明确批准目标形态及可能产生的新 project 费用，
再做非生产 project 的创建和迁移演练。

---

## 本周总经办周报已发布到 Lark（2026-08-10，Codex，已完成）

用户要求基于上一期周报 `G6mpdmgEcoET5SxogKTj506Wp5e` 和模板
`VwSLdgwMFotYfGxDmcOjtFcpp5d` 制作本周周报，并使用 Lark CLI/API 交付链接。本轮先实时读取两份
Lark 文档，按模板整理了 2026-08-03 至 2026-08-09 的工作复盘，以及 2026-08-10 至
2026-08-16 的计划，覆盖数据库架构、会员活动与员工培训、HBTI 页面、生日贺卡、营运 AI 复盘、
外劳中介解约六项工作；风险区补充了远程服务器资源、备份、可靠性和扩容的决策口径，没有把风险
简化成未经验证的“数据库数据量大”。

Lark 文件导入路径的上传和导入任务创建均成功，但 Markdown（含简化版）与经视觉验收的标准 DOCX
转换任务都返回 `job_status=2`，平台 `error` 字段为空，故只能确认失败发生于平台导入转换阶段，无法
从返回值验证更具体根因；凭证或源文档权限不是本次失败点，因为同一应用凭证可以正常读取、复制和
编辑文档。最终改用复制原生 Lark 模板并直接更新文档块，已成功发布：

- 文档：`https://fjpks7iroa9l.jp.larksuite.com/docx/FGHVdpD8PopSlGx1fYhjNfqFpeg`
- 回读验收：复盘表 `7×8`、风险表 `5×6`、计划表 `8×6`；六项工作、四项风险、七项计划逐格完全一致；
  所有占位符已清除。
- 共享权限：指定用户已授予 `full_access`，链接权限为 `tenant_editable`。
- 未把用户提供的 Lark 密钥写入仓库或交接文件。

用户随后自行修改在线周报，并要求保留其全部改动，只在“上周做了什么（工作复盘）”表末尾新增当地
员工算薪事项。本轮重新读取线上 revision 64 后才写入，保留了用户补充的数据库图片、生日贺卡链接、
日期和正文调整；追加第 7 项“当地员工算薪及本月人力成本核算上传”，交付时间 `8.10`、完成状态
`✅ 已完成`、实际结果“已完成当地员工算薪、本月人力成本核算及上传”，未提供的配合人保持空白，
文件栏写“待补链接”。写后 revision 为 66；回读确认复盘表为 `8×8`，新事项只出现一次，原六行、
另外两张表以及所有既有文本块逐项未变化。

本轮没有修改业务代码、数据库或部署；仓库中原有大量其他任务的未提交内容全部原样保留，本轮在仓库
内只更新本交接文件。周报的本地中间稿和视觉验收文件位于既有任务目录
`/Users/weiliangshao/Documents/Codex/2026-08-03/lark-lark-cli-appid-cli-aa82af2c7878de17/`，不属于本仓库。

---

## HOT CRUSH Core V1 R6 最小物理数据基座终审通过（2026-08-10，Codex，未实施、未提交）

用户要求重新审视共享生产库及四个相关项目，以“最小不可派生事实 + 稳定字段连接 + 多种只读派生”
重做批准前数据库蓝图，并要求每张表、每个字段都有明确注释；本轮只完成设计、审计和交付，没有执行
生产 DDL/DML、没有生成/应用生产迁移、没有改项目数据库读写代码、没有部署或提交。

**先纠正旧前提：154 不是 R6 的表数。** 它是上一轮 154 个候选对象的逐项处置总数。终版 R6 为：

- 137 张潜在物理契约：一期 100 张（81 业务 + 19 必要平台侧车）、扩展包 33 张、来源满足后再启用 4 张；
- 59 个只读派生视图：一期 41、扩展 13、来源条件 5；
- 154 项严格守恒为 137 物理 + 11 合并 + 4 派生 + 2 删除，不能再写成“154 张目标表”；
- 1,810 个物理字段 + 642 个视图字段 = 2,452 个逐字段契约；419 个 FK 字段；
- 当前生产快照 939 个字段全部在迁移矩阵中恰好有一个非静默去向；高风险对象强制逐字段映射，
  不允许 `OBJECT_TARGETS` 兜底或短规则；现库 467 个约束/索引/触发器/RLS 也逐项登记去向。

所有 137 张表及 59 个视图都写清用途、单行粒度、写入者、读取者、来源、生命周期、变更策略、
最小粒度判断、可派生性和为何必须物理保存；全部 2,452 个字段写清中文名、类型、空值、默认值、
存放内容、业务作用、来源/写入方、主外键/唯一/CHECK、时间与历史语义、敏感性、示例和误用警告。
`target-comments-contract.sql` 恰好含 196 条对象 COMMENT 和 2,452 条字段 COMMENT，零空项、零重复/
未知对象；这是待批准的注释契约，不是已经在生产执行的 COMMENT。

本轮特别承接了已回填的 `pos_member_order_item` 最小订单商品事实：订单、订单行、会员归属、条件支付和
退款拆为不可混粒度的事实；会员覆盖不足、多人冲突置 NULL、商品映射缺失、商品净额与储值卡核销额
不可直接对账均保留为来源/质量语义。可选来源数值不再默认补 0；`hr_timesheet_entry.break_minutes`
为 nullable 且 NULL-safe。来源客流/客单价与派生标准指标分离。全部 56 个 JSONB 字段被穷尽且互斥地
分成 17 个行为驱动字段和 39 个证据字段，行为字段全部有版本化数据库校验门禁。消息订阅保留为
`app_user.notification_subscription_codes` 的受控当前偏好，不另造推测性表，也不冒充 RBAC/雇佣事实。

主交付目录：`docs/database/hotcrush-core-v1/`。重要入口：

- `HOTCRUSH-Core-V1-R6-最小物理基座评审稿.html`：可搜索逐表逐字段总览；
- `03-table-and-field-dictionary.md` / `target-field-dictionary.csv` / `target-comments-contract.sql`：完整字典；
- `04-current-to-target-matrix.md` / `current-field-to-target-matrix.csv`：现库对象与 939 字段去向；
- `target-storage-necessity-audit.csv` / `r5-to-r6-disposition.csv`：全表最小存储审计与 154 项守恒；
- `diagrams/HOTCRUSH-Core-V1-R6-最小物理基座蓝图.drawio`：61 页源图，覆盖 137 表、59 视图、
  419 个 FK 和 15 条端到端链路；同目录有 61 页 PDF、交互 HTML 和 4 张 6000px 高清图；
- `evidence/final-acceptance-2026-08-10.md`：最终计数、门禁、视觉和执行边界；
- `evidence/claude-fable-5-r6-final-pass-v4.md`：修正后 Claude Fable 5 最终独立 `PASS`。

验收结果：`validate-review-package.py` 全绿、模型 warning=0；Draw.io/PDF 均 61 页，4 张关键图人工
检查无裁切/重叠/不可读；生成器与 Draw.io 源连续重跑两次后，52 文件确定性聚合 SHA-256 均为
`a25ea975678e99f41ee532d7c35282f1613b226e26e5a0426354f0213f51f057`。PNG/PDF/交互 HTML 因第三方
导出可能写墙钟元数据而明确排除在确定性哈希外，另以页数、覆盖、分辨率、摘要和人工阅读验收。
Claude Fable 5 完整终审先返回 `PASS`，只指出 `storage_audit.py` 内部旧说明把删除数写成 1；修为 2 后
再次运行生成/哈希/全量门禁，聚焦复核第二次明确返回 `PASS`，确认 M1 映射、M2 NULL 语义、M3 JSON
约束均保持关闭。

桌面批准包：`/Users/weiliangshao/Desktop/HOTCRUSH-Core-V1-R6-数据库评审包/`，共 107 个文件、约
65 MB；含中文导航、可直接打开的 HTML、61 页 PDF、可编辑 Draw.io、2,452 字段 CSV、完整 COMMENT SQL、
最终验收和 Claude PASS。已从桌面副本自身重跑验证器及哈希，结果与仓库原件完全一致。

用户随后要求单独导出终版 PDF 第 45、46 页。已从同一 R6 Draw.io 源图生成桌面高清 PNG：
`/Users/weiliangshao/Desktop/HOT_CRUSH_第45页_统一身份与连接脊柱_高清.png`（4000×5601，约3.5 MB）和
`/Users/weiliangshao/Desktop/HOT_CRUSH_第46页_四个项目写入边界_高清.png`（4000×5530，约2.9 MB）。
最初尝试 6000px 时 Draw.io 报 tile memory warning，视觉检查确认下半部分漏画，因此该版本已被完整的
4000px 版本覆盖；最终两图逐张检查无漏画、裁切或文字框重叠。

用户查看第45页时指出 `hr_person` 与 `ops_location` 之间看似标了
`source_system_id → source_system_id`。只读核对声明模型与 Draw.io XML 后确认：`hr_person` 和
`ops_location` 均没有该字段，也不存在两表之间的这种外键；真实人员到地点关系是
`hr_employment.home_location_id → ops_location.location_id`。截图中的文字属于
`*_source_identity.source_system_id → app_source_system.source_system_id` 来源身份连线，自动正交布局把
标签/线段与人员到地点线路画在相邻位置，造成归属歧义。结构模型本身未错，但第45页该处视觉表达不合格；
本轮用户只问原因，尚未修改图。若继续修改，应拆开线路并使用带表名的完整标签后重新生成、导出和验收。

用户随后要求汇总第45页每条连接的含义。已从第45页 Draw.io XML 与声明模型逐项核对：页面包含
33 条真实 FK（单位/地点4条、产品/POS 7条、人员/雇佣9条、原料/供应商13条），以及“共同时间语义 →
共同来源语义”“共同来源语义 → 缺失/冲突阻断”2条说明性流程线；没有把无标签的布局辅助线计入。
本轮只在对话中逐条解释，没有修改模型或图稿。

下一步只能等待用户审图并提出修改；获明确批准后才进入迁移文件、回填、双轨核对、切换与回滚设计。
注意 Draw.io 多页 PDF 必须使用 `--all-pages --crop`，否则总览可能跨纸张产生第 62 页。工作区本来已有
多批 Claude/Codex/其他任务的未提交内容，本轮只新增数据库评审目录和更新本交接；不得为“清理”回退
或捆绑提交其他改动。

---

## Supabase 迁往 Vultr 的只读可行性评估（2026-08-09，Codex，未实施）

用户询问能否把当前 Supabase 数据库迁到自己的 Vultr 服务器。本轮只做代码、生产库与官方能力的
只读核验，没有执行 DDL/DML、创建 Vultr 资源、改应用、改环境变量或部署。

结论：技术上可行；按当前真实依赖，优先评估 **Vultr Managed PostgreSQL**，不建议为了这次迁移在
单台普通 VPS 上自管整套 Supabase。生产库实测为 PostgreSQL 17.6、约 82 MB；`public` 有 75 表 / 21
视图，Supabase Auth 用户、Storage bucket/object、Realtime subscription、Vault secret 均为 0。
BakeryOps、`res_api`、HBTI 与财务站的业务运行时主要经 `DATABASE_URL` 直连 PostgreSQL，因此 Supabase
当前主要承担托管 PostgreSQL，而不是 Auth/Storage/Realtime 应用平台。

迁移不能只换连接串：Vultr Managed PostgreSQL 要求表有主键，当前 7 张 public 表没有 PK；HBTI
硬校验 Supabase pooler 域名、6543 端口和 Supabase CA；26 条 RLS policy 仍引用
`authenticated/service_role`；`pg_graphql`、`supabase_vault` 等 Supabase 扩展与内部 schema 不能原样
盲迁。两个 Vercel 项目默认动态出口 IP，若 Vultr Trusted Sources 收紧，需购买 Vercel Static IP / Secure
Compute，或把数据库访问收口到 Vultr 内部 API；数据库与 Vercel Functions 还应放在相近区域。

建议下一步先由用户确认迁移动机和目标形态（现有 Vultr VPS、自建独立数据库 VM，或 Vultr Managed
PostgreSQL），再写正式设计。正式路线应为：兼容性清单和恢复演练 → 新建 PG17 非 Hobbyist 集群并
配置备份/连接池/可信来源 → 修正 PK、角色/RLS/扩展和 HBTI 连接适配 → 显式导出/恢复业务 schema →
冻结所有写者后终增量与逐表对账 → 分消费者切换并保留 Supabase 回退窗口。数据库虽小，但这是多个
写者共用的唯一生产库，切换协调与验收才是主要风险。工作区原有多批共享未提交内容继续保留，本轮
只追加本交接记录，不提交，也不运行 `deploy.sh`。

用户随后确认目标是把数据库安装在现有的一台 Vultr VPS，而不是使用 Vultr Managed Database。数据库
引擎已收窄为 **PostgreSQL 17**；不采用 MySQL。当前三个本地运行时均使用 `postgres` 驱动，代码中
还有大量 `ON CONFLICT`、JSONB、PostgreSQL RLS/policy 与 `security_invoker` 视图语义；改 MySQL 会从
主机迁移扩大成跨数据库重写。是否允许 PostgreSQL 与现有服务同机仍待确认 VPS 的 vCPU、RAM、磁盘/
剩余空间和当前工作负载；用户提供这些信息前，不写最终设计、不安装、不迁移。

用户进一步说明迁移动机是避免 Supabase Free 数据库超过 500 MB 后的费用。2026-08-09 官方规则核对：
Free 项目超过 500 MB 不是自动按超额计费，而是会进入只读；Pro 从 USD 25/月起，单项目含 8 GB
disk，之后才按 USD 0.125/GB 计。当前活库约 82 MB，只占 500 MB 的约 16%，因此容量本身不要求
立即切换。已有 VPS 上运行 PostgreSQL 软件与使用现有磁盘确实没有数据库许可证/新增磁盘套餐费，
但生产级异机备份并非零成本：Vultr 整机自动备份当前加收实例价格的 20%，Archive Object Storage
当前从 USD 6/月起；若只把备份留在同一 VPS，不能覆盖实例或账户级故障。建议先保持 Supabase Free，
并行设计/演练自建 PostgreSQL 17，在 350–400 MB 前完成可恢复切换；最终是否同机仍待 VPS 规格。

用户提供 Vultr 实例截图后，已确认 `tokyo-01` 为 Debian 12、1 vCPU、1 GB RAM、25 GB SSD，Auto
Backups 未启用。仓库现有 `deploy-tokyo.sh` 又确认它并非空机：同机计划运行 `hotcrush-core`、
`hotcrush-res-api`、服务端 Next build 和 RES Playwright Chromium；构建阶段 Node heap 上限甚至设为
1400 MB，超过物理内存，实际已明显依赖 swap/超配。结论因此收紧：当前规格可以安装 PostgreSQL，
但不允许把这套共享生产库与现有服务同机上线。数据库本身当前负载不高（只读快照时 7 个连接、1 个
active，约 82 MB），问题是应用/构建/浏览器与数据库的峰值内存、CPU、临时文件和 WAL 会互相争抢，
且服务器没有任何自动备份。

可选方向待用户确认：A（推荐当前）继续 Supabase Free 并监控到 350–400 MB 前；B 把此机改成数据库
专用机并迁走 core/res_api（1 GB 仍只算勉强可运行，不算可靠生产）；C 升级同机，最低 2 vCPU/4 GB/
50 GB，若继续保留服务端构建和 Playwright则推荐 4 vCPU/8 GB/80 GB，并增加异机 PostgreSQL 备份。
本轮只读图、代码与生产统计，没有 SSH 登录、安装、改服务器、改数据库或部署；截图中的公网地址不在
交接或回复中复述。

用户要求核对升级价格并解释 vCPU。2026-08-09 读取 Vultr 官方公开 Plans/Regions API：Tokyo (`nrt`)
可用的标准 Cloud Compute `vc2-1c-1gb` 为 1 vCPU / 1 GB / 25 GB、USD 5/月（当前截图规格）；
`vc2-2c-4gb` 为 2 vCPU / 4 GB / 80 GB、USD 20/月；`vc2-4c-8gb` 为 4 vCPU / 8 GB /
160 GB、USD 40/月。故升级到 2/4 基础月费增加 USD 15；若启用 Vultr 自动备份（实例费 +20%），
2/4 总价为 USD 24/月、相对当前无备份实例增加 USD 19；4/8 含自动备份为 USD 48/月。与保留当前
USD 5 VPS 再买 Supabase Pro（合计 USD 30/月）相比，2/4 同机加 Vultr 自动备份账面节省约 USD 6/月，
但备份/恢复、补丁、安全和单机故障由自管承担；当前 Supabase Free + USD 5 VPS 仍最省。vCPU 是虚拟
CPU 执行资源，主要改善应用、查询、定时任务和构建并发；对本机同跑 PostgreSQL 而言，1→4 GB RAM
对避免 OOM/swap 更关键，2 vCPU 则减少所有任务争抢单核。Vultr 官方说明实例可升级但不能降级，因此
未执行升级；若以后实施，应先做可恢复备份并确认升级方案。

## 财务登录恢复与 82 表数据基座审计（2026-08-09，Codex）

用户要求先解决财务网站无法登录，再从第一性原理评审本文件上方的 82 表 / 19 视图目标结构。

财务故障已在独立财务仓库修复并上线。根因是 `.vercelignore` 中的 `_*` 会把 `api/_lib/`
一并排除，导致所有 Serverless API 找不到 `./_lib/db` 并返回 500；与密码、账号锁定或数据库连接
无关。规则已收窄为 `/_*`，并增加防止 API 依赖被误排除的回归测试。登录修复代码合并提交为
`655f0ae`，交接记录合并后财务仓库 `master` 为 `96e4599`，均已推送。生产部署
`dpl_BXDfkJbejrHFfG9QmULPUGyuG5nW` / `hotcrush-finance-9tk545z9g` 已绑定
`finance.hotcrush.net`。未登录的 auth/sales/finance/cost-dashboard 四个端点现在正确返回 401，
一次性已鉴权生产会话检查四个端点均为 200，会话随后精确删除。新鲜门禁为 `npm test`
497/497，`db integration --static: ok`；财务仓库工作区干净且与远端一致。

数据库审计的已确认结论：这份生成器明确为 review-only 且不输出 SQL；目标盘点为 82 张表、19 个
只读视图、546 行展示字段，其中 84 行把多个字段 / 约束合写，80/82 张表没有展示基本生命周期
字段；状态为 68 NEW / 7 UPGRADE / 3 EXISTING / 4 CONDITIONAL。生产只读核对确认
`ops_store` / `pos_product` / `offers` 存在，而 `ops_location` / `pos_product_listing` / `hr_offer`
尚不存在，因此评审图不是当前库实况。

方向上可保留：单企业无 `tenant_id`、统一 location/product/person/employment/material 稳定身份、
来源映射、事实粒度分离、版本 / 有效期 / 批次血缘、类型化桥接与只读视图。但它目前不能当作可执行
物理模型：字段未原子化，类型 / 精度 / 空值 / 默认 / CHECK / FK 索引 / RLS 未定；多个表把业务审批人与
物理写者混为“多写者”；`schema_migrations.version` 仍是全局主键，无法根治多仓库版本冲突；
`app_audit_log` 目标列比生产反而少 before/after/request/IP 证据；财务人工与采购视图声称的
“员工 / PO 粒度”在当前财务来源表中不存在，不能直接构造。

本轮故意没有继续书写“每一个字段”的正式字典：如果照抄现图，会把 84 个合并标签伪装成真字段；
如果直接写修正版，又会在未获用户确认时替他做一批重要设计决策。下一步等用户确认字段字典基线：
“现稿原样解释并标错”或“先修正为原子模型，再逐字段解释”（推荐）。本轮没有生成迁移、执行
DDL/DML、修改图稿或部署 HOT 仓库；`HANDOFF.md` 因工作区已有多批共享未提交内容而继续留为
未提交，不能为“清理”把其他人的改动捆绑进一个提交。

后续用户转达：老板已认可第 15 页的交互逻辑，目标是明确每个分离模块通过什么字段连接，以保证后续分析一致性和
扩展性。按这个收窄目标，结论调整为：作为“模块连接与分析契约蓝图”方向合适，但作为可执行 DDL 仍未完成。
必须把每条箭头固化为四类字段契约：稳定身份（location/product/material/employment 等）、业务交易或版本 ID、
经营日 / 生效期和来源批次 / 质量状态。两个关键缺口是：原料需求汇总需增加可回溯 plan_line + recipe_item 的组成血缘；
生产工作量到班表需求需有显式 workload/run 来源链。人工与销售只能先在 location + business_date 粒度聚合，未定分摊规则时
不能伪造产品级人工成本。本次只做读图与结构复核，没有修改图、代码或数据库。

---

## HOT CRUSH 可扩展数据基座蓝图评审稿（2026-08-06，Codex，未提交、未实施）

用户已确认本次只设计 HOT CRUSH 单企业的数据基座，支持多门店、中央厨房、仓库和后续新模块；
采用“每个业务域单一写者”以及“稳定身份锚点 + 类型化业务事实 + 来源/批次/版本 + 类型化桥接 +
统一只读索引”的混合结构。本轮按 `drawio-skill` 制作 3 页评审稿，没有沿用或覆盖此前未批准的
73 表物理 ERD：

- `docs/diagrams/HOTCRUSH可扩展数据基座蓝图.drawio`：可编辑源文件；
- `docs/diagrams/HOTCRUSH可扩展数据基座蓝图-01.png`：总体连接骨架；
- `docs/diagrams/HOTCRUSH可扩展数据基座蓝图-02.png`：统一数据契约；
- `docs/diagrams/HOTCRUSH可扩展数据基座蓝图-03.png`：新模块快速接入；
- `docs/diagrams/build_extensible_data_foundation_blueprint.py`：可重复生成脚本。

自动布局校验结果为 0 个错误、5 个非阻断交叉警告、评分 60；已完成两轮逐页视觉检查，未见文字截断、
节点重叠或越界。当前 PNG 仅供评审，未嵌入 draw.io 数据；用户确认方向后再导出正式 SVG/PDF/内嵌源
PNG。本轮没有修改数据库、业务代码或部署，也没有提交；工作区既有未提交内容未触碰，等待用户决定是否
采用此基座方向及是否调整身份锚点、连接契约或模块接入流程。

用户随后指出 3 页概念图没有把每张表的关系串起来。本轮继续使用 `drawio-skill` 新增独立的 15 页
表级评审稿，前三页保留上述概念层，第 4 页列出全部目标表及跨域主路径，第 5–15 页展开每张表的
PK、FK、粒度、写入者、只读视图血缘和端到端写入边界：

- `docs/diagrams/HOTCRUSH可扩展数据基座与表关系评审稿.drawio`：82 张目标核心表、19 个只读视图；
- `docs/diagrams/HOTCRUSH可扩展数据基座与表关系评审稿.html`：15 页交互查看器，含 157 个跳转链接；
- `docs/diagrams/HOTCRUSH表关系评审-04-*.png` 至 `HOTCRUSH表关系评审-15-*.png`：表级逐页评审预览；
- `docs/diagrams/build_extensible_table_relationship_blueprint.py`：可审计生成器及结构断言。

新稿没有直接沿用旧 73 表身份设计：将仅适用于门店的 `ops_store / store_id` 修正为覆盖门店、中央厨房、
仓库和办公室的 `ops_location / location_id`；把企业产品身份调整为 `ops_product`、POS listing 单独留在
`pos_product_listing`；新增 SCM 所有的 `scm_material`，并用 `cost_card_material_link` 与成本卡对象明确
桥接，避免 SCM 依赖财务域成本对象作为原料主数据。另增加五个域内 Outbox 和三个统一只读索引视图。

生成器断言 82 表 / 19 视图 / 15 页且所有引用可解析；Draw.io 校验为 0 错误、0 节点重叠，剩余 27 个
非阻断的连线交叉 / 近节点警告。总索引经过两轮布局检查后改为“全表目录 + 跨域主路径”，避免把全部
外键压成线团；所有 12 个表级页面已导出，抽查身份、班表、供应链和模块接入页未见截字或节点重叠。
这仍是未来目标核心的评审稿，不是当前生产库约百张历史 / 兼容表的实况映射；没有执行 DDL/DML、修改
业务代码、部署或提交，旧 73 表文件及工作区其他未提交内容未改。

用户根据第 4 页截图要求在每个表名后增加简单作用介绍。本轮只修改表级评审稿生成器：新增覆盖全部
82 张目标表的 `TABLE_PURPOSES` 映射及缺失 / 多余 / 空描述断言，并把总索引卡片改为
“`表名 — 一句话用途`”；其余 14 页的关系、PK/FK 和布局未改。已重新生成同名 `.drawio`、15 页
交互 `.html` 和 `HOTCRUSH表关系评审-04-全表连接路径总索引.png`，视觉检查未见截字或节点重叠；
Draw.io 校验仍为 0 错误、0 节点重叠、27 个非阻断连线提示。没有执行数据库变更、部署或提交。

应用户要求，已把第 4 页另行导出为桌面清晰版
`/Users/weiliangshao/Desktop/HOT_CRUSH_数据库全表关系清晰版.drawio.png`（2500 × 5869，2.3 MB）。
该 PNG 已嵌入 Draw.io 源数据并执行 PNG 完整性修复；逐图检查确认 82 张表及底部模块均完整绘制。
本次只新增桌面导出文件并更新本交接记录，没有改图中内容、数据库、业务代码或部署。

用户随后要求在同名交互 HTML 中为所有可能不熟悉的内容补详细备注，并说明框色所属板块。已新增
`docs/diagrams/build_extensible_table_relationship_review_html.py`：它先使用 `drawiohtml.py` 重新生成
15 页自包含查看器，再注入默认展开、可收起且随当前页面联动的右侧说明栏。说明栏覆盖 15 页阅读方法、
常见误解、概念页 12 类配色、表级页 10 类配色、框形 / 边框、4 类可见连线语义、82 张物理表、
19 个只读视图及 34 个数据库术语；每个表备注包含用途、粒度、状态、写入者、全部字段和 FK 连接。

同名 `HOTCRUSH可扩展数据基座与表关系评审稿.html` 已重新生成，仍含 15 页和 157 个页内跳转；浏览器
验收确认说明栏开关、逐页联动、备注过滤、原图搜索和页面切换均正常，控制台无脚本错误。索引页显示
82 个表备注，供应链页 14 个对象，财务页 4 个只读视图；静态检查确认注入标记各仅一份、JavaScript
语法通过。此次没有修改 `.drawio` 内容、数据库、业务代码或部署，也没有触碰工作区其他未提交改动。

应用户要求，已将同一评审稿第 15 页“端到端关系与写入边界”另行导出到桌面：
`/Users/weiliangshao/Desktop/HOT_CRUSH_端到端关系与写入边界清晰版.drawio.png`（3200 × 2579，约
1.1 MB）。该高清 PNG 已嵌入 Draw.io 源数据并执行完整性修复；视觉复核确认稳定身份、穿透供应链、
采购与成本、销售与人员、录入边界及数据质量门禁均完整无裁切。另用该 PNG 成功回读并导出 SVG，
确认可编辑数据有效。此次只新增桌面导出文件并更新本交接记录，没有改图中内容、数据库、业务代码或部署。

## 2026 年 6/7 月工资单对比及 PDF 报告已完成（2026-08-05，Codex）

用户要求比较 Desktop 上两份工资单 PDF。本轮确认文件对应 Jun 2026（46 人）与 Jul 2026（44 人），
按员工身份对齐 37 人，另外识别 7 月独有 7 人、6 月独有 9 人；逐份验证应发合计、扣款合计和实发恒等式，
90 份工资单均无解析残差，并抽查原始渲染页面。完整逐人上涨/下降、人员增减和工资项目差异已在对话中交付。

用户随后要求 PDF，已新增交付物：

- `output/pdf/HOT_CRUSH_2026-06_2026-07_员工薪资差异分析.pdf`：7 页 A4 中文报告，包含管理摘要、
  总额与项目桥接、20 人上涨、17 人下降、7 月独有 7 人、6 月独有 9 人、Basic Salary 行变化、
  风险边界和复核动作；只展示姓名与工号，不含 NRIC。

PDF 已重新生成并验证：7/7 页可提取文字，53/53 名唯一员工均出现在报告，关键总额和人数均匹配，
NRIC 暴露为 0，中文字体已嵌入；7 页均渲染为 PNG 并完成视觉检查，没有遮字、截断或分页错误。

本轮没有修改应用代码、数据库或部署；含员工身份字段的解析文本、生成脚本和页面截图已删除，原始 PDF 未改。
报告 PDF 是本轮唯一长期交付物，目前未提交。除本报告和按协议更新本段外，工作区原有未来数据库图、
计划和他人未提交文件均未触碰。若用户下一步要求 Excel，再基于本次逐人核对结果单独生成并完成公式重算验证。

## HOT CRUSH 未来数据库物理 ERD 已完成（2026-08-05，Codex，未提交、未实施）

用户要求继续按第一性原理、使用 `drawio-skill`，把已审核的未来数据库蓝图展开成表、关键列、
外键和视图血缘。本轮只制作目标设计资产，没有执行生产 DDL/DML，没有修改应用运行代码，
没有部署。

新增交付物均在 `docs/diagrams/`：

- `HOTCRUSH未来数据库物理ERD.drawio`：11 页可编辑源文件，覆盖 73 张核心物理表、16 个关键视图；
- `HOTCRUSH未来数据库物理ERD.html`：单文件交互查看器，可缩放、搜索、切页；
- `HOTCRUSH未来数据库物理ERD.pdf`：使用 `--all-pages --crop` 导出，`pdfinfo` 确认 11 页；
- `未来物理ERD-01…11-*.png/.svg`：逐页 4000px PNG 和可无损缩放 SVG，均内嵌 draw.io 数据；
- `HOTCRUSH未来数据库物理ERD说明.md`：11 页索引、73 表/16 视图完整清单、人工/自动录入边界、
  黑巧/草莓塔端到端链、三项硬门禁和写入责任；
- `build_future_physical_erd.py`：可审计生成源，内置对象唯一性、逐页数量、引用完整性和条件表断言；
- `README.md`：新增物理 ERD 入口，并明确它与 5 页业务蓝图、生产现状全图的边界。

图把成本计算和财务核对拆为独立页面，以免把配方/采购价/成本快照与财务销售、采购、人工、毛利
四条核对链混在一起。每张表只在一个主页面完整出现，跨组/跨页用 `REF` 卡引用；跨域只认
`store_id / product_id / employment_id / material_id`。四张 POS 订单级表
`pos_order / pos_order_item / pos_payment / pos_refund` 仍为 `CONDITIONAL`：RES 没有跨重跑稳定的
来源 ID 前不得创建空壳表，也不得把时间桶伪装成订单。复用现有 `cost_card_recipe/_item`；
`cost_card_item` 保留 bigint `id` 并增加 UUID `material_id`。

验证结果：生成器断言精确得到 73 表、16 视图、11 页；drawio-skill validator 为 0 结构错误、
0 节点重叠，剩余 18 条可读性提示（12 条边线交叉、6 条路线经过节点边界附近），已完成两轮布局
修复并逐页视觉复核，没有遮字、错误指向或无法辨认的表；交叉线已从初稿 273 条降到 12 条。
XML 可解析；11 张 PNG 均可由 ImageMagick 读取；PDF 11 页；HTML、SVG、PNG、PDF 均成功生成；
语法校验产生的 `docs/diagrams/__pycache__` 已清理，没有把临时缓存留在工作区。

当前工作区仍为混合未提交状态：本轮物理 ERD、此前 5 页未来蓝图、迁移总计划、`README.md` 和
本 HANDOFF 尚未提交；他人所有的
`bakery-ops/src/modules/data/migrations/109_margin_and_holiday_factor.sql` 与 `deploy-tokyo.sh`
完全未改、不要纳入本轮提交。没有为了“清理工作区”去动任何无关文件。不要运行 `deploy.sh`。
若下一步进入数据库实施，必须按
`docs/superpowers/plans/2026-08-05-hotcrush-future-database-transition.md` 从 Task 0 的恢复服务、
干净提交边界和可恢复基线开始；不能把图中的目标表当作生产库已经存在。

---

## 从当前生产状态迁移到未来数据库蓝图的实施总计划已完成（2026-08-05，Codex，未提交、未实施）

用户要求按第一性原理写“从现在状态修改到蓝图”的详细方案。本轮基于已完成的生产库、
BakeryOps、`res_api`、财务网站、HBTI 和未来蓝图只读审核，新增：

- `docs/superpowers/plans/2026-08-05-hotcrush-future-database-transition.md`

计划共 859 行、22 个 Task、214 个可勾选步骤，定义 73 张规范核心物理表（包含需升级的现有表）、
16 张关键视图和 23 个全局迁移 ID；另明确现有 `finance_*`、招聘来源、账号、会员/HBTI 和兼容对象
继续存在，所以 73/16 不是共享生产库最终总对象数。路线采用“恢复服务/冻结基线 → 迁移治理 →
稳定门店/产品/原料/雇佣身份 → POS → 预测/预估单/实际执行 → 人事/培训/版本化班表/实际工时 →
供应商/需求/PO/收货 → 交易日成本快照 → 毛利与财务对账 → 账号权限与旧对象退休”，每域先双写、
再影子读，达到真实业务周期门槛才切主读。

本轮把图里的物理模型进一步收敛：复用现有 `cost_card_recipe/_item`，不重建配方表；新增
`ops_shift_plan_version`、`scm_supplier`、实际生产与实际发出两组事实、offer/onboarding、成本快照
组件；POS 账单/支付/退款只有 RES 能证明稳定来源 ID 才创建，不能把时间桶伪装成订单；
`cost_card_item` 先加 UUID `material_id`，保留 bigint 兼容；`offers` 采用同事务 rename + 可更新兼容
视图；`app_audit_log` 由受控只追加函数跨域调用，不给运行时直接改表。产品到成本卡映射拆为
`res_api`、BakeryOps、财务站各自所有的三个迁移，避免跨域越权。

计划同时补了当前→目标对象对照、人工/自动录入边界、网站功能依赖、黑巧/草莓塔端到端验收、
准确 SQL/代码文件路径、测试命令、生产窗口、对账阈值和 forward-fix/回读回退方式。节假日以 BKPP
官方页面/公报为权威候选来源；未确认 data.gov.my 有专门公共假日 API，所以自动抓取后仍需保存
URL/checksum/parser version 并人工批准。成本快照由财务站受保护的 Vercel 日任务生成，要求幂等、
advisory lock、失败告警和按营业日补跑。

交付前结构验证已通过：文件非空；22 Task、214 checkbox、73 张表、16 视图、23 个迁移 ID 数量均
精确匹配；73/16 每个对象都在实施任务中再次出现；老板需求关键词和所有 Modify 路径均覆盖；
无 TODO/TBD/占位符、tab 或行尾空格。没有运行应用测试，因为本轮只新增 Markdown 计划；没有执行
生产 DDL/DML、没有修改应用代码、没有部署、没有提交。

当前工作区仍含此前未提交的未来蓝图、`docs/diagrams/README.md` 和他人所有的
`bakery-ops/src/modules/data/migrations/109_margin_and_holiday_factor.sql`、`deploy-tokyo.sh`；本轮只新增
实施计划并更新本 HANDOFF。不要运行 `deploy.sh`。下一步若用户批准执行，从计划 Task 0 开始：
先恢复财务 API、建立干净分支/提交边界和可恢复基线；财务 API 未恢复、迁移账本未治理前，禁止建
任何新业务表。

---

## HOT CRUSH 未来数据库蓝图已完成（2026-08-05，Codex，未提交、未实施）

用户指定使用 [Agents365 drawio-skill](https://github.com/Agents365-ai/drawio-skill)，要求把老板关于
预估单、班表、关键岗位、供应链、成本卡、`product_id`、产品占比、订货增减和当日毛利的建议
画成未来数据库蓝图。本轮先沿用 2026-08-05 已完成的生产库/代码/业务来源只读审核结论，再生成
5 页目标模型；没有执行数据库 DDL/DML，没有修改应用代码，也没有部署。

交付物在 `docs/diagrams/`：

- `HOTCRUSH未来数据库蓝图.drawio`：5 页可编辑源文件，第一页可点击跳转各详细页；
- `HOTCRUSH未来数据库蓝图.html`：5 页单文件查看器，可切页、缩放、搜索，4 个页内跳转已生成；
- `HOTCRUSH未来数据库蓝图.pdf`：`pdfinfo` 已确认 5 页且每个逻辑页只占一个 PDF 页；
- `未来蓝图-01…05-*.png/.svg`：逐页交付图，PNG 内嵌 draw.io 数据；
- `HOTCRUSH未来数据库蓝图说明.md`：第一性原则、老板建议到表结构映射、人工/自动录入边界、
  三条端到端事实链、黑巧/草莓塔验收用例和实施顺序；
- `build_future_blueprint.py`：基于 drawio-skill `autolayout.py` 的可重生成脚本；
- `README.md`：新增“未来蓝图”与“现状全图”的边界说明。

图的核心决策：一个 BakeryOps 工作流可以一次提交多个业务动作，但同一事务分别写入正确粒度的表；
跨域只用 `store_id / product_id / employment_id / material_id`，不按名称猜关联；预测、发布计划、
实际发出、POS 售出、报废相互独立；计划班表与 Lark 实际工时独立；配方/价格/计划/采购单都版本化，
历史毛利用交易日有效成本快照。人工只录业务判断与证据，不重复录销售、工时、占比、成本或毛利。

验证：`.drawio` 通过 XML 解析；drawio-skill validator 为 0 结构错误、0 节点重叠、0 连线穿节点，
大型详细页仍有 14 处边线交叉但已逐页视觉复核、没有遮字或错误指向；5 张 2400px PNG、5 张 SVG、
5 页 PDF 和 5 页 HTML 均成功导出。指定 skill 安装在
`~/.codex/skills/drawio-skill`；新会话若未发现它，需要重启 Codex 才会出现在技能目录。

当前工作区边界：本轮蓝图文件和本 HANDOFF 尚未提交；原先未跟踪的
`bakery-ops/src/modules/data/migrations/109_margin_and_holiday_factor.sql` 完全未改、仍属于其他工作。
不要运行 `deploy.sh`。下一步只有在用户批准目标蓝图后，才应另写分阶段迁移和四个消费者改造清单；
不能把图中的未来表名当作生产库已经存在。

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
| 2026-08-16 | Codex | **完成 Fabric + PostgreSQL + DeepSeek Harness 目标架构设计（未实施）**：只读核验生产库 78 表/21 视图/约 92.6 MiB 与空 R6 Green 100 表/1,374 列；纠正“项目均未落地”和“Fabric 可直接替 PostgreSQL”的前提。新设计规定 PostgreSQL 为唯一 OLTP 真源，Fabric 为 OneLake/Lakehouse replica + Warehouse 认证语义层，Harness 锁版本并只经受控 Domain API；补 10 张 `ai_` 契约表、Agent/工具风险、Phase 0–6 蓝绿迁移门禁。未执行 DDL/DML、未激活 Trial、未创建 Fabric 资产或部署。活跃分支 `codex/fabric-agent-blueprint`。 |
| 2026-08-15 | DSH | **权益分配二次修订（已部署）**：L1 只有贺卡、L2 只有免费巴斯克、L3/L4 免费巴斯克或 450 积分兑换二选一（L3 限自己 L4 可送亲友）；权益模型改「等级→可选权益组数组」，BIRTHDAY_BENEFITS_JSON 覆盖同步改数组；L1 前端显示贺卡说明且无预约表单。门禁 336 过 39 跳过；线上验证 Nicole(L4) 双选项、免费因已领灰显；新部署 hotcrush-hbti-ojb3ix3yg-algersss-projects.vercel.app。 |
| 2026-08-15 | DSH | **会员等级按用户定版（已部署）**：等级改为按年累计实付消费实时计算（Lv1 初见 RM0 / Lv2 心动 RM250 / Lv3 热爱 RM750 / Lv4 挚爱 RM1500），不再读 RES 等级名；权益收紧为 L1/L2 只有免费巴斯克、L3/L4 才有 450 积分兑换（L3 限自己 L4 可送亲友）；view 返回 member.level 含升级差，reserve 同口径判定；线上验证 Nicole=Lv4 挚爱、仅积分兑换选项。门禁 333 过 39 跳过；新部署 hotcrush-hbti-p9oyc6z0z-algersss-projects.vercel.app。 |
| 2026-08-15 | DSH | **修复生日域名提交 403 INVALID_ORIGIN（已上线）**：Origin 白名单从单一 HBTI_LINK_BASE_URL 改为与 HBTI_EXTRA_ORIGINS 的并集（语义收紧为「主机 ∈ 名单 且 Origin===主机」）；Vercel 配 HBTI_EXTRA_ORIGINS=https://birthday.hotcrush.net；验证生日域名提交 403→400、hbti-test 不变、陌生 Origin 仍 403；新部署 hotcrush-hbti-fmwd9xk5x-algersss-projects.vercel.app。教训：应用加自有域名必须同步加白名单。 |
| 2026-08-15 | DSH | **生日礼双选项 + 折叠日历 + 服务器通知 relay（已部署）**：权益模型改选项列表，450 积分兑换对积分 ≥450 会员开放（免费巴斯克仍每年一份），view 返回 options、reserve 带 giftType；预约屏日期选择折叠为最近 7 天胶囊 + 展开。门店通知按用户要求搬上 tokyo-01：scripts/birthday-notify.mjs 每 15 分钟轮询 pending 行 → Lark 群「HOT CRUSH 生日礼预约」（机器人自建群，chat oc_9d0e91b9f8206ef474ed213f150ddb72）→ sent，失败 3 次置 failed（迁移 111 加 notify_attempts 已执行）；/etc/cron.d/hotcrush-birthday + 服务器 env（不入 git）。门禁 tsc/eslint/vitest 330 过 39 跳过/build 全绿；Vercel 新部署 hotcrush-hbti-hw85hmtso-algersss-projects.vercel.app（两域名已指到，注意 --prod 部署后 birthday 域名需手动 alias）；Playwright 实测双选项与折叠日历；本地+服务器 Lark 测试消息各一发。仍未做真实预约写入。 |
| 2026-08-15 | DSH | **生日贺卡动态化全量上线（已执行）**：迁移 110 经查已在生产库生效（两表 0 行、列/索引与迁移一致）；Vercel 生产新增 BIRTHDAY_LINK_SECRET 与 BIRTHDAY_CAMPAIGN_YEAR=2026；`vercel build --prod` + `deploy --prebuilt --prod` 部署 `hotcrush-hbti-h752wzi63-algersss-projects.vercel.app` 并别名 hbti-test.hotcrush.net；`birthday.hotcrush.net` 从静态项目 hotcrush-birthday-card 切到新部署（DNS/证书未动，静态部署保留回滚）。端到端验收：health 四检全绿、view 接口 401/410 边界正确、为会员 2063178969381101576 生成签名链接后 view 200（真实年度回顾 + 免费巴斯克权益 + 取货窗口）、两域名 200、no-store 生效、TLS 通过。未做真实预约写入；BIRTHDAY_NOTIFY_WEBHOOK 待门店提供 Lark 机器人地址。 |
| 2026-08-15 | DSH | **生日贺卡动态化完成并合入 main（已推送）**：`dsh/birthday-dynamic` 分支 3 个提交 `04b4c6e` --no-ff 合入，生日卡从静态烘焙改为按会员动态生成。新增 /birthday 多屏 H5（封面/信/年度回顾/权益/资料/预约/确认）与 4 个 /api/birthday 接口；签名专属链接（HMAC、30 天过期、免登录进卡，短信验证兜底且不再为非会员静默开户）；预约落库与 Lark 门店通知；迁移 `110_birthday_card.sql`（mkt_birthday_profile / mkt_birthday_reservation，未执行）；proxy.ts 按域名分发、/birthday 强制 no-store。门禁 tsc/eslint/vitest 318 过 39 跳过（生日专项 39 例）/next build 全绿，凭据扫描干净；分支已删、worktree 已移除，origin/main 已同步。上线待办：迁移 110、Vercel 环境变量、vercel 部署、域名切换、链接生成（详见正文新节）。 |
| 2026-08-15 | DSH | **生日贺卡源码归档入库（已合入 main）**：线上 `https://birthday.hotcrush.net/` 曾是唯一幸存副本（原 /tmp scratchpad 源码已被系统清理），已字节一致回收到 `birthday-web/`（index.html sha256 `5e2bd978…34120a55`，70525 字节），另归档两个品牌字体副本与 README（含 Vercel 项目/部署/证书/DNS 与重新部署方法）。经分支 `dsh/archive-birthday-web` --no-ff 合入 main；main 领先 origin/main 2 个提交、尚未 push。线上版本是为会员 Nicole 静态烘焙的单人页、无后端接口；今后改动以 `birthday-web/` 为准。 |
| 2026-08-15 | Codex | **两个会员网页已使用自有域名上线**：HBTI 为 `https://hbti-test.hotcrush.net/`，首页与 `/api/health` 均 200、四项健康检查全绿；生日贺卡为 `https://birthday.hotcrush.net/`，Cloudflare 新增 DNS-only A `birthday → 76.76.21.21`，Vercel 别名指向 Ready 生产部署 `dpl_JDvL861xWm8d2uWiETD1aE93WKjB`。发现 DNS 生效后 Vercel 尚无子域名证书导致全球 TLS 失败，显式签发 `cert_z0teWyJCbiAUPhG451Nu0kkl` 后修复；洛杉矶、新加坡、德国三处均 HTTPS 200、TLS authorized，直连标题为“生日快乐 — Hot Crush”。未改源码、环境变量、数据库或服务器，未重建部署；共享工作树原有改动保留，未提交。 |
| 2026-08-14 | Codex | **只读重审 HOT CRUSH 数据库蓝图（未改蓝图、未读写数据库）**：按“最小业务事实 / 来源汇总观察 / 来源快照 / 人工与工作流事实 / 决策输入快照 / 决策输出 / 派生视图 / 平台状态”重新核对 R6 与当前工作树中的 R6A1。结论：R6 的第一性原则方向成立，已明确纠正“行原子就等于整表必须落库”的旧错误；日/小时销售、会员日报等可保留为独立来源汇总与对账观察，但不能冒充最小交易事实，也不能与事件重算结果相加。当前不能批准 R6A1 实施：它仍标记 `DESIGN_ONLY_NOT_COMPILED / NOT_APPLY_COMPATIBLE / production_data_gate=BLOCKED`，Green 只证明旧 R6 的 100 表/1374 字段空结构（零数据、零视图、零策略/业务角色），R6A1 生成模型是 105 表/1470 字段，而新增评审稿仍写 1469，且当前 R6A1 测试门禁不绿（设计测试 45 项中 1 失败；implementation 测试 53 项中 21 error + 6 failure）；59 个逻辑视图只有 7 个达到 SELECT 规格就绪且 0 个实际创建/运行验证。还发现 `CORE_BASE_FACT` 混装原子事件与来源汇总，建议在目录中新增 `fact_kind` / `value_role` 元数据轴；客单价必须显式拆为 net/gross，`source_guest_count` 只能标“来源顾客计数、口径待确认”；R6A1 `pos_order_item` 已改为 Report211 原始冲销行粒度，但 `order_item_id`、`net_sales` 描述仍残留旧聚合语义。建议 P0：冻结唯一权威版本、解决 1469/1470 与测试漂移、恢复并运行验证核心 POS 视图、再编译 Green 100→105 的空库增量；未完成前暂停回填和 AI/BI 接入。另需轮换此前意外暴露的数据库凭据并更新消费者。工作区原有大量脏改动/未跟踪文件均保留，未提交。 |
| 2026-08-14 | Codex | **HBTI 已完成会员恢复原结果修复并上线**：已登录会员在进入体验或 OTP 验证成功后，先请求 `/api/complete/status`；若服务端已有完成记录，直接恢复服务端权威的人格、颜色与礼品结果，不再展示可重新作答的首页；仅 404（确实未参与）进入正常答题流程，状态检查异常则 fail closed 显示账户检查错误，避免会员先看到新本地结果、提交时又被旧结果替换。补齐登录恢复、OTP 恢复与三档手机尺寸 E2E 回归；门禁：typecheck、lint、Vitest **279 通过 / 39 跳过**、Playwright **45/45**、Next production build、`git diff --check` 全部通过。生产部署 `dpl_2Uo6DHchgHxhW21JdPCWz2jfSHN9`（`hotcrush-hbti-oeq4tt1pw-algersss-projects.vercel.app`）已 promote 至 `https://hbti-test.hotcrush.net`；线上复核：域名指向该部署且 Ready、首页 200、`/api/health` 200 且 `alert/db/res/signIn` 全部 `ok`、未登录 `/api/complete/status` 401。只改 `hbti-web/src/components/HbtiExperience.tsx` 与对应测试。 |
| 2026-08-11 | Claude Code | **发现成本卡 ×1.7 系统性录入错误（未修复，修复脚本已备好待执行）**：2026-07-14 批次导入的成品卡，成品层每行用量 = 真实值 ×1.7（面团 306=180×1.7、包装袋 1.7g=1×1.7……），全目录约 85 张卡中招；半成品配方干净未受影响。三重证据：整数×1.7 模式、财务网站 7-29 重建的「奶酪核桃马卡龙新」（老卡 8.17÷1.7=4.81≈新卡 4.70）、研发部 7-27《黑松露牛肉坚果棒》规格书（分割 250g/个 vs 库中 425g）。受影响下游：`product_material_cost` 缓存同样虚高（daily-review 直接读它）。**✅ 已修复（2026-08-11，用户授权后执行 `docs/database/fix_x17_cost_cards_20260811.mjs`）**：8 张卡（34/35/62/63/64/92/93/94）共 41 行逐行核对后，按应用工作流建 v2 发布（#303–#310）、v1 归档保留原值；直改已发布行会被触发器 `cost_card_protect_recipe_item` 拒绝，必须走 draft→publish→archive。`product_material_cost` 实为视图（`v_cost_card_current_cost` 派生），配方修复后自动重算，实测已回正（牛肉坚果棒 8.11、咖啡马卡龙 6.04、榛子马卡龙 8.60、趁热奶酪核桃马卡龙 4.81）。回滚脚本 `docs/database/rollback_x17_fix_20260811.sql`（需停触发器、owner 执行）。**发现②已确认为真双算（2026-08-11 三条证据链）**：a) 引擎公式实读 = `q×(1+loss_rate)÷net_yield` 两字段同时生效；b) 全库已发布配方中 loss_rate>0 的行**全部**恰为 `loss=1−ny` 互补（58 行，非互补 0 行、纯 loss 0 行——该字段在现网数据里唯一"用途"就是重复净得率）；c) 物理自洽：腌制牛肉批产 1320g=Σ行用量，证明行用量是入批净料、ny 仅折算采购毛料，×(1+loss) 无物理对应；引擎展开西冷 204.545g/个 与公式复算逐位吻合，去双算后 151.5g/个，正是惠灵顿 13.92→11.23 的差额。**✅ 发现②已修复（2026-08-11 用户执行 `docs/database/fix_lossrate_dup_20260811.mjs`）**：47 个已发布配方（30 成品+17 半成品）各发新版本、58 行冗余 loss_rate→0、旧版归档。事后独立验证：已发布配方中 loss_rate>0 的行=0、每 item 恰一个 published 版本、94 张成品卡全部可算价。成本回正示例：招牌惠灵顿 13.92→11.23、菲力牛肉派 16.91→13.56、菲力牛肉塔 7.09→6.09、咸蛋黄碱水结 13.00→11.96。回滚脚本 `docs/database/rollback_lossrate_fix_20260811.sql`。**✅ ×1.7 已全目录清零（2026-08-11 用户执行 `docs/database/fix_x17_batch2_20260811.mjs`）**：第二批 86 张（A组56张未动过的导入v1 + B组27张loss修复版且逐行断言==导入v1 + C组3张测试拿破仑；92/93/94 显式排除防二次除）。半成品843行全扫零×1.7、每卡要求签名行或人工白名单（2/3/4/5/58/59 六张零签名卡逐行人工核对后放行，铁证=包装袋1.689≈1×1.7）。修复后独立验证：99张已发布成品卡零版本冲突、loss行0、残留×1.7签名恰好1条=471的袋1.7g（已知遗留）。合计两批 8+86=94 张卡修复，行级明细 `fix_x17_batch2_20260811.log`、回滚 `rollback_x17_batch2_20260811.sql`。**尾巴**：471袋1.7g→应为1；5张卡各缺3条已核验原料价算不出成本（19/23/27/57/75，修复前即如此）；两张圆大挞成本率81%/73%属真实薄利待经营复核；研发确认项=牛肉坚果棒松露酱8g vs 7-27规格10g、榛子面团180g vs 重建卡150g、可尔必思茉莉冷萃无卡。loss_rate 字段今后语义=净得率之外的额外制程损耗，录入时勿再与净得率互补重复。其余约 77 张卡未修——7 月中下旬有 32 次 cost_card.update 人工改动，盲目批量 ÷1.7 有二次损坏风险，需对 audit log 逐张核对后再批量。另：牛肉坚果棒黑松露酱库中 8g vs 7-27 新规格 10g，属配方更新非录入错误，未动。已交付用户校正版+最终版成本卡 Excel（马卡龙系列 7 品） |
| 2026-08-04 | Claude Code | **✅ 端到端真实跑通：短信送达 → 验证 → 答题 → 抽礼品 → 发出真券。** 证据：`[otp/request] sent {"resCode":"000","resMessage":"ok","attemptsToday":5}`；随后 `otp/verify` 与 `/api/complete` 各一次；库里 `hbti_status=issued`、人格 `HSDA`、**礼品库存 已发 1 → 2（抽中爱心纸香卡，86 件剩 85）**、0 条 processing/review。**这一跑把此前唯一零里程的那段点亮了**——`acquireProcessing` 幂等锁 → `markPrepared` → `drawGift` 的 `FOR UPDATE` 事务 → RES 真实发券 → 回读对账 → 写 `pos_member`，全部在换过的 `DATABASE_URL`、内联 CA 的真证书校验、事务池 `:6543` 上验证过。**顺带修掉最后一个已知的顾客侧缺陷**：每次发码都新建 guest session、验证码绑在该 session 上，而前端一拿到新令牌就丢掉旧的；RES 对同号当天的重发**回 000 却不真的送达**（仓库实测 19 次请求：当日首次 11/13 到达、重复 0/6），于是「等不及点重发」这个最本能的动作会**把顾客手里真收到的那条码作废**，当天再无解。改成**两份令牌都留着，验证时先试新的、`INVALID_CODE` 时回退旧的**（只在「码不对」这一种错误上回退——过期/超次数/账户冲突另有含义，重试只会把它们变模糊；成功后以活着的那份为准，`changePhone` 会清空）。⚠️ **顾客「请求太频繁」= 我们自己的限流**（5 次/天/号），不是 RES；反复测试才会撞上，真实顾客一人一次。**+61 重复建号已查清**：两行的 `phone_country_code`/`phone_national`/`phone_e164` **完全一致**，不是号码格式问题——是 RES 侧本来就有两个会员记录；全库 4843 个会员里**只有这一个号**有多账号，而「无注册日期的空账号」在各国家码普遍存在（+60 就有 1071 个），**今天这次跑通没有产生第三个账号、正确复用了已有账号**，所以是开发早期的单个历史产物而非系统性缺陷，两个账号积分/余额/消费均为 0、无价值拆分。门禁：tsc / eslint / next build / **vitest 277 通过 39 跳过（316）** / **playwright 42/42** |
| 2026-08-04 | Claude Code | **验证码上线后仍然发不出短信的完整排查（结论：一直是 CSP 少放行域名，不是别的）。** 症状演进：① 真机解完验证码，RES 回 `CRM-00-1105 captcha rejected! diff`；② 再点，浏览器里毫无反应、**服务端连一条日志都没有**。**定位手法值得复用**：先给错误链路补上 RES 的 `msg` 原文（此前只记 code，而 `CRM-00-1105` 既不在 RES 客户端语言包里也无公开文档，光有码查不动）；再**用一个语法合法但无效的票据打一次**做对照——它回 `decrypt fail`，而真实解题回 `diff`，说明 RES 是**原样回显腾讯 CaptchaCode 的描述**，且真实票据是能被解密的。查腾讯码表：`decrypt fail`=15（票据不合法），**`diff`=21（票据校验异常）**，而腾讯对 21 的说明是「**Ticket 带 `trerror` 前缀 = SDK 连不上自己后端、进入容灾降级**」。⚠️ **根因**：CSP 只放行了 `*.captcha.qcloud.com`，SDK 脚本能加载，但取题目的 `*.captcha.gtimg.com`、风控上报的 `www.turingfraud.net`、以及它要起的 blob Web Worker（`worker-src`）全被挡 → SDK 降级吐 `trerror_` 假票据 → 我们原样转发 → 腾讯判 21。**放行域名不能靠读源码**：SDK 混淆且部分域名运行时拼接，静态搜索必漏 `turingfraud.net`。正确做法是**问浏览器**——在 RES 自己那个能跑通的 H5 上触发一次记录它接触的全部主机，再回本站触发、用 `securitypolicyviolation` 事件核对到零违规。另注意：**弹层不是 iframe**（RES 自家页面也是 `iframe:0`），别拿「有没有 iframe」当成功信号，**零违规**才是。已加两道防御：`trerror_` 票据一律当「验证码不可用」不再转发（发出去必被拒，还白烧顾客当天 5 次发码额度中的一次）；解题等待加有界时限（回调永不触发时，顾客只会看到「点了没反应」，服务端连日志都没有）。**❌ 一条要撤回的推断**：中途我判断是「验证码绑 IP、RES 拿 Vercel 出口 IP 去核验导致不一致」，据此加了转发顾客真实 IP 的 `x-forwarded-for`/`x-real-ip`。腾讯码表证明 `diff`=21 与 IP 无关，**这个推断是错的**。转发 IP 的代码保留（让 RES 风控看到真实顾客而不是数据中心地址，本身是对的），但它从来不是拦住顾客的原因。顺带确认：**浏览器直连 RES 不可行**（CORS 全挡）；RES 挂在 Tencent EdgeOne + APISIX 3.7.0 后面。实测验证：CSP 零违规、弹层容器 `tcaptcha_transform_dy` 已渲染、回调拿到**真实票据**（腾讯对低风险会话会无感知放行；反复触发则升级为真人出题）。门禁：tsc / eslint / next build / vitest 276 通过 39 跳过（315）/ playwright 42/42 |
| 2026-08-04 | Claude Code | **🔴 登录曾被 RES 单方面打死：租户级打开腾讯云图形验证码，`sendVerifyCode` 变成服务端强制要 `captcha`，HBTI 全站没人能登录。本次实现了验证码，并补上暴露这次故障的 health 盲区。** 发现过程：跑端到端时第一步就 503 `CAPTCHA_REQUIRED_UNSUPPORTED`，换号码复现，一条短信都没发出去。**证据**：在 RES 官方 H5 同源上下文里直接打它自家接口 —— `captcha/config` 回 `{"enable":true,"captchaType":"tencent_cloud","tencentCloud":{"captchaAppId":"189993702"}}`；不带验证码打 `sendVerifyCode` 回 `UNI-00-0103 missing required param: captcha`（**服务端强制，不是前端装饰**）；同样不带验证码打 `verifyCode` 却直接回「验证码错误」——**只有发码这一步强制**，改动范围因此减半。08-02 那天三条 HBTI 记录都走通了 OTP，所以开关是 08-02 12:45 之后被拨的。**契约从 RES 自己的 JS 包里挖出来**（`index-DgMgsMSQ.js`，登录页懒加载分片）：SDK `https://ca.turing.captcha.qcloud.com/TJNCaptcha-global.js`、容器 `tencent-captcha-container`、`new TencentCaptcha(container, appId, cb, {type:"popup", userLanguage})`。⚠️ **字段名是坑**：腾讯回调给 `{ticket, randstr}`，RES 要 `{token, randstr}` —— `ticket` 必须改名成 `token`，写错不报错，只会一直「missing required param」。改动：① 新增 `GET /api/auth/captcha`，前端挂载时问一次并预热 SDK（等点了「发送」再拉脚本，那几百毫秒空白里顾客通常已经又点了一次）；配置带 5 分钟缓存，目的不是省延迟而是让「要不要验证码」能判在**限流之前**——缺验证码的请求到不了 RES，不该烧顾客当天的发码额度。② `sendVerifyCode` 透传 `captcha`；发码失败即作废配置缓存，让下一次重新问 RES。③ **认不出的供应商一律 `unsupported` 并 fail closed**，绝不退化成「不需要验证码」——后者会让前端不加载 SDK，然后发码在 RES 那边失败，顾客看到一个点了没反应的按钮。④ CSP 放行 `https://*.captcha.qcloud.com`（script/img/connect/frame 四项）。⑤ **刻意不实现腾讯的 `trerror_*` 降级令牌**——那是 SDK 自身加载失败时的占位串，由我们主动构造就等于绕过验证码；SDK 起不来就如实报「暂不可用」。⑥ **health 补 `signIn` 一项**：此前 `res` 探的是**后台**（`bo.sea.…`，券模板），登录走的是**H5**（`f4klzbmr9n2d.m.sea.…`），两个不同系统 —— 登录全挂时 health 一路绿灯。现在 H5 探不通、或验证码换成驱动不了的供应商，health 直接 fail。门禁：tsc / eslint / **vitest 272 通过 39 跳过（311）** / next build / **playwright 42/42** 全绿。⚠️ **仍需人验收**：验证码必须由真人解一次才能走通发码，自动化不该也不会去解——上线前请人工走一遍登录。⚠️ 另外发现 **+61 号码会被 RES 建成第二个空会员账号**（`…2873` 无档案无注册日期，而同号的 `…1826` 是 4 月注册的真实会员）；同批 +60 的样本正确复用了原账号，差异疑似在国家码匹配，根因在 RES 侧。两个账号积分余额消费均为 0，本次未造成损失 |
| 2026-08-04 | Claude Code | **上线前容量核查（目标 200 人/天）：放宽 IP 发码配额，并修掉一个让每日 cron 连续四个调度点没执行到清理的耦合。** 实测结论：`/api/health` 10 / 20 并发全 200、p50 **0.55s** 且 10→20 无衰减（该端点是真读表 `SELECT 1 FROM pos_member LIMIT 1`，不是 ping），对比 08-03 旧包在 `:5432` session 模式下 6 并发 p50 823ms —— `:6543` 事务池 + `max:1`/lambda 确实消除了「几十并发打满 60 连接、连带打挂财务站」。礼品库存 9 款剩 **1375 / 1376**（玫瑰冰箱贴仅剩 6，但抽取按剩余量实时加权，不会某款突然扑空），`pos_member` 里 0 条 processing / review。域名实测是 **DNS-only 直连 Vercel**（`server: Vercel`、无 `cf-ray`），边缘拿到的是真实客户 IP —— ⚠️ **若哪天把 `hbti-test` 改成 Cloudflare 橙云代理，全部顾客会共享 CF 出口 IP，限流桶塌成一个，当天第 N 个人起就再也收不到验证码**。① **IP 发码配额 10/10分 → 60、50/天 → 400**：邀请链接下线后（`/api/session` 恒 410）每个顾客都必须走 OTP，这两条闸门在 100% 顾客路径上；而门店 WiFi 是一个出口 IP、本地运营商 CGNAT 也让几十人共享一个 IPv4，旧值下一场 200 人的活动从第 51 个人起就收不到码，且现场看不出原因（前端只显示「验证码未送达」）。真正的短信成本闸门在手机号侧（1/分钟、5/天/号）**未动**。兜底桶除数同步 5 → **30**：正常配额放大 6~8 倍，除数不动的话兜底桶会跟着涨到每天 80 条短信，等于放宽了唯一针对伪造头的闸门；30 让它停在原量级（2 / 13）。收紧算式提成导出的 `effectiveRuleLimit`，调用方与测试读同一处，避免以后改了正常配额而兜底桶悄悄跟着放大。② **`purgeExpired()` 从 RES 探测的 try 块里提出来**：证据是生产库里 32 行 `hbti_auth_token` + 79 行 `hbti_rate_limit` **全部过期**，最新一行在 08-03 00:00 UTC 就已过期，而上一个调度点是 08-03 19:00 UTC —— 那一刻这 111 行全都该被删掉却一行没少，最老的来自 07-31，横跨四个调度点。cron 本身是启用的（`enabledAt` 07-30 14:32、`disabledAt: null`，查 `GET /v9/projects/{id}` 响应里的 `crons` 字段可见，CLI 没有对应命令）。根因是清理排在 `resolveEnabledCouponTemplateByName()` **之后、同一个 try 里**，RES 一抖整个 handler 走外层 catch —— 而 RES 不稳的那几天，正是最需要对账去救 `prepared` 记录的时候。外层 catch 现在也带上 `purged / purgeOk / alerts / alertsOk`，不再是什么都不说的裸 `{ok:false}`；「清理失败不让成功的对账报 503」这个原有取舍未动。门禁：tsc / eslint / **vitest 260 通过 34 跳过（294）** / next build 全绿；另把覆盖限流改动的 4 条真库集成用例**单独对生产库跑过**（整轮在一个事务里、结束强制回滚，`afterAll` 断言零残留）4/4 通过。其余 30 条真库用例本次未跑 —— 它们覆盖的 completion-store / gift-pool / auth-store 本次一行未改。⚠️ 仍未解决：**RES 持久凭证**（发券与短信仍走借来的 BO 会话 + 保温续命）。排障提示：`vercel logs` 实测保留期只有**约 10 分钟**，且不带 `-x` 会把错误消息截断成 `Error…`，出事要当场抓 |
| 2026-08-04 | Claude Code | **hbti-web 加固版上线（`8c6e547` → `268xtsrhk` / `dpl_55cBZGNB…`），以及上线前 13 分钟的一次生产故障复盘。** 部署后验收：`/api/health` 200 `{"alert":"ok","db":"ok","res":"ok"}`（`alert` 键只有加固版才有，是新包生效的证据）、未登录 `/api/complete/status` 401、首页 200、`/api/session` 410。**`db:"ok"` 顺带结掉了 `DATABASE_URL` 悬案**：新代码对连接串 fail closed（必须 `.pooler.supabase.com` 后缀 + `:6543`，且用内联 Supabase 根证书做真校验），它返回 ok 等于当天 13:5x 那次覆盖后的串确实连通；原值在覆盖前就已读不出（Sensitive 类型，CLI/API/面板三条路都拿不到明文），不可恢复。⚠️ **故障复盘 —— 删 Vercel 环境变量会让所有旧部署「一旦重建就挂」**：13:25 删掉三个退休变量（`HBTI_LINK_SECRET` / `HBTI_LINK_TTL_SECONDS` / `HBTI_MEMBER_HASH_SECRET`）对加固版安全，但**加固版当时还没部署**，线上跑的是仍然 `requireEnvironmentVariable("HBTI_LINK_SECRET")` 的旧代码。15:00:41 产生了一个从加固前源码重建的生产部署，构建时抓的是删完变量之后的 env → `readHbtiServerConfig()` 抛 `HBTI_LINK_SECRET is required.`，而这个函数是 OTP 登录/答题完成/发券/对账 cron **六个路由的第一行**，于是全线 503（首页仍 200，所以只看首页发现不了）。**关键区别：`vercel promote` 只重指别名、不重建，旧部署带着自己构建时的 env 快照，所以回滚永远安全；Redeploy / 重新 `vercel --prod` 会重建，就会踩删掉的变量。** 定位手段：`npx vercel logs -d <url> --level error --since 30m -x`（**必须带 `-x`**，不带会把错误截断成 `Error…`；`--json` 那条路当时反而抓不到）。恢复用 `npx vercel promote <旧部署url> --yes`，3 秒生效。教训：**删环境变量要排在「不再需要它的版本已经上线」之后，不是之前** |
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
