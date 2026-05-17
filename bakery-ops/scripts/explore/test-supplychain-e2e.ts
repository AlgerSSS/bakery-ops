/**
 * 供应链模块端到端测试
 * 用法: node --import tsx src/__tests__/test-supplychain-e2e.ts
 *
 * 测试流程:
 * 1. 订货报数 → 解析 → 存数据库
 * 2. 汇总订货 → 读 KDocs 目录 → 按渠道分组
 * 3. 发送订货 → 渠道A 填 Excel / 渠道B WMS 下单
 */
import "dotenv/config";
import * as fs from "fs";
import { parseOrderItems, isOrderMessage, isArrivalMessage, isConsolidateRequest } from "../modules/domain/supplychain/order-parser";
import { supplyOrderRepository } from "../modules/data/repositories/supply-order.repository";
import { arrivalRecordRepository } from "../modules/data/repositories/arrival-record.repository";
import { orderConsolidator } from "../modules/domain/supplychain/order-consolidator";
import { kdocsConnector } from "../modules/domain/supplychain/connectors/kdocs.connector";
import { excelFiller } from "../modules/domain/supplychain/excel-filler";
import type { OrderItem } from "../modules/domain/supplychain/types";

const log: string[] = [];
function print(msg: string) {
  console.log(msg);
  log.push(msg);
}

async function testParser() {
  print("═══════════════════════════════════════");
  print("  TEST 1: 订货消息解析器");
  print("═══════════════════════════════════════");

  const cases = [
    { input: "订货: 面粉:50kg, 糖:20kg", expectCount: 2 },
    { input: "订货: 鸡蛋:200个, 牛奶:10升, 黄油:5箱", expectCount: 3 },
    { input: "到货: 面粉:48kg, 糖:20kg", expectCount: 2 },
    { input: "订货: 安琪鲜酵母:3包, 迪比科牛奶:10箱, 红豆粒:5kg", expectCount: 3 },
  ];

  let passed = 0;
  for (const tc of cases) {
    const items = parseOrderItems(tc.input);
    const ok = items.length === tc.expectCount;
    print(`  ${ok ? "✓" : "✗"} "${tc.input}" → ${items.length} items ${ok ? "" : "(expected " + tc.expectCount + ")"}`);
    if (ok) passed++;
    items.forEach((i) => print(`      ${i.name}: ${i.quantity}${i.unit}`));
  }

  print(`\n  结果: ${passed}/${cases.length} 通过`);

  // 测试消息类型检测
  print("\n  消息类型检测:");
  print(`    isOrderMessage("订货: 面粉:50kg") = ${isOrderMessage("订货: 面粉:50kg")}`);
  print(`    isArrivalMessage("到货: 面粉:48kg") = ${isArrivalMessage("到货: 面粉:48kg")}`);
  print(`    isConsolidateRequest("汇总今天的订货") = ${isConsolidateRequest("汇总今天的订货")}`);
  print("");
}

async function testDatabase() {
  print("═══════════════════════════════════════");
  print("  TEST 2: 数据库读写");
  print("═══════════════════════════════════════");

  const today = new Date().toISOString().split("T")[0];
  const storeId = "test_store";

  // 创建订单
  print("  创建订单...");
  const items: OrderItem[] = [
    { name: "面粉", quantity: 50, unit: "kg" },
    { name: "糖", quantity: 20, unit: "kg" },
  ];

  const order = await supplyOrderRepository.create({
    orderDate: today,
    storeId,
    status: "draft",
    items,
    createdBy: "test_user",
  });

  if (!order) {
    print("  ✗ 创建订单失败");
    return null;
  }
  print(`  ✓ 订单已创建: id=${order.id}`);

  // 追加物品
  print("  追加物品...");
  const moreItems: OrderItem[] = [
    { name: "鸡蛋", quantity: 200, unit: "个" },
    { name: "牛奶", quantity: 10, unit: "升" },
  ];
  const appended = await supplyOrderRepository.appendItems(order.id, moreItems, "test_user_2");
  print(`  ${appended ? "✓" : "✗"} 追加物品: ${appended}`);

  // 读取订单
  const fetched = await supplyOrderRepository.getById(order.id);
  if (fetched) {
    const allItems = Array.isArray(fetched.items) ? fetched.items : [];
    print(`  ✓ 读取订单: ${allItems.length} 项物品`);
    allItems.forEach((i: any) => print(`      ${i.name}: ${i.quantity}${i.unit}`));
  }

  print("");
  return order.id;
}

async function testKDocsCatalog() {
  print("═══════════════════════════════════════");
  print("  TEST 3: KDocs 目录读取");
  print("═══════════════════════════════════════");

  print("  读取物品目录...");
  const catalog = await kdocsConnector.getCatalog();
  print(`  ✓ 读取到 ${catalog.length} 项物品`);

  const whatsapp = catalog.filter((c) => c.channel === "whatsapp");
  const wms = catalog.filter((c) => c.channel === "wms");
  print(`    渠道A (WhatsApp): ${whatsapp.length} 项`);
  print(`    渠道B (WMS): ${wms.length} 项`);

  // 显示部分物品
  print("\n  WhatsApp 渠道示例:");
  whatsapp.slice(0, 5).forEach((c) => print(`    NO.${c.no} ${c.name} [${c.supplier}]`));
  print("  WMS 渠道示例:");
  wms.slice(0, 5).forEach((c) => print(`    NO.${c.no} ${c.name} [${c.supplier}]`));

  print("");
  return catalog;
}

