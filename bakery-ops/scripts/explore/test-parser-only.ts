// 测试1: 解析器
const UNITS = ["kg", "g", "斤", "包", "箱", "瓶", "桶", "袋", "个", "盒", "升", "L", "ml", "条", "块", "片", "打", "罐", "支", "把"];
const UNIT_PATTERN = UNITS.map(u => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const ITEM_REGEX = new RegExp("([^,:：;；\\d]+?)[：:]\\s*(\\d+(?:\\.\\d+)?)\\s*(" + UNIT_PATTERN + ")", "gi");

const testCases = [
  "订货: 面粉:50kg, 糖:20kg",
  "订货: 鸡蛋:200个, 牛奶:10升, 黄油:5箱",
  "到货: 面粉:48kg, 糖:20kg",
];

console.log("=== 订货解析器测试 ===");
for (const tc of testCases) {
  const cleaned = tc.replace(/^订货[：:]\s*/i, "").replace(/^到货[：:]\s*/i, "").trim();
  const items: any[] = [];
  let match;
  const regex = new RegExp(ITEM_REGEX.source, "gi");
  while ((match = regex.exec(cleaned)) !== null) {
    items.push({ name: match[1].trim(), qty: parseFloat(match[2]), unit: match[3] });
  }
  console.log(`  "${tc}" => ${items.length} items:`, JSON.stringify(items));
}
