# birthday-web — HOT CRUSH 生日贺卡 H5

会员生日贺卡 + 生日礼预约页。单文件静态 H5，零 JavaScript：屏幕切换、选择状态、
确认页汇总全部由 radio/checkbox + 兄弟选择器驱动。

- 线上地址：https://birthday.hotcrush.net/
- 页面标题：生日快乐 — Hot Crush（noindex, nofollow，不期望被搜索引擎收录）
- 流程：s0 封面 → s1 生日信 → s2 你的烘焙（年度消费回顾）→ s3 选取货日 → s4 确认 → s5 完成

## 这份源码的来历（为什么它很重要）

本页由 Claude Code 于 2026-08-14/15 在 /tmp 临时 scratchpad 中开发并直接部署，
**源码从未进过任何仓库**。2026-08-15 系统清理临时目录后，Vercel 部署产物成了唯一副本。

2026-08-15 由 DSH 从线上 https://birthday.hotcrush.net/ 抓取回收入库：

- index.html 与当时线上响应**字节一致**，
  sha256 5e2bd978e458d1f8996f1d4cd577dfa444a32822407d00e4677bd81134120a55（70525 字节）。
- 已实测部署中**只有这一个文件**（无 favicon、无图片目录、无其他静态资源；
  Logo 与插图为内联 SVG / base64）。

如果以后要改页面，**以本目录为准**，不要再从线上抓。

## 内容与数据

- 当前版本是为会员 **Nicole** 静态烘焙的单人版本：问候语、年度统计
  （开心果蛋挞 / 开心果碱水结 / 开心果奶油巧克力拿铁等）直接写在 HTML 里，
  **页面没有后端取数接口**。改成"按会员动态生成"是后续工作，不在本目录。
- 页面含真实会员个人消费数据。仓库内留存可以；**不要再发到第二个公开渠道**。

## 字体

页面 CSS 引用的是腾讯云 COS 上的品牌字体（与 hbti-web/src/app/globals.css 同源）：

- fonts/NeutraTextDemiAlt.woff2（19140 字节）
- fonts/OPPOSans-M-2.woff2（11380 字节）

线上 HTML **仍引用 CDN 地址**，本目录的字体副本是容灾归档：CDN 桶失效时，
把 CSS 里的 url(...) 换成本地路径即可。字体随原项目使用，勿另作分发。

## 部署信息（2026-08-15 上线）

- Vercel 项目：hotcrush-birthday-card（prj_R0akZToz8XYONONOmiDbyOyRZ5bA，
  team team_7CX3iGLONHJEwQUJl4CaUBU6 / algersss-projects）
- 生产部署：dpl_JDvL861xWm8d2uWiETD1aE93WKjB（READY）
- DNS：Cloudflare hotcrush.net 区域内 DNS-only A 记录 birthday → 76.76.21.21（TTL Auto）
- 证书：Vercel 签发 cert_z0teWyJCbiAUPhG451Nu0kkl，自动续期
  （教训：**DNS 生效后若全球 TLS 失败，先查 vercel certs ls 是否已签发子域名证书**）

## 重新部署

纯静态、无构建。在本目录执行：

    vercel link --project hotcrush-birthday-card   # 首次；org 选 algersss-projects
    vercel deploy --prod                            # 产物即本目录文件

部署后把新部署别名到 birthday.hotcrush.net（vercel alias），
并用 curl -sS -o /dev/null -w '%{http_code}' https://birthday.hotcrush.net/ 验收。
