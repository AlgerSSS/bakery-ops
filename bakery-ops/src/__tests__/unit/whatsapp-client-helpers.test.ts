// A6: WhatsApp 出站发送统一防御（IMPROVEMENT-PLAN.md A6）
// isClientConnected：getState 防御（未就绪 / 非 CONNECTED / getState 抛错都视为不健康）。
// sendTextTo：getNumberId 幽灵会话解析 + 预格式化 chat id 直发 + 失败不抛出。
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClient = {
  info: undefined as unknown,
  getState: vi.fn(),
  getNumberId: vi.fn(),
  sendMessage: vi.fn(),
};

vi.mock("whatsapp-web.js", () => ({
  Client: class {
    constructor() {
      return mockClient;
    }
  },
  LocalAuth: class {},
}));

import { isClientConnected, sendTextTo } from "@/modules/channel/whatsapp/whatsapp.client";

beforeEach(() => {
  mockClient.info = { wid: { _serialized: "bot@c.us" } };
  mockClient.getState.mockReset().mockResolvedValue("CONNECTED");
  mockClient.getNumberId.mockReset().mockResolvedValue(null);
  mockClient.sendMessage.mockReset().mockResolvedValue({ id: { _serialized: "msg_1" } });
});

describe("isClientConnected", () => {
  it("client 未就绪（无 info）→ false", async () => {
    mockClient.info = undefined;
    expect(await isClientConnected()).toBe(false);
    expect(mockClient.getState).not.toHaveBeenCalled();
  });

  it("getState 返回 CONNECTED → true", async () => {
    expect(await isClientConnected()).toBe(true);
  });

  it("getState 返回非 CONNECTED 状态 → false", async () => {
    mockClient.getState.mockResolvedValue("OPENING");
    expect(await isClientConnected()).toBe(false);
  });

  it("getState 抛错（detached page）也视为不健康 → false", async () => {
    mockClient.getState.mockRejectedValue(new Error("Attempted to use detached Frame"));
    expect(await isClientConnected()).toBe(false);
  });
});

describe("sendTextTo", () => {
  it("裸手机号：getNumberId 解析出真实 chat id 后发送", async () => {
    mockClient.getNumberId.mockResolvedValue({ _serialized: "60123456789@c.us" });
    const result = await sendTextTo("60123456789", "hello");
    expect(mockClient.getNumberId).toHaveBeenCalledWith("60123456789");
    expect(mockClient.sendMessage).toHaveBeenCalledWith("60123456789@c.us", "hello");
    expect(result).toEqual({ ok: true, chatId: "60123456789@c.us", resolved: true, ackMsgId: "msg_1" });
  });

  it("getNumberId 返回 null → 回退 `${phone}@c.us`", async () => {
    const result = await sendTextTo("60123456789", "hello");
    expect(mockClient.sendMessage).toHaveBeenCalledWith("60123456789@c.us", "hello");
    expect(result).toMatchObject({ ok: true, resolved: false });
  });

  it("预格式化 chat id（@c.us）跳过 getNumberId 直发", async () => {
    const result = await sendTextTo("60123456789@c.us", "hello");
    expect(mockClient.getNumberId).not.toHaveBeenCalled();
    expect(mockClient.sendMessage).toHaveBeenCalledWith("60123456789@c.us", "hello");
    expect(result).toMatchObject({ ok: true, chatId: "60123456789@c.us" });
  });

  it("getNumberId 抛错不致命：回退 `${phone}@c.us` 继续发送", async () => {
    mockClient.getNumberId.mockRejectedValue(new Error("page crashed"));
    const result = await sendTextTo("60123456789", "hello");
    expect(mockClient.sendMessage).toHaveBeenCalledWith("60123456789@c.us", "hello");
    expect(result).toMatchObject({ ok: true, resolved: false });
  });

  it("sendMessage 抛错 → 不抛出，返回 { ok:false, error }", async () => {
    mockClient.sendMessage.mockRejectedValue(new Error("boom"));
    const result = await sendTextTo("60123456789", "hello");
    expect(result).toEqual({ ok: false, error: "Error: boom" });
  });
});
