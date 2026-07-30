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
