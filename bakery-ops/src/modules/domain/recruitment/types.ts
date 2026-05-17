// 招聘模块类型定义

export interface ParsedJD {
  jobTitle: string;
  location: string;
  requirements: string[];
  preferredSkills: string[];
  experienceYears: number;
  languageRequirements: string[];
  salaryRange?: string;
  jobType: "full_time" | "part_time" | "contract";
  rawText: string;
}

export interface Candidate {
  candidateId: string;
  source: string;           // 来源网站
  sourceUrl: string;        // 原始链接
  name: string;
  phone?: string;
  email?: string;
  location?: string;
  currentTitle?: string;
  experience?: string;
  skills: string[];
  languages: string[];
  education?: string;
  summary?: string;
  lastActive?: string;
  resumeFileId?: string;    // 下载的简历文件 ID
  resumeFileName?: string;  // 简历文件名
  rawData?: Record<string, unknown>;
}

export interface ScoredCandidate extends Candidate {
  matchScore: number;       // 0-100
  scoreBreakdown: {
    skillMatch: number;
    experienceMatch: number;
    locationMatch: number;
    languageMatch: number;
  };
  scoreReason: string;
}

export interface CrawlResult {
  source: string;
  candidates: Candidate[];
  totalFound: number;
  crawledAt: string;
  errors?: string[];
}

export interface OutreachResult {
  candidateId: string;
  candidateName: string;
  platform: string;
  status: "sent" | "failed" | "skipped" | "budget_exceeded";
  error?: string;
  sentAt?: string;
}

export interface OutreachBatchResult {
  platform: string;
  total: number;
  sent: number;
  failed: number;
  results: OutreachResult[];
}

export interface RecruitmentTaskResult {
  jd: ParsedJD;
  totalCrawled: number;
  totalAfterDedup: number;
  topCandidates: ScoredCandidate[];
  outreach?: OutreachBatchResult[];
}

// ── 发布职位相关类型 ──

export interface GeneratedJD {
  title: string;
  description: string;           // HTML 格式
  requirements: string[];
  benefits: string[];
  location: string;
  salaryRange?: string;
  jobType: "full_time" | "part_time" | "contract";
  experienceYears: number;
  languageRequirements: string[];
}

export interface JobPostingResult {
  platform: string;
  status: "posted" | "failed" | "draft";
  jobId?: string;
  jobUrl?: string;
  error?: string;
  postedAt?: string;
}

// ── 查看在招岗位相关类型 ──

export interface ActiveJob {
  jobId: string;
  platform: "JobStreet" | "AJobThing";
  title: string;
  location: string;
  status: "active" | "draft" | "expired" | "closed";
  applicantCount: number;
  postedAt?: string;
  jobUrl?: string;
}

export interface JobApplicant {
  applicantId: string;
  platform: "JobStreet" | "AJobThing";
  jobId: string;
  name: string;
  currentTitle?: string;
  experienceYears?: number;
  appliedAt?: string;
  resumeUrl?: string;
  profileUrl?: string;
}

export interface ActiveJobsState {
  step: "list_jobs" | "list_applicants" | "done";
  jobs?: ActiveJob[];
  selectedJobIndex?: number;
  applicants?: JobApplicant[];
}
