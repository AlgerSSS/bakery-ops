// candidate-fsm.ts
//
// Deterministic, multi-day candidate conversation FSM for the QR-poster intake funnel.
//
// HARD RULES (owner decisions):
//  - State is persisted in candidate_conversations (NOT the 10-min OWNER-scoped session_state).
//  - There are NO WhatsApp interactive buttons. Every choice the candidate makes is a NUMBERED TEXT
//    menu. The LLM ONLY parses a free-text reply into a fixed intent ({choice|reschedule|stop|unclear});
//    the FSM — not the LLM — owns every state transition.
//  - STOP at any point -> markOptedOut. 3 consecutive "unclear" replies -> hand off to a human and
//    notify the store manager.
//
// QR happy path implemented this pass:
//   INTAKE
//     -> (consent YES/NO)            AWAITING_INTERVIEW_CONFIRM holds consent gate first via context
//     -> (应聘类型 1 前场/2 后厨)
//     -> propose interview slots (numbered, from store.interview_windows)
//     -> read-back confirm
//     -> write appointments(kind='interview'), advance application new->contacting->first_interview,
//        mirror to Lark.
//
// Candidate-facing templates are English-only (owner decision: all candidate outreach in English).
// JobStreet-initiated outreach enters at the 'outbound_intro' stage (consent + role already known).

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { logger } from "../../../shared/logger";
import { aiProvider } from "../../ai/ai-provider";
import {
  candidateConversationRepository,
  type CandidateConversationRow,
} from "../../../data/repositories/candidate-conversation.repository";
import { applicationRepository, type ApplicationRow } from "../../../data/repositories/application.repository";
import { appointmentRepository, type TrialDuration } from "../../../data/repositories/appointment.repository";
import { offerRepository } from "../../../data/repositories/offer.repository";
import { employeeRepository } from "../../../data/repositories/employee.repository";
import { jobOpeningRepository } from "../../../data/repositories/job-opening.repository";
import { storeRepository } from "../../../data/repositories/store.repository";
import { userRepository } from "../../../data/repositories/user.repository";
import { larkRecruitmentService } from "../../lark/lark-recruitment.service";
import { ROLE_AREA } from "../recruitment-vocab";
import type { RoleArea } from "../../../data/repositories/job-opening.repository";
import { getWhatsAppClient } from "../../../channel/whatsapp/whatsapp.client";
import { STOP_REGEX } from "../../../channel/whatsapp/outbound.config";

dayjs.extend(utc);
dayjs.extend(timezone);
const KL_TZ = "Asia/Kuala_Lumpur";
const DOW: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** The fixed intent vocabulary the LLM parser is allowed to emit. */
export type ParsedIntent =
  | { kind: "choice"; index: number } // a numbered menu selection (1-based)
  | { kind: "yes" }
  | { kind: "no" }
  | { kind: "reschedule" }
  | { kind: "stop" }
  | { kind: "unclear" };

/** A response the FSM wants sent back to the candidate (single text reply; no buttons). */
export interface FsmReply {
  text: string;
}

const UNCLEAR_LIMIT = 3;

// ---------------------------------------------------------------------------
// Tri-lingual templates (EN / 中文 / BM). Kept terse; numbered options only.
// ---------------------------------------------------------------------------

/** Re-prompt for the outbound (JobStreet-initiated) intro: 1 = arrange, 2 = more info. */
function outboundIntroPrompt(): string {
  return [
    `Would you like to come in for a short interview + trial shift?`,
    `Reply 1 to arrange a time, 2 for more info, or STOP to opt out.`,
  ].join("\n");
}

function infoMessage(storeName: string): string {
  return [
    `${storeName} is a bakery cafe at Pavilion, Bukit Bintang, KL.`,
    `Service Crew = counter / barista / customer service, shift-based incl. weekends. No experience needed — training is provided.`,
    `Reply 1 and we'll arrange your interview + trial shift. (Reply STOP to opt out.)`,
  ].join("\n");
}

function consentPrompt(storeName: string): string {
  return [
    `Hi! Thanks for scanning the ${storeName} hiring QR. Would you like to apply?`,
    `Reply: 1 = Yes  /  2 = No`,
  ].join("\n");
}

function roleAreaPrompt(): string {
  return [
    `Which area are you applying for?`,
    `1 = Front of house (FOH)`,
    `2 = Kitchen (BOH)`,
  ].join("\n");
}

