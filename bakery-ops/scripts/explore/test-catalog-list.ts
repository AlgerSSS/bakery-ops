import "dotenv/config";
import { kdocsConnector } from "../modules/domain/supplychain/connectors/kdocs.connector";

async function main() {
  const catalog = await kdocsConnector.getCatalog();
  const wa = catalog.filter((c: any) => c.channel === "whatsapp");
  const wms = catalog.filter((c: any) => c.channel === "wms");

  console.log("=== 渠道A - WhatsApp 供应商 (共" + wa.length + "项) ===\n");
  wa.forEach((c: any) => {
    console.log(`NO.${c.no} | ${c.name} | ${c.unit || "-"} | ${c.supplier || "未知"}`);
  });

  console.log("\n\n=== 渠道B - WMS 系统 (共" + wms.length + "项) ===\n");
  wms.forEach((c: any) => {
    console.log(`NO.${c.no} | ${c.name} | ${c.unit || "-"} | ${c.supplier || "未知"}`);
  });
}

main();
