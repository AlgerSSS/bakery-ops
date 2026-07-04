// Lark 入站适配器：长连接（WebSocket）接收 im.message.receive_v1，
// 转成 ChannelMessage 喂给 orchestrator（与 WhatsApp 同一个大脑），回复走 Lark chat。
// 事件处理抽成 processLarkMessageEvent 纯逻辑便于单测；WSClient 只做薄接线。
import { readFileSync } from "fs";
import { basename } from "path";
import * as Lark from "@larksuiteoapi/node-sdk";
import { reverseLookupPhone, sendLarkTextToChat, sendLarkFileToChat } from "./lark-messenger";
import { fileService } from "../../domain/files/file-service";
import type { ChannelMessage, ChannelResponse } from "../../shared/types";
import { logger } from "../../shared/logger";

type OrchestratorHandler = (msg: ChannelMessage) => Promise<ChannelResponse[]>;

export interface LarkMessageEvent {
  sender?: { sender_id?: { open_id?: string }; sender_type?: string };
  message?: {
    message_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
    create_time?: string;
  };
}

const processedMessages = new Set<string>();
const MAX_PROCESSED = 500;

function extractText(event: LarkMessageEvent): string | null {
  if (event.message?.message_type !== "text") return null;
  try {
    const parsed = JSON.parse(event.message.content || "{}") as { text?: string };
    // @机器人 时文本里会带 @_user_1 占位，清掉
    return (parsed.text || "").replace(/@_user_\d+\s*/g, "").trim() || null;
  } catch {
    return null;
  }
}

export async function processLarkMessageEvent(
  event: LarkMessageEvent,
  handler: OrchestratorHandler,
  deps = { reverseLookupPhone, sendLarkTextToChat, sendLarkFileToChat },
): Promise<void> {
  const msg = event.message;
  const openId = event.sender?.sender_id?.open_id;
  if (!msg?.message_id || !msg.chat_id || !openId) return;
  if (event.sender?.sender_type && event.sender.sender_type !== "user") return; // 忽略机器人/系统消息
  if (msg.chat_type && msg.chat_type !== "p2p") return; // MVP 只处理单聊

  if (processedMessages.has(msg.message_id)) return;
  processedMessages.add(msg.message_id);
  if (processedMessages.size > MAX_PROCESSED) {
    const first = processedMessages.values().next().value;
    if (first) processedMessages.delete(first);
  }

  const text = extractText(event);
  if (!text) {
    await deps.sendLarkTextToChat(msg.chat_id, "目前只支持文字指令哦～发「帮助」看看我能做什么。");
    return;
  }

  const phone = await deps.reverseLookupPhone(openId);
  if (!phone) {
    logger.warn("Lark inbound: sender not mapped to a phone", { openId });
    await deps.sendLarkTextToChat(
      msg.chat_id,
      "还认不出你——请让管理员把你的 Lark 账号加进 LARK_USER_MAP（或把 Lark 绑定手机改成系统登记的号码）。",
    );
    return;
  }

  logger.info("Lark incoming message", { phone, body: text.slice(0, 80) });
  const channelMsg: ChannelMessage = {
    channel: "lark",
    messageId: `lark_${msg.message_id}`,
    conversationId: `lark_${msg.chat_id}`,
    phone,
    larkOpenId: openId,
    text,
    timestamp: msg.create_time
      ? new Date(Number(msg.create_time)).toISOString()
      : new Date().toISOString(),
  };

  try {
    const responses = await handler(channelMsg);
    for (const r of responses) {
      if (r.text) {
        await deps.sendLarkTextToChat(msg.chat_id, r.text);
      }
      for (const f of r.files || []) {
        const filePath = fileService.getFilePath(f.fileId);
        if (!filePath) {
          await deps.sendLarkTextToChat(msg.chat_id, `（文件 ${f.fileName} 生成失败或已过期）`);
          continue;
        }
        try {
          const ok = await deps.sendLarkFileToChat(msg.chat_id, readFileSync(filePath), f.fileName || basename(filePath));
          if (!ok) await deps.sendLarkTextToChat(msg.chat_id, `（文件 ${f.fileName} 发送失败，请去仪表盘查看）`);
        } catch (err) {
          logger.warn("Lark inbound: file read/send failed", { fileId: f.fileId, error: String(err) });
          await deps.sendLarkTextToChat(msg.chat_id, `（文件 ${f.fileName} 发送失败）`);
        }
      }
    }
  } catch (err) {
    logger.error("Lark inbound: handler failed", { error: String(err) });
    await deps.sendLarkTextToChat(msg.chat_id, "处理出错了，请稍后重试。");
  }
}

class LarkInboundAdapter {
  private handler: OrchestratorHandler | null = null;
  private started = false;

  setHandler(handler: OrchestratorHandler): void {
    this.handler = handler;
  }

  start(): void {
    const appId = process.env.LARK_APP_ID;
    const appSecret = process.env.LARK_APP_SECRET;
    if (!appId || !appSecret) {
      logger.info("Lark inbound disabled (LARK_APP_ID/SECRET not set)");
      return;
    }
    if (this.started) return;
    this.started = true;

    const wsClient = new Lark.WSClient({
      appId,
      appSecret,
      domain: Lark.Domain.Lark, // 国际版 larksuite.com
      loggerLevel: Lark.LoggerLevel.error,
    });
    const dispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => {
        if (!this.handler) return;
        await processLarkMessageEvent(data as LarkMessageEvent, this.handler);
      },
    });
    wsClient.start({ eventDispatcher: dispatcher });
    logger.info("Lark inbound adapter starting (long connection)...");
  }
}

export const larkInboundAdapter = new LarkInboundAdapter();
