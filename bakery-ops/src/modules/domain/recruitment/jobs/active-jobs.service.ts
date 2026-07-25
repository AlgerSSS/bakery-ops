import type { ActiveJobsState, ActiveJob, JobApplicant } from "../types";
import type { OutputFile } from "../../../shared/types";
import { JobStreetActiveJobs } from "./jobstreet.active-jobs";
import { fileService } from "../../files/file-service";
import { logger } from "../../../shared/logger";

const jsFetcher = new JobStreetActiveJobs();

export interface ActiveJobsStepResult {
  state: ActiveJobsState;
  messages: string[];
  files?: OutputFile[];
  waitForReply: boolean;
}

/**
 * 交互式查看在招岗位
 *
 * @param currentState 当前步骤状态（续接时）
 * @param userReply 用户回复（续接时）
 */
export async function activeJobsInteractive(
  currentState?: ActiveJobsState,
  userReply?: string,
): Promise<ActiveJobsStepResult> {
  // 首次调用 — 查询岗位列表
  if (!currentState) {
    return stepFetchJobs();
  }

  const reply = (userReply || "").trim();

  switch (currentState.step) {
    case "list_jobs":
      return handleJobSelection(currentState, reply);

    case "list_applicants":
      return handleApplicantAction(currentState, reply);

    default:
      return {
        state: { step: "done" },
        messages: ["流程已结束。"],
        waitForReply: false,
      };
  }
}

// ── Step 1: 查询两个平台的在招岗位 ──

async function stepFetchJobs(): Promise<ActiveJobsStepResult> {
  logger.info("ActiveJobs: fetching active jobs from JobStreet");

  const [jsJobs] = await Promise.allSettled([
    jsFetcher.fetchActiveJobs(),
  ]);

  const allJobs: ActiveJob[] = [];
  if (jsJobs.status === "fulfilled") allJobs.push(...jsJobs.value);

  if (allJobs.length === 0) {
    return {
      state: { step: "done" },
      messages: ["JobStreet 上暂无在招岗位。"],
      waitForReply: false,
    };
  }

  // 按平台分组显示
  const lines: string[] = [];
  const jsGroup = allJobs.filter((j) => j.platform === "JobStreet");
  let idx = 1;

  if (jsGroup.length > 0) {
    lines.push("*JobStreet*");
    for (const job of jsGroup) {
      lines.push(`${idx}. ${job.title} - ${job.location || "未知地点"} (${job.applicantCount} 位申请者)`);
      idx++;
    }
    lines.push("");
  }

  lines.push("");
  lines.push("回复数字查看申请者详情，如 '1'");

  return {
    state: { step: "list_jobs", jobs: allJobs },
    messages: [lines.join("\n")],
    waitForReply: true,
  };
}

// ── Step 2: 用户选择岗位 → 查看申请者 ──

async function handleJobSelection(
  state: ActiveJobsState,
  reply: string,
): Promise<ActiveJobsStepResult> {
  if (!state.jobs || state.jobs.length === 0) {
    return {
      state: { step: "done" },
      messages: ["岗位数据丢失，请重新查询。"],
      waitForReply: false,
    };
  }

  const num = parseInt(reply, 10);
  if (isNaN(num) || num < 1 || num > state.jobs.length) {
    return {
      state,
      messages: [`请回复 1-${state.jobs.length} 之间的数字查看申请者。`],
      waitForReply: true,
    };
  }

  const selectedIndex = num - 1;
  const job = state.jobs[selectedIndex];

  logger.info("ActiveJobs: fetching applicants", { jobId: job.jobId, platform: job.platform });

  const applicants = await jsFetcher.fetchApplicants(job.jobId);

  if (applicants.length === 0) {
    return {
      state: { ...state, step: "list_applicants", selectedJobIndex: selectedIndex, applicants: [] },
      messages: [
        `*${job.title} - ${job.location || ""}* 暂时没有申请者。`,
        "",
        "回复 '返回' 回到岗位列表",
      ],
      waitForReply: true,
    };
  }

  const lines: string[] = [];
  lines.push(`*${job.title} - ${job.location || ""}* 的申请者:`);
  lines.push("");

  for (let i = 0; i < applicants.length; i++) {
    const a = applicants[i];
    const parts = [`${i + 1}. ${a.name}`];
    if (a.currentTitle) parts.push(`- ${a.currentTitle}`);
    if (a.experienceYears) parts.push(`(${a.experienceYears}年经验)`);
    if (a.appliedAt) parts.push(`[${a.appliedAt}]`);
    lines.push(parts.join(" "));
  }

  lines.push("");
  lines.push("回复 '简历 1' 查看候选人档案（教育/技能/经历），'返回' 回到岗位列表");

  return {
    state: {
      ...state,
      step: "list_applicants",
      selectedJobIndex: selectedIndex,
      applicants,
    },
    messages: [lines.join("\n")],
    waitForReply: true,
  };
}

// ── Step 3: 申请者操作（下载简历 / 返回） ──

