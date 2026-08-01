import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const localOrigin = "http://127.0.0.1:3199";
const resFontOrigin =
  "https://resto-images-bj-1324130148.cos.ap-beijing.myqcloud.com";
const privateMarker = "e2e-private-member-marker";

type SessionReply =
  | {
      status: 200;
      body:
        | {
            authenticated: true;
            maskedPhone: string;
            draftKey: string;
          }
        | { authenticated: false };
    }
  | { status: 500; body: { error: string } };

interface CompletionReply {
  status: number;
  body: unknown;
}

interface PrivateNetworkOptions {
  sessionReply?: SessionReply;
  completionReplies?: readonly CompletionReply[];
  completionStatusReplies?: readonly CompletionReply[];
  otpRequestReply?: CompletionReply;
  otpVerifyReply?: CompletionReply;
}

async function mockPrivateNetwork(
  page: Page,
  options: PrivateNetworkOptions = {},
) {
  const sessionReply = options.sessionReply ?? {
    status: 200,
    body: {
      authenticated: true,
      maskedPhone: "+60 123••6789",
      draftKey: "e2e-member-draft-123456",
    },
  };
  const completionReplies = options.completionReplies ?? [
    {
      status: 500,
      body: { error: "E2E_COMPLETION_DISABLED" },
    },
  ];
  const externalRequests: string[] = [];
  const otpRequestBodies: unknown[] = [];
  const otpVerifyBodies: unknown[] = [];
  const completionBodies: unknown[] = [];
  let completionCalls = 0;
  let completionStatusCalls = 0;

  await page.route("**/api/auth/session", async (route) => {
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      status: sessionReply.status,
      contentType: "application/json",
      body: JSON.stringify(sessionReply.body),
    });
  });

  await page.route("**/api/complete", async (route) => {
    completionCalls += 1;
    completionBodies.push(route.request().postDataJSON());
    const reply =
      completionReplies[
        Math.min(completionCalls - 1, completionReplies.length - 1)
      ];
    await route.fulfill({
      status: reply.status,
      contentType: "application/json",
      body: JSON.stringify(reply.body),
    });
  });

  await page.route("**/api/complete/status", async (route) => {
    completionStatusCalls += 1;
    expect(route.request().method()).toBe("GET");
    const replies = options.completionStatusReplies ?? [
      {
        status: 404,
        body: { error: "NOT_COMPLETED" },
      },
    ];
    const reply =
      replies[Math.min(completionStatusCalls - 1, replies.length - 1)];
    await route.fulfill({
      status: reply.status,
      contentType: "application/json",
      body: JSON.stringify(reply.body),
    });
  });

  await page.route("**/api/auth/otp/request", async (route) => {
    otpRequestBodies.push(route.request().postDataJSON());
    const reply = options.otpRequestReply ?? {
      status: 500,
      body: { error: "E2E_OTP_DISABLED" },
    };
    await route.fulfill({
      status: reply.status,
      contentType: "application/json",
      body: JSON.stringify(reply.body),
    });
  });

  await page.route("**/api/auth/otp/verify", async (route) => {
    otpVerifyBodies.push(route.request().postDataJSON());
    const reply = options.otpVerifyReply ?? {
      status: 500,
      body: { error: "E2E_OTP_DISABLED" },
    };
    await route.fulfill({
      status: reply.status,
      contentType: "application/json",
      body: JSON.stringify(reply.body),
    });
  });

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === localOrigin) {
      await route.fallback();
      return;
    }
    if (url.origin === resFontOrigin) {
      await route.fulfill({ status: 204 });
      return;
    }

    externalRequests.push(url.origin);
    await route.abort("blockedbyclient");
  });

  return {
    externalRequests,
    completionCalls: () => completionCalls,
    completionStatusCalls: () => completionStatusCalls,
    completionBodies,
    otpRequestBodies,
    otpVerifyBodies,
  };
}

async function openInvitation(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Which bread on our shelf is you?",
    }),
  ).toBeVisible();
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - window.innerWidth,
    body: document.body.scrollWidth - window.innerWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(0);
  expect(overflow.body).toBeLessThanOrEqual(0);
}

const TOTAL_QUESTIONS = 13;
// 展示顺序 q1,q2,q3,q4,q7,q9,q10,q13,q8,q11,q12,q5,q6
// 同轴三票一致 → 结果稳定为 ILBA，与改版前该用例的落点相同。
const DEFAULT_ANSWER_PATH = [1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 0, 0] as const;

