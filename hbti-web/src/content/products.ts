import type { Locale, Localized } from "@/content/types";

/** Owner-approved HBTI assortment. Prices and POS identities are deliberately separate. */
export const hbtiProducts = [
  {
    id: "original-egg-tart",
    name: { en: "Original Egg Tart", "zh-CN": "原味蛋挞", "ms-MY": "Tat Telur Asli" },
  },
  {
    id: "strawberry-tart",
    name: { en: "Strawberry Tart", "zh-CN": "草莓挞", "ms-MY": "Tat Strawberi" },
  },
  {
    id: "blueberry-puff",
    name: { en: "Blueberry Puff", "zh-CN": "蓝莓泡芙", "ms-MY": "Puf Bluberi" },
  },
  {
    id: "wellington",
    name: { en: "Wellington", "zh-CN": "惠灵顿", "ms-MY": "Wellington" },
  },
  {
    id: "chocolate-crispy-pretzel",
    name: {
      en: "Chocolate Crispy Pretzel",
      "zh-CN": "巧克力薄脆碱水结",
      "ms-MY": "Pretzel Coklat Rangup",
    },
  },
  {
    id: "cake",
    name: {
      en: "Cake (flavour to be confirmed)",
      "zh-CN": "蛋糕（口味待定）",
      "ms-MY": "Kek (rasa belum ditetapkan)",
    },
  },
] as const satisfies readonly { id: string; name: Localized<string> }[];

export type HbtiProductId = (typeof hbtiProducts)[number]["id"];

// Legacy-result fallback only. New clients derive food from scene answers.
export const defaultHbtiProductId: HbtiProductId = "original-egg-tart";

export function hbtiProductName(id: HbtiProductId, locale: Locale): string {
  return (hbtiProducts.find((product) => product.id === id) ?? hbtiProducts[0])
    .name[locale];
}

