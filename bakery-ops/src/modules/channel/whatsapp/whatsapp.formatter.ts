import type { SkillExecutionResult } from "../../shared/types";
import type { ChannelResponse } from "../../shared/types";

export class WhatsAppFormatter {
  format(result: SkillExecutionResult): ChannelResponse[] {
    const responses: ChannelResponse[] = [];

    // 文本摘要
    if (result.summary) {
      let text = result.summary;

      // 附加操作选项
      if (result.nextActions && result.nextActions.length > 0) {
        text += "\n\n你可以回复：";
        result.nextActions.forEach((action, i) => {
          text += `\n${i + 1} = ${action.label}`;
        });
      }

      responses.push({ type: "text", text });
    }

    // 文件（图片用 image 类型，其他用 document）
    if (result.files && result.files.length > 0) {
      for (const file of result.files) {
        const isImage = file.mimeType.startsWith("image/");
        responses.push({
          type: isImage ? "image" : "document",
          files: [file],
        });
      }
    }

    return responses;
  }

  formatError(error: string): ChannelResponse[] {
    return [{ type: "text", text: error }];
  }

  formatMenu(menuText: string): ChannelResponse[] {
    return [{ type: "text", text: menuText }];
  }

  formatConfirmation(skillName: string): ChannelResponse[] {
    return [{
      type: "text",
      text: `你是想使用「${skillName}」功能吗？\n\n回复：是 / 否`,
    }];
  }
}

export const whatsappFormatter = new WhatsAppFormatter();
