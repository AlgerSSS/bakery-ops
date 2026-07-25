// recruitment-pre-router.ts
//
// Pre-router invoked from the orchestrator's UserNotRegisteredError catch, BEFORE the KOL/marketing
// fallback. It gives the recruitment funnel first refusal on inbound messages from numbers that aren't
// registered ops users. It returns ChannelResponse[] when it OWNS the message, or null to let the
// orchestrator continue its existing (unchanged) behaviour.
//
// Fixed priority (first match wins):
//   (a) Manager/chef 1-tap reply: sender phone is a known store_manager/kitchen_manager AND there is a
//       pending trial digest awaiting their numbered reply -> apply it (appointment.confirm +
//       trial.recordResult + Lark 🟩 fields).
//   (b) Existing candidate: sender phone matches an existing application / candidate_conversation ->
//       drive the candidate FSM.
//   (c) QR token: text matches /^APPLY-([A-Z_]+)-(FOH|BOH)$/i -> create job_opening(qr)+application and
//       start the FSM.
//   else -> null (orchestrator continues unchanged).

import type { ChannelMessage, ChannelResponse } from "../../../shared/types";
import { logger } from "../../../shared/logger";
import { storeRepository } from "../../../data/repositories/store.repository";
import { userRepository } from "../../../data/repositories/user.repository";
import { applicationRepository, type ApplicationRow } from "../../../data/repositories/application.repository";
import {
  candidateConversationRepository,
  type CandidateConversationRow,
} from "../../../data/repositories/candidate-conversation.repository";
import { jobOpeningRepository, type RoleArea } from "../../../data/repositories/job-opening.repository";
import { appointmentRepository } from "../../../data/repositories/appointment.repository";
import { trialRepository, type Recommendation } from "../../../data/repositories/trial.repository";
import { offerRepository } from "../../../data/repositories/offer.repository";
import { larkRecruitmentService } from "../../lark/lark-recruitment.service";
import { candidateFsm } from "./candidate-fsm";
import { POSITIONS, RECOMMENDATION, INTERVIEW_CONCLUSIONS } from "../recruitment-vocab";
import { getWhatsAppClient, sendTextTo } from "../../../channel/whatsapp/whatsapp.client";
import { localDate } from "../../../channel/whatsapp/outbound.config";
import {
  findBindingByPhone,
  clearBinding,
  putBinding,
  type DigestBinding,
  type DigestOption,
} from "../digest/digest-binding.store";

const QR_RE = /^APPLY-([A-Z_]+)-(FOH|BOH)$/i;

function toResponses(replies: { text: string }[]): ChannelResponse[] {
  return replies.map((r) => ({ type: "text" as const, text: r.text }));
}

export class RecruitmentPreRouter {
  async tryRoute(msg: ChannelMessage, isRegisteredOps = false): Promise<ChannelResponse[] | null> {
    const phone = (msg.phone || "").trim();
    const text = (msg.text || "").trim();
    if (!phone || !text) return null;

    // (a) Manager/chef pending digest reply. Managers ARE registered ops users, so this branch must
    //     run regardless. It short-circuits to null instantly (file-based binding lookup) when there is
    //     no pending digest, so normal ops traffic is unaffected.
    const managerReply = await this.tryManagerReply(phone, text);
    if (managerReply) return managerReply;

    // (b)+(c) Candidate FSM / QR onboarding only apply to NON-ops numbers. A registered ops user is
    //     never a job candidate, so skip these DB-touching lookups for them — this keeps ops messages
    //     off the recruitment hot path and avoids hijacking normal commands.
    if (isRegisteredOps) return null;

    // (b) Existing candidate -> drive FSM.
    const candidateReply = await this.tryExistingCandidate(phone, text);
    if (candidateReply) return candidateReply;

    // (c) QR token -> create opening/application + start FSM.
    const qrReply = await this.tryQrToken(phone, text);
    if (qrReply) return qrReply;

    return null;
  }

