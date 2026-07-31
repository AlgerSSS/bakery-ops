"use client";

import {
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  type SupportedCountry,
  normalizeNationalNumber,
  supportedCountries,
} from "@/lib/auth/countries";
import type { UiCopy } from "@/content/ui";

import styles from "./hbti.module.css";

const REQUEST_TIMEOUT_MS = 15_000;

const countries = supportedCountries;

type Country = SupportedCountry;
type Confirmation = "conflict" | "membership";

interface AuthenticatedMember {
  maskedPhone: string;
  draftKey: string;
}

interface MemberSignInProps {
  copy: UiCopy;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onAuthenticated: (member: AuthenticatedMember) => void;
}

interface OtpReply {
  challengeToken?: string;
  maskedPhone?: string;
  retryAfterSeconds?: number;
  authenticated?: boolean;
  draftKey?: string;
  error?: string;
}

export function MemberSignIn({
  copy,
  headingRef,
  onAuthenticated,
}: MemberSignInProps) {
  const [country, setCountry] = useState<Country>(countries[0]);
  const [phone, setPhone] = useState("");
  const [challengeToken, setChallengeToken] = useState<string>();
  const [maskedPhone, setMaskedPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"sending" | "verifying">();
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [resendSeconds, setResendSeconds] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendSeconds <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  async function requestCode() {
    const nationalPhone = normalizeNationalNumber(phone, country);
    if (!country.pattern.test(nationalPhone)) {
      setError(copy.invalidPhone);
      return;
    }

    setBusy("sending");
    setError(undefined);
    setConfirmation(undefined);

    try {
      const response = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: {
            countryCode: country.countryCode,
            isoCode: country.isoCode,
            phone: nationalPhone,
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = await readOtpReply(response);
      if (
        !response.ok ||
        typeof payload.challengeToken !== "string" ||
        payload.challengeToken.length === 0
      ) {
        setError(errorMessage(payload.error, copy));
        return;
      }

      setChallengeToken(payload.challengeToken);
      setMaskedPhone(payload.maskedPhone ?? maskPhone(nationalPhone, country));
      setResendSeconds(
        validRetrySeconds(payload.retryAfterSeconds) ?? 60,
      );
      window.setTimeout(() => codeRef.current?.focus(), 120);
    } catch {
      setError(copy.authNetworkError);
    } finally {
      setBusy(undefined);
    }
  }

  async function verifyCode(confirmConflict = false) {
    if (!challengeToken) {
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError(copy.invalidCode);
      return;
    }

    setBusy("verifying");
    setError(undefined);

    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken,
          code,
          acceptMembership: true,
          ...(confirmConflict ? { confirmConflict: true } : {}),
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const payload = await readOtpReply(response);

      if (
        response.ok &&
        payload.authenticated === true &&
        typeof payload.maskedPhone === "string" &&
        typeof payload.draftKey === "string"
      ) {
        onAuthenticated({
          maskedPhone: payload.maskedPhone,
          draftKey: payload.draftKey,
        });
        return;
      }

      if (payload.error === "ACCOUNT_CONFLICT_CONFIRMATION_REQUIRED") {
        setConfirmation("conflict");
        return;
      }
      if (payload.error === "MEMBERSHIP_CONSENT_REQUIRED") {
        setConfirmation("membership");
        return;
      }
      setError(errorMessage(payload.error, copy));
    } catch {
      setError(copy.authNetworkError);
    } finally {
      setBusy(undefined);
    }
  }

  function changePhone() {
    setChallengeToken(undefined);
    setMaskedPhone("");
    setCode("");
    setError(undefined);
    setConfirmation(undefined);
    setResendSeconds(0);
  }

  const isSending = busy === "sending";
  const isVerifying = busy === "verifying";

  return (
    <section className={styles.authPanel}>
      <div
        className={styles.steamMark}
        data-brand-mark="arrow"
        aria-hidden="true"
      >
        <i />
        <i />
        <i />
      </div>
      <p className={styles.eyebrow}>{copy.authEyebrow}</p>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className={styles.authTitle}
      >
        {copy.authTitle}
      </h1>
      <p className={styles.authBody}>{copy.authBody}</p>

      <div className={styles.authCard}>
        <div className={styles.memberPass} aria-hidden="true">
          <span>HBTI</span>
          <i />
          <span>MEMBER</span>
        </div>

        {!challengeToken ? (
          <form
            className={styles.authForm}
            onSubmit={(event) => {
              event.preventDefault();
              void requestCode();
            }}
          >
            <label htmlFor="member-phone">{copy.phoneLabel}</label>
            <div className={styles.phoneRow}>
              <label className={styles.countrySelect}>
                <span className={styles.srOnly}>{copy.countryLabel}</span>
                <select
                  aria-label={copy.countryLabel}
                  value={country.isoCode}
                  onChange={(event) => {
                    const nextCountry =
                      countries.find(
                        ({ isoCode }) => isoCode === event.target.value,
                      ) ?? countries[0];
                    setCountry(nextCountry);
                    setError(undefined);
                  }}
                >
                  {countries.map((item) => (
                    <option key={item.isoCode} value={item.isoCode}>
                      {item.isoCode} +{item.countryCode}
                    </option>
                  ))}
                </select>
              </label>
              <input
                id="member-phone"
                className={styles.textInput}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={country.placeholder}
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setError(undefined);
                }}
                maxLength={24}
                aria-invalid={error ? true : undefined}
                aria-describedby={`member-phone-note membership-consent${
                  error ? " member-phone-error" : ""
                }`}
              />
            </div>
            <p id="member-phone-note" className={styles.fieldSupport}>
              {copy.phoneHint}
            </p>
            <p id="membership-consent" className={styles.membershipConsent}>
              <span aria-hidden="true">✓</span>
              {copy.membershipConsent}
            </p>
            {error && (
              <p
                id="member-phone-error"
                className={styles.inlineError}
                role="alert"
              >
                {error}
              </p>
            )}
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={isSending}
            >
              {isSending ? copy.sendingCode : copy.sendCode}
              {!isSending && <ForwardIcon />}
            </button>
          </form>
        ) : confirmation ? (
          <div
            className={styles.confirmationPanel}
            role="status"
            aria-live="polite"
          >
            <span className={styles.confirmationGlyph} aria-hidden="true">
              ↗
            </span>
            <h2>
              {confirmation === "conflict"
                ? copy.conflictTitle
                : copy.membershipTitle}
            </h2>
            <p>
              {confirmation === "conflict"
                ? copy.conflictBody
                : copy.membershipBody}
            </p>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={isVerifying}
              onClick={() => void verifyCode(confirmation === "conflict")}
            >
              {confirmation === "conflict"
                ? copy.confirmConflict
                : copy.confirmMembership}
              {!isVerifying && <ForwardIcon />}
            </button>
            <button
              className={styles.textButton}
              type="button"
              onClick={changePhone}
            >
              {copy.useAnotherPhone}
            </button>
          </div>
        ) : (
          <form
            className={styles.authForm}
            onSubmit={(event) => {
              event.preventDefault();
              void verifyCode();
            }}
          >
            <div className={styles.codeSentRow}>
              <div>
                <span>{copy.codeSent}</span>
                <strong>{maskedPhone}</strong>
              </div>
              <button type="button" onClick={changePhone}>
                {copy.changePhone}
              </button>
            </div>
            <label htmlFor="member-code">{copy.codeLabel}</label>
            <input
              ref={codeRef}
              id="member-code"
              className={`${styles.textInput} ${styles.codeInput}`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                setError(undefined);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "member-code-error" : undefined}
            />
            {error && (
              <p
                id="member-code-error"
                className={styles.inlineError}
                role="alert"
              >
                {error}
              </p>
            )}
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={isVerifying || code.length !== 6}
            >
              {isVerifying ? copy.verifyingCode : copy.verifyCode}
              {!isVerifying && <ForwardIcon />}
            </button>
            <button
              className={styles.resendButton}
              type="button"
              disabled={resendSeconds > 0 || isSending}
              onClick={() => void requestCode()}
            >
              {resendSeconds > 0
                ? copy.resendIn(resendSeconds)
                : copy.resendCode}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

function ForwardIcon() {
  return (
    <span
      className={styles.forwardIcon}
      data-brand-arrow="true"
      aria-hidden="true"
    />
  );
}

function maskPhone(phone: string, country: Country): string {
  // Shrink the visible windows on short numbers. Fixed 3+4 slices overlap once
  // the national number is under seven digits (Brunei, Hong Kong), which would
  // print every digit and call it a mask.
  const budget = Math.max(0, phone.length - 2);
  const startLength = Math.min(3, Math.floor(budget / 2));
  const endLength = Math.min(4, budget - startLength);
  const hidden = "•".repeat(phone.length - startLength - endLength);
  const visibleEnd = endLength > 0 ? phone.slice(-endLength) : "";
  return `+${country.countryCode} ${phone.slice(
    0,
    startLength,
  )}${hidden}${visibleEnd}`;
}

function validRetrySeconds(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 300
    ? value
    : undefined;
}

async function readOtpReply(response: Response): Promise<OtpReply> {
  try {
    const payload: unknown = await response.json();
    return typeof payload === "object" && payload !== null
      ? (payload as OtpReply)
      : {};
  } catch {
    return {};
  }
}

function errorMessage(error: string | undefined, copy: UiCopy): string {
  switch (error) {
    case "INVALID_PHONE":
      return copy.invalidPhone;
    case "INVALID_CODE":
    case "OTP_INVALID":
    case "VERIFICATION_FAILED":
    case "INVALID_VERIFICATION_CODE":
      return copy.invalidCode;
    case "OTP_EXPIRED":
    case "CHALLENGE_EXPIRED":
    case "CHALLENGE_EXPIRED_OR_USED":
      return copy.codeExpired;
    case "TOO_MANY_ATTEMPTS":
      return copy.tooManyAttempts;
    case "RATE_LIMITED":
      return copy.rateLimited;
    case "CAPTCHA_REQUIRED":
    case "CAPTCHA_REQUIRED_UNSUPPORTED":
      return copy.captchaRequired;
    default:
      return copy.authNetworkError;
  }
}
