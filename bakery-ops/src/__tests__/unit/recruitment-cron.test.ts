// F11/F12: 面试试工当日提醒 + JobStreet 申请人拉取（人工联系版）的跳过/去重/统计逻辑
// （IMPROVEMENT-PLAN.md F11/F12）
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendTextToMock = vi.fn();
const isClientConnectedMock = vi.fn();
vi.mock("@/modules/channel/whatsapp/whatsapp.client", () => ({
  isClientConnected: (...args: unknown[]) => isClientConnectedMock(...args),
  sendTextTo: (...args: unknown[]) => sendTextToMock(...args),
}));

const hasPushLogMock = vi.fn();
const recordPushLogMock = vi.fn();
vi.mock("@/modules/domain/notifications/push-log", () => ({
  hasPushLog: (...args: unknown[]) => hasPushLogMock(...args),
  recordPushLog: (...args: unknown[]) => recordPushLogMock(...args),
}));

const listActiveMock = vi.fn();
const getManagerAndChefMock = vi.fn();
vi.mock("@/modules/data/repositories/store.repository", () => ({
  storeRepository: {
    listActive: (...args: unknown[]) => listActiveMock(...args),
    getManagerAndChef: (...args: unknown[]) => getManagerAndChefMock(...args),
  },
}));

const getByStoreAndDateMock = vi.fn();
vi.mock("@/modules/data/repositories/appointment.repository", () => ({
  appointmentRepository: {
    getByStoreAndDate: (...args: unknown[]) => getByStoreAndDateMock(...args),
  },
}));

const findByIdMock = vi.fn();
const findByExternalIdMock = vi.fn();
const createOrGetMock = vi.fn();
vi.mock("@/modules/data/repositories/application.repository", () => ({
  applicationRepository: {
    findById: (...args: unknown[]) => findByIdMock(...args),
    findByExternalId: (...args: unknown[]) => findByExternalIdMock(...args),
    createOrGet: (...args: unknown[]) => createOrGetMock(...args),
  },
}));

const getByUserIdMock = vi.fn();
vi.mock("@/modules/data/repositories/user.repository", () => ({
  userRepository: { getByUserId: (...args: unknown[]) => getByUserIdMock(...args) },
}));

const hasValidSessionMock = vi.fn();
vi.mock("@/modules/domain/recruitment/connectors/jobstreet-login", () => ({
  hasValidSession: (...args: unknown[]) => hasValidSessionMock(...args),
}));

const fetchActiveJobsMock = vi.fn();
const fetchApplicantsMock = vi.fn();
vi.mock("@/modules/domain/recruitment/jobs/jobstreet.active-jobs", () => ({
  JobStreetActiveJobs: class {
    fetchActiveJobs = (...args: unknown[]) => fetchActiveJobsMock(...args);
    fetchApplicants = (...args: unknown[]) => fetchApplicantsMock(...args);
  },
}));

import {
  runAppointmentReminder,
  formatApptTime,
  buildAppointmentReminderText,
} from "../../modules/domain/recruitment/appointment-reminder.service";
import {
  pullDailyApplicants,
  buildIntakeSummaryText,
} from "../../modules/domain/recruitment/jobs/applicant-intake.service";
import { localDate } from "../../modules/channel/whatsapp/outbound.config";

const STORE = { store_code: "PAVILION", name: "Pavilion 趁热" };

const confirmedAppt = (overrides: Record<string, unknown> = {}) => ({
  id: "appt-1",
  store_id: STORE.store_code,
  application_id: "app-1",
  kind: "interview",
  scheduled_for: "2026-07-02 10:30:00+08",
  status: "confirmed",
  created_at: "2026-07-01 09:00:00+08",
  ...overrides,
});

const warmApplication = (overrides: Record<string, unknown> = {}) => ({
  id: "app-1",
  store_id: STORE.store_code,
  phone: "60123456789",
  name: "Aisyah",
  contact_status: "ready",
  stage: "first_interview",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OWNER_WHATSAPP = "60000000000";
  isClientConnectedMock.mockResolvedValue(true);
  sendTextToMock.mockResolvedValue({ ok: true, chatId: "x@c.us", resolved: true });
  hasPushLogMock.mockResolvedValue(false);
  recordPushLogMock.mockResolvedValue(undefined);
  listActiveMock.mockResolvedValue([STORE]);
  getManagerAndChefMock.mockResolvedValue({ managerUserId: "u-mgr", headChefUserId: null });
  getByUserIdMock.mockResolvedValue({ user_id: "u-mgr", phone: "60111111111" });
  getByStoreAndDateMock.mockResolvedValue([]);
  findByIdMock.mockResolvedValue(warmApplication());
  hasValidSessionMock.mockReturnValue(true);
  findByExternalIdMock.mockResolvedValue(null);
  createOrGetMock.mockImplementation(async (input: Record<string, unknown>) => ({
    id: "new-row",
    ...input,
  }));
  fetchActiveJobsMock.mockResolvedValue([]);
  fetchApplicantsMock.mockResolvedValue([]);
});

