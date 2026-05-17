import type { ActiveJob, JobApplicant } from "../types";

export interface ActiveJobsFetcher {
  readonly platformName: "JobStreet" | "AJobThing";
  fetchActiveJobs(): Promise<ActiveJob[]>;
  fetchApplicants(jobId: string): Promise<JobApplicant[]>;
  downloadResume(applicant: JobApplicant): Promise<{ buffer: Buffer; fileName: string } | null>;
}
