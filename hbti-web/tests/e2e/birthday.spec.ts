import { expect, test, type Page } from "@playwright/test";

const localOrigin = "http://127.0.0.1:3199";

const birthdayView = {
  authenticated: true,
  via: "session",
  displayName: "Nicole",
  maskedPhone: "+60 12••6789",
  member: {
    levelName: "VIP1",
    pointBalance: 900,
    registeredOn: "2025-01-02",
    level: {
      key: "L4",
      nameZh: "Lv4 挚爱会员",
      nameEn: "Forever Crush",
      annualSpend: 1800,
      next: null,
    },
  },
  stats: null,
  options: [
    {
      giftType: "free_basque",
      label: "免费巴斯克生日蛋糕",
      cost: 0,
      allowGift: false,
      yearlyLimit: 1,
      available: true,
    },
    {
      giftType: "points_450",
      label: "450 积分兑换生日蛋糕（可送亲友）",
      cost: 450,
      allowGift: true,
      yearlyLimit: null,
      available: true,
    },
  ],
  pickupByGift: {
    free_basque: { minDate: "2026-08-22", maxDate: "2026-09-19" },
    points_450: { minDate: "2026-08-25", maxDate: "2026-09-19" },
  },
  profile: null,
  reservations: [],
  campaignYear: 2026,
};

async function mockBirthdayNetwork(page: Page) {
  await page.route("**/api/birthday/view**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(birthdayView),
    });
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === localOrigin) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 204 });
  });
}

test("T-3 entry opens only the custom-cake reservation envelope", async ({
  page,
}) => {
  await mockBirthdayNetwork(page);
  await page.goto("/birthday?mode=cake");

  await expect(
    page.getByRole("heading", { name: "生日蛋糕，先替你留档期。" }),
  ).toBeVisible();
  await expect(page.getByText("提前 3 天")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开你的生日信" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "填写口味和取货时间" }).click();
  await expect(
    page.getByRole("heading", { name: "想记住的日子。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回上一屏" }).click();
  await expect(
    page.getByRole("heading", { name: "生日蛋糕，先替你留档期。" }),
  ).toBeVisible();
});

test("T-2 entry locks the experience to the free Basque reservation", async ({
  page,
}) => {
  await mockBirthdayNetwork(page);
  await page.goto("/birthday?mode=basque");

  await expect(
    page.getByRole("heading", { name: "巴斯克，提前两天给你留。" }),
  ).toBeVisible();
  await expect(page.getByText("免费巴斯克生日蛋糕")).toBeVisible();
  await expect(page.locator('[data-delivery-mode="basque"]')).toBeVisible();
});

test("birthday-day entry remains the full card", async ({ page }) => {
  await mockBirthdayNetwork(page);
  await page.goto("/birthday");

  await expect(
    page.getByRole("button", { name: "打开你的生日信" }),
  ).toBeVisible();
  await expect(page.locator("[data-delivery-mode]")).toHaveCount(0);
});
