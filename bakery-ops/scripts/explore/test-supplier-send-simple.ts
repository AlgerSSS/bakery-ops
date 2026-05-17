/**
 * 测试发送消息给供应商 - 使用项目的 WhatsApp 客户端
 * 用法: npx tsx src/__tests__/test-supplier-send-simple.ts
 */
import "dotenv/config";
import { getWhatsAppClient } from "../modules/channel/whatsapp/whatsapp.client";

const SUPPLIER_ID = process.env.SUPPLIER_DEFAULT_WHATSAPP || "60175436694@c.us";

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  发送测试消息给供应商");
  console.log("═══════════════════════════════════════");
  console.log(`  目标: ${SUPPLIER_ID}\n`);

  const client = getWhatsAppClient();

  const waitForReady = (timeoutMs: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.log("  ✗ 超时：客户端未就绪");
        resolve(false);
      }, timeoutMs);

      // 如果客户端已经在 info 里有了 wid，说明已经 ready 过
      if (client.info?.wid) {
        clearTimeout(timer);
        resolve(true);
        return;
      }

      client.on("ready", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  };

  client.on("qr", (qr: string) => {
    console.log("  ⚠ 需要扫码！请用手机 WhatsApp 扫描:");
    console.log("  " + qr.slice(0, 100) + "...");
    console.log("  链接: https://web.whatsapp.com");
  });

  client.on("auth_failure", (msg: string) => {
    console.log(`  ✗ 认证失败: ${msg}`);
    process.exit(1);
  });

  // 初始化客户端
  console.log("  启动 WhatsApp 客户端...");
  client.initialize();

  const ready = await waitForReady(60000);
  if (!ready) {
    process.exit(1);
  }

  console.log("  ✓ 客户端已就绪");
  console.log(`  Bot ID: ${client.info?.wid?._serialized || "unknown"}\n`);

  // 发送测试消息
  try {
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

    console.log("  发送内容:");
    console.log("  ─────────────────────────────");
    message.split("\n").forEach((l) => console.log("  │ " + l));
    console.log("  ─────────────────────────────\n");

    console.log("  发送中...");
    const sent = await client.sendMessage(SUPPLIER_ID, message);
    console.log(`  ✓ 消息已发送!`);
    console.log(`    消息ID: ${sent.id._serialized}`);
    console.log(`    时间: ${new Date().toLocaleString()}`);
  } catch (err) {
    console.log(`  ✗ 发送失败: ${err}`);
  }

  await client.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
