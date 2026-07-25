import type { AiProvider, ChatMessage } from "./ai-provider.interface";
import { logger } from "../logger";
import { execute } from "../db/postgres";

const CHAT_MODEL = process.env.AI_CHAT_MODEL || "openai/chatgpt-5.5-latest";
const LONG_MODEL = process.env.AI_LONG_MODEL || CHAT_MODEL;
const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || "openai/text-embedding-3-small";
// 主 LLM 端点(chat/completions)：AI_BASE_URL/AI_API_KEY 可切换 provider（默认 OpenRouter；
// 现切 Groq，OpenAI 兼容）。Embedding 固定走 OpenRouter（Groq 无 embeddings 端点；OR 无额度时
// 意图路由的 embedding 层自捕获回落，不影响主流程）。
const CHAT_BASE_URL = process.env.AI_BASE_URL || "https://openrouter.ai/api/v1";
const CHAT_API_KEY = process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY || "";
const EMBED_BASE_URL = process.env.AI_EMBED_BASE_URL || "https://openrouter.ai/api/v1";
const EMBED_API_KEY = process.env.AI_EMBED_API_KEY || process.env.OPENROUTER_API_KEY || "";
const PRIMARY_LABEL = /groq\.com/.test(CHAT_BASE_URL) ? "Groq" : /openrouter/.test(CHAT_BASE_URL) ? "OpenRouter" : "PrimaryLLM";

// 超时分档：短调用（意图路由/分类）60s 防卡死；长文本生成（复盘/JD/预测修正，输出数千 token）
// 网络慢时 60s 不够，给 150s。可用 env 覆盖。
const SHORT_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 60_000;
const LONG_TIMEOUT_MS = Number(process.env.AI_LONG_TIMEOUT_MS) || 150_000;

async function apiFetch(baseUrl: string, apiKey: string, path: string, body: Record<string, unknown>, timeoutMs = SHORT_TIMEOUT_MS): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text();
    // 保留状态码(402/429/503)在消息里，兜底/重试逻辑据此判定。
    throw new Error(`LLM API error ${res.status}: ${text}`);
  }
  return res.json();
}
// chat/completions 走主 provider（Groq/OpenRouter）；embeddings 固定走 OpenRouter。
const chatFetch = (path: string, body: Record<string, unknown>, timeoutMs = SHORT_TIMEOUT_MS) => apiFetch(CHAT_BASE_URL, CHAT_API_KEY, path, body, timeoutMs);
const embedFetch = (path: string, body: Record<string, unknown>) => apiFetch(EMBED_BASE_URL, EMBED_API_KEY, path, body);

// ── Gemini 兜底 ──
// OpenRouter 失败/余额不足(402) 时直连 Google Gemini。返回 OpenRouter 兼容形状
// （{ choices:[{message:{content}}], usage }）以便调用点无缝复用原解析。
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";

function geminiEnabled(): boolean {
  return GEMINI_KEY.length > 0;
}

async function geminiCallOnce(
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<any> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const content = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
  return {
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: data.usageMetadata?.promptTokenCount ?? null,
      completion_tokens: data.usageMetadata?.candidatesTokenCount ?? null,
      total_tokens: data.usageMetadata?.totalTokenCount ?? null,
    },
    _fallback: `gemini(${model})`,
  };
}

// Gemini 兜底：GEMINI_FALLBACK_MODEL 可逗号分隔多模型，逐个尝试；
// 每个模型对瞬时过载(503/429/UNAVAILABLE)退避重试最多 3 次。
async function geminiFallback(
  messages: { role: string; content: string }[],
  opts: { maxTokens: number; temperature: number; jsonMode: boolean },
  timeoutMs: number,
): Promise<any> {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => ({ text: m.content }));
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: opts.maxTokens,
      temperature: opts.temperature,
      // 关闭思考：直接出结果，避免思考 token 吃光输出预算
      thinkingConfig: { thinkingBudget: 0 },
      ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (systemParts.length) body.systemInstruction = { parts: systemParts };

  const models = GEMINI_MODEL.split(",").map((s) => s.trim()).filter(Boolean);
  let lastError: Error | null = null;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await geminiCallOnce(model, body, timeoutMs);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message;
        const transient = msg.includes("503") || msg.includes("429") || msg.includes("UNAVAILABLE") || msg.includes("overloaded");
        if (!transient) break; // 非瞬时错误：换下一个模型
        if (attempt < 2) {
          logger.warn("Gemini overloaded, retrying", { model, attempt: attempt + 1 });
          await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
        }
      }
    }
  }
  throw lastError || new Error("geminiFallback: all models failed");
}

// 先走 OpenRouter，失败(含 402 余额不足)时兜底 Gemini。返回统一的 OpenRouter 形状。
async function completeWithFallback(
  messages: { role: string; content: string }[],
  body: Record<string, unknown>,
  timeoutMs: number,
  jsonMode: boolean,
): Promise<any> {
  try {
    return await chatFetch("/chat/completions", body, timeoutMs);
  } catch (err) {
    if (!geminiEnabled()) throw err;
    logger.warn(`${PRIMARY_LABEL} failed, falling back to Gemini`, {
      model: GEMINI_MODEL,
      error: String(err).slice(0, 160),
    });
    return geminiFallback(
      messages,
      {
        maxTokens: (body.max_tokens as number) ?? 4096,
        temperature: (body.temperature as number) ?? 0,
        jsonMode,
      },
      timeoutMs,
    );
  }
}

