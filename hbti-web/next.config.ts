import type { NextConfig } from "next";

// React's development build calls eval() to rebuild callstacks across
// environments; its production build never does. Without this the dev server
// logs a Console Error on every page load. Strictly dev-only — this is the one
// directive that must never reach the shipped policy.
const isDevServer = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isDevServer ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' https://resto-images-bj-1324130148.cos.ap-beijing.myqcloud.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
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
