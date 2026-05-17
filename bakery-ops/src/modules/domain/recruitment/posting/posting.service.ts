import type { GeneratedJD, JobPostingResult } from "../types";
import { AJobThingPosting } from "./ajobthing.posting";
import { JobStreetPosting } from "./jobstreet.posting";
import { generateJobDescription } from "../jd-generator";
import { logger } from "../../../shared/logger";

// ── 步骤类型 ──

export type PostingStep =
  | "generate_jd"
  | "confirm_jd"
  | "fill_forms"
  | "confirm_forms"
  | "fill_description"
  | "confirm_description"
  | "posting"
  | "done";

export interface PostingState {
  step: PostingStep;
  jd?: GeneratedJD;
  rawInput: string;
  ajtResult?: JobPostingResult;
  jsResult?: JobPostingResult;
  jsDraftId?: string;
}

export interface PostingStepResult {
  state: PostingState;
  messages: string[];
  images?: string[];
  waitForConfirm: boolean;
}

const ajtPosting = new AJobThingPosting();
const jsPosting = new JobStreetPosting();

// ── 交互式发布入口 ──

/**
 * 交互式多步发布职位
 *
 * @param rawInput 原始中文输入（首次调用时）
 * @param currentState 当前步骤状态（续接时）
 * @param userReply 用户回复（续接时）
 */
export async function postJobInteractive(
  rawInput: string,
  currentState?: PostingState,
  userReply?: string,
): Promise<PostingStepResult> {
  // 首次调用 — 生成 JD
  if (!currentState) {
    return stepGenerateJd(rawInput);
  }

  const reply = (userReply || "").trim().toLowerCase();

  switch (currentState.step) {
    case "confirm_jd":
      return handleConfirmJd(currentState, reply, userReply || "");

    case "confirm_forms":
      return handleConfirmForms(currentState, reply);

    case "confirm_description":
      return handleConfirmDescription(currentState, reply);

    default:
      return {
        state: { ...currentState, step: "done" },
        messages: ["流程状态异常，已重置。请重新发起发布。"],
        waitForConfirm: false,
      };
  }
}

// ── Step 1: 生成 JD 预览 ──

async function stepGenerateJd(rawInput: string): Promise<PostingStepResult> {
  logger.info("PostingInteractive: generating JD", { input: rawInput.slice(0, 100) });
  const jd = await generateJobDescription(rawInput);
  logger.info("PostingInteractive: JD generated", { title: jd.title });

  const preview = formatJdPreview(jd);
  const messages = [
    "好的，我帮你生成了英文 JD，请确认：",
    "",
    preview,
    "",
    "确认发布到 AJobThing 和 JobStreet？",
    "回复 '确认' 继续，'修改 XXX' 调整内容，'取消' 放弃",
  ];

  return {
    state: { step: "confirm_jd", jd, rawInput },
    messages: [messages.join("\n")],
    waitForConfirm: true,
  };
}

// ── Step 2: 用户确认 JD → 填写平台表单 ──

