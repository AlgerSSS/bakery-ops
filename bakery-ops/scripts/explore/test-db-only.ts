console.log("step 1: start");
import { supplyOrderRepository } from "../modules/data/repositories/supply-order.repository";
console.log("step 2: repo imported");

async function main() {
  console.log("step 3: running");
  const today = new Date().toISOString().split("T")[0];
  const order = await supplyOrderRepository.create({
    orderDate: today,
    storeId: "test_store",
    status: "draft",
    items: [{ name: "面粉", quantity: 50, unit: "kg" }],
    createdBy: "test_user",
  });
  console.log("step 4: result", order ? `id=${order.id}` : "FAILED");
  process.exit(0);
}
main();
