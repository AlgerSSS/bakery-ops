import { openrouterProvider } from "../../shared/ai/openrouter.provider";
import type { BuildPromptResult } from "./prompt-engine";

export async function generateJsonFromPrompt(built: BuildPromptResult, userPrompt?: string): Promise<string> {
  return openrouterProvider.jsonCompletion({
    systemInstruction: built.systemInstruction,
    prompt: userPrompt || built.prompt,
    model: built.model || undefined, // G3c: DB prompt_template.model 生效；为空回落 provider 默认（AI_LONG_MODEL/AI_CHAT_MODEL）
    temperature: built.temperature,
    topP: built.topP,
  });
}
