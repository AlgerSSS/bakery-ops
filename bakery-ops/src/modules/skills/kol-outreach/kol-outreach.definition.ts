import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import type { KOLOutreachResult, KOLRow } from "../../domain/marketing/types";
import { tiktokConnector } from "../../domain/marketing/connectors/tiktok.connector";
import { instagramConnector } from "../../domain/marketing/connectors/instagram.connector";
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

export const kolOutreachSkillDefinition: SkillDefinition = {
  skillId: "kol_outreach",
  name: "联系KOL",
  description: "通过平台私信向选定的 KOL 发送合作邀请",
  priority: 84,
  triggerKeywords: [
    "联系KOL", "发DM", "私信博主", "邀请KOL", "reach out",
    "联系博主", "发消息给", "触达", "联系前",
  ],
  examples: [
    "联系前3个KOL",
    "给 @foodlover_kl 发合作邀请",
    "联系刚才搜到的博主",
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
          const kol = await kolRepository.getByHandle("tiktok", handle);
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
      const lines: string[] = ["即将通过平台私信联系以下博主：", ""];
      for (const kol of kols) {
        lines.push(`  • @${kol.platform_handle} (${kol.platform})`);
      }
      lines.push("");
      lines.push(`消息内容: "${DM_TEMPLATE.replace(/{name}/g, "[博主名]").replace(/{platform}/g, "[平台]")}"`);
      lines.push("");
      lines.push(`回复 "确认" 发送，其他内容取消。`);

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

  private async executeOutreach(kolIds: string[]): Promise<SkillExecutionResult> {
    const results: KOLOutreachResult[] = [];

    for (const kolId of kolIds) {
      const kol = await kolRepository.getById(kolId);
      if (!kol) {
        results.push({ kolName: kolId, platform: "unknown", status: "failed", error: "KOL not found" });
        continue;
      }

      const message = DM_TEMPLATE.replace(/{name}/g, kol.name).replace(/{platform}/g, kol.platform);

      // Create collaboration record
      const collab = await kolCollaborationRepository.create({
        kol_id: kol.id,
        status: "prospected",
        dm_template_used: DM_TEMPLATE,
      });

      // Send DM via appropriate connector
      let dmResult: { success: boolean; error?: string };
      if (kol.platform === "tiktok") {
        dmResult = await tiktokConnector.sendDM(
          { platform: "tiktok", platformId: kol.platform_id, handle: kol.platform_handle, name: kol.name, bio: kol.bio || "", followerCount: kol.follower_count, niche: kol.niche, verified: kol.verified, profileUrl: `https://www.tiktok.com/@${kol.platform_handle}`, contactInfo: kol.contact_info },
          message,
        );
      } else {
        dmResult = await instagramConnector.sendDM(
          { platform: "instagram", platformId: kol.platform_id, handle: kol.platform_handle, name: kol.name, bio: kol.bio || "", followerCount: kol.follower_count, niche: kol.niche, verified: kol.verified, profileUrl: `https://www.instagram.com/${kol.platform_handle}`, contactInfo: kol.contact_info },
          message,
        );
      }

      if (dmResult.success && collab) {
        await kolCollaborationRepository.markDMSent(collab.id, DM_TEMPLATE);
      }

      // Log sample
      await chatSampleRepository.create({
        kol_id: kol.id,
        platform: kol.platform,
        message_content: message,
        message_type: "dm_sent",
      });

      results.push({
        kolName: kol.name,
        platform: kol.platform,
        status: dmResult.success ? "sent" : "failed",
        error: dmResult.error,
        collaborationId: collab?.id,
      });

      logger.info("KOL outreach: DM result", {
        name: kol.name,
        platform: kol.platform,
        success: dmResult.success,
      });
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;

    const lines: string[] = ["━━━ KOL 触达结果 ━━━", ""];
    for (const r of results) {
      const icon = r.status === "sent" ? "✓" : "✗";
      lines.push(`  ${icon} ${r.kolName} (${r.platform})${r.error ? ` — ${r.error}` : ""}`);
    }
    lines.push("");
    lines.push(`发送: ${sent}, 失败: ${failed}`);

    return {
      runId: uuidv4(),
      skillId: "kol_outreach",
      status: "success",
      summary: lines.join("\n"),
    };
  }
}
