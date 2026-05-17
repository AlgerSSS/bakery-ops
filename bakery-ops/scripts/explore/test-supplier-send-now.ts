/**
 * 发送订货消息给供应商 - 使用已有 WhatsApp session
 * 注意：需先停掉 dev server（同一 session 不能同时连接两次）
 * 用法: npx tsx src/__tests__/test-supplier-send-now.ts
 */
import "dotenv/config";
import { getWhatsAppClient } from "../modules/channel/whatsapp/whatsapp.client";
import { excelFiller } from "../modules/domain/supplychain/excel-filler";
import { supplierMessenger } from "../modules/domain/supplychain/supplier-messenger";
import type { OrderItem } from "../modules/domain/supplychain/types";

const SUPPLIER_ID = process.env.SUPPLIER_DEFAULT_WHATSAPP || "60175436694@c.us";

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  供应链 - 发送订货给供应商");
  console.log("═══════════════════════════════════════");
  console.log(`  供应商: ${SUPPLIER_ID}\n`);

  // Step 1: 生成 Excel 订货单
  console.log("1. 生成订货 Excel...");
  const today = new Date().toISOString().split("T")[0];
  const items: OrderItem[] = [
    { name: "面粉", quantity: 50, unit: "kg", catalogNo: 7, supplier: "mage" },
    { name: "糖", quantity: 20, unit: "kg", catalogNo: 5, supplier: "超市" },
    { name: "鸡蛋", quantity: 200, unit: "个", catalogNo: 89, supplier: "鸡蛋1-6" },
    { name: "迪比科牛奶", quantity: 10, unit: "升", catalogNo: 2, supplier: "迪比克1-5" },
  ];

  const excelPath = await excelFiller.fillOrderTemplate(items, "test", today);
  if (!excelPath) {
    console.log("  ✗ Excel 生成失败");
    process.exit(1);
  }
  console.log(`  ✓ Excel 已生成: ${excelPath}\n`);

  // Step 2: 连接 WhatsApp
  console.log("2. 连接 WhatsApp...");
  const client = getWhatsAppClient();

  const waitForReady = (timeoutMs: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      if (client.info?.wid) { clearTimeout(timer); resolve(true); return; }
      client.on("ready", () => { clearTimeout(timer); resolve(true); });
    });
  };

  client.on("qr", (qr: string) => {
    console.log("  ⚠ 需要扫码！scan this QR with WhatsApp:");
    console.log("  " + qr.slice(0, 80) + "...");
  });

  client.on("auth_failure", (msg: string) => {
    console.log(`  ✗ 认证失败: ${msg}`);
    process.exit(1);
  });

  client.initialize();
  const ready = await waitForReady(30000);
  if (!ready) {
    console.log("  ✗ WhatsApp 连接超时（可能 server 还在运行）");
    process.exit(1);
  }
  console.log(`  ✓ WhatsApp 已连接 (${client.info?.wid?._serialized})\n`);

  // Step 3: 发送消息给供应商
  console.log("3. 发送订货消息给供应商...");

  const caption = `📋 ${today} 订货单 - Hot Crush 测试\n共 ${items.length} 项物品，请确认。`;

  const result = await supplierMessenger.sendOrderToSupplier(
    SUPPLIER_ID,
    excelPath,
    caption,
  );

  if (result.success) {
    console.log("  ✓ 订货单已发送给供应商！");
    console.log(`    文件: ${excelPath}`);
    console.log(`    内容: ${caption}`);
  } else {
    console.log(`  ✗ 发送失败: ${result.error}`);

    // Fallback: 发送纯文本
    console.log("\n  尝试发送纯文本消息...");
    try {
      const textMsg = [
        `📋 ${today} 订货单 (Hot Crush 测试)`,
        "",
        "【订货项目】",
        ...items.map((i) => `  ${i.name}: ${i.quantity}${i.unit}`),
        "",
        "共 " + items.length + " 项物品",
        "",
        "--- 此为系统测试消息 ---",
      ].join("\n");

      const sent = await client.sendMessage(SUPPLIER_ID, textMsg);
      console.log(`  ✓ 文本消息已发送! ID: ${sent.id._serialized}`);
    } catch (err2) {
      console.log(`  ✗ 文本发送也失败: ${err2}`);
    }
  }

  console.log("\n  完成！");
  await client.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