async function startQuiz(page: Page) {
  await page.getByRole("button", { name: /Claim my bread/ }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
}

async function answerAllQuestions(
  page: Page,
  optionIndexes: readonly number[] = DEFAULT_ANSWER_PATH,
) {
  expect(optionIndexes).toHaveLength(TOTAL_QUESTIONS);

  for (let index = 0; index < optionIndexes.length; index += 1) {
    const progress = page.getByRole("progressbar");
    await expect(progress).toHaveAttribute(
      "aria-valuenow",
      String(index + 1),
    );
    await expect(progress).toHaveAttribute(
      "aria-valuemax",
      String(TOTAL_QUESTIONS),
    );
    await assertNoHorizontalOverflow(page);

    // 打包题（最后一题）三个选项，其余两个。
    const answers = page.locator("fieldset").getByRole("button");
    await expect(answers).toHaveCount(index === TOTAL_QUESTIONS - 1 ? 3 : 2);
    await answers.nth(optionIndexes[index]).click();

    if (index < optionIndexes.length - 1) {
      await expect(page.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        String(index + 2),
      );
    }
  }

  await expect(page.getByRole("progressbar")).toHaveCount(0);
}

test("offers a direct guest preview without authentication or reward calls", async ({
  page,
}) => {
  const network = await mockPrivateNetwork(page, {
    sessionReply: {
      status: 500,
      body: { error: "SESSION_MUST_NOT_BE_REQUIRED" },
    },
  });

  await page.goto("/demo");
  await expect(page.getByText("Guest preview")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Which bread on our shelf is you?",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Freshly made. Unmistakably you.",
    }),
  ).toHaveCount(0);
  expect(network.completionCalls()).toBe(0);
  expect(network.externalRequests).toEqual([]);
});

test("defaults to English and fits every supported mobile width", async ({
  page,
}) => {
  const network = await mockPrivateNetwork(page);
  await openInvitation(page);

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: /English/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await assertNoHorizontalOverflow(page);
  expect(network.externalRequests).toEqual([]);
  expect(network.completionCalls()).toBe(0);
});

test("uses the HOT CRUSH storefront tokens, trilingual slogan, and full-colour arrow", async ({
  page,
}) => {
  const network = await mockPrivateNetwork(page, {
    sessionReply: {
      status: 200,
      body: { authenticated: false },
    },
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Freshly made. Unmistakably you.",
    }),
  ).toBeVisible();

  const brandState = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const header = document.querySelector<HTMLElement>(
      '[data-surface="brand-lightbox"]',
    );
    const arrow = document.querySelector<HTMLElement>(
      '[data-brand-arrow="true"]',
    );
    const endlesslyAnimated = Array.from(
      document.querySelectorAll<HTMLElement>("*"),
    )
      .filter(
        (element) =>
          getComputedStyle(element).animationIterationCount === "infinite",
      )
      .map((element) => element.tagName);

    return {
      tokens: {
        peach: root.getPropertyValue("--hc-peach").trim(),
        paper: root.getPropertyValue("--hc-paper").trim(),
        oxblood: root.getPropertyValue("--hc-oxblood").trim(),
        red: root.getPropertyValue("--hc-red").trim(),
        ink: root.getPropertyValue("--hc-ink").trim(),
        metal: root.getPropertyValue("--hc-metal").trim(),
      },
      headerDuration: header
        ? getComputedStyle(header).animationDuration
        : "",
      arrowBackground: arrow
        ? getComputedStyle(arrow).backgroundImage
        : "",
      arrowMask: arrow
        ? getComputedStyle(arrow).maskImage
        : "",
      endlesslyAnimated,
    };
  });

  expect(brandState.tokens).toEqual({
    peach: "#f3d0b8",
    paper: "#fff7ea",
    oxblood: "#6a1c13",
    red: "#c51f2c",
    ink: "#151313",
    metal: "#bfc3c6",
  });
  expect(brandState.headerDuration).toBe("0.56s");
  expect(brandState.arrowBackground).toContain(
    "/hot-crush-arrow.png",
  );
  expect(brandState.arrowMask).toBe("none");
  expect(brandState.endlesslyAnimated).toEqual([]);

  await page.getByRole("button", { name: /简体中文/ }).click();
  await expect(
    page.getByRole("heading", { name: "新鲜出炉，刚好是你。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Bahasa Melayu/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Dibuat segar. Seunik diri anda.",
    }),
  ).toBeVisible();

  await assertNoHorizontalOverflow(page);
  expect(network.externalRequests).toEqual([]);
  expect(network.completionCalls()).toBe(0);
});

