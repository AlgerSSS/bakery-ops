import { describe, expect, it, vi } from "vitest";

import { ResApiClient } from "@/lib/res/client";

const config = {
  baseUrl: "https://bo.sea.restosuite.ai",
  vulcanToken: "secret-token",
  tenant: "tenant-1",
  corporationId: "corp-1",
  organizationId: "org-1",
  organizationType: "7",
  brandId: "brand-1",
  shopId: "shop-1",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function couponRow(couponId: string) {
  return {
    couponId,
    couponTemplateId: "template-1",
    couponTemplateName: "Pistachio Green Jewel",
    couponStatus: 1,
  };
}

function couponPage(input: {
  total: number;
  pageNo: number;
  pageCount: number;
  couponIds: string[];
}): Response {
  return jsonResponse({
    code: "000",
    data: {
      page: {
        total: input.total,
        pageNo: input.pageNo,
        pageSize: 200,
        pageCount: input.pageCount,
      },
      list: input.couponIds.map(couponRow),
    },
  });
}

function phoneFormats(): Response {
  return jsonResponse({
    code: "000",
    data: [{ internationalPhoneAreaCode: "60", applyCountry: "MY" }],
  });
}

function memberCard(points: number, overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    code: "000",
    data: {
      page: { total: 1 },
      list: [{
        id: "card-id-1",
        customerId: "member-1",
        cardNo: "card-1",
        status: 10,
        points: String(points),
        ...overrides,
      }],
    },
  });
}

const couponQuery = {
  member: { id: "member-1" },
  template: {
    id: "template-1",
    name: "Pistachio Green Jewel",
  },
};

