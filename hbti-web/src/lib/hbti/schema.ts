import { z } from "zod";

import type { HbtiAnswers } from "@/content/types";

export const hbtiAnswersSchema = z.strictObject({
  q1: z.enum(["iced", "hot"]),
  q2: z.enum(["light", "strong"]),
  q3: z.enum(["bitter", "dolce"]),
  q4: z.enum(["alone", "together"]),
  q5: z.enum(["morning", "night"]),
  q6: z.enum(["drink", "dessert", "bakery"]),
}) satisfies z.ZodType<HbtiAnswers>;

export type HbtiAnswersInput = z.infer<typeof hbtiAnswersSchema>;
