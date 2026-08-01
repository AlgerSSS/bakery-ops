import { recruitmentSkillDefinition, RecruitmentSkillHandler } from "./recruitment/recruitment.definition";
import { forecastOrderSkillDefinition, ForecastOrderSkillHandler } from "./forecast-order/forecast-order.definition";
import { kitchenProductionPlanSkillDefinition, KitchenProductionPlanSkillHandler } from "./kitchen-production-plan/kitchen-production-plan.definition";
import { employeeManagementSkillDefinition, EmployeeManagementSkillHandler } from "./employee-management/employee-management.definition";
import { knowledgeQuerySkillDefinition, KnowledgeQuerySkillHandler } from "./knowledge-query/knowledge-query.definition";
import { jobPostingSkillDefinition, JobPostingSkillHandler } from "./job-posting/job-posting.definition";
import { activeJobsSkillDefinition, ActiveJobsSkillHandler } from "./active-jobs/active-jobs.definition";
import { resumeUploadSkillDefinition, ResumeUploadSkillHandler } from "./resume-upload/resume-upload.definition";
import { dailyReviewChatSkillDefinition, DailyReviewChatSkillHandler } from "./daily-review-chat/daily-review-chat.definition";
import { helpSkillDefinition, HelpSkillHandler } from "./help/help.definition";
import { statusSkillDefinition, StatusSkillHandler } from "./status/status.definition";
import { forecastReviewSkillDefinition, ForecastReviewSkillHandler } from "./forecast-review/forecast-review.definition";
import { recruitmentProgressSkillDefinition, RecruitmentProgressSkillHandler } from "./recruitment-progress/recruitment-progress.definition";
import { backupPoolSkillDefinition, BackupPoolSkillHandler } from "./backup-pool/backup-pool.definition";
import { wmsStockSkillDefinition, WmsStockSkillHandler } from "./wms-stock/wms-stock.definition";

export const allSkills = [
  { definition: dailyReviewChatSkillDefinition, Handler: DailyReviewChatSkillHandler },
  { definition: recruitmentSkillDefinition, Handler: RecruitmentSkillHandler },
  { definition: forecastOrderSkillDefinition, Handler: ForecastOrderSkillHandler },
  { definition: kitchenProductionPlanSkillDefinition, Handler: KitchenProductionPlanSkillHandler },
  { definition: employeeManagementSkillDefinition, Handler: EmployeeManagementSkillHandler },
  { definition: knowledgeQuerySkillDefinition, Handler: KnowledgeQuerySkillHandler },
  { definition: jobPostingSkillDefinition, Handler: JobPostingSkillHandler },
  { definition: activeJobsSkillDefinition, Handler: ActiveJobsSkillHandler },
  { definition: resumeUploadSkillDefinition, Handler: ResumeUploadSkillHandler },
  { definition: helpSkillDefinition, Handler: HelpSkillHandler },
  { definition: statusSkillDefinition, Handler: StatusSkillHandler },
  { definition: forecastReviewSkillDefinition, Handler: ForecastReviewSkillHandler },
  { definition: recruitmentProgressSkillDefinition, Handler: RecruitmentProgressSkillHandler },
  { definition: backupPoolSkillDefinition, Handler: BackupPoolSkillHandler },
  { definition: wmsStockSkillDefinition, Handler: WmsStockSkillHandler },
];