describe("ResApiClient", () => {
  it("refuses to send RES credentials to another HTTPS origin", () => {
    expect(
      () =>
        new ResApiClient(
          { ...config, baseUrl: "https://attacker.example" },
          vi.fn<typeof fetch>(),
        ),
    ).toThrow("verified RES API origin");
  });

  it("propagates the route deadline into RES requests", async () => {
    const deadline = new AbortController();
    const abortReason = new Error("route deadline reached");
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const signal = init?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal).not.toBe(deadline.signal);
      expect(signal?.aborted).toBe(false);
      deadline.abort(abortReason);
      expect(signal?.aborted).toBe(true);
      throw signal?.reason;
    });
    const client = new ResApiClient(config, fetcher, deadline.signal);

    await expect(
      client.resolveEnabledCouponTemplateByName("Pistachio Green Jewel"),
    ).rejects.toBe(abortReason);
  });

  it("uses the official split-phone member lookup without leaking phone into results", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: [
            {
              internationalPhoneAreaCode: "1",
              applyCountry: "US",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: "000", data: { id: "member-1" } }),
      );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.resolveMemberByPhone("+12025550123"),
    ).resolves.toEqual({ id: "member-1" });

    const lookupBody = JSON.parse(
      String(fetcher.mock.calls[1][1]?.body),
    ) as Record<string, unknown>;
    expect(lookupBody).toEqual({
      phone: "2025550123",
      areaCode: "1",
      isoCode: "US",
      corporationId: "corp-1",
    });
  });

  it("resolves exactly one enabled physical-gift template", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        code: "000",
        data: [
          {
            couponTemplateType: 2301,
            couponTemplateList: [
              {
                id: "template-1",
                couponTemplateName: "Pistachio Green Jewel",
                couponTemplateType: 2301,
                couponTemplateStatus: 1,
              },
            ],
          },
        ],
      }),
    );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.resolveEnabledCouponTemplateByName("Pistachio Green Jewel"),
    ).resolves.toEqual({
      id: "template-1",
      name: "Pistachio Green Jewel",
    });
  });

  it("can resolve an exact enabled amount-discount template for friend rewards", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        code: "000",
        data: [{
          couponTemplateType: 2201,
          couponTemplateList: [{
            id: "2043286175804100613",
            couponTemplateName: "10元代金劵",
            couponTemplateType: 2201,
            couponTemplateStatus: 1,
          }],
        }],
      }),
    );
    const client = new ResApiClient(config, fetcher);
    await expect(
      client.resolveEnabledCouponTemplateByName("10元代金劵", 2201),
    ).resolves.toEqual({ id: "2043286175804100613", name: "10元代金劵" });
  });

  it("reads every coupon page and keeps only exact available matches", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: {
            page: { total: 3, pageNo: 1, pageSize: 200, pageCount: 2 },
            list: [
              {
                couponId: "coupon-1",
                couponTemplateId: "template-1",
                couponTemplateName: "Pistachio Green Jewel",
                couponStatus: 1,
              },
              {
                couponId: "coupon-used",
                couponTemplateId: "template-1",
                couponTemplateName: "Pistachio Green Jewel",
                couponStatus: 2,
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: {
            page: { total: 3, pageNo: 2, pageSize: 200, pageCount: 2 },
            list: [
              {
                couponId: "coupon-2",
                couponTemplateId: "template-1",
                couponTemplateName: "Pistachio Green Jewel",
                couponStatus: 1,
              },
            ],
          },
        }),
      );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.listUsableMatchingCoupons({
        member: { id: "member-1" },
        template: {
          id: "template-1",
          name: "Pistachio Green Jewel",
        },
      }),
    ).resolves.toEqual([{ id: "coupon-1" }, { id: "coupon-2" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails coupon readback when RES returns a different page than requested", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      couponPage({
        total: 1,
        pageNo: 2,
        pageCount: 1,
        couponIds: ["coupon-1"],
      }),
    );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.listUsableMatchingCoupons(couponQuery),
    ).rejects.toThrow("pagination was inconsistent");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails coupon readback when RES changes total between pages", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        couponPage({
          total: 2,
          pageNo: 1,
          pageCount: 2,
          couponIds: ["coupon-1"],
        }),
      )
      .mockResolvedValueOnce(
        couponPage({
          total: 3,
          pageNo: 2,
          pageCount: 2,
          couponIds: ["coupon-2"],
        }),
      );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.listUsableMatchingCoupons(couponQuery),
    ).rejects.toThrow("pagination was inconsistent");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails coupon readback when RES changes pageCount between pages", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        couponPage({
          total: 2,
          pageNo: 1,
          pageCount: 2,
          couponIds: ["coupon-1"],
        }),
      )
      .mockResolvedValueOnce(
        couponPage({
          total: 2,
          pageNo: 2,
          pageCount: 3,
          couponIds: ["coupon-2"],
        }),
      );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.listUsableMatchingCoupons(couponQuery),
    ).rejects.toThrow("pagination was inconsistent");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails coupon readback instead of returning a truncated raw snapshot", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        couponPage({
          total: 3,
          pageNo: 1,
          pageCount: 2,
          couponIds: ["coupon-1"],
        }),
      )
      .mockResolvedValueOnce(
        couponPage({
          total: 3,
          pageNo: 2,
          pageCount: 2,
          couponIds: ["coupon-2"],
        }),
      );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.listUsableMatchingCoupons(couponQuery),
    ).rejects.toThrow("pagination was incomplete");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails coupon readback when a coupon ID is repeated on another page", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        couponPage({
          total: 2,
          pageNo: 1,
          pageCount: 2,
          couponIds: ["coupon-1"],
        }),
      )
      .mockResolvedValueOnce(
        couponPage({
          total: 2,
          pageNo: 2,
          pageCount: 2,
          couponIds: ["coupon-1"],
        }),
      );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.listUsableMatchingCoupons(couponQuery),
    ).rejects.toThrow("duplicate coupon ID");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails coupon readback when a non-empty result claims zero pages", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      couponPage({
        total: 1,
        pageNo: 1,
        pageCount: 0,
        couponIds: ["coupon-1"],
      }),
    );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.listUsableMatchingCoupons(couponQuery),
    ).rejects.toThrow("pagination was inconsistent");
  });

  it("fails coupon readback when raw rows exceed the advertised total", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      couponPage({
        total: 1,
        pageNo: 1,
        pageCount: 1,
        couponIds: ["coupon-1", "coupon-2"],
      }),
    );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.listUsableMatchingCoupons(couponQuery),
    ).rejects.toThrow("pagination was incomplete");
  });

  it("never reads more than the 100-page coupon safety limit", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          page: { pageNo: number };
        };
        const requestedPage = body.page.pageNo;
        return couponPage({
          total: 101,
          pageNo: requestedPage,
          pageCount: 101,
          couponIds: [`coupon-${requestedPage}`],
        });
      },
    );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.listUsableMatchingCoupons(couponQuery),
    ).rejects.toThrow("page safety limit");
    expect(fetcher).toHaveBeenCalledTimes(100);
  });

  it("accepts a structurally complete empty coupon snapshot", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      couponPage({
        total: 0,
        pageNo: 1,
        pageCount: 0,
        couponIds: [],
      }),
    );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.listUsableMatchingCoupons(couponQuery),
    ).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("gives literal quantity one with the verified 30-day physical gift payload", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: [
            {
              internationalPhoneAreaCode: "1",
              applyCountry: "US",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ code: "000", data: null }));
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.giveCoupon({
        phoneE164: "+12025550123",
        member: { id: "member-1" },
        template: {
          id: "template-1",
          name: "Pistachio Green Jewel",
        },
        quantity: 1,
      }),
    ).resolves.toEqual({ status: "accepted" });

    const giveBody = JSON.parse(
      String(fetcher.mock.calls[1][1]?.body),
    ) as Record<string, unknown>;
    expect(giveBody).toMatchObject({
      couponTemplateId: "template-1",
      customerId: "member-1",
      identityCode: "2025550123",
      giveQuantity: 1,
      identityType: 1,
      informChannelType: 0,
      sendNotify: false,
      couponEffectiveTime: {
        effectiveType: 1,
        relativeEffectiveTime: {
          delayEffectiveUnit: 1,
          effectiveUnit: 2,
          delayEffectiveValue: 0,
          effectiveValue: 30,
        },
      },
    });
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      redirect: "error",
    });
  });

  it("treats every non-success give response as ambiguous", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: [
            {
              internationalPhoneAreaCode: "1",
              applyCountry: "US",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: "PERMISSION_DELAY", msg: "not confirmed" }),
      );
    const client = new ResApiClient(config, fetcher);

    await expect(
      client.giveCoupon({
        phoneE164: "+12025550123",
        member: { id: "member-1" },
        template: {
          id: "template-1",
          name: "Pistachio Green Jewel",
        },
        quantity: 1,
      }),
    ).resolves.toEqual({ status: "ambiguous" });
  });

  it("gives friend vouchers with a 90-day period and a reconciliation reference", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(phoneFormats())
      .mockResolvedValueOnce(jsonResponse({ code: "000" }));
    const client = new ResApiClient(config, fetcher);
    await client.giveCoupon({
      phoneE164: "+60123456789",
      member: { id: "member-1" },
      template: { id: "2043286175804100613", name: "10元代金劵" },
      quantity: 1,
      effectiveDays: 90,
      remark: "FRIEND-TOPUP-42",
    });
    const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(body.remark).toBe("FRIEND-TOPUP-42");
    expect(body.couponEffectiveTime.relativeEffectiveTime.effectiveValue).toBe(90);
  });

  it("deducts points once and proves the result with an exact balance readback", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(phoneFormats())
      .mockResolvedValueOnce(
        jsonResponse({ code: "000", data: { id: "member-1" } }),
      )
      .mockResolvedValueOnce(memberCard(500))
      .mockResolvedValueOnce(jsonResponse({ code: "000" }))
      .mockResolvedValueOnce(memberCard(50));
    const client = new ResApiClient(config, fetcher);

    await expect(client.adjustMemberPoints({
      phoneE164: "+60123456789",
      points: 450,
      direction: "decrease",
      reference: "BIRTHDAY-2026-42",
    })).resolves.toEqual({
      status: "applied",
      reference: "BIRTHDAY-2026-42",
      pointsBefore: 500,
      pointsAfter: 50,
    });

    const lookupBody = JSON.parse(String(fetcher.mock.calls[2][1]?.body));
    expect(lookupBody).toMatchObject({
      page: { pageNo: 1, pageSize: 20 },
      corporationId: "corp-1",
      phone: "123456789",
    });
    const adjustmentBody = JSON.parse(String(fetcher.mock.calls[3][1]?.body));
    expect(adjustmentBody).toEqual({
      cardNo: "card-1",
      points: 450,
      type: 701,
      customerId: "member-1",
      corporationId: "corp-1",
      shopId: "shop-1",
      remark: "BIRTHDAY-2026-42",
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("rejects an insufficient balance without sending a RES write", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(phoneFormats())
      .mockResolvedValueOnce(
        jsonResponse({ code: "000", data: { id: "member-1" } }),
      )
      .mockResolvedValueOnce(memberCard(449));
    const client = new ResApiClient(config, fetcher);

    await expect(client.adjustMemberPoints({
      phoneE164: "+60123456789",
      points: 450,
      direction: "decrease",
      reference: "BIRTHDAY-2026-43",
    })).resolves.toEqual({
      status: "rejected",
      reference: "BIRTHDAY-2026-43",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("treats a successful write with an inconsistent readback as uncertain", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(phoneFormats())
      .mockResolvedValueOnce(
        jsonResponse({ code: "000", data: { id: "member-1" } }),
      )
      .mockResolvedValueOnce(memberCard(500))
      .mockResolvedValueOnce(jsonResponse({ code: "000" }))
      .mockResolvedValueOnce(memberCard(500));
    const client = new ResApiClient(config, fetcher);

    await expect(client.adjustMemberPoints({
      phoneE164: "+60123456789",
      points: 450,
      direction: "decrease",
      reference: "BIRTHDAY-2026-44",
    })).rejects.toThrow("readback was inconsistent");
  });

  it("uses RES adjustment type 7 when refunding points", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(phoneFormats())
      .mockResolvedValueOnce(
        jsonResponse({ code: "000", data: { id: "member-1" } }),
      )
      .mockResolvedValueOnce(memberCard(50))
      .mockResolvedValueOnce(jsonResponse({ code: "000" }))
      .mockResolvedValueOnce(memberCard(500));
    const client = new ResApiClient(config, fetcher);

    await expect(client.adjustMemberPoints({
      phoneE164: "+60123456789",
      points: 450,
      direction: "increase",
      reference: "BIRTHDAY-REFUND-2026-42",
    })).resolves.toMatchObject({ status: "applied", pointsAfter: 500 });
    expect(JSON.parse(String(fetcher.mock.calls[3][1]?.body))).toMatchObject({
      type: 7,
      remark: "BIRTHDAY-REFUND-2026-42",
    });
  });
});
