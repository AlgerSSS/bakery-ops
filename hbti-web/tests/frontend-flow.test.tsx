import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HbtiExperience } from "@/components/HbtiExperience";
import { PublicLanding } from "@/components/PublicLanding";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("customer HBTI journey", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("switches the public landing between English and Chinese", async () => {
    const user = userEvent.setup();
    render(<PublicLanding />);

    expect(
      screen.getByRole("heading", {
        name: "Your coffee personality might know you better than you do.",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /简体中文/ }));

    expect(
      screen.getByRole("heading", {
        name: "你的咖啡人格，可能比你更懂你。",
      }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("uses the server-authoritative result and colour after completion", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ valid: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "issued",
          code: "HSDT",
          color: "cocoa",
          reward: { couponTemplateName: "Pistachio Green Jewel" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const token = "opaque-private-invitation";

    render(<HbtiExperience token={token} />);

    await screen.findByRole("heading", {
      name: "What kind of coffee person are you?",
    });
    await user.click(screen.getByRole("button", { name: /Start my HBTI/ }));

    await chooseAndContinue(
      user,
      /Condensation beading on the glass/,
    );
    await chooseAndContinue(user, /Ease you into the day/);
    await chooseAndContinue(user, /A little bitterness/);
    await chooseAndContinue(user, /No one interrupts/);
    await chooseAndContinue(user, /Before the sun gets fierce/);
    await chooseAndContinue(user, /^A cup/);

    expect(
      await screen.findByRole("heading", { name: "The Clear-Eyed" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Receive my member gift/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Pistachio green" }),
    );
    expect(screen.getByTestId("result-colour-preview")).toHaveAttribute(
      "data-color",
      "pistachio",
    );
    await user.click(
      screen.getByRole("button", { name: /Send my gift coupon/ }),
    );

    expect(
      await screen.findByRole("heading", { name: "Your gift is ready." }),
    ).toBeInTheDocument();
    expect(screen.getByText("HSDT")).toBeInTheDocument();
    expect(screen.getByText("The Cake Person")).toBeInTheDocument();
    expect(screen.getByText("HSDT").closest("div")).toHaveAttribute(
      "data-color",
      "cocoa",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const completionRequest = fetchMock.mock.calls[1][1] as RequestInit;
    const completionBody = JSON.parse(String(completionRequest.body));
    expect(completionBody).toMatchObject({
      token,
      color: "pistachio",
      answers: {
        q1: "iced",
        q2: "light",
        q3: "bitter",
        q4: "alone",
        q5: "morning",
        q6: "drink",
      },
    });

    await waitFor(() => {
      expect(
        Object.keys(window.localStorage).filter((key) =>
          key.startsWith("hot-crush-hbti-draft-v1:"),
        ),
      ).toHaveLength(0);
    });
    expect(
      Object.entries(window.localStorage).flat().join(""),
    ).not.toContain(token);
  });
});

async function chooseAndContinue(
  user: ReturnType<typeof userEvent.setup>,
  answer: RegExp,
) {
  await user.click(await screen.findByRole("button", { name: answer }));
  await user.click(screen.getByRole("button", { name: /^Next/ }));
  await act(async () => {});
}
