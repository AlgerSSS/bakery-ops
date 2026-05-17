export interface ParsedResume {
  gender?: "male" | "female" | "other";
  age?: number;
  education_level?: "high_school" | "diploma" | "bachelor" | "master" | "phd";
  school?: string;
  major?: string;
  graduation_year?: number;
  work_experience: WorkExperience[];
  project_experience: ProjectExperience[];
  total_years_experience?: number;
  salary_expectation?: { min?: number; max?: number; currency: string };
  current_salary?: { amount?: number; currency: string };
  job_level?: string;
  certifications: string[];
  nationality?: string;
  availability?: string;
}

export interface WorkExperience {
  company: string;
  title: string;
  start_date?: string;
  end_date?: string;
  duration_months?: number;
  description?: string;
  industry?: string;
}

export interface ProjectExperience {
  name: string;
  role?: string;
  description?: string;
  technologies?: string[];
}
