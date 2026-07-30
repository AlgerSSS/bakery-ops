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

export function scoreHbti(answers: ScorableHbtiAnswers): HbtiScore {
  const temperature: TemperatureAxis = answers.q1
    ? answers.q1 === "hot"
      ? "H"
      : "I"
    : answers.q5 === "morning"
      ? "H"
      : "I";
  const strength: StrengthAxis = answers.q2 === "strong" ? "S" : "L";
  const sweetness: SweetnessAxis = answers.q3 === "dolce" ? "D" : "B";
  const social: SocialAxis = answers.q4 === "together" ? "T" : "A";

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