  /**
   * Cold stranger (no ops identity, no candidate record yet): send a friendly English invite and
   * create a prospect application + conversation, so their next reply (1) enters the same funnel as a
   * contacted candidate. Called from the orchestrator's unregistered-number fallback.
   */
  async greetStranger(msg: ChannelMessage): Promise<ChannelResponse[] | null> {
    const phone = (msg.phone || "").trim();
    if (!phone) return null;

    const stores = await storeRepository.listActive();
    const store = stores[0]; // default cold inbound to the (single) active retail store
    if (!store) return null;

    // Don't re-greet someone already in the funnel.
    const existingConv = await candidateConversationRepository.getByPhone(store.store_code, phone);
    if (existingConv) return null;

    const application = await applicationRepository.createOrGet({
      store_id: store.store_code,
      phone,
      contact_status: "ready",
      source: "whatsapp_inbound",
    });
    if (!application) return null;

    await candidateConversationRepository.upsertState(
      store.store_code,
      phone,
      "AWAITING_INTERVIEW_CONFIRM",
      { stage: "outbound_intro", roleArea: application.role_area, unclearCount: 0 },
      application.id,
    );
    return toResponses([{ text: strangerGreeting(store.name) }]);
  }

  // ---- (a) manager / chef 1-tap reply --------------------------------------

  private async tryManagerReply(phone: string, text: string): Promise<ChannelResponse[] | null> {
    const binding = findBindingByPhone(phone);
    if (!binding) return null;

    // Identity: match the sender to the binding's intended recipient by userId. This is stricter than a
    // role lookup and works for the 'offer' kind too (recipient is the owner, whose role can't be
    // re-derived from the binding's recipientRole the way manager/chef can).
    const user = await userRepository.getByUserId(binding.recipientUserId);
    if (!user || user.phone !== phone) return null;

    switch (binding.kind ?? "trial") {
      case "interview":
        return this.handleInterviewReply(binding, user.userId, text);
      case "offer":
        return this.handleOfferReply(binding, user.userId, text);
      case "trial":
      default:
        return this.handleTrialReply(binding, user.userId, text);
    }
  }

  /** Resolve the candidate's conversation + application from a binding's applicationId. */
  private async candidateFromApplicationId(
    applicationId: string,
  ): Promise<{ conv: CandidateConversationRow; application: ApplicationRow } | null> {
    const application = await applicationRepository.findById(applicationId);
    if (!application?.phone) return null;
    const conv = await candidateConversationRepository.getByPhone(application.store_id, application.phone);
    if (!conv) return null;
    return { conv, application };
  }

  // ---- (a-1) trial result: station + optional recommendation -> maybe draft offer --------

  private async handleTrialReply(
    binding: DigestBinding,
    confirmedByUserId: string,
    text: string,
  ): Promise<ChannelResponse[] | null> {
    const parsed = parseTrialReply(text);
    if (!parsed) {
      return toResponses([
        {
          text:
            `Please reply "<trial #> <station #>", e.g. "1 2" (add a result 1-4 to record 录用建议). / ` +
            `请回复"<试工编号> <岗位编号>"，例如"1 2"（可加录用建议 1-4）。`,
        },
      ]);
    }

    const option = binding.options.find((o) => o.optionIndex === parsed.trialIndex);
    if (!option) {
      return toResponses([{ text: `No trial #${parsed.trialIndex} in tonight's list. / 列表中没有该编号。` }]);
    }

    const area: RoleArea = option.roleArea ?? (binding.recipientRole === "kitchen_manager" ? "BOH" : "FOH");
    const stations = POSITIONS[area];
    const positionCode = stations[parsed.stationIndex - 1];
    if (!positionCode) {
      return toResponses([{ text: `No station #${parsed.stationIndex}. / 没有该岗位编号。` }]);
    }

    const recommendation: Recommendation | undefined =
      parsed.recIndex !== undefined ? RECOMMENDATION[parsed.recIndex - 1] : undefined;

    await this.applyManagerConfirmation(binding, option, area, positionCode, confirmedByUserId, recommendation);

    let ackTail = "";
    // A 建议录用 / 有条件录用 recommendation drafts an offer and asks the owner to approve it.
    if (recommendation === "建议录用" || recommendation === "有条件录用") {
      const sent = await this.draftOfferAndNotifyOwner(binding, option, area, positionCode);
      ackTail = sent ? ` — offer sent to owner / 已转交老板审批` : "";
    }

    clearBinding(binding.storeId, binding.recipientPhone, binding.localDate, "trial");

    return toResponses([
      {
        text:
          `✅ Confirmed: ${option.candidateName} — ${positionCode}${ackTail}. / ` +
          `已确认：${option.candidateName} — ${positionCode}${ackTail}。`,
      },
    ]);
  }

