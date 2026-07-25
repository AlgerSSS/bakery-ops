// lark-recruitment.service.ts
//
// Mirrors the owner's REAL Lark hiring process (base 试工流程跟踪) for an application. All Lark field
// names come VERBATIM from recruitment-vocab LARK_FIELDS. Each store points at its own base/table via
// stores.lark_base_token / stores.lark_table_id; when those are blank we fall back to the Pavilion
// constants below. Every Lark call is non-blocking (returns null/"" on failure) like createRecord.

import { LarkCliClient } from "./lark-cli.client";
import { logger } from "../../shared/logger";
import {
  LARK_FIELDS,
  STAGE_TO_LARK,
  ROLE_AREA,
  type ApplicationStage,
} from "../recruitment/recruitment-vocab";
import { storeRepository } from "../../data/repositories/store.repository";
import { applicationRepository, type ApplicationRow } from "../../data/repositories/application.repository";

// Pavilion 试工流程跟踪 base/table — the fallback when a store row has no lark_base_token/lark_table_id.
// Values come from .env (RECRUIT_LARK_BASE_TOKEN / RECRUIT_LARK_TABLE_ID) so tokens stay out of source.
const PAVILION_BASE_TOKEN = process.env.RECRUIT_LARK_BASE_TOKEN || "";
const PAVILION_TABLE_ID = process.env.RECRUIT_LARK_TABLE_ID || "";

// Stage -> the Lark date field stamped when the application enters that stage.
const STAGE_DATE_FIELD: Partial<Record<ApplicationStage, string>> = {
  contacting: LARK_FIELDS.firstContactDate,
  first_interview: LARK_FIELDS.firstInterviewDate,
  trial: LARK_FIELDS.trialDate,
  hired: LARK_FIELDS.onboardDate,
};

export interface UpsertCandidateFields {
  当前阶段?: string;
  应聘类型?: string;
  来源渠道?: string;
  firstContactDate?: string;
  firstInterviewDate?: string;
  trialDate?: string;
  onboardDate?: string;
  expectedSalary?: string;
}

export interface ChefFields {
  position?: string; // 岗位/站位
  recommendation?: string; // 录用建议
  suggestedSalary?: string; // 建议薪资
  trialFeedback?: string; // 试工反馈
  trialScore?: number; // 试工评分
  redLine?: string; // 触犯红线 (无/有)
  trialDuration?: string; // 试工时长
  attitudeSummary?: string; // 工作态度小结
}

export class LarkRecruitmentService {
  /** Resolve the base/table for a store, falling back to the Pavilion constants. */
  private async clientForStore(storeCode: string): Promise<LarkCliClient> {
    const store = await storeRepository.getByCode(storeCode);
    return new LarkCliClient({
      appToken: store?.lark_base_token || PAVILION_BASE_TOKEN,
      tableId: store?.lark_table_id || PAVILION_TABLE_ID,
    });
  }

  /**
   * Create or update the candidate's 试工流程跟踪 row. If the application already has a lark_record_id,
   * patches it; otherwise creates a new record and stores the returned id back on the application.
   * Returns the record id (or null on failure).
   */
  async upsertCandidateRow(
    application: ApplicationRow,
    fields: UpsertCandidateFields,
  ): Promise<string | null> {
    const client = await this.clientForStore(application.store_id);
    const larkFields = this.buildCandidateFields(application, fields);

    if (application.lark_record_id) {
      const ok = await client.updateRecord(application.lark_record_id, larkFields);
      return ok ? application.lark_record_id : null;
    }

    const recordId = await client.createRecord(larkFields);
    if (recordId) {
      await applicationRepository.setLarkRecordId(application.id, recordId);
    } else {
      logger.warn("Lark candidate row create returned no id", { applicationId: application.id });
    }
    return recordId;
  }

  /**
   * Write a stage transition: updates 当前阶段 to the mapped Lark option and stamps the stage's date
   * field with `when` (defaults to now). Stages with no Lark counterpart (new/opted_out/no_show) are
   * skipped. Requires the application to already have a lark_record_id.
   */
  async writeStageTransition(
    application: ApplicationRow,
    stage: ApplicationStage,
    when?: string,
  ): Promise<boolean> {
    const larkStage = STAGE_TO_LARK[stage];
    if (!larkStage) return false;
    if (!application.lark_record_id) {
      logger.warn("writeStageTransition: no lark_record_id", { applicationId: application.id });
      return false;
    }

    const fields: Record<string, unknown> = { [LARK_FIELDS.stage]: larkStage };
    const dateField = STAGE_DATE_FIELD[stage];
    if (dateField) fields[dateField] = when ?? new Date().toISOString();

    const client = await this.clientForStore(application.store_id);
    return client.updateRecord(application.lark_record_id, fields);
  }

