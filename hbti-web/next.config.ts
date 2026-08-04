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
 * 三个域缺一不可，是从 `TJNCaptcha-global.js` 里逐个挖出来的：
 *   · `*.captcha.qcloud.com`  —— SDK 脚本与它的样式表
 *   · `*.captcha.gtimg.com`   —— 题目接口与切图资源（`global.turing.` 和 `turing.` 两个主机）
 *   · `www.tycaptcha.com`     —— SDK 里写死的国际备用域（`intlFormalBakDomain`），
 *                                主域不可达时走它，不放行等于自断容灾
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
  `connect-src 'self' ${TENCENT_CAPTCHA_ORIGINS}`,
  `frame-src ${TENCENT_CAPTCHA_ORIGINS}`,
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
