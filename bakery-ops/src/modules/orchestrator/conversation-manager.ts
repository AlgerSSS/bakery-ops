export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

const MAX_HISTORY = 20;

export class ConversationManager {
  private chatHistory = new Map<string, ChatHistoryEntry[]>();

  getHistory(conversationId: string): ChatHistoryEntry[] {
    if (!this.chatHistory.has(conversationId)) {
      this.chatHistory.set(conversationId, []);
    }
    return this.chatHistory.get(conversationId)!;
  }

  addMessage(conversationId: string, entry: ChatHistoryEntry): void {
    const history = this.getHistory(conversationId);
    history.push(entry);
  }

  trimHistory(conversationId: string): void {
    const history = this.chatHistory.get(conversationId);
    if (history && history.length > MAX_HISTORY) {
      this.chatHistory.set(conversationId, history.slice(-MAX_HISTORY));
    }
  }
}