  /** Write the chef/store evaluation (🟩 fields) onto an existing 试工流程跟踪 record. */
  async writeChefFields(
    storeCode: string,
    recordId: string,
    fields: ChefFields,
  ): Promise<boolean> {
    const larkFields: Record<string, unknown> = {};
    if (fields.position != null) larkFields[LARK_FIELDS.position] = fields.position;
    if (fields.recommendation != null) larkFields[LARK_FIELDS.recommendation] = fields.recommendation;
    if (fields.suggestedSalary != null) larkFields[LARK_FIELDS.suggestedSalary] = fields.suggestedSalary;
    if (fields.trialFeedback != null) larkFields[LARK_FIELDS.trialFeedback] = fields.trialFeedback;
    if (fields.trialScore != null) larkFields[LARK_FIELDS.trialScore] = fields.trialScore;
    if (fields.redLine != null) larkFields[LARK_FIELDS.redLine] = fields.redLine;
    if (fields.trialDuration != null) larkFields[LARK_FIELDS.trialDuration] = fields.trialDuration;
    if (fields.attitudeSummary != null) larkFields[LARK_FIELDS.attitudeSummary] = fields.attitudeSummary;

    if (Object.keys(larkFields).length === 0) return true;

    const client = await this.clientForStore(storeCode);
    return client.updateRecord(recordId, larkFields);
  }

  /** Alias for writeChefFields, scoped to the trial-result subset. */
  async writeTrialResult(
    storeCode: string,
    recordId: string,
    fields: ChefFields,
  ): Promise<boolean> {
    return this.writeChefFields(storeCode, recordId, fields);
  }

  /** Write the 🟦HR｜初面结论 (通过/备选/淘汰) onto an existing 试工流程跟踪 record. */
  async writeInterviewConclusion(
    storeCode: string,
    recordId: string,
    conclusion: string,
  ): Promise<boolean> {
    const client = await this.clientForStore(storeCode);
    return client.updateRecord(recordId, { [LARK_FIELDS.interviewConclusion]: conclusion });
  }

  /** Read the 🟩厨/店｜建议薪资 text off a record. Returns "" when unavailable (non-blocking). */
  async readSuggestedSalary(storeCode: string, recordId: string): Promise<string> {
    const store = await storeRepository.getByCode(storeCode);
    const baseToken = store?.lark_base_token || PAVILION_BASE_TOKEN;
    const tableId = store?.lark_table_id || PAVILION_TABLE_ID;
    const client = new LarkCliClient({ appToken: baseToken, tableId });
    const record = await client.getRecord(baseToken, tableId, recordId);
    return larkCellToString(record?.fields?.[LARK_FIELDS.suggestedSalary]);
  }

  private buildCandidateFields(
    application: ApplicationRow,
    fields: UpsertCandidateFields,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    if (application.name) out[LARK_FIELDS.candidateName] = application.name;
    if (application.phone) out[LARK_FIELDS.phone] = application.phone;

    if (fields.当前阶段) {
      out[LARK_FIELDS.stage] = fields.当前阶段;
    } else if (STAGE_TO_LARK[application.stage]) {
      out[LARK_FIELDS.stage] = STAGE_TO_LARK[application.stage];
    }

    if (fields.应聘类型) {
      out[LARK_FIELDS.applicationType] = fields.应聘类型;
    } else if (application.role_area) {
      out[LARK_FIELDS.applicationType] = ROLE_AREA[application.role_area];
    }

    if (fields.来源渠道) out[LARK_FIELDS.sourceChannel] = fields.来源渠道;
    if (fields.firstContactDate) out[LARK_FIELDS.firstContactDate] = fields.firstContactDate;
    if (fields.firstInterviewDate) out[LARK_FIELDS.firstInterviewDate] = fields.firstInterviewDate;
    if (fields.trialDate) out[LARK_FIELDS.trialDate] = fields.trialDate;
    if (fields.onboardDate) out[LARK_FIELDS.onboardDate] = fields.onboardDate;
    if (fields.expectedSalary) out[LARK_FIELDS.expectedSalary] = fields.expectedSalary;

    if (application.position_code) out[LARK_FIELDS.position] = application.position_code;

    return out;
  }
}

/**
 * Normalize a Lark read-cell value to a plain string. Text fields come back as a string; select and
 * rich-text fields may come back as arrays (e.g. ["③试工"] or [{text:"..."}]). Null/undefined -> "".
 */
function larkCellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        typeof v === "string"
          ? v
          : v && typeof v === "object" && "text" in (v as Record<string, unknown>)
            ? String((v as Record<string, unknown>).text)
            : String(v),
      )
      .join("");
  }
  return String(value);
}

export const larkRecruitmentService = new LarkRecruitmentService();
