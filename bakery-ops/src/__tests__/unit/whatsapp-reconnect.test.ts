// A1: WhatsApp 断连自动重连（IMPROVEMENT-PLAN.md A1）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

const mockClient = Object.assign(new EventEmitter(), {
  initialize: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
  info: undefined as unknown,
});

vi.mock("../../modules/channel/whatsapp/whatsapp.client", () => ({
  getWhatsAppClient: () => mockClient,
}));
vi.mock("../../modules/channel/whatsapp/whatsapp.sender", () => ({
  whatsappSender: { send: vi.fn() },
}));
vi.mock("qrcode-terminal", () => ({ default: { generate: vi.fn() } }));

import { WhatsAppAdapter } from "../../modules/channel/whatsapp/whatsapp.adapter";

describe("WhatsAppAdapter reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockClient.initialize.mockClear().mockResolvedValue(undefined);
    mockClient.destroy.mockClear().mockResolvedValue(undefined);
    mockClient.removeAllListeners();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("disconnected 后 destroy 并重新 initialize", async () => {
    const adapter = new WhatsAppAdapter();
    adapter.start();
    expect(mockClient.initialize).toHaveBeenCalledTimes(1);

    mockClient.emit("disconnected", "NAVIGATION");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    expect(mockClient.initialize).toHaveBeenCalledTimes(2);
  });

  it("initialize 持续失败时退避重试，耗尽后停止", async () => {
    const adapter = new WhatsAppAdapter();
    adapter.start(); // 首次 initialize 成功
    mockClient.initialize.mockRejectedValue(new Error("boom"));

    mockClient.emit("disconnected", "NAVIGATION");
    // 5 次退避：5s+10s+20s+40s+60s = 135s，全部走完
    await vi.advanceTimersByTimeAsync(140_000);

    // 1 次启动成功 + 5 次重试失败 = 6 次 initialize，之后不再重试
    expect(mockClient.initialize).toHaveBeenCalledTimes(6);
    mockClient.emit("disconnected", "NAVIGATION");
    await vi.advanceTimersByTimeAsync(140_000);
    expect(mockClient.initialize).toHaveBeenCalledTimes(6);
  });

  it("ready 事件重置重连计数", async () => {
    const adapter = new WhatsAppAdapter();
    adapter.start();

    mockClient.emit("disconnected", "NAVIGATION");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockClient.initialize).toHaveBeenCalledTimes(2);

    mockClient.emit("ready");
    mockClient.emit("disconnected", "NAVIGATION");
    // 计数已清零 -> 又从 5s 退避开始
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockClient.initialize).toHaveBeenCalledTimes(3);
  });
});