function slotsPrompt(slots: string[]): string {
  return [
    `Great! Pick an interview time (reply with the number):`,
    slots.map((s, i) => `${i + 1} = ${s}`).join("\n"),
  ].join("\n");
}

function readBackPrompt(slot: string, roleArea: RoleArea): string {
  const area = roleArea === "FOH" ? "Front of house" : "Kitchen";
  return [
    `Please confirm your interview:`,
    `• Area: ${area}`,
    `• Time: ${slot}`,
    `Reply: 1 = Confirm  /  2 = Choose another time`,
  ].join("\n");
}

function bookedMessage(slot: string): string {
  return `Booked! Your interview is at ${slot}. See you then. (Reply STOP to opt out.)`;
}

function trialSlotsPrompt(slots: string[]): string {
  return [
    `You passed the interview 🎉 Let's set up your trial shift. Pick a time (reply with the number):`,
    slots.map((s, i) => `${i + 1} = ${s}`).join("\n"),
  ].join("\n");
}

function trialReadBackPrompt(slot: string, roleArea: RoleArea, duration: TrialDuration): string {
  const area = roleArea === "FOH" ? "Front of house" : "Kitchen";
  const dur = duration === "4小时" ? "about 4 hours" : "about 1 hour";
  return [
    `Please confirm your trial shift:`,
    `• Area: ${area}`,
    `• Time: ${slot}`,
    `• Duration: ${dur}`,
    `Reply: 1 = Confirm  /  2 = Choose another time`,
  ].join("\n");
}

function trialBookedMessage(slot: string): string {
  return `Booked! Your trial shift is at ${slot}. See you then. (Reply STOP to opt out.)`;
}

function offerMessage(position: string, salary: string): string {
  const pay = salary ? ` at RM${salary}/month` : "";
  return [
    `Great news — Hot Crush would like to offer you the ${position} role${pay}.`,
    `Reply: 1 = Accept  /  2 = I have questions  (or STOP to decline)`,
  ].join("\n");
}

const OFFER_QUESTIONS_MESSAGE = `Thanks! A team member will follow up with you about your questions shortly.`;

const HIRED_MESSAGE = `Welcome to Hot Crush! 🎉 Your manager will message you with start details.`;

const DECLINED_MESSAGE = `No problem — thanks for your interest. Take care!`;

const OPTED_OUT_MESSAGE = `You've been opted out and won't receive further messages. Thank you.`;

const HUMAN_HANDOFF_MESSAGE = `Thanks! A team member will follow up with you shortly.`;

const UNCLEAR_NUDGE = `Sorry, please reply with just the number from the options above.`;

// ---------------------------------------------------------------------------
// LLM reply parser — the ONLY place the LLM is used. It maps a free-text reply
// to ONE intent from the fixed set above; it never decides transitions.
// We try a cheap deterministic parse first and only fall back to the LLM.
// ---------------------------------------------------------------------------

