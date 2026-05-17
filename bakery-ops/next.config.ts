import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: ".",
  },
  serverExternalPackages: [
    "whatsapp-web.js",
    "puppeteer",
    "playwright",
    "playwright-extra",
    "playwright-core",
    "cheerio",
    "qrcode-terminal",
    "pdfkit",
    "exceljs",
    "postgres",
    "node-cron",
  ],
};

export default nextConfig;
