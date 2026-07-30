# 交接（HANDOFF）

> **开工第一件事：读本文件。收工最后一件事：更新本文件。**
> 这是唯一的交接凭证——不要让下一个 agent 去翻你的对话记录，也不要假设别人记得你做过什么。
> 规则见 [AGENTS.md](AGENTS.md) 第 0 节。

---

## 当前状态

| | |
|---|---|
| 最后更新 | 2026-07-30 by Codex |
| 当前分支 | `codex/hbti-launch-ready` |
| 工作区 | HBTI 应用与方案已提交为 `a98fbe9`，本交接已更新；另有既存 res_api、bakery-ops、deploy.sh 在途改动，勿混在一起回退或提交 |
| 线上（Contabo） | res_api = 2026-07-27 爬虫改造版；bakery-ops = `INSTANCE_ROLE=all` |

---

## 在做什么 / 做到哪

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

- **「See You Often」HBTI 网站已完成并部署，可开始受控小批量使用**：RES 官方 H5 继续作为唯一门店二维码
  和会员中心；当晚短信发送 `hbti-test.hotcrush.net/t/<opaque-token>`，答题完成后把周边券发回同一
  RES 账户。页面、6 题、三语、9 色、分享、发券幂等、健康检查、Cron、自定义域名均已验收；
  不要再次用指定测试会员做真实发券。扩大到批量短信前仍需取得 RES 正式受限服务凭证、
  把短信发送系统接到 `scripts/create-member-link.mjs`，并给 `review` 状态补运营提醒。
  正式方案仍在
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

---

## 最近改动

| 日期 | 谁 | 做了什么 |
|---|---|---|
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
