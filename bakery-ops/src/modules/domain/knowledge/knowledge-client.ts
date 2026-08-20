import { readFileSync } from "node:fs";

import { aiProvider } from "../ai/ai-provider";
import { logger } from "../../shared/logger";
import { LightRAGClient } from "./lightrag-client";

export type KnowledgeQueryMode = "naive" | "local" | "global" | "hybrid";

export interface KnowledgeBackend {
  isAvailable(): Promise<boolean>;
  query(question: string, mode?: KnowledgeQueryMode): Promise<string | null>;
  ingest(text: string, metadata?: Record<string, unknown>): Promise<boolean>;
}

type FetchLike = typeof fetch;
type Embed = (text: string) => Promise<number[]>;

interface SupabaseKnowledgeClientOptions {
  baseUrl?: string;
  serviceKey?: string;
  spaceIds?: string[];
  modelVersion?: string;
  fetchFn?: FetchLike;
  embed?: Embed;
}

interface KnowledgeChunk {
  title: string;
  page_from: number | null;
  page_to: number | null;
  section_path: string[] | null;
  content: string;
  hybrid_score: number;
}

const DEFAULT_INTERNAL_SPACE_ID = "10000000-0000-7000-8000-000000000001";

function readSecret(name: string): string {
  const direct = process.env[name]?.trim();
  if (direct) return direct;

  const path = process.env[`${name}_FILE`]?.trim();
  if (!path) return "";
  try {
    return readFileSync(path, "utf8").trim();
  } catch (error) {
    logger.error("Knowledge secret file cannot be read", { name, path, error: String(error) });
    return "";
  }
}

function parseSpaceIds(value?: string): string[] {
  const ids = (value || DEFAULT_INTERNAL_SPACE_ID)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : [DEFAULT_INTERNAL_SPACE_ID];
}

function formatChunks(rows: KnowledgeChunk[]): string | null {
  if (rows.length === 0) return null;

  return rows
    .map((row, index) => {
      const page = row.page_from
        ? row.page_to && row.page_to !== row.page_from
          ? `第 ${row.page_from}-${row.page_to} 页`
          : `第 ${row.page_from} 页`
        : "页码未知";
      const section = row.section_path?.length ? `，${row.section_path.join(" / ")}` : "";
      return `[资料 ${index + 1}｜${row.title}｜${page}${section}]\n${row.content.slice(0, 1800)}`;
    })
    .join("\n\n");
}

/**
 * R6 Green 的只读知识检索客户端。
 *
 * 文档写入必须走 data-platform worker 的受控流水线；本客户端故意不提供任意文本入库，
 * 避免员工、薪资或合同文本绕过分级直接进入通用知识空间。
 */
export class SupabaseKnowledgeClient implements KnowledgeBackend {
  private readonly baseUrl: string;
  private readonly serviceKey: string;
  private readonly spaceIds: string[];
  private readonly modelVersion: string;
  private readonly fetchFn: FetchLike;
  private readonly embed: Embed;

  constructor(options: SupabaseKnowledgeClientOptions = {}) {
    this.baseUrl = (options.baseUrl || process.env.R6_SUPABASE_URL || "").replace(/\/$/, "");
    this.serviceKey = options.serviceKey || readSecret("R6_SUPABASE_SERVICE_KEY");
    this.spaceIds = options.spaceIds || parseSpaceIds(process.env.KNOWLEDGE_SPACE_IDS);
    this.modelVersion = options.modelVersion || process.env.AI_EMBEDDING_MODEL || "openai/text-embedding-3-small";
    this.fetchFn = options.fetchFn || fetch;
    this.embed = options.embed || ((text) => aiProvider.getEmbedding(text));
  }

  async isAvailable(): Promise<boolean> {
    if (!this.baseUrl || !this.serviceKey || this.spaceIds.length === 0) return false;
    try {
      const response = await this.fetchFn(`${this.baseUrl}/rest/v1/`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async query(question: string, _mode: KnowledgeQueryMode = "hybrid"): Promise<string | null> {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || !this.baseUrl || !this.serviceKey) return null;

    try {
      const embedding = await this.embed(cleanQuestion);
      const response = await this.fetchFn(`${this.baseUrl}/rest/v1/rpc/ai_search_knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers() },
        body: JSON.stringify({
          p_query: cleanQuestion,
          p_query_embedding: embedding,
          p_limit: 4,
          p_space_ids: this.spaceIds,
          p_model_version: this.modelVersion,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        logger.warn("Supabase knowledge query failed", { status: response.status });
        return null;
      }
      const rows = (await response.json()) as KnowledgeChunk[];
      return formatChunks(rows);
    } catch (error) {
      logger.warn("Supabase knowledge query error", { error: String(error) });
      return null;
    }
  }

  async ingest(_text: string, _metadata?: Record<string, unknown>): Promise<boolean> {
    logger.warn("Unclassified text ingest blocked; use the classified data-platform upload pipeline");
    return false;
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
    };
  }
}

export class KnowledgeClient implements KnowledgeBackend {
  private readonly backend: KnowledgeBackend;
  private readonly backendName: "lightrag" | "supabase";

  constructor(backendName = process.env.KNOWLEDGE_BACKEND || "lightrag") {
    this.backendName = backendName === "supabase" ? "supabase" : "lightrag";
    this.backend = this.backendName === "supabase" ? new SupabaseKnowledgeClient() : new LightRAGClient();
  }

  isAvailable(): Promise<boolean> {
    return this.backend.isAvailable();
  }

  query(question: string, mode: KnowledgeQueryMode = "hybrid"): Promise<string | null> {
    return this.backend.query(question, mode);
  }

  async ingest(text: string, metadata?: Record<string, unknown>): Promise<boolean> {
    if (this.backendName === "supabase") return this.backend.ingest(text, metadata);
    if (process.env.KNOWLEDGE_UNCLASSIFIED_INGEST_ENABLED === "false") {
      logger.warn("Unclassified LightRAG ingest blocked by explicit configuration");
      return false;
    }
    return this.backend.ingest(text, metadata);
  }
}

export const knowledgeClient = new KnowledgeClient();
