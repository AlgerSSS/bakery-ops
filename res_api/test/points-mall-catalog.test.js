import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  POINTS_MALL_PRODUCTS,
  buildPointsMallCouponPayload,
  catalogReadiness,
  verifyCouponMappings,
} from "../lib/points-mall-catalog.js";

test("catalog preserves all 13 user-provided point prices and stock facts", () => {
  assert.equal(POINTS_MALL_PRODUCTS.length, 13);
  assert.deepEqual(
    POINTS_MALL_PRODUCTS.map(({ sku, points, inventory }) => ({
      sku,
      points,
      inventory,
    })),
    [
      { sku: "white-pencil", points: 100, inventory: 100 },
      { sku: "red-pencil", points: 100, inventory: 184 },
      { sku: "black-pencil", points: 100, inventory: 190 },
      { sku: "heart-scent-card", points: 150, inventory: 86 },
      { sku: "rose-scent-card", points: 150, inventory: 231 },
      { sku: "butterfly-scent-card", points: 150, inventory: 427 },
      { sku: "rose-fridge-magnet", points: 150, inventory: 6 },
      { sku: "kl-fridge-magnet", points: 150, inventory: 16 },
      { sku: "bow-fridge-magnet", points: 150, inventory: 136 },
      { sku: "red-striped-canvas-tote", points: 400, inventory: 2000 },
      { sku: "overseas-square-cushion", points: 800, inventory: 3400 },
      { sku: "bow-earphone-pouch", points: 900, inventory: null },
      { sku: "cold-brew-cup-sleeve", points: 1500, inventory: 1000 },
    ],
  );
});

test("readiness blocks every unresolved production fact instead of guessing", () => {
  const result = catalogReadiness(POINTS_MALL_PRODUCTS, {
    imageUrls: {},
    couponValidityDays: null,
    redemptionLimit: null,
  });

  assert.equal(result.ready, false);
  assert.equal(result.blockers.filter((item) => item.code === "image_missing").length, 13);
  assert.deepEqual(
    result.blockers.filter((item) => item.code === "inventory_unconfirmed"),
    [{ code: "inventory_unconfirmed", sku: "bow-earphone-pouch" }],
  );
  assert.deepEqual(
    result.blockers.filter((item) => item.code === "coupon_missing"),
    [{ code: "coupon_missing", sku: "cold-brew-cup-sleeve" }],
  );
  assert.equal(
    result.blockers.filter((item) => item.code === "coupon_validity_unconfirmed").length,
    1,
  );
  assert.equal(
    result.blockers.filter((item) => item.code === "redemption_limit_unconfirmed").length,
    1,
  );
});

test("coupon mapping verification catches missing and wrong live templates", () => {
  const mapped = POINTS_MALL_PRODUCTS.filter((product) => product.coupon);
  const liveCoupons = mapped.map((product) => ({
    id: product.coupon.templateId,
    couponTemplateName: product.coupon.templateName,
    couponTemplateType: product.coupon.templateType,
    couponTemplateStatus: 1,
  }));
  liveCoupons[0] = { ...liveCoupons[0], couponTemplateType: 2201 };
  liveCoupons.pop();

  assert.deepEqual(verifyCouponMappings(POINTS_MALL_PRODUCTS, liveCoupons), [
    { sku: "white-pencil", code: "coupon_type_mismatch" },
    { sku: "bow-earphone-pouch", code: "coupon_not_found" },
    { sku: "cold-brew-cup-sleeve", code: "coupon_unassigned" },
  ]);
});

test("payload matches the RES coupon-product contract and leaves limits disabled", () => {
  const product = POINTS_MALL_PRODUCTS[0];
  const payload = buildPointsMallCouponPayload(product, {
    imageUrl: "https://images.example.test/white-pencil.png",
    inventory: 100,
    couponValidityDays: 30,
    ownerOrgId: "org-1",
    redemptionLimit: "unlimited",
  });

  assert.deepEqual(payload, {
    category: "1",
    name: "白色铅笔 / White Pencil",
    picUrl: "https://images.example.test/white-pencil.png",
    totalInventoryQty: 100,
    redeemPoints: 100,
    remark: "积分兑换商品。兑换成功后，请凭 RES 券到店核销领取。",
    limitApplyTime: false,
    limitUserTotalQty: false,
    limitUserDayQty: false,
    userTotalQty: null,
    userDayQty: null,
    details: [
      {
        couponTemplateId: "2083832575641862144",
        giftType: 1,
        couponTemplateName: "HBTI Gift · White Pencil",
        couponTemplateType: 2301,
        giftSubType: 2301,
        couponTemplateStatus: 1,
        giftCount: 1,
        effectiveType: 1,
        relativeEffectiveUnit: 1,
        relativeEffectiveValue: 0,
        effectiveUnit: 2,
        effectiveTimeValue: 30,
        absoluteStartDate: null,
        absoluteEndDate: null,
        businessId: "2083832575641862144",
        type: 2301,
        quantity: 1,
        name: "HBTI Gift · White Pencil",
      },
    ],
    applyTime: null,
    owner: "org-1",
    redeemAmount: 0,
  });
});

test("payload builder refuses unresolved images, stock, coupon, validity, and limits", () => {
  const product = POINTS_MALL_PRODUCTS.find(
    (item) => item.sku === "cold-brew-cup-sleeve",
  );
  assert.throws(
    () =>
      buildPointsMallCouponPayload(product, {
        imageUrl: "",
        inventory: null,
        couponValidityDays: null,
        ownerOrgId: "",
        redemptionLimit: null,
      }),
    /cannot build RES points-mall payload/i,
  );
});

test("live preview script contains no RES mutation endpoint", () => {
  const source = fs.readFileSync(
    new URL("../scripts/preview-points-mall.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /pointsmall\/(?:item|basicinfo)\/(?:save|update|archive|unarchive|onsale|offsale|invAdjust)/,
  );
});
