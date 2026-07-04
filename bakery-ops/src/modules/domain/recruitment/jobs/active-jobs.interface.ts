import type { ActiveJob, ApplicantProfile, JobApplicant } from "../types";

export interface ActiveJobsFetcher {
  readonly platformName: "JobStreet";
  fetchActiveJobs(): Promise<ActiveJob[]>;
  fetchApplicants(jobId: string): Promise<JobApplicant[]>;
  downloadResume(applicant: JobApplicant): Promise<{ buffer: Buffer; fileName: string } | null>;
  // SEEK express 套餐无法下载简历 PDF；改为展示免费可得的在线档案。
  fetchApplicantProfile(jobId: string, applicantIndex: number, applicant: JobApplicant): Promise<ApplicantProfile | null>;
}
