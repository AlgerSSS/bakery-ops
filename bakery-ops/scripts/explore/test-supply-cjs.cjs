#!/usr/bin/env node
// Quick supply chain test - uses tsx register for TS imports
require("tsx/cjs");
require("dotenv/config");

const { parseOrderItems, isOrderMessage, isArrivalMessage, isConsolidateRequest } = require("../modules/domain/supplychain/order-parser");
const { supplyOrderRepository } = require("../modules/data/repositories/supply-order.repository");
const { arrivalRecordRepository } = require("../modules/data/repositories/arrival-record.repository");
const { kdocsConnector } = require("../modules/domain/supplychain/connectors/kdocs.connector");
const { orderConsolidator } = require("../modules/domain/supplychain/order-consolidator");
const { excelFiller } = require("../modules/domain/supplychain/excel-filler");
const fs = require("fs");

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
  let parserPass = 0;
  for (const tc of cases) {
    const items = parseOrderItems(tc.input);
    const ok = items.length === tc.expect;
    if (ok) parserPass++;
    console.log(`  ${ok ? "✓" : "✗"} "${tc.input}" → ${items.length} items`);
  }
  console.log(`  结果: ${parserPass}/${cases.length} 通过`);
  console.log(`  isOrderMessage: ${isOrderMessage("订货: 面粉:50kg")}`);
  console.log(`  isArrivalMessage: ${isArrivalMessage("到货: 面粉:48kg")}`);
  console.log(`  isConsolidateRequest: ${isConsolidateRequest("汇总今天的订货")}`);

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
  if (!order) {
    console.log("  ✗ 创建订单失败");
    process.exit(1);
  }
  console.log(`  ✓ 订单已创建: id=${order.id}`);

  const appended = await supplyOrderRepository.appendItems(order.id, [
    { name: "鸡蛋", quantity: 200, unit: "个" },
  ], "test_user_2");
  console.log(`  ${appended ? "✓" : "✗"} 追加物品`);

  const fetched = await supplyOrderRepository.getById(order.id);
  const allItems = fetched && Array.isArray(fetched.items) ? fetched.items : [];
  console.log(`  ✓ 读取订单: ${allItems.length} 项物品`);

  // TEST 3: KDocs
  console.log("\n=== TEST 3: KDocs 目录 ===");
  const catalog = await kdocsConnector.getCatalog();
  const whatsapp = catalog.filter((c) => c.channel === "whatsapp");
  const wms = catalog.filter((c) => c.channel === "wms");
  console.log(`  ✓ 读取到 ${catalog.length} 项物品`);
  console.log(`    渠道A (WhatsApp): ${whatsapp.length} 项`);
  console.log(`    渠道B (WMS): ${wms.length} 项`);

  // TEST 4: Consolidation
  console.log("\n=== TEST 4: 订货汇总 ===");
  const consolidation = await orderConsolidator.consolidateOrder(order.id);
  if (consolidation) {
    console.log(`  ✓ 汇总完成: 总${consolidation.totalItems}项`);
    console.log(`    渠道A: ${consolidation.channelSplit.whatsappItems.length} 项`);
    console.log(`    渠道B: ${consolidation.channelSplit.wmsItems.length} 项`);
  } else {
    console.log("  ✗ 汇总失败");
  }

  // TEST 5: Excel
  console.log("\n=== TEST 5: Excel 生成 ===");
  const excelItems = [
    { name: "面粉", quantity: 50, unit: "kg", catalogNo: 7, supplier: "mage" },
    { name: "糖", quantity: 20, unit: "kg", catalogNo: 48, supplier: "超市" },
  ];
  const filePath = await excelFiller.fillOrderTemplate(excelItems, "test_store", today);
  if (filePath) {
    const stat = fs.statSync(filePath);
    console.log(`  ✓ Excel 已生成: ${filePath} (${stat.size} bytes)`);
  } else {
    console.log("  ✗ Excel 生成失败 (可能缺少模板文件)");
  }

  // TEST 6: Arrival
  console.log("\n=== TEST 6: 到货核对 ===");
  const record = await arrivalRecordRepository.create({
    orderId: order.id,
    storeId: "test_store",
    items: [{ name: "面粉", quantity: 48, unit: "kg" }, { name: "糖", quantity: 20, unit: "kg" }],
    reportedBy: "test_user",
  });
  console.log(record ? `  ✓ 到货记录已保存: id=${record.id}` : "  ✗ 到货记录保存失败");

  console.log("\n╔═══════════════════════════════════════╗");
  console.log("║   全部测试完成                        ║");
  console.log("╚═══════════════════════════════════════╝");
  process.exit(0);
}

run().catch((e) => {
  console.error("测试异常:", e);
  process.exit(1);
});
