import { z } from "zod";

import type { HbtiAnswers } from "@/content/types";

const temperature = z.enum(["iced", "hot"]);
const strength = z.enum(["light", "strong"]);
const sweetness = z.enum(["bitter", "dolce"]);
const social = z.enum(["alone", "together"]);

/**
 * 完成请求仍必须带齐原 13 题。新版另有 q14/q15 两道食物场景题，
 * 两题必须同时提交；同时缺失只兼容升级时仍打开的旧客户端。
 *
 * 原 13 题不放宽成可选，避免更早的 6 题客户端静默提交不完整画像。
 * 新版 UI 另行要求 15 题齐全后才能进入结果页。
 *
 * 兼容只留在两处，都不经过本 schema：
 *   · 已存的完成记录里只有算好的 code，没有 answers，回读不受影响；
 *   · 旧草稿恢复后由前端补答新题，最终提交仍是 13 题齐全。
 * scoreHbti 内部对缺票仍有退化逻辑，那是给单元测试与防御用的，不是对外契约。
 */
export const hbtiAnswersSchema = z.strictObject({
  q1: temperature,
  q2: strength,
  q3: sweetness,
  q4: social,
  q5: z.enum(["morning", "night"]),
  q6: z.enum(["drink", "dessert", "bakery"]),
  q7: temperature,
  q8: strength,
  q9: strength,
  q10: sweetness,
  q11: sweetness,
  q12: social,
  q13: social,
  q14: z.enum(["toasted", "fruity", "cocoa", "savoury"]).optional(),
  q15: z.enum(["crisp", "soft"]).optional(),
}).refine(
  (answers) => (answers.q14 === undefined) === (answers.q15 === undefined),
  { message: "Food-scene answers must be provided together.", path: ["q14"] },
) satisfies z.ZodType<HbtiAnswers>;

export type HbtiAnswersInput = z.infer<typeof hbtiAnswersSchema>;
