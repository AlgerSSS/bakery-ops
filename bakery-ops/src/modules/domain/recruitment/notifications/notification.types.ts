export interface RecruitmentNotification {
  id: string;
  type: "new_applicant" | "candidate_reply";
  platform: string;
  candidateName: string;
  jobTitle?: string;
  message?: string;
  timestamp: string;
  sourceUrl?: string;
}

export interface NotificationState {
  lastCheckedAt: string;
  jsLastApplicationId?: string;
  jsLastMessageTimestamp?: string;
}