test("retires personal-link entry points without preserving the token", async ({
  page,
}) => {
  const network = await mockPrivateNetwork(page);
  await page.goto(`/t/${privateMarker}`);
  await expect(page).toHaveURL(`${localOrigin}/`);
  await expect(
    page.getByRole("heading", {
      name: "Which bread on our shelf is you?",
    }),
  ).toBeVisible();
  expect(page.url()).not.toContain(privateMarker);
  expect(network.externalRequests).toEqual([]);
});

test("verifies a +86 phone without putting identity in the URL or storage", async ({
  page,
}) => {
  const challengeToken = "c".repeat(43);
  const network = await mockPrivateNetwork(page, {
    sessionReply: {
      status: 200,
      body: { authenticated: false },
    },
    otpRequestReply: {
      status: 200,
      body: {
        challengeToken,
        maskedPhone: "+86 139••••5678",
        retryAfterSeconds: 60,
      },
    },
    otpVerifyReply: {
      status: 200,
      body: {
        authenticated: true,
        maskedPhone: "+86 139••••5678",
        draftKey: "e2e-member-draft-123456",
      },
    },
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Freshly made. Unmistakably you.",
    }),
  ).toBeFocused();
  await page.getByLabel("Country or region").selectOption("CN");
  const phoneInput = page.getByLabel("Member phone number");
  await page
    .getByRole("button", { name: "Send verification code" })
    .click();
  await expect(phoneInput).toHaveAttribute("aria-invalid", "true");
  await expect(phoneInput).toHaveAttribute(
    "aria-describedby",
    /member-phone-error/,
  );
  await expect(page.locator("#member-phone-error")).toBeVisible();

  await phoneInput.fill("139 1234 5678");
  await expect(phoneInput).not.toHaveAttribute("aria-invalid");
  await page
    .getByRole("button", { name: "Send verification code" })
    .click();
  await page.getByLabel("Six-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify and begin" }).click();

  await expect(page.getByText("Member account verified")).toBeVisible();
  await expect(page.getByText("+86 139••••5678", { exact: false })).toBeVisible();
  expect(network.otpRequestBodies).toEqual([
    {
      phone: {
        countryCode: "86",
        isoCode: "CN",
        phone: "13912345678",
      },
    },
  ]);
  expect(network.otpVerifyBodies).toEqual([
    {
      challengeToken,
      code: "123456",
      acceptMembership: true,
    },
  ]);
  const browserState = await page.evaluate(() => ({
    href: location.href,
    storage: Object.entries(localStorage).flat().join(""),
  }));
  expect(browserState.href).not.toContain("13912345678");
  expect(browserState.storage).not.toContain("13912345678");
  expect(browserState.storage).not.toContain(challengeToken);
  expect(network.completionCalls()).toBe(0);
  await assertNoHorizontalOverflow(page);
  expect(network.externalRequests).toEqual([]);
});

