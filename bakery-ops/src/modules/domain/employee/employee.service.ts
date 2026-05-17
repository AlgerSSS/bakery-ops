import { employeeRepository } from "../../data/repositories/employee.repository";
import { employeeEventRepository } from "../../data/repositories/employee-event.repository";
import { parseEmployeeEvent } from "./employee-event.parser";
import { lightragClient } from "../knowledge/lightrag-client";
import { larkSyncService } from "../lark/lark-sync.service";
import { extractRules } from "./rule-extractor";
import { logger } from "../../shared/logger";

export interface EmployeeEventResult {
  success: boolean;
  summary: string;
  employeeId?: string;
  eventType?: string;
}

/**
 * 处理 WhatsApp 消息中的员工事件
 */
export async function handleEmployeeMessage(
  message: string,
  reportedBy: string,
): Promise<EmployeeEventResult> {
  // 1. LLM 解析消息
  const parsed = await parseEmployeeEvent(message);

  // 2. 匹配或创建员工
  let employee;
  if (parsed.employeeId) {
    employee = await employeeRepository.getById(parsed.employeeId);
  }
  if (!employee) {
    employee = await employeeRepository.findByName(parsed.employeeName);
  }
  if (!employee && parsed.isNewEmployee) {
    employee = await employeeRepository.create({
      name: parsed.employeeName,
      source: "manual",
      status: "candidate",
    });
  }

  if (!employee) {
    return {
      success: false,
      summary: `找不到名为「${parsed.employeeName}」的员工记录。需要我先创建一个吗？`,
    };
  }

  // 3. 写入事件
  await employeeEventRepository.create({
    employee_id: employee.id,
    event_type: parsed.eventType,
    summary: parsed.summary,
    raw_message: message,
    reported_by: reportedBy,
    data: parsed.data,
  });

  // 4. 更新员工状态
  const statusUpdates: Record<string, unknown> = {};

  switch (parsed.eventType) {
    case "interview_feedback":
      statusUpdates.status = "interviewing";
      statusUpdates.interviewed_at = new Date().toISOString();
      break;
    case "hired":
      statusUpdates.status = "hired";
      statusUpdates.hired_at = new Date().toISOString();
      if (parsed.data.position) statusUpdates.job_title = parsed.data.position;
      if (parsed.data.store) statusUpdates.store_id = parsed.data.store;
      break;
    case "resigned":
      statusUpdates.status = "resigned";
      statusUpdates.resigned_at = new Date().toISOString();
      break;
    case "terminated":
      statusUpdates.status = "terminated";
      statusUpdates.resigned_at = new Date().toISOString();
      break;
    case "probation_passed":
      statusUpdates.status = "hired";
      break;
  }

  if (Object.keys(statusUpdates).length > 0) {
    await employeeRepository.updateStatus(employee.id, String(statusUpdates.status || employee.status), statusUpdates);
  }

  logger.info("Employee event processed", {
    employeeId: employee.id,
    name: employee.name,
    eventType: parsed.eventType,
  });

  // 5. 喂入 LightRAG 知识图谱（异步，不阻塞主流程）
  ingestToKnowledgeGraph(employee, parsed).catch((err) => {
    logger.warn("LightRAG ingest failed (non-blocking)", { error: String(err) });
  });

  // 6. 同步到飞书多维表格（异步，不阻塞主流程）
  const eventRow = { event_type: parsed.eventType, summary: parsed.summary, created_at: new Date().toISOString() };
  larkSyncService.onEventRecorded(employee, eventRow as any).catch((err) => {
    logger.warn("Lark event sync failed (non-blocking)", { error: String(err) });
  });
  if (Object.keys(statusUpdates).length > 0) {
    larkSyncService.onStatusChanged(employee, String(statusUpdates.status || employee.status), statusUpdates).catch((err) => {
      logger.warn("Lark status sync failed (non-blocking)", { error: String(err) });
    });
  }

  // 7. 离职事件触发规则提炼（异步，不阻塞主流程）
  if (parsed.eventType === "resigned" || parsed.eventType === "terminated") {
    extractRules().catch((err) => {
      logger.warn("Rule extraction failed (non-blocking)", { error: String(err) });
    });
  }

  return {
    success: true,
    summary: parsed.summary,
    employeeId: employee.id,
    eventType: parsed.eventType,
  };
}

/**
 * 构造知识文本并喂入 LightRAG。
 * 离职事件包含完整上下文（最有价值的数据）。
 */
async function ingestToKnowledgeGraph(
  employee: { id: string; name: string; job_title?: string; store_id?: string; skills?: string[]; languages?: string[]; education?: string; experience_summary?: string },
  parsed: { eventType: string; summary: string; data: Record<string, unknown> },
): Promise<void> {
  const lines: string[] = [];

  switch (parsed.eventType) {
    case "resigned":
    case "terminated": {
      // 离职数据最有价值 — 包含完整上下文
      const events = await employeeEventRepository.getByEmployee(employee.id);
      const interviewFeedback = events
        .filter((e) => e.event_type === "interview_feedback")
        .map((e) => e.summary)
        .join("; ");
      const perfNotes = events
        .filter((e) => e.event_type === "performance_review")
        .map((e) => e.summary)
        .join("; ");

      lines.push(
        `员工档案 - 离职分析`,
        `姓名: ${employee.name}`,
        `岗位: ${employee.job_title || "未知"}`,
        `门店: ${employee.store_id || "未知"}`,
        `在职时长: ${parsed.data.tenure_months || "未知"} 个月`,
        `离职原因: ${parsed.data.reason || "未知"}`,
        `离职原因分类: ${parsed.data.reason_category || "other"}`,
        `技能: ${(employee.skills || []).join(", ") || "未知"}`,
        `语言: ${(employee.languages || []).join(", ") || "未知"}`,
        `学历: ${employee.education || "未知"}`,
        `工作经历: ${employee.experience_summary || "未知"}`,
        interviewFeedback ? `面试评价: ${interviewFeedback}` : "",
        perfNotes ? `绩效记录: ${perfNotes}` : "",
        `结论: 该员工在职${parsed.data.tenure_months || "?"}个月后因${parsed.data.reason || "未知原因"}离职。`,
      );
      break;
    }
    case "interview_feedback":
      lines.push(
        `员工面试记录`,
        `姓名: ${employee.name}`,
        `岗位: ${employee.job_title || "未知"}`,
        `面试评价: ${parsed.summary}`,
        `评分: ${parsed.data.rating || "未知"}/5`,
        `优点: ${(parsed.data.strengths as string[] || []).join(", ")}`,
        `顾虑: ${(parsed.data.concerns as string[] || []).join(", ")}`,
      );
      break;
    case "hired":
      lines.push(
        `员工入职记录`,
        `姓名: ${employee.name}`,
        `岗位: ${parsed.data.position || employee.job_title || "未知"}`,
        `门店: ${parsed.data.store || employee.store_id || "未知"}`,
        `技能: ${(employee.skills || []).join(", ") || "未知"}`,
      );
      break;
    default:
      lines.push(
        `员工事件: ${parsed.eventType}`,
        `姓名: ${employee.name}`,
        `摘要: ${parsed.summary}`,
      );
  }

  const text = lines.filter(Boolean).join("\n");
  if (text.length > 20) {
    await lightragClient.ingest(text);
  }
}
