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
