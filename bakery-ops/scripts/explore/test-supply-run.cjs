#!/usr/bin/env node
// Supply chain integration test (no exceljs - hangs on Node v24)
require("tsx/cjs");
require("dotenv/config");

const { parseOrderItems, isOrderMessage, isArrivalMessage, isConsolidateRequest } = require("../modules/domain/supplychain/order-parser");
const { supplyOrderRepository } = require("../modules/data/repositories/supply-order.repository");
const { arrivalRecordRepository } = require("../modules/data/repositories/arrival-record.repository");
const { kdocsConnector } = require("../modules/domain/supplychain/connectors/kdocs.connector");
const { orderConsolidator } = require("../modules/domain/supplychain/order-consolidator");

async function run() {
  console.log("╔═══════════════════════════════════════╗");
  console.log("║   供应链模块 集成测试                 ║");
  console.log("╚═══════════════════════════════════════╝\n");

  // TEST 1: Parser
  console.log("=== TEST 1: 订货消息解析器 ===");
  const cases = [
    { input: "订货: 面粉:50kg, 糖:20kg", expect: 2 },
    { input: "订货: 鸡蛋:200个, 牛奶:10升, 黄油:5箱", expect: 3 },
    { input: "订货: 安琪鲜酵母:3包, 迪比科牛奶:10箱, 红豆粒:5kg", expect: 3 },
  ];
  let pass = 0;
  for (const tc of cases) {
    const items = parseOrderItems(tc.input);
    const ok = items.length === tc.expect;
    if (ok) pass++;
    console.log(`  ${ok ? "✓" : "✗"} "${tc.input}" → ${items.length} items`);
  }
  console.log(`  结果: ${pass}/${cases.length} 通过`);
  console.log(`  isOrderMessage("订货: 面粉:50kg") = ${isOrderMessage("订货: 面粉:50kg")}`);
  console.log(`  isArrivalMessage("到货: 面粉:48kg") = ${isArrivalMessage("到货: 面粉:48kg")}`);
  console.log(`  isConsolidateRequest("汇总今天的订货") = ${isConsolidateRequest("汇总今天的订货")}`);

  // TEST 2: Database
  console.log("\n=== TEST 2: 数据库读写 ===");
  const today = new Date().toISOString().split("T")[0];
  const order = await supplyOrderRepository.create({
    orderDate: today,
    storeId: "test_store",
    status: "draft",
    items: [{ name: "面粉", quantity: 50, unit: "kg" }, { name: "糖", quantity: 20, unit: "kg" }],
    createdBy: "test_user",
  });
  if (order) {
    console.log(`  ✓ 订单已创建: id=${order.id}`);
  } else {
    console.log("  ✗ 创建订单失败");
    process.exit(1);
  }

  const appended = await supplyOrderRepository.appendItems(order.id, [
    { name: "鸡蛋", quantity: 200, unit: "个" },
    { name: "牛奶", quantity: 10, unit: "升" },
  ], "test_user_2");
  console.log(`  ${appended ? "✓" : "✗"} 追加物品`);

  const fetched = await supplyOrderRepository.getById(order.id);
  if (fetched) {
    const allItems = Array.isArray(fetched.items) ? fetched.items : [];
    console.log(`  ✓ 读取订单: ${allItems.length} 项物品`);
  }

  // TEST 3: KDocs
  console.log("\n=== TEST 3: KDocs 目录读取 ===");
  const catalog = await kdocsConnector.getCatalog();
  const whatsapp = catalog.filter((c) => c.channel === "whatsapp");
  const wms = catalog.filter((c) => c.channel === "wms");
  console.log(`  ✓ 读取到 ${catalog.length} 项物品`);
  console.log(`    渠道A (WhatsApp): ${whatsapp.length} 项`);
  console.log(`    渠道B (WMS): ${wms.length} 项`);
  console.log(`    示例: ${catalog.slice(0, 3).map(c => `NO.${c.no} ${c.name}`).join(", ")}`);

  // TEST 4: Consolidation
  console.log("\n=== TEST 4: 订货汇总 + 渠道分流 ===");
  const consolidation = await orderConsolidator.consolidateOrder(order.id);
  if (consolidation) {
    console.log(`  ✓ 汇总完成: 总${consolidation.totalItems}项`);
    console.log(`    渠道A: ${consolidation.channelSplit.whatsappItems.length} 项`);
    console.log(`    渠道B: ${consolidation.channelSplit.wmsItems.length} 项`);
    if (consolidation.summaryText) {
      console.log("  汇总文本(前200字):");
      console.log("    " + consolidation.summaryText.slice(0, 200).replace(/\n/g, "\n    "));
    }
  } else {
    console.log("  ✗ 汇总失败");
  }

  // TEST 5: Arrival check
  console.log("\n=== TEST 5: 到货核对 ===");
  const record = await arrivalRecordRepository.create({
    orderId: order.id,
    storeId: "test_store",
    items: [
      { name: "面粉", quantity: 48, unit: "kg" },
      { name: "糖", quantity: 20, unit: "kg" },
      { name: "鸡蛋", quantity: 195, unit: "个" },
    ],
    reportedBy: "test_user",
  });
  if (record) {
    console.log(`  ✓ 到货记录已保存: id=${record.id}`);
  } else {
    console.log("  ✗ 到货记录保存失败");
  }

  // 差异对比
  if (fetched && record) {
    const orderItems = Array.isArray(fetched.items) ? fetched.items : [];
    const arrivalItems = [
      { name: "面粉", quantity: 48, unit: "kg" },
      { name: "糖", quantity: 20, unit: "kg" },
      { name: "鸡蛋", quantity: 195, unit: "个" },
    ];
    console.log("  差异对比:");
    for (const arrival of arrivalItems) {
      const ordered = orderItems.find((o) => o.name === arrival.name);
      if (ordered) {
        const diff = arrival.quantity - ordered.quantity;
        if (Math.abs(diff) > 0.01) {
          console.log(`    ${diff > 0 ? "多" : "少"} ${arrival.name}: 订${ordered.quantity}${ordered.unit} → 到${arrival.quantity}${arrival.unit} (差${Math.abs(diff)})`);
        } else {
          console.log(`    ✓ ${arrival.name}: 一致 (${arrival.quantity}${arrival.unit})`);
        }
      }
    }
  }

  // TEST 6: Excel (skip actual generation due to Node v24 exceljs hang)
  console.log("\n=== TEST 6: Excel 生成 ===");
  console.log("  ⚠ 跳过 (exceljs 在 Node v24 下 import 挂起，运行时使用 lazy import 已修复)");

  console.log("\n╔═══════════════════════════════════════╗");
  console.log("║   全部测试完成                        ║");
  console.log("╚═══════════════════════════════════════╝");
  process.exit(0);
}

run().catch((e) => {
  console.error("测试异常:", e);
  process.exit(1);
});
