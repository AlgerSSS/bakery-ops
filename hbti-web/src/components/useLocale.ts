"use client";

import { useCallback, useEffect, useState } from "react";

import { defaultLocale, isLocale } from "@/content/locales";
import type { Locale } from "@/content/types";

const LANGUAGE_KEY = "hot-crush-hbti-language";

export function useLocale() {
  const [locale, setLocale] = useState<Locale>(defaultLocale);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedLocale = window.localStorage.getItem(LANGUAGE_KEY);
        if (storedLocale && isLocale(storedLocale)) {
          setLocale(storedLocale);
          document.documentElement.lang = storedLocale;
        }
      } catch {
        document.documentElement.lang = defaultLocale;
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const changeLocale = useCallback((nextLocale: Locale) => {
    setLocale(nextLocale);
    document.documentElement.lang = nextLocale;
    try {
      window.localStorage.setItem(LANGUAGE_KEY, nextLocale);
    } catch {
      // Language switching must still work when storage is unavailable.
    }
  }, []);

  return { locale, changeLocale };
}
