import type { ChannelResponse, SkillExecutionResult } from "../shared/types";
import { WhatsAppFormatter } from "../channel/whatsapp/whatsapp.formatter";

export class ResponseFormatter {
  private formatter = new WhatsAppFormatter();

  format(result: SkillExecutionResult): ChannelResponse[] {
    return this.formatter.format(result);
  }

  formatError(message: string): ChannelResponse[] {
    return this.formatter.formatError(message);
  }

  prependAck(ackText: string, responses: ChannelResponse[]): ChannelResponse[] {
    return [{ type: "text", text: ackText }, ...responses];
  }
}
