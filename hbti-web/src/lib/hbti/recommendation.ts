import type { HbtiAnswers } from "@/content/types";
import { defaultHbtiProductId, type HbtiProductId } from "@/content/products";

/**
 * Aroma first; texture separates the two fruit products. Personality votes never rank food.
 * Cake stays in the approved assortment, but is not matched until its flavour is confirmed.
 */
export function recommendHbtiProduct(answers: Pick<HbtiAnswers, "q14" | "q15">): HbtiProductId {
  switch (answers.q14) {
    case "savoury": return "wellington";
    case "cocoa": return "chocolate-crispy-pretzel";
    case "fruity": return answers.q15 === "soft" ? "blueberry-puff" : "strawberry-tart";
    case "toasted": return "original-egg-tart";
    default: return defaultHbtiProductId;
  }
}
