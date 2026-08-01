import { z } from "zod";

import type { HbtiAnswers } from "@/content/types";

const temperature = z.enum(["iced", "hot"]);
const strength = z.enum(["light", "strong"]);
const sweetness = z.enum(["bitter", "dolce"]);
const social = z.enum(["alone", "together"]);

/**
 * 提交端契约：13 题版上线后，完成请求必须带齐 12 道计分题 + 1 道打包题。
 *
 * 这里**不放宽**成可选：放宽等于让过期的前端静默提交 6 题，
 * 拿到一个精度更低的结果却没人发现。缺题一律 400。
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
}) satisfies z.ZodType<HbtiAnswers>;

export type HbtiAnswersInput = z.infer<typeof hbtiAnswersSchema>;
