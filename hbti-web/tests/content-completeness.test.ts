import { describe, expect, it } from "vitest";

import { defaultLocale, supportedLocales } from "@/content/locales";
import { questions } from "@/content/questions";
import { hbtiCodes, results } from "@/content/results";
import { giftTemplateNames, uiCopy } from "@/content/ui";

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

  // 顾客拿到的是 RES 的内部券名（"HBTI Gift · Rose Fridge Magnet"）。giftNames 是唯一
  // 把它翻成人话的地方，漏一条或原样照抄，柜台上的礼物名就成了后台标识。
  it("给九件周边在三种语言下都配了真正的显示名", () => {
    expect(giftTemplateNames).toHaveLength(9);

    for (const locale of supportedLocales) {
      const names = uiCopy[locale].giftNames;
      expect(Object.keys(names).sort()).toEqual([...giftTemplateNames].sort());

      for (const template of giftTemplateNames) {
        const display = names[template];
        expect(display.trim(), `${template} @ ${locale} 为空`).not.toBe("");
        // 显示名不能是模板名本身，也不能带上内部前缀。
        expect(display, `${template} @ ${locale} 原样照抄了模板名`).not.toBe(
          template,
        );
        expect(
          display.includes("HBTI Gift"),
          `${template} @ ${locale} 泄露了内部前缀`,
        ).toBe(false);
      }
    }

    // 三种语言必须真的各写各的，不能整段照搬英文。
    const zh = uiCopy["zh-CN"].giftNames;
    const en = uiCopy.en.giftNames;
    const ms = uiCopy["ms-MY"].giftNames;
    for (const template of giftTemplateNames) {
      expect(zh[template], `${template} 的中文没翻`).not.toBe(en[template]);
      expect(ms[template], `${template} 的马来文没翻`).not.toBe(en[template]);
    }
  });

  it("周边发完时的文案三语齐全，且不复用发券成功的说法", () => {
    for (const locale of supportedLocales) {
      const copy = uiCopy[locale];
      for (const key of [
        "giftSoldOutEyebrow",
        "giftSoldOutTitle",
        "giftSoldOutBody",
        "giftSoldOutLabel",
        "giftSoldOutName",
        "giftSoldOutNote",
      ] as const) {
        expect(copy[key].trim(), `${key} @ ${locale} 为空`).not.toBe("");
      }
      // 发完了却还说「礼物已放进你的会员账户」是最糟的组合。
      expect(copy.giftSoldOutTitle).not.toBe(copy.successTitle);
      expect(copy.giftSoldOutBody).not.toBe(copy.successBody);
      expect(copy.giftSoldOutName).not.toBe(copy.rewardName);
      // 兜底名也不该再是某件具体商品——那会让顾客拿着它去柜台扑空。
      expect(copy.rewardName).not.toContain("Pistachio Green Jewel");
    }
  });
});
