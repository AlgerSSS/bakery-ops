import { describe, expect, it } from "vitest";

import { defaultLocale, supportedLocales } from "@/content/locales";
import { questions } from "@/content/questions";
import { hbtiCodes, results } from "@/content/results";

describe("HBTI localized content", () => {
  it("provides all thirteen questions in English, Chinese and Malaysia Malay", () => {
    expect(defaultLocale).toBe("en");
    expect(supportedLocales).toEqual(["en", "zh-CN", "ms-MY"]);
    expect(questions.map((question) => question.id)).toEqual([
      "q1",
      "q2",
      "q3",
      "q4",
      "q7",
      "q9",
      "q10",
      "q13",
      "q8",
      "q11",
      "q12",
      "q5",
      "q6",
    ]);
    expect(questions.map((question) => question.options.length)).toEqual([
      2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3,
    ]);
    // 按 id 取，不按下标——题目顺序是文案方案的一部分，未来还会调，
    // 下标断言会在每次调序时假报警。
    const byId = (id: string) =>
      questions.find((question) => question.id === id);
    expect(byId("q5")?.options.map((option) => option.value)).toEqual([
      "morning",
      "night",
    ]);
    expect(byId("q6")?.options.map((option) => option.value)).toEqual([
      "drink",
      "dessert",
      "bakery",
    ]);

    for (const question of questions) {
      for (const locale of supportedLocales) {
        expect(question.prompt[locale].trim()).not.toBe("");
        for (const option of question.options) {
          expect(option.label[locale].trim()).not.toBe("");
        }
      }
    }
  });

  it("provides every result name, behaviour, trait and signature order", () => {
    expect(Object.keys(results)).toEqual(hbtiCodes);
    expect(hbtiCodes).toHaveLength(16);

    for (const code of hbtiCodes) {
      for (const locale of supportedLocales) {
        const result = results[code][locale];

        expect(result.name.trim()).not.toBe("");
        expect(result.description.trim()).not.toBe("");
        expect(result.signatureOrder.trim()).not.toBe("");
        expect(result.traits).toHaveLength(4);
        expect(result.traits.every((trait) => trait.trim() !== "")).toBe(true);

        const sentences = [
          ...new Intl.Segmenter(locale, { granularity: "sentence" }).segment(
            result.description,
          ),
        ].filter(({ segment }) => segment.trim() !== "");
        expect(
          sentences.length,
          `${code} ${locale} must contain 2-4 sentences`,
        ).toBeGreaterThanOrEqual(2);
        expect(
          sentences.length,
          `${code} ${locale} must contain 2-4 sentences`,
        ).toBeLessThanOrEqual(4);
      }
    }
  });
});
