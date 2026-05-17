import { logger } from "../../shared/logger";

const LIGHTRAG_URL = process.env.LIGHTRAG_URL || "http://localhost:8020";

export class LightRAGClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || LIGHTRAG_URL;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const data = await res.json() as { rag_ready: boolean };
      return data.rag_ready;
    } catch {
      return false;
    }
  }

  async ingest(text: string, metadata?: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, metadata }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        logger.warn("LightRAG ingest failed", { status: res.status });
        return false;
      }
      const data = await res.json() as { chars: number };
      logger.info("LightRAG ingested", { chars: data.chars });
      return true;
    } catch (err) {
      logger.warn("LightRAG ingest error (service may be offline)", { error: String(err) });
      return false;
    }
  }

  async query(question: string, mode: "naive" | "local" | "global" | "hybrid" = "hybrid"): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, mode }),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        logger.warn("LightRAG query failed", { status: res.status });
        return null;
      }
      const data = await res.json() as { answer: string };
      return data.answer;
    } catch (err) {
      logger.warn("LightRAG query error (service may be offline)", { error: String(err) });
      return null;
    }
  }
}

export const lightragClient = new LightRAGClient();
