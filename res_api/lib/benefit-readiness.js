export const SEE_YOU_OFTEN_BENEFIT_REQUIREMENTS = Object.freeze({
  launchDate: "2026-08-29",
  memberDay: Object.freeze({
    weekday: "WED",
    pointsMultiplier: 1.5,
  }),
  storedValue: Object.freeze({
    topUpAmountCents: 10_000,
    bonusAmountCents: 2_000,
    principalSameDayAvailablePercent: 0,
    bonusValidityDays: 90,
    balanceConsumptionPriority: "bonus_first",
    openEnded: true,
  }),
});

export const RES_NATIVE_BENEFIT_CAPABILITIES = Object.freeze({
  memberDayPointsMultiplier: Object.freeze({
    min: 2,
    max: 9,
    precision: 0,
  }),
  birthdayGift: Object.freeze({
    giftAdvanceDaysMin: 0,
    couponValidityModes: Object.freeze([
      "same_day",
      "current_month",
      "custom_days",
      "fixed_dates",
    ]),
    customValidityDaysMin: 1,
    customValidityDaysMax: 1_200,
    notificationChannels: Object.freeze(["mini_program"]),
  }),
  levelingGift: Object.freeze({
    canSelectLoyaltyProgram: true,
    canSelectPartialLevels: true,
    notificationChannels: Object.freeze(["mini_program"]),
  }),
  storedValue: Object.freeze({
    principalSameDayAvailablePercent: Object.freeze({ min: 1, max: 100 }),
    canBlockGiftedBalanceOnTopUpDay: true,
    perGrantGiftBalanceExpiry: false,
    configurableBalanceConsumptionPriority: false,
    requiresFiniteEndDate: true,
  }),
});

function id(value) {
  return String(value ?? "").trim();
}

function amount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function supportsNumber(value, capability) {
  const precision = Number(capability?.precision);
  if (!Number.isInteger(precision) || precision < 0) return false;
  const scale = 10 ** precision;
  return (
    value >= capability.min &&
    value <= capability.max &&
    Number.isInteger(value * scale)
  );
}

function liveCampaign(campaign, type) {
  return (
    Number(campaign?.type) === type &&
    Number(campaign?.status) === 1 &&
    Number(campaign?.validStatus) === 1
  );
}

function liveMemberRight(right, type) {
  return Number(right?.type) === type && Number(right?.status) === 1;
}

function matchingTopUp(program, nowDate) {
  const rule = program?.rules?.[0];
  return (
    amount(rule?.storedAmount) ===
      SEE_YOU_OFTEN_BENEFIT_REQUIREMENTS.storedValue.topUpAmountCents &&
    amount(rule?.returnAmount) ===
      SEE_YOU_OFTEN_BENEFIT_REQUIREMENTS.storedValue.bonusAmountCents &&
    Number(program?.status) === 1 &&
    id(program?.startDate) <= nowDate &&
    id(program?.endDate) >= nowDate
  );
}

export function nativeBenefitGaps(
  capabilities = RES_NATIVE_BENEFIT_CAPABILITIES,
) {
  const gaps = [];
  const memberDay = SEE_YOU_OFTEN_BENEFIT_REQUIREMENTS.memberDay;
  const memberDayCapability = capabilities.memberDayPointsMultiplier;
  if (!supportsNumber(memberDay.pointsMultiplier, memberDayCapability)) {
    gaps.push({
      code: "member_day_fractional_multiplier_unsupported",
      required: memberDay.pointsMultiplier,
      supported: `${memberDayCapability.min}-${memberDayCapability.max} integers`,
    });
  }

  const stored = SEE_YOU_OFTEN_BENEFIT_REQUIREMENTS.storedValue;
  const storedCapability = capabilities.storedValue;
  if (
    stored.principalSameDayAvailablePercent <
    storedCapability.principalSameDayAvailablePercent.min
  ) {
    gaps.push({
      code: "principal_same_day_zero_percent_unsupported",
      required: stored.principalSameDayAvailablePercent,
      supportedMin: storedCapability.principalSameDayAvailablePercent.min,
    });
  }
  if (stored.bonusValidityDays && !storedCapability.perGrantGiftBalanceExpiry) {
    gaps.push({
      code: "gift_balance_expiry_unsupported",
      requiredDays: stored.bonusValidityDays,
    });
  }
  if (
    stored.balanceConsumptionPriority === "bonus_first" &&
    !storedCapability.configurableBalanceConsumptionPriority
  ) {
    gaps.push({
      code: "gift_first_consumption_unsupported",
      required: stored.balanceConsumptionPriority,
    });
  }
  if (stored.openEnded && storedCapability.requiresFiniteEndDate) {
    gaps.push({
      code: "open_ended_top_up_program_unsupported",
    });
  }
  return gaps;
}

export function assessBenefitReadiness({
  memberRights = [],
  campaigns = [],
  topUpPrograms = [],
  nowDate,
  processManagementAccessible = false,
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(nowDate || ""))) {
    throw new TypeError("nowDate must use YYYY-MM-DD.");
  }

  const configured = {
    memberDay: memberRights.some((right) => liveMemberRight(right, 7)),
    birthdayGift: campaigns.some((campaign) => liveCampaign(campaign, 1003)),
    levelingGift: campaigns.some((campaign) => liveCampaign(campaign, 1002)),
    topUp100Plus20: topUpPrograms.some((program) =>
      matchingTopUp(program, nowDate),
    ),
    smsProcessManagement: Boolean(processManagementAccessible),
  };
  const blockers = nativeBenefitGaps();
  for (const [key, present] of Object.entries(configured)) {
    if (!present) blockers.push({ code: `live_${key}_missing` });
  }

  return {
    ready: blockers.length === 0,
    configured,
    nativeGaps: nativeBenefitGaps(),
    blockers,
  };
}