  /** Confirm the appointment, record the trial station (+ optional recommendation), mirror 🟩 to Lark. */
  private async applyManagerConfirmation(
    binding: DigestBinding,
    option: DigestOption,
    area: RoleArea,
    positionCode: string,
    confirmedByUserId: string,
    recommendation?: Recommendation,
  ): Promise<void> {
    await appointmentRepository.confirm(option.appointmentId, {
      position_code: positionCode,
      role_area: area,
      confirmed_by_user_id: confirmedByUserId,
    });
    await applicationRepository.setPosition(option.applicationId, positionCode);
    await trialRepository.recordResult(binding.storeId, option.appointmentId, {
      position_code: positionCode,
      recommendation,
      decided_by_user_id: confirmedByUserId,
    });

    if (option.larkRecordId) {
      await larkRecruitmentService
        .writeChefFields(binding.storeId, option.larkRecordId, {
          position: positionCode,
          ...(recommendation ? { recommendation } : {}),
        })
        .catch(() => false);
    }
  }

  /**
   * Draft the offer (salary read from Lark 建议薪资 if available) and send the OWNER a 1-tap approval
   * prompt, persisting a kind='offer' binding so their reply is interpreted. Returns true if the prompt
   * was sent (owner resolvable + offer drafted).
   */
  private async draftOfferAndNotifyOwner(
    binding: DigestBinding,
    option: DigestOption,
    area: RoleArea,
    positionCode: string,
  ): Promise<boolean> {
    const suggestedSalary = option.larkRecordId
      ? await larkRecruitmentService.readSuggestedSalary(binding.storeId, option.larkRecordId).catch(() => "")
      : "";
    const offer = await offerRepository.draft(binding.storeId, option.applicationId, {
      position_code: positionCode,
      suggested_salary: suggestedSalary || undefined,
      salary_source: "lark",
    });
    if (!offer) return false;

    const owner = await userRepository.getByRoleAndStore("owner", binding.storeId);
    if (!owner?.phone) return false;

    putBinding({
      storeId: binding.storeId,
      recipientPhone: owner.phone,
      recipientUserId: owner.userId,
      recipientRole: "owner",
      localDate: localDate(),
      kind: "offer",
      options: [
        {
          optionIndex: 1,
          appointmentId: option.appointmentId,
          applicationId: option.applicationId,
          larkRecordId: option.larkRecordId,
          candidateName: option.candidateName,
          roleArea: area,
          offerId: offer.id,
        },
      ],
      createdAt: new Date().toISOString(),
    });

    const salaryLabel = suggestedSalary || "—";
    await getWhatsAppClient()
      .sendMessage(
        `${owner.phone}@c.us`,
        `Offer ${option.candidateName} ${positionCode}: RM${salaryLabel}. Reply 1=Send / 2=edit salary. / ` +
          `录用 ${option.candidateName}（${positionCode}）：RM${salaryLabel}，回复 1=发送 / 2=改薪资。`,
      )
      .catch(() => undefined);
    return true;
  }

  // ---- (a-2) interview result: pass -> trial scheduling; backup/reject -> advance stage ----

