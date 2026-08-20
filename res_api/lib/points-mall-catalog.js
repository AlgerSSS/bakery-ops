const coupon = (templateId, templateName, templateType) =>
  Object.freeze({ templateId, templateName, templateType });

const product = (value) =>
  Object.freeze({
    imageUrl: null,
    ...value,
  });

export const POINTS_MALL_PRODUCTS = Object.freeze([
  product({
    sku: "white-pencil",
    name: "白色铅笔 / White Pencil",
    costMyr: null,
    retailMyr: 4,
    retailApproximate: true,
    points: 100,
    inventory: 100,
    demandSharePct: 21,
    coupon: coupon(
      "2083832575641862144",
      "HBTI Gift · White Pencil",
      2301,
    ),
  }),
  product({
    sku: "red-pencil",
    name: "红色铅笔 / Red Pencil",
    costMyr: null,
    retailMyr: 4,
    retailApproximate: true,
    points: 100,
    inventory: 184,
    demandSharePct: 39,
    coupon: coupon(
      "2083837285899784192",
      "HBTI Gift · Red Pencil",
      2301,
    ),
  }),
  product({
    sku: "black-pencil",
    name: "黑色铅笔 / Black Pencil",
    costMyr: null,
    retailMyr: 4,
    retailApproximate: true,
    points: 100,
    inventory: 190,
    demandSharePct: 40,
    coupon: coupon(
      "2083837290098278401",
      "HBTI Gift · Black Pencil",
      2301,
    ),
  }),
  product({
    sku: "heart-scent-card",
    name: "爱心纸香卡 / Heart Scent Card",
    costMyr: 1.92,
    retailMyr: 7.68,
    points: 150,
    inventory: 86,
    demandSharePct: 12,
    coupon: coupon(
      "2083837306854522882",
      "HBTI Gift · Heart Scent Card",
      2301,
    ),
  }),
  product({
    sku: "rose-scent-card",
    name: "玫瑰纸香卡 / Rose Scent Card",
    costMyr: 1.92,
    retailMyr: 7.68,
    points: 150,
    inventory: 231,
    demandSharePct: 31,
    coupon: coupon(
      "2083837311493423105",
      "HBTI Gift · Rose Scent Card",
      2301,
    ),
  }),
  product({
    sku: "butterfly-scent-card",
    name: "蝴蝶纸香卡 / Butterfly Scent Card",
    costMyr: 1.92,
    retailMyr: 7.68,
    points: 150,
    inventory: 427,
    demandSharePct: 57,
    coupon: coupon(
      "2083837316815994881",
      "HBTI Gift · Butterfly Scent Card",
      2301,
    ),
  }),
  product({
    sku: "rose-fridge-magnet",
    name: "玫瑰冰箱贴 / Rose Fridge Magnet",
    costMyr: 1.92,
    retailMyr: 7.68,
    points: 150,
    inventory: 6,
    demandSharePct: 4,
    coupon: coupon(
      "2083837321220014083",
      "HBTI Gift · Rose Fridge Magnet",
      2301,
    ),
  }),
  product({
    sku: "kl-fridge-magnet",
    name: "吉隆坡冰箱贴 / KL Fridge Magnet",
    costMyr: 1.92,
    retailMyr: 7.68,
    points: 150,
    inventory: 16,
    demandSharePct: 10,
    coupon: coupon(
      "2083837325338820612",
      "HBTI Gift · KL Fridge Magnet",
      2301,
    ),
  }),
  product({
    sku: "bow-fridge-magnet",
    name: "蝴蝶结冰箱贴 / Bow Fridge Magnet",
    costMyr: 1.92,
    retailMyr: 7.68,
    points: 150,
    inventory: 136,
    demandSharePct: 86,
    coupon: coupon(
      "2083837331248594946",
      "HBTI Gift · Bow Fridge Magnet",
      2301,
    ),
  }),
  product({
    sku: "red-striped-canvas-tote",
    name: "红色条纹帆布包 / Red Striped Canvas Tote",
    costMyr: 5.73,
    retailMyr: 22.92,
    points: 400,
    inventory: 2000,
    demandSharePct: null,
    coupon: coupon(
      "2022494949836361730",
      "红色条纹帆布包Hot Crush Red Stripes Canvas Tote Bag",
      2101,
    ),
  }),
  product({
    sku: "overseas-square-cushion",
    name: "海外方形抱枕 / Overseas Square Cushion",
    costMyr: 10.59,
    retailMyr: 42.36,
    points: 800,
    inventory: 3400,
    demandSharePct: null,
    coupon: coupon("2043360260173139970", "cushion", 2101),
  }),
  product({
    sku: "bow-earphone-pouch",
    name: "蝴蝶结耳机包 / Bow Earphone Pouch",
    costMyr: 11.69,
    retailMyr: 46.76,
    points: 900,
    inventory: null,
    observedInventory: 6,
    inventoryNote: "待盘点；门店有 6 个全新",
    demandSharePct: null,
    coupon: coupon(
      "1998965051872153608",
      "蝴蝶结耳机包【商城】",
      2101,
    ),
  }),
  product({
    sku: "cold-brew-cup-sleeve",
    name: "冷萃杯＋杯套 / Cold Brew Cup + Sleeve",
    costMyr: 20.33,
    retailMyr: 81.32,
    points: 1500,
    inventory: 1000,
    demandSharePct: 75,
    coupon: null,
  }),
]);

function validImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

export function catalogReadiness(
  products,
  {
    imageUrls = {},
    inventoryOverrides = {},
    couponOverrides = {},
    couponValidityDays,
    redemptionLimit,
  } = {},
) {
  const blockers = [];
  if (!positiveInteger(couponValidityDays)) {
    blockers.push({ code: "coupon_validity_unconfirmed" });
  }
  if (redemptionLimit !== "unlimited") {
    blockers.push({ code: "redemption_limit_unconfirmed" });
  }

  for (const item of products) {
    const imageUrl = imageUrls[item.sku] ?? item.imageUrl;
    const inventory = inventoryOverrides[item.sku] ?? item.inventory;
    const mappedCoupon = couponOverrides[item.sku] ?? item.coupon;
    if (!validImageUrl(imageUrl)) {
      blockers.push({ code: "image_missing", sku: item.sku });
    }
    if (!positiveInteger(inventory)) {
      blockers.push({ code: "inventory_unconfirmed", sku: item.sku });
    }
    if (!mappedCoupon?.templateId) {
      blockers.push({ code: "coupon_missing", sku: item.sku });
    }
  }
  return { ready: blockers.length === 0, blockers };
}

export function verifyCouponMappings(products, liveCoupons) {
  const liveById = new Map(
    liveCoupons.map((item) => [String(item.id ?? ""), item]),
  );
  const issues = [];
  for (const item of products) {
    if (!item.coupon) {
      issues.push({ sku: item.sku, code: "coupon_unassigned" });
      continue;
    }
    const live = liveById.get(item.coupon.templateId);
    if (!live) {
      issues.push({ sku: item.sku, code: "coupon_not_found" });
    } else if (Number(live.couponTemplateType) !== item.coupon.templateType) {
      issues.push({ sku: item.sku, code: "coupon_type_mismatch" });
    } else if (Number(live.couponTemplateStatus) !== 1) {
      issues.push({ sku: item.sku, code: "coupon_inactive" });
    } else if (live.couponTemplateName !== item.coupon.templateName) {
      issues.push({ sku: item.sku, code: "coupon_name_mismatch" });
    }
  }
  return issues;
}

export function buildPointsMallCouponPayload(
  item,
  {
    imageUrl,
    inventory = item?.inventory,
    coupon = item?.coupon,
    couponValidityDays,
    ownerOrgId,
    redemptionLimit,
  } = {},
) {
  const invalid = [];
  if (!item) invalid.push("product");
  if (!validImageUrl(imageUrl)) invalid.push("image");
  if (!positiveInteger(inventory)) invalid.push("inventory");
  if (!coupon?.templateId) invalid.push("coupon");
  if (!positiveInteger(couponValidityDays)) invalid.push("coupon validity");
  if (!ownerOrgId) invalid.push("owner organization");
  if (redemptionLimit !== "unlimited") invalid.push("redemption limit");
  if (invalid.length) {
    throw new Error(
      `Cannot build RES points-mall payload; unresolved: ${invalid.join(", ")}.`,
    );
  }

  const detail = {
    couponTemplateId: coupon.templateId,
    giftType: 1,
    couponTemplateName: coupon.templateName,
    couponTemplateType: coupon.templateType,
    giftSubType: coupon.templateType,
    couponTemplateStatus: 1,
    giftCount: 1,
    effectiveType: 1,
    relativeEffectiveUnit: 1,
    relativeEffectiveValue: 0,
    effectiveUnit: 2,
    effectiveTimeValue: couponValidityDays,
    absoluteStartDate: null,
    absoluteEndDate: null,
    businessId: coupon.templateId,
    type: coupon.templateType,
    quantity: 1,
    name: coupon.templateName,
  };

  return {
    category: "1",
    name: item.name,
    picUrl: imageUrl,
    totalInventoryQty: inventory,
    redeemPoints: item.points,
    remark: "积分兑换商品。兑换成功后，请凭 RES 券到店核销领取。",
    limitApplyTime: false,
    limitUserTotalQty: false,
    limitUserDayQty: false,
    userTotalQty: null,
    userDayQty: null,
    details: [detail],
    applyTime: null,
    owner: ownerOrgId,
    redeemAmount: 0,
  };
}
