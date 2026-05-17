import { larkCliClient } from "./lark-cli.client";
import { logger } from "../../shared/logger";
import type { ParsedResume, WorkExperience } from "../resume/types";

interface EmployeeLike {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  job_title?: string | null;
  department?: string | null;
  store_id?: string | null;
  source?: string | null;
  source_url?: string | null;
  skills?: string[] | null;
  languages?: string[] | null;
  education?: string | null;
  location?: string | null;
  hired_at?: string | null;
  resigned_at?: string | null;
  applied_at?: string | null;
  resume_file_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface EventLike {
  event_type: string;
  summary: string;
  created_at?: string | null;
}

export class LarkBaseService {
  async createEmployeeRecord(employee: EmployeeLike, parsedResume?: ParsedResume): Promise<string | null> {
    const fields = await this.mapToLarkFields(employee, parsedResume);
    return larkCliClient.createRecord(fields);
  }

  async updateEmployeeStatus(larkRecordId: string, status: string, extra?: Record<string, unknown>): Promise<boolean> {
    const fields: Record<string, unknown> = { "状态": status };
    if (extra?.resigned_at) fields["离职时间"] = extra.resigned_at;
    if (extra?.hired_at) fields["入职时间"] = extra.hired_at;
    return larkCliClient.updateRecord(larkRecordId, fields);
  }

  async appendEvent(larkRecordId: string, event: EventLike, existingEvents?: string): Promise<boolean> {
    const line = `[${event.created_at || new Date().toISOString().slice(0, 10)}] ${event.event_type}: ${event.summary}`;
    const updated = existingEvents ? `${existingEvents}\n${line}` : line;
    return larkCliClient.updateRecord(larkRecordId, { "事件记录": updated });
  }

  async updateResumeFields(larkRecordId: string, resume: ParsedResume): Promise<boolean> {
    const fields: Record<string, unknown> = {};
    if (resume.gender) fields["性别"] = resume.gender;
    if (resume.education_level) fields["学历"] = resume.education_level;
    if (resume.school) fields["学校"] = resume.school;
    if (resume.major) fields["专业"] = resume.major;
    if (resume.total_years_experience != null) fields["工作年限"] = resume.total_years_experience;
    if (resume.job_level) fields["职级"] = resume.job_level;
    if (resume.nationality) fields["国籍"] = resume.nationality;
    if (resume.availability) fields["到岗时间"] = resume.availability;
    if (resume.certifications?.length) fields["证书"] = resume.certifications.join(", ");
    if (resume.salary_expectation) {
      const { min, max, currency } = resume.salary_expectation;
      fields["期望薪资"] = min && max ? `${min}-${max} ${currency}` : `${min || max} ${currency}`;
    }
    if (resume.current_salary?.amount) {
      fields["当前薪资"] = `${resume.current_salary.amount} ${resume.current_salary.currency}`;
    }
    if (resume.work_experience?.length) {
      fields["工作经历"] = formatWorkExperience(resume.work_experience);
    }
    return larkCliClient.updateRecord(larkRecordId, fields);
  }

  private async mapToLarkFields(employee: EmployeeLike, resume?: ParsedResume): Promise<Record<string, unknown>> {
    const fields: Record<string, unknown> = {
      "姓名": employee.name,
      "状态": employee.status || "candidate",
    };

    if (employee.phone) fields["电话"] = employee.phone;
    if (employee.email) fields["邮箱"] = employee.email;
    if (employee.job_title) fields["岗位"] = employee.job_title;
    if (employee.department) fields["部门"] = employee.department;
    if (employee.store_id) fields["门店"] = employee.store_id;
    if (employee.source) fields["来源"] = employee.source;
    if (employee.skills?.length) fields["技能"] = employee.skills.join(", ");
    if (employee.languages?.length) fields["语言"] = employee.languages.join(", ");
    if (employee.location) fields["地点"] = employee.location;
    if (employee.hired_at) fields["入职时间"] = employee.hired_at;
    if (employee.resigned_at) fields["离职时间"] = employee.resigned_at;
    if (employee.applied_at) fields["申请时间"] = employee.applied_at;
    if (employee.source_url) fields["简历链接"] = employee.source_url;

    const matchScore = employee.metadata?.matchScore;
    if (typeof matchScore === "number") fields["匹配分数"] = matchScore;

    // 尝试关联 Lark 组织架构中的人员
    const larkUser = await larkCliClient.searchUser(employee.name);
    if (larkUser) {
      fields["关联人员"] = [{ id: larkUser.openId }];
      if (larkUser.department && !employee.department) {
        fields["部门"] = larkUser.department;
      }
    }

    if (resume) {
      if (resume.gender) fields["性别"] = resume.gender;
      if (resume.education_level) fields["学历"] = resume.education_level;
      if (resume.school) fields["学校"] = resume.school;
      if (resume.major) fields["专业"] = resume.major;
      if (resume.total_years_experience != null) fields["工作年限"] = resume.total_years_experience;
      if (resume.job_level) fields["职级"] = resume.job_level;
      if (resume.nationality) fields["国籍"] = resume.nationality;
      if (resume.availability) fields["到岗时间"] = resume.availability;
      if (resume.certifications?.length) fields["证书"] = resume.certifications.join(", ");
      if (resume.salary_expectation) {
        const { min, max, currency } = resume.salary_expectation;
        fields["期望薪资"] = min && max ? `${min}-${max} ${currency}` : `${min || max} ${currency}`;
      }
      if (resume.current_salary?.amount) {
        fields["当前薪资"] = `${resume.current_salary.amount} ${resume.current_salary.currency}`;
      }
      if (resume.work_experience?.length) {
        fields["工作经历"] = formatWorkExperience(resume.work_experience);
      }
    }

    return fields;
  }
}

function formatWorkExperience(experiences: WorkExperience[]): string {
  return experiences.map((exp) => {
    const period = exp.start_date ? `${exp.start_date} ~ ${exp.end_date || "至今"}` : "";
    return `${exp.company} | ${exp.title}${period ? ` (${period})` : ""}${exp.description ? `\n  ${exp.description}` : ""}`;
  }).join("\n");
}

export const larkBaseService = new LarkBaseService();
