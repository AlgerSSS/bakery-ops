// recruitment-funnel.test.ts
//
// Unit tests for the PURE logic of the QR-poster recruitment funnel:
//   (a) recruitment-vocab STAGE_TO_LARK / LARK_TO_STAGE round-trip + all 11 站位 present
//   (b) candidate-fsm transitions (consent, role choice, slot pick, read-back, STOP, 3x-unclear handoff)
//   (c) recruitment-pre-router priority order (manager-reply > existing-application > APPLY-token > null)
//   (d) outbound.config governance math (daily cap, business-hours gate, STOP regex)
//
// The DB / Lark / WhatsApp layers are mocked (vi.mock) following the existing unit-test style — no real
// network or DB. Mocked modules are referenced by the SAME specifier the source files import them by, so
// vitest hoists the mock onto the same module instance the SUT receives.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks for every external dependency the FSM + pre-router touch.
// Paths match the import specifiers in candidate-fsm.ts / recruitment-pre-router.ts exactly.
// ---------------------------------------------------------------------------

vi.mock("@/modules/data/repositories/candidate-conversation.repository", () => ({
  candidateConversationRepository: {
    touchInbound: vi.fn().mockResolvedValue(undefined),
    markOptedOut: vi.fn().mockResolvedValue(undefined),
    upsertState: vi.fn().mockResolvedValue(null),
    getByPhone: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/modules/data/repositories/application.repository", () => ({
  applicationRepository: {
    advanceStage: vi.fn().mockResolvedValue(undefined),
    setContactStatus: vi.fn().mockResolvedValue(undefined),
    setPosition: vi.fn().mockResolvedValue(undefined),
    findByPhone: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
    createOrGet: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/modules/data/repositories/offer.repository", () => ({
  offerRepository: {
    draft: vi.fn().mockResolvedValue({ id: "offer_1" }),
    approve: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/data/repositories/appointment.repository", () => ({
  appointmentRepository: {
    create: vi.fn().mockResolvedValue({ id: "appt_1" }),
    confirm: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/data/repositories/store.repository", () => ({
  storeRepository: {
    getByCode: vi.fn().mockResolvedValue(null),
    listActive: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/modules/data/repositories/user.repository", () => ({
  userRepository: {
    getByRoleAndStore: vi.fn().mockResolvedValue(null),
    getByUserId: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/modules/data/repositories/job-opening.repository", () => ({
  jobOpeningRepository: {
    upsertQrPoster: vi.fn().mockResolvedValue({ id: "open_1" }),
  },
}));

vi.mock("@/modules/data/repositories/trial.repository", () => ({
  trialRepository: {
    recordResult: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/modules/domain/lark/lark-recruitment.service", () => ({
  larkRecruitmentService: {
    upsertCandidateRow: vi.fn().mockResolvedValue("rec_1"),
    writeStageTransition: vi.fn().mockResolvedValue(true),
    writeChefFields: vi.fn().mockResolvedValue(true),
    writeInterviewConclusion: vi.fn().mockResolvedValue(true),
    readSuggestedSalary: vi.fn().mockResolvedValue("2200"),
  },
}));

vi.mock("@/modules/domain/ai/ai-provider", () => ({
  aiProvider: {
    // Default: anything not caught by the deterministic fastParse classifies as unclear.
    chatCompletion: vi.fn().mockResolvedValue('{"kind":"unclear"}'),
  },
}));

vi.mock("@/modules/channel/whatsapp/whatsapp.client", () => ({
  getWhatsAppClient: vi.fn(() => ({ info: null, sendMessage: vi.fn().mockResolvedValue(undefined) })),
  sendTextTo: vi.fn().mockResolvedValue({ ok: true, chatId: "x", resolved: true }),
}));

vi.mock("@/modules/domain/recruitment/digest/digest-binding.store", () => ({
  findBindingByPhone: vi.fn().mockReturnValue(null),
  clearBinding: vi.fn(),
  putBinding: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks (vitest hoists vi.mock above these regardless of order,
// but keeping SUT imports here makes intent clear).
// ---------------------------------------------------------------------------

import {
  STAGE_TO_LARK,
  LARK_TO_STAGE,
  POSITIONS,
  ROLE_AREA,
  type ApplicationStage,
} from "@/modules/domain/recruitment/recruitment-vocab";
import {
  STOP_REGEX,
  DAILY_SEND_CAP,
  withinBusinessHours,
  localHour,
} from "@/modules/channel/whatsapp/outbound.config";
import { CandidateFsm } from "@/modules/domain/recruitment/intake/candidate-fsm";
import { RecruitmentPreRouter } from "@/modules/domain/recruitment/intake/recruitment-pre-router";

import { candidateConversationRepository } from "@/modules/data/repositories/candidate-conversation.repository";
import { applicationRepository } from "@/modules/data/repositories/application.repository";
import { appointmentRepository } from "@/modules/data/repositories/appointment.repository";
import { offerRepository } from "@/modules/data/repositories/offer.repository";
import { storeRepository } from "@/modules/data/repositories/store.repository";
import { userRepository } from "@/modules/data/repositories/user.repository";
import { jobOpeningRepository } from "@/modules/data/repositories/job-opening.repository";
import { trialRepository } from "@/modules/data/repositories/trial.repository";
import { larkRecruitmentService } from "@/modules/domain/lark/lark-recruitment.service";
import { candidateFsm } from "@/modules/domain/recruitment/intake/candidate-fsm";
import { findBindingByPhone, clearBinding, putBinding } from "@/modules/domain/recruitment/digest/digest-binding.store";
import { sendTextTo } from "@/modules/channel/whatsapp/whatsapp.client";
import type { CandidateConversationRow } from "@/modules/data/repositories/candidate-conversation.repository";
import type { ApplicationRow } from "@/modules/data/repositories/application.repository";
import type { ChannelMessage } from "@/modules/shared/types/channel.types";

// ---------------------------------------------------------------------------
// Test fixtures.
// ---------------------------------------------------------------------------

function makeConv(over: Partial<CandidateConversationRow> = {}): CandidateConversationRow {
  return {
    id: "conv_1",
    store_id: "pavilion",
    application_id: "app_1",
    phone: "60123456789",
    state: "AWAITING_INTERVIEW_CONFIRM",
    context: { stage: "consent", unclearCount: 0 },
    opted_out: false,
    ...over,
  } as CandidateConversationRow;
}

function makeApp(over: Partial<ApplicationRow> = {}): ApplicationRow {
  return {
    id: "app_1",
    store_id: "pavilion",
    phone: "60123456789",
    name: "Test Candidate",
    contact_status: "ready",
    stage: "new",
    created_at: "2026-06-19T00:00:00Z",
    updated_at: "2026-06-19T00:00:00Z",
    ...over,
  } as ApplicationRow;
}

function makeMsg(over: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    channel: "whatsapp",
    messageId: "m1",
    conversationId: "c1",
    phone: "60123456789",
    text: "hello",
    timestamp: "2026-06-19T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-apply default resolved values cleared by clearAllMocks.
  (storeRepository.getByCode as ReturnType<typeof vi.fn>).mockResolvedValue({
    store_code: "pavilion",
    name: "Pavilion",
    interview_windows: { Mon: ["10:00"], Tue: ["14:00"] },
  });
  (storeRepository.listActive as ReturnType<typeof vi.fn>).mockResolvedValue([
    { store_code: "pavilion", name: "Pavilion", interview_windows: {} },
  ]);
  (jobOpeningRepository.upsertQrPoster as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "open_1" });
  (applicationRepository.createOrGet as ReturnType<typeof vi.fn>).mockResolvedValue(makeApp());
  (candidateConversationRepository.upsertState as ReturnType<typeof vi.fn>).mockResolvedValue(makeConv());
  (appointmentRepository.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "appt_1" });
  (larkRecruitmentService.upsertCandidateRow as ReturnType<typeof vi.fn>).mockResolvedValue("rec_1");
  (larkRecruitmentService.writeStageTransition as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (findBindingByPhone as ReturnType<typeof vi.fn>).mockReturnValue(null);
  // Reset cross-test leakage of the existing-candidate lookup (no conversation/application by default).
  (candidateConversationRepository.getByPhone as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (applicationRepository.findByPhone as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (applicationRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (offerRepository.draft as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "offer_1" });
  (larkRecruitmentService.writeChefFields as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (larkRecruitmentService.writeInterviewConclusion as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (larkRecruitmentService.readSuggestedSalary as ReturnType<typeof vi.fn>).mockResolvedValue("2200");
});

// ===========================================================================
// (a) recruitment-vocab — stage mapping round-trip + 11 stations
// ===========================================================================

describe("recruitment-vocab: stage mapping", () => {
  it("STAGE_TO_LARK -> LARK_TO_STAGE round-trips for every Lark-mapped stage", () => {
    for (const [stage, larkOption] of Object.entries(STAGE_TO_LARK)) {
      if (larkOption === null) continue; // null-mapped stages (new/opted_out/no_show) are not reversible
      expect(LARK_TO_STAGE[larkOption]).toBe(stage);
    }
  });

  it("LARK_TO_STAGE -> STAGE_TO_LARK round-trips for every Lark option", () => {
    for (const [larkOption, stage] of Object.entries(LARK_TO_STAGE)) {
      expect(STAGE_TO_LARK[stage as ApplicationStage]).toBe(larkOption);
    }
  });

  it("exactly the three terminals new/opted_out/no_show map to null", () => {
    const nullStages = Object.entries(STAGE_TO_LARK)
      .filter(([, v]) => v === null)
      .map(([k]) => k)
      .sort();
    expect(nullStages).toEqual(["new", "no_show", "opted_out"]);
  });

  it("LARK_TO_STAGE has no entry for any null-mapped stage", () => {
    expect(Object.values(LARK_TO_STAGE)).not.toContain("new");
    expect(Object.values(LARK_TO_STAGE)).not.toContain("opted_out");
    expect(Object.values(LARK_TO_STAGE)).not.toContain("no_show");
  });

  it("all 11 站位 present: 5 FOH + 6 BOH, verbatim, no duplicates", () => {
    expect(POSITIONS.FOH).toHaveLength(5);
    expect(POSITIONS.BOH).toHaveLength(6);
    const all = [...POSITIONS.FOH, ...POSITIONS.BOH];
    expect(all).toHaveLength(11);
    expect(new Set(all).size).toBe(11); // no duplicates
    // verbatim spot-checks (incl. the · separator)
    expect(POSITIONS.FOH).toContain("前场·收银");
    expect(POSITIONS.BOH).toContain("后厨·丹麦");
    expect(POSITIONS.FOH.every((p) => p.startsWith("前场·"))).toBe(true);
    expect(POSITIONS.BOH.every((p) => p.startsWith("后厨·"))).toBe(true);
  });

  it("ROLE_AREA maps FOH/BOH to the verbatim Lark 应聘类型 options", () => {
    expect(ROLE_AREA.FOH).toBe("前场");
    expect(ROLE_AREA.BOH).toBe("后厨");
  });
});

// ===========================================================================
// (b) candidate-fsm transitions
// ===========================================================================

describe("candidate-fsm: QR happy path", () => {
  const fsm = new CandidateFsm();

  it("consent YES (role_area unknown) -> asks role area, stays AWAITING", async () => {
    const conv = makeConv({ context: { stage: "consent", unclearCount: 0 } });
    const app = makeApp({ stage: "new", role_area: undefined });
    const replies = await fsm.handle(conv, app, "1");
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toMatch(/前场|Front of house/);
    const lastUpsert = (candidateConversationRepository.upsertState as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastUpsert?.[3]).toMatchObject({ stage: "role_area" });
  });

  it("consent NO -> declined message, conversation set DONE, app NOT advanced", async () => {
    const conv = makeConv({ context: { stage: "consent", unclearCount: 0 } });
    const app = makeApp({ stage: "new" });
    const replies = await fsm.handle(conv, app, "2");
    expect(replies[0].text).toMatch(/No problem|没关系/);
    const lastUpsert = (candidateConversationRepository.upsertState as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastUpsert?.[2]).toBe("DONE");
    expect(applicationRepository.advanceStage).not.toHaveBeenCalled();
  });

  it("role choice 前场 (1) -> advances app new->contacting, mirrors Lark, offers slots", async () => {
    const conv = makeConv({ context: { stage: "role_area", unclearCount: 0 } });
    const app = makeApp({ stage: "new", role_area: undefined });
    const replies = await fsm.handle(conv, app, "1");
    expect(applicationRepository.advanceStage).toHaveBeenCalledWith("app_1", "contacting");
    expect(larkRecruitmentService.upsertCandidateRow).toHaveBeenCalledTimes(1);
    const larkFields = (larkRecruitmentService.upsertCandidateRow as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(larkFields.应聘类型).toBe("前场");
    expect(replies[0].text).toMatch(/interview time|面试时间/);
  });

  it("role choice 后厨 (2) -> Lark 应聘类型 = 后厨", async () => {
    const conv = makeConv({ context: { stage: "role_area", unclearCount: 0 } });
    const app = makeApp({ stage: "new", role_area: undefined });
    await fsm.handle(conv, app, "2");
    const larkFields = (larkRecruitmentService.upsertCandidateRow as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(larkFields.应聘类型).toBe("后厨");
  });

  it("slot pick -> read-back confirm prompt with chosen slot persisted", async () => {
    const offeredSlots = ["Mon 10:00", "Tue 14:00"];
    const conv = makeConv({
      context: { stage: "slots", roleArea: "FOH", offeredSlots, unclearCount: 0 },
    });
    const app = makeApp({ stage: "contacting", role_area: "FOH" });
    const replies = await fsm.handle(conv, app, "2");
    expect(replies[0].text).toContain("Tue 14:00");
    expect(replies[0].text).toMatch(/Confirm|确认/);
    const lastUpsert = (candidateConversationRepository.upsertState as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastUpsert?.[3]).toMatchObject({ stage: "readback", chosenSlot: "Tue 14:00" });
  });

  it("read-back confirm (1) -> books appointment, advances app->first_interview, INTERVIEW_SCHEDULED", async () => {
    const conv = makeConv({
      context: { stage: "readback", roleArea: "FOH", chosenSlot: "Mon 10:00", offeredSlots: ["Mon 10:00"], unclearCount: 0 },
    });
    const app = makeApp({ stage: "contacting", role_area: "FOH" });
    const replies = await fsm.handle(conv, app, "1");
    expect(appointmentRepository.create).toHaveBeenCalledWith(
      "pavilion",
      "app_1",
      "interview",
      expect.objectContaining({ role_area: "FOH", status: "proposed" }),
    );
    expect(applicationRepository.advanceStage).toHaveBeenCalledWith("app_1", "first_interview");
    expect(larkRecruitmentService.writeStageTransition).toHaveBeenCalled();
    const lastUpsert = (candidateConversationRepository.upsertState as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastUpsert?.[2]).toBe("INTERVIEW_SCHEDULED");
    expect(replies[0].text).toMatch(/Booked|已预约/);
  });

  it("read-back 'choose another' (2) -> returns to slots stage", async () => {
    const conv = makeConv({
      context: { stage: "readback", roleArea: "FOH", chosenSlot: "Mon 10:00", offeredSlots: ["Mon 10:00", "Tue 14:00"], unclearCount: 0 },
    });
    const app = makeApp({ stage: "contacting", role_area: "FOH" });
    const replies = await fsm.handle(conv, app, "2");
    expect(appointmentRepository.create).not.toHaveBeenCalled();
    expect(replies[0].text).toMatch(/interview time|面试时间/);
    const lastUpsert = (candidateConversationRepository.upsertState as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastUpsert?.[3]).toMatchObject({ stage: "slots" });
  });
});

describe("candidate-fsm: terminal + safety transitions", () => {
  const fsm = new CandidateFsm();

  it("STOP at any stage -> markOptedOut + app stage opted_out + opt-out message", async () => {
    const conv = makeConv({ context: { stage: "slots", roleArea: "FOH", offeredSlots: ["Mon 10:00"], unclearCount: 0 } });
    const app = makeApp({ stage: "contacting" });
    const replies = await fsm.handle(conv, app, "STOP");
    expect(candidateConversationRepository.markOptedOut).toHaveBeenCalledWith("pavilion", "60123456789");
    expect(applicationRepository.advanceStage).toHaveBeenCalledWith("app_1", "opted_out");
    expect(replies[0].text).toMatch(/opted out|退订/);
  });

  it("中文 STOP synonym 退订 also opts out", async () => {
    const conv = makeConv({ context: { stage: "consent", unclearCount: 0 } });
    const app = makeApp({ stage: "new" });
    await fsm.handle(conv, app, "退订");
    expect(candidateConversationRepository.markOptedOut).toHaveBeenCalled();
    expect(applicationRepository.advanceStage).toHaveBeenCalledWith("app_1", "opted_out");
  });

  it("already opted-out conversation -> silent (no reply, no repo writes beyond touchInbound)", async () => {
    const conv = makeConv({ opted_out: true, state: "OPTED_OUT" });
    const app = makeApp();
    const replies = await fsm.handle(conv, app, "hello again");
    expect(replies).toEqual([]);
    expect(candidateConversationRepository.markOptedOut).not.toHaveBeenCalled();
    expect(applicationRepository.advanceStage).not.toHaveBeenCalled();
  });

  it("3 consecutive unclear -> human handoff message + contact_status needs_manual", async () => {
    const app = makeApp({ stage: "consent" as ApplicationStage });
    // 1st unclear (count 0 -> 1): nudge
    let conv = makeConv({ context: { stage: "consent", unclearCount: 0 } });
    let replies = await fsm.handle(conv, app, "??? what is this");
    expect(replies[0].text).toMatch(/please reply|请直接回复/i);
    expect(applicationRepository.setContactStatus).not.toHaveBeenCalled();

    // 2nd unclear (count 1 -> 2): nudge
    conv = makeConv({ context: { stage: "consent", unclearCount: 1 } });
    replies = await fsm.handle(conv, app, "still confused");
    expect(replies[0].text).toMatch(/please reply|请直接回复/i);
    expect(applicationRepository.setContactStatus).not.toHaveBeenCalled();

    // 3rd unclear (count 2 -> 3): handoff
    conv = makeConv({ context: { stage: "consent", unclearCount: 2 } });
    replies = await fsm.handle(conv, app, "huh");
    expect(replies[0].text).toMatch(/team member|工作人员/);
    expect(applicationRepository.setContactStatus).toHaveBeenCalledWith("app_1", "needs_manual");
  });

  it("a clear reply resets the unclear streak (count back to 0)", async () => {
    const conv = makeConv({ context: { stage: "consent", unclearCount: 2 } });
    const app = makeApp({ stage: "new", role_area: undefined });
    await fsm.handle(conv, app, "1"); // clear YES
    const lastUpsert = (candidateConversationRepository.upsertState as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastUpsert?.[3]).toMatchObject({ unclearCount: 0 });
  });
});

// ===========================================================================
// (c) recruitment-pre-router priority order
// ===========================================================================

describe("recruitment-pre-router: priority order", () => {
  const router = new RecruitmentPreRouter();

  it("non-matching message (unknown phone, no token, no binding) -> null", async () => {
    const res = await router.tryRoute(makeMsg({ text: "where is my order?" }));
    expect(res).toBeNull();
  });

  it("empty phone or text -> null", async () => {
    expect(await router.tryRoute(makeMsg({ phone: "" }))).toBeNull();
    expect(await router.tryRoute(makeMsg({ text: "" }))).toBeNull();
  });

  it("APPLY token -> creates opening+application and starts FSM (consent prompt)", async () => {
    const res = await router.tryRoute(makeMsg({ text: "APPLY-PAVILION-FOH" }));
    expect(jobOpeningRepository.upsertQrPoster).toHaveBeenCalledWith("pavilion", "FOH", "APPLY-PAVILION-FOH");
    expect(applicationRepository.createOrGet).toHaveBeenCalled();
    expect(res).not.toBeNull();
    expect(res![0].type).toBe("text");
    expect(res![0].text).toMatch(/hiring QR|招聘二维码/);
  });

  it("manager-reply beats APPLY-token: a binding short-circuits before QR handling", async () => {
    // Sender has a pending digest binding AND (contrived) sends an APPLY token.
    (findBindingByPhone as ReturnType<typeof vi.fn>).mockReturnValue({
      storeId: "pavilion",
      recipientPhone: "60123456789",
      recipientUserId: "u1",
      recipientRole: "store_manager",
      localDate: "2026-06-19",
      options: [],
      createdAt: "2026-06-19T00:00:00Z",
    });
    // userRepository.getByRoleAndStore returns null in default mock -> manager branch returns null,
    // but it must have CONSULTED the binding first (proving (a) is evaluated before (c)).
    await router.tryRoute(makeMsg({ text: "APPLY-PAVILION-FOH" }));
    expect(findBindingByPhone).toHaveBeenCalledWith("60123456789");
  });

  it("manager-reply: valid binding + matching manager + good reply -> confirms and clears binding", async () => {
    (findBindingByPhone as ReturnType<typeof vi.fn>).mockReturnValue({
      storeId: "pavilion",
      recipientPhone: "60123456789",
      recipientUserId: "u1",
      recipientRole: "kitchen_manager",
      localDate: "2026-06-19",
      options: [
        { optionIndex: 1, appointmentId: "appt_9", applicationId: "app_9", candidateName: "Ali", roleArea: "BOH", larkRecordId: "rec_9" },
      ],
      createdAt: "2026-06-19T00:00:00Z",
    });
    const { userRepository } = await import("@/modules/data/repositories/user.repository");
    (userRepository.getByUserId as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      phone: "60123456789",
    });
    const res = await router.tryRoute(makeMsg({ text: "1 1" })); // trial #1, station #1
    expect(appointmentRepository.confirm).toHaveBeenCalled();
    expect(clearBinding).toHaveBeenCalled();
    expect(res![0].text).toMatch(/Confirmed|已确认/);
    // station #1 for BOH is 后厨·馅料
    expect(res![0].text).toContain("后厨·馅料");
  });

  it("existing-application beats APPLY-token: a known candidate conversation drives the FSM", async () => {
    // No binding; an existing conversation+application exists for this phone.
    (candidateConversationRepository.getByPhone as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeConv({ context: { stage: "consent", unclearCount: 0 } }),
    );
    (applicationRepository.findByPhone as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeApp({ stage: "new", role_area: undefined }),
    );
    // Even though the text is a valid APPLY token, the existing-candidate branch (b) owns it first,
    // so we must NOT create a new opening.
    const res = await router.tryRoute(makeMsg({ text: "APPLY-PAVILION-FOH" }));
    expect(jobOpeningRepository.upsertQrPoster).not.toHaveBeenCalled();
    expect(res).not.toBeNull();
  });

  it("APPLY token for an unknown store -> null (orchestrator handles it)", async () => {
    (storeRepository.getByCode as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await router.tryRoute(makeMsg({ text: "APPLY-NOWHERE-FOH" }));
    expect(res).toBeNull();
    expect(jobOpeningRepository.upsertQrPoster).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// (c2) recruitment-pre-router: the two manager-facing triggers (interview / trial->offer / offer)
// ===========================================================================

describe("recruitment-pre-router: manager triggers by binding.kind", () => {
  const router = new RecruitmentPreRouter();

  /** Wire a pending binding of a given kind + an identity-matching recipient (by userId). */
  function bindManager(over: Partial<{ kind: string; options: unknown[]; recipientRole: string }> = {}) {
    (findBindingByPhone as ReturnType<typeof vi.fn>).mockReturnValue({
      storeId: "pavilion",
      recipientPhone: "60123456789",
      recipientUserId: "u1",
      recipientRole: over.recipientRole ?? "store_manager",
      localDate: "2026-06-19",
      kind: over.kind ?? "trial",
      options: over.options ?? [],
      createdAt: "2026-06-19T00:00:00Z",
    });
    (userRepository.getByUserId as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      phone: "60123456789",
    });
  }

  const oneOption = [
    {
      optionIndex: 1,
      appointmentId: "appt_9",
      applicationId: "app_9",
      candidateName: "Ali",
      roleArea: "FOH",
      larkRecordId: "rec_9",
    },
  ];

  // ---- INTERVIEW ----

  it("interview PASS (1 1) -> writes 通过 to Lark, starts trial scheduling, clears binding", async () => {
    bindManager({ kind: "interview", options: oneOption });
    (applicationRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeApp({ id: "app_9", phone: "60199999999" }));
    (candidateConversationRepository.getByPhone as ReturnType<typeof vi.fn>).mockResolvedValue(makeConv({ id: "conv_9" }));
    const trialSpy = vi.spyOn(candidateFsm, "startTrialScheduling").mockResolvedValue([{ text: "trial slots prompt" }]);

    const res = await router.tryRoute(makeMsg({ text: "1 1" }), true);

    expect(larkRecruitmentService.writeInterviewConclusion).toHaveBeenCalledWith("pavilion", "rec_9", "通过");
    expect(trialSpy).toHaveBeenCalledTimes(1);
    expect(applicationRepository.advanceStage).not.toHaveBeenCalled(); // FSM owns the stage transition
    expect(clearBinding).toHaveBeenCalledWith("pavilion", "60123456789", "2026-06-19", "interview");
    expect(res![0].text).toMatch(/Pass|已通过/);
    trialSpy.mockRestore();
  });

  it("interview REJECT (1 3) -> writes 淘汰, advances application to rejected, no trial scheduling", async () => {
    bindManager({ kind: "interview", options: oneOption });
    const trialSpy = vi.spyOn(candidateFsm, "startTrialScheduling").mockResolvedValue([{ text: "x" }]);

    const res = await router.tryRoute(makeMsg({ text: "1 3" }), true);

    expect(larkRecruitmentService.writeInterviewConclusion).toHaveBeenCalledWith("pavilion", "rec_9", "淘汰");
    expect(applicationRepository.advanceStage).toHaveBeenCalledWith("app_9", "rejected");
    expect(trialSpy).not.toHaveBeenCalled();
    expect(res![0].text).toMatch(/Rejected|已淘汰/);
    trialSpy.mockRestore();
  });

  it("interview BACKUP (1 2) -> writes 备选, advances application to backup_pool", async () => {
    bindManager({ kind: "interview", options: oneOption });
    const res = await router.tryRoute(makeMsg({ text: "1 2" }), true);
    expect(larkRecruitmentService.writeInterviewConclusion).toHaveBeenCalledWith("pavilion", "rec_9", "备选");
    expect(applicationRepository.advanceStage).toHaveBeenCalledWith("app_9", "backup_pool");
    expect(res![0].text).toMatch(/Backup|备选/);
  });

  // ---- REJECT / BACKUP polite close-out (F13) ----

  it("interview REJECT with warm conversation -> farewell sent to candidate + conversation DONE", async () => {
    bindManager({ kind: "interview", options: oneOption });
    (applicationRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeApp({ id: "app_9", phone: "60199999999" }),
    );
    (candidateConversationRepository.getByPhone as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeConv({ id: "conv_9", phone: "60199999999" }),
    );

    const res = await router.tryRoute(makeMsg({ text: "1 3" }), true);

    expect(applicationRepository.advanceStage).toHaveBeenCalledWith("app_9", "rejected");
    expect(sendTextTo).toHaveBeenCalledWith("60199999999", expect.stringContaining("未能录用"));
    const lastUpsert = (candidateConversationRepository.upsertState as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastUpsert?.[2]).toBe("DONE");
    expect(res![0].text).toMatch(/Rejected|已淘汰/);
  });

  it("interview BACKUP with warm conversation -> 候补名单 farewell + conversation DONE", async () => {
    bindManager({ kind: "interview", options: oneOption });
    (applicationRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeApp({ id: "app_9", phone: "60199999999" }),
    );
    (candidateConversationRepository.getByPhone as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeConv({ id: "conv_9", phone: "60199999999" }),
    );

    const res = await router.tryRoute(makeMsg({ text: "1 2" }), true);

    expect(applicationRepository.advanceStage).toHaveBeenCalledWith("app_9", "backup_pool");
    expect(sendTextTo).toHaveBeenCalledWith("60199999999", expect.stringContaining("候补名单"));
    const lastUpsert = (candidateConversationRepository.upsertState as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastUpsert?.[2]).toBe("DONE");
    expect(res![0].text).toMatch(/Backup|备选/);
  });

  it("interview REJECT without a warm conversation -> stage advanced, NO candidate message", async () => {
    bindManager({ kind: "interview", options: oneOption });
    // findById / getByPhone stay at their default null -> candidateFromApplicationId returns null.
    const res = await router.tryRoute(makeMsg({ text: "1 3" }), true);

    expect(applicationRepository.advanceStage).toHaveBeenCalledWith("app_9", "rejected");
    expect(sendTextTo).not.toHaveBeenCalled();
    expect(candidateConversationRepository.upsertState).not.toHaveBeenCalled();
    expect(res![0].text).toMatch(/Rejected|已淘汰/);
  });

  // ---- TRIAL RESULT -> OFFER ----

  it("trial '1 1 1' (建议录用) -> records recommendation, drafts offer, puts offer binding for owner", async () => {
    bindManager({ kind: "trial", options: oneOption });
    (userRepository.getByRoleAndStore as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "owner1", phone: "60188888888" });

    const res = await router.tryRoute(makeMsg({ text: "1 1 1" }), true);

    // recommendation recorded on the trial row + mirrored to Lark
    const recCall = (trialRepository.recordResult as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(recCall?.[2]).toMatchObject({ recommendation: "建议录用" });
    // offer drafted with the Lark-read salary
    expect(offerRepository.draft).toHaveBeenCalledTimes(1);
    // owner binding persisted (kind 'offer', honest recipientRole 'owner')
    const putArg = (putBinding as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(putArg).toMatchObject({ kind: "offer", recipientRole: "owner", recipientPhone: "60188888888" });
    expect(putArg.options[0]).toMatchObject({ offerId: "offer_1", applicationId: "app_9" });
    expect(res![0].text).toMatch(/Confirmed|已确认/);
  });

  it("trial '1 1 3' (延长试工) -> records recommendation but drafts NO offer", async () => {
    bindManager({ kind: "trial", options: oneOption });
    const res = await router.tryRoute(makeMsg({ text: "1 1 3" }), true);
    const recCall = (trialRepository.recordResult as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(recCall?.[2]).toMatchObject({ recommendation: "延长试工" });
    expect(offerRepository.draft).not.toHaveBeenCalled();
    expect(putBinding).not.toHaveBeenCalled();
    expect(res![0].text).toMatch(/Confirmed|已确认/);
  });

  it("legacy trial '1 1' (no recommendation) -> confirms station, drafts no offer (back-compat)", async () => {
    bindManager({ kind: "trial", options: oneOption });
    const res = await router.tryRoute(makeMsg({ text: "1 1" }), true);
    expect(appointmentRepository.confirm).toHaveBeenCalled();
    const recCall = (trialRepository.recordResult as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(recCall?.[2].recommendation).toBeUndefined();
    expect(offerRepository.draft).not.toHaveBeenCalled();
    expect(res![0].text).toMatch(/Confirmed|已确认/);
  });

  // ---- OFFER APPROVAL (owner) ----

  it("offer '1' (send) -> approves offer, calls sendOffer, clears the offer binding", async () => {
    bindManager({
      kind: "offer",
      recipientRole: "owner",
      options: [
        { optionIndex: 1, appointmentId: "appt_9", applicationId: "app_9", candidateName: "Ali", roleArea: "FOH", larkRecordId: "rec_9", offerId: "offer_1" },
      ],
    });
    (applicationRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue(makeApp({ id: "app_9", phone: "60199999999", position_code: "前场·收银" }));
    (candidateConversationRepository.getByPhone as ReturnType<typeof vi.fn>).mockResolvedValue(makeConv({ id: "conv_9" }));
    const offerSpy = vi.spyOn(candidateFsm, "sendOffer").mockResolvedValue([{ text: "offer message" }]);

    const res = await router.tryRoute(makeMsg({ text: "1" }), true);

    expect(offerRepository.approve).toHaveBeenCalledWith("offer_1", "u1");
    expect(offerSpy).toHaveBeenCalledTimes(1);
    expect(offerSpy.mock.calls[0][2]).toMatchObject({ offerId: "offer_1", position: "前场·收银" });
    expect(clearBinding).toHaveBeenCalledWith("pavilion", "60123456789", "2026-06-19", "offer");
    expect(res![0].text).toMatch(/Offer sent|已向候选人发送/);
    offerSpy.mockRestore();
  });

  it("offer '2' (edit salary) -> does NOT approve/send, keeps binding, instructs owner", async () => {
    bindManager({
      kind: "offer",
      recipientRole: "owner",
      options: [
        { optionIndex: 1, appointmentId: "appt_9", applicationId: "app_9", candidateName: "Ali", roleArea: "FOH", larkRecordId: "rec_9", offerId: "offer_1" },
      ],
    });
    const offerSpy = vi.spyOn(candidateFsm, "sendOffer").mockResolvedValue([{ text: "x" }]);

    const res = await router.tryRoute(makeMsg({ text: "2" }), true);

    expect(offerRepository.approve).not.toHaveBeenCalled();
    expect(offerSpy).not.toHaveBeenCalled();
    expect(clearBinding).not.toHaveBeenCalled();
    expect(res![0].text).toMatch(/建议薪资|Lark/);
    offerSpy.mockRestore();
  });
});

// ===========================================================================
// (d) outbound.config governance math
// ===========================================================================

describe("outbound.config: governance", () => {
  it("DAILY_SEND_CAP defaults to a positive conservative cap", () => {
    expect(DAILY_SEND_CAP).toBeGreaterThan(0);
    expect(Number.isFinite(DAILY_SEND_CAP)).toBe(true);
  });

  it("withinBusinessHours gates on the 09:00-21:00 window (KL time)", () => {
    // Build a Date whose KL local hour we control by checking localHour first, then asserting the gate
    // agrees with the window edges using fixed UTC instants.
    // 2026-06-19 02:00 UTC = 10:00 KL (inside).
    const inside = new Date("2026-06-19T02:00:00Z");
    expect(localHour(inside)).toBe(10);
    expect(withinBusinessHours(inside)).toBe(true);

    // 2026-06-19 16:00 UTC = 00:00 KL (next day midnight, outside).
    const outside = new Date("2026-06-19T16:00:00Z");
    expect(localHour(outside)).toBe(0);
    expect(withinBusinessHours(outside)).toBe(false);

    // 21:00 KL is the exclusive upper bound -> outside. 13:00 UTC = 21:00 KL.
    const upperEdge = new Date("2026-06-19T13:00:00Z");
    expect(localHour(upperEdge)).toBe(21);
    expect(withinBusinessHours(upperEdge)).toBe(false);

    // 09:00 KL is the inclusive lower bound -> inside. 01:00 UTC = 09:00 KL.
    const lowerEdge = new Date("2026-06-19T01:00:00Z");
    expect(localHour(lowerEdge)).toBe(9);
    expect(withinBusinessHours(lowerEdge)).toBe(true);
  });

  it("STOP_REGEX matches EN/中文/BM opt-out keywords (case-insensitive, leading)", () => {
    for (const t of ["stop", "STOP", "Stop now", "unsubscribe", "opt out", "opt-out", "退订", "停止", "berhenti", "tak nak"]) {
      expect(STOP_REGEX.test(t)).toBe(true);
    }
  });

  it("STOP_REGEX does NOT match ordinary replies / numbers", () => {
    for (const t of ["1", "2", "yes", "stopwatch is cool", "I want to apply", "好"]) {
      expect(STOP_REGEX.test(t)).toBe(false);
    }
  });
});
