import { z } from "zod";

import type {
  GiveCouponInput,
  GiveCouponResult,
  ResCouponAdapter,
  ResCouponTemplate,
  ResMember,
  UsableCoupon,
  UsableCouponQuery,
} from "@/lib/res/contracts";

const apiEnvelopeSchema = z.object({
  code: z.string(),
  msg: z.string().optional(),
});

const phoneFormatEnvelopeSchema = apiEnvelopeSchema.extend({
  data: z.array(
    z.object({
      internationalPhoneAreaCode: z.string().regex(/^\d{1,4}$/),
      applyCountry: z.string().min(2).max(3),
    }),
  ),
});

const memberEnvelopeSchema = apiEnvelopeSchema.extend({
  data: z.object({
    id: z.union([z.string(), z.number()]),
  }),
});

const templateEnvelopeSchema = apiEnvelopeSchema.extend({
  data: z.array(
    z.object({
      couponTemplateType: z.number(),
      couponTemplateList: z.array(
        z.object({
          id: z.union([z.string(), z.number()]),
          couponTemplateName: z.string(),
          couponTemplateType: z.number(),
          couponTemplateStatus: z.number(),
        }),
      ),
    }),
  ),
});

const couponPageEnvelopeSchema = apiEnvelopeSchema.extend({
  data: z.object({
    page: z.object({
      total: z.number().int().nonnegative(),
      pageNo: z.number().int().positive(),
      pageSize: z.number().int().positive(),
      pageCount: z.number().int().nonnegative(),
    }),
    list: z.array(
      z.object({
        couponId: z.union([z.string(), z.number()]),
        couponTemplateId: z.union([z.string(), z.number()]),
        couponTemplateName: z.string(),
        couponStatus: z.number(),
      }),
    ),
  }),
});

const memberCardPageEnvelopeSchema = apiEnvelopeSchema.extend({
  data: z.object({
    page: z.object({
      total: z.number().int().nonnegative(),
    }),
    list: z.array(
      z.object({
        id: z.union([z.string(), z.number()]),
        customerId: z.union([z.string(), z.number()]),
        cardNo: z.union([z.string(), z.number()]),
        status: z.number().int(),
        points: z.union([z.string(), z.number()]),
      }),
    ),
  }),
});

interface ResClientConfig {
  baseUrl: string;
  vulcanToken: string;
  tenant: string;
  corporationId: string;
  organizationId: string;
  organizationType: string;
  brandId: string;
  shopId: string;
  languageCode?: string;
  timezone?: string;
}

interface PhoneIdentity {
  areaCode: string;
  isoCode: string;
  nationalPhone: string;
}

export interface ResMemberCard {
  id: string;
  memberId: string;
  cardNo: string;
  points: number;
}

export interface ResPointAdjustmentInput {
  phoneE164: string;
  points: number;
  direction: "increase" | "decrease";
  reference: string;
}

export type ResPointAdjustmentResult =
  | {
      status: "applied";
      reference: string;
      pointsBefore: number;
      pointsAfter: number;
    }
  | {
      status: "rejected";
      reference: string;
    };

type FetchLike = typeof fetch;

const MAX_COUPON_PAGES = 100;
const COUPON_PAGE_SIZE = 200;
const PHYSICAL_GIFT_COUPON_TYPE = 2301;
const AVAILABLE_COUPON_STATUS = 1;
const ACTIVE_CARD_STATUS = 10;
const POINT_ADJUST_TYPE = Object.freeze({ increase: 7, decrease: 701 });

export class ResApiClient implements ResCouponAdapter {
  private readonly phoneIdentities = new Map<string, PhoneIdentity>();

  constructor(
    private readonly config: ResClientConfig,
    private readonly fetcher: FetchLike = fetch,
    private readonly deadlineSignal?: AbortSignal,
  ) {
    validateConfig(config);
  }

  async resolveMemberByPhone(phoneE164: string): Promise<ResMember> {
    const identity = await this.resolvePhoneIdentity(phoneE164);
    const response = memberEnvelopeSchema.parse(
      await this.post("/crm/memberCard/web/customer/queryByPhone", {
        phone: identity.nationalPhone,
        areaCode: identity.areaCode,
        isoCode: identity.isoCode,
        corporationId: this.config.corporationId,
      }),
    );
    assertOk(response);
    return { id: String(response.data.id) };
  }

