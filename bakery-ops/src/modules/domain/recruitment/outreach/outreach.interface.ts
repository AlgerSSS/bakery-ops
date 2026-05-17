import type { ScoredCandidate, ParsedJD, OutreachBatchResult } from "../types";

export interface OutreachMessage {
  subject: string;
  body: string;
}

export interface OutreachConnector {
  readonly platformName: string;
  sendMessages(
    candidates: ScoredCandidate[],
    jd: ParsedJD,
    message: OutreachMessage,
  ): Promise<OutreachBatchResult>;
  getRemainingBudget(): Promise<number | null>;
}
