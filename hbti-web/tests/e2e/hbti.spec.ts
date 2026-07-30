import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const localOrigin = "http://127.0.0.1:3199";
const resFontOrigin =
  "https://resto-images-bj-1324130148.cos.ap-beijing.myqcloud.com";
const invitationToken = "e2e-opaque-invitation";

type SessionReply =
  | { status: 200; body: { valid: true } }
  | {
      status: 410;
      body: { valid: false; error: "LINK_EXPIRED" };
    };

interface CompletionReply {
  status: number;
  body: unknown;
}

interface PrivateNetworkOptions {
  sessionReply?: SessionReply;
  completionReplies?: readonly CompletionReply[];
}

async function mockPrivateNetwork(
  page: Page,
  options: PrivateNetworkOptions = {},
) {
  const sessionReply = options.sessionReply ?? {
    status: 200,
    body: { valid: true },
  };
  const completionReplies = options.completionReplies ?? [
    {
      status: 500,
      body: { error: "E2E_COMPLETION_DISABLED" },
    },
  ];
  const externalRequests: string[] = [];
  let completionCalls = 0;

  await page.route("**/api/session", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      token: invitationToken,
    });
    await route.fulfill({
      status: sessionReply.status,
      contentType: "application/json",
      body: JSON.stringify(sessionReply.body),
    });
  });

  await page.route("**/api/complete", async (route) => {
    completionCalls += 1;
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
  };
}

