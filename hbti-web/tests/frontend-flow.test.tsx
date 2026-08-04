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

/**
 * 组件挂载时会先问一次 `/api/auth/captcha`（RES 是否要求图形验证码）。
 * 这些用例关心的是发码与验证调用，所以把探测就地应答掉、不转发给内层 mock ——
 * 否则它会吃掉 `mockResolvedValueOnce` 队列的第一项，也会污染调用计数。
 */
function stubFetch<T>(inner: T): T {
  const wrapped = (input: unknown, init?: unknown) => {
    if (String(input).includes("/api/auth/captcha")) {
      return Promise.resolve(jsonResponse({ enable: false, provider: null }));
    }
    return (inner as (a: unknown, b?: unknown) => unknown)(input, init);
  };
  vi.stubGlobal("fetch", wrapped);
  return inner;
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
    stubFetch(
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
    stubFetch(fetchMock);
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
    stubFetch(fetchMock);
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
        name: "Which bread on our shelf is you?",
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
    stubFetch(fetchMock);
    const user = userEvent.setup();

    render(<HbtiExperience />);
    await user.click(
      await screen.findByRole("button", { name: /Claim my bread|proofing—continue|认领我的面包|接着来/ }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: /Something iced: 'Wake up. It's fine now.'/,
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
      await screen.findByRole("button", { name: /Claim my bread|proofing—continue|认领我的面包|接着来/ }),
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
    stubFetch(fetchMock);
    const user = userEvent.setup();

    render(<HbtiExperience />);

    await screen.findByRole("heading", {
      name: "Which bread on our shelf is you?",
    });
    await user.click(screen.getByRole("button", { name: /Claim my bread|proofing—continue|认领我的面包|接着来/ }));

    // 按题目展示顺序作答，凑出 ILBA：
    // 温度 iced,iced,(morning=hot) → I；浓淡三票 light → L；
    // 甜苦三票 bitter → B；独同三票 alone → A。
    const answerPath = [
      /Something iced: 'Wake up. It's fine now.'/, // q1  iced
      /Ease you into the day/, //                     q2  light
      /Name the first fix while it's still warm/, //  q3  bitter
      /Alone, unhurried, no talking, no sharing/, //  q4  alone
      /Refreshing the longer someone stays/, //       q7  iced
      /Warm up slowly, but you linger/, //            q9  light
      /The honest part: someone has to say it/, //    q10 bitter
      /Don't call me\. I have plans with myself\./, //q13 alone
      /Break it into steps, work alongside/, //q8  light
      /The over-baked batch/, //                    q11 bitter
      /Alone time\. Crowds drain the battery\./, //   q12 alone
      /Early morning, before the world gets loud/, // q5  morning
      /^A cup/, //                                    q6  drink
    ];
    for (const option of answerPath) {
      await chooseAndContinue(user, option);
    }

    expect(
      await screen.findByRole("heading", { name: "The Clear-Eyed Bagel" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Collect my fresh-out gift/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Pistachio green" }),
    );
    expect(screen.getByTestId("result-colour-preview")).toHaveAttribute(
      "data-color",
      "pistachio",
    );
    await user.click(
      screen.getByRole("button", { name: /Out of the oven!/ }),
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
        q7: "iced",
        q8: "light",
        q9: "light",
        q10: "bitter",
        q11: "bitter",
        q12: "alone",
        q13: "alone",
      },
    });
    expect(completionBody).not.toHaveProperty("token");
    expect(completionBody).not.toHaveProperty("phone");

    await waitFor(() => {
      expect(
        Object.keys(window.localStorage).filter((key) =>
          key.startsWith("hot-crush-hbti-draft-"),
        ),
      ).toHaveLength(0);
    });
  });
});

describe("周边发完之后", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mockJourney(completion: unknown) {
    stubFetch(
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            authenticated: true,
            maskedPhone: "+60 123••6789",
            draftKey: "member-draft-key-123456",
          }),
        )
        .mockResolvedValueOnce(jsonResponse(completion)),
    );
    return userEvent.setup();
  }

  it("照常出结果，并说明小礼物已经领完", async () => {
    const user = mockJourney({
      status: "unrewarded",
      code: "HSDT",
      color: "cocoa",
    });
    render(<HbtiExperience />);

    await walkTheWholeJourney(user);

    // 最要紧的一条：答完 13 题的人必须还能看到自己的面包人格。
    expect(
      await screen.findByRole("heading", {
        name: "Your bread type is yours to keep.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("HSDT")).toBeInTheDocument();
    expect(screen.getByText("The Cake Person")).toBeInTheDocument();
    expect(screen.getByText("All claimed for now")).toBeInTheDocument();
    expect(screen.getByText("Nothing to redeem this time")).toBeInTheDocument();
    // 绝不能退回兜底的礼物名——顾客会拿着它去柜台扑空。
    expect(
      screen.queryByText("A little something from the counter"),
    ).not.toBeInTheDocument();
  });

  it("发到券时显示本地化礼物名，而不是后台的内部字符串", async () => {
    const user = mockJourney({
      status: "issued",
      code: "HSDT",
      color: "cocoa",
      reward: { couponTemplateName: "HBTI Gift · Rose Fridge Magnet" },
    });
    render(<HbtiExperience />);

    await walkTheWholeJourney(user);

    expect(
      await screen.findByRole("heading", {
        name: "Your gift is in your member wallet.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rose Fridge Magnet")).toBeInTheDocument();
    expect(
      screen.queryByText("HBTI Gift · Rose Fridge Magnet"),
    ).not.toBeInTheDocument();
  });

  it("券名认不出来时退回兜底文案，不把原字符串漏给顾客", async () => {
    const user = mockJourney({
      status: "issued",
      code: "HSDT",
      color: "cocoa",
      // 后台改名或新增品项、而前端 giftNames 还没跟上时的样子。
      reward: { couponTemplateName: "HBTI Gift · Something New" },
    });
    render(<HbtiExperience />);

    await walkTheWholeJourney(user);

    expect(
      await screen.findByText("A little something from the counter"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("HBTI Gift · Something New"),
    ).not.toBeInTheDocument();
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

/** 答完 13 题并提交，走到结果页。这组答案凑出 ILBA。 */
async function walkTheWholeJourney(
  user: ReturnType<typeof userEvent.setup>,
) {
  await screen.findByRole("heading", {
    name: "Which bread on our shelf is you?",
  });
  await user.click(
    screen.getByRole("button", { name: /Claim my bread|proofing—continue/ }),
  );
  for (const option of [
    /Something iced: 'Wake up. It's fine now.'/,
    /Ease you into the day/,
    /Name the first fix while it's still warm/,
    /Alone, unhurried, no talking, no sharing/,
    /Refreshing the longer someone stays/,
    /Warm up slowly, but you linger/,
    /The honest part: someone has to say it/,
    /Don't call me\. I have plans with myself\./,
    /Break it into steps, work alongside/,
    /The over-baked batch/,
    /Alone time\. Crowds drain the battery\./,
    /Early morning, before the world gets loud/,
    /^A cup/,
  ]) {
    await chooseAndContinue(user, option);
  }
  await user.click(
    screen.getByRole("button", { name: /Collect my fresh-out gift/ }),
  );
  await user.click(screen.getByRole("button", { name: "Pistachio green" }));
  await user.click(screen.getByRole("button", { name: /Out of the oven!/ }));
}