async function handleApplicantAction(
  state: ActiveJobsState,
  reply: string,
): Promise<ActiveJobsStepResult> {
  const lower = reply.toLowerCase();

  // 返回岗位列表
  if (lower === "返回" || lower === "back" || lower === "回去") {
    return {
      state: { step: "list_jobs", jobs: state.jobs },
      messages: [formatJobList(state.jobs || [])],
      waitForReply: true,
    };
  }

  if (!state.applicants || state.applicants.length === 0) {
    return {
      state: { step: "list_jobs", jobs: state.jobs },
      messages: ["没有申请者数据，已返回岗位列表。", formatJobList(state.jobs || [])],
      waitForReply: true,
    };
  }

  // 解析 "简历 N" 或直接数字
  let applicantIndex = -1;
  const resumeMatch = reply.match(/简历\s*(\d+)/);
  if (resumeMatch) {
    applicantIndex = parseInt(resumeMatch[1], 10) - 1;
  } else {
    const num = parseInt(reply, 10);
    if (!isNaN(num)) applicantIndex = num - 1;
  }

  if (applicantIndex < 0 || applicantIndex >= state.applicants.length) {
    return {
      state,
      messages: [`请回复 '简历 1'-'简历 ${state.applicants.length}' 查看候选人档案，或 '返回' 回到岗位列表。`],
      waitForReply: true,
    };
  }

  const applicant = state.applicants[applicantIndex];
  return getApplicantDetail(state, applicant, applicantIndex);
}

// 下载优先：付费套餐能拿到简历 PDF 原文（→ WhatsApp/Lark 发文件）；
// SEEK express 免费套餐被付费墙拦（canDownloadAttachments=false）时降级为在线档案文本。
async function getApplicantDetail(
  state: ActiveJobsState,
  applicant: JobApplicant,
  applicantIndex: number,
): Promise<ActiveJobsStepResult> {
  if (applicant.hasResumeAttachment) {
    logger.info("ActiveJobs: attempting resume download", { name: applicant.name });
    const dl = await jsFetcher.downloadResume(applicant);
    if (dl) {
      const file = await fileService.saveFile(dl.buffer, dl.fileName, "application/pdf");
      return {
        state,
        messages: [`${applicant.name} 的简历：`],
        files: [file],
        waitForReply: true,
      };
    }
    // 下载失败（付费墙/无有效会话）→ 降级到在线档案
    logger.info("ActiveJobs: resume download unavailable, falling back to profile", { name: applicant.name });
  }
  return showApplicantProfile(state, applicant, applicantIndex);
}

// 展示 SEEK 免费可得的候选人在线档案（教育/技能/工作经历/工作权利）。
async function showApplicantProfile(
  state: ActiveJobsState,
  applicant: JobApplicant,
  applicantIndex: number,
): Promise<ActiveJobsStepResult> {
  logger.info("ActiveJobs: fetching applicant profile", { name: applicant.name, platform: applicant.platform });

  const profile = await jsFetcher.fetchApplicantProfile(applicant.jobId, applicantIndex, applicant);

  if (!profile) {
    return {
      state,
      messages: [
        `${applicant.name} 的档案暂时拉取不到（可能会话过期，请让管理员跑 jobstreet-relogin）。`,
        "回复其他数字查看其他候选人，或 '返回' 回到岗位列表。",
      ],
      waitForReply: true,
    };
  }

  const lines: string[] = [`👤 ${applicant.name} 的候选人档案`];
  if (applicant.currentTitle) lines.push(`当前职位：${applicant.currentTitle}`);
  if (applicant.phone) lines.push(`电话：${applicant.phone}`);
  if (profile.education.length) lines.push(`\n🎓 教育：\n· ${profile.education.join("\n· ")}`);
  if (profile.workHistory.length) lines.push(`\n💼 工作经历：\n· ${profile.workHistory.join("\n· ")}`);
  if (profile.skills.length) lines.push(`\n🛠 技能：${profile.skills.join("、")}`);
  if (profile.rightToWork.length) lines.push(`\n📋 工作权利：${profile.rightToWork.join("、")}`);
  if (profile.nationalities.length) lines.push(`🌏 国籍：${profile.nationalities.join("、")}`);
  if (profile.hasResumeAttachment) {
    lines.push(`\n📎 该候选人上传了简历文件，但下载 PDF 需升级 SEEK 付费套餐；以上在线档案免费可得。`);
  }
  lines.push(`\n回复其他数字查看其他候选人，或 '返回' 回到岗位列表。`);

  return { state, messages: [lines.join("\n")], waitForReply: true };
}

// ── 辅助函数 ──

function formatJobList(jobs: ActiveJob[]): string {
  if (jobs.length === 0) return "暂无在招岗位。";

  const lines: string[] = [];
  const jsGroup = jobs.filter((j) => j.platform === "JobStreet");
  let idx = 1;

  if (jsGroup.length > 0) {
    lines.push("*JobStreet*");
    for (const job of jsGroup) {
      lines.push(`${idx}. ${job.title} - ${job.location || "未知地点"} (${job.applicantCount} 位申请者)`);
      idx++;
    }
    lines.push("");
  }

  lines.push("");
  lines.push("回复数字查看申请者详情，如 '1'");
  return lines.join("\n");
}
