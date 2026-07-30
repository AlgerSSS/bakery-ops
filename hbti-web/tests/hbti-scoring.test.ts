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

  it("validates the complete six-answer contract", () => {
    expect(
      hbtiAnswersSchema.safeParse({
        q1: "hot",
        q2: "light",
        q3: "dolce",
        q4: "together",
        q5: "morning",
        q6: "bakery",
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
