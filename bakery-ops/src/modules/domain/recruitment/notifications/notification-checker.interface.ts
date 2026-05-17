import type { RecruitmentNotification } from "./notification.types";

export interface NotificationChecker {
  readonly platformName: string;
  checkNewNotifications(): Promise<RecruitmentNotification[]>;
}
