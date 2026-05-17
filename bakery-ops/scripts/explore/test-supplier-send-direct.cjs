/**
 * 发送测试消息给供应商 - 绕过 whatsapp-web.js 主 index 避免 RemoteAuth hang
 * 用法: node src/__tests__/test-supplier-send-direct.cjs
 */
require("tsx/cjs");
require("dotenv/config");

async function main() {
  const Client = require("../../node_modules/whatsapp-web.js/src/Client");
  const LocalAuth = require("../../node_modules/whatsapp-web.js/src/authStrategies/LocalAuth");
  const { MessageMedia } = require("../../node_modules/whatsapp-web.js/src/structures");

  const SUPPLIER_ID = process.env.SUPPLIER_DEFAULT_WHATSAPP || "60175436694@c.us";
  const SESSION_PATH = process.env.WHATSAPP_SESSION_DATA_PATH || "./whatsapp-session";

  console.log("═══════════════════════════════════════");
  console.log("  发送测试消息给供应商 (绕过 RemoteAuth)");
  console.log("═══════════════════════════════════════");
  console.log("  目标: " + SUPPLIER_ID);
  console.log("  Session: " + SESSION_PATH);
  console.log("");

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  let resolved = false;
  const waitForReady = new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; resolve(false); }
    }, 60000);

    if (client.info?.wid) {
      clearTimeout(timer);
      if (!resolved) { resolved = true; resolve(true); }
      return;
    }

    client.on("ready", () => {
      clearTimeout(timer);
      if (!resolved) { resolved = true; resolve(true); }
    });
  });

  client.on("qr", (qr) => {
    console.log("  ⚠ 需要扫码！");
    console.log("  " + qr.slice(0, 100) + "...");
  });

  client.on("auth_failure", (msg) => {
    console.log("  ✗ 认证失败: " + msg);
    resolved = true;
    process.exit(1);
  });

  console.log("  启动 WhatsApp 客户端...");
  client.initialize();

  const ready = await waitForReady;
  if (!ready) {
    console.log("  ✗ 超时：客户端未在 60 秒内就绪");
    console.log("  请先运行主程序 (npm run dev) 完成 WhatsApp 扫码登录");
    process.exit(1);
  }

  console.log("  ✓ 客户端已就绪");
  console.log("  Bot ID: " + (client.info?.wid?._serialized || "unknown") + "\n");

  try {
    const today = new Date().toISOString().split("T")[0];
    const message = [
      "📋 " + today + " 订货单 (测试)",
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

    console.log("  发送内容:");
    console.log("  ─────────────────────────────");
    message.split("\n").forEach(l => console.log("  │ " + l));
    console.log("  ─────────────────────────────\n");

    console.log("  发送中...");
    const sent = await client.sendMessage(SUPPLIER_ID, message);
    console.log("  ✓ 消息已发送！");
    console.log("    消息ID: " + sent.id._serialized);
    console.log("    时间: " + new Date().toLocaleString());
  } catch (err) {
    console.log("  ✗ 发送失败: " + String(err));
  }

  console.log("\n  关闭客户端...");
  await client.destroy();
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
