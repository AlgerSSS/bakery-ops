import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";
import { waSendLogRepository } from "./wa-send-log.repository";

export type QueueStatus = "queued" | "sending" | "sent" | "failed" | "skipped";

export interface WaOutboundQueueRow {
  id: string;
  store_id?: string;
  phone: string;
  application_id?: string;
  body: string;
  status: QueueStatus;
  attempts: number;
  max_attempts: number;
  last_error?: string;
  earliest_at: string;
  sent_at?: string;
  created_at: string;
}

const SELECT_COLS =
  "id, store_id, phone, application_id, body, status, attempts, max_attempts, last_error, " +
  "earliest_at::text AS earliest_at, sent_at::text AS sent_at, created_at::text AS created_at";

export interface EnqueueOptions {
  storeId?: string;
  applicationId?: string;
  earliestAt?: string;
}

export class WaOutboundQueueRepository {
  /**
   * Idempotent on phone (UNIQUE(phone)): at most one pending outbound per number. A re-enqueue onto a
   * row that already exists resets it back to 'queued' with the new body/schedule (collapsing retries
   * and new sends onto the single row).
   */
  async enqueue(phone: string, body: string, opts: EnqueueOptions = {}): Promise<void> {
    try {
      await execute(
        `INSERT INTO wa_outbound_queue (phone, body, store_id, application_id, earliest_at, status, attempts)
         VALUES (?, ?, ?, ?, COALESCE(?::timestamptz, NOW()), 'queued', 0)
         ON CONFLICT (phone) DO UPDATE SET
           body = EXCLUDED.body,
           store_id = EXCLUDED.store_id,
           application_id = EXCLUDED.application_id,
           earliest_at = EXCLUDED.earliest_at,
           status = 'queued',
           attempts = 0,
           last_error = NULL,
           sent_at = NULL`,
        [phone, body, opts.storeId ?? null, opts.applicationId ?? null, opts.earliestAt ?? null],
      );
    } catch (e) {
      logger.error("Failed to enqueue outbound message", { phone, error: (e as Error).message });
    }
  }

  /**
   * Atomically claim the next ready row: status='queued' AND earliest_at<=NOW(), oldest first.
   * Uses FOR UPDATE SKIP LOCKED so concurrent workers never grab the same row. Flips it to 'sending'
   * and increments attempts. Returns the claimed row or null when nothing is ready.
   */
  async claimNext(): Promise<WaOutboundQueueRow | null> {
    try {
      const rows = await query<WaOutboundQueueRow>(
        `UPDATE wa_outbound_queue SET status = 'sending', attempts = attempts + 1
         WHERE id = (
           SELECT id FROM wa_outbound_queue
           WHERE status = 'queued' AND earliest_at <= NOW()
           ORDER BY earliest_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING ${SELECT_COLS}`,
      );
      return rows[0] ?? null;
    } catch (e) {
      logger.error("Failed to claim next outbound message", { error: (e as Error).message });
      return null;
    }
  }

  /** Marks a claimed row sent and appends to the daily-cap ledger. */
  async markSent(id: string, phone: string): Promise<void> {
    try {
      await execute(
        "UPDATE wa_outbound_queue SET status = 'sent', sent_at = NOW() WHERE id = ?",
        [id],
      );
      await waSendLogRepository.record(phone);
    } catch (e) {
      logger.error("Failed to mark outbound sent", { id, error: (e as Error).message });
    }
  }

  /** Drops the row from the pipeline without sending (e.g. recipient opted out or cap exhausted). */
  async skip(id: string, reason?: string): Promise<void> {
    try {
      await execute(
        "UPDATE wa_outbound_queue SET status = 'skipped', last_error = ? WHERE id = ?",
        [reason ?? null, id],
      );
    } catch (e) {
      logger.error("Failed to skip outbound", { id, error: (e as Error).message });
    }
  }

  /**
   * On a send failure: requeue for another attempt if attempts < max_attempts, otherwise mark failed.
   * attempts was already incremented at claim time.
   */
  async retryOrFail(id: string, error: string): Promise<void> {
    try {
      await execute(
        `UPDATE wa_outbound_queue SET
           status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
           last_error = ?
         WHERE id = ?`,
        [error, id],
      );
    } catch (e) {
      logger.error("Failed to retryOrFail outbound", { id, error: (e as Error).message });
    }
  }

  /** Current backlog: rows still waiting to be sent (status='queued'). Returns 0 on query failure. */
  async countQueued(): Promise<number> {
    try {
      const rows = await query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM wa_outbound_queue WHERE status = 'queued'",
      );
      return rows[0]?.count ?? 0;
    } catch (e) {
      logger.error("Failed to count queued outbound messages", { error: (e as Error).message });
      return 0;
    }
  }

  /** Remaining daily cold-send budget = cap - sends already logged today (Asia/Kuala_Lumpur). >= 0. */
  async remainingDailyCap(cap: number): Promise<number> {
    const used = await waSendLogRepository.countSentToday();
    return Math.max(0, cap - used);
  }
}

export const waOutboundQueueRepository = new WaOutboundQueueRepository();
