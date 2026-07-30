import type { Locale } from "@/content/types";

export const supportedLocales = ["en", "zh-CN", "ms-MY"] as const satisfies
  readonly Locale[];

export const defaultLocale: Locale = "en";

export const localeLabels: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "ms-MY": "Bahasa Melayu",
};

export function isLocale(value: string): value is Locale {
  return supportedLocales.some((locale) => locale === value);
}
