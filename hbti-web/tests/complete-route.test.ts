import { describe, expect, it } from "vitest";

import { publicCompletionPayload } from "@/app/api/complete/route";

describe("complete route public payload", () => {
  it("keeps the internal coupon ID in server storage only", () => {
    const payload = publicCompletionPayload(
      {
        status: "issued",
        code: "ISBA",
        visitTime: "night",
        category: "drink",
        color: "pistachio",
        reward: {
          couponTemplateName: "Pistachio Green Jewel",
          newCouponId: "internal-coupon-id",
          usableCouponCountBefore: 1,
          usableCouponCountAfter: 2,
          confirmedAt: "2026-07-30T08:00:00.000Z",
        },
      },
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex",
    );

    expect(payload).toMatchObject({
      status: "issued",
      reward: { couponTemplateName: "Pistachio Green Jewel" },
    });
    expect(JSON.stringify(payload)).not.toContain("internal-coupon-id");
  });
});