async function handleConfirmJd(
  state: PostingState,
  reply: string,
  rawReply: string,
): Promise<PostingStepResult> {
  // 取消
  if (reply.includes("取消") || reply === "cancel") {
    return {
      state: { ...state, step: "done" },
      messages: ["好的，已取消发布。"],
      waitForConfirm: false,
    };
  }

  // 修改 — 追加修改内容重新生成
  if (reply.startsWith("修改") || reply.startsWith("改")) {
    const modification = rawReply.replace(/^(修改|改)\s*/i, "");
    const newInput = `${state.rawInput}\n\n修改要求: ${modification}`;
    return stepGenerateJd(newInput);
  }

  // 确认 — 填写两个平台的表单
  if (!reply.includes("确认") && reply !== "ok" && reply !== "yes" && reply !== "好" && reply !== "是") {
    return {
      state,
      messages: ["请回复 '确认' 继续发布，'修改 XXX' 调整内容，或 '取消' 放弃。"],
      waitForConfirm: true,
    };
  }

  if (!state.jd) {
    return {
      state: { ...state, step: "done" },
      messages: ["JD 数据丢失，请重新发起发布。"],
      waitForConfirm: false,
    };
  }

  // PLACEHOLDER_FILL_FORMS_STEP

  logger.info("PostingInteractive: filling platform forms");
  const messages: string[] = ["正在填写平台表单..."];
  const images: string[] = [];

  // 并行填写两个平台的 Step 1
  const [ajtFormResult, jsClassifyResult] = await Promise.allSettled([
    ajtPosting.fillFormStep(state.jd),
    jsPosting.fillClassifyStep(state.jd),
  ]);

  if (ajtFormResult.status === "fulfilled") {
    images.push(ajtFormResult.value.screenshot);
    messages.push("AJobThing: 表单已填写");
  } else {
    messages.push(`AJobThing: 填写失败 - ${ajtFormResult.reason}`);
  }

  let jsDraftId: string | undefined;
  if (jsClassifyResult.status === "fulfilled") {
    images.push(jsClassifyResult.value.screenshot);
    jsDraftId = jsClassifyResult.value.draftId;
    if (jsDraftId) {
      messages.push(`JobStreet: 基本信息已填写 (Draft: ${jsDraftId})`);
    } else {
      messages.push("JobStreet: 基本信息已填写（将在发布时一次性完成后续步骤）");
    }
  } else {
    messages.push(`JobStreet: 填写失败 - ${jsClassifyResult.reason}`);
  }

  messages.push("");
  messages.push("基本信息已填写，回复 '继续' 进入下一步，'取消' 放弃");

  return {
    state: { ...state, step: "confirm_forms", jsDraftId },
    messages: [messages.join("\n")],
    images,
    waitForConfirm: true,
  };
}

// ── Step 3: 用户确认表单 → 填写职位描述 ──

async function handleConfirmForms(
  state: PostingState,
  reply: string,
): Promise<PostingStepResult> {
  if (reply.includes("取消") || reply === "cancel") {
    return {
      state: { ...state, step: "done" },
      messages: ["好的，已取消发布。"],
      waitForConfirm: false,
    };
  }

  if (!reply.includes("继续") && reply !== "ok" && reply !== "yes" && reply !== "好" && reply !== "下一步") {
    return {
      state,
      messages: ["请回复 '继续' 进入下一步，或 '取消' 放弃。"],
      waitForConfirm: true,
    };
  }

  if (!state.jd) {
    return {
      state: { ...state, step: "done" },
      messages: ["JD 数据丢失，请重新发起发布。"],
      waitForConfirm: false,
    };
  }

  logger.info("PostingInteractive: filling job description");
  const messages: string[] = ["正在填写职位描述..."];
  const images: string[] = [];

  // 填写 JobStreet Write 步骤（仅在有 draftId 时分步执行）
  if (state.jsDraftId) {
    try {
      const writeResult = await jsPosting.fillWriteStep(state.jd, state.jsDraftId);
      images.push(writeResult.screenshot);
      messages.push("JobStreet: 职位描述已填写");
    } catch (err) {
      messages.push(`JobStreet: 描述填写失败 - ${err}`);
    }
  } else {
    messages.push("JobStreet: 将在发布时一次性完成所有步骤");
  }

  messages.push("");
  messages.push("职位描述已填写，回复 '发布' 确认发布，或 '取消' 放弃");

  return {
    state: { ...state, step: "confirm_description" },
    messages: [messages.join("\n")],
    images,
    waitForConfirm: true,
  };
}

// PLACEHOLDER_FINAL_STEPS

// ── Step 4: 用户确认发布 → 执行最终发布 ──