describe("F11 formatApptTime 时间格式化", () => {
  it("KL 时区 timestamptz 文本 → HH:mm", () => {
    expect(formatApptTime("2026-07-02 10:30:00+08")).toBe("10:30");
  });

  it("UTC 时间戳换算为 KL 当地时间", () => {
    expect(formatApptTime("2026-07-02 02:30:00+00")).toBe("10:30");
  });

  it("解析失败时原样返回", () => {
    expect(formatApptTime("下午三点")).toBe("下午三点");
  });
});

describe("F11 buildAppointmentReminderText 模板", () => {
  it("interview 用「面试」，含时间/门店/回 1 确认", () => {
    const text = buildAppointmentReminderText("interview", "10:30", "Pavilion 趁热");
    expect(text).toContain("10:30");
    expect(text).toContain("Pavilion 趁热");
    expect(text).toContain("面试");
    expect(text).toContain("回复 1 确认到场");
  });

  it("trial 用「试工」", () => {
    expect(buildAppointmentReminderText("trial", "14:00", "Pavilion 趁热")).toContain("试工");
  });
});

describe("F11 runAppointmentReminder 跳过逻辑", () => {
  it("happy path：confirmed interview → 发送并写幂等日志", async () => {
    getByStoreAndDateMock.mockImplementation(async (_s: string, _d: string, kind: string) =>
      kind === "interview" ? [confirmedAppt()] : [],
    );

    await runAppointmentReminder();

    expect(sendTextToMock).toHaveBeenCalledTimes(1);
    const [to, text] = sendTextToMock.mock.calls[0];
    expect(to).toBe("60123456789");
    expect(text).toContain("10:30");
    expect(recordPushLogMock).toHaveBeenCalledWith("appt_reminder", "60123456789", localDate());
  });

  it("非 confirmed 状态不发送", async () => {
    getByStoreAndDateMock.mockResolvedValue([confirmedAppt({ status: "proposed" })]);
    await runAppointmentReminder();
    expect(sendTextToMock).not.toHaveBeenCalled();
  });

  it("scheduled_for 为 NULL 时跳过", async () => {
    getByStoreAndDateMock.mockImplementation(async (_s: string, _d: string, kind: string) =>
      kind === "trial" ? [confirmedAppt({ kind: "trial", scheduled_for: undefined })] : [],
    );
    await runAppointmentReminder();
    expect(sendTextToMock).not.toHaveBeenCalled();
  });

  it("候选人 needs_manual（非暖号码）时跳过", async () => {
    getByStoreAndDateMock.mockImplementation(async (_s: string, _d: string, kind: string) =>
      kind === "interview" ? [confirmedAppt()] : [],
    );
    findByIdMock.mockResolvedValue(warmApplication({ contact_status: "needs_manual" }));
    await runAppointmentReminder();
    expect(sendTextToMock).not.toHaveBeenCalled();
  });

  it("当天已发过（push log 命中）时跳过", async () => {
    getByStoreAndDateMock.mockImplementation(async (_s: string, _d: string, kind: string) =>
      kind === "interview" ? [confirmedAppt()] : [],
    );
    hasPushLogMock.mockResolvedValue(true);
    await runAppointmentReminder();
    expect(sendTextToMock).not.toHaveBeenCalled();
  });

  it("发送失败时不写幂等日志", async () => {
    getByStoreAndDateMock.mockImplementation(async (_s: string, _d: string, kind: string) =>
      kind === "interview" ? [confirmedAppt()] : [],
    );
    sendTextToMock.mockResolvedValue({ ok: false, error: "boom" });
    await runAppointmentReminder();
    expect(recordPushLogMock).not.toHaveBeenCalled();
  });

  it("WhatsApp 未连接时整轮跳过", async () => {
    isClientConnectedMock.mockResolvedValue(false);
    await runAppointmentReminder();
    expect(getByStoreAndDateMock).not.toHaveBeenCalled();
  });
});