async function testConsolidate(orderId: string) {
  print("═══════════════════════════════════════");
  print("  TEST 4: 订货汇总 + 渠道分流");
  print("═══════════════════════════════════════");

  print("  汇总订单...");
  const consolidation = await orderConsolidator.consolidateOrder(orderId);

  if (!consolidation) {
    print("  ✗ 汇总失败");
    return;
  }

  print(`  ✓ 汇总完成:`);
  print(`    日期: ${consolidation.date}`);
  print(`    总项数: ${consolidation.totalItems}`);
  print(`    渠道A: ${consolidation.channelSplit.whatsappItems.length} 项`);
  print(`    渠道B: ${consolidation.channelSplit.wmsItems.length} 项`);
  print("");
  print("  文字汇总:");
  consolidation.summaryText.split("\n").forEach((l) => print("    " + l));
  print("");
}

async function testExcelGeneration() {
  print("═══════════════════════════════════════");
  print("  TEST 5: Excel 生成");
  print("═══════════════════════════════════════");

  const items: OrderItem[] = [
    { name: "面粉", quantity: 50, unit: "kg", catalogNo: 7, supplier: "mage" },
    { name: "糖", quantity: 20, unit: "kg", catalogNo: 48, supplier: "超市" },
    { name: "鸡蛋", quantity: 200, unit: "个", catalogNo: 89, supplier: "鸡蛋1-6" },
  ];

  print("  生成 Excel 订货单...");
  const filePath = await excelFiller.fillOrderTemplate(items, "test_store", "2026-05-06");

  if (filePath) {
    const stat = fs.statSync(filePath);
    print(`  ✓ Excel 已生成: ${filePath}`);
    print(`    文件大小: ${stat.size} bytes`);
  } else {
    print("  ✗ Excel 生成失败");
  }
  print("");
}

async function testArrivalCheck(orderId: string) {
  print("═══════════════════════════════════════");
  print("  TEST 6: 到货核对");
  print("═══════════════════════════════════════");

  // 模拟到货（面粉少了2kg）
  const arrivalItems = [
    { name: "面粉", quantity: 48, unit: "kg" },
    { name: "糖", quantity: 20, unit: "kg" },
    { name: "鸡蛋", quantity: 195, unit: "个" },
  ];

  print("  记录到货...");
  const record = await arrivalRecordRepository.create({
    orderId,
    storeId: "test_store",
    items: arrivalItems,
    reportedBy: "test_user",
  });

  if (record) {
    print(`  ✓ 到货记录已保存: id=${record.id}`);
  } else {
    print("  ✗ 到货记录保存失败");
  }

  // 对比差异
  const order = await supplyOrderRepository.getById(orderId);
  if (order) {
    const orderItems: OrderItem[] = Array.isArray(order.items) ? order.items : [];
    print("\n  差异对比:");
    for (const arrival of arrivalItems) {
      const ordered = orderItems.find((o: any) => o.name === arrival.name);
      if (ordered) {
        const diff = arrival.quantity - ordered.quantity;
        if (Math.abs(diff) > 0.01) {
          print(`    ${diff > 0 ? "📈" : "📉"} ${arrival.name}: 订 ${ordered.quantity}${ordered.unit} → 到 ${arrival.quantity}${arrival.unit} (${diff > 0 ? "多" : "少"} ${Math.abs(diff)})`);
        } else {
          print(`    ✓ ${arrival.name}: 数量一致 (${arrival.quantity}${arrival.unit})`);
        }
      }
    }
  }
  print("");
}

async function cleanup(orderId: string) {
  // 清理测试数据
  print("═══════════════════════════════════════");
  print("  清理测试数据");
  print("═══════════════════════════════════════");
  // 不删除，保留作为验证
  print("  (保留测试数据供验证)");
  print("");
}

async function main() {
  print("╔═══════════════════════════════════════╗");
  print("║   供应链模块 端到端测试               ║");
  print("╚═══════════════════════════════════════╝");
  print("");

  try {
    // Test 1: 解析器
    await testParser();

    // Test 2: 数据库
    const orderId = await testDatabase();
    if (!orderId) {
      print("数据库测试失败，终止后续测试");
      return;
    }

    // Test 3: KDocs 目录
    await testKDocsCatalog();

    // Test 4: 汇总
    await testConsolidate(orderId);

    // Test 5: Excel
    await testExcelGeneration();

    // Test 6: 到货核对
    await testArrivalCheck(orderId);

    // 清理
    await cleanup(orderId);

    print("╔═══════════════════════════════════════╗");
    print("║   全部测试完成                        ║");
    print("╚═══════════════════════════════════════╝");
  } catch (err) {
    print(`\n✗ 测试异常: ${String(err)}`);
  }

  // 保存日志
  fs.writeFileSync("/tmp/supplychain-e2e-result.txt", log.join("\n"));
}

main();
