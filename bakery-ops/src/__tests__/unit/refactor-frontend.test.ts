import { describe, it, expect, vi } from "vitest";

// Mock next/dynamic since it's a client-side feature not available in node test env
vi.mock("next/dynamic", () => ({
  default: (fn: () => Promise<unknown>) => fn,
}));

// Mock next/navigation used by client components
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

// Mock react to avoid "use client" issues in node env
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual };
});

describe("Server Actions barrel compatibility", () => {
  it("exports getProducts as a function from barrel", async () => {
    const mod = await import("@/app/(forecast)/actions");
    expect(typeof mod.getProducts).toBe("function");
  });

  it("exports getStrategies as a function from barrel", async () => {
    const mod = await import("@/app/(forecast)/actions");
    expect(typeof mod.getStrategies).toBe("function");
  });

  it("exports getSalesBaselines as a function from barrel", async () => {
    const mod = await import("@/app/(forecast)/actions");
    expect(typeof mod.getSalesBaselines).toBe("function");
  });

  it("exports getDailyReview as a function from barrel", async () => {
    const mod = await import("@/app/(forecast)/actions");
    expect(typeof mod.getDailyReview).toBe("function");
  });

  it("exports getContextEvents as a function from barrel", async () => {
    const mod = await import("@/app/(forecast)/actions");
    expect(typeof mod.getContextEvents).toBe("function");
  });

  it("exports importTimeslotSalesData as a function from barrel", async () => {
    const mod = await import("@/app/(forecast)/actions");
    expect(typeof mod.importTimeslotSalesData).toBe("function");
  });

  it("exports getPromptSegments as a function from barrel", async () => {
    const mod = await import("@/app/(forecast)/actions");
    expect(typeof mod.getPromptSegments).toBe("function");
  });

  it("exports generateFullForecast as a function from barrel", async () => {
    const mod = await import("@/app/(forecast)/actions");
    expect(typeof mod.generateFullForecast).toBe("function");
  });
});

describe("Split action files resolve independently", () => {
  it("getProducts resolves from forecast-actions", async () => {
    const mod = await import("@/app/(forecast)/forecast-actions");
    expect(typeof mod.getProducts).toBe("function");
  });

  it("getDailyReview resolves from review-actions", async () => {
    const mod = await import("@/app/(forecast)/review-actions");
    expect(typeof mod.getDailyReview).toBe("function");
  });

  it("importTimeslotSalesData resolves from import-actions", async () => {
    const mod = await import("@/app/(forecast)/import-actions");
    expect(typeof mod.importTimeslotSalesData).toBe("function");
  });

  it("getPromptSegments resolves from prompt-actions", async () => {
    const mod = await import("@/app/(forecast)/prompt-actions");
    expect(typeof mod.getPromptSegments).toBe("function");
  });
});

describe("ErrorBoundary component", () => {
  it("exports ErrorBoundary as a class/function", async () => {
    const mod = await import("@/ui/components/shared/error-boundary");
    expect(typeof mod.ErrorBoundary).toBe("function");
  });
});