  private async handleInterviewReply(
    binding: DigestBinding,
    decidedByUserId: string,
    text: string,
  ): Promise<ChannelResponse[] | null> {
    const parsed = parseInterviewReply(text);
    if (!parsed) {
      return toResponses([
        {
          text:
            `Please reply "<#> <result>", result 1=通过 2=备选 3=淘汰, e.g. "1 1". / ` +
            `请回复"<编号> <结论>"，结论 1=通过 2=备选 3=淘汰，例如"1 1"。`,
        },
      ]);
    }

    const option = binding.options.find((o) => o.optionIndex === parsed.optionIndex);
    if (!option) {
      return toResponses([{ text: `No interview #${parsed.optionIndex} in the list. / 列表中没有该编号。` }]);
    }

    const conclusion = INTERVIEW_CONCLUSIONS[parsed.result - 1]; // 通过 | 备选 | 淘汰
    if (option.larkRecordId) {
      await larkRecruitmentService
        .writeInterviewConclusion(binding.storeId, option.larkRecordId, conclusion)
        .catch(() => false);
    }

    let ack: string;
    if (parsed.result === 1) {
      // 通过 / pass -> start trial scheduling and send the slots prompt to the CANDIDATE.
      const found = await this.candidateFromApplicationId(option.applicationId);
      if (!found) {
        clearBinding(binding.storeId, binding.recipientPhone, binding.localDate, "interview");
        return toResponses([{ text: `Candidate unavailable for ${option.candidateName}. / 候选人不可用。` }]);
      }
      const replies = await candidateFsm.startTrialScheduling(found.conv, found.application);
      if (found.application.phone && replies[0]) {
        await getWhatsAppClient()
          .sendMessage(`${found.application.phone}@c.us`, replies[0].text)
          .catch(() => undefined);
      }
      ack = `✅ Pass — trial scheduling sent to ${option.candidateName}. / 已通过，已向候选人发送试工时间。`;
    } else {
      // 备选 -> backup_pool ; 淘汰 -> rejected. Polite close-out to the CANDIDATE (warm conversation
      // only — candidateFromApplicationId requires an existing candidate_conversation, never cold).
      const stage = parsed.result === 3 ? "rejected" : "backup_pool";
      await applicationRepository.advanceStage(option.applicationId, stage);
      const found = await this.candidateFromApplicationId(option.applicationId);
      if (found?.application.phone) {
        const farewell =
          parsed.result === 3
            ? "感谢您申请趁热，本次未能录用，欢迎关注后续机会。"
            : "已加入候补名单，有机会第一时间联系您。";
        await sendTextTo(found.application.phone, farewell);
        await candidateConversationRepository.upsertState(
          found.conv.store_id, found.conv.phone, "DONE", {}, found.application.id,
        );
      }
      ack =
        parsed.result === 3
          ? `✅ Rejected ${option.candidateName}. / 已淘汰 ${option.candidateName}。`
          : `✅ Backup pool: ${option.candidateName}. / 已加入备选池：${option.candidateName}。`;
    }

    clearBinding(binding.storeId, binding.recipientPhone, binding.localDate, "interview");
    return toResponses([{ text: ack }]);
  }

  // ---- (a-3) offer approval (owner): send the offer to the candidate ----------------------

  private async handleOfferReply(
    binding: DigestBinding,
    approvedByUserId: string,
    text: string,
  ): Promise<ChannelResponse[] | null> {
    const option = binding.options[0];
    if (!option?.offerId) return null;
    const t = text.trim();

    if (t === "2") {
      // Salary stays MANUAL: keep the binding so a later "1" still sends with the fresh Lark value.
      return toResponses([
        {
          text:
            `Update 建议薪资 in Lark for ${option.candidateName}, then reply 1 to send. / ` +
            `在 Lark 修改建议薪资后回复 1 发送。`,
        },
      ]);
    }
    if (t !== "1") {
      return toResponses([
        {
          text:
            `Reply 1 to send the offer, or 2 to edit salary first. / ` +
            `回复 1 发送 Offer，或 2 先修改薪资。`,
        },
      ]);
    }

    const found = await this.candidateFromApplicationId(option.applicationId);
    if (!found) {
      clearBinding(binding.storeId, binding.recipientPhone, binding.localDate, "offer");
      return toResponses([{ text: `Candidate unavailable for ${option.candidateName}. / 候选人不可用。` }]);
    }

    await offerRepository.approve(option.offerId, approvedByUserId);
    const position = found.application.position_code ?? "";
    const salary = option.larkRecordId
      ? await larkRecruitmentService.readSuggestedSalary(binding.storeId, option.larkRecordId).catch(() => "")
      : "";

    const replies = await candidateFsm.sendOffer(found.conv, found.application, {
      offerId: option.offerId,
      position,
      salary,
    });
    if (found.application.phone && replies[0]) {
      await getWhatsAppClient()
        .sendMessage(`${found.application.phone}@c.us`, replies[0].text)
        .catch(() => undefined);
    }

    clearBinding(binding.storeId, binding.recipientPhone, binding.localDate, "offer");
    return toResponses([
      { text: `✅ Offer sent to ${option.candidateName}. / 已向候选人发送 Offer。` },
    ]);
  }

  // ---- (b) existing candidate ---------------------------------------------

  private async tryExistingCandidate(phone: string, text: string): Promise<ChannelResponse[] | null> {
    const found = await this.findCandidate(phone);
    if (found) {
      const { conv, application } = found;
      const replies = await candidateFsm.handle(conv, application, text);
      if (replies.length === 0) return null; // e.g. opted-out: own the message but stay silent
      return toResponses(replies);
    }
    // No conversation yet, but an application may exist (JobStreet/manual outbound — we messaged them
    // first). Start an outbound-initiated conversation so the reply is handled (consent + role already
    // known) instead of falling through to the unknown-number path.
    return this.tryOutboundApplication(phone, text);
  }