async function handleConfirmDescription(
  state: PostingState,
  reply: string,
): Promise<PostingStepResult> {
  if (reply.includes("取消") || reply === "cancel") {
    return {
      state: { ...state, step: "done" },
      messages: ["好的，已取消发布。"],
      waitForConfirm: false,
    };
  }

  if (!reply.includes("发布") && reply !== "post" && reply !== "ok" && reply !== "yes" && reply !== "好") {
    return {
      state,
      messages: ["请回复 '发布' 确认发布，或 '取消' 放弃。"],
      waitForConfirm: true,
    };
  }

  if (!state.jd) {
    return {
      state: { ...state, step: "done" },
      messages: ["JD 数据丢失，请重新发起发布。"],
      waitForConfirm: false,
    };
  }

  logger.info("PostingInteractive: executing final post");
  const messages: string[] = ["正在发布..."];

  // 并行发布
  // JobStreet: 有 draftId 时用分步方法，否则用完整的 postJob 一次性完成
  const [ajtResult, jsResult] = await Promise.allSettled([
    ajtPosting.submitPost(state.jd),
    state.jsDraftId
      ? jsPosting.fillManageAndPost(state.jsDraftId)
      : jsPosting.postJob(state.jd),
  ]);

  const ajtFinal: JobPostingResult = ajtResult.status === "fulfilled"
    ? ajtResult.value
    : { platform: "AJobThing", status: "failed", error: String(ajtResult.reason) };

  const jsFinal: JobPostingResult = jsResult.status === "fulfilled"
    ? jsResult.value
    : { platform: "JobStreet", status: "failed", error: String(jsResult.reason) };

  const icon = (s: string) => s === "posted" ? "\u2705" : s === "draft" ? "\u23F3" : "\u274C";

  messages.push(`${icon(jsFinal.status)} JobStreet: ${jsFinal.status === "posted" ? "已发布" : jsFinal.status === "draft" ? "草稿" : "失败"}`);
  if (jsFinal.jobId) messages.push(`   Job ID: ${jsFinal.jobId}`);
  if (jsFinal.jobUrl) messages.push(`   ${jsFinal.jobUrl}`);
  if (jsFinal.error) messages.push(`   ${jsFinal.error}`);

  messages.push(`${icon(ajtFinal.status)} AJobThing: ${ajtFinal.status === "posted" ? "已发布" : ajtFinal.status === "draft" ? "草稿" : "失败"}`);
  if (ajtFinal.jobUrl) messages.push(`   ${ajtFinal.jobUrl}`);
  if (ajtFinal.error) messages.push(`   ${ajtFinal.error}`);

  return {
    state: {
      ...state,
      step: "done",
      ajtResult: ajtFinal,
      jsResult: jsFinal,
    },
    messages: [messages.join("\n")],
    waitForConfirm: false,
  };
}

// ── 辅助函数 ──

function formatJdPreview(jd: GeneratedJD): string {
  const lines: string[] = [];
  lines.push(`*${jd.title}*`);
  lines.push(`Location: ${jd.location}`);
  if (jd.salaryRange) lines.push(`Salary: ${jd.salaryRange}`);
  const typeMap: Record<string, string> = { full_time: "Full-time", part_time: "Part-time", contract: "Contract" };
  lines.push(`Type: ${typeMap[jd.jobType] || jd.jobType}`);
  lines.push("");
  lines.push("Requirements:");
  for (const req of jd.requirements.slice(0, 5)) {
    lines.push(`- ${req}`);
  }
  if (jd.languageRequirements.length > 0) {
    lines.push(`- Languages: ${jd.languageRequirements.join(", ")}`);
  }
  if (jd.benefits.length > 0) {
    lines.push("");
    lines.push("Benefits:");
    for (const b of jd.benefits.slice(0, 3)) {
      lines.push(`- ${b}`);
    }
  }
  return lines.join("\n");
}

// ── 保留旧接口兼容（测试和其他调用方使用） ──

export async function postJob(rawChineseInput: string): Promise<{
  jd: GeneratedJD;
  results: JobPostingResult[];
}> {
  logger.info("Job posting (legacy): generating English JD from Chinese input");
  const jd = await generateJobDescription(rawChineseInput);
  logger.info("Job posting (legacy): JD generated", { title: jd.title, location: jd.location });

  const results = await Promise.all(
    [ajtPosting, jsPosting].map(async (connector) => {
      try {
        logger.info(`Job posting: posting to ${connector.platformName}`);
        return await connector.postJob(jd);
      } catch (err) {
        logger.error(`Job posting: ${connector.platformName} failed`, { error: String(err) });
        return {
          platform: connector.platformName,
          status: "failed" as const,
          error: String(err),
        };
      }
    }),
  );

  return { jd, results };
}