/** G3d: fire-and-forget 调用日志落库（离线回放复盘用）。写失败只 warn，绝不影响主流程。 */
function logAiCall(entry: {
  caller: string;
  model: string;
  prompt: string;
  response: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
}): void {
  execute(
    "INSERT INTO ai_call_log (caller, model, prompt, response, prompt_tokens, completion_tokens, latency_ms) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [entry.caller, entry.model, entry.prompt, entry.response, entry.promptTokens, entry.completionTokens, entry.latencyMs],
  ).catch((err) => logger.warn("ai_call_log write failed", { error: String(err) }));
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
    const data = await embedFetch("/embeddings", {
      model: EMBEDDING_MODEL,
      input: text,
    });
    return data.data[0].embedding;
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    const data = await embedFetch("/embeddings", {
      model: EMBEDDING_MODEL,
      input: texts,
    });
    return data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((d: any) => d.embedding);
  }

  async chatCompletionMessages(messages: ChatMessage[], options?: { maxTokens?: number; model?: string; jsonMode?: boolean }): Promise<string> {
    return this.chatMessagesInternal(messages, options, "chatCompletionMessages");
  }

  async chatCompletion(prompt: string, maxTokens = 200, model?: string): Promise<string> {
    return this.chatMessagesInternal([{ role: "user", content: prompt }], { maxTokens, model }, "chatCompletion");
  }

  private async chatMessagesInternal(
    messages: ChatMessage[],
    options: { maxTokens?: number; model?: string; jsonMode?: boolean } | undefined,
    caller: string,
  ): Promise<string> {
    const model = options?.model || CHAT_MODEL;
    const tokens = Math.max(16, options?.maxTokens ?? 200);
    const jsonMode = options?.jsonMode === true;
    logger.info(`${PRIMARY_LABEL} LLM call (messages)`, { model, maxTokens: tokens, messageCount: messages.length });
    const started = Date.now();
    // 长文本生成用长超时（复盘输出可达数千 token，60s 常不够）
    const timeoutMs = tokens >= 1000 ? LONG_TIMEOUT_MS : SHORT_TIMEOUT_MS;
    const data = await completeWithFallback(messages, {
      model,
      messages,
      temperature: 0,
      max_tokens: tokens,
      // 期望 JSON 时告诉两边模型返回 JSON（否则 Gemini 兜底会返大白话，路由解析失败）
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }, timeoutMs, jsonMode);
    const content = data.choices[0]?.message?.content || "";
    const usedModel = data._fallback ? `gemini(${GEMINI_MODEL})` : model;
    logger.info(`${PRIMARY_LABEL} LLM response`, { model: usedModel, tokens: data.usage?.total_tokens, response: content.slice(0, 200) });
    logAiCall({
      caller,
      model: usedModel,
      prompt: messages.map((m) => `[${m.role}] ${m.content}`).join("\n"),
      response: content,
      promptTokens: data.usage?.prompt_tokens ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
      latencyMs: Date.now() - started,
    });
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

    logger.info(`${PRIMARY_LABEL} JSON call`, { model, prompt: options.prompt.slice(0, 120) });

    const maxRetries = 3;
    let lastError: Error | null = null;
    const started = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const jsonTokens = options.maxTokens ?? 4096;
        const data = await chatFetch("/chat/completions", {
          model,
          messages,
          temperature: options.temperature ?? 0.1,
          top_p: options.topP ?? 0.95,
          max_tokens: jsonTokens,
          response_format: { type: "json_object" },
        }, jsonTokens >= 1000 ? LONG_TIMEOUT_MS : SHORT_TIMEOUT_MS);
        const content = data.choices[0]?.message?.content || "";
        logger.info(`${PRIMARY_LABEL} JSON response`, { model, tokens: data.usage?.total_tokens });
        logAiCall({
          caller: "jsonCompletion",
          model,
          prompt: messages.map((m) => `[${m.role}] ${m.content}`).join("\n"),
          response: content,
          promptTokens: data.usage?.prompt_tokens ?? null,
          completionTokens: data.usage?.completion_tokens ?? null,
          latencyMs: Date.now() - started,
        });
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

    // OpenRouter 全部失败（含 402 余额不足）→ 兜底 Gemini
    if (geminiEnabled()) {
      logger.warn(`${PRIMARY_LABEL} JSON failed, falling back to Gemini`, {
        model: GEMINI_MODEL,
        error: String(lastError?.message).slice(0, 160),
      });
      try {
        const jsonTokens = options.maxTokens ?? 4096;
        const data = await geminiFallback(
          messages,
          { maxTokens: jsonTokens, temperature: options.temperature ?? 0.1, jsonMode: true },
          jsonTokens >= 1000 ? LONG_TIMEOUT_MS : SHORT_TIMEOUT_MS,
        );
        const content = data.choices[0]?.message?.content || "";
        logAiCall({
          caller: "jsonCompletion",
          model: `gemini(${GEMINI_MODEL})`,
          prompt: messages.map((m) => `[${m.role}] ${m.content}`).join("\n"),
          response: content,
          promptTokens: data.usage?.prompt_tokens ?? null,
          completionTokens: data.usage?.completion_tokens ?? null,
          latencyMs: Date.now() - started,
        });
        return content;
      } catch (gErr) {
        logger.error("Gemini fallback also failed", { error: String(gErr).slice(0, 160) });
      }
    }

    throw lastError || new Error("jsonCompletion: unexpected state");
  }
}

export const openrouterProvider = new OpenRouterProvider();
