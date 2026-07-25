// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import dayjs from "dayjs";

const mocks = vi.hoisted(() => ({
  getDailyRevenues: vi.fn(),
  getProducts: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/app/(forecast)/actions", () => ({
  getDailyRevenues: mocks.getDailyRevenues,
  getProducts: mocks.getProducts,
  getProductAliases: vi.fn().mockResolvedValue({}),
  getTimeslotSalesRecords: vi.fn().mockResolvedValue([]),
  saveOutOfStockRecords: vi.fn(),
  deleteOutOfStockByDate: vi.fn(),
  adoptDailyReview: vi.fn(),
  upsertDailyRevenue: vi.fn(),
  addContextEvent: vi.fn(),
}));

vi.mock("@/ui/components/providers/forecast-provider", () => ({
  useForecastContext: () => ({
    state: { products: [], productSuggestions: [], adjustedQuantities: {} },
    dispatch: vi.fn(),
  }),
}));

import { useReview } from "@/ui/hooks/use-review";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let hookResult: ReturnType<typeof useReview>;
function Harness() {
  hookResult = useReview();
  return null;
}

async function renderHook(): Promise<Root> {
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(React.createElement(Harness)); });
  // Flush pending effects triggered by resolved promises
  await act(async () => {});
  return root;
}

describe("useReview POS prefill (B4)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.getDailyRevenues.mockReset();
    mocks.getDailyRevenues.mockResolvedValue([]);
  });

  it("defaults reviewDate to yesterday", async () => {
    const root = await renderHook();
    expect(hookResult.reviewDate).toBe(dayjs().subtract(1, "day").format("YYYY-MM-DD"));
    root.unmount();
  });

  it("prefills empty fields from daily_revenue for the review date", async () => {
    mocks.getDailyRevenues.mockResolvedValue([
      { date: dayjs().subtract(1, "day").format("YYYY-MM-DD"), revenue: 1234.5, transaction_count: 88, avg_transaction_value: 14.03 },
    ]);
    const root = await renderHook();
    const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD");
    expect(mocks.getDailyRevenues).toHaveBeenCalledWith(yesterday, yesterday);
    expect(hookResult.reviewActualRevenue).toBe("1234.5");
    expect(hookResult.transactionCount).toBe("88");
    expect(hookResult.avgTransactionValue).toBe("14.03");
    root.unmount();
  });

  it("does not overwrite fields already filled (e.g. restored from sessionStorage)", async () => {
    sessionStorage.setItem("review_state", JSON.stringify({ reviewActualRevenue: "999", transactionCount: "", avgTransactionValue: "" }));
    mocks.getDailyRevenues.mockResolvedValue([
      { date: dayjs().subtract(1, "day").format("YYYY-MM-DD"), revenue: 1234.5, transaction_count: 88, avg_transaction_value: 14.03 },
    ]);
    const root = await renderHook();
    expect(hookResult.reviewActualRevenue).toBe("999");
    expect(hookResult.transactionCount).toBe("88");
    expect(hookResult.avgTransactionValue).toBe("14.03");
    root.unmount();
  });

  it("leaves fields empty when no daily_revenue row exists", async () => {
    const root = await renderHook();
    expect(hookResult.reviewActualRevenue).toBe("");
    expect(hookResult.transactionCount).toBe("");
    expect(hookResult.avgTransactionValue).toBe("");
    root.unmount();
  });

  it("skips null transaction_count / avg_transaction_value", async () => {
    mocks.getDailyRevenues.mockResolvedValue([
      { date: dayjs().subtract(1, "day").format("YYYY-MM-DD"), revenue: 500, transaction_count: null, avg_transaction_value: null },
    ]);
    const root = await renderHook();
    expect(hookResult.reviewActualRevenue).toBe("500");
    expect(hookResult.transactionCount).toBe("");
    expect(hookResult.avgTransactionValue).toBe("");
    root.unmount();
  });
});
