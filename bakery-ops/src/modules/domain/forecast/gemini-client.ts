import { openrouterProvider } from "../../shared/ai/openrouter.provider";
import type { BuildPromptResult } from "./prompt-engine";

export async function generateJsonFromPrompt(built: BuildPromptResult, userPrompt?: string): Promise<string> {
  return openrouterProvider.jsonCompletion({
    systemInstruction: built.systemInstruction,
    prompt: userPrompt || built.prompt,
    model: undefined,
    temperature: built.temperature,
    topP: built.topP,
  });
}
