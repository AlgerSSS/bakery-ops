import type { ScoredCandidate, ParsedJD, OutreachBatchResult } from "../types";
import type { OutreachConnector, OutreachMessage } from "./outreach.interface";
import { AJobThingOutreach } from "./ajobthing.outreach";
import { JobStreetOutreach } from "./jobstreet.outreach";
import { logger } from "../../../shared/logger";
import { getWhatsAppClient } from "../../../channel/whatsapp/whatsapp.client";

const FEEDBACK_WHATSAPP = process.env.OWNER_WHATSAPP || "";

const DEFAULT_MESSAGE: OutreachMessage = {
  subject: "Job Opportunity — {jobTitle}",
  body: [
    "Hi {candidateName},",
    "",
    "We are currently hiring for the position of {jobTitle} in {location}, and we think your background is a great fit.",
    `If you're interested in learning more, feel free to reply to this message or reach out to us on WhatsApp at +${process.env.OWNER_PHONE || "60175437858"}.`,
    "",
    "Looking forward to hearing from you!",
  ].join("\n"),
};

const outreachConnectors: Record<string, OutreachConnector> = {
  JobStreet: new JobStreetOutreach(),
  AJobThing: new AJobThingOutreach(),
};

/**
 * 自动触达编排：按平台分组候选人，检查预算，发送消息
 */
export async function runOutreach(
  candidates: ScoredCandidate[],
  jd: ParsedJD,
  message?: OutreachMessage,
): Promise<OutreachBatchResult[]> {
  const msg = message || DEFAULT_MESSAGE;
  const results: OutreachBatchResult[] = [];

  // 按 source 分组
  const grouped = new Map<string, ScoredCandidate[]>();
  for (const c of candidates) {
    const source = c.source || "Unknown";
    if (!grouped.has(source)) grouped.set(source, []);
    grouped.get(source)!.push(c);
  }

  for (const [source, sourceCandidates] of grouped) {
    const connector = outreachConnectors[source];
    if (!connector) {
      logger.info(`Outreach: 跳过平台 ${source}（无 outreach connector）`);
      results.push({
        platform: source,
        total: sourceCandidates.length,
        sent: 0,
        failed: 0,
        results: sourceCandidates.map((c) => ({
          candidateId: c.candidateId,
          candidateName: c.name,
          platform: source,
          status: "skipped" as const,
          error: "该平台暂不支持自动触达",
        })),
      });
      continue;
    }

    // 检查预算
    const budget = await connector.getRemainingBudget();
    if (budget !== null && budget <= 0) {
      logger.info(`Outreach: ${source} 预算已用完`);
      results.push({
        platform: source,
        total: sourceCandidates.length,
        sent: 0,
        failed: 0,
        results: sourceCandidates.map((c) => ({
          candidateId: c.candidateId,
          candidateName: c.name,
          platform: source,
          status: "budget_exceeded" as const,
          error: "平台预算已用完",
        })),
      });
      continue;
    }

    logger.info(`Outreach: 开始触达 ${source} 候选人`, {
      count: sourceCandidates.length,
      budget,
    });

    try {
      const batchResult = await connector.sendMessages(sourceCandidates, jd, msg);
      results.push(batchResult);
      logger.info(`Outreach: ${source} 完成`, {
        sent: batchResult.sent,
        failed: batchResult.failed,
      });
    } catch (err) {
      logger.error(`Outreach: ${source} 执行失败`, { error: String(err) });
      results.push({
        platform: source,
        total: sourceCandidates.length,
        sent: 0,
        failed: sourceCandidates.length,
        results: sourceCandidates.map((c) => ({
          candidateId: c.candidateId,
          candidateName: c.name,
          platform: source,
          status: "failed" as const,
          error: String(err),
        })),
      });
    }
  }

  // Send feedback to WhatsApp
  await sendWhatsAppFeedback(results, msg);

  return results;
}

/**
 * Send outreach results summary to WhatsApp
 */
async function sendWhatsAppFeedback(results: OutreachBatchResult[], msg: OutreachMessage): Promise<void> {
  try {
    const client = getWhatsAppClient();
    if (!client.info) {
      logger.warn("WhatsApp client not ready, skipping outreach feedback");
      return;
    }

    const lines: string[] = ["*自动触达结果*", ""];
    let totalSent = 0;
    let totalFailed = 0;

    for (const batch of results) {
      totalSent += batch.sent;
      totalFailed += batch.failed;

      lines.push(`*${batch.platform}*: 发送 ${batch.sent}/${batch.total}`);
      for (const r of batch.results) {
        const icon = r.status === "sent" ? "\u2705" : r.status === "failed" ? "\u274C" : "\u23F8\uFE0F";
        lines.push(`${icon} ${r.candidateName} — ${r.status}${r.error ? ` (${r.error})` : ""}`);
      }
      lines.push("");
    }

    lines.push(`*总计*: 发送 ${totalSent}, 失败 ${totalFailed}`);

    // 附上发送的消息内容
    if (totalSent > 0) {
      lines.push("");
      lines.push("*发送内容:*");
      lines.push(`Subject: ${msg.subject}`);
      lines.push(msg.body);
    }

    await client.sendMessage(FEEDBACK_WHATSAPP, lines.join("\n"));
    logger.info("Outreach feedback sent to WhatsApp", { to: FEEDBACK_WHATSAPP });
  } catch (err) {
    logger.error("Failed to send outreach feedback to WhatsApp", { error: String(err) });
  }
}
