import type { NextConfig } from "next";

// React's development build calls eval() to rebuild callstacks across
// environments; its production build never does. Without this the dev server
// logs a Console Error on every page load. Strictly dev-only — this is the one
// directive that must never reach the shipped policy.
const isDevServer = process.env.NODE_ENV !== "production";

/**
 * 腾讯云验证码的加载面。
 *
 * 2026-08-04 RES 在租户级打开了图形验证码，`sendVerifyCode` 从此服务端强制要求
 * captcha 参数，登录必须在浏览器里跑腾讯的 SDK 才能拿到解。
 *
 * 这份清单**不是读源码猜的**——SDK 混淆得厉害，域名有的是运行时拼出来的，静态
 * 搜索一定会漏。做法是在 RES 自己那个能跑通的 H5 上把 SDK 拉起来触发一次，
 * 记录它实际接触的每一个主机；再在本站触发一次，用 `securitypolicyviolation`
 * 事件核对到零违规为止：
 *   · `*.captcha.qcloud.com`  —— SDK 脚本与它的样式表
 *   · `*.captcha.gtimg.com`   —— 题目接口与切图资源
 *   · `www.turingfraud.net`   —— 腾讯天御的风控/设备指纹上报，**只给 connect-src**，
 *                                不进 script-src：它只需要能收数据，不需要在本页执行代码
 *   · `www.tycaptcha.com`     —— SDK 里写死的国际备用域（`intlFormalBakDomain`），
 *                                实测未被访问，留着是为了主域不可达时还有容灾
 *   · `worker-src blob:`      —— SDK 会从 blob 起一个 Web Worker，默认落到
 *                                `default-src 'self'` 会被挡掉
 *
 * **只放行 qcloud 一个域是不够的**：脚本能加载、题目取不到，弹层永远出不来，
 * 回调不触发，顾客看到的是一个点了没反应的按钮，服务端连请求都收不到（实测踩过）。
 *
 * 刻意**不**放行 `cloudcache.tencentcs.com`：SDK 只在一条老路径上用它拉 jQuery，
 * 往 script-src 里加一个通用 CDN 是白扩攻击面。
 */
const TENCENT_CAPTCHA_ORIGINS = [
  "https://*.captcha.qcloud.com",
  "https://*.captcha.gtimg.com",
  "https://www.tycaptcha.com",
].join(" ");

/** 风控上报只需要能被连上，不该获得在本页执行脚本的权限。 */
const TENCENT_RISK_ORIGIN = "https://www.turingfraud.net";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline' ${TENCENT_CAPTCHA_ORIGINS}${isDevServer ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline' ${TENCENT_CAPTCHA_ORIGINS}`,
  `font-src 'self' https://resto-images-bj-1324130148.cos.ap-beijing.myqcloud.com data: ${TENCENT_CAPTCHA_ORIGINS}`,
  `img-src 'self' data: blob: ${TENCENT_CAPTCHA_ORIGINS}`,
  `connect-src 'self' ${TENCENT_CAPTCHA_ORIGINS} ${TENCENT_RISK_ORIGIN}`,
  `frame-src ${TENCENT_CAPTCHA_ORIGINS}`,
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  distDir:
    process.env.HBTI_E2E === "1"
      ? "node_modules/.cache/hbti-next-e2e"
      : ".next",
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/t/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0",
          },
        ],
      },
      {
        // 生日卡全是个性化内容（含会员年度消费与预约），任何缓存层都不能存。
        source: "/birthday/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0",
          },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
