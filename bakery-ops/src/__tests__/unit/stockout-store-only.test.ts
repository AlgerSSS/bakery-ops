import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getProducts: vi.fn(),
  getProductAliases: vi.fn(),
  getOutOfStockRecords: vi.fn(),
  saveOutOfStockRecords: vi.fn(),
  getSubscriberOpenIds: vi.fn(),
  sendLarkToUser: vi.fn(),
  hasPushLog: vi.fn(),
  recordPushLog: vi.fn(),
}));

vi.mock("@/modules/shared/db/postgres", () => ({ query: mocks.query }));
vi.mock("@/modules/data/repositories/product.repository", () => ({
  getProducts: mocks.getProducts,
  getProductAliases: mocks.getProductAliases,
}));
vi.mock("@/modules/data/repositories/forecast-calc.repository", () => ({
  getOutOfStockRecords: mocks.getOutOfStockRecords,
  saveOutOfStockRecords: mocks.saveOutOfStockRecords,
}));
vi.mock("@/modules/data/repositories/team.repository", () => ({
  teamRepository: { getSubscriberOpenIds: mocks.getSubscriberOpenIds },
}));
vi.mock("@/modules/channel/lark/lark-messenger", () => ({
  sendLarkToUser: mocks.sendLarkToUser,
}));
vi.mock("@/modules/domain/notifications/push-log", () => ({
  hasPushLog: mocks.hasPushLog,
  recordPushLog: mocks.recordPushLog,
}));

import { runStockoutDetection } from "../../modules/domain/forecast/stockout-detector.service";

describe("runStockoutDetection store-only mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query
      .mockResolvedValueOnce([{ has_source: true }])
      .mockResolvedValueOnce([{ bill_count: 100 }])
      .mockResolvedValueOnce([
        { item_name: "Croissant", mins: "960" },
        { item_name: "Closing Item", mins: "1320" },
      ])
      .mockResolvedValueOnce([{ days: "4" }])
      .mockResolvedValueOnce([
        { item_name: "Croissant", hour: 17, total_qty: "40", total_net: "400" },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.getProducts.mockResolvedValue([]);
    mocks.getProductAliases.mockResolvedValue({});
    mocks.getOutOfStockRecords.mockResolvedValue([]);
    mocks.saveOutOfStockRecords.mockResolvedValue(undefined);
    mocks.getSubscriberOpenIds.mockResolvedValue(["ou_test"]);
    mocks.hasPushLog.mockResolvedValue(false);
    mocks.sendLarkToUser.mockResolvedValue(true);
  });

  it("stores detected records without sending a Lark notification", async () => {
    await runStockoutDetection();

    expect(mocks.saveOutOfStockRecords).toHaveBeenCalledWith([
      expect.objectContaining({
        productName: "Croissant",
        inputName: "auto",
        estimatedLossQty: 20,
        estimatedLossAmount: 200,
      }),
    ]);
    expect(mocks.getSubscriberOpenIds).not.toHaveBeenCalled();
    expect(mocks.hasPushLog).not.toHaveBeenCalled();
    expect(mocks.recordPushLog).not.toHaveBeenCalled();
    expect(mocks.sendLarkToUser).not.toHaveBeenCalled();
  });

  it("reports a database save failure to the cron audit wrapper", async () => {
    mocks.saveOutOfStockRecords.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(runStockoutDetection()).rejects.toThrow("database unavailable");
    expect(mocks.sendLarkToUser).not.toHaveBeenCalled();
  });

  it("reports a detection query failure to the cron audit wrapper", async () => {
    mocks.query.mockReset().mockRejectedValueOnce(new Error("sales query unavailable"));

    await expect(runStockoutDetection()).rejects.toThrow("sales query unavailable");
    expect(mocks.saveOutOfStockRecords).not.toHaveBeenCalled();
    expect(mocks.sendLarkToUser).not.toHaveBeenCalled();
  });

  it("reports missing source sales instead of treating them as zero suspects", async () => {
    mocks.query.mockReset().mockResolvedValueOnce([{ has_source: false }]);

    await expect(runStockoutDetection()).rejects.toThrow("no valid sales source data");
    expect(mocks.saveOutOfStockRecords).not.toHaveBeenCalled();
    expect(mocks.sendLarkToUser).not.toHaveBeenCalled();
  });
});
