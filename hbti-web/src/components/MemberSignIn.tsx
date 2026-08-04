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
import type { PublicCaptchaConfig } from "@/lib/auth/captcha-config";
import {
  type CaptchaSolution,
  preloadCaptcha,
  solveCaptcha,
} from "@/lib/auth/tencent-captcha";
import type { Locale } from "@/content/types";
import type { UiCopy } from "@/content/ui";

import styles from "./hbti.module.css";

/**
 * 浏览器必须晚于服务端 30 秒 maxDuration 再放弃，外加一点响应回程余量。
 * 否则浏览器先断开，顾客重试时原请求仍可能占着 challenge，反而得到
 * 「已过期/已使用」并走进死路。
 */
const VERIFY_TIMEOUT_MS = 35_000;

/**
 * 发码要等服务端串行走三次 RES 调用，所以给它单独一个更长的时限。
 *
 * 必须大于路由里的 RES_DEADLINE_MS（18 秒），否则会出现最糟的一种失败：
 * 浏览器先放弃、顾客看到「网络错误」，而短信其实已经发出去了——顾客接着去点重发，
 * 而实测同号码当天的重发正是 RES 会静默丢掉的那一类。宁可多转几秒，
 * 也不能对着一次已经成功的发送报错。
 */
const SEND_TIMEOUT_MS = 25_000;

const countries = supportedCountries;

type Country = SupportedCountry;
type Confirmation = "conflict" | "membership";

interface AuthenticatedMember {
  maskedPhone: string;
  draftKey: string;
}

interface MemberSignInProps {
  copy: UiCopy;
  locale: Locale;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onAuthenticated: (member: AuthenticatedMember) => void;
}

/**
 * 腾讯验证码弹层的语言码。
 *
 * 马来文按 `en` 处理：腾讯的语言表里没有 ms，RES 自己 H5 的映射同样没有、
 * 落到它的 `|| "en"` 兜底。硬塞一个不支持的码只会让弹层显示成默认中文。
 */
const CAPTCHA_LANGUAGE: Record<Locale, string> = {
  en: "en",
  "zh-CN": "zh-cn",
  "ms-MY": "en",
};

interface OtpReply {
  challengeToken?: string;
  maskedPhone?: string;
  retryAfterSeconds?: number;
  authenticated?: boolean;
  draftKey?: string;
  error?: string;
  /** 这个号码今天已经发过码了；实测这种情况下新的短信多半不会送达。 */
  resendMayNotArrive?: boolean;
}

/** 请求超时（含 AbortSignal.timeout）——与「网线断了」不是一回事，提示语也不同。 */
function isTimeout(caught: unknown): boolean {
  return (
    caught instanceof DOMException &&
    (caught.name === "TimeoutError" || caught.name === "AbortError")
  );
}

