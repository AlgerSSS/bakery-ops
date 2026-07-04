// outbound.config.ts
//
// Cold-send governance for the ONE dedicated bot WhatsApp number (601162351961). Every config here
// protects that single number — there is no second client and no Cloud API. The outbound worker
// (outbound.worker.ts) reads these values to decide whether/when a queued message may go out.
//
// All knobs are env-overridable so they can be tightened in prod without a code change; the defaults
// below are conservative.

/** Daily cap on cold outbound sends (per the wa_send_log ledger, Asia/Kuala_Lumpur day). */
export const DAILY_SEND_CAP = Number(process.env.OUTBOUND_DAILY_CAP || 40);

/** Business-hours window (local Asia/Kuala_Lumpur, 24h). Sends outside this window are deferred. */
export const BUSINESS_HOURS_START = Number(process.env.OUTBOUND_HOURS_START || 9); // 09:00
export const BUSINESS_HOURS_END = Number(process.env.OUTBOUND_HOURS_END || 21); // 21:00

/** Random jitter (ms) applied before each send so traffic doesn't look robotic. */
export const JITTER_MIN_MS = Number(process.env.OUTBOUND_JITTER_MIN_MS || 1500);
export const JITTER_MAX_MS = Number(process.env.OUTBOUND_JITTER_MAX_MS || 6000);

/** How many messages one worker tick will attempt to drain (keeps each tick short). */
export const MAX_PER_TICK = Number(process.env.OUTBOUND_MAX_PER_TICK || 1);

/** IANA timezone all governance windows are evaluated in. */
export const OUTBOUND_TZ = "Asia/Kuala_Lumpur";

/**
 * STOP / opt-out keywords. A candidate inbound matching this means "stop messaging me" and must
 * terminate the conversation (markOptedOut). Matched case-insensitively against the trimmed message.
 * Covers EN / 中文 / BM phrasings.
 */
// Latin keywords keep a \b word boundary (so "stopwatch"/"quitter" don't match). CJK keywords are
// matched as a leading anchored prefix: a trailing \b never forms after a CJK char at end-of-input
// (\b needs a \w↔non-\w transition), which previously made every Chinese term un-matchable.
export const STOP_REGEX =
  /^(?:(?:stop|unsubscribe|opt[\s-]?out|quit|cancel|berhenti|tak nak)\b|退订|停止|取消|别发了|不要再发)/iu;

/** Current local hour in Asia/Kuala_Lumpur (0-23). */
export function localHour(now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: OUTBOUND_TZ,
    hour: "numeric",
    hour12: false,
  });
  return Number(fmt.format(now));
}

/** True when `now` falls inside the configured business-hours window. */
export function withinBusinessHours(now: Date = new Date()): boolean {
  const h = localHour(now);
  return h >= BUSINESS_HOURS_START && h < BUSINESS_HOURS_END;
}

/** Local (Asia/Kuala_Lumpur) calendar date as YYYY-MM-DD. */
export function localDate(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: OUTBOUND_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now); // en-CA => YYYY-MM-DD
}

/** A random jitter delay in ms within the configured band. */
export function jitterMs(): number {
  return JITTER_MIN_MS + Math.floor(Math.random() * Math.max(1, JITTER_MAX_MS - JITTER_MIN_MS));
}
