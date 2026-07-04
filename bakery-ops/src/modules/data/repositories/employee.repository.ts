import { query, execute } from "@/modules/shared/db/postgres";
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

// Full EmployeeRow projection. Timestamps cast to text so they stay strings.
const SELECT_COLS =
  "id, name, phone, email, source, source_url, candidate_id, job_title, department, store_id, status, " +
  "applied_at::text AS applied_at, interviewed_at::text AS interviewed_at, hired_at::text AS hired_at, resigned_at::text AS resigned_at, " +
  "skills, languages, education, experience_summary, location, resume_file_id, resume_text, metadata, " +
  "created_at::text AS created_at, updated_at::text AS updated_at";

// Columns allowed in dynamic updates (updateStatus `extra`).
const UPDATABLE_COLS = new Set([
  "name", "phone", "email", "source", "source_url", "candidate_id", "job_title",
  "department", "store_id", "status", "applied_at", "interviewed_at", "hired_at",
  "resigned_at", "skills", "languages", "education", "experience_summary",
  "location", "resume_file_id", "resume_text", "metadata",
]);

// postgres.js returns jsonb columns as raw JSON strings; parse back to objects.
function mapRow(row: EmployeeRow): EmployeeRow {
  if (typeof row.metadata === "string") {
    row.metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  }
  return row;
}

export class EmployeeRepository {
  async create(data: Partial<EmployeeRow>): Promise<EmployeeRow | null> {
    try {
      const rows = await query<EmployeeRow>(
        `INSERT INTO employees
           (name, phone, email, source, source_url, candidate_id, job_title, department, store_id, status,
            applied_at, interviewed_at, hired_at, resigned_at, skills, languages, education,
            experience_summary, location, resume_file_id, resume_text, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
         RETURNING ${SELECT_COLS}`,
        [
          data.name,
          data.phone ?? null,
          data.email ?? null,
          data.source || "manual",
          data.source_url ?? null,
          data.candidate_id ?? null,
          data.job_title ?? null,
          data.department ?? null,
          data.store_id ?? null,
          data.status || "candidate",
          data.applied_at ?? null,
          data.interviewed_at ?? null,
          data.hired_at ?? null,
          data.resigned_at ?? null,
          data.skills || [],
          data.languages || [],
          data.education ?? null,
          data.experience_summary ?? null,
          data.location ?? null,
          data.resume_file_id ?? null,
          data.resume_text ?? null,
          JSON.stringify(data.metadata || {}),
        ],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    } catch (e) {
      logger.error("Failed to create employee", { error: (e as Error).message });
      return null;
    }
  }

  async getById(id: string): Promise<EmployeeRow | null> {
    const rows = await query<EmployeeRow>(
      `SELECT ${SELECT_COLS} FROM employees WHERE id = ?`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findByPhone(phone: string): Promise<EmployeeRow | null> {
    const rows = await query<EmployeeRow>(
      `SELECT ${SELECT_COLS} FROM employees WHERE phone = ? ORDER BY updated_at DESC LIMIT 1`,
      [phone],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findByName(name: string): Promise<EmployeeRow | null> {
    const rows = await query<EmployeeRow>(
      `SELECT ${SELECT_COLS} FROM employees WHERE name ILIKE ? ORDER BY created_at DESC LIMIT 1`,
      [`%${name}%`],
    );
    return rows[0] ? mapRow(rows[0]) : null;
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
    const rows = await query<EmployeeRow>(
      `SELECT ${SELECT_COLS} FROM employees WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
      ["candidate", limit],
    );
    return rows.map(mapRow);
  }

  async listRecent(limit = 50): Promise<EmployeeRow[]> {
    return query<EmployeeRow>(
      "SELECT id, name, job_title, status, store_id FROM employees ORDER BY updated_at DESC LIMIT ?",
      [limit],
    );
  }

  async getByStatus(status: string): Promise<EmployeeRow[]> {
    const rows = await query<EmployeeRow>(
      `SELECT ${SELECT_COLS} FROM employees WHERE status = ?`,
      [status],
    );
    return rows.map(mapRow);
  }

  async updateStatus(
    id: string,
    status: string,
    extra?: Partial<EmployeeRow>,
  ): Promise<void> {
    const setClauses = ["status = ?", "updated_at = ?"];
    const params: unknown[] = [status, new Date().toISOString()];
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        if (!UPDATABLE_COLS.has(key)) continue;
        if (key === "metadata") {
          setClauses.push(`${key} = ?::jsonb`);
          params.push(JSON.stringify(value));
        } else {
          setClauses.push(`${key} = ?`);
          params.push(value ?? null);
        }
      }
    }
    params.push(id);
    try {
      await execute(
        `UPDATE employees SET ${setClauses.join(", ")} WHERE id = ?`,
        params,
      );
    } catch (e) {
      logger.error("Failed to update employee status", { id, error: (e as Error).message });
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
    const existingRows = await query<{ id: string }>(
      "SELECT id FROM employees WHERE name = ? AND source = ? LIMIT 1",
      [candidate.name, candidate.source],
    );
    const existing = existingRows[0];

    if (existing) {
      // 更新 metadata（回填 rawData 等信息）
      if (candidate.rawData || candidate.matchScore) {
        await execute(
          "UPDATE employees SET metadata = ?::jsonb, updated_at = ? WHERE id = ?",
          [
            JSON.stringify({
              rawData: candidate.rawData || {},
              matchScore: candidate.matchScore,
              scoreReason: candidate.scoreReason,
              recruitmentJdTitle: candidate.recruitmentJdTitle,
              recruitmentJdLocation: candidate.recruitmentJdLocation,
            }),
            new Date().toISOString(),
            existing.id,
          ],
        );
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
    try {
      await execute(
        "UPDATE employees SET metadata = ?::jsonb, updated_at = ? WHERE id = ?",
        [JSON.stringify(merged), new Date().toISOString(), id],
      );
    } catch (e) {
      logger.error("Failed to update employee metadata", { id, error: (e as Error).message });
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
    const rows = await query<{ status: string; hired_at?: string; resigned_at?: string }>(
      "SELECT status, hired_at::text AS hired_at, resigned_at::text AS resigned_at FROM employees",
    );
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
