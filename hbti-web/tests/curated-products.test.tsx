import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HbtiExperience } from "@/components/HbtiExperience";
import { supportedLocales } from "@/content/locales";
import { hbtiProducts } from "@/content/products";
import { questions } from "@/content/questions";
import type { AromaAnswer, HbtiAnswers, TextureAnswer } from "@/content/types";
import { recommendHbtiProduct } from "@/lib/hbti/recommendation";
import { hbtiAnswersSchema } from "@/lib/hbti/schema";
import { scoreHbti } from "@/lib/hbti/scoring";
import { createResultCardPng } from "@/lib/share/result-card";

vi.mock("@/lib/share/result-card", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/share/result-card")>()),
  createResultCardPng: vi.fn(async () => new Blob(["test-card"], { type: "image/png" })),
}));

const draftKey = "hot-crush-hbti-draft-v3:curated-product-member";
const answers: HbtiAnswers = {
  q1: "iced", q2: "light", q3: "bitter", q4: "alone",
  q5: "morning", q6: "drink", q7: "iced", q8: "light",
  q9: "light", q10: "bitter", q11: "bitter", q12: "alone", q13: "alone",
  q14: "fruity", q15: "soft",
};

describe("food-scene recommendations", () => {
  it.each<[AromaAnswer, TextureAnswer, string]>([
    ["toasted", "crisp", "original-egg-tart"],
    ["fruity", "crisp", "strawberry-tart"],
    ["fruity", "soft", "blueberry-puff"],
    ["cocoa", "crisp", "chocolate-crispy-pretzel"],
    ["savoury", "soft", "wellington"],
  ])("matches %s / %s to %s", (q14, q15, product) => {
    expect(recommendHbtiProduct({ q14, q15 })).toBe(product);
  });

  it("does not use personality, time of day or category metaphors as flavour evidence", () => {
    const otherPersonality: HbtiAnswers = {
      ...answers,
      q1: "hot", q2: "strong", q3: "dolce", q4: "together",
      q5: "night", q6: "bakery", q7: "hot", q8: "strong",
      q9: "strong", q10: "dolce", q11: "dolce", q12: "together", q13: "together",
    };
    expect(scoreHbti(otherPersonality).code).not.toBe(scoreHbti(answers).code);
    expect(recommendHbtiProduct(otherPersonality)).toBe(recommendHbtiProduct(answers));
  });

  it("keeps all six approved products but never guesses the unconfirmed cake flavour", () => {
    expect(hbtiProducts).toHaveLength(6);
    expect(hbtiProducts.find((product) => product.id === "cake")?.name["zh-CN"])
      .toBe("蛋糕（口味待定）");
    const aromas: AromaAnswer[] = ["toasted", "fruity", "cocoa", "savoury"];
    const textures: TextureAnswer[] = ["crisp", "soft"];
    for (const q14 of aromas) {
      for (const q15 of textures) {
        expect(recommendHbtiProduct({ q14, q15 })).not.toBe("cake");
      }
    }
  });

  it("does not turn the food scenes into a product menu", () => {
    for (const question of questions.filter(({ id }) => id === "q14" || id === "q15")) {
      for (const locale of supportedLocales) {
        const text = [question.prompt[locale], ...question.options.map((option) => option.label[locale])].join(" ");
        for (const product of hbtiProducts) {
          expect(text).not.toContain(product.name[locale]);
        }
        expect(text).not.toMatch(/SGD|\$/);
      }
    }
  });

  it("preserves both food answers in submissions and supports already-open legacy clients", () => {
    expect(hbtiAnswersSchema.parse(answers)).toMatchObject({ q14: "fruity", q15: "soft" });
    expect(hbtiAnswersSchema.safeParse({ ...answers, q15: undefined }).success).toBe(false);
    expect(hbtiAnswersSchema.safeParse({ ...answers, q14: "cake" }).success).toBe(false);
    expect(hbtiAnswersSchema.safeParse({ ...answers, q14: undefined, q15: undefined }).success).toBe(true);
  });
});

describe("automatic name-only HBTI result", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(draftKey, JSON.stringify({
      version: 3, savedAt: Date.now(), answers, currentQuestion: 14, stage: "result",
    }));
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const session = String(input).endsWith("/api/auth/session");
      return {
        ok: session, status: session ? 200 : 404,
        json: async () => session
          ? { authenticated: true, emailCollected: true, draftKey: "curated-product-member", maskedPhone: "" }
          : { status: "not_found" },
      } as Response;
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.mocked(createResultCardPng).mockClear();
  });

  it("automatically recommends the same product through language changes and reload without a picker", async () => {
    const user = userEvent.setup();
    const view = render(<HbtiExperience />);
    expect(await screen.findByText("Blueberry Puff", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Blueberry Puff · Clear-eyed Observer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Blueberry Puff" })).not.toBeInTheDocument();
    expect(document.querySelector("details")).toBeNull();
    await user.click(screen.getByRole("button", { name: /简体中文/ }));
    expect(screen.getByText("蓝莓泡芙", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "蓝莓泡芙 · 清醒观察家" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SGD|\$|\b14\.9\b|换一款|冷萃|马卡龙|拿铁/);

    view.unmount();
    render(<HbtiExperience />);
    expect(await screen.findByText("蓝莓泡芙", { selector: "strong" })).toBeInTheDocument();
  });

  it("shares the inferred product name without a price or the former coffee pairing", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<HbtiExperience />);
    await screen.findByText("Blueberry Puff", { selector: "strong" });
    await user.click(screen.getByRole("button", { name: /Collect my fresh-out gift/ }));
    expect(screen.getByTestId("result-colour-preview")).toHaveTextContent("Blueberry Puff");
    await user.click(screen.getByRole("button", { name: "Cherry red" }));
    await user.click(screen.getByRole("button", { name: "Share my match" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain("Your next bite: Blueberry Puff");
    expect(writeText.mock.calls[0][0]).toContain("Blueberry Puff · Clear-eyed Observer");
    expect(writeText.mock.calls[0][0]).not.toMatch(/SGD|\$|Matcha|Pretzel/);
    expect(vi.mocked(createResultCardPng).mock.calls[0][0].result.signatureOrder).toBe("Blueberry Puff");
  });
});