test("switches the same page between English, Chinese, and Malay", async ({
  page,
}) => {
  const network = await mockPrivateNetwork(page);
  await openInvitation(page);

  await page.getByRole("button", { name: /简体中文/ }).click();
  await expect(
    page.getByRole("heading", { name: "你是货架上的哪一块？" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  await page.getByRole("button", { name: /Bahasa Melayu/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Anda roti yang mana di rak kami?",
    }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ms-MY");

  await page.getByRole("button", { name: /English/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Which bread on our shelf is you?",
    }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  expect(network.externalRequests).toEqual([]);
  expect(network.completionCalls()).toBe(0);
});

test("restores a local draft and Back returns to the saved answer", async ({
  page,
}) => {
  const network = await mockPrivateNetwork(page);
  await openInvitation(page);

  await page.getByRole("button", { name: /Claim my bread/ }).click();
  await page
    .getByRole("button", { name: /Something hot: 'Slow down. No rush.'/ })
    .click();

  await expect(
    page.getByRole("heading", {
      name: "If coffee were a person, you’d want them to—",
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).some((key) =>
          key.startsWith("hot-crush-hbti-draft-v2:"),
        ),
      ),
    )
    .toBe(true);

  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "If coffee were a person, you’d want them to—",
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: /^Back/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "After a long day, which comfort do you want handed to you?",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Something hot: 'Slow down. No rush.'/,
    }),
  ).toHaveAttribute("aria-pressed", "true");

  const savedStorage = await page.evaluate(() =>
    Object.entries(localStorage).flat().join(""),
  );
  expect(savedStorage).not.toContain("+60 123");
  expect(network.externalRequests).toEqual([]);
  expect(network.completionCalls()).toBe(0);
});

test("recovers when member-account status cannot be checked", async ({
  page,
}) => {
  const network = await mockPrivateNetwork(page, {
    sessionReply: {
      status: 500,
      body: { error: "RES_UNAVAILABLE" },
    },
  });

  await page.goto("/");

  const alert = page.locator('section[role="alert"]');
  const heading = page.getByRole("heading", {
    name: "We couldn’t verify your account.",
  });
  await expect(alert).toContainText(
    "Check your connection and try again.",
  );
  await expect(heading).toBeFocused();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(network.externalRequests).toEqual([]);
  expect(network.completionCalls()).toBe(0);
});

test("completes all thirteen questions and safely retries from 500 to issued", async ({
  page,
}) => {
  await installResultCardCapture(page);
  const walletUrl =
    "https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex";
  const network = await mockPrivateNetwork(page, {
    completionReplies: [
      {
        status: 500,
        body: { error: "RES_UNAVAILABLE", retryable: true },
      },
      {
        status: 200,
        body: {
          status: "issued",
          code: "ILBA",
          color: "pistachio",
          reward: { couponTemplateName: "Pistachio Green Jewel" },
          memberWalletUrl: walletUrl,
        },
      },
    ],
  });
  await openInvitation(page);
  await assertNoHorizontalOverflow(page);

  await startQuiz(page);
  await answerAllQuestions(page);

  await expect(
    page.getByRole("heading", { name: "The Clear-Eyed Bagel" }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page
    .getByRole("button", { name: /Collect my fresh-out gift/ })
    .click();

  const preview = page.getByTestId("result-colour-preview");
  await expect(preview).toHaveAttribute("data-color", "neutral");
  await expect(
    page.getByRole("button", { name: /Out of the oven!/ }),
  ).toBeDisabled();
  await assertNoHorizontalOverflow(page);
  const colourGroup = page.getByRole("group", {
    name: "Favourite colour",
    exact: true,
  });
  const colourButtons = colourGroup.getByRole("button");
  await expect(colourButtons).toHaveCount(9);
  await expect(colourButtons).toHaveText([
    "Cherry red",
    "Blush pink",
    "Apricot",
    "Sunshine",
    "Pistachio green",
    "Powder blue",
    "Lavender",
    "Deep cocoa",
    "Warm cream",
  ]);
  const pistachio = colourGroup.getByRole("button", {
    name: "Pistachio green",
    exact: true,
  });
  await pistachio.click();
  await expect(pistachio).toHaveAttribute("aria-pressed", "true");
  await expect(preview).toHaveAttribute("data-color", "pistachio");

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save my bread card", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("hot-crush-ilba.png");
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const png = await readFile(downloadedPath!);
  expect([...png.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  expect(png.readUInt32BE(16)).toBe(1_080);
  expect(png.readUInt32BE(20)).toBe(1_350);
  expect(png.includes(Buffer.from(privateMarker))).toBe(false);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your HBTI card has been saved." }),
  ).toHaveText("Your HBTI card has been saved.");

  await page
    .getByRole("button", {
      name: "Send a friend to the shelf",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Your HBTI card is ready to share." }),
  ).toHaveText("Your HBTI card is ready to share.");
  const cardCapture = await readResultCardCapture(page);
  expect(cardCapture.share).toMatchObject({
    title: "HBTI ILBA · The Clear-Eyed Bagel",
    url: `${localOrigin}/`,
    files: [
      {
        name: "hot-crush-ilba.png",
        type: "image/png",
      },
    ],
  });
  expect(cardCapture.canvasText).toContain("127.0.0.1");
  expect(
    JSON.stringify({
      share: cardCapture.share,
      canvasText: cardCapture.canvasText,
    }),
  ).not.toContain(privateMarker);

  await page
    .getByRole("button", { name: /Out of the oven!/ })
    .click();

  await expect(page.locator('p[role="alert"]')).toContainText(
    "The connection paused before we could finish.",
  );
  await expect(preview).toHaveAttribute("data-color", "pistachio");
  expect(network.completionCalls()).toBe(1);
  await assertNoHorizontalOverflow(page);

  await page
    .getByRole("button", { name: /Out of the oven!/ })
    .click();

  await expect(
    page.getByRole("heading", {
      name: "Your gift is in your member wallet.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /View it in my member wallet/ }),
  ).toHaveAttribute("href", walletUrl);
  expect(network.completionCalls()).toBe(2);
  for (const body of network.completionBodies) {
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("phone");
    expect(body).toMatchObject({
      answers: expect.any(Object),
      color: "pistachio",
    });
  }
  await assertNoHorizontalOverflow(page);
  expect(network.externalRequests).toEqual([]);
});

test("keeps polling a processing reward until RES confirms it", async ({
  page,
}) => {
  const network = await mockPrivateNetwork(page, {
    completionReplies: [
      {
        status: 200,
        body: {
          status: "processing",
          code: "ILBA",
          color: "pistachio",
        },
      },
    ],
    completionStatusReplies: [
      {
        status: 200,
        body: {
          status: "processing",
          code: "ILBA",
          color: "pistachio",
        },
      },
      {
        status: 200,
        body: {
          status: "issued",
          code: "ILBA",
          color: "pistachio",
          reward: { couponTemplateName: "Pistachio Green Jewel" },
        },
      },
    ],
  });

  await openInvitation(page);
  await startQuiz(page);
  await answerAllQuestions(page);
  await page
    .getByRole("button", { name: /Collect my fresh-out gift/ })
    .click();
  await page
    .getByRole("group", { name: "Favourite colour" })
    .getByRole("button", { name: "Pistachio green", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Out of the oven!/ })
    .click();

  await expect(
    page.getByRole("heading", { name: "Your gift is being prepared." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Your gift is in your member wallet.",
    }),
  ).toBeVisible({ timeout: 9_000 });
  expect(network.completionCalls()).toBe(1);
  expect(network.completionStatusCalls()).toBe(2);
  expect(network.externalRequests).toEqual([]);
});

for (const localizedJourney of [
  {
    label: "Chinese",
    languageButton: /简体中文/,
    begin: "认领我的面包",
    firstQuestion: "辛苦一天之后，你更想被怎样安慰？",
    resultName: "清醒贝果",
    lang: "zh-CN",
  },
  {
    label: "Malay",
    languageButton: /Bahasa Melayu/,
    begin: "Tuntut roti saya",
    firstQuestion:
      "Selepas hari yang panjang, pujukan mana yang anda mahu?",
    resultName: "Bagel Mata Jernih",
    lang: "ms-MY",
  },
] as const) {
  test(`${localizedJourney.label} renders localized questions and result content`, async ({
    page,
  }) => {
    const network = await mockPrivateNetwork(page);
    await openInvitation(page);

    await page
      .getByRole("button", { name: localizedJourney.languageButton })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      localizedJourney.lang,
    );
    await page
      .getByRole("button", { name: localizedJourney.begin })
      .click();
    await expect(
      page.getByRole("heading", {
        name: localizedJourney.firstQuestion,
      }),
    ).toBeVisible();

    await answerAllQuestions(page);

    await expect(
      page.getByRole("heading", { name: localizedJourney.resultName }),
    ).toBeVisible();
    await assertNoHorizontalOverflow(page);
    expect(network.completionCalls()).toBe(0);
    expect(network.externalRequests).toEqual([]);
  });
}

test("supports the core journey with keyboard input only", async ({ page }) => {
  const network = await mockPrivateNetwork(page, {
    completionReplies: [
      {
        status: 200,
        body: {
          status: "issued",
          code: "HSDA",
          color: "pistachio",
          reward: { couponTemplateName: "Pistachio Green Jewel" },
        },
      },
    ],
  });
  await openInvitation(page);

  const introHeading = page.getByRole("heading", {
    name: "Which bread on our shelf is you?",
  });
  await expect(introHeading).toBeFocused();
  const begin = page.getByRole("button", { name: "Claim my bread" });
  await tabTo(page, begin);
  await expectFocusIndicator(begin);
  await page.keyboard.press("Enter");

  for (let index = 0; index < TOTAL_QUESTIONS; index += 1) {
    const questionHeading = page.locator('h1[id^="question-"]');
    await expect(questionHeading).toBeFocused();
    const firstAnswer = page.locator("fieldset").getByRole("button").first();
    await tabTo(page, firstAnswer);
    await expectFocusIndicator(firstAnswer);
    await page.keyboard.press("Space");

    if (index < TOTAL_QUESTIONS - 1) {
      await expect(page.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        String(index + 2),
      );
    }
  }

  await expect(
    page.getByRole("heading", { name: "Fresh out of the oven: you." }),
  ).toBeFocused();
  const receiveGift = page.getByRole("button", {
    name: /Collect my fresh-out gift/,
  });
  await tabTo(page, receiveGift);
  await page.keyboard.press("Enter");

  const detailsHeading = page.getByRole("heading", {
    name: "Choose the colour you’d reach for.",
  });
  await expect(detailsHeading).toBeFocused();
  const firstColour = page
    .getByRole("group", { name: "Favourite colour" })
    .getByRole("button")
    .first();
  await tabTo(page, firstColour);
  await page.keyboard.press("Space");

  const submit = page.getByRole("button", {
    name: /Out of the oven!/,
  });
  await tabTo(page, submit);
  await expectFocusIndicator(submit);
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", {
      name: "Your gift is in your member wallet.",
    }),
  ).toBeFocused();
  expect(network.completionCalls()).toBe(1);
  expect(network.externalRequests).toEqual([]);
});

test.describe("reduced motion preference", () => {
  test("removes non-essential animation while leaving the quiz usable", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const network = await mockPrivateNetwork(page);
    await openInvitation(page);

    const motionState = await page.evaluate(() => {
      const durationInMs = (value: string) =>
        value.split(",").map((part) => {
          const duration = part.trim();
          return duration.endsWith("ms")
            ? Number.parseFloat(duration)
            : Number.parseFloat(duration) * 1_000;
        });
      const offenders = Array.from(document.querySelectorAll("*")).flatMap(
        (element) => {
          const style = getComputedStyle(element);
          const durations = [
            ...durationInMs(style.animationDuration),
            ...durationInMs(style.transitionDuration),
          ];
          return durations.some((duration) => duration > 0.011)
            ? [
                {
                  tag: element.tagName,
                  animation: style.animationDuration,
                  transition: style.transitionDuration,
                },
              ]
            : [];
        },
      );

      return {
        mediaMatches: matchMedia("(prefers-reduced-motion: reduce)").matches,
        scrollBehavior: getComputedStyle(document.documentElement)
          .scrollBehavior,
        offenders,
      };
    });

    expect(motionState.mediaMatches).toBe(true);
    expect(motionState.scrollBehavior).toBe("auto");
    expect(motionState.offenders).toEqual([]);

    await startQuiz(page);
    await page.locator("fieldset").getByRole("button").first().click();
    await expect(page.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    expect(network.externalRequests).toEqual([]);
  });
});

async function tabTo(
  page: Page,
  target: ReturnType<Page["locator"]>,
  maxTabs = 24,
) {
  for (let count = 0; count < maxTabs; count += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard focus did not reach ${await target.evaluate((element) => element.outerHTML)}`);
}

async function expectFocusIndicator(target: ReturnType<Page["locator"]>) {
  const indicator = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(indicator.style).not.toBe("none");
  expect(indicator.width).toBeGreaterThan(0);
}

interface ResultCardCapture {
  canvasText: string[];
  share?: {
    title: string;
    text: string;
    url: string;
    files: Array<{ name: string; type: string }>;
  };
}

async function installResultCardCapture(page: Page) {
  await page.addInitScript(() => {
    const captureWindow = window as typeof window & {
      __hbtiResultCardCapture?: ResultCardCapture;
    };
    captureWindow.__hbtiResultCardCapture = { canvasText: [] };

    const originalFillText =
      CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (
      text,
      x,
      y,
      maxWidth,
    ) {
      captureWindow.__hbtiResultCardCapture?.canvasText.push(
        String(text),
      );
      if (typeof maxWidth === "number") {
        return originalFillText.call(this, text, x, y, maxWidth);
      }
      return originalFillText.call(this, text, x, y);
    };

    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        const capture = captureWindow.__hbtiResultCardCapture;
        if (capture) {
          capture.share = {
            title: String(data.title ?? ""),
            text: String(data.text ?? ""),
            url: String(data.url ?? ""),
            files: Array.from(data.files ?? [], (file) => ({
              name: file.name,
              type: file.type,
            })),
          };
        }
      },
    });
  });
}

async function readResultCardCapture(
  page: Page,
): Promise<ResultCardCapture> {
  return page.evaluate(() => {
    const capture = (
      window as typeof window & {
        __hbtiResultCardCapture?: ResultCardCapture;
      }
    ).__hbtiResultCardCapture;
    if (!capture) {
      throw new Error("Result card capture was not installed.");
    }
    return capture;
  });
}
