export interface AiProvider {
  chatCompletion(prompt: string, maxTokens?: number): Promise<string>;
  chatCompletionLong(prompt: string): Promise<string>;
  getEmbedding(text: string): Promise<number[]>;
  getEmbeddings(texts: string[]): Promise<number[][]>;
}