async function openInvitation(page: Page) {
  await page.goto(`/t/${invitationToken}`);
  await expect(
    page.getByRole("heading", {
      name: "What kind of coffee person are you?",
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

async function startQuiz(page: Page) {
  await page.getByRole("button", { name: /Start my HBTI/ }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
}

async function answerExactlySixQuestions(
  page: Page,
  optionIndexes: readonly number[] = [1, 1, 1, 0, 0, 0],
) {
  expect(optionIndexes).toHaveLength(6);

  for (let index = 0; index < optionIndexes.length; index += 1) {
    const progress = page.getByRole("progressbar");
    await expect(progress).toHaveAttribute(
      "aria-valuenow",
      String(index + 1),
    );
    await expect(progress).toHaveAttribute("aria-valuemax", "6");
    await assertNoHorizontalOverflow(page);

    const answers = page.locator("fieldset").getByRole("button");
    await expect(answers).toHaveCount(index === 5 ? 3 : 2);
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

test("switches the same page between English, Chinese, and Malay", async ({
  page,
}) => {
  const network = await mockPrivateNetwork(page);
  await openInvitation(page);

  await page.getByRole("button", { name: /简体中文/ }).click();
  await expect(
    page.getByRole("heading", { name: "你是哪一种咖啡人？" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  await page.getByRole("button", { name: /Bahasa Melayu/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Anda jenis pencinta kopi yang mana?",
    }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ms-MY");

  await page.getByRole("button", { name: /English/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "What kind of coffee person are you?",
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

  await page.getByRole("button", { name: /Start my HBTI/ }).click();
  await page
    .getByRole("button", { name: /A cup still steaming in your hands/ })
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
          key.startsWith("hot-crush-hbti-draft-v1:"),
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
      name: "It’s Friday after work. You push open the door—what do you want first?",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /A cup still steaming in your hands/,
    }),
  ).toHaveAttribute("aria-pressed", "true");

  const savedStorage = await page.evaluate(() =>
    Object.entries(localStorage).flat().join(""),
  );
  expect(savedStorage).not.toContain(invitationToken);
  expect(network.externalRequests).toEqual([]);
  expect(network.completionCalls()).toBe(0);
});

test("announces an invalid invitation and moves focus to its heading", async ({
  page,
}) => {
  const network = await mockPrivateNetwork(page, {
    sessionReply: {
      status: 410,
      body: { valid: false, error: "LINK_EXPIRED" },
    },
  });

  await page.goto(`/t/${invitationToken}`);

  const alert = page.locator('section[role="alert"]');
  const heading = page.getByRole("heading", {
    name: "This invitation can’t be opened.",
  });
  await expect(alert).toContainText(
    "Ask our team for a fresh HBTI invitation.",
  );
  await expect(heading).toBeFocused();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  expect(network.externalRequests).toEqual([]);
  expect(network.completionCalls()).toBe(0);
});

test("completes exactly six questions and safely retries from 500 to issued", async ({
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
  await answerExactlySixQuestions(page);

  await expect(
    page.getByRole("heading", { name: "The Clear-Eyed" }),
  ).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page
    .getByRole("button", { name: /Receive my member gift/ })
    .click();

  const preview = page.getByTestId("result-colour-preview");
  await expect(preview).toHaveAttribute("data-color", "neutral");
  await expect(
    page.getByRole("button", { name: /Send my gift coupon/ }),
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
    .getByRole("button", { name: "Save my card", exact: true })
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
  expect(png.includes(Buffer.from(invitationToken))).toBe(false);
  await expect(page.getByRole("status")).toHaveText(
    "Your HBTI card has been saved.",
  );

  await page
    .getByRole("button", {
      name: "Share with a friend",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Your HBTI card is ready to share.",
  );
  const cardCapture = await readResultCardCapture(page);
  expect(cardCapture.share).toMatchObject({
    title: "HBTI ILBA · The Clear-Eyed",
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
  ).not.toContain(invitationToken);

  await page
    .getByRole("button", { name: /Send my gift coupon/ })
    .click();

  await expect(page.locator('p[role="alert"]')).toContainText(
    "The connection paused before we could finish.",
  );
  await expect(preview).toHaveAttribute("data-color", "pistachio");
  expect(network.completionCalls()).toBe(1);
  await assertNoHorizontalOverflow(page);

  await page
    .getByRole("button", { name: /Send my gift coupon/ })
    .click();

  await expect(
    page.getByRole("heading", { name: "Your gift is ready." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /View it in my member wallet/ }),
  ).toHaveAttribute("href", walletUrl);
  expect(network.completionCalls()).toBe(2);
  await assertNoHorizontalOverflow(page);
  expect(network.externalRequests).toEqual([]);
});

for (const localizedJourney of [
  {
    label: "Chinese",
    languageButton: /简体中文/,
    begin: "进入 HBTI 测试",
    firstQuestion: "周五下班，你推开店门，第一秒想要的是——",
    resultName: "清醒观察者",
    lang: "zh-CN",
  },
  {
    label: "Malay",
    languageButton: /Bahasa Melayu/,
    begin: "Mulakan ujian HBTI",
    firstQuestion:
      "Hari Jumaat selepas kerja, bila anda buka pintu kedai, apa yang paling anda teringin?",
    resultName: "Pemerhati Tajam",
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

    await answerExactlySixQuestions(page);

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
    name: "What kind of coffee person are you?",
  });
  await expect(introHeading).toBeFocused();
  const begin = page.getByRole("button", { name: "Start my HBTI" });
  await tabTo(page, begin);
  await expectFocusIndicator(begin);
  await page.keyboard.press("Enter");

  for (let index = 0; index < 6; index += 1) {
    const questionHeading = page.locator('h1[id^="question-"]');
    await expect(questionHeading).toBeFocused();
    const firstAnswer = page.locator("fieldset").getByRole("button").first();
    await tabTo(page, firstAnswer);
    await expectFocusIndicator(firstAnswer);
    await page.keyboard.press("Space");

    if (index < 5) {
      await expect(page.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        String(index + 2),
      );
    }
  }

  await expect(
    page.getByRole("heading", { name: "This feels like you." }),
  ).toBeFocused();
  const receiveGift = page.getByRole("button", {
    name: /Receive my member gift/,
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
    name: /Send my gift coupon/,
  });
  await tabTo(page, submit);
  await expectFocusIndicator(submit);
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Your gift is ready." }),
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
