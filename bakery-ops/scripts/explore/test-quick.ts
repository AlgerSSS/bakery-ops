/**
 * Quick integration test for supply chain module
 * Usage: npx tsx src/__tests__/test-quick.ts
 */
import "dotenv/config";
import { supplyOrderRepository } from "../modules/data/repositories/supply-order.repository";
import { arrivalRecordRepository } from "../modules/data/repositories/arrival-record.repository";
import { kdocsConnector } from "../modules/domain/supplychain/connectors/kdocs.connector";
import { orderConsolidator } from "../modules/domain/supplychain/order-consolidator";
import { excelFiller } from "../modules/domain/supplychain/excel-filler";
import * as fs from "fs";
import type { OrderItem } from "../modules/domain/supplychain/types";

async function run() {
  const results: string[] = [];
  function log(msg: string) { console.log(msg); results.push(msg); }

  // TEST 1: Database
  log("\n=== TEST 1: 数据库 ===");
  const today = new Date().toISOString().split("T")[0];
  const items: OrderItem[] = [
    { name: "面粉", quantity: 50, unit: "kg" },
    { name: "糖", quantity: 20, unit: "kg" },
  ];
  const order = await supplyOrderRepository.create({
    orderDate: today,
    storeId: "test_store",
    status: "draft",
    items,
    createdBy: "test_user",
  });
  if (!order) {
    log("✗ 创建订单失败");
    return;
  }
  log(`✓ 订单已创建: id=${order.id}`);

  const moreItems: OrderItem[] = [
    { name: "鸡蛋", quantity: 200, unit: "个" },
    { name: "牛奶", quantity: 10, unit: "升" },
  ];
  const appended = await supplyOrderRepository.appendItems(order.id, moreItems, "test_user_2");
  log(`${appended ? "✓" : "✗"} 追加物品`);

  const fetched = await supplyOrderRepository.getById(order.id);
  if (fetched) {
    const allItems = Array.isArray(fetched.items) ? fetched.items : [];
    log(`✓ 读取订单: ${allItems.length} 项物品`);
  }

  // TEST 2: KDocs
  log("\n=== TEST 2: KDocs 目录 ===");
  const catalog = await kdocsConnector.getCatalog();
  log(`✓ 读取到 ${catalog.length} 项物品`);
  const whatsapp = catalog.filter((c) => c.channel === "whatsapp");
  const wms = catalog.filter((c) => c.channel === "wms");
  log(`  渠道A (WhatsApp): ${whatsapp.length} 项`);
  log(`  渠道B (WMS): ${wms.length} 项`);

  // TEST 3: Consolidation
  log("\n=== TEST 3: 订货汇总 ===");
  const consolidation = await orderConsolidator.consolidateOrder(order.id);
  if (consolidation) {
    log(`✓ 汇总完成: 总${consolidation.totalItems}项`);
    log(`  渠道A: ${consolidation.channelSplit.whatsappItems.length} 项`);
    log(`  渠道B: ${consolidation.channelSplit.wmsItems.length} 项`);
  } else {
    log("✗ 汇总失败");
  }

  // TEST 4: Excel
  log("\n=== TEST 4: Excel 生成 ===");
  const excelItems: OrderItem[] = [
    { name: "面粉", quantity: 50, unit: "kg", catalogNo: 7, supplier: "mage" },
    { name: "糖", quantity: 20, unit: "kg", catalogNo: 48, supplier: "超市" },
  ];
  const filePath = await excelFiller.fillOrderTemplate(excelItems, "test_store", today);
  if (filePath) {
    const stat = fs.statSync(filePath);
    log(`✓ Excel 已生成: ${filePath} (${stat.size} bytes)`);
  } else {
    log("✗ Excel 生成失败");
  }

  // TEST 5: Arrival check
  log("\n=== TEST 5: 到货核对 ===");
  const arrivalItems = [
    { name: "面粉", quantity: 48, unit: "kg" },
    { name: "糖", quantity: 20, unit: "kg" },
  ];
  const record = await arrivalRecordRepository.create({
    orderId: order.id,
    storeId: "test_store",
    items: arrivalItems,
    reportedBy: "test_user",
  });
  log(record ? `✓ 到货记录已保存: id=${record.id}` : "✗ 到货记录保存失败");

  log("\n=== 全部测试完成 ===");
  fs.writeFileSync("/tmp/supplychain-test-result.txt", results.join("\n"));
  process.exit(0);
}

run().catch((e) => {
  console.error("测试异常:", e);
  process.exit(1);
});
