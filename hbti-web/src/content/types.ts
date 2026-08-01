export type Locale = "en" | "zh-CN" | "ms-MY";

export type TemperatureAnswer = "iced" | "hot";
export type StrengthAnswer = "light" | "strong";
export type SweetnessAnswer = "bitter" | "dolce";
export type SocialAnswer = "alone" | "together";
export type VisitTimeAnswer = "morning" | "night";
export type CategoryAnswer = "drink" | "dessert" | "bakery";
export type HbtiAnswerValue =
  | TemperatureAnswer
  | StrengthAnswer
  | SweetnessAnswer
  | SocialAnswer
  | VisitTimeAnswer
  | CategoryAnswer;

export interface HbtiAnswers {
  q1: TemperatureAnswer;
  q2: StrengthAnswer;
  q3: SweetnessAnswer;
  q4: SocialAnswer;
  q5: VisitTimeAnswer;
  q6: CategoryAnswer;
  // 13 题完整版新增：每轴三票多数决的第二、三票。
  // 全部可选——2026-07-31 之前存下的草稿与完成记录只有 q1–q6，
  // 缺票时 scoreHbti 按现有单票逻辑判定，旧数据不会失效。
  q7?: TemperatureAnswer;
  q8?: StrengthAnswer;
  q9?: StrengthAnswer;
  q10?: SweetnessAnswer;
  q11?: SweetnessAnswer;
  q12?: SocialAnswer;
  q13?: SocialAnswer;
}

export type ScorableHbtiAnswers = Omit<HbtiAnswers, "q1"> &
  Partial<Pick<HbtiAnswers, "q1">>;

export type TemperatureAxis = "I" | "H";
export type StrengthAxis = "L" | "S";
export type SweetnessAxis = "B" | "D";
export type SocialAxis = "A" | "T";
export type HbtiAxis =
  | TemperatureAxis
  | StrengthAxis
  | SweetnessAxis
  | SocialAxis;
export type HbtiCode =
  `${TemperatureAxis}${StrengthAxis}${SweetnessAxis}${SocialAxis}`;

export type Localized<T> = Record<Locale, T>;

export interface QuestionOption {
  value: HbtiAnswerValue;
  emoji: string;
  label: Localized<string>;
}

export interface HbtiQuestion {
  id: keyof HbtiAnswers;
  prompt: Localized<string>;
  options: readonly QuestionOption[];
}

export type ResultTraits = readonly [string, string, string, string];

export interface HbtiResultContent {
  name: string;
  description: string;
  traits: ResultTraits;
  signatureOrder: string;
}
