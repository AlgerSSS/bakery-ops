import type { AiProvider } from "./ai-provider.interface";
import { logger } from "../logger";

const CHAT_MODEL = process.env.AI_CHAT_MODEL || "openai/chatgpt-5.5-latest";
const LONG_MODEL = process.env.AI_LONG_MODEL || CHAT_MODEL;
const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || "openai/text-embedding-3-small";
const BASE_URL = "https://openrouter.ai/api/v1";
const API_KEY = process.env.OPENROUTER_API_KEY || "";

async function openrouterFetch(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${text}`);
  }
  return res.json();
}

export interface JsonCompletionOptions {
  systemInstruction?: string;
  prompt: string;
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export class OpenRouterProvider implements AiProvider {
  async getEmbedding(text: string): Promise<number[]> {
    const data = await openrouterFetch("/embeddings", {
      model: EMBEDDING_MODEL,
      input: text,
    });
    return data.data[0].embedding;
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    const data = await openrouterFetch("/embeddings", {
      model: EMBEDDING_MODEL,
      input: texts,
    });
    return data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((d: any) => d.embedding);
  }

  async chatCompletion(prompt: string, maxTokens = 200): Promise<string> {
    const tokens = Math.max(16, maxTokens);
    logger.info("OpenRouter LLM call", { model: CHAT_MODEL, maxTokens: tokens, prompt: prompt.slice(0, 120) });
    const data = await openrouterFetch("/chat/completions", {
      model: CHAT_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: tokens,
    });
    const content = data.choices[0]?.message?.content || "";
    logger.info("OpenRouter LLM response", { model: CHAT_MODEL, tokens: data.usage?.total_tokens, response: content.slice(0, 200) });
    return content;
  }

  async chatCompletionLong(prompt: string): Promise<string> {
    return this.chatCompletion(prompt, 4096);
  }

  async jsonCompletion(options: JsonCompletionOptions): Promise<string> {
    const model = options.model || LONG_MODEL;
    const messages: { role: string; content: string }[] = [];
    if (options.systemInstruction) {
      messages.push({ role: "system", content: options.systemInstruction });
    }
    messages.push({ role: "user", content: options.prompt });

    logger.info("OpenRouter JSON call", { model, prompt: options.prompt.slice(0, 120) });

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const data = await openrouterFetch("/chat/completions", {
          model,
          messages,
          temperature: options.temperature ?? 0.1,
          top_p: options.topP ?? 0.95,
          max_tokens: options.maxTokens ?? 4096,
          response_format: { type: "json_object" },
        });
        const content = data.choices[0]?.message?.content || "";
        logger.info("OpenRouter JSON response", { model, tokens: data.usage?.total_tokens });
        return content;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const msg = lastError.message;
        const isRetryable = msg.includes("503") || msg.includes("429") || msg.includes("overloaded");
        if (!isRetryable || attempt === maxRetries) break;
        const delay = Math.pow(2, attempt + 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error("jsonCompletion: unexpected state");
  }
}

export const openrouterProvider = new OpenRouterProvider();
