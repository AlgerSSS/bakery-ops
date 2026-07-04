// recruitment-vocab.ts
//
// Single source of truth for the owner's REAL Lark hiring process (base 试工流程跟踪).
// Every Chinese string below is VERBATIM (including the 🟦/🟩 emoji on field names and the
// ①–⑤ stage prefixes) — it must match the Lark base exactly, because the automation reads/writes
// these field names and select options directly via the Lark CLI.
//
// DB enum <-> Lark mapping lives in STAGE_TO_LARK / LARK_TO_STAGE. The application_stage enum
// (migration 013) is the canonical state; the Lark 当前阶段 select is the mirror.

/**
 * application_stage DB enum (migration 013) as a TS union — the canonical funnel state.
 * Kept here so this file stays the single source of truth for the stage vocabulary.
 */
export type ApplicationStage =
  | "new"
  | "contacting"
  | "first_interview"
  | "trial"
  | "post_trial_interview"
  | "feedback"
  | "hired"
  | "rejected"
  | "backup_pool"
  | "opted_out"
  | "no_show";

/**
 * Logical key -> the verbatim Lark field name (incl. emoji prefix) on the 试工流程跟踪 table.
 * Use these constants everywhere instead of hard-coding the Chinese strings.
 */
export const LARK_FIELDS = {
  // 🟦 HR-owned fields
  stage: "🟦HR｜当前阶段",
  applicationType: "🟦HR｜应聘类型",
  position: "🟦HR｜岗位/站位",
  sourceChannel: "🟦HR｜来源渠道",
  interviewConclusion: "🟦HR｜初面结论",
  candidateName: "🟦HR｜候选人姓名",
  phone: "🟦HR｜电话号码",
  firstContactDate: "🟦HR｜首次联系日期",
  firstInterviewDate: "🟦HR｜初面日期",
  trialDate: "🟦HR｜试工日期",
  onboardDate: "🟦HR｜入职日期",
  hrOwner: "🟦HR｜HR负责人",
  hrNote: "🟦HR｜备注",
  expectedSalary: "🟦HR｜期望薪资",

  // 🟩 Chef/Store-owned fields
  recommendation: "🟩厨/店｜录用建议",
  trialDuration: "🟩厨/店｜试工时长",
  redLine: "🟩厨/店｜触犯红线",
  suggestedSalary: "🟩厨/店｜建议薪资",
  trialFeedback: "🟩厨/店｜试工反馈",
  trialScore: "🟩厨/店｜试工评分",
  attitudeSummary: "🟩厨/店｜工作态度小结",
  evaluator: "🟩厨/店｜评估负责人",
} as const;

/**
 * application_stage DB enum -> Lark 🟦HR｜当前阶段 select option.
 * 'new' is pre-contact (no Lark stage yet); the two automation terminals (opted_out / no_show) have
 * no Lark counterpart and map to null.
 */
export const STAGE_TO_LARK: Record<ApplicationStage, string | null> = {
  new: null,
  contacting: "①联系约面",
  first_interview: "②初面",
  trial: "③试工",
  post_trial_interview: "④试工后面试",
  feedback: "⑤反馈跟进",
  hired: "已入职",
  rejected: "已淘汰",
  backup_pool: "备选池",
  opted_out: null,
  no_show: null,
} as const;

/**
 * Reverse of STAGE_TO_LARK: Lark 当前阶段 option -> application_stage enum value.
 * Only the options that have a stage are present (null-mapped stages are not reversible).
 */
export const LARK_TO_STAGE: Record<string, ApplicationStage> = {
  "①联系约面": "contacting",
  "②初面": "first_interview",
  "③试工": "trial",
  "④试工后面试": "post_trial_interview",
  "⑤反馈跟进": "feedback",
  "已入职": "hired",
  "已淘汰": "rejected",
  "备选池": "backup_pool",
} as const;

/** role_area code -> Lark 🟦HR｜应聘类型 option. FOH = 前场 (front of house), BOH = 后厨 (back of house). */
export const ROLE_AREA = {
  FOH: "前场",
  BOH: "后厨",
} as const;

/**
 * 🟦HR｜岗位/站位 options (the position_code values), VERBATIM, grouped by role area.
 * FOH = 5 stations, BOH = 6 stations.
 */
export const POSITIONS = {
  FOH: ["前场·陈列", "前场·切包打包", "前场·水吧", "前场·试吃", "前场·收银"],
  BOH: ["后厨·馅料", "后厨·整形", "后厨·冷加工", "后厨·烤炉", "后厨·搅拌", "后厨·丹麦"],
} as const;

/** 🟩厨/店｜录用建议 options. recommendation field on trials/offers. */
export const RECOMMENDATION = ["建议录用", "有条件录用", "延长试工", "不建议录用"] as const;

/** 🟩厨/店｜试工时长 options. Maps appointments.trial_duration. */
export const TRIAL_DURATIONS = ["1小时", "4小时"] as const;

/** 🟦HR｜来源渠道 options. */
export const SOURCE_CHANNELS = ["内部推荐", "招聘平台", "自荐", "其他"] as const;

/** 🟦HR｜初面结论 options. */
export const INTERVIEW_CONCLUSIONS = ["通过", "备选", "淘汰"] as const;
