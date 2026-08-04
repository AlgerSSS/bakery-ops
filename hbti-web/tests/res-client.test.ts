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
});
