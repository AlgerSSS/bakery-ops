import type { ActiveJobsState, ActiveJob, JobApplicant } from "../types";
import type { OutputFile } from "../../../shared/types";
import { JobStreetActiveJobs } from "./jobstreet.active-jobs";
import { AJobThingActiveJobs } from "./ajobthing.active-jobs";
import { fileService } from "../../files/file-service";
import { logger } from "../../../shared/logger";

const jsFetcher = new JobStreetActiveJobs();
const ajtFetcher = new AJobThingActiveJobs();

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
  logger.info("ActiveJobs: fetching active jobs from both platforms");

  const [jsJobs, ajtJobs] = await Promise.allSettled([
    jsFetcher.fetchActiveJobs(),
    ajtFetcher.fetchActiveJobs(),
  ]);

  const allJobs: ActiveJob[] = [];
  if (jsJobs.status === "fulfilled") allJobs.push(...jsJobs.value);
  if (ajtJobs.status === "fulfilled") allJobs.push(...ajtJobs.value);

  if (allJobs.length === 0) {
    return {
      state: { step: "done" },
      messages: ["两个平台上暂无在招岗位。"],
      waitForReply: false,
    };
  }

  // 按平台分组显示
  const lines: string[] = [];
  const jsGroup = allJobs.filter((j) => j.platform === "JobStreet");
  const ajtGroup = allJobs.filter((j) => j.platform === "AJobThing");
  let idx = 1;

  if (jsGroup.length > 0) {
    lines.push("*JobStreet*");
    for (const job of jsGroup) {
      lines.push(`${idx}. ${job.title} - ${job.location || "未知地点"} (${job.applicantCount} 位申请者)`);
      idx++;
    }
    lines.push("");
  }

  if (ajtGroup.length > 0) {
    lines.push("*AJobThing*");
    for (const job of ajtGroup) {
      lines.push(`${idx}. ${job.title} - ${job.location || "未知地点"} (${job.applicantCount} 位申请者)`);
      idx++;
    }
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

  const fetcher = job.platform === "JobStreet" ? jsFetcher : ajtFetcher;
  const applicants = await fetcher.fetchApplicants(job.jobId);

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
  lines.push("回复 '简历 1' 下载简历，'返回' 回到岗位列表");

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
      messages: [`请回复 '简历 1'-'简历 ${state.applicants.length}' 下载简历，或 '返回' 回到岗位列表。`],
      waitForReply: true,
    };
  }

  const applicant = state.applicants[applicantIndex];
  return downloadResumeForApplicant(state, applicant);
}

async function downloadResumeForApplicant(
  state: ActiveJobsState,
  applicant: JobApplicant,
): Promise<ActiveJobsStepResult> {
  logger.info("ActiveJobs: downloading resume", { name: applicant.name, platform: applicant.platform });

  const fetcher = applicant.platform === "JobStreet" ? jsFetcher : ajtFetcher;
  const result = await fetcher.downloadResume(applicant);

  if (!result) {
    return {
      state,
      messages: [
        `${applicant.name} 的简历暂时无法下载。`,
        "",
        "回复其他数字下载其他简历，或 '返回' 回到岗位列表。",
      ],
      waitForReply: true,
    };
  }

  const file = await fileService.saveFile(result.buffer, result.fileName, "application/pdf");

  return {
    state,
    messages: [`${applicant.name} 的简历:`],
    files: [file],
    waitForReply: true,
  };
}

// ── 辅助函数 ──

function formatJobList(jobs: ActiveJob[]): string {
  if (jobs.length === 0) return "暂无在招岗位。";

  const lines: string[] = [];
  const jsGroup = jobs.filter((j) => j.platform === "JobStreet");
  const ajtGroup = jobs.filter((j) => j.platform === "AJobThing");
  let idx = 1;

  if (jsGroup.length > 0) {
    lines.push("*JobStreet*");
    for (const job of jsGroup) {
      lines.push(`${idx}. ${job.title} - ${job.location || "未知地点"} (${job.applicantCount} 位申请者)`);
      idx++;
    }
    lines.push("");
  }

  if (ajtGroup.length > 0) {
    lines.push("*AJobThing*");
    for (const job of ajtGroup) {
      lines.push(`${idx}. ${job.title} - ${job.location || "未知地点"} (${job.applicantCount} 位申请者)`);
      idx++;
    }
  }

  lines.push("");
  lines.push("回复数字查看申请者详情，如 '1'");
  return lines.join("\n");
}
