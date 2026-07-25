// Lark 入站事件处理（processLarkMessageEvent）单测
import { describe, it, expect, vi, beforeEach } from "vitest";

import { fileURLToPath } from "url";
const THIS_FILE = fileURLToPath(import.meta.url);

vi.mock("../../modules/domain/files/file-service", () => ({
  // 返回一个真实存在的文件（本测试文件自己），让 readFileSync 成功
  fileService: { getFilePath: (id: string) => (id === "missing" ? null : THIS_FILE) },
}));

import { processLarkMessageEvent, type LarkMessageEvent } from "../../modules/channel/lark/lark-inbound";

const makeEvent = (over: Partial<LarkMessageEvent["message"]> = {}, senderType = "user"): LarkMessageEvent => ({
  sender: { sender_id: { open_id: "ou_owner" }, sender_type: senderType },
  message: {
    message_id: `m_${Math.random()}`,
    chat_id: "oc_chat1",
    chat_type: "p2p",
    message_type: "text",
    content: JSON.stringify({ text: "状态" }),
    create_time: "1751470000000",
    ...over,
  },
});

describe("processLarkMessageEvent", () => {
  const sendToChat = vi.fn().mockResolvedValue(true);
  const sendFile = vi.fn().mockResolvedValue(true);
  const reverse = vi.fn().mockResolvedValue("61431029692");
  const deps = { reverseLookupPhone: reverse, sendLarkTextToChat: sendToChat, sendLarkFileToChat: sendFile };

  beforeEach(() => {
    sendToChat.mockClear();
    sendFile.mockClear();
    reverse.mockClear().mockResolvedValue("61431029692");
  });

  it("文本消息 -> 反查手机号 -> 交给 orchestrator -> 文本回复回 chat", async () => {
    const handler = vi.fn().mockResolvedValue([{ type: "text", text: "系统正常" }]);
    await processLarkMessageEvent(makeEvent(), handler, deps);

    expect(handler).toHaveBeenCalledTimes(1);
    const msg = handler.mock.calls[0][0];
    expect(msg.channel).toBe("lark");
    expect(msg.phone).toBe("61431029692");
    expect(msg.text).toBe("状态");
    expect(msg.conversationId).toBe("lark_oc_chat1");
    expect(sendToChat).toHaveBeenCalledWith("oc_chat1", "系统正常");
  });

  it("同一 message_id 只处理一次（去重）", async () => {
    const handler = vi.fn().mockResolvedValue([]);
    const ev = makeEvent({ message_id: "m_dup" });
    await processLarkMessageEvent(ev, handler, deps);
    await processLarkMessageEvent(ev, handler, deps);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("非 user 发送者（机器人/系统）忽略", async () => {
    const handler = vi.fn();
    await processLarkMessageEvent(makeEvent({}, "app"), handler, deps);
    expect(handler).not.toHaveBeenCalled();
    expect(sendToChat).not.toHaveBeenCalled();
  });

  it("群聊消息 MVP 阶段忽略", async () => {
    const handler = vi.fn();
    await processLarkMessageEvent(makeEvent({ chat_type: "group" }), handler, deps);
    expect(handler).not.toHaveBeenCalled();
  });

  it("反查不到手机号 -> 回未绑定提示，不进 orchestrator", async () => {
    reverse.mockResolvedValue(null);
    const handler = vi.fn();
    await processLarkMessageEvent(makeEvent(), handler, deps);
    expect(handler).not.toHaveBeenCalled();
    expect(sendToChat).toHaveBeenCalledTimes(1);
    expect(String(sendToChat.mock.calls[0][1])).toContain("LARK_USER_MAP");
  });

  it("非文本消息 -> 回提示", async () => {
    const handler = vi.fn();
    await processLarkMessageEvent(makeEvent({ message_type: "image", content: "{}" }), handler, deps);
    expect(handler).not.toHaveBeenCalled();
    expect(String(sendToChat.mock.calls[0][1])).toContain("文字指令");
  });

  it("handler 抛错 -> 回错误提示，不向上抛", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    await processLarkMessageEvent(makeEvent(), handler, deps);
    expect(String(sendToChat.mock.calls.at(-1)![1])).toContain("处理出错");
  });

  it("文件类响应 -> 上传并发送到 Lark chat", async () => {
    const handler = vi.fn().mockResolvedValue([
      { type: "document", files: [{ fileId: "f1", fileName: "简历.pdf", mimeType: "application/pdf", url: "", size: 1 }] },
    ]);
    await processLarkMessageEvent(makeEvent(), handler, deps);
    expect(sendFile).toHaveBeenCalledTimes(1);
    expect(sendFile.mock.calls[0][0]).toBe("oc_chat1");
    expect(sendFile.mock.calls[0][2]).toBe("简历.pdf");
  });

  it("文件生成失败(getFilePath null) -> 文本提示，不发文件", async () => {
    const handler = vi.fn().mockResolvedValue([
      { type: "document", files: [{ fileId: "missing", fileName: "x.pdf", mimeType: "application/pdf", url: "", size: 1 }] },
    ]);
    await processLarkMessageEvent(makeEvent(), handler, deps);
    expect(sendFile).not.toHaveBeenCalled();
    expect(String(sendToChat.mock.calls.at(-1)![1])).toContain("失败");
  });

  it("@机器人占位文本被清理", async () => {
    const handler = vi.fn().mockResolvedValue([]);
    await processLarkMessageEvent(
      makeEvent({ content: JSON.stringify({ text: "@_user_1 帮助" }) }),
      handler,
      deps,
    );
    expect(handler.mock.calls[0][0].text).toBe("帮助");
  });
});
