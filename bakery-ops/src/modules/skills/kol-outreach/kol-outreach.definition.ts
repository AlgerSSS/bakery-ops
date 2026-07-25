import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import type { KOLCollaborationRow, KOLRow } from "../../domain/marketing/types";
import { kolRepository } from "../../data/repositories/kol.repository";
import { kolCollaborationRepository } from "../../data/repositories/kol-collaboration.repository";
import { chatSampleRepository } from "../../data/repositories/chat-sample.repository";
import { logger } from "../../shared/logger";

const OWNER_PHONE = process.env.OWNER_PHONE || "601162351961";

const DM_TEMPLATE =
  `Hi {name}! We're Hot Crush, a popular bakery brand in KL. ` +
  `We love your content on {platform} and think you'd be a great fit to collaborate with us. ` +
  `Would you be interested in trying our products and sharing your experience with your followers? ` +
  `Let us know! You can reach us on WhatsApp at +${OWNER_PHONE}.`;

/** 按 KOL 生成个性化触达文案（F14：人机协作，平台 sendDM 是 stub 必败，不再自动发送）。 */
export function buildOutreachMessage(kol: Pick<KOLRow, "name" | "platform">): string {
  return DM_TEMPLATE.replace(/{name}/g, kol.name).replace(/{platform}/g, kol.platform);
}

function profileUrl(kol: Pick<KOLRow, "platform" | "platform_handle">): string {
  return kol.platform === "tiktok"
    ? `https://www.tiktok.com/@${kol.platform_handle}`
    : `https://www.instagram.com/${kol.platform_handle}`;
}

export const kolOutreachSkillDefinition: SkillDefinition = {
  skillId: "kol_outreach",
  name: "联系KOL",
  description:
    "为选定 KOL 生成个性化私信文案（老板手动发送）；发完回「已发 @handle」记录为已联系；" +
    "「博主 @handle 电话 60xxx」绑定博主 WhatsApp 号码",
  priority: 84,
  disambiguation: "给已选博主生成私信/合作邀请文案并记录触达；不是查找或添加新博主(kol_discovery)",
  triggerKeywords: [
    "联系KOL", "发DM", "私信博主", "邀请KOL", "reach out",
    "联系博主", "发消息给", "触达", "联系前", "合作邀请",
    "已发", "电话",
  ],
  examples: [
    "联系前3个KOL",
    "给 @foodlover_kl 发合作邀请",
    "联系刚才搜到的博主",
    "已发 @foodlover_kl",
    "博主 @foodlover_kl 电话 60123456789",
  ],
  requiredInputs: [
    { name: "text", type: "string", description: "联系指令" },
  ],
  optionalInputs: [
    { name: "kolHandles", type: "string", description: "KOL handle（逗号分隔）" },
    { name: "topN", type: "number", description: "联系前N个" },
  ],
  permissions: ["marketing.use"],
  riskLevel: "medium",
  requiresConfirmation: true,
  supportsMultiTurn: true,
  supportsFiles: false,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};

