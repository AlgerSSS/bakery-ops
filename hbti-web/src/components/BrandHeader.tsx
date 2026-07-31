"use client";

import type { Locale } from "@/content/types";
import { uiCopy } from "@/content/ui";

import { LanguageSwitcher } from "./LanguageSwitcher";
import styles from "./hbti.module.css";

interface BrandHeaderProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

export function BrandHeader({
  locale,
  onLocaleChange,
}: BrandHeaderProps) {
  const copy = uiCopy[locale];

  return (
    <header
      className={styles.brandHeader}
      data-surface="brand-lightbox"
    >
      <div
        className={styles.wordmark}
        role="img"
        aria-label="Hot Crush HBTI"
      >
        <span
          className={styles.brandLogo}
          data-brand-wordmark="true"
          aria-hidden="true"
        />
        <span className={styles.wordmarkRule} aria-hidden="true" />
        <span className={styles.wordmarkSub}>{copy.hbti}</span>
      </div>
      <LanguageSwitcher locale={locale} onChange={onLocaleChange} />
    </header>
  );
}