  async resolveEnabledCouponTemplateByName(
    templateName: string,
    expectedType = PHYSICAL_GIFT_COUPON_TYPE,
  ): Promise<ResCouponTemplate> {
    const response = templateEnvelopeSchema.parse(
      await this.post("/crm/coupon/template/queryGroup", {
        orgId: this.config.organizationId,
      }),
    );
    assertOk(response);

    const matches = response.data
      .filter(
        (group) => group.couponTemplateType === expectedType,
      )
      .flatMap((group) => group.couponTemplateList)
      .filter(
        (template) =>
          template.couponTemplateName === templateName &&
          template.couponTemplateType === expectedType &&
          template.couponTemplateStatus === 1,
      );

    if (matches.length !== 1) {
      throw new Error("RES coupon template resolution was not unique.");
    }

    return {
      id: String(matches[0].id),
      name: matches[0].couponTemplateName,
    };
  }

  async listUsableMatchingCoupons(
    query: UsableCouponQuery,
  ): Promise<readonly UsableCoupon[]> {
    const coupons: UsableCoupon[] = [];
    let pageNo = 1;
    let expectedTotal: number | undefined;
    let expectedPageCount: number | undefined;
    let rawRowCount = 0;
    const seenCouponIds = new Set<string>();

    while (pageNo <= MAX_COUPON_PAGES) {
      const response = couponPageEnvelopeSchema.parse(
        await this.post("/crm/coupon/couponCode/couponPageList", {
          page: { pageNo, pageSize: COUPON_PAGE_SIZE },
          customerId: query.member.id,
          corporationId: this.config.corporationId,
          couponTemplateName: query.template.name,
        }),
      );
      assertOk(response);
      if (response.data.page.pageNo !== pageNo) {
        throw new Error(
          "RES coupon readback pagination was inconsistent.",
        );
      }
      if (
        (response.data.page.total === 0) !==
        (response.data.page.pageCount === 0)
      ) {
        throw new Error(
          "RES coupon readback pagination was inconsistent.",
        );
      }
      if (expectedTotal === undefined) {
        expectedTotal = response.data.page.total;
        expectedPageCount = response.data.page.pageCount;
      } else if (
        response.data.page.total !== expectedTotal ||
        response.data.page.pageCount !== expectedPageCount
      ) {
        throw new Error(
          "RES coupon readback pagination was inconsistent.",
        );
      }

      rawRowCount += response.data.list.length;
      for (const coupon of response.data.list) {
        const couponId = String(coupon.couponId);
        if (seenCouponIds.has(couponId)) {
          throw new Error(
            "RES coupon readback contained a duplicate coupon ID.",
          );
        }
        seenCouponIds.add(couponId);
        if (
          String(coupon.couponTemplateId) === query.template.id &&
          coupon.couponTemplateName === query.template.name &&
          coupon.couponStatus === AVAILABLE_COUPON_STATUS
        ) {
          coupons.push({ id: couponId });
        }
      }

      if (
        response.data.page.pageCount === 0 ||
        pageNo >= response.data.page.pageCount
      ) {
        if (rawRowCount !== expectedTotal) {
          throw new Error(
            "RES coupon readback pagination was incomplete.",
          );
        }
        return coupons;
      }
      pageNo += 1;
    }

    throw new Error("RES coupon readback exceeded the page safety limit.");
  }

