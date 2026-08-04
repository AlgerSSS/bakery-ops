import { afterEach, describe, expect, it, vi } from "vitest";

import { hasAlertDestination, sendAlert } from "@/lib/alert";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendAlert", () => {
  it("reports only a valid HTTPS destination as configured", () => {
    vi.stubEnv("ALERT_WEBHOOK", "  ");
    expect(hasAlertDestination()).toBe(false);
    vi.stubEnv("ALERT_WEBHOOK", "http://alerts.example/hbti");
    expect(hasAlertDestination()).toBe(false);
    vi.stubEnv("ALERT_WEBHOOK", "https://user:secret@alerts.example/hbti");
    expect(hasAlertDestination()).toBe(false);
    vi.stubEnv("ALERT_WEBHOOK", "https://alerts.example/hbti");
    expect(hasAlertDestination()).toBe(true);
  });

  it("没有 webhook 时仍落服务端错误日志并安全跳过", async () => {
    vi.stubEnv("ALERT_WEBHOOK", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      sendAlert({
        severity: "error",
        title: "进入人工复核",
        context: { attemptId: "attempt-1", gift: "Rose Magnet" },
      }),
    ).resolves.toBe("skipped");
    expect(error).toHaveBeenCalledWith(
      "[HOT CRUSH][ERROR] 进入人工复核 — attemptId=attempt-1 gift=Rose Magnet",
    );
  });

  it("配置 webhook 后发送包含处置线索的文本", async () => {
    vi.stubEnv("ALERT_WEBHOOK", "https://alerts.example/hbti");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendAlert({
        severity: "warn",
        title: "库存结果未知",
        context: { templateName: "Rose Magnet", attemptId: "attempt-2" },
      }),
    ).resolves.toBe("sent");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://alerts.example/hbti",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "[HOT CRUSH][WARN] 库存结果未知 — templateName=Rose Magnet attemptId=attempt-2",
        }),
      }),
    );
  });

  it("webhook 失败不覆盖原始补偿结果", async () => {
    vi.stubEnv("ALERT_WEBHOOK", "https://alerts.example/hbti");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(
      sendAlert({ severity: "error", title: "需要人工处理" }),
    ).resolves.toBe("failed");
  });
});
