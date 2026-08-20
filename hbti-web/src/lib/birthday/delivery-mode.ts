export type BirthdayDeliveryMode = "card" | "cake" | "basque";

export function parseBirthdayDeliveryMode(
  value: string | string[] | undefined,
): BirthdayDeliveryMode {
  return value === "cake" || value === "basque" || value === "card"
    ? value
    : "card";
}

export function deliveryModeGiftType(
  mode: BirthdayDeliveryMode,
): "points_450" | "free_basque" | undefined {
  if (mode === "cake") return "points_450";
  if (mode === "basque") return "free_basque";
  return undefined;
}
