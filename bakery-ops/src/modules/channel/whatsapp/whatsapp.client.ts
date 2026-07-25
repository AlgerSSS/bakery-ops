import { Client, LocalAuth, type Message } from "whatsapp-web.js";
import { logger } from "../../shared/logger";

let clientInstance: Client | null = null;

export function getWhatsAppClient(): Client {
  if (clientInstance) return clientInstance;

  clientInstance = new Client({
    authStrategy: new LocalAuth({
      dataPath: process.env.WHATSAPP_SESSION_DATA_PATH || "./whatsapp-session",
    }),
    puppeteer: {
      headless: process.env.WHATSAPP_PUPPETEER_HEADLESS !== "false",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  return clientInstance;
}

export function getBotId(): string {
  const client = getWhatsAppClient();
  return client.info?.wid?._serialized || "";
}

/**
 * True only when the client is actually CONNECTED. A "ready" client (info set) can still have a
 * detached/reloading puppeteer page, which makes sends throw "Attempted to use detached Frame" or
 * silently fail — so getState() throwing is also treated as unhealthy.
 */
export async function isClientConnected(): Promise<boolean> {
  const client = getWhatsAppClient();
  if (!client.info) return false; // not ready yet
  try {
    const state = await client.getState();
    if (state !== "CONNECTED") {
      logger.warn("WhatsApp client: not CONNECTED", { state });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn("WhatsApp client: getState failed (page unstable)", { error: String(err) });
    return false;
  }
}

export type SendTextResult =
  | { ok: true; chatId: string; resolved: boolean; ackMsgId?: string }
  | { ok: false; error: string };

/**
 * Send a text message to a phone number or a pre-formatted chat id (`...@c.us` / `...@g.us`).
 *
 * For bare phone numbers, resolves the recipient's real WhatsApp chat id first: a raw
 * `${phone}@c.us` can land in a "ghost" chat (logged as sent, never delivered); getNumberId maps
 * the phone to the correct serialized id (null => the number isn't reachable on WhatsApp).
 * Pre-formatted chat ids are sent as-is.
 *
 * Never throws — failures are logged (with a body preview for manual resend) and returned.
 */
export async function sendTextTo(to: string, text: string): Promise<SendTextResult> {
  const client = getWhatsAppClient();
  let chatId = to;
  let resolved = false;
  try {
    if (!to.includes("@")) {
      const numberId = await client.getNumberId(to).catch(() => null);
      chatId = numberId ? numberId._serialized : `${to}@c.us`;
      resolved = Boolean(numberId);
    }
    const sent = await client.sendMessage(chatId, text);
    return {
      ok: true,
      chatId,
      resolved,
      ackMsgId: (sent as { id?: { _serialized?: string } })?.id?._serialized,
    };
  } catch (err) {
    logger.error("WhatsApp send failed", {
      to,
      chatId,
      error: String(err),
      bodyPreview: text.slice(0, 120),
    });
    return { ok: false, error: String(err) };
  }
}
