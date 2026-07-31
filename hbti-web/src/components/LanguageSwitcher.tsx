"use client";

import { localeLabels, supportedLocales } from "@/content/locales";
import type { Locale } from "@/content/types";
import { uiCopy } from "@/content/ui";

import styles from "./hbti.module.css";

interface LanguageSwitcherProps {
  locale: Locale;
  onChange: (locale: Locale) => void;
}

export function LanguageSwitcher({
  locale,
  onChange,
}: LanguageSwitcherProps) {
  return (
    <div
      className={styles.languageSwitcher}
      role="group"
      aria-label={uiCopy[locale].languageLabel}
    >
      {supportedLocales.map((option) => (
        <button
          className={styles.languageButton}
          data-active={option === locale}
          key={option}
          type="button"
          aria-pressed={option === locale}
          onClick={() => onChange(option)}
        >
          {option === "en" ? "EN" : option === "zh-CN" ? "中文" : "BM"}
          <span className={styles.srOnly}> — {localeLabels[option]}</span>
        </button>
      ))}
    </div>
  );
}