describe("F12 buildIntakeSummaryText 模板", () => {
  it("含人数与名单", () => {
    const text = buildIntakeSummaryText(["Ali", "Mei"]);
    expect(text).toContain("新增 2 位申请人");
    expect(text).toContain("Ali、Mei");
    expect(text).toContain("人工联系");
  });
});

describe("F12 pullDailyApplicants 去重/统计", () => {
  const job = (id: string, status = "active") => ({
    jobId: id,
    platform: "JobStreet",
    title: "Service Crew",
    location: "KL",
    status,
    applicantCount: 1,
  });
  const applicant = (id: string, name: string, phone?: string) => ({
    applicantId: id,
    platform: "JobStreet",
    jobId: "j1",
    name,
    phone,
  });

  it("会话过期：不抓取、正常返回", async () => {
    hasValidSessionMock.mockReturnValue(false);
    await pullDailyApplicants();
    expect(fetchActiveJobsMock).not.toHaveBeenCalled();
    expect(sendTextToMock).not.toHaveBeenCalled();
  });

  it("新申请人落库为 needs_manual，并推店长汇总", async () => {
    fetchActiveJobsMock.mockResolvedValue([job("j1"), job("j2", "expired")]);
    fetchApplicantsMock.mockResolvedValue([
      applicant("ext-1", "Ali", "60123450001"),
      applicant("ext-2", "Mei"),
    ]);

    await pullDailyApplicants();

    // 只抓 active 职位
    expect(fetchApplicantsMock).toHaveBeenCalledTimes(1);
    expect(fetchApplicantsMock).toHaveBeenCalledWith("j1");

    expect(createOrGetMock).toHaveBeenCalledTimes(2);
    expect(createOrGetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        store_id: STORE.store_code,
        external_applicant_id: "ext-1",
        contact_status: "needs_manual",
        source: "jobstreet",
      }),
    );

    expect(sendTextToMock).toHaveBeenCalledTimes(1);
    const [to, text] = sendTextToMock.mock.calls[0];
    expect(to).toBe("60111111111"); // 店长
    expect(text).toContain("新增 2 位申请人");
    expect(text).toContain("Ali、Mei");
    expect(recordPushLogMock).toHaveBeenCalledWith("jobstreet_pull", "60111111111", localDate());
  });

  it("external_applicant_id 已存在时去重、不重复落库", async () => {
    fetchActiveJobsMock.mockResolvedValue([job("j1")]);
    fetchApplicantsMock.mockResolvedValue([applicant("ext-1", "Ali")]);
    findByExternalIdMock.mockResolvedValue({ id: "old-row", external_applicant_id: "ext-1" });

    await pullDailyApplicants();

    expect(createOrGetMock).not.toHaveBeenCalled();
    expect(sendTextToMock).not.toHaveBeenCalled(); // 新增 0 不推送
  });

  it("电话命中已有申请（WhatsApp 进线同一人）时不计新增", async () => {
    fetchActiveJobsMock.mockResolvedValue([job("j1")]);
    fetchApplicantsMock.mockResolvedValue([applicant("ext-1", "Ali", "60123456789")]);
    // createOrGet 按电话去重返回已有行，external_applicant_id 与本次不同
    createOrGetMock.mockResolvedValue(warmApplication({ external_applicant_id: null }));

    await pullDailyApplicants();

    expect(createOrGetMock).toHaveBeenCalledTimes(1);
    expect(sendTextToMock).not.toHaveBeenCalled();
  });

  it("当天已推过店长（push log 命中）时不重复推", async () => {
    fetchActiveJobsMock.mockResolvedValue([job("j1")]);
    fetchApplicantsMock.mockResolvedValue([applicant("ext-1", "Ali")]);
    hasPushLogMock.mockResolvedValue(true);

    await pullDailyApplicants();

    expect(createOrGetMock).toHaveBeenCalledTimes(1); // 落库照常
    expect(sendTextToMock).not.toHaveBeenCalled();
  });

  it("店长未配置电话时兜底 OWNER_WHATSAPP", async () => {
    getByUserIdMock.mockResolvedValue({ user_id: "u-mgr", phone: null });
    fetchActiveJobsMock.mockResolvedValue([job("j1")]);
    fetchApplicantsMock.mockResolvedValue([applicant("ext-1", "Ali")]);

    await pullDailyApplicants();

    expect(sendTextToMock).toHaveBeenCalledWith("60000000000", expect.stringContaining("Ali"));
  });
});
