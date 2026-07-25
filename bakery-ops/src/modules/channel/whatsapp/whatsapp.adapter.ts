import type { Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { getWhatsAppClient } from "./whatsapp.client";
import { whatsappSender } from "./whatsapp.sender";
import type { ChannelMessage } from "../../shared/types";
import { logger } from "../../shared/logger";

export class WhatsAppAdapter {
  private orchestratorHandler: ((msg: ChannelMessage) => Promise<import("../../shared/types").ChannelResponse[]>) | null = null;
  private processedMessages = new Set<string>();
  private reconnectAttempts = 0;
  private reconnecting = false;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;

  setHandler(handler: (msg: ChannelMessage) => Promise<import("../../shared/types").ChannelResponse[]>): void {
    this.orchestratorHandler = handler;
  }

  start(): void {
    const client = getWhatsAppClient();

    // 防止重复注册事件监听器
    client.removeAllListeners("qr");
    client.removeAllListeners("ready");
    client.removeAllListeners("disconnected");
    client.removeAllListeners("auth_failure");
    client.removeAllListeners("message");
    client.removeAllListeners("message_create");

    client.on("qr", (qr: string) => {
      logger.info("QR code received, scan to authenticate");
      qrcode.generate(qr, { small: true });
    });

    client.on("ready", () => {
      logger.info("WhatsApp client ready", { botId: client.info?.wid?._serialized });
      this.reconnectAttempts = 0;
    });

    // 断连自动重连（带退避、限次、防重入）— IMPROVEMENT-PLAN.md A1
    client.on("disconnected", (reason: string) => {
      logger.warn("WhatsApp client disconnected", { reason: String(reason) });
      void this.reconnect(client);
    });

    client.on("auth_failure", (message: string) => {
      logger.error("WhatsApp auth failure — session invalid, manual QR re-scan likely required", {
        message: String(message),
      });
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

    // 首次启动失败（如系统繁忙时 Chromium 起不来）也走重连退避，
    // 不再留在 unhandledRejection 里等人工重启 — IMPROVEMENT-PLAN.md A1
    client.initialize().catch((err) => {
      logger.error("WhatsApp initial launch failed, entering reconnect loop", { error: String(err) });
      void this.reconnect(client);
    });
    logger.info("WhatsApp adapter starting...");
  }

  // 断连后 destroy -> 退避等待 -> initialize，最多 MAX_RECONNECT_ATTEMPTS 次；
  // ready 事件会把计数清零。耗尽后只能人工处理（LOGOUT 场景 re-init 会停在等扫码）。
  private async reconnect(client: ReturnType<typeof getWhatsAppClient>): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      while (this.reconnectAttempts < WhatsAppAdapter.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++;
        const delayMs = Math.min(60_000, 5_000 * 2 ** (this.reconnectAttempts - 1));
        logger.warn("WhatsApp reconnecting", { attempt: this.reconnectAttempts, delayMs });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        try {
          await client.destroy().catch(() => {});
          await client.initialize();
          return;
        } catch (err) {
          logger.error("WhatsApp reconnect attempt failed", {
            attempt: this.reconnectAttempts,
            error: String(err),
          });
        }
      }
      logger.error("WhatsApp reconnect attempts exhausted — manual restart required", {
        attempts: this.reconnectAttempts,
      });
    } finally {
      this.reconnecting = false;
    }
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
    const rawSenderId = msg.fromMe ? "" : chat.isGroup ? (msg.author || "") : (msg.from || "");
    if (msg.fromMe) {
      senderPhone = client.info?.wid?.user || "";
    } else if (chat.isGroup) {
      senderPhone = (msg.author || "").replace(/@c\.us$/, "").replace(/@lid$/, "");
    } else {
      senderPhone = (msg.from || "").replace(/@c\.us$/, "").replace(/@lid$/, "");
    }

    // WhatsApp 隐私 ID（@lid）不是真实手机号——它会让"已联系候选人按手机号匹配"失效。
    // 解析成真实号码（contact.number），这样候选人/经理无论以 @c.us 还是 @lid 进来都能被认出。
    if (rawSenderId.endsWith("@lid")) {
      try {
        const contact = await msg.getContact();
        const realNum = (contact?.number || contact?.id?.user || "").toString().replace(/@.*$/, "");
        if (realNum) senderPhone = realNum;
      } catch (err) {
        logger.warn("Failed to resolve @lid to real phone", { error: String(err) });
      }
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
