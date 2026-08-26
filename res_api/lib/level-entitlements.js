const LEVEL_ENTITLEMENTS = Object.freeze({
  L1: Object.freeze(["birthday_card"]),
  L2: Object.freeze(["birthday_basque"]),
  L3: Object.freeze(["birthday_custom_cake", "brand_event_priority"]),
  L4: Object.freeze([
    "new_product_preview",
    "birthday_cake_personalization",
    "limited_merch_priority",
    "whatsapp_priority",
    "quarterly_tasting",
  ]),
  L5: Object.freeze([
    "new_product_tasting_box",
    "tasting_invitation_priority",
    "store_fast_lane",
  ]),
});

export function levelKeyFromResName(levelName) {
  const normalized = String(levelName ?? "").trim().toUpperCase();
  const livePrefix = normalized.match(/^LV([1-5])(?:\s|$)/);
  if (livePrefix) return `L${livePrefix[1]}`;
  for (const key of Object.keys(LEVEL_ENTITLEMENTS)) {
    if (normalized === key || normalized.startsWith(`${key} `)) return key;
  }
  return null;
}

export function entitlementsForLevel(levelKey) {
  if (!Object.hasOwn(LEVEL_ENTITLEMENTS, levelKey)) return [];
  const levelNumber = Number(levelKey.slice(1));
  return Object.entries(LEVEL_ENTITLEMENTS)
    .filter(([key]) => Number(key.slice(1)) <= levelNumber)
    .flatMap(([, benefits]) => benefits);
}

export function periodKeyForEntitlement(benefitCode, now = new Date()) {
  const year = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  }).format(now);
  if (["quarterly_tasting", "tasting_invitation_priority"].includes(benefitCode)) {
    const month = Number(new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Kuala_Lumpur",
      month: "numeric",
    }).format(now));
    return `${year}-Q${Math.ceil(month / 3)}`;
  }
  return year;
}
