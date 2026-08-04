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

  describe("飞书/Lark 群机器人", () => {
    const HOOK = "https://open.larksuite.com/open-apis/bot/v2/hook/abc-123";

    it("按 Lark 的形状发，而不是通用的 {text}", async () => {
      vi.stubEnv("ALERT_WEBHOOK", HOOK);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ code: 0, msg: "success" }), {
            status: 200,
          }),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        sendAlert({ severity: "error", title: "需要人工处理" }),
      ).resolves.toBe("sent");
      expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
        msg_type: "text",
        content: { text: "[HOT CRUSH][ERROR] 需要人工处理" },
      });
    });

    it("200 + 非零 code 算没送到，不能报成 sent", async () => {
      // Lark 对形状不对/机器人被移除的请求照样回 200，错误号只在包体里。
      // 这里判错了，运营就永远等不到那条「进入人工复核」。
      vi.stubEnv("ALERT_WEBHOOK", HOOK);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ code: 19024, msg: "param invalid" }), {
            status: 200,
          }),
        ),
      );

      await expect(
        sendAlert({ severity: "error", title: "需要人工处理" }),
      ).resolves.toBe("failed");
    });

    it("回执读不出来时按失败处理，留给 Cron 重试", async () => {
      vi.stubEnv("ALERT_WEBHOOK", HOOK);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(new Response("<html>proxy</html>", { status: 200 })),
      );

      await expect(
        sendAlert({ severity: "error", title: "需要人工处理" }),
      ).resolves.toBe("failed");
    });
  });
});
