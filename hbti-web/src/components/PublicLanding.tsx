"use client";

import { BrandHeader } from "@/components/BrandHeader";
import { uiCopy } from "@/content/ui";

import styles from "./hbti.module.css";
import { useLocale } from "./useLocale";

export function PublicLanding() {
  const { locale, changeLocale } = useLocale();
  const copy = uiCopy[locale];

  return (
    <main className={styles.siteShell}>
      <div className={styles.ambientWash} aria-hidden="true" />
      <div className={styles.pageFrame}>
        <BrandHeader locale={locale} onLocaleChange={changeLocale} />
        <section className={styles.landing}>
          <div className={styles.steamMark} aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <p className={styles.eyebrow}>{copy.landingEyebrow}</p>
          <h1 className={styles.landingTitle}>{copy.landingTitle}</h1>
          <p className={styles.landingBody}>{copy.landingBody}</p>
          <div className={styles.invitationCard}>
            <span className={styles.smsGlyph} aria-hidden="true">
              SMS
            </span>
            <div>
              <strong>{copy.invitationOnly}</strong>
              <p>{copy.landingNote}</p>
            </div>
          </div>
          <CoffeeSpectrum />
          <a
            className={styles.memberReturn}
            href="https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex"
          >
            {copy.returnToMembership}
          </a>
        </section>
      </div>
    </main>
  );
}

function CoffeeSpectrum() {
  return (
    <div className={styles.coffeeSpectrum} aria-hidden="true">
      <span>HOT</span>
      <i />
      <span>ICED</span>
      <i />
      <span>LIGHT</span>
      <i />
      <span>STRONG</span>
    </div>
  );
}
