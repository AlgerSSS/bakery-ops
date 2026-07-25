// internal-notify: 内部通知统一出口的通道路由（Lark 优先，失败回落 WhatsApp；env 未设置时保持原 WhatsApp 行为）
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const sendLarkTextMock = vi.fn();
vi.mock("@/modules/channel/lark/lark-messenger", () => ({
  sendLarkText: (...args: unknown[]) => sendLarkTextMock(...args),
}));

const sendTextToMock = vi.fn();
const isClientConnectedMock = vi.fn();
vi.mock("@/modules/channel/whatsapp/whatsapp.client", () => ({
  isClientConnected: (...args: unknown[]) => isClientConnectedMock(...args),
  sendTextTo: (...args: unknown[]) => sendTextToMock(...args),
}));

import { notifyInternal } from "@/modules/channel/internal-notify";

const ORIGINAL_CHANNEL = process.env.INTERNAL_NOTIFY_CHANNEL;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.INTERNAL_NOTIFY_CHANNEL;
  sendLarkTextMock.mockResolvedValue(true);
  isClientConnectedMock.mockResolvedValue(true);
  sendTextToMock.mockResolvedValue({ ok: true, chatId: "x@c.us", resolved: true });
});

afterAll(() => {
  if (ORIGINAL_CHANNEL === undefined) delete process.env.INTERNAL_NOTIFY_CHANNEL;
  else process.env.INTERNAL_NOTIFY_CHANNEL = ORIGINAL_CHANNEL;
});

describe("notifyInternal 通道路由", () => {
  it("INTERNAL_NOTIFY_CHANNEL=lark 且 Lark 成功 → 不碰 WhatsApp", async () => {
    process.env.INTERNAL_NOTIFY_CHANNEL = "lark";

    const ok = await notifyInternal("60123456789", "hello");

    expect(ok).toBe(true);
    expect(sendLarkTextMock).toHaveBeenCalledWith("60123456789", "hello");
    expect(isClientConnectedMock).not.toHaveBeenCalled();
    expect(sendTextToMock).not.toHaveBeenCalled();
  });

  it("Lark 失败 → 回落 sendTextTo", async () => {
    process.env.INTERNAL_NOTIFY_CHANNEL = "lark";
    sendLarkTextMock.mockResolvedValue(false);

    const ok = await notifyInternal("60123456789", "hello");

    expect(ok).toBe(true);
    expect(sendLarkTextMock).toHaveBeenCalledTimes(1);
    expect(sendTextToMock).toHaveBeenCalledWith("60123456789", "hello");
  });

  it("未设置 INTERNAL_NOTIFY_CHANNEL → 直接 WhatsApp（行为保持）", async () => {
    const ok = await notifyInternal("60123456789", "hello");

    expect(ok).toBe(true);
    expect(sendLarkTextMock).not.toHaveBeenCalled();
    expect(sendTextToMock).toHaveBeenCalledWith("60123456789", "hello");
  });

  it("双通道都不可用 → false", async () => {
    process.env.INTERNAL_NOTIFY_CHANNEL = "lark";
    sendLarkTextMock.mockResolvedValue(false);
    isClientConnectedMock.mockResolvedValue(false);

    const ok = await notifyInternal("60123456789", "hello");

    expect(ok).toBe(false);
    expect(sendTextToMock).not.toHaveBeenCalled();
  });

  it("sendTextTo 返回 ok:false → false", async () => {
    sendTextToMock.mockResolvedValue({ ok: false, error: "boom" });

    const ok = await notifyInternal("60123456789", "hello");

    expect(ok).toBe(false);
  });
});
