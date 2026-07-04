// 内部通知统一出口（老板/店长/主厨等运营团队）：Lark 优先，失败自动回落 WhatsApp。
// 对外消息（候选人/供应商/博主）不要走这里，直接用 whatsapp.client 的 sendTextTo。
// INTERNAL_NOTIFY_CHANNEL=lark 启用 Lark 主通道；未设置或 =whatsapp 时行为与原来完全一致。
import { sendLarkText } from "./lark/lark-messenger";
import { sendTextTo, isClientConnected } from "./whatsapp/whatsapp.client";
import { logger } from "../shared/logger";

export async function notifyInternal(phone: string, text: string): Promise<boolean> {
  if ((process.env.INTERNAL_NOTIFY_CHANNEL || "whatsapp") === "lark") {
    if (await sendLarkText(phone, text)) return true;
    logger.warn("internal notify: Lark 发送失败/收件人未映射，回落 WhatsApp", {
      phone: phone.replace(/@.*$/, ""),
    });
  }
  if (!(await isClientConnected())) {
    logger.error("internal notify: Lark 与 WhatsApp 均不可用，消息未送达", {
      phone: phone.replace(/@.*$/, ""),
      preview: text.slice(0, 60),
    });
    return false;
  }
  const result = await sendTextTo(phone, text);
  return result.ok;
}
