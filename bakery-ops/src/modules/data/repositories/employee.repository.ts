import { supabase } from "../supabase";
import { logger } from "../../shared/logger";

export interface EmployeeRow {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  source: string;
  source_url?: string;
  candidate_id?: string;
  job_title?: string;
  department?: string;
  store_id?: string;
  status: string;
  applied_at?: string;
  interviewed_at?: string;
  hired_at?: string;
  resigned_at?: string;
  skills: string[];
  languages: string[];
  education?: string;
  experience_summary?: string;
  location?: string;
  resume_file_id?: string;
  resume_text?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export class EmployeeRepository {
  async create(data: Partial<EmployeeRow>): Promise<EmployeeRow | null> {
    const { data: row, error } = await supabase
      .from("employees")
      .insert({
        name: data.name,
        phone: data.phone,
        email: data.email,
        source: data.source || "manual",
        source_url: data.source_url,
        candidate_id: data.candidate_id,
        job_title: data.job_title,
        department: data.department,
        store_id: data.store_id,
        status: data.status || "candidate",
        skills: data.skills || [],
        languages: data.languages || [],
        education: data.education,
        experience_summary: data.experience_summary,
        location: data.location,
        resume_file_id: data.resume_file_id,
        resume_text: data.resume_text,
        metadata: data.metadata || {},
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to create employee", { error: error.message });
      return null;
    }
    return row as EmployeeRow;
  }
  async getById(id: string): Promise<EmployeeRow | null> {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return null;
    return data as EmployeeRow;
  }

  async findByName(name: string): Promise<EmployeeRow | null> {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .ilike("name", `%${name}%`)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data as EmployeeRow;
  }

  async findByNames(names: string[]): Promise<EmployeeRow[]> {
    if (names.length === 0) return [];
    const results: EmployeeRow[] = [];
    for (const name of names) {
      const row = await this.findByName(name);
      if (row) results.push(row);
    }
    return results;
  }

  async findRecentCandidates(limit = 10): Promise<EmployeeRow[]> {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("status", "candidate")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data || []) as EmployeeRow[];
  }

  async listRecent(limit = 50): Promise<EmployeeRow[]> {
    const { data, error } = await supabase
      .from("employees")
      .select("id, name, job_title, status, store_id")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data || []) as EmployeeRow[];
  }

  async getByStatus(status: string): Promise<EmployeeRow[]> {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("status", status);

    if (error) return [];
    return (data || []) as EmployeeRow[];
  }

  async updateStatus(
    id: string,
    status: string,
    extra?: Partial<EmployeeRow>,
  ): Promise<void> {
    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
      ...extra,
    };
    const { error } = await supabase
      .from("employees")
      .update(update)
      .eq("id", id);

    if (error) {
      logger.error("Failed to update employee status", { id, error: error.message });
    }
  }

  async upsertFromCandidate(candidate: {
    candidateId: string;
    name: string;
    source: string;
    sourceUrl: string;
    skills: string[];
    languages: string[];
    education?: string;
    experience?: string;
    location?: string;
    currentTitle?: string;
    resumeFileId?: string;
    summary?: string;
    rawData?: Record<string, unknown>;
    matchScore?: number;
    scoreReason?: string;
    recruitmentJdTitle?: string;
    recruitmentJdLocation?: string;
  }): Promise<EmployeeRow | null> {
    // Check if already exists by name + source
    const { data: existing } = await supabase
      .from("employees")
      .select("id")
      .eq("name", candidate.name)
      .eq("source", candidate.source)
      .limit(1)
      .single();

    if (existing) {
      // 更新 metadata（回填 rawData 等信息）
      if (candidate.rawData || candidate.matchScore) {
        await supabase
          .from("employees")
          .update({
            metadata: {
              rawData: candidate.rawData || {},
              matchScore: candidate.matchScore,
              scoreReason: candidate.scoreReason,
              recruitmentJdTitle: candidate.recruitmentJdTitle,
              recruitmentJdLocation: candidate.recruitmentJdLocation,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }
      return existing as EmployeeRow;
    }

    return this.create({
      name: candidate.name,
      source: candidate.source,
      source_url: candidate.sourceUrl,
      candidate_id: candidate.candidateId,
      job_title: candidate.currentTitle,
      skills: candidate.skills,
      languages: candidate.languages,
      education: candidate.education,
      experience_summary: candidate.experience,
      location: candidate.location,
      resume_file_id: candidate.resumeFileId,
      resume_text: candidate.summary,
      status: "candidate",
      applied_at: new Date().toISOString(),
      metadata: {
        rawData: candidate.rawData || {},
        matchScore: candidate.matchScore,
        scoreReason: candidate.scoreReason,
        recruitmentJdTitle: candidate.recruitmentJdTitle,
        recruitmentJdLocation: candidate.recruitmentJdLocation,
      },
    });
  }

  async updateMetadata(id: string, patch: Record<string, unknown>): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) return;
    const merged = { ...existing.metadata, ...patch };
    const { error } = await supabase
      .from("employees")
      .update({ metadata: merged, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      logger.error("Failed to update employee metadata", { id, error: error.message });
    }
  }

  async updateLarkRecordId(id: string, larkRecordId: string): Promise<void> {
    await this.updateMetadata(id, { lark_record_id: larkRecordId });
  }

  async getStats(): Promise<{
    total: number;
    active: number;
    resigned: number;
    avgTenure: number;
    resignedThisMonth: number;
  }> {
    const { data: all } = await supabase
      .from("employees")
      .select("status, hired_at, resigned_at");

    const rows = (all || []) as Array<{ status: string; hired_at?: string; resigned_at?: string }>;
    const active = rows.filter((r) => r.status === "hired").length;
    const resigned = rows.filter((r) => r.status === "resigned").length;

    // Average tenure for resigned employees
    let totalTenure = 0;
    let tenureCount = 0;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let resignedThisMonth = 0;
    for (const r of rows) {
      if (r.status === "resigned" && r.hired_at && r.resigned_at) {
        const months =
          (new Date(r.resigned_at).getTime() - new Date(r.hired_at).getTime()) /
          (1000 * 60 * 60 * 24 * 30);
        totalTenure += months;
        tenureCount++;
        if (new Date(r.resigned_at) >= monthStart) resignedThisMonth++;
      }
    }

    return {
      total: rows.length,
      active,
      resigned,
      avgTenure: tenureCount > 0 ? Math.round(totalTenure / tenureCount * 10) / 10 : 0,
      resignedThisMonth,
    };
  }
}

export const employeeRepository = new EmployeeRepository();
