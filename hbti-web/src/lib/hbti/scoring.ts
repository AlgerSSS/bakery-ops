import type {
  CategoryAnswer,
  HbtiCode,
  ScorableHbtiAnswers,
  SocialAxis,
  StrengthAxis,
  SweetnessAxis,
  TemperatureAxis,
  VisitTimeAnswer,
} from "@/content/types";

export interface HbtiScore {
  code: HbtiCode;
  axes: {
    temperature: TemperatureAxis;
    strength: StrengthAxis;
    sweetness: SweetnessAxis;
    social: SocialAxis;
  };
  visitTime: VisitTimeAnswer;
  category: CategoryAnswer;
}

/**
 * 每轴多数决。ballots 按**优先级**传入，第一张是该轴的 ★ 主问题。
 *
 * 13 题版每轴投三票，三票不会平。但票数少于三时可能平，
 * 平票一律由**第一张已投的票**裁决——这保证：
 *   · 旧草稿只有 q1–q6 时，温度轴 q1 与 q5 各一票且矛盾，仍由 q1 说了算，
 *     与 6 题版逐位一致，历史结果不会被重算成别的型；
 *   · 任何情况下用户对主问题的明确回答都不会被辅助票悄悄推翻。
 */
function majority<Answer extends string, Axis>(
  ballots: readonly (Answer | undefined)[],
  hiAnswer: Answer,
  hi: Axis,
  lo: Axis,
): Axis {
  let cast = 0;
  let hiVotes = 0;
  let primary: Answer | undefined;
  for (const ballot of ballots) {
    if (!ballot) continue;
    if (primary === undefined) primary = ballot;
    cast += 1;
    if (ballot === hiAnswer) hiVotes += 1;
  }
  if (hiVotes * 2 === cast) return primary === hiAnswer ? hi : lo;
  return hiVotes * 2 > cast ? hi : lo;
}

export function scoreHbti(answers: ScorableHbtiAnswers): HbtiScore {
  // 温度第三票沿用 q5（「最像自己的时刻」）：morning 记 H、night 记 I，
  // 与 6 题版 q1 缺失时的 fallback 口径一致。
  const temperature = majority<"hot" | "iced" | "morning" | "night", TemperatureAxis>(
    [answers.q1, answers.q7, answers.q5 === "morning" ? "hot" : "iced"],
    "hot",
    "H",
    "I",
  );
  const strength = majority<"strong" | "light", StrengthAxis>(
    [answers.q2, answers.q8, answers.q9],
    "strong",
    "S",
    "L",
  );
  const sweetness = majority<"dolce" | "bitter", SweetnessAxis>(
    [answers.q3, answers.q10, answers.q11],
    "dolce",
    "D",
    "B",
  );
  const social = majority<"together" | "alone", SocialAxis>(
    [answers.q4, answers.q12, answers.q13],
    "together",
    "T",
    "A",
  );

  return {
    code: `${temperature}${strength}${sweetness}${social}`,
    axes: {
      temperature,
      strength,
      sweetness,
      social,
    },
    visitTime: answers.q5,
    category: answers.q6,
  };
}