  async giveCoupon(input: GiveCouponInput): Promise<GiveCouponResult> {
    const effectiveDays = input.effectiveDays ?? 30;
    if (!Number.isSafeInteger(effectiveDays) || effectiveDays < 1 || effectiveDays > 365) {
      throw new Error("Invalid coupon effective period.");
    }
    const remark = input.remark ?? "HBTI completion reward";
    if (remark.length < 3 || remark.length > 120 || /[\r\n]/.test(remark)) {
      throw new Error("Invalid coupon remark.");
    }
    const identity =
      this.phoneIdentities.get(input.phoneE164) ??
      (await this.resolvePhoneIdentity(input.phoneE164));
    const response = apiEnvelopeSchema.parse(
      await this.post("/crm/coupon/couponCode/give", {
        couponTemplateId: input.template.id,
        customerId: input.member.id,
        identityCode: identity.nationalPhone,
        giveQuantity: input.quantity,
        remark,
        identityType: 1,
        informChannelType: 0,
        sendNotify: false,
        couponEffectiveTime: {
          effectiveType: 1,
          relativeEffectiveTime: {
            delayEffectiveUnit: 1,
            effectiveUnit: 2,
            delayEffectiveValue: 0,
            effectiveValue: effectiveDays,
          },
        },
      }),
    );

    return response.code === "000"
      ? { status: "accepted" }
      : { status: "ambiguous" };
  }

  /**
   * 按手机号读取唯一有效会员卡。手机号只作为 RES 查询条件，不进入返回值或日志。
   * 多卡/错绑一律 fail closed，避免把积分调到错误的会员卡。
   */
  async resolveActiveMemberCardByPhone(
    phoneE164: string,
  ): Promise<ResMemberCard> {
    const identity = await this.resolvePhoneIdentity(phoneE164);
    const member = await this.resolveMemberByPhone(phoneE164);
    return this.readActiveMemberCard(identity, member.id);
  }

  private async readActiveMemberCard(
    identity: PhoneIdentity,
    memberId: string,
  ): Promise<ResMemberCard> {
    const response = memberCardPageEnvelopeSchema.parse(
      await this.post("/crm/datamanage/card/page", {
        page: { pageNo: 1, pageSize: 20 },
        corporationId: this.config.corporationId,
        phone: identity.nationalPhone,
      }),
    );
    assertOk(response);

    const matches = response.data.list.filter(
      (card) =>
        card.status === ACTIVE_CARD_STATUS &&
        String(card.customerId) === memberId,
    );
    if (matches.length !== 1) {
      throw new Error("RES active member card resolution was not unique.");
    }

    const points = Number(matches[0].points);
    if (!Number.isSafeInteger(points) || points < 0) {
      throw new Error("RES member point balance was invalid.");
    }
    return {
      id: String(matches[0].id),
      memberId: String(matches[0].customerId),
      cardNo: String(matches[0].cardNo),
      points,
    };
  }

  /**
   * RES 积分调整没有可依赖的原生幂等键，因此只做一次写调用，并以余额回读证明结果。
   * 写请求抛错或回读不一致时由调用方标记 ambiguous，禁止自动重试。
   */
  async adjustMemberPoints(
    input: ResPointAdjustmentInput,
  ): Promise<ResPointAdjustmentResult> {
    if (!Number.isSafeInteger(input.points) || input.points <= 0) {
      throw new Error("Point adjustment must be a positive integer.");
    }
    if (!/^[A-Z0-9][A-Z0-9-]{5,80}$/.test(input.reference)) {
      throw new Error("Point adjustment reference was invalid.");
    }

    const before = await this.resolveActiveMemberCardByPhone(input.phoneE164);
    if (input.direction === "decrease" && before.points < input.points) {
      return { status: "rejected", reference: input.reference };
    }

    const response = apiEnvelopeSchema.parse(
      await this.post("/crm/memberPoints/web/points/adjust", {
        cardNo: before.cardNo,
        points: input.points,
        type: POINT_ADJUST_TYPE[input.direction],
        customerId: before.memberId,
        corporationId: this.config.corporationId,
        shopId: this.config.shopId,
        remark: input.reference,
      }),
    );
    if (response.code !== "000") {
      return { status: "rejected", reference: input.reference };
    }

    const identity = this.phoneIdentities.get(input.phoneE164);
    if (!identity) {
      throw new Error("RES phone identity cache was unexpectedly empty.");
    }
    const after = await this.readActiveMemberCard(identity, before.memberId);
    if (after.cardNo !== before.cardNo || after.memberId !== before.memberId) {
      throw new Error("RES member card changed during point adjustment.");
    }
    const expected =
      before.points +
      (input.direction === "increase" ? input.points : -input.points);
    if (after.points !== expected) {
      throw new Error("RES point adjustment readback was inconsistent.");
    }

    return {
      status: "applied",
      reference: input.reference,
      pointsBefore: before.points,
      pointsAfter: after.points,
    };
  }

