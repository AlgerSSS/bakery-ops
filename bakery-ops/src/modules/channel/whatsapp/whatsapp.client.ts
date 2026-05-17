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
