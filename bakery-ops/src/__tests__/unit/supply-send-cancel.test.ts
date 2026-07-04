// B2: supply_send 取消分支（IMPROVEMENT-PLAN.md B2）
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../modules/data/repositories/supply-order.repository", () => ({
  supplyOrderRepository: {
    getTodayOrder: vi.fn().mockResolvedValue({ id: "order-1" }),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../modules/domain/supplychain/order-consolidator", () => ({
  orderConsolidator: {
    consolidateToday: vi.fn().mockResolvedValue({ summaryText: "订单预览", date: "2026-07-02", channelSplit: { whatsappItems: [], wmsItems: [] } }),
    consolidateOrder: vi.fn().mockResolvedValue({ summaryText: "订单预览", date: "2026-07-02", channelSplit: { whatsappItems: [], wmsItems: [] } }),
  },
}));
vi.mock("../../modules/domain/supplychain/excel-filler", () => ({ excelFiller: { fillOrderTemplate: vi.fn() } }));
vi.mock("../../modules/domain/supplychain/supplier-messenger", () => ({ supplierMessenger: { sendOrderToSupplier: vi.fn() } }));
vi.mock("../../modules/domain/supplychain/connectors/wms.connector", () => ({ wmsConnector: { placeOrder: vi.fn() } }));
vi.mock("../../modules/domain/supplychain/connectors/kdocs.connector", () => ({ kdocsConnector: { writeOrderRecord: vi.fn().mockResolvedValue(true) } }));

import { SupplySendSkillHandler } from "../../modules/skills/supply-send/supply-send.definition";
import { supplyOrderRepository } from "../../modules/data/repositories/supply-order.repository";

const run = (text: string, pendingOrderId?: string) =>
  new SupplySendSkillHandler().execute({
    input: { text, ...(pendingOrderId ? { pendingOrderId } : {}) },
  } as never);

describe("supply_send 确认/取消", () => {
  beforeEach(() => vi.clearAllMocks());

  it("待确认 + 确认词 -> 执行下单", async () => {
    const r = await run("确认", "order-1");
    expect(r.status).toBe("success");
    expect(supplyOrderRepository.updateStatus).toHaveBeenCalledWith("order-1", "sent", expect.anything());
  });

  it("待确认 + 其他内容 -> 真正取消（success 清状态，不重发预览）", async () => {
    const r = await run("算了不要了", "order-1");
    expect(r.status).toBe("success");
    expect(r.summary).toContain("已取消");
    expect(supplyOrderRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("『好像不太对』不能被当成确认", async () => {
    const r = await run("好像不太对", "order-1");
    expect(r.summary).toContain("已取消");
    expect(supplyOrderRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("无待确认订单 -> 正常走预览", async () => {
    const r = await run("发给供应商");
    expect(r.status).toBe("pending");
    expect(r.summary).toContain("回复「确认」");
  });
});