  private async resolvePhoneIdentity(
    phoneE164: string,
  ): Promise<PhoneIdentity> {
    const cached = this.phoneIdentities.get(phoneE164);
    if (cached) {
      return cached;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phoneE164)) {
      throw new Error("Invalid member phone.");
    }

    const response = phoneFormatEnvelopeSchema.parse(
      await this.post("/operation-manager/format/listPhoneFormatAll", {}),
    );
    assertOk(response);

    const digits = phoneE164.slice(1);
    const matchingFormat = [...response.data]
      .sort(
        (left, right) =>
          right.internationalPhoneAreaCode.length -
          left.internationalPhoneAreaCode.length,
      )
      .find((format) =>
        digits.startsWith(format.internationalPhoneAreaCode),
      );

    if (!matchingFormat) {
      throw new Error("RES phone format could not be resolved.");
    }

    const identity = {
      areaCode: matchingFormat.internationalPhoneAreaCode,
      isoCode: matchingFormat.applyCountry,
      nationalPhone: digits.slice(
        matchingFormat.internationalPhoneAreaCode.length,
      ),
    };
    if (!identity.nationalPhone) {
      throw new Error("RES phone format could not be resolved.");
    }
    this.phoneIdentities.set(phoneE164, identity);
    return identity;
  }

  private async post(pathname: string, body: unknown): Promise<unknown> {
    const response = await this.fetcher(
      new URL(pathname, this.config.baseUrl),
      {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json,text/plain,*/*",
          "Content-Type": "application/json",
          "vulcan-token": this.config.vulcanToken,
          "corporation-id": this.config.corporationId,
          "organization-id": this.config.organizationId,
          "organization-type": this.config.organizationType,
          "brand-id": this.config.brandId,
          "shop-id": this.config.shopId,
          "language-code": this.config.languageCode ?? "en_US",
          "accept-timezone": this.config.timezone ?? "Asia/Kuala_Lumpur",
          Cookie: `i18next=en_US; tenant=${this.config.tenant}`,
        },
        body: JSON.stringify(body),
        signal: this.deadlineSignal
          ? AbortSignal.any([
              this.deadlineSignal,
              AbortSignal.timeout(12_000),
            ])
          : AbortSignal.timeout(12_000),
      },
    );

    if (!response.ok) {
      throw new Error("RES request failed.");
    }
    return response.json();
  }
}

export function createResApiClientFromEnv(
  deadlineSignal?: AbortSignal,
): ResApiClient {
  return new ResApiClient(
    {
      baseUrl: process.env.RES_BASE_URL ?? "https://bo.sea.restosuite.ai",
      vulcanToken: requireEnvironmentVariable("RES_VULCAN_TOKEN"),
      tenant: requireEnvironmentVariable("RES_TENANT"),
      corporationId: requireEnvironmentVariable("RES_CORPORATION_ID"),
      organizationId: requireEnvironmentVariable("RES_ORGANIZATION_ID"),
      organizationType: requireEnvironmentVariable("RES_ORGANIZATION_TYPE"),
      brandId: requireEnvironmentVariable("RES_BRAND_ID"),
      shopId: requireEnvironmentVariable("RES_SHOP_ID"),
    },
    fetch,
    deadlineSignal,
  );
}

function validateConfig(config: ResClientConfig): void {
  const url = new URL(config.baseUrl);
  if (
    url.origin !== "https://bo.sea.restosuite.ai" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("RES_BASE_URL must use the verified RES API origin.");
  }
  for (const [name, value] of Object.entries(config)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Invalid RES configuration: ${name}.`);
    }
    if (/[\r\n;]/.test(value) && name === "tenant") {
      throw new Error("Invalid RES tenant cookie.");
    }
  }
}

function assertOk(response: z.infer<typeof apiEnvelopeSchema>): void {
  if (response.code !== "000") {
    throw new Error("RES returned an unsuccessful response.");
  }
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
