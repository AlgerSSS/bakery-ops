// outbound.worker.ts
//
// Drains wa_outbound_queue under cold-send governance to protect the ONE dedicated bot number.
// Registered on cron '*/2 * * * *' in bootstrap. SAFE NO-OP when the queue is empty, when outside
// business hours, or when the WhatsApp client isn't ready.
//
// Governance (outbound.config.ts):
//   - business-hours window: defer (no claim) outside it,
//   - daily cap via wa_send_log ledger: stop once exhausted,
//   - per-message jitter before sending,
//   - bounded attempts (retryOrFail) on send failure.
//
// One claimed row at a time (claimNext uses FOR UPDATE SKIP LOCKED), up to MAX_PER_TICK per tick.

import { logger } from "../../shared/logger";
import { isClientConnected, sendTextTo } from "./whatsapp.client";
import { waOutboundQueueRepository } from "../../data/repositories/wa-outbound-queue.repository";
import { candidateConversationRepository } from "../../data/repositories/candidate-conversation.repository";
import {
  DAILY_SEND_CAP,
  MAX_PER_TICK,
  withinBusinessHours,
  jitterMs,
} from "./outbound.config";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One worker tick. Drains up to MAX_PER_TICK governed sends; no-ops when nothing is eligible. */
export async function drainOutboundQueue(): Promise<void> {
  // Out of business hours -> defer entirely (don't even claim, so earliest_at scheduling is honoured).
  if (!withinBusinessHours()) return;

  // Verify the client is actually CONNECTED (isClientConnected also treats a not-ready client or a
  // detached/reloading puppeteer page as unhealthy). Defer the tick (the queued rows stay queued)
  // and let whatsapp-web.js recover, instead of burning send attempts.
  if (!(await isClientConnected())) return;

  // Daily cap budget (Asia/Kuala_Lumpur). 0 -> stop for today.
  let remaining = await waOutboundQueueRepository.remainingDailyCap(DAILY_SEND_CAP);
  if (remaining <= 0) {
    logger.info("Outbound worker: daily cap reached, deferring");
    return;
  }

  const budget = Math.min(MAX_PER_TICK, remaining);
  for (let i = 0; i < budget; i++) {
    const row = await waOutboundQueueRepository.claimNext();
    if (!row) return; // queue empty -> done

    // Respect candidate opt-out: never cold-send to an opted-out number.
    if (row.store_id && (await candidateConversationRepository.isOptedOut(row.store_id, row.phone))) {
      await waOutboundQueueRepository.skip(row.id, "recipient opted out");
      continue;
    }

    // Jitter so traffic doesn't look robotic.
    await sleep(jitterMs());

    // sendTextTo resolves the recipient's real WhatsApp chat id (ghost-chat defense) and never throws.
    const result = await sendTextTo(row.phone, row.body);
    if (result.ok) {
      await waOutboundQueueRepository.markSent(row.id, row.phone);
      remaining -= 1;
      logger.info("Outbound worker: sent", {
        phone: row.phone,
        chatId: result.chatId,
        resolved: result.resolved,
        ackMsgId: result.ackMsgId,
        remainingCap: remaining,
      });
    } else {
      await waOutboundQueueRepository.retryOrFail(row.id, result.error);
      logger.warn("Outbound worker: send failed, will retry", { phone: row.phone, error: result.error });
    }

    if (remaining <= 0) return;
  }
}
