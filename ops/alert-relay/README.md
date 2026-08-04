# 告警中转（webhook → Lark 应用 API）

四个告警发送点只会 POST 一个 URL：

| 运行时 | 代码 | 配在哪 |
|---|---|---|
| hbti-web review 告警 | `hbti-web/src/lib/alert.ts` | Vercel 生产环境变量 `ALERT_WEBHOOK` |
| POS 每晚刷新 | `res_api/daily-refresh.sh` | `/opt/hotcrush/res_api/.env` |
| HBTI 令牌轮换 | `ops/hbti-token/run.sh` | `/opt/hotcrush/hbti-token/.env` |
| HBTI 令牌保温 | `ops/hbti-token/keepalive.sh` | 同上（同一个 `.env`） |

而这台机器上唯一在用的 Lark 投递通道是**应用 API**（`/opt/hotcrush/scripts/lark_app.json`，
招聘早报每天在用），不是群机器人 hook。中转把两者接上，同时把 `app_secret` 留在
这台机器的 600 文件里——不必复制进 Vercel（那把密钥同时能读 HR 多维表格）。

## 部署形态

- 服务：`/opt/hotcrush/alert-relay/server.mjs`，systemd 单元 `hotcrush-alert-relay`，
  只监听 `127.0.0.1:8791`。
- 入口：Caddy 在 `gw.hotcrush.net` 上加了 `handle_path /hbti-alert/*` → `127.0.0.1:8791`。
- 凭据：URL 路径里的随机段（与 Slack/Lark webhook 同一模型），存在
  `/opt/hotcrush/alert-relay/.env` 的 `ALERT_PATH_TOKEN`。**不要**把完整 URL 写进仓库。
- 收件人：`.env` 的 `ALERT_OPEN_IDS`（逗号分隔 open_id）。当前只有本人一个；
  要加人从 `/opt/hotcrush/scripts/lark_app.json` 的 `recipients` 里取 open_id 追加。

## 契约

```
POST https://gw.hotcrush.net/hbti-alert/<token>
body: {"text":"..."}                              # 通用形状
   或 {"msg_type":"text","content":{"text":"..."}}  # Lark 形状，同样接受

200 {"code":0}       已交给 Lark 且 Lark 回执 code:0
502 {"code":非零}     Lark 拒收或发送异常 —— 调用方必须当作未送达
404 / 405 / 400 / 413 路径错、方法错、包体错、包体过大
```

调用方判定规则（四处一致）：**HTTP 2xx 才算送到**；目的地若是 Lark 群机器人
（URL 含 `/open-apis/bot/v2/hook/`），还要包体 `code:0`。Lark 会用 200 + 非零 code
表示拒收，只看状态码必然把「没送到」读成「送到了」。

## 运维

```bash
systemctl status hotcrush-alert-relay
tail -f /opt/hotcrush/alert-relay/relay.log      # 每条都记「已送达 N 人」或「未送达」
systemctl restart hotcrush-alert-relay           # 改 .env 后需要重启
```

换成群机器人时：把群里自定义机器人的 hook URL 直接写进上面四处的 `ALERT_WEBHOOK`
即可，中转可以停用——四个发送点本来就认 Lark 形状。

## Canary

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"text":"[HOT CRUSH] canary — 收到请忽略"}' \
  "https://gw.hotcrush.net/hbti-alert/<token>"
```

验收标准是**有人在 Lark 里看到那条消息**，不是 HTTP 200。