/** Deterministic fast-path: bare numbers and obvious yes/no/stop without an LLM call. */
function fastParse(text: string, maxIndex: number): ParsedIntent | null {
  const t = text.trim();
  if (STOP_REGEX.test(t)) return { kind: "stop" };

  const numMatch = t.match(/^[#．.\s]*(\d{1,2})\b/);
  if (numMatch) {
    const idx = Number(numMatch[1]);
    if (idx >= 1 && idx <= maxIndex) return { kind: "choice", index: idx };
  }

  if (/^(yes|ya|是|好|要|可以|ok|okay)\b/i.test(t)) return { kind: "yes" };
  if (/^(no|tidak|否|不|不要|不用)\b/i.test(t)) return { kind: "no" };
  if (/(reschedule|change.*time|another time|换时间|改时间|tukar masa)/i.test(t))
    return { kind: "reschedule" };

  return null;
}

async function parseReply(text: string, maxIndex: number): Promise<ParsedIntent> {
  const fast = fastParse(text, maxIndex);
  if (fast) return fast;

  // LLM fallback — strictly classify into the fixed intent set. No transition logic here.
  const prompt = [
    `You classify a job candidate's WhatsApp reply into ONE intent. The candidate was shown a numbered`,
    `menu with options 1..${maxIndex}. Output STRICT JSON only, no prose.`,
    `Schema: {"kind":"choice","index":<1-${maxIndex}>} | {"kind":"yes"} | {"kind":"no"} |`,
    `{"kind":"reschedule"} | {"kind":"stop"} | {"kind":"unclear"}`,
    `Rules: pick "choice" with the chosen number if they indicate one of the options; "stop" if they`,
    `want to opt out / stop messages; "reschedule" if they ask for a different time; "unclear" otherwise.`,
    ``,
    `Candidate reply: ${JSON.stringify(text)}`,
  ].join("\n");

  try {
    // G3c: 纯 6 分类小任务走轻量模型；AI_SMALL_MODEL 未设时回落 provider 默认（AI_CHAT_MODEL）。
    const raw = await aiProvider.chatCompletion(prompt, 60, process.env.AI_SMALL_MODEL || undefined);
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as ParsedIntent;
    if (parsed?.kind === "choice") {
      const idx = Number((parsed as { index: number }).index);
      if (idx >= 1 && idx <= maxIndex) return { kind: "choice", index: idx };
      return { kind: "unclear" };
    }
    if (
      parsed?.kind === "yes" ||
      parsed?.kind === "no" ||
      parsed?.kind === "reschedule" ||
      parsed?.kind === "stop" ||
      parsed?.kind === "unclear"
    ) {
      return parsed;
    }
  } catch (err) {
    logger.warn("candidate-fsm: LLM parse failed, treating as unclear", { error: String(err) });
  }
  return { kind: "unclear" };
}

// ---------------------------------------------------------------------------
// Context shape persisted in candidate_conversations.context (JSONB).
// ---------------------------------------------------------------------------

interface FsmContext {
  stage?:
    | "outbound_intro"
    | "consent"
    | "role_area"
    | "slots"
    | "readback"
    | "trial_slots" // candidate picks a trial-shift time (started by the interview-pass flow)
    | "trial_readback" // candidate confirms the trial shift
    | "offer_decision"; // candidate accepts / queries / declines the offer
  roleArea?: RoleArea;
  offeredSlots?: string[];
  chosenSlot?: string;
  trialSlots?: string[];
  chosenTrialSlot?: string;
  trialDuration?: TrialDuration;
  offerId?: string;
  offerPosition?: string;
  offerSalary?: string;
  unclearCount?: number;
}

/** Read store interview windows -> a flat list of human-readable slot strings (numbered downstream). */
function deriveSlots(store: { interview_windows: Record<string, unknown> } | null): string[] {
  const iw = store?.interview_windows;
  if (!iw) return DEFAULT_SLOTS;
  // interview_windows is free-form JSONB; accept either a string[] or an object whose values are arrays.
  if (Array.isArray(iw)) return (iw as unknown[]).map(String).slice(0, 6);
  const out: string[] = [];
  for (const [day, val] of Object.entries(iw)) {
    if (Array.isArray(val)) for (const t of val) out.push(`${day} ${String(t)}`);
    else if (typeof val === "string") out.push(`${day} ${val}`);
  }
  return out.length ? out.slice(0, 6) : DEFAULT_SLOTS;
}

// Fallback slots when a store has no interview_windows configured yet.
const DEFAULT_SLOTS = ["Mon 10:00", "Tue 10:00", "Wed 14:00"];

/**
 * Role-specific trial-shift slots from store.trial_windows. FOH and BOH have their own times (applied
 * every day), e.g. {"FOH":["12:00","14:00"], "BOH":["10:00","14:00"]}. Generates the next 3 days at
 * those times, labelled "ddd HH:mm" so slotToTimestamp parses them. (Durations are role-fixed elsewhere:
 * FOH 1小时, BOH 4小时.)
 */
function deriveTrialSlots(
  store: { trial_windows?: Record<string, unknown> } | null,
  roleArea: RoleArea,
): string[] {
  const tw = (store?.trial_windows || {}) as Record<string, unknown>;
  const configured = tw[roleArea];
  const times =
    Array.isArray(configured) && configured.length > 0
      ? (configured as unknown[]).map(String)
      : roleArea === "BOH"
        ? ["10:00", "14:00"]
        : ["12:00", "14:00"];
  const labels = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const out: string[] = [];
  for (let d = 1; d <= 3; d++) {
    const day = dayjs().tz(KL_TZ).add(d, "day");
    const label = labels[day.day()];
    for (const t of times) out.push(`${label} ${t}`);
  }
  return out.slice(0, 6);
}

export class CandidateFsm {
  /**
   * Drive the FSM one step for an inbound candidate message. Returns the reply text(s) to send back.
   * `conv` is the current persisted conversation row; `application` its linked application.
   */
  async handle(
    conv: CandidateConversationRow,
    application: ApplicationRow,
    text: string,
  ): Promise<FsmReply[]> {
    const storeId = conv.store_id;
    const phone = conv.phone;
    await candidateConversationRepository.touchInbound(storeId, phone);

    if (conv.opted_out || conv.state === "OPTED_OUT") {
      return []; // never re-engage an opted-out number
    }

    const ctx = (conv.context || {}) as FsmContext;
    const stage = ctx.stage ?? "consent";

    // Decide how many numbered options the current stage exposes (for the parser bound).
    const maxIndex = this.maxIndexForStage(stage, ctx);
    const intent = await parseReply(text, maxIndex);

    if (intent.kind === "stop") {
      await candidateConversationRepository.markOptedOut(storeId, phone);
      await applicationRepository.advanceStage(application.id, "opted_out");
      return [{ text: OPTED_OUT_MESSAGE }];
    }

    // Unclear handling with a 3-strike human handoff.
    if (intent.kind === "unclear") {
      const count = (ctx.unclearCount ?? 0) + 1;
      if (count >= UNCLEAR_LIMIT) {
        await candidateConversationRepository.upsertState(storeId, phone, conv.state, {
          ...ctx,
          unclearCount: count,
        }, application.id);
        await this.notifyManagerHumanNeeded(storeId, phone, application);
        return [{ text: HUMAN_HANDOFF_MESSAGE }];
      }
      await candidateConversationRepository.upsertState(storeId, phone, conv.state, {
        ...ctx,
        unclearCount: count,
      }, application.id);
      return [{ text: UNCLEAR_NUDGE }];
    }

    // A clear reply resets the unclear streak.
    const baseCtx: FsmContext = { ...ctx, unclearCount: 0 };

    switch (stage) {
      case "outbound_intro":
        return this.onOutboundIntro(conv, application, intent, baseCtx);
      case "consent":
        return this.onConsent(conv, application, intent, baseCtx);
      case "role_area":
        return this.onRoleArea(conv, application, intent, baseCtx);
      case "slots":
        return this.onSlots(conv, application, intent, baseCtx);
      case "readback":
        return this.onReadBack(conv, application, intent, baseCtx);
      case "trial_slots":
        return this.onTrialSlots(conv, application, intent, baseCtx);
      case "trial_readback":
        return this.onTrialReadBack(conv, application, intent, baseCtx);
      case "offer_decision":
        return this.onOfferDecision(conv, application, intent, baseCtx);
      default:
        return this.onConsent(conv, application, intent, baseCtx);
    }
  }

  /** First contact for a freshly-created QR application: send the consent prompt. */
  async start(conv: CandidateConversationRow, storeName: string): Promise<FsmReply[]> {
    await candidateConversationRepository.upsertState(
      conv.store_id,
      conv.phone,
      "AWAITING_INTERVIEW_CONFIRM",
      { stage: "consent", unclearCount: 0 },
      conv.application_id,
    );
    return [{ text: consentPrompt(storeName) }];
  }

  private maxIndexForStage(stage: FsmContext["stage"], ctx: FsmContext): number {
    switch (stage) {
      case "outbound_intro":
        return 2;
      case "consent":
        return 2;
      case "role_area":
        return 2;
      case "slots":
        return (ctx.offeredSlots ?? DEFAULT_SLOTS).length;
      case "readback":
        return 2;
      case "trial_slots":
        return (ctx.trialSlots ?? DEFAULT_SLOTS).length;
      case "trial_readback":
        return 2;
      case "offer_decision":
        return 2;
      default:
        return 2;
    }
  }

  /**
   * Entry for JobStreet-initiated outreach (we messaged them first). Consent is implicit (they applied)
   * and role_area is known from the application, so: 1/yes -> straight to interview slots; 2 -> more
   * info; explicit no -> decline.
   */
  private async onOutboundIntro(
    conv: CandidateConversationRow,
    application: ApplicationRow,
    intent: ParsedIntent,
    ctx: FsmContext,
  ): Promise<FsmReply[]> {
    // 1 / yes -> arrange. Role known (contacted candidate) -> straight to slots; role unknown
    // (cold stranger/prospect) -> ask which area first.
    if (intent.kind === "yes" || (intent.kind === "choice" && intent.index === 1)) {
      const roleArea = ctx.roleArea || application.role_area;
      if (roleArea) {
        return this.advanceToSlots(conv, application, { ...ctx, roleArea });
      }
      await candidateConversationRepository.upsertState(
        conv.store_id, conv.phone, "AWAITING_INTERVIEW_CONFIRM",
        { ...ctx, stage: "role_area" }, application.id,
      );
      return [{ text: roleAreaPrompt() }];
    }
    // 2 -> the job info (the JobStreet opening's stored description, else a default blurb).
    if (intent.kind === "choice" && intent.index === 2) {
      const info = await this.buildJobInfo(conv.store_id, application);
      await candidateConversationRepository.upsertState(
        conv.store_id, conv.phone, "AWAITING_INTERVIEW_CONFIRM",
        { ...ctx, stage: "outbound_intro" }, application.id,
      );
      return [{ text: info }];
    }
    if (intent.kind === "no") {
      await candidateConversationRepository.upsertState(
        conv.store_id, conv.phone, "DONE", { ...ctx, stage: "outbound_intro" }, application.id,
      );
      return [{ text: DECLINED_MESSAGE }];
    }
    return [{ text: outboundIntroPrompt() }];
  }

  /** "More info" reply: the opening's stored description (from JobStreet) or a default blurb. */
  private async buildJobInfo(storeId: string, application: ApplicationRow): Promise<string> {
    let desc = "";
    if (application.job_opening_id) {
      const opening = await jobOpeningRepository.findById(application.job_opening_id);
      desc = (opening?.description || "").trim();
    }
    if (!desc) {
      const store = await storeRepository.getByCode(storeId);
      return infoMessage(store?.name || "Hot Crush"); // default already ends with the call-to-action
    }
    return `${desc}\n\nReply 1 to arrange an interview + trial shift, or STOP to opt out.`;
  }

  private async onConsent(
    conv: CandidateConversationRow,
    application: ApplicationRow,
    intent: ParsedIntent,
    ctx: FsmContext,
  ): Promise<FsmReply[]> {
    const yes = intent.kind === "yes" || (intent.kind === "choice" && intent.index === 1);
    const no = intent.kind === "no" || (intent.kind === "choice" && intent.index === 2);

    if (no) {
      await candidateConversationRepository.upsertState(conv.store_id, conv.phone, "DONE", {
        ...ctx,
        stage: "consent",
      }, application.id);
      return [{ text: DECLINED_MESSAGE }];
    }
    if (!yes) return [{ text: UNCLEAR_NUDGE }];

    // Consent given -> if role_area already known (from QR APPLY-<store>-<area>), skip the ask.
    if (application.role_area) {
      return this.advanceToSlots(conv, application, { ...ctx, roleArea: application.role_area });
    }
    await candidateConversationRepository.upsertState(
      conv.store_id,
      conv.phone,
      "AWAITING_INTERVIEW_CONFIRM",
      { ...ctx, stage: "role_area" },
      application.id,
    );
    return [{ text: roleAreaPrompt() }];
  }

  private async onRoleArea(
    conv: CandidateConversationRow,
    application: ApplicationRow,
    intent: ParsedIntent,
    ctx: FsmContext,
  ): Promise<FsmReply[]> {
    if (intent.kind !== "choice") return [{ text: UNCLEAR_NUDGE }];
    const roleArea: RoleArea = intent.index === 2 ? "BOH" : "FOH";
    return this.advanceToSlots(conv, application, { ...ctx, roleArea });
  }

  /** Persist role area, advance app new->contacting, mirror to Lark, then offer interview slots. */
  private async advanceToSlots(
    conv: CandidateConversationRow,
    application: ApplicationRow,
    ctx: FsmContext,
  ): Promise<FsmReply[]> {
    const roleArea = ctx.roleArea!;
    const store = await storeRepository.getByCode(conv.store_id);
    const slots = deriveSlots(store);

    // Application: stage new -> contacting; ensure role_area is set.
    if (application.stage === "new") {
      await applicationRepository.advanceStage(application.id, "contacting");
    }
    const appWithArea: ApplicationRow = { ...application, role_area: roleArea, stage: "contacting" };

    // Mirror to Lark: create/patch the candidate row with 应聘类型 + 来源渠道 + first-contact date.
    await larkRecruitmentService
      .upsertCandidateRow(appWithArea, {
        当前阶段: "①联系约面",
        应聘类型: ROLE_AREA[roleArea],
        来源渠道: "招聘平台",
        firstContactDate: new Date().toISOString(),
      })
      .catch(() => null);

    await candidateConversationRepository.upsertState(
      conv.store_id,
      conv.phone,
      "AWAITING_INTERVIEW_CONFIRM",
      { ...ctx, stage: "slots", roleArea, offeredSlots: slots },
      application.id,
    );
    return [{ text: slotsPrompt(slots) }];
  }

  private async onSlots(
    conv: CandidateConversationRow,
    application: ApplicationRow,
    intent: ParsedIntent,
    ctx: FsmContext,
  ): Promise<FsmReply[]> {
    const slots = ctx.offeredSlots ?? DEFAULT_SLOTS;
    if (intent.kind === "reschedule") {
      return [{ text: slotsPrompt(slots) }];
    }
    if (intent.kind !== "choice") return [{ text: UNCLEAR_NUDGE }];

    const chosenSlot = slots[intent.index - 1];
    if (!chosenSlot) return [{ text: slotsPrompt(slots) }];

    await candidateConversationRepository.upsertState(
      conv.store_id,
      conv.phone,
      "AWAITING_INTERVIEW_CONFIRM",
      { ...ctx, stage: "readback", chosenSlot },
      application.id,
    );
    return [{ text: readBackPrompt(chosenSlot, ctx.roleArea!) }];
  }

  private async onReadBack(
    conv: CandidateConversationRow,
    application: ApplicationRow,
    intent: ParsedIntent,
    ctx: FsmContext,
  ): Promise<FsmReply[]> {
    // Option 2 (or reschedule) => back to slot selection.
    if (intent.kind === "reschedule" || (intent.kind === "choice" && intent.index === 2)) {
      const slots = ctx.offeredSlots ?? DEFAULT_SLOTS;
      await candidateConversationRepository.upsertState(
        conv.store_id,
        conv.phone,
        "AWAITING_INTERVIEW_CONFIRM",
        { ...ctx, stage: "slots" },
        application.id,
      );
      return [{ text: slotsPrompt(slots) }];
    }
    const confirm = intent.kind === "yes" || (intent.kind === "choice" && intent.index === 1);
    if (!confirm) return [{ text: UNCLEAR_NUDGE }];

    const slot = ctx.chosenSlot!;
    const roleArea = ctx.roleArea!;

    // Persist the booking: appointment(kind='interview') + advance app -> first_interview + Lark mirror.
    await appointmentRepository.create(conv.store_id, application.id, "interview", {
      role_area: roleArea,
      scheduled_for: this.slotToTimestamp(slot),
      status: "proposed",
    });
    await applicationRepository.advanceStage(application.id, "first_interview");

    const appBooked: ApplicationRow = {
      ...application,
      role_area: roleArea,
      stage: "first_interview",
    };
    await larkRecruitmentService
      .writeStageTransition(appBooked, "first_interview", new Date().toISOString())
      .catch(() => false);

    await candidateConversationRepository.upsertState(
      conv.store_id,
      conv.phone,
      "INTERVIEW_SCHEDULED",
      { ...ctx, stage: "readback" },
      application.id,
    );
    return [{ text: bookedMessage(slot) }];
  }

  // ---- trial scheduling sub-flow (entered by the interview-pass manager flow) ----

  /**
   * Public entry called by the interview-pass manager flow (pre-router). Derives trial-shift slots,
   * persists the conversation at stage 'trial_slots' (state TRIAL_SCHEDULED's precursor AWAITING_TRIAL_CONFIRM),
   * and returns the English trial-slots prompt for the caller to sendMessage to the candidate. The
   * candidate's reply then re-enters the FSM at 'trial_slots'.
   */
  async startTrialScheduling(
    conv: CandidateConversationRow,
    application: ApplicationRow,
  ): Promise<FsmReply[]> {
    const ctx = (conv.context || {}) as FsmContext;
    const roleArea: RoleArea = ctx.roleArea || application.role_area || "FOH";
    const store = await storeRepository.getByCode(conv.store_id);
    const slots = deriveTrialSlots(store, roleArea);
    await candidateConversationRepository.upsertState(
      conv.store_id,
      conv.phone,
      "AWAITING_TRIAL_CONFIRM",
      { ...ctx, stage: "trial_slots", roleArea, trialSlots: slots, unclearCount: 0 },
      application.id,
    );
    return [{ text: trialSlotsPrompt(slots) }];
  }

  private async onTrialSlots(
    conv: CandidateConversationRow,
    application: ApplicationRow,
    intent: ParsedIntent,
    ctx: FsmContext,
  ): Promise<FsmReply[]> {
    const slots = ctx.trialSlots ?? DEFAULT_SLOTS;
    if (intent.kind === "reschedule") {
      return [{ text: trialSlotsPrompt(slots) }];
    }
    if (intent.kind !== "choice") return [{ text: UNCLEAR_NUDGE }];

    const chosenTrialSlot = slots[intent.index - 1];
    if (!chosenTrialSlot) return [{ text: trialSlotsPrompt(slots) }];

    const roleArea = ctx.roleArea || application.role_area || "FOH";
    const duration: TrialDuration = roleArea === "BOH" ? "4小时" : "1小时";
    await candidateConversationRepository.upsertState(
      conv.store_id,
      conv.phone,
      "AWAITING_TRIAL_CONFIRM",
      { ...ctx, stage: "trial_readback", roleArea, chosenTrialSlot, trialDuration: duration },
      application.id,
    );
    return [{ text: trialReadBackPrompt(chosenTrialSlot, roleArea, duration) }];
  }

  private async onTrialReadBack(
    conv: CandidateConversationRow,
    application: ApplicationRow,
    intent: ParsedIntent,
    ctx: FsmContext,
  ): Promise<FsmReply[]> {
    // Option 2 (or reschedule) => back to trial-slot selection.
    if (intent.kind === "reschedule" || (intent.kind === "choice" && intent.index === 2)) {
      const slots = ctx.trialSlots ?? DEFAULT_SLOTS;
      await candidateConversationRepository.upsertState(
        conv.store_id,
        conv.phone,
        "AWAITING_TRIAL_CONFIRM",
        { ...ctx, stage: "trial_slots" },
        application.id,
      );
      return [{ text: trialSlotsPrompt(slots) }];
    }
    const confirm = intent.kind === "yes" || (intent.kind === "choice" && intent.index === 1);
    if (!confirm) return [{ text: UNCLEAR_NUDGE }];

    const slot = ctx.chosenTrialSlot!;
    const roleArea = ctx.roleArea || application.role_area || "FOH";
    const duration: TrialDuration = ctx.trialDuration ?? (roleArea === "BOH" ? "4小时" : "1小时");

    // Book the trial: appointment(kind='trial') with a REAL scheduled_for so the 23:00 digest finds it.
    await appointmentRepository.create(conv.store_id, application.id, "trial", {
      role_area: roleArea,
      scheduled_for: this.slotToTimestamp(slot),
      trial_duration: duration,
      status: "proposed",
    });
    await applicationRepository.advanceStage(application.id, "trial");

    const appTrial: ApplicationRow = { ...application, role_area: roleArea, stage: "trial" };
    await larkRecruitmentService
      .writeStageTransition(appTrial, "trial", new Date().toISOString())
      .catch(() => false);
    // Stamp 试工时长 (bot-owned at booking time).
    if (application.lark_record_id) {
      await larkRecruitmentService
        .writeChefFields(conv.store_id, application.lark_record_id, { trialDuration: duration })
        .catch(() => false);
    }

    await candidateConversationRepository.upsertState(
      conv.store_id,
      conv.phone,
      "TRIAL_SCHEDULED",
      { ...ctx, stage: "trial_readback", chosenTrialSlot: slot, trialDuration: duration },
      application.id,
    );
    return [{ text: trialBookedMessage(slot) }];
  }

  // ---- offer decision + hire (candidate accepts the owner-approved offer) ----

  /**
   * Public entry called by the offer-approval manager flow (pre-router) after the owner approves an
   * offer. Persists the conversation at stage 'offer_decision' and returns the English offer message for
   * the caller to sendMessage. The candidate's reply re-enters the FSM at 'offer_decision'.
   */
  async sendOffer(
    conv: CandidateConversationRow,
    application: ApplicationRow,
    offer: { offerId: string; position: string; salary: string },
  ): Promise<FsmReply[]> {
    const ctx = (conv.context || {}) as FsmContext;
    await candidateConversationRepository.upsertState(
      conv.store_id,
      conv.phone,
      "POST_TRIAL",
      {
        ...ctx,
        stage: "offer_decision",
        offerId: offer.offerId,
        offerPosition: offer.position,
        offerSalary: offer.salary,
        unclearCount: 0,
      },
      application.id,
    );
    return [{ text: offerMessage(offer.position, offer.salary) }];
  }

  private async onOfferDecision(
    conv: CandidateConversationRow,
    application: ApplicationRow,
    intent: ParsedIntent,
    ctx: FsmContext,
  ): Promise<FsmReply[]> {
    const accept = intent.kind === "yes" || (intent.kind === "choice" && intent.index === 1);
    const questions = intent.kind === "choice" && intent.index === 2;

    if (questions) {
      await applicationRepository.setContactStatus(application.id, "needs_manual");
      await this.notifyManagerHumanNeeded(conv.store_id, conv.phone, application);
      await candidateConversationRepository.upsertState(
        conv.store_id,
        conv.phone,
        "POST_TRIAL",
        { ...ctx, stage: "offer_decision" },
        application.id,
      );
      return [{ text: OFFER_QUESTIONS_MESSAGE }];
    }
    if (!accept) return [{ text: UNCLEAR_NUDGE }];

    // Accept -> hire: mark offer accepted, create/flip employee row, link + advance + mirror Lark.
    if (ctx.offerId) await offerRepository.setStatus(ctx.offerId, "accepted");

    let emp = application.phone ? await employeeRepository.findByPhone(application.phone) : null;
    if (!emp) {
      emp = await employeeRepository.create({
        name: application.name || application.phone || "(candidate)",
        phone: application.phone,
        source: "recruitment",
        store_id: application.store_id,
        job_title: application.position_code,
        department: application.role_area,
        status: "hired",
        hired_at: new Date().toISOString(),
      });
    } else {
      await employeeRepository.updateStatus(emp.id, "hired", { hired_at: new Date().toISOString() });
    }
    if (emp) await applicationRepository.linkEmployee(application.id, emp.id);
    await applicationRepository.advanceStage(application.id, "hired");

    const appHired: ApplicationRow = { ...application, stage: "hired" };
    await larkRecruitmentService
      .writeStageTransition(appHired, "hired", new Date().toISOString())
      .catch(() => false);

    await candidateConversationRepository.upsertState(
      conv.store_id,
      conv.phone,
      "DONE",
      { ...ctx, stage: "offer_decision" },
      application.id,
    );
    return [{ text: HIRED_MESSAGE }];
  }

  /**
   * Convert a human slot label ("Mon 16:00") into a real ISO TIMESTAMPTZ at the NEXT occurrence of that
   * weekday + time in Asia/Kuala_Lumpur. Unparseable labels return undefined (preserves the prior NULL
   * contract — the label stays in context for a manager to confirm). A concrete instant is what activates
   * the 23:00 trial digest, which queries kind='trial' by scheduled_for.
   */
  private slotToTimestamp(slot: string): string | undefined {
    const m = slot.trim().match(/([a-z]{3,})[^\d]*(\d{1,2}):(\d{2})/i);
    if (!m) return undefined;
    const dow = DOW[m[1].slice(0, 3).toLowerCase()];
    if (dow === undefined) return undefined;
    const hh = Number(m[2]);
    const mm = Number(m[3]);
    if (hh > 23 || mm > 59) return undefined;

    const now = dayjs().tz(KL_TZ);
    let d = now.hour(hh).minute(mm).second(0).millisecond(0);
    // Advance to the next matching weekday; if it's today but already passed, jump a week.
    let add = (dow - d.day() + 7) % 7;
    if (add === 0 && d.isBefore(now)) add = 7;
    d = d.add(add, "day");
    return d.toDate().toISOString();
  }

  /** 3-strike unclear: flag for a human + notify the store manager so they can take over. */
  private async notifyManagerHumanNeeded(
    storeId: string,
    phone: string,
    application: ApplicationRow,
  ): Promise<void> {
    try {
      await applicationRepository.setContactStatus(application.id, "needs_manual");
      const manager = await userRepository.getByRoleAndStore("store_manager", storeId);
      if (!manager?.phone) return;
      const client = getWhatsAppClient();
      if (!client.info) return; // not ready; skip silently
      const msg =
        `⚠️ Candidate ${application.name || phone} (${phone}) could not be understood after 3 tries ` +
        `and needs a human. Please follow up.`;
      await client.sendMessage(`${manager.phone}@c.us`, msg);
    } catch (err) {
      logger.warn("candidate-fsm: failed to notify manager of human handoff", { error: String(err) });
    }
  }
}

export const candidateFsm = new CandidateFsm();
