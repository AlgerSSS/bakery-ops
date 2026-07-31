import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HbtiExperience } from "@/components/HbtiExperience";

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
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("switches the public phone sign-in between English and Chinese", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ authenticated: false })),
    );
    const user = userEvent.setup();
    render(<HbtiExperience />);

    expect(
      await screen.findByRole("heading", {
        name: "Freshly made. Unmistakably you.",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /简体中文/ }));

    expect(
      screen.getByRole("heading", {
        name: "新鲜出炉，刚好是你。",
      }),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("keeps the phone and challenge out of URLs and local storage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          challengeToken: "c".repeat(43),
          maskedPhone: "+60 123••6789",
          retryAfterSeconds: 60,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          maskedPhone: "+60 123••6789",
          draftKey: "member-draft-key-123456",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<HbtiExperience />);
    await user.type(
      await screen.findByLabelText("Member phone number"),
      "0123456789",
    );
    await user.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    await user.type(await screen.findByLabelText("Six-digit code"), "123456");
    await user.click(
      screen.getByRole("button", { name: "Verify and begin" }),
    );

    expect(
      await screen.findByText("Member account verified"),
    ).toBeInTheDocument();
    expect(window.location.href).not.toContain("0123456789");
    expect(JSON.stringify(window.localStorage)).not.toContain("0123456789");
    expect(JSON.stringify(window.localStorage)).not.toContain("c".repeat(43));

    const otpRequestBody = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    );
    expect(otpRequestBody).toEqual({
      phone: {
        countryCode: "60",
        isoCode: "MY",
        phone: "123456789",
      },
    });
    const verifyBody = JSON.parse(
      String((fetchMock.mock.calls[2][1] as RequestInit).body),
    );
    expect(verifyBody).toEqual({
      challengeToken: "c".repeat(43),
      code: "123456",
      acceptMembership: true,
    });
  });

  it("asks before resolving a member-account conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          challengeToken: "d".repeat(43),
          maskedPhone: "+60 123••6789",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "ACCOUNT_CONFLICT_CONFIRMATION_REQUIRED" },
          409,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          maskedPhone: "+60 123••6789",
          draftKey: "member-draft-key-123456",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<HbtiExperience />);
    await user.type(
      await screen.findByLabelText("Member phone number"),
      "0123456789",
    );
    await user.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    await user.type(await screen.findByLabelText("Six-digit code"), "123456");
    await user.click(
      screen.getByRole("button", { name: "Verify and begin" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Use this member account?",
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Yes, use this account" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "What kind of coffee person are you?",
      }),
    ).toBeInTheDocument();
    expect(
      JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body)),
    ).toEqual({
      challengeToken: "d".repeat(43),
      code: "123456",
      acceptMembership: true,
      confirmConflict: true,
    });
  });

  it("switches accounts without carrying the previous member draft", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          maskedPhone: "+60 123••6789",
          draftKey: "first-member-draft-key",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ authenticated: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          challengeToken: "n".repeat(43),
          maskedPhone: "+60 198••4321",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          maskedPhone: "+60 198••4321",
          draftKey: "second-member-draft-key",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<HbtiExperience />);
    await user.click(
      await screen.findByRole("button", { name: /Start my HBTI/ }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: /Condensation beading on the glass/,
      }),
    );
    await waitFor(() => {
      expect(
        Object.keys(window.localStorage).some((key) =>
          key.includes("first-member-draft-key"),
        ),
      ).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.type(
      await screen.findByLabelText("Member phone number"),
      "0198764321",
    );
    await user.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    await user.type(await screen.findByLabelText("Six-digit code"), "123456");
    await user.click(
      screen.getByRole("button", { name: "Verify and begin" }),
    );

    expect(
      await screen.findByRole("button", { name: /Start my HBTI/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Continue where I left off/ }),
    ).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/logout");
    expect((fetchMock.mock.calls[1][1] as RequestInit).body).toBe("{}");
  });

  it("uses the server-authoritative result and colour after completion", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          authenticated: true,
          maskedPhone: "+60 123••6789",
          draftKey: "member-draft-key-123456",
        }),
      )
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

    render(<HbtiExperience />);

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
      screen.getByRole("button", { name: /Finish my HBTI/ }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Your gift is in your member wallet.",
      }),
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
    expect(completionBody).not.toHaveProperty("token");
    expect(completionBody).not.toHaveProperty("phone");

    await waitFor(() => {
      expect(
        Object.keys(window.localStorage).filter((key) =>
          key.startsWith("hot-crush-hbti-draft-v1:"),
        ),
      ).toHaveLength(0);
    });
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
