import { describe, expect, it } from "vitest";

import { hbtiCodes } from "@/content/results";
import { scoreHbti } from "@/lib/hbti/scoring";
import { hbtiAnswersSchema } from "@/lib/hbti/schema";

describe("scoreHbti", () => {
  it("maps direct answers to the four HBTI axes", () => {
    const result = scoreHbti({
      q1: "iced",
      q2: "strong",
      q3: "bitter",
      q4: "alone",
      q5: "night",
      q6: "drink",
      q7: "iced",
      q8: "strong",
      q9: "strong",
      q10: "bitter",
      q11: "bitter",
      q12: "alone",
      q13: "alone",
    });

    expect(result.code).toBe("ISBA");
  });

  it("uses visit time only as a defensive temperature fallback", () => {
    const result = scoreHbti({
      q2: "light",
      q3: "dolce",
      q4: "together",
      q5: "morning",
      q6: "bakery",
    });

    expect(result.code).toBe("HLDT");
  });

  it("keeps a direct temperature answer and records non-scoring answers", () => {
    const result = scoreHbti({
      q1: "iced",
      q2: "light",
      q3: "dolce",
      q4: "together",
      q5: "morning",
      q6: "dessert",
      q7: "iced",
      q8: "light",
      q9: "light",
      q10: "dolce",
      q11: "dolce",
      q12: "together",
      q13: "together",
    });

    expect(result).toEqual({
      code: "ILDT",
      axes: {
        temperature: "I",
        strength: "L",
        sweetness: "D",
        social: "T",
      },
      visitTime: "morning",
      category: "dessert",
    });
  });

  it("validates the complete thirteen-answer contract", () => {
    expect(
      hbtiAnswersSchema.safeParse({
        q1: "hot",
        q2: "light",
        q3: "dolce",
        q4: "together",
        q5: "morning",
        q6: "bakery",
        q7: "hot",
        q8: "light",
        q9: "light",
        q10: "dolce",
        q11: "dolce",
        q12: "together",
        q13: "together",
      }).success,
    ).toBe(true);

    expect(
      hbtiAnswersSchema.safeParse({
        q2: "light",
        q3: "dolce",
        q4: "together",
        q5: "morning",
        q6: "pastry",
      }).success,
    ).toBe(false);
  });

  it("produces every one of the 16 codes from direct axis answers", () => {
    const generatedCodes = new Set<string>();

    for (const q1 of ["iced", "hot"] as const) {
      for (const q2 of ["light", "strong"] as const) {
        for (const q3 of ["bitter", "dolce"] as const) {
          for (const q4 of ["alone", "together"] as const) {
            const result = scoreHbti({
              q1,
              q2,
              q3,
              q4,
              q5: q1 === "iced" ? "morning" : "night",
              q6: "drink",
            });

            generatedCodes.add(result.code);
          }
        }
      }
    }

    expect([...generatedCodes]).toEqual(hbtiCodes);
  });
});