export function MemberSignIn({
  copy,
  locale,
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
  // 倒计时归属于哪个号码。「换个号码」不该把它清零——号码没变，冷却就该继续，
  // 否则顾客可以立刻再发一次，而那一次 RES 多半不会送达。只有真的换了号才重置。
  const [cooldownPhone, setCooldownPhone] = useState<string>();
  const [sendCaveat, setSendCaveat] = useState<"mayNotArrive" | "maybeSent">();
  const [captchaConfig, setCaptchaConfig] = useState<PublicCaptchaConfig>();
  const codeRef = useRef<HTMLInputElement>(null);

  // 挂载时就问清楚要不要过图形验证码，并把 SDK 预热。等到顾客点「发送」再拉脚本，
  // 那几百毫秒的空白里他们通常已经又点了一次。
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/auth/captcha", {
          cache: "no-store",
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        const payload = (await response.json()) as PublicCaptchaConfig;
        if (!alive) return;
        setCaptchaConfig(payload);
        if (payload.enable && payload.provider === "tencent-cloud") {
          preloadCaptcha();
        }
      } catch {
        // 探测失败不在这里报错：真正要紧的判定在服务端，发码时会如实拒绝。
        // 这里静默留空，避免页面一打开就先弹一条顾客无法处理的错误。
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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

    // 图形验证码要在进入 busy 之前解完：弹层是模态的，顾客可能想了半分钟，
    // 这段时间按钮不该一直转圈，更不该占着 sending 状态挡住「取消」。
    let captcha: CaptchaSolution | undefined;
    if (captchaConfig?.enable) {
      if (captchaConfig.provider !== "tencent-cloud" || !captchaConfig.appId) {
        setError(copy.captchaRequired);
        return;
      }
      const outcome = await solveCaptcha(
        captchaConfig.appId,
        CAPTCHA_LANGUAGE[locale],
      );
      if (outcome.status === "dismissed") {
        // 顾客自己关掉的，不是故障。给一句能行动的提示，不做成红色报错。
        setError(copy.captchaDismissed);
        return;
      }
      if (outcome.status === "unavailable") {
        setError(copy.captchaRequired);
        return;
      }
      captcha = outcome.solution;
    }

    setBusy("sending");
    setError(undefined);
    setConfirmation(undefined);
    setSendCaveat(undefined);

    const cooldownKey = `${country.countryCode}:${nationalPhone}`;
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
          ...(captcha ? { captcha } : {}),
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
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
      setCooldownPhone(cooldownKey);
      if (payload.resendMayNotArrive === true) {
        setSendCaveat("mayNotArrive");
      }
      window.setTimeout(() => codeRef.current?.focus(), 120);
    } catch (caught) {
      // 超时和「网线断了」必须分开说。请求已经发出去、只是没等到回复时，
      // 短信很可能已经在路上，这时催顾客重试是最坏的建议——重发正是 RES 丢掉的那类。
      if (isTimeout(caught)) {
        // 绝不动 challengeToken：这次若是「重发」超时，之前那次拿到的令牌仍然有效，
        // 清掉就等于把顾客手里能用的验证码作废了。
        setResendSeconds(60);
        setCooldownPhone(cooldownKey);
        setSendCaveat("maybeSent");
        setError(copy.authSendTimeout);
      } else {
        setError(copy.authNetworkError);
      }
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
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
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
    } catch (caught) {
      setError(
        isTimeout(caught) ? copy.authVerifyTimeout : copy.authNetworkError,
      );
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
    // 这里**不再**把 resendSeconds 归零。此前归零而号码原样留在输入框里，
    // 顾客点一下「换个号码」再点「发送」就能立刻再发一次——绕过了 1 次/分钟的限流，
    // 而那一次 RES 多半静默丢弃。冷却对不对号，由下面的 cooldownApplies 在渲染时判断。
  }

  const isSending = busy === "sending";
  const isVerifying = busy === "verifying";

  // 冷却和提示都归属于「发码时用的那个号码」。换了号码它们自然失效——在渲染时算，
  // 而不是拿 effect 去同步 state（那样既会多渲染一轮，也正是 react-hooks 规则要拦的写法）。
  //
  // 这也修掉了原来的漏洞：「换个号码」按钮把倒计时清零却把号码原样留在输入框里，
  // 顾客点两下就能立刻再发一次，绕过 1 次/分钟的限流——而那一次 RES 多半静默丢弃。
  const cooldownKey = `${country.countryCode}:${normalizeNationalNumber(
    phone,
    country,
  )}`;
  const cooldownApplies = cooldownPhone === cooldownKey;
  const cooldownLeft = cooldownApplies ? resendSeconds : 0;
  const activeCaveat = cooldownApplies ? sendCaveat : undefined;

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
            {activeCaveat === "maybeSent" && (
              <p className={styles.inlineNote} role="status">
                {copy.authMaybeSentNote}
              </p>
            )}
            {/* 冷却对这个号码仍然有效时，发送键也要锁住。只锁「重发」键是不够的：
                点一下「换个号码」就回到这张表单，号码还原样在框里，一按就又发一次。 */}
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={isSending || cooldownLeft > 0}
            >
              {cooldownLeft > 0
                ? copy.resendIn(cooldownLeft)
                : isSending
                  ? copy.sendingCode
                  : copy.sendCode}
              {!isSending && cooldownLeft === 0 && <ForwardIcon />}
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
            {activeCaveat === "mayNotArrive" && (
              <p className={styles.inlineNote} role="status">
                {copy.authResendMayNotArrive}
              </p>
            )}
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
              disabled={cooldownLeft > 0 || isSending}
              onClick={() => void requestCode()}
            >
              {cooldownLeft > 0
                ? copy.resendIn(cooldownLeft)
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
    // 服务侧超时不是「码错了」——必须单独一条文案，
    // 别让顾客以为自己输错了而去重输同一个码。
    case "VERIFICATION_TIMEOUT":
      return copy.authVerifyTimeout;
    default:
      return copy.authNetworkError;
  }
}
