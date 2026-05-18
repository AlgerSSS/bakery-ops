import { recruitmentSkillDefinition, RecruitmentSkillHandler } from "./recruitment/recruitment.definition";
import { forecastOrderSkillDefinition, ForecastOrderSkillHandler } from "./forecast-order/forecast-order.definition";
import { kitchenProductionPlanSkillDefinition, KitchenProductionPlanSkillHandler } from "./kitchen-production-plan/kitchen-production-plan.definition";
import { employeeManagementSkillDefinition, EmployeeManagementSkillHandler } from "./employee-management/employee-management.definition";
import { knowledgeQuerySkillDefinition, KnowledgeQuerySkillHandler } from "./knowledge-query/knowledge-query.definition";
import { candidateOutreachSkillDefinition, CandidateOutreachSkillHandler } from "./candidate-outreach/candidate-outreach.definition";
import { jobPostingSkillDefinition, JobPostingSkillHandler } from "./job-posting/job-posting.definition";
import { activeJobsSkillDefinition, ActiveJobsSkillHandler } from "./active-jobs/active-jobs.definition";
import { supplyOrderSkillDefinition, SupplyOrderSkillHandler } from "./supply-order/supply-order.definition";
import { arrivalCheckSkillDefinition, ArrivalCheckSkillHandler } from "./arrival-check/arrival-check.definition";
import { supplySendSkillDefinition, SupplySendSkillHandler } from "./supply-send/supply-send.definition";
import { kolDiscoverySkillDefinition, KOLDiscoverySkillHandler } from "./kol-discovery/kol-discovery.definition";
import { kolOutreachSkillDefinition, KOLOutreachSkillHandler } from "./kol-outreach/kol-outreach.definition";
import { resumeUploadSkillDefinition, ResumeUploadSkillHandler } from "./resume-upload/resume-upload.definition";
import { dailyReviewChatSkillDefinition, DailyReviewChatSkillHandler } from "./daily-review-chat/daily-review-chat.definition";

export const allSkills = [
  { definition: recruitmentSkillDefinition, Handler: RecruitmentSkillHandler },
  { definition: forecastOrderSkillDefinition, Handler: ForecastOrderSkillHandler },
  { definition: kitchenProductionPlanSkillDefinition, Handler: KitchenProductionPlanSkillHandler },
  { definition: employeeManagementSkillDefinition, Handler: EmployeeManagementSkillHandler },
  { definition: knowledgeQuerySkillDefinition, Handler: KnowledgeQuerySkillHandler },
  { definition: candidateOutreachSkillDefinition, Handler: CandidateOutreachSkillHandler },
  { definition: jobPostingSkillDefinition, Handler: JobPostingSkillHandler },
  { definition: activeJobsSkillDefinition, Handler: ActiveJobsSkillHandler },
  { definition: supplyOrderSkillDefinition, Handler: SupplyOrderSkillHandler },
  { definition: arrivalCheckSkillDefinition, Handler: ArrivalCheckSkillHandler },
  { definition: supplySendSkillDefinition, Handler: SupplySendSkillHandler },
  { definition: kolDiscoverySkillDefinition, Handler: KOLDiscoverySkillHandler },
  { definition: kolOutreachSkillDefinition, Handler: KOLOutreachSkillHandler },
  { definition: resumeUploadSkillDefinition, Handler: ResumeUploadSkillHandler },
  { definition: dailyReviewChatSkillDefinition, Handler: DailyReviewChatSkillHandler },
];
