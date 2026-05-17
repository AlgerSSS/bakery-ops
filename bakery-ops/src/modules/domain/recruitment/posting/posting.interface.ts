import type { GeneratedJD, JobPostingResult } from "../types";

export interface JobPostingConnector {
  readonly platformName: string;
  postJob(jd: GeneratedJD): Promise<JobPostingResult>;
}
