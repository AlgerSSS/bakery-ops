import { MessageMedia } from "whatsapp-web.js";
import { getWhatsAppClient } from "./whatsapp.client";
import type { ChannelResponse } from "../../shared/types";
import { logger } from "../../shared/logger";
import { fileService } from "../../domain/files/file-service";

export class WhatsAppSender {
  async send(chatId: string, responses: ChannelResponse[]): Promise<void> {
    const client = getWhatsAppClient();

    for (const resp of responses) {
      try {
        if (resp.text) {
          await client.sendMessage(chatId, resp.text);
        }

        if (resp.files) {
          for (const file of resp.files) {
            const filePath = fileService.getFilePath(file.fileId);
            if (filePath) {
              const media = MessageMedia.fromFilePath(filePath);
              await client.sendMessage(chatId, media, {
                caption: file.fileName,
              });
            } else {
              logger.warn("File not found for sending", { fileId: file.fileId });
            }
          }
        }
      } catch (err) {
        logger.error("Failed to send WhatsApp message", {
          chatId,
          error: String(err),
        });
      }
    }
  }
}

export const whatsappSender = new WhatsAppSender();
