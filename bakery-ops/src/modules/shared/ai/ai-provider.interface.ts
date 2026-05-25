export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface AiProvider {
  chatCompletion(prompt: string, maxTokens?: number): Promise<string>;
  chatCompletionLong(prompt: string): Promise<string>;
  chatCompletionMessages(messages: ChatMessage[], options?: { maxTokens?: number }): Promise<string>;
  getEmbedding(text: string): Promise<number[]>;
  getEmbeddings(texts: string[]): Promise<number[][]>;
}
