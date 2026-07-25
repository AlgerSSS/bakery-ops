// F18: wms_stock skill 解析与格式化（IMPROVEMENT-PLAN.md F18）
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../modules/domain/supplychain/connectors/wms.connector", () => ({
  wmsConnector: { getStock: vi.fn() },
}));

import {
  WmsStockSkillHandler,
  parseStockQueryItems,
  formatStockReply,
} from "../../modules/skills/wms-stock/wms-stock.definition";
import { wmsConnector } from "../../modules/domain/supplychain/connectors/wms.connector";

const getStockMock = wmsConnector.getStock as ReturnType<typeof vi.fn>;

const run = (text: string) =>
  new WmsStockSkillHandler().execute({ input: { text } } as never);

describe("parseStockQueryItems", () => {
  it("库存 面粉 -> [面粉]", () => {
    expect(parseStockQueryItems("库存 面粉")).toEqual(["面粉"]);
  });

  it("查库存 面粉 黄油 -> 两项", () => {
    expect(parseStockQueryItems("查库存 面粉 黄油")).toEqual(["面粉", "黄油"]);
  });

  it("支持逗号/顿号/冒号分隔", () => {
    expect(parseStockQueryItems("库存: 面粉，黄油、鸡蛋")).toEqual(["面粉", "黄油", "鸡蛋"]);
  });

  it("面粉库存 -> [面粉]", () => {
    expect(parseStockQueryItems("面粉库存")).toEqual(["面粉"]);
  });

  it("仅触发词无物品 -> 空", () => {
    expect(parseStockQueryItems("库存")).toEqual([]);
    expect(parseStockQueryItems("查库存")).toEqual([]);
  });
});

describe("formatStockReply", () => {
  it("有匹配 -> 列出 SKU 与数量", () => {
    const text = formatStockReply([
      {
        query: "面粉",
        matches: [{ sku: "CYLC118", name: "Traditional French Flour T65 法国伯爵传统T65面粉", qty: 15 }],
      },
    ]);
    expect(text).toContain("面粉:");
    expect(text).toContain("CYLC118");
    expect(text).toContain(": 15");
  });

  it("无匹配 -> 提示未找到", () => {
    const text = formatStockReply([{ query: "神秘物品", matches: [] }]);
    expect(text).toContain("神秘物品: 未找到匹配 SKU");
  });

  it("超过 5 个匹配 -> 截断提示", () => {
    const matches = Array.from({ length: 7 }, (_, i) => ({ sku: `SKU${i}`, name: `物品${i}`, qty: i }));
    const text = formatStockReply([{ query: "多", matches }]);
    expect(text).toContain("共 7 个匹配");
    expect(text).not.toContain("SKU5");
  });
});

describe("WmsStockSkillHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("无物品名 -> 用法提示", async () => {
    const r = await run("库存");
    expect(r.status).toBe("error");
    expect(r.summary).toContain("请指定要查询的物品名");
    expect(getStockMock).not.toHaveBeenCalled();
  });

  it("查询成功 -> 格式化结果", async () => {
    getStockMock.mockResolvedValue({
      success: true,
      items: [{ query: "面粉", matches: [{ sku: "CYLC118", name: "T65面粉", qty: 15 }] }],
    });
    const r = await run("库存 面粉");
    expect(getStockMock).toHaveBeenCalledWith(["面粉"]);
    expect(r.status).toBe("success");
    expect(r.summary).toContain("CYLC118");
    expect(r.summary).toContain("15");
  });

  it("连接失败 (success:false) -> 稍后再试", async () => {
    getStockMock.mockResolvedValue({ success: false, error: "WMS 登录失败", items: [] });
    const r = await run("库存 面粉");
    expect(r.status).toBe("error");
    expect(r.summary).toBe("WMS 暂时连不上，请稍后再试");
  });

  it("抛异常 -> 稍后再试", async () => {
    getStockMock.mockRejectedValue(new Error("net::ERR_TIMED_OUT"));
    const r = await run("库存 面粉");
    expect(r.status).toBe("error");
    expect(r.summary).toBe("WMS 暂时连不上，请稍后再试");
  });
});

describe("parseSkuStockText (connector)", () => {
  it("解析 QTY 文本", async () => {
    const { parseSkuStockText } = await vi.importActual<
      typeof import("../../modules/domain/supplychain/connectors/wms.connector")
    >("../../modules/domain/supplychain/connectors/wms.connector");
    expect(
      parseSkuStockText("CYLC118 (Traditional French Flour T65 法国伯爵传统T65面粉) (QTY:15)"),
    ).toEqual({ sku: "CYLC118", name: "Traditional French Flour T65 法国伯爵传统T65面粉", qty: 15 });
    // 名称内含括号
    expect(
      parseSkuStockText("CYL124 (Yellow Mustard (2.98kg) 黄芥末调味酱（桶装2.98kg）) (QTY:22)"),
    ).toEqual({ sku: "CYL124", name: "Yellow Mustard (2.98kg) 黄芥末调味酱（桶装2.98kg）", qty: 22 });
    // 无 QTY -> null
    expect(parseSkuStockText("CYL001 (Ceramic Cup 陶瓷杯)")).toBeNull();
  });
});