  /** First inbound from a candidate we contacted outbound: has an application, no conversation yet. */
  private async tryOutboundApplication(phone: string, text: string): Promise<ChannelResponse[] | null> {
    const stores = await storeRepository.listActive();
    for (const store of stores) {
      const application = await applicationRepository.findByPhone(store.store_code, phone);
      if (!application) continue;
      const conv = await candidateConversationRepository.upsertState(
        store.store_code,
        phone,
        "AWAITING_INTERVIEW_CONFIRM",
        { stage: "outbound_intro", roleArea: application.role_area, unclearCount: 0 },
        application.id,
      );
      if (!conv) return null;
      const replies = await candidateFsm.handle(conv, application, text);
      if (replies.length === 0) return null;
      return toResponses(replies);
    }
    return null;
  }

  /** Look across active stores for an existing conversation (then application) for this phone. */
  private async findCandidate(
    phone: string,
  ): Promise<{ conv: CandidateConversationRow; application: ApplicationRow } | null> {
    const stores = await storeRepository.listActive();
    for (const store of stores) {
      const conv = await candidateConversationRepository.getByPhone(store.store_code, phone);
      if (!conv) continue;
      const application = await applicationRepository.findByPhone(store.store_code, phone);
      if (application) return { conv, application };
    }
    return null;
  }

  // ---- (c) QR token --------------------------------------------------------

  private async tryQrToken(phone: string, text: string): Promise<ChannelResponse[] | null> {
    const m = text.match(QR_RE);
    if (!m) return null;

    const storeToken = m[1].toUpperCase(); // e.g. PAVILION
    const area = m[2].toUpperCase() as RoleArea; // FOH | BOH
    const storeCode = storeToken.toLowerCase(); // store_code is lowercase (e.g. 'pavilion')

    const store = await storeRepository.getByCode(storeCode);
    if (!store) {
      logger.warn("pre-router: QR for unknown store", { storeToken, phone });
      return null; // unknown store -> let orchestrator handle as a normal unknown number
    }

    const qrToken = `APPLY-${storeToken}-${area}`;
    const opening = await jobOpeningRepository.upsertQrPoster(storeCode, area, qrToken);

    const application = await applicationRepository.createOrGet({
      store_id: storeCode,
      job_opening_id: opening?.id,
      phone,
      role_area: area,
      contact_status: "ready",
      source: "qr_poster",
    });
    if (!application) {
      logger.error("pre-router: failed to create QR application", { storeCode, phone });
      return null;
    }

    const conv = await candidateConversationRepository.upsertState(
      storeCode,
      phone,
      "INTAKE",
      {},
      application.id,
    );
    if (!conv) {
      logger.error("pre-router: failed to create candidate conversation", { storeCode, phone });
      return null;
    }

    const replies = await candidateFsm.start(conv, store.name);
    return toResponses(replies);
  }
}

/** Friendly English greeting for a cold stranger who messages the bot directly. */
function strangerGreeting(storeName: string): string {
  return [
    `Hi! Thanks for messaging ${storeName} 🧁`,
    `Are you applying for a job with us? Reply 1 to apply (we'll arrange an interview + trial shift), 2 for more info, or STOP to opt out.`,
  ].join("\n");
}

/**
 * Parse a trial-result reply "<trial#> <station#> [<rec#>]". The recommendation token (1-4 ->
 * 建议录用|有条件录用|延长试工|不建议录用) is OPTIONAL, so the legacy "1 2" (station only) reply still works.
 */
function parseTrialReply(
  text: string,
): { trialIndex: number; stationIndex: number; recIndex?: number } | null {
  const m = text.trim().match(/^(\d{1,2})\D+(\d{1,2})(?:\D+([1-4]))?$/);
  if (!m) return null;
  return {
    trialIndex: Number(m[1]),
    stationIndex: Number(m[2]),
    recIndex: m[3] !== undefined ? Number(m[3]) : undefined,
  };
}

/** Parse an interview-result reply "<#> <result>" where result is 1=通过 2=备选 3=淘汰. */
function parseInterviewReply(text: string): { optionIndex: number; result: 1 | 2 | 3 } | null {
  const m = text.trim().match(/^(\d{1,2})\D+([123])$/);
  if (!m) return null;
  return { optionIndex: Number(m[1]), result: Number(m[2]) as 1 | 2 | 3 };
}

export const recruitmentPreRouter = new RecruitmentPreRouter();
