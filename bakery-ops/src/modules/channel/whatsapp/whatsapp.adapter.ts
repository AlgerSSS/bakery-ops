import type { Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { getWhatsAppClient } from "./whatsapp.client";
import { whatsappSender } from "./whatsapp.sender";
import type { ChannelMessage } from "../../shared/types";
import { logger } from "../../shared/logger";

export class WhatsAppAdapter {
  private orchestratorHandler: ((msg: ChannelMessage) => Promise<import("../../shared/types").ChannelResponse[]>) | null = null;
  private processedMessages = new Set<string>();

  setHandler(handler: (msg: ChannelMessage) => Promise<import("../../shared/types").ChannelResponse[]>): void {
    this.orchestratorHandler = handler;
  }

  start(): void {
    const client = getWhatsAppClient();

    // 防止重复注册事件监听器
    client.removeAllListeners("qr");
    client.removeAllListeners("ready");
    client.removeAllListeners("disconnected");
    client.removeAllListeners("message");
    client.removeAllListeners("message_create");

    client.on("qr", (qr: string) => {
      logger.info("QR code received, scan to authenticate");
      qrcode.generate(qr, { small: true });
    });

    client.on("ready", () => {
      logger.info("WhatsApp client ready", { botId: client.info?.wid?._serialized });
    });

    client.on("disconnected", (reason: string) => {
      logger.warn("WhatsApp client disconnected", { reason });
    });

    // message: 别人发来的消息
    client.on("message", async (msg: Message) => {
      try {
        if (msg.type !== "chat") return;
        if (this.isDuplicate(msg)) return;
        logger.info("WhatsApp incoming message", {
          from: msg.from,
          body: msg.body?.slice(0, 80),
        });
        await this.handleMessage(msg);
      } catch (err) {
        logger.error("Error handling WhatsApp message", { error: String(err) });
      }
    });

    // message_create: 捕获自己从手机发的消息（fromMe=true, from=botId@c.us）
    client.on("message_create", async (msg: Message) => {
      try {
        if (!msg.fromMe) return;
        if (msg.type !== "chat") return;
        if (this.isDuplicate(msg)) return;

        const botId = client.info?.wid?._serialized || "";
        if (msg.from !== botId) {
          return;
        }

        logger.info("WhatsApp self message from phone", {
          from: msg.from,
          to: msg.to,
          body: msg.body?.slice(0, 80),
        });
        await this.handleMessage(msg);
      } catch (err) {
        logger.error("Error handling WhatsApp message", { error: String(err) });
      }
    });

    client.initialize();
    logger.info("WhatsApp adapter starting...");
  }

  private async handleMessage(msg: Message): Promise<void> {
    if (!this.orchestratorHandler) return;

    const chat = await msg.getChat();

    // 群聊：只响应 @机器人 的消息
    if (chat.isGroup) {
      const mentions = await msg.getMentions();
      const client = getWhatsAppClient();
      const botId = client.info?.wid?._serialized || "";
      const isMentioned = mentions.some(
        (c) => c.id._serialized === botId,
      );
      if (!isMentioned) return;
    }

    // 提取发送者手机号
    const client = getWhatsAppClient();
    let senderPhone: string;
    if (msg.fromMe) {
      senderPhone = client.info?.wid?.user || "";
    } else if (chat.isGroup) {
      senderPhone = (msg.author || "").replace(/@c\.us$/, "").replace(/@lid$/, "");
    } else {
      senderPhone = (msg.from || "").replace(/@c\.us$/, "").replace(/@lid$/, "");
    }

    // 去掉 @mention 部分，提取纯文本
    const cleanText = msg.body
      .replace(/@\d+\s?/g, "")
      .trim();

    if (!cleanText) return;

    const conversationId = chat.id._serialized;

    const channelMessage: ChannelMessage = {
      channel: "whatsapp",
      messageId: msg.id._serialized,
      conversationId,
      phone: senderPhone,
      text: cleanText,
      timestamp: new Date(msg.timestamp * 1000).toISOString(),
      rawPayload: msg,
    };

    logger.info("Processing message", {
      phone: senderPhone,
      text: cleanText.slice(0, 50),
      conversationId,
      isGroup: chat.isGroup,
      fromMe: msg.fromMe,
    });

    try {
      const responses = await this.orchestratorHandler(channelMessage);
      logger.info("Sending response", { conversationId, responseCount: responses.length, texts: responses.map(r => r.text?.slice(0, 50)) });
      await whatsappSender.send(conversationId, responses);
    } catch (err) {
      logger.error("handleMessage orchestrator/send failed", { error: String(err), conversationId });
    }
  }

  private isDuplicate(msg: Message): boolean {
    const msgId = msg.id._serialized;
    if (this.processedMessages.has(msgId)) return true;
    this.processedMessages.add(msgId);
    // 保持集合大小合理，超过 1000 条清理旧的
    if (this.processedMessages.size > 1000) {
      const entries = [...this.processedMessages];
      this.processedMessages = new Set(entries.slice(-500));
    }
    return false;
  }
}

export const whatsappAdapter = new WhatsAppAdapter();