export class KOLOutreachSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const text = String(input.input.text || "");
    const kolHandlesRaw = input.input.kolHandles as string | undefined;
    const topN = input.input.topN as number | undefined;

    // F14②: 老板手动发完私信后回"已发 @handle" → 记录为已联系
    const sentMatch = text.match(/已发\s*@?([a-zA-Z0-9_.]+)/);
    if (sentMatch) {
      return this.markSent(sentMatch[1]);
    }

    // F15①: "博主 @handle 电话 60xxx" → 绑定博主 WhatsApp 号码（入站消息按此识别回流）
    const phoneMatch = text.match(/博主\s*@?([a-zA-Z0-9_.]+)\s*电话\s*\+?(\d{8,15})/);
    if (phoneMatch) {
      return this.bindPhone(phoneMatch[1], phoneMatch[2]);
    }

    // Multi-turn: user is confirming
    const state = input.input._kolOutreachState as Record<string, unknown> | undefined;
    if (state && state.step === "confirm") {
      const confirmed = /^(确认|是|好|ok|yes|发|发送)$/i.test(text);
      if (!confirmed) {
        return {
          runId: uuidv4(),
          skillId: "kol_outreach",
          status: "success",
          summary: "已取消。",
        };
      }
      // Execute outreach with previously selected KOLs
      const kolIds = (state.kolIds as string[]) || [];
      return this.executeOutreach(kolIds);
    }

    try {
      // Determine which KOLs to contact
      let kols: KOLRow[] = [];

      if (kolHandlesRaw) {
        const handles = kolHandlesRaw.split(",").map((h) => h.trim().replace("@", ""));
        for (const handle of handles) {
          // F14③: 不再硬编码 tiktok，按 handle 跨平台查
          const kol = await kolRepository.getByHandleAnyPlatform(handle);
          if (kol) kols.push(kol);
        }
      } else if (topN && topN > 0) {
        kols = await kolRepository.getRecent(topN);
      } else {
        // Parse from text
        const topNMatch = text.match(/前\s*(\d+)\s*[个位]/);
        if (topNMatch) {
          kols = await kolRepository.getRecent(parseInt(topNMatch[1]));
        } else {
          // Default: most recent 3
          kols = await kolRepository.getRecent(3);
        }
      }

      if (kols.length === 0) {
        return {
          runId: uuidv4(),
          skillId: "kol_outreach",
          status: "error",
          summary: '没有找到可联系的博主。请先运行 KOL 搜索（「帮我找几个博主」）。',
        };
      }

      // Show preview and ask for confirmation
      // F14①: 平台 sendDM 是 stub（必败）→ 改为生成文案由老板手动发送
      const lines: string[] = ["即将为以下博主生成个性化私信文案（不会自动发送，需要你手动私信）：", ""];
      for (const kol of kols) {
        lines.push(`  • @${kol.platform_handle} (${kol.platform})`);
      }
      lines.push("");
      lines.push(`文案模板: "${DM_TEMPLATE.replace(/{name}/g, "[博主名]").replace(/{platform}/g, "[平台]")}"`);
      lines.push("");
      lines.push(`回复 "确认" 生成，其他内容取消。`);

      return {
        runId: uuidv4(),
        skillId: "kol_outreach",
        status: "pending",
        summary: lines.join("\n"),
        data: { _kolOutreachState: { step: "confirm", kolIds: kols.map((k) => k.id) } },
      };
    } catch (err) {
      logger.error("KOL outreach skill failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "kol_outreach",
        status: "error",
        summary: `联系博主失败: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    }
  }

  /**
   * F14①: 人机协作触达——按 KOL 生成个性化文案 + 主页链接回给老板手动发送。
   * 不调 sendDM（平台 connector 是 stub 必败）、不写 dm_sent 样本；collab 停在 prospected，
   * 等老板回"已发 @handle"再置 contacted。
   */
  private async executeOutreach(kolIds: string[]): Promise<SkillExecutionResult> {
    const lines: string[] = ["━━━ KOL 触达文案（请手动发送）━━━"];
    let prepared = 0;

    for (const kolId of kolIds) {
      const kol = await kolRepository.getById(kolId);
      if (!kol) {
        lines.push("", `  ✗ ${kolId} — 博主不存在`);
        continue;
      }

      const message = buildOutreachMessage(kol);
      await kolCollaborationRepository.create({
        kol_id: kol.id,
        status: "prospected",
        dm_template_used: message,
      });

      lines.push(
        "",
        `▸ @${kol.platform_handle} (${kol.platform})`,
        `主页: ${profileUrl(kol)}`,
        `文案（长按复制）:`,
        message,
      );
      prepared++;

      logger.info("KOL outreach: copy prepared for manual send", {
        name: kol.name,
        platform: kol.platform,
      });
    }

    lines.push("", `共 ${prepared} 位。手动发完后回复「已发 @博主handle」，我会记录为已联系。`);

    return {
      runId: uuidv4(),
      skillId: "kol_outreach",
      status: "success",
      summary: lines.join("\n"),
    };
  }

  /** F14②: 老板手动发送后回"已发 @handle" → markDMSent 置 contacted + 记 dm_sent 样本。 */
  private async markSent(handle: string): Promise<SkillExecutionResult> {
    const kol = await kolRepository.getByHandleAnyPlatform(handle);
    if (!kol) {
      return {
        runId: uuidv4(),
        skillId: "kol_outreach",
        status: "error",
        summary: `没找到博主 @${handle}，请检查 handle 或先添加（「添加博主 @handle ...」）。`,
      };
    }

    const collabs = await kolCollaborationRepository.getByKOLId(kol.id);
    let collab: KOLCollaborationRow | null = collabs[0] ?? null;
    const message = collab?.dm_template_used || buildOutreachMessage(kol);
    if (!collab) {
      // 老板没走生成文案流程直接发了：补一条合作记录
      collab = await kolCollaborationRepository.create({
        kol_id: kol.id,
        status: "prospected",
        dm_template_used: message,
      });
    }
    if (collab) {
      await kolCollaborationRepository.markDMSent(collab.id, message);
    }

    await chatSampleRepository.create({
      kol_id: kol.id,
      platform: kol.platform,
      message_content: message,
      message_type: "dm_sent",
    });

    return {
      runId: uuidv4(),
      skillId: "kol_outreach",
      status: "success",
      summary: `已记录：@${kol.platform_handle} (${kol.platform}) 已联系(contacted)。博主回复到 WhatsApp 后我会自动跟进。`,
    };
  }

  /** F15①: "博主 @handle 电话 60xxx" → 写 kols.contact_info.phone，入站消息按此识别博主回流。 */
  private async bindPhone(handle: string, phone: string): Promise<SkillExecutionResult> {
    const kol = await kolRepository.getByHandleAnyPlatform(handle);
    if (!kol) {
      return {
        runId: uuidv4(),
        skillId: "kol_outreach",
        status: "error",
        summary: `没找到博主 @${handle}，请检查 handle 或先添加（「添加博主 @handle ...」）。`,
      };
    }

    await kolRepository.updateContactPhone(kol.id, phone);

    return {
      runId: uuidv4(),
      skillId: "kol_outreach",
      status: "success",
      summary: `已绑定：@${kol.platform_handle} 电话 ${phone}。该号码在 WhatsApp 上的消息会自动识别为这位博主并转发给你。`,
    };
  }
}
