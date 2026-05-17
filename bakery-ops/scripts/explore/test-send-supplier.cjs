#!/usr/bin/env node
/**
 * 测试发送订货消息给供应商
 * 用法: node src/__tests__/test-send-supplier.cjs
 *
 * 注意: 需要 WhatsApp 已登录（whatsapp-session 目录有有效 session）
 */
require("tsx/cjs");
require("dotenv/config");

const { Client, LocalAuth } = require("whatsapp-web.js");

const SUPPLIER_ID = process.env.SUPPLIER_DEFAULT_WHATSAPP || "60175436694@c.us";
const SESSION_PATH = process.env.WHATSAPP_SESSION_DATA_PATH || "./whatsapp-session";

async function run() {
  console.log("═══════════════════════════════════════");
  console.log("  测试: 发送订货消息给供应商");
  console.log("═══════════════════════════════════════");
  console.log(`  目标: ${SUPPLIER_ID}`);
  console.log(`  Session: ${SESSION_PATH}`);
  console.log("");

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  console.log("  启动 WhatsApp 客户端...");

  client.on("qr", (qr) => {
    console.log("  ⚠ 需要扫码登录，请用手机扫描:");
    console.log("  " + qr.slice(0, 80) + "...");
    console.log("  (或者先运行主程序完成登录)");
  });

  client.on("authenticated", () => {
    console.log("  ✓ 认证成功");
  });

  client.on("ready", async () => {
    console.log("  ✓ WhatsApp 客户端就绪");
    console.log("");

    try {
      // 构造订货汇总消息
      const today = new Date().toISOString().split("T")[0];
      const message = [
        `📋 ${today} 订货单 (测试)`,
        "",
        "【渠道A - WhatsApp供应商】",
        "  NO.7 面粉: 50kg",
        "  NO.5 糖: 20kg",
        "  NO.89 鸡蛋: 200个",
        "  NO.2 迪比科牛奶: 10升",
        "",
        "共 4 项物品",
        "",
        "--- 此为系统测试消息，请忽略 ---",
      ].join("\n");

      console.log("  发送消息内容:");
      console.log("  ─────────────────────────────");
      message.split("\n").forEach((l) => console.log("  │ " + l));
      console.log("  ─────────────────────────────");
      console.log("");

      console.log("  发送中...");
      const sent = await client.sendMessage(SUPPLIER_ID, message);
      console.log(`  ✓ 消息已发送`);
      console.log(`    消息ID: ${sent.id._serialized}`);
      console.log(`    时间: ${new Date().toLocaleString()}`);
    } catch (err) {
      console.log(`  ✗ 发送失败: ${err}`);
    }

    console.log("\n  关闭客户端...");
    await client.destroy();
    process.exit(0);
  });

  client.on("auth_failure", (msg) => {
    console.log(`  ✗ 认证失败: ${msg}`);
    console.log("  请先运行主程序完成 WhatsApp 登录");
    process.exit(1);
  });

  await client.initialize();

  // 超时保护
  setTimeout(() => {
    console.log("  ✗ 超时 (60s)，客户端未就绪");
    process.exit(1);
  }, 60000);
}

run().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
