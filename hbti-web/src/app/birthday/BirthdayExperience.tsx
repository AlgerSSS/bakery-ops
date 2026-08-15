"use client";

import {
  type CSSProperties,
  type RefObject,
  useCallback,
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

import styles from "./birthday.module.css";

/**
 * HOT CRUSH 生日贺卡 · 动态版主组件。
 *
 * 状态机两层：
 *   phase —— 身份层：loading → signedOut / linkExpired / loadError / ready；
 *   step  —— 已登录后的体验屏：cover → letter → year → benefit → profile
 *            → reserve → confirm → done（对应静态稿的 s0..s5 + 流程屏）。
 * 静态稿用 radio + 兄弟选择器驱动的多屏结构，这里全部由 React 状态驱动。
 */

/** 与 MemberSignIn 同一组时限：浏览器必须晚于服务端 RES_DEADLINE 再放弃。 */
const VIEW_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 25_000;
const VERIFY_TIMEOUT_MS = 35_000;

type Phase = "loading" | "signedOut" | "linkExpired" | "loadError" | "ready";

type Step =
  | "cover"
  | "letter"
  | "year"
  | "benefit"
  | "profile"
  | "reserve"
  | "confirm"
  | "done";

const STEP_BACK: Record<Step, Step | undefined> = {
  cover: undefined,
  letter: "cover",
  year: "letter",
  benefit: "year",
  profile: "benefit",
  reserve: "profile",
  confirm: "reserve",
  done: undefined,
};

const STEP_HINT: Partial<Record<Step, string>> = {
  letter: "一封短信",
  benefit: "生日这天的礼物",
  profile: "想记住的日子",
  reserve: "就差哪天来拿",
  confirm: "都好了，看一眼对不对",
};

/* ── 与 src/app/api/birthday/* 对齐的契约类型 ── */

interface BirthdayTopItem {
  nameZh: string | null;
  nameEn: string | null;
  categoryZh: string | null;
  qty: number;
  netSales: number;
}

interface BirthdayMonthSlice {
  month: string;
  netSales: number;
  visits: number;
}

interface BirthdayStats {
  year: number;
  totalQty: number;
  totalNetSales: number;
  orderCount: number;
  distinctProducts: number;
  activeMonths: number;
  topItems: BirthdayTopItem[];
  monthly: BirthdayMonthSlice[];
  favorite: BirthdayTopItem | null;
}

interface BirthdayOption {
  giftType: "free_basque" | "points_450";
  label: string;
  cost: number;
  allowGift: boolean;
  yearlyLimit: number | null;
  available: boolean;
  deniedReason?: string;
}

interface BirthdayProfile {
  birthdayMonth: number | null;
  birthdayDay: number | null;
  allergies: string | null;
  preferences: string | null;
  updatedAt: string;
}

interface BirthdayReservation {
  reservationId: number;
  giftType: "free_basque" | "points_450";
  forWhom: "self" | "gift";
  recipientNote: string | null;
  pickupDate: string;
  slot: "noon" | "night";
  memberNote: string | null;
  status: "reserved" | "fulfilled" | "cancelled";
  createdAt: string;
}

interface BirthdayView {
  authenticated: true;
  via: "link" | "session";
  displayName: string | null;
  maskedPhone: string | null;
  member: {
    levelName: string | null;
    pointBalance: number | null;
    registeredOn: string | null;
    level: {
      key: "L1" | "L2" | "L3" | "L4";
      nameZh: string;
      nameEn: string;
      annualSpend: number;
      next: {
        key: "L2" | "L3" | "L4";
        nameZh: string;
        threshold: number;
        gap: number;
      } | null;
    };
  };
  stats: BirthdayStats | null;
  options: BirthdayOption[];
  pickup: { minDate: string; maxDate: string };
  profile: BirthdayProfile | null;
  reservations: BirthdayReservation[];
  campaignYear: number;
}

type Slot = "noon" | "night";

type GiftType = "free_basque" | "points_450";

const SLOT_LABEL: Record<Slot, string> = {
  noon: "下午 12:00–17:00",
  night: "晚上 17:00–21:00",
};

const SLOT_SHORT: Record<Slot, string> = { noon: "下午", night: "晚上" };

const GIFT_TYPE_LABEL: Record<BirthdayReservation["giftType"], string> = {
  free_basque: "免费巴斯克生日蛋糕",
  points_450: "450 积分生日蛋糕",
};

const STATUS_LABEL: Record<BirthdayReservation["status"], string> = {
  reserved: "已留好",
  fulfilled: "已取货",
  cancelled: "已取消",
};

/** 静态稿里 2 月给 29 天，与服务端 MONTH_DAY_MAX 一致。 */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/* ── 小工具 ── */

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload: unknown = await response.json();
    return typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** 请求超时（含 AbortSignal.timeout）——与「网线断了」不是一回事，提示语也不同。 */
function isTimeout(caught: unknown): boolean {
  return (
    caught instanceof DOMException &&
    (caught.name === "TimeoutError" || caught.name === "AbortError")
  );
}

/** "2026-08-20" → "8 月 20 日"。手工切串，避开 Date 的时区回卷。 */
function formatDateZh(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
}

function itemName(item: BirthdayTopItem): string {
  return item.nameZh ?? item.nameEn ?? "一样好吃的";
}

interface CalendarMonth {
  key: string;
  year: number;
  month: number;
  /** null 是月初的对齐空格。 */
  cells: (string | null)[];
}

/** 取货窗口最多跨两个月（lead + window ≈ 32 天），三个月封顶防配置事故。 */
function buildCalendar(minDate: string, maxDate: string): CalendarMonth[] {
  const [minY, minM] = minDate.split("-").map(Number);
  const [maxY, maxM] = maxDate.split("-").map(Number);
  const months: CalendarMonth[] = [];
  let year = minY;
  let month = minM;
  while (
    (year < maxY || (year === maxY && month <= maxM)) &&
    months.length < 3
  ) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    // 表头从周一开始：把 UTC 周日(0)挪到末尾。
    const firstDow = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const cells: (string | null)[] = Array.from({ length: firstDow }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      );
    }
    months.push({ key: `${year}-${month}`, year, month, cells });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/* ══════════════════════════════════════════════════════════════ */

export function BirthdayExperience({ linkToken }: { linkToken?: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [view, setView] = useState<BirthdayView>();
  /** 链接无效 / 会话过期时带给登录屏的一句话。 */
  const [authNotice, setAuthNotice] = useState<string>();
  const [step, setStep] = useState<Step>("cover");
  const headingRef = useRef<HTMLHeadingElement>(null);

  /* 资料表单 */
  const [birthdayMonth, setBirthdayMonth] = useState<number | null>(null);
  const [birthdayDay, setBirthdayDay] = useState<number | null>(null);
  const [allergies, setAllergies] = useState("");
  const [preferences, setPreferences] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string>();
  const [profileSaved, setProfileSaved] = useState(false);

  /* 预约表单 */
  const [giftType, setGiftType] = useState<GiftType>("free_basque");
  const [pickupDate, setPickupDate] = useState<string>();
  const [slot, setSlot] = useState<Slot>("noon");
  const [forWhom, setForWhom] = useState<"self" | "gift">("self");
  const [recipientNote, setRecipientNote] = useState("");
  const [memberNote, setMemberNote] = useState("");
  const [reserveBusy, setReserveBusy] = useState(false);
  const [reserveError, setReserveError] = useState<string>();
  const [confirmed, setConfirmed] = useState<BirthdayReservation>();

  /** 只有「这次 view 是链接带进来的」才把 token 转交给 POST。
      OTP 登录进来的会话若带着一条失效 token，原样转发会被 401 顶回来。 */
  const activeToken = view?.via === "link" ? linkToken : undefined;

  const loadView = useCallback(async (token: string | undefined) => {
    try {
      const url = token
        ? `/api/birthday/view?t=${encodeURIComponent(token)}`
        : "/api/birthday/view";
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(VIEW_TIMEOUT_MS),
      });
      const payload = await readPayload(response);
      if (response.ok && payload.authenticated === true) {
        const data = payload as unknown as BirthdayView;
        setView(data);
        setBirthdayMonth(data.profile?.birthdayMonth ?? null);
        setBirthdayDay(data.profile?.birthdayDay ?? null);
        setAllergies(data.profile?.allergies ?? "");
        setPreferences(data.profile?.preferences ?? "");
        /* 默认选中第一个可选礼物（有积分就优先积分兑换，没有就免费巴斯克）。 */
        const firstAvailable =
          data.options?.find((option) => option.available) ?? data.options?.[0];
        if (firstAvailable) {
          setGiftType(firstAvailable.giftType);
        }
        setPhase("ready");
        return;
      }
      if (response.status === 410 || payload.error === "LINK_EXPIRED") {
        setPhase("linkExpired");
        return;
      }
      if (payload.error === "LINK_INVALID") {
        setAuthNotice(
          "这条链接没有认出来——用手机号验证一下，一样能进来。",
        );
        setPhase("signedOut");
        return;
      }
      if (response.status === 401) {
        setPhase("signedOut");
        return;
      }
      setPhase("loadError");
    } catch {
      setPhase("loadError");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      /* 推出 effect 的同步栈：loadView 里的 setState 不属于「同步 effect
         setState」（react-hooks/set-state-in-effect），也不会在卸载后落地。 */
      await Promise.resolve();
      if (alive) await loadView(linkToken);
    })();
    return () => {
      alive = false;
    };
  }, [loadView, linkToken]);

  /* 换屏时回到顶部、把焦点交给新屏标题（键盘与读屏用户不迷路）。 */
  useEffect(() => {
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [step]);

  /** 流程中途身份掉了（链接过期 / 会话失效）的统一归路。返回 true 表示已接管。 */
  function handleAuthFailure(status: number, error?: string): boolean {
    if (status === 410 || error === "LINK_EXPIRED") {
      setPhase("linkExpired");
      return true;
    }
    if (status === 401) {
      setAuthNotice("登录状态过期了，用手机号重新验证一下。");
      setPhase("signedOut");
      return true;
    }
    return false;
  }

  function goTo(next: Step) {
    setReserveError(undefined);
    setProfileError(undefined);
    setStep(next);
  }

  /* ── 资料保存 ── */
  async function saveProfile(): Promise<void> {
    if ((birthdayMonth === null) !== (birthdayDay === null)) {
      setProfileError("月份和日期要一起选，或者都留空。");
      return;
    }
    setProfileBusy(true);
    setProfileError(undefined);
    setProfileSaved(false);
    try {
      const response = await fetch("/api/birthday/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(activeToken ? { linkToken: activeToken } : {}),
          birthdayMonth,
          birthdayDay,
          allergies: allergies.trim() || null,
          preferences: preferences.trim() || null,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(VIEW_TIMEOUT_MS),
      });
      const payload = await readPayload(response);
      if (response.ok && payload.saved === true) {
        setView((prev) =>
          prev
            ? { ...prev, profile: payload.profile as BirthdayProfile }
            : prev,
        );
        setProfileSaved(true);
        return;
      }
      if (handleAuthFailure(response.status, payload.error as string)) return;
      setProfileError(
        payload.error === "INVALID_DATE"
          ? "这一天不存在——换个日期试试。"
          : "没存上，稍后再试一次。",
      );
    } catch {
      setProfileError("网络不太顺，稍后再试一次。");
    } finally {
      setProfileBusy(false);
    }
  }

  /* ── 预约提交 ── */
  async function submitReservation(): Promise<void> {
    setReserveBusy(true);
    setReserveError(undefined);
    try {
      const response = await fetch("/api/birthday/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(activeToken ? { linkToken: activeToken } : {}),
          giftType,
          forWhom,
          ...(forWhom === "gift" ? { recipientNote: recipientNote.trim() } : {}),
          pickupDate,
          slot,
          ...(memberNote.trim() ? { memberNote: memberNote.trim() } : {}),
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(VIEW_TIMEOUT_MS),
      });
      const payload = await readPayload(response);
      if (response.ok && payload.reserved === true) {
        setConfirmed(payload.reservation as BirthdayReservation);
        setView((prev) =>
          prev
            ? {
                ...prev,
                reservations: payload.reservations as BirthdayReservation[],
              }
            : prev,
        );
        setStep("done");
        return;
      }
      if (handleAuthFailure(response.status, payload.error as string)) return;
      setReserveError(reserveErrorMessage(payload.error as string | undefined));
    } catch (caught) {
      setReserveError(
        isTimeout(caught)
          ? "等回复等太久了——先别急着再点，下去看看「我的预约」里有没有已经留上。"
          : "网络不太顺，稍后再试一次。",
      );
    } finally {
      setReserveBusy(false);
    }
  }

  /* ════════ 渲染 ════════ */

  if (phase === "loading") {
    return (
      <main className={styles.page} lang="zh-CN">
        <div className={styles.loading} role="status">
          <span className={styles.loadingDot} aria-hidden="true" />
          正在打开你的生日卡……
        </div>
      </main>
    );
  }

  if (phase === "loadError") {
    return (
      <main className={styles.page} lang="zh-CN">
        <div className={styles.stage}>
          <section className={`${styles.screen} ${styles.sheet}`}>
            <div className={styles.brand}>
              <span className={styles.logo} role="img" aria-label="Hot Crush" />
              <span className={styles.rule} />
              <span className={styles.sub2}>Pavilion KL</span>
            </div>
            <h2>卡片没打开。</h2>
            <p className={styles.sub}>
              网络刚才打了个嗝。再试一次，你的生日卡还在原地。
            </p>
            <button
              className={styles.btn}
              type="button"
              onClick={() => {
                setPhase("loading");
                void loadView(linkToken);
              }}
            >
              再试一次
            </button>
          </section>
        </div>
      </main>
    );
  }

  if (phase === "linkExpired") {
    return (
      <main className={styles.page} lang="zh-CN">
        <div className={styles.stage}>
          <section className={`${styles.screen} ${styles.sheet}`}>
            <div className={styles.brand}>
              <span className={styles.logo} role="img" aria-label="Hot Crush" />
              <span className={styles.rule} />
              <span className={styles.sub2}>Pavilion KL</span>
            </div>
            <h2>这条链接过期了。</h2>
            <p className={styles.sub}>
              生日卡还在，只是这扇门关了。用手机号验证一下，从另一扇门进来。
            </p>
            <button
              className={styles.btn}
              type="button"
              onClick={() => {
                setAuthNotice(undefined);
                setPhase("signedOut");
              }}
            >
              短信验证进入
            </button>
          </section>
        </div>
      </main>
    );
  }

  if (phase === "signedOut" || !view) {
    return (
      <main className={styles.page} lang="zh-CN">
        <div className={styles.stage}>
          <SignInPanel
            notice={authNotice}
            onAuthenticated={() => {
              /* 故意不带 token：能让顾客走到登录屏的 token（缺失/无效/过期）
                 都不该再参与会话身份，否则 resolveBirthdayAuth 会优先撞在它上面。 */
              setPhase("loading");
              void loadView(undefined);
            }}
          />
        </div>
      </main>
    );
  }

  /* ── 已登录 ── */

  const activeFreeBasque = view.reservations.find(
    (r) =>
      r.giftType === "free_basque" &&
      (r.status === "reserved" || r.status === "fulfilled"),
  );
  const selectedOption =
    view.options.find((option) => option.giftType === giftType) ??
    view.options.find((option) => option.available) ??
    view.options[0];
  const freeBasqueClaimed =
    selectedOption?.giftType === "free_basque" &&
    !selectedOption.available &&
    selectedOption.deniedReason === "FREE_BASQUE_ALREADY_CLAIMED";

  const stepProps = { headingRef };

  return (
    <main className={styles.page} lang="zh-CN">
      {step === "year" ? (
        <YearScreen
          stats={view.stats}
          campaignYear={view.campaignYear}
          onBack={() => goTo("letter")}
          onContinue={() => goTo("benefit")}
        />
      ) : (
        <div className={styles.stage}>
          {step === "cover" && (
            <CoverScreen
              {...stepProps}
              view={view}
              onOpenLetter={() => goTo("letter")}
              onOpenYear={() => goTo("year")}
            />
          )}
          {step === "letter" && (
            <LetterScreen
              {...stepProps}
              onBack={() => goTo(STEP_BACK.letter ?? "cover")}
              onContinue={() => goTo("year")}
            />
          )}
          {step === "benefit" && (
            <BenefitScreen
              {...stepProps}
              view={view}
              giftType={giftType}
              onSelectGiftType={(next) => {
                setGiftType(next);
                setReserveError(undefined);
              }}
              onBack={() => goTo("year")}
              onContinue={() => goTo("profile")}
            />
          )}
          {step === "profile" && (
            <ProfileScreen
              {...stepProps}
              birthdayMonth={birthdayMonth}
              birthdayDay={birthdayDay}
              allergies={allergies}
              preferences={preferences}
              busy={profileBusy}
              error={profileError}
              saved={profileSaved}
              onChangeMonth={(month) => {
                setBirthdayMonth(month);
                setProfileSaved(false);
                setProfileError(undefined);
                if (month === null) {
                  setBirthdayDay(null);
                } else if (
                  birthdayDay !== null &&
                  birthdayDay > (DAYS_IN_MONTH[month - 1] ?? 31)
                ) {
                  setBirthdayDay(DAYS_IN_MONTH[month - 1] ?? 31);
                }
              }}
              onChangeDay={(day) => {
                setBirthdayDay(day);
                setProfileSaved(false);
                setProfileError(undefined);
              }}
              onChangeAllergies={(value) => {
                setAllergies(value);
                setProfileSaved(false);
              }}
              onChangePreferences={(value) => {
                setPreferences(value);
                setProfileSaved(false);
              }}
              onSave={() => void saveProfile()}
              onBack={() => goTo("benefit")}
              onContinue={() => goTo("reserve")}
            />
          )}
          {step === "reserve" && (
            <ReserveScreen
              {...stepProps}
              view={view}
              giftType={giftType}
              birthdayMonth={birthdayMonth}
              birthdayDay={birthdayDay}
              claimed={freeBasqueClaimed ? activeFreeBasque : undefined}
              pickupDate={pickupDate}
              slot={slot}
              forWhom={forWhom}
              recipientNote={recipientNote}
              memberNote={memberNote}
              error={reserveError}
              onSelectDate={(date) => {
                setPickupDate(date);
                setReserveError(undefined);
              }}
              onSelectSlot={setSlot}
              onSelectForWhom={(whom) => {
                setForWhom(whom);
                setReserveError(undefined);
              }}
              onChangeRecipient={setRecipientNote}
              onChangeNote={setMemberNote}
              onBack={() => goTo("profile")}
              onContinue={() => {
                if (!pickupDate) {
                  setReserveError("先挑一天。");
                  return;
                }
                if (forWhom === "gift" && !recipientNote.trim()) {
                  setReserveError("告诉我们这份要送给谁。");
                  return;
                }
                goTo("confirm");
              }}
              onSeeReservations={() => goTo("done")}
            />
          )}
          {step === "confirm" && pickupDate && (
            <ConfirmScreen
              {...stepProps}
              giftType={giftType}
              pickupDate={pickupDate}
              slot={slot}
              forWhom={forWhom}
              recipientNote={recipientNote.trim()}
              memberNote={memberNote.trim()}
              allergies={allergies.trim()}
              busy={reserveBusy}
              error={reserveError}
              onBack={() => goTo("reserve")}
              onSubmit={() => void submitReservation()}
            />
          )}
          {step === "done" && (
            <DoneScreen
              {...stepProps}
              view={view}
              confirmed={confirmed}
              onBackToCard={() => goTo("cover")}
            />
          )}
        </div>
      )}
    </main>
  );
}

/* ══════════════════════════════════════════════════════════════
   短信验证（未登录兜底）
   交互模式与 MemberSignIn 一致，但 verify 走 /api/birthday/otp/verify：
   不为非会员静默开户，404 NOT_A_MEMBER 时给温柔引导。
   ══════════════════════════════════════════════════════════════ */

function SignInPanel({
  notice,
  onAuthenticated,
}: {
  notice?: string;
  onAuthenticated: () => void;
}) {
  const countries = supportedCountries;
  const [country, setCountry] = useState<SupportedCountry>(countries[0]);
  const [phone, setPhone] = useState("");
  const [challengeToken, setChallengeToken] = useState<string>();
  const [previousChallengeToken, setPreviousChallengeToken] =
    useState<string>();
  const [maskedPhone, setMaskedPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"sending" | "verifying">();
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<"conflict" | undefined>();
  const [notMember, setNotMember] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [cooldownPhone, setCooldownPhone] = useState<string>();
  const [sendCaveat, setSendCaveat] = useState<"mayNotArrive" | "maybeSent">();
  const [captchaConfig, setCaptchaConfig] = useState<PublicCaptchaConfig>();
  const codeRef = useRef<HTMLInputElement>(null);

  /* 挂载时就问清要不要图形验证码并预热 SDK——点「发送」才拉脚本的那几百毫秒
     空白里，顾客通常已经又点了一次。 */
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
        /* 探测失败静默留空：真正的判定在服务端，发码时会如实拒绝。 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  async function requestCode() {
    const nationalPhone = normalizeNationalNumber(phone, country);
    if (!country.pattern.test(nationalPhone)) {
      setError("这个手机号看起来不太对，再检查一下。");
      return;
    }

    /* 图形验证码要在进入 busy 之前解完：弹层是模态的，顾客可能想半分钟。 */
    let captcha: CaptchaSolution | undefined;
    if (captchaConfig?.enable) {
      if (captchaConfig.provider !== "tencent-cloud" || !captchaConfig.appId) {
        setError("验证服务暂时不可用，稍后再试。");
        return;
      }
      const outcome = await solveCaptcha(captchaConfig.appId, "zh-cn");
      if (outcome.status === "dismissed") {
        setError("需要先完成图形验证，才能发出短信。");
        return;
      }
      if (outcome.status === "unavailable") {
        setError("图形验证没拉起来，检查一下网络再试。");
        return;
      }
      captcha = outcome.solution;
    }

    setBusy("sending");
    setError(undefined);
    setConfirmation(undefined);
    setNotMember(false);
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
      const payload = await readPayload(response);
      if (!response.ok || typeof payload.challengeToken !== "string") {
        setError(otpErrorMessage(payload.error as string | undefined));
        return;
      }
      /* 留住上一份令牌：RES 对同号当天的重发回 000 却不真送达，顾客手里
         那条真收到的码绑的可能正是上一份挑战。两份都留，验证时依次试。 */
      setPreviousChallengeToken(challengeToken);
      setChallengeToken(payload.challengeToken);
      setMaskedPhone(
        typeof payload.maskedPhone === "string" ? payload.maskedPhone : "",
      );
      setResendSeconds(60);
      setCooldownPhone(cooldownKey);
      if (payload.resendMayNotArrive === true) {
        setSendCaveat("mayNotArrive");
      }
      window.setTimeout(() => codeRef.current?.focus(), 120);
    } catch (caught) {
      if (isTimeout(caught)) {
        /* 请求已发出只是没等到回复：短信很可能在路上，催顾客重发是最坏的建议。 */
        setResendSeconds(60);
        setCooldownPhone(cooldownKey);
        setSendCaveat("maybeSent");
        setError("等回复等太久了。短信可能已经在路上，先看看手机。");
      } else {
        setError("网络不太顺，稍后再试一次。");
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function postVerification(token: string, confirmConflict: boolean) {
    const response = await fetch("/api/birthday/otp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeToken: token,
        code,
        ...(confirmConflict ? { confirmConflict: true } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    return { response, payload: await readPayload(response) };
  }

  async function verifyCode(confirmConflict = false) {
    if (!challengeToken) return;
    if (!/^\d{6}$/.test(code)) {
      setError("验证码是 6 位数字。");
      return;
    }

    setBusy("verifying");
    setError(undefined);

    try {
      let { response, payload } = await postVerification(
        challengeToken,
        confirmConflict,
      );

      /* 新令牌说码不对时，拿上一次发码的令牌再试一次——那多半才是顾客真收到
         的那条码所属的挑战。只在「码不对」这一种错误上回退。 */
      if (
        !response.ok &&
        WRONG_CODE_ERRORS.has(String(payload.error)) &&
        previousChallengeToken
      ) {
        const fallback = await postVerification(
          previousChallengeToken,
          confirmConflict,
        );
        if (fallback.response.ok || fallback.payload.error !== payload.error) {
          ({ response, payload } = fallback);
          setChallengeToken(previousChallengeToken);
          setPreviousChallengeToken(undefined);
        }
      }

      if (response.ok && payload.authenticated === true) {
        onAuthenticated();
        return;
      }

      if (payload.error === "ACCOUNT_CONFLICT_CONFIRMATION_REQUIRED") {
        setConfirmation("conflict");
        return;
      }
      if (payload.error === "NOT_A_MEMBER") {
        setNotMember(true);
        return;
      }
      setError(otpErrorMessage(payload.error as string | undefined));
    } catch (caught) {
      setError(
        isTimeout(caught)
          ? "验证等太久了，稍后再试一次。"
          : "网络不太顺，稍后再试一次。",
      );
    } finally {
      setBusy(undefined);
    }
  }

  function changePhone() {
    setChallengeToken(undefined);
    setPreviousChallengeToken(undefined);
    setMaskedPhone("");
    setCode("");
    setError(undefined);
    setConfirmation(undefined);
    setNotMember(false);
    /* 倒计时不归零：号码没变冷却就该继续，否则「换个号码」再点发送就绕过了限流。 */
  }

  const isSending = busy === "sending";
  const isVerifying = busy === "verifying";
  const cooldownKey = `${country.countryCode}:${normalizeNationalNumber(phone, country)}`;
  const cooldownApplies = cooldownPhone === cooldownKey;
  const cooldownLeft = cooldownApplies ? resendSeconds : 0;
  const activeCaveat = cooldownApplies ? sendCaveat : undefined;

  return (
    <section className={`${styles.screen} ${styles.sheet}`}>
      <div className={styles.brand}>
        <span className={styles.logo} role="img" aria-label="Hot Crush" />
        <span className={styles.rule} />
        <span className={styles.sub2}>Pavilion KL</span>
      </div>
      <h2>你的生日卡在这里。</h2>
      <p className={styles.sub}>
        这是 Hot Crush 会员的专属生日卡——一年的回顾、生日这天的礼物，都在里面。
        打开你的专属链接，或用会员手机号短信验证进入。
      </p>
      {notice && (
        <p className={styles.inlineNote} role="status">
          {notice}
        </p>
      )}

      {notMember ? (
        <div className={styles.fld} role="status" aria-live="polite">
          <p className={styles.lab}>这个号码还不是会员。</p>
          <p className={styles.hintline}>
            还不是会员？到店任意消费即可加入 Hot Crush
            会员，生日月有专属礼遇。明年的今天，这张卡就为你留着了。
          </p>
          <button
            className={styles.btn}
            type="button"
            onClick={changePhone}
          >
            换个号码试试
          </button>
        </div>
      ) : confirmation === "conflict" ? (
        <div className={styles.fld} role="status" aria-live="polite">
          <p className={styles.lab}>这个号码登记在不止一个账户下。</p>
          <p className={styles.hintline}>
            如果是你本人（比如换过名字拼写、或家人帮你登记过），确认后继续；
            不确定的话，换个自己常用的号码更稳妥。
          </p>
          <button
            className={styles.btn}
            type="button"
            disabled={isVerifying}
            onClick={() => void verifyCode(true)}
          >
            {isVerifying ? "正在确认……" : "是我本人，继续"}
          </button>
          <button
            className={styles.textButton}
            type="button"
            onClick={changePhone}
          >
            换个号码
          </button>
        </div>
      ) : !challengeToken ? (
        <form
          className={styles.fld}
          onSubmit={(event) => {
            event.preventDefault();
            void requestCode();
          }}
        >
          <label className={styles.lab} htmlFor="birthday-phone">
            会员手机号
          </label>
          <div className={styles.phoneRow}>
            <label className={styles.countrySelect}>
              <span className={styles.srOnly}>国家或地区</span>
              <select
                className={styles.select}
                aria-label="国家或地区"
                value={country.isoCode}
                onChange={(event) => {
                  const next =
                    countries.find(
                      ({ isoCode }) => isoCode === event.target.value,
                    ) ?? countries[0];
                  setCountry(next);
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
              id="birthday-phone"
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
              aria-describedby={error ? "birthday-phone-error" : undefined}
            />
          </div>
          {error && (
            <p
              id="birthday-phone-error"
              className={styles.inlineError}
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            className={styles.btn}
            type="submit"
            disabled={isSending || cooldownLeft > 0}
          >
            {cooldownLeft > 0
              ? `${cooldownLeft} 秒后可重发`
              : isSending
                ? "正在发送……"
                : "发送短信验证码"}
          </button>
        </form>
      ) : (
        <form
          className={styles.fld}
          onSubmit={(event) => {
            event.preventDefault();
            void verifyCode();
          }}
        >
          <div className={styles.codeSentRow}>
            <div>
              <span>验证码已发到 </span>
              <strong>{maskedPhone}</strong>
            </div>
            <button type="button" onClick={changePhone}>
              换个号码
            </button>
          </div>
          {activeCaveat === "mayNotArrive" && (
            <p className={styles.inlineNote} role="status">
              这个号码今天已经发过验证码，新的短信可能收不到——先翻翻之前那条。
            </p>
          )}
          {activeCaveat === "maybeSent" && (
            <p className={styles.inlineNote} role="status">
              刚才的请求可能已经成功，短信或许在路上，先别急着重发。
            </p>
          )}
          <label className={styles.lab} htmlFor="birthday-code">
            短信验证码
          </label>
          <input
            ref={codeRef}
            id="birthday-code"
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
            aria-describedby={error ? "birthday-code-error" : undefined}
          />
          {error && (
            <p
              id="birthday-code-error"
              className={styles.inlineError}
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            className={styles.btn}
            type="submit"
            disabled={isVerifying || code.length !== 6}
          >
            {isVerifying ? "正在验证……" : "打开我的生日卡"}
          </button>
          <button
            className={styles.textButton}
            type="button"
            disabled={cooldownLeft > 0 || isSending}
            onClick={() => void requestCode()}
          >
            {cooldownLeft > 0 ? `${cooldownLeft} 秒后可重发` : "重新发送"}
          </button>
        </form>
      )}
    </section>
  );
}

/** 只有这几种错误意味着「码本身不对」，才值得拿上一份挑战再试一次。 */
const WRONG_CODE_ERRORS = new Set([
  "INVALID_CODE",
  "OTP_INVALID",
  "INVALID_VERIFICATION_CODE",
]);

function otpErrorMessage(error: string | undefined): string {
  switch (error) {
    case "INVALID_PHONE":
      return "这个手机号看起来不太对，再检查一下。";
    case "INVALID_CODE":
    case "OTP_INVALID":
    case "INVALID_VERIFICATION_CODE":
      return "验证码不对，再试一次。";
    case "OTP_EXPIRED":
    case "CHALLENGE_EXPIRED":
    case "CHALLENGE_EXPIRED_OR_USED":
      return "这条验证码过期了，重新发一条。";
    case "TOO_MANY_ATTEMPTS":
      return "试太多次了，过一会儿再来。";
    case "RATE_LIMITED":
      return "今天发太多次了，稍后再试。";
    case "CAPTCHA_REQUIRED":
    case "CAPTCHA_REQUIRED_UNSUPPORTED":
    case "CAPTCHA_UNSUPPORTED":
      return "验证服务暂时不可用，稍后再试。";
    case "SERVICE_UNAVAILABLE":
      return "短信服务暂时不可用，稍后再试。";
    case "VERIFICATION_TIMEOUT":
      return "验证超时了，稍后再试一次。";
    default:
      return "网络不太顺，稍后再试一次。";
  }
}

function reserveErrorMessage(error: string | undefined): string {
  switch (error) {
    case "PICKUP_DATE_OUT_OF_RANGE":
      return "这一天来不及准备，换一天试试。";
    case "RECIPIENT_REQUIRED":
      return "告诉我们这份要送给谁。";
    case "INSUFFICIENT_POINTS":
      return "积分还差一点点——生日前再来几次，就够换啦。";
    case "FREE_BASQUE_ALREADY_CLAIMED":
      return "今年的免费巴斯克已经留过了。";
    case "GIFT_NOT_ALLOWED":
      return "这份权益只能留给自己。";
    case "TOO_MANY_ACTIVE_RESERVATIONS":
      return "已经有进行中的预约了——先到店取完，再约下一份。";
    case "BENEFIT_NOT_AVAILABLE":
      return "这份礼物这会儿还不能选——返回上一步换个选项。";
    case "INVALID_REQUEST":
      return "有些地方没填对，回去看一眼。";
    default:
      return "没留上，稍后再试一次。";
  }
}

/* ══════════════════════════════════════════════════════════════
   已登录体验屏
   ══════════════════════════════════════════════════════════════ */

interface ScreenProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
}

function ScreenTop({
  hint,
  onBack,
}: {
  hint: string;
  onBack: () => void;
}) {
  return (
    <div className={styles.top}>
      <button
        className={styles.back}
        type="button"
        aria-label="返回上一屏"
        onClick={onBack}
      >
        ←
      </button>
      <p className={styles.step}>{hint}</p>
    </div>
  );
}

/* ── 封面屏 ── */
function CoverScreen({
  headingRef,
  view,
  onOpenLetter,
  onOpenYear,
}: ScreenProps & {
  view: BirthdayView;
  onOpenLetter: () => void;
  onOpenYear: () => void;
}) {
  const phoneTail = view.maskedPhone
    ? view.maskedPhone.replace(/\D/g, "").slice(-4)
    : "";
  const greeting =
    view.displayName ??
    (phoneTail ? `尾号 ${phoneTail} 的朋友` : "亲爱的你");
  const registeredYear = view.member.registeredOn
    ? Number(view.member.registeredOn.slice(0, 4))
    : null;
  const nthBirthday =
    registeredYear !== null && view.campaignYear >= registeredYear
      ? view.campaignYear - registeredYear + 1
      : null;

  return (
    <section className={`${styles.screen} ${styles.card}`}>
      <div className={styles.brand}>
        <span className={styles.logo} role="img" aria-label="Hot Crush" />
        <span className={styles.rule} />
        <span className={styles.sub2}>Pavilion KL</span>
      </div>
      <div className={styles.heroTxt}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.nm}>
          {greeting}，
        </h1>
        <p className={styles.ld}>今天是你的日子。</p>
      </div>
      <CakeSvg />
      <p className={styles.body}>
        又一年。谢谢你总路过我们——
        <br />
        今天，<em>甜的那一口</em>该你了。
      </p>
      <div className={styles.hr} />
      <div className={styles.gift}>
        <p className={styles.tier}>
          {view.member.level.nameZh} · 生日礼遇
        </p>
        <p className={styles.what}>
          {view.options.some((option) => option.giftType === "free_basque")
            ? "生日当月，一份巴斯克，我们请。"
            : "生日当月，450 积分换一份生日蛋糕。"}
        </p>
        <button className={styles.btn} type="button" onClick={onOpenLetter}>
          打开你的生日信
        </button>
        <p className={styles.note}>提前几天告诉我们，好给你留着。</p>
        <button className={styles.backLink} type="button" onClick={onOpenYear}>
          顺便看看你这一年 →
        </button>
      </div>
      <p className={styles.foot}>
        {nthBirthday !== null
          ? `${view.campaignYear} 年 · 第 ${nthBirthday} 个和我们一起过的生日。`
          : `${view.campaignYear} 年 · Hot Crush`}
      </p>
    </section>
  );
}

/* ── 生日信屏 ── */
function LetterScreen({
  headingRef,
  onBack,
  onContinue,
}: ScreenProps & { onBack: () => void; onContinue: () => void }) {
  return (
    <section className={`${styles.screen} ${styles.sheet}`}>
      <ScreenTop hint={STEP_HINT.letter ?? ""} onBack={onBack} />
      <h2 ref={headingRef} tabIndex={-1}>
        给你的信。
      </h2>
      <p className={styles.body}>
        这一年，你很多次推开门，
        <br />
        带走<em>刚出炉的那一口热</em>。
      </p>
      <p className={styles.body}>
        生日这天，换我们为你留一盏蜡烛。
        <br />
        蛋糕在烤，位置在留，你只管挑个日子来。
      </p>
      <p className={styles.body}>
        下面几页，是你这一年的样子，
        <br />
        和我们想送你的<em>一份心意</em>。
      </p>
      <button className={styles.btn} type="button" onClick={onContinue}>
        继续
      </button>
    </section>
  );
}

/* ── 年度回顾屏（静态稿的 s5：整屏吸附、一屏一件事、往上滑）── */
function YearScreen({
  stats,
  campaignYear,
  onBack,
  onContinue,
}: {
  stats: BirthdayStats | null;
  campaignYear: number;
  onBack: () => void;
  onContinue: () => void;
}) {
  const maxVisits = stats
    ? Math.max(1, ...stats.monthly.map((m) => m.visits))
    : 1;

  return (
    <div className={styles.yearOverlay}>
      <button
        className={styles.wClose}
        type="button"
        aria-label="返回生日卡"
        onClick={onBack}
      >
        ←
      </button>

      {!stats ? (
        <div className={`${styles.wPanel} ${styles.wCover}`} data-tone="t1">
          <span className={`${styles.blob} ${styles.b1}`} aria-hidden="true" />
          <p className={styles.kicker}>Hot Crush · {campaignYear}</p>
          <div className={styles.mid}>
            <h2 className={styles.wTitle}>
              这是我们
              <br />
              故事的开始。
            </h2>
            <p className={styles.say}>
              这一年我们还没记下你的订单。
              <br />
              <b>第一份心动</b>，随时等你来。
            </p>
            <div className={styles.artrow}>
              <ArtTartCandle />
              <ArtPuff />
              <ArtShell />
            </div>
          </div>
          <button className={styles.btn} type="button" onClick={onContinue}>
            继续
          </button>
        </div>
      ) : (
        <>
          <div
            className={`${styles.wPanel} ${styles.wCover}`}
            data-tone="t1"
          >
            <span className={`${styles.blob} ${styles.b1}`} aria-hidden="true" />
            <p className={styles.kicker}>Hot Crush · {stats.year}</p>
            <div className={styles.mid}>
              <h2 className={styles.wTitle}>
                你的烘焙
                <br />
                这一年。
              </h2>
              <p className={styles.say}>
                {stats.year} 年，你下了 <b>{stats.orderCount}</b> 单，
                带走 <b>{stats.totalQty}</b> 件。
                <br />
                这是我们记下的。
              </p>
              <div className={styles.artrow}>
                <ArtTartCandle />
                <ArtPuff />
                <ArtShell />
              </div>
            </div>
            <span className={styles.wHint}>往上滑</span>
          </div>

          <div className={styles.wPanel} data-tone="t2">
            <span className={`${styles.blob} ${styles.b2}`} aria-hidden="true" />
            <p className={styles.kicker}>Never the same twice</p>
            <div className={styles.mid}>
              <p className={styles.huge}>
                {stats.distinctProducts}
                <small>种不重样</small>
              </p>
              <div className={styles.tags}>
                {stats.topItems.map((item, index) => (
                  <span
                    key={`${itemName(item)}-${index}`}
                    className={`${styles.tag} ${
                      index < 2
                        ? styles.tagT3
                        : item.qty >= 2
                          ? styles.tagT2
                          : styles.tagT1
                    }`}
                  >
                    {itemName(item)}
                    {item.qty > 1 && <i>{item.qty}</i>}
                  </span>
                ))}
              </div>
            </div>
            <p className={styles.say}>
              {stats.totalQty} 件里挑了 {stats.distinctProducts} 种。
            </p>
          </div>

          <div className={styles.wPanel} data-tone="t3">
            <span className={`${styles.blob} ${styles.b3}`} aria-hidden="true" />
            <p className={styles.kicker}>Your one</p>
            <div className={styles.mid}>
              {stats.favorite && (
                <div className={`${styles.favwrap} ${styles.favCard}`}>
                  <ArtBasque />
                  <p className={styles.favname}>{itemName(stats.favorite)}</p>
                </div>
              )}
              {stats.favorite && (
                <p className={styles.say}>
                  买了 <b>{stats.favorite.qty}</b> 次，
                  是你点得最多的一样。
                </p>
              )}
            </div>
            {stats.topItems.length > 1 && (
              <ul className={styles.morelist}>
                {stats.topItems.slice(1, 4).map((item, index) => (
                  <li key={`${itemName(item)}-${index}`}>
                    <span>{itemName(item)}</span>
                    <b>{item.qty}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.wPanel} data-tone="t4">
            <span className={`${styles.blob} ${styles.b4}`} aria-hidden="true" />
            <p className={styles.kicker}>Every month with you</p>
            <div className={styles.mid}>
              <div className={styles.bars}>
                {stats.monthly.map((slice) => (
                  <div className={styles.bar} key={slice.month}>
                    <span className={styles.barN}>
                      {Number(slice.month.slice(5, 7))} 月
                    </span>
                    <span
                      className={styles.barT}
                      aria-hidden="true"
                    >
                      <i
                        style={
                          {
                            "--w": `${Math.max(
                              4,
                              Math.round((slice.visits / maxVisits) * 100),
                            )}%`,
                          } as CSSProperties
                        }
                      />
                    </span>
                    <span className={styles.barQ}>{slice.visits}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className={styles.say}>
              <b>{stats.activeMonths}</b> 个月里都有你的影子。
            </p>
          </div>

          <div className={`${styles.wPanel} ${styles.wEnd}`} data-tone="t5">
            <span className={`${styles.blob} ${styles.b5}`} aria-hidden="true" />
            <div className={`${styles.artrow} ${styles.artrowSmall}`}>
              <ArtBowl />
              <ArtBasque />
              <ArtPuff />
            </div>
            <div className={styles.mid}>
              <span className={styles.stamp} role="img" aria-label="Hot Crush" />
              <p className={styles.say}>明年今天，我们再数一次。</p>
              <button className={styles.btn} type="button" onClick={onContinue}>
                继续
              </button>
            </div>
            <p className={styles.fine}>
              数据来自你用会员身份买的东西。
              <br />
              现金和电子钱包付的那几次，我们没记在这里。
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/* ── 权益屏 ── */
function BenefitScreen({
  headingRef,
  view,
  giftType,
  onSelectGiftType,
  onBack,
  onContinue,
}: ScreenProps & {
  view: BirthdayView;
  giftType: GiftType;
  onSelectGiftType: (giftType: GiftType) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { options, member } = view;
  const points = member.pointBalance;
  const selected =
    options.find((option) => option.giftType === giftType) ?? options[0];
  const pointsShort = points !== null && points < 450 ? 450 - points : null;

  return (
    <section className={`${styles.screen} ${styles.sheet}`}>
      <ScreenTop hint={STEP_HINT.benefit ?? ""} onBack={onBack} />
      <h2 ref={headingRef} tabIndex={-1}>
        生日这天的礼物。
      </h2>
      <div className={styles.gift}>
        <p className={styles.tier}>
          {member.level.nameZh} · {view.campaignYear}
        </p>
        <div
          className={`${styles.picks} ${styles.picksRow}`}
          role="radiogroup"
          aria-label="选择生日礼"
        >
          {options.map((option) => {
            const chosen = selected?.giftType === option.giftType;
            const freeClaimed =
              option.giftType === "free_basque" &&
              option.deniedReason === "FREE_BASQUE_ALREADY_CLAIMED";
            const notEnough = option.deniedReason === "INSUFFICIENT_POINTS";
            return (
              <button
                className={styles.pick}
                key={option.giftType}
                type="button"
                role="radio"
                aria-checked={chosen}
                data-selected={chosen}
                disabled={!option.available}
                onClick={() => onSelectGiftType(option.giftType)}
              >
                <span className={styles.pickT}>
                  {option.label}
                  {chosen && <span className={styles.tick}>✓</span>}
                </span>
                <span className={styles.pickD}>
                  {freeClaimed
                    ? "今年的这一份已经留过了"
                    : notEnough
                      ? points === null
                        ? "现在还没有积分记录"
                        : `还差 ${pointsShort} 分`
                      : option.cost === 0
                        ? "每会员每年一份"
                        : "到店取货时在 POS 扣 450 积分"}
                </span>
              </button>
            );
          })}
        </div>
        {points !== null && (
          <p className={styles.hintline}>你现在有 {points} 积分。</p>
        )}
        {member.level.next && (
          <p className={styles.hintline}>
            今年已消费 RM{member.level.annualSpend.toFixed(2)}——
            再花 RM{member.level.next.gap.toFixed(0)} 就升 {member.level.next.nameZh}。
          </p>
        )}
        {member.level.key === "L4" && (
          <p className={styles.hintline}>
            今年已消费 RM{member.level.annualSpend.toFixed(2)}，是我们的挚爱会员。
          </p>
        )}
        {selected?.allowGift && (
          <p className={styles.hintline}>
            这份心意也可以送给亲友——订的时候告诉我们送给谁就好。
          </p>
        )}
      </div>
      <button className={styles.btn} type="button" onClick={onContinue}>
        继续
      </button>
    </section>
  );
}

/* ── 资料屏 ── */
function ProfileScreen({
  headingRef,
  birthdayMonth,
  birthdayDay,
  allergies,
  preferences,
  busy,
  error,
  saved,
  onChangeMonth,
  onChangeDay,
  onChangeAllergies,
  onChangePreferences,
  onSave,
  onBack,
  onContinue,
}: ScreenProps & {
  birthdayMonth: number | null;
  birthdayDay: number | null;
  allergies: string;
  preferences: string;
  busy: boolean;
  error?: string;
  saved: boolean;
  onChangeMonth: (month: number | null) => void;
  onChangeDay: (day: number | null) => void;
  onChangeAllergies: (value: string) => void;
  onChangePreferences: (value: string) => void;
  onSave: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const dayCount =
    birthdayMonth !== null ? (DAYS_IN_MONTH[birthdayMonth - 1] ?? 31) : 31;

  return (
    <section className={`${styles.screen} ${styles.sheet}`}>
      <ScreenTop hint={STEP_HINT.profile ?? ""} onBack={onBack} />
      <h2 ref={headingRef} tabIndex={-1}>
        想记住的日子。
      </h2>
      <p className={styles.sub}>
        生日、忌口、口味——记住了，以后每一年都替你想着。都选填，随你。
      </p>

      <div className={styles.fld}>
        <p className={styles.lab}>
          生日是哪天<span className={styles.opt}>选填</span>
        </p>
        <div className={styles.phoneRow}>
          <label className={styles.countrySelect}>
            <span className={styles.srOnly}>月份</span>
            <select
              className={styles.select}
              aria-label="生日月份"
              value={birthdayMonth ?? ""}
              onChange={(event) =>
                onChangeMonth(
                  event.target.value === "" ? null : Number(event.target.value),
                )
              }
            >
              <option value="">月份</option>
              {Array.from({ length: 12 }, (_, index) => index + 1).map(
                (month) => (
                  <option key={month} value={month}>
                    {month} 月
                  </option>
                ),
              )}
            </select>
          </label>
          <label className={styles.countrySelect}>
            <span className={styles.srOnly}>日期</span>
            <select
              className={styles.select}
              aria-label="生日日期"
              disabled={birthdayMonth === null}
              value={birthdayDay ?? ""}
              onChange={(event) =>
                onChangeDay(
                  event.target.value === "" ? null : Number(event.target.value),
                )
              }
            >
              <option value="">日期</option>
              {Array.from({ length: dayCount }, (_, index) => index + 1).map(
                (day) => (
                  <option key={day} value={day}>
                    {day} 日
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
      </div>

      <div className={styles.fld}>
        <label className={styles.lab} htmlFor="birthday-allergies">
          有什么是不能吃的？
        </label>
        <input
          id="birthday-allergies"
          className={styles.textInput}
          type="text"
          maxLength={300}
          placeholder="坚果、乳制品……没有就留空"
          value={allergies}
          onChange={(event) => onChangeAllergies(event.target.value)}
        />
        <p className={styles.hintline}>食品安全要问清楚——这一项我们不靠猜。</p>
      </div>

      <div className={styles.fld}>
        <label className={styles.lab} htmlFor="birthday-preferences">
          口味偏好<span className={styles.opt}>选填</span>
        </label>
        <input
          id="birthday-preferences"
          className={styles.textInput}
          type="text"
          maxLength={300}
          placeholder="不太甜、偏爱巧克力……"
          value={preferences}
          onChange={(event) => onChangePreferences(event.target.value)}
        />
      </div>

      {error && (
        <p className={styles.inlineError} role="alert">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className={styles.savedNote} role="status">
          记住了。
        </p>
      )}

      <button
        className={`${styles.btn} ${styles.btnGhost}`}
        type="button"
        disabled={busy}
        onClick={onSave}
      >
        {busy ? "正在记……" : "记住这些"}
      </button>
      <button className={styles.btn} type="button" onClick={onContinue}>
        继续
      </button>
    </section>
  );
}

/* ── 预约屏 ── */
function ReserveScreen({
  headingRef,
  view,
  giftType,
  birthdayMonth,
  birthdayDay,
  claimed,
  pickupDate,
  slot,
  forWhom,
  recipientNote,
  memberNote,
  error,
  onSelectDate,
  onSelectSlot,
  onSelectForWhom,
  onChangeRecipient,
  onChangeNote,
  onBack,
  onContinue,
  onSeeReservations,
}: ScreenProps & {
  view: BirthdayView;
  giftType: GiftType;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  claimed?: BirthdayReservation;
  pickupDate?: string;
  slot: Slot;
  forWhom: "self" | "gift";
  recipientNote: string;
  memberNote: string;
  error?: string;
  onSelectDate: (date: string) => void;
  onSelectSlot: (slot: Slot) => void;
  onSelectForWhom: (whom: "self" | "gift") => void;
  onChangeRecipient: (value: string) => void;
  onChangeNote: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
  onSeeReservations: () => void;
}) {
  const { minDate, maxDate } = view.pickup;
  const months = buildCalendar(minDate, maxDate);
  const selectedOption =
    view.options.find((option) => option.giftType === giftType) ??
    view.options[0];

  /* 叠起来的日期选择：先给最近 7 天，其余收进「展开」里。 */
  const [showFullCalendar, setShowFullCalendar] = useState(false);
  const inRangeDates: string[] = [];
  for (
    let time = Date.parse(minDate + "T00:00:00Z");
    time <= Date.parse(maxDate + "T00:00:00Z");
    time += 86_400_000
  ) {
    inRangeDates.push(new Date(time).toISOString().slice(0, 10));
  }
  const quickDates = inRangeDates.slice(0, 7);
  const hiddenCount = inRangeDates.length - quickDates.length;

  /* 免费巴斯克一年一份：已留过的会员再来，直接看状态，不给第二张表单。 */
  if (claimed) {
    return (
      <section className={`${styles.screen} ${styles.sheet}`}>
        <ScreenTop hint={STEP_HINT.reserve ?? ""} onBack={onBack} />
        <h2 ref={headingRef} tabIndex={-1}>
          已经给你留好了。
        </h2>
        <div className={styles.resvList}>
          <ReservationItem reservation={claimed} />
        </div>
        <p className={styles.hintline}>
          一份生日礼只留一次——想改时间，到店或来个电话告诉我们。
        </p>
        <button
          className={styles.btn}
          type="button"
          onClick={onSeeReservations}
        >
          看看我的预约
        </button>
      </section>
    );
  }

  return (
    <section className={`${styles.screen} ${styles.sheet} ${styles.sheetTight}`}>
      <ScreenTop hint={STEP_HINT.reserve ?? ""} onBack={onBack} />
      <h2 ref={headingRef} tabIndex={-1}>
        哪天来拿？
      </h2>
      <p className={styles.sub}>
        蛋糕要提前备料——最近七天直接挑，想选更后面的日子再展开。
      </p>

      {selectedOption && (
        <p className={styles.hintline}>
          生日礼：{selectedOption.label}
        </p>
      )}

      <div className={styles.chips} role="group" aria-label="最近七天">
        {quickDates.map((cell) => {
          const isBirthday =
            birthdayMonth !== null &&
            birthdayDay !== null &&
            Number(cell.slice(5, 7)) === birthdayMonth &&
            Number(cell.slice(8, 10)) === birthdayDay;
          const selected = pickupDate === cell;
          return (
            <button
              className={styles.chip}
              key={cell}
              type="button"
              data-selected={selected}
              aria-pressed={selected}
              aria-label={`${formatDateZh(cell)}${isBirthday ? "，生日当天" : ""}`}
              onClick={() => onSelectDate(cell)}
            >
              {formatDateZh(cell)}
            </button>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <button
          className={styles.calToggle}
          type="button"
          aria-expanded={showFullCalendar}
          onClick={() => setShowFullCalendar((value) => !value)}
        >
          {showFullCalendar
            ? "收起日历 ▲"
            : `想选更后面的日子 ▾（还有 ${hiddenCount} 天）`}
        </button>
      )}

      {showFullCalendar &&
        months.map((month) => (
          <div className={styles.calBlock} key={month.key}>
            <p className={styles.calMonth}>
              {month.year} 年 {month.month} 月
            </p>
            <div className={styles.grid} role="group" aria-label={`${month.year} 年 ${month.month} 月`}>
              {WEEKDAYS.map((dow) => (
                <span className={styles.dow} key={dow} aria-hidden="true">
                  {dow}
                </span>
              ))}
              {month.cells.map((cell, index) => {
                if (cell === null) {
                  return (
                    <span
                      className={`${styles.day} ${styles.dayPad}`}
                      key={`pad-${index}`}
                      aria-hidden="true"
                    />
                  );
                }
                const inRange = cell >= minDate && cell <= maxDate;
                if (!inRange) {
                  return (
                    <span
                      className={`${styles.day} ${styles.dayOff}`}
                      key={cell}
                      title={cell < minDate ? "来不及备料" : "超出预约窗口"}
                      aria-disabled="true"
                    >
                      {Number(cell.slice(8, 10))}
                    </span>
                  );
                }
                const isBirthday =
                  birthdayMonth !== null &&
                  birthdayDay !== null &&
                  Number(cell.slice(5, 7)) === birthdayMonth &&
                  Number(cell.slice(8, 10)) === birthdayDay;
                const selected = pickupDate === cell;
                return (
                  <button
                    className={`${styles.day}${isBirthday ? ` ${styles.dayBday}` : ""}`}
                    key={cell}
                    type="button"
                    data-selected={selected}
                    aria-pressed={selected}
                    aria-label={`${formatDateZh(cell)}${isBirthday ? "，生日当天" : ""}`}
                    onClick={() => onSelectDate(cell)}
                  >
                    {Number(cell.slice(8, 10))}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

      <div className={styles.fld}>
        <p className={styles.lab}>几点来</p>
        <div className={styles.chips}>
          {(Object.keys(SLOT_LABEL) as Slot[]).map((value) => (
            <button
              className={styles.chip}
              key={value}
              type="button"
              data-selected={slot === value}
              aria-pressed={slot === value}
              onClick={() => onSelectSlot(value)}
            >
              {SLOT_SHORT[value]} <span className={styles.tt}>{value === "noon" ? "12:00–17:00" : "17:00–21:00"}</span>
            </button>
          ))}
        </div>
      </div>

      {selectedOption?.allowGift && (
        <div className={styles.fld}>
          <p className={styles.lab}>这份留给谁？</p>
          <div className={`${styles.picks} ${styles.picksRow}`}>
            <button
              className={styles.pick}
              type="button"
              data-selected={forWhom === "self"}
              aria-pressed={forWhom === "self"}
              onClick={() => onSelectForWhom("self")}
            >
              <span className={styles.pickT}>
                给自己<span className={styles.tick}>✓</span>
              </span>
              <span className={styles.pickD}>生日这天的那一份</span>
            </button>
            <button
              className={styles.pick}
              type="button"
              data-selected={forWhom === "gift"}
              aria-pressed={forWhom === "gift"}
              onClick={() => onSelectForWhom("gift")}
            >
              <span className={styles.pickT}>
                送给亲友<span className={styles.tick}>✓</span>
              </span>
              <span className={styles.pickD}>心意我们替你包</span>
            </button>
          </div>
        </div>
      )}

      {selectedOption?.allowGift && forWhom === "gift" && (
        <div className={styles.fld}>
          <label className={styles.lab} htmlFor="birthday-recipient">
            送给谁
          </label>
          <input
            id="birthday-recipient"
            className={styles.textInput}
            type="text"
            maxLength={120}
            placeholder="比如：妈妈、阿 May……"
            value={recipientNote}
            onChange={(event) => onChangeRecipient(event.target.value)}
          />
        </div>
      )}

      <div className={styles.fld}>
        <label className={styles.lab} htmlFor="birthday-note">
          想交代店里的话<span className={styles.opt}>选填</span>
        </label>
        <textarea
          id="birthday-note"
          className={styles.textArea}
          maxLength={300}
          placeholder="写卡片、少糖、到店再决定口味……"
          value={memberNote}
          onChange={(event) => onChangeNote(event.target.value)}
        />
      </div>

      {error && (
        <p className={styles.inlineError} role="alert">
          {error}
        </p>
      )}
      <button className={styles.btn} type="button" onClick={onContinue}>
        好了
      </button>
    </section>
  );
}

/* ── 确认屏 ── */
function ConfirmScreen({
  headingRef,
  giftType,
  pickupDate,
  slot,
  forWhom,
  recipientNote,
  memberNote,
  allergies,
  busy,
  error,
  onBack,
  onSubmit,
}: ScreenProps & {
  giftType: GiftType;
  pickupDate: string;
  slot: Slot;
  forWhom: "self" | "gift";
  recipientNote: string;
  memberNote: string;
  allergies: string;
  busy: boolean;
  error?: string;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <section className={`${styles.screen} ${styles.sheet}`}>
      <ScreenTop hint={STEP_HINT.confirm ?? ""} onBack={onBack} />
      <h2 ref={headingRef} tabIndex={-1}>
        确认一下。
      </h2>
      <dl className={styles.sum}>
        <div>
          <dt>生日礼</dt>
          <dd>{GIFT_TYPE_LABEL[giftType]}</dd>
        </div>
        <div>
          <dt>哪天</dt>
          <dd>{formatDateZh(pickupDate)}</dd>
        </div>
        <div>
          <dt>几点</dt>
          <dd>{SLOT_LABEL[slot]}</dd>
        </div>
        <div>
          <dt>送给</dt>
          <dd>{forWhom === "gift" ? recipientNote : "自己"}</dd>
        </div>
        <div>
          <dt>忌口</dt>
          <dd>
            {allergies || (
              <span className={styles.sumEmpty}>还没说</span>
            )}
          </dd>
        </div>
        <div>
          <dt>留言</dt>
          <dd>
            {memberNote || <span className={styles.sumEmpty}>没有</span>}
          </dd>
        </div>
      </dl>
      <p className={styles.fine}>
        订好后店里会收到通知；取货到店报手机号就行，不用出示任何东西。
      </p>
      {error && (
        <p className={styles.inlineError} role="alert">
          {error}
        </p>
      )}
      <button
        className={styles.btn}
        type="button"
        disabled={busy}
        onClick={onSubmit}
      >
        {busy ? "正在留……" : "留好我的生日礼"}
      </button>
    </section>
  );
}

/* ── 完成屏 ── */
function DoneScreen({
  headingRef,
  view,
  confirmed,
  onBackToCard,
}: ScreenProps & {
  view: BirthdayView;
  confirmed?: BirthdayReservation;
  onBackToCard: () => void;
}) {
  /* 刚提交的那条优先；否则找最近一条进行中的。 */
  const headline =
    confirmed ??
    view.reservations.find((r) => r.status === "reserved") ??
    view.reservations[0];

  return (
    <section className={`${styles.screen} ${styles.sheet}`}>
      <div className={styles.done}>
        <span className={styles.stamp} role="img" aria-label="Hot Crush" />
        <h2 ref={headingRef} tabIndex={-1}>
          留好了。
        </h2>
        {headline && (
          <p className={styles.big}>
            {formatDateZh(headline.pickupDate)}
            {SLOT_SHORT[headline.slot]}，{GIFT_TYPE_LABEL[headline.giftType]}
            {headline.forWhom === "gift" && headline.recipientNote
              ? `（送给${headline.recipientNote}）`
              : ""}
            ，等你。
          </p>
        )}
        <p className={styles.sub}>
          到店报手机号就行，不用出示任何东西。
        </p>
      </div>

      {view.reservations.length > 0 && (
        <>
          <div className={styles.hr} />
          <div className={styles.fld}>
            <p className={styles.lab}>你的预约</p>
            <div className={styles.resvList}>
              {view.reservations.map((reservation) => (
                <ReservationItem
                  key={reservation.reservationId}
                  reservation={reservation}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <button
        className={styles.backLink}
        type="button"
        onClick={onBackToCard}
      >
        ← 回到我的卡片
      </button>
    </section>
  );
}

function ReservationItem({
  reservation,
}: {
  reservation: BirthdayReservation;
}) {
  return (
    <div className={styles.resvItem}>
      <p className={styles.resvTitle}>
        {GIFT_TYPE_LABEL[reservation.giftType]}
        <span
          className={styles.statusTag}
          data-tone={reservation.status === "reserved" ? undefined : "muted"}
        >
          {STATUS_LABEL[reservation.status]}
        </span>
      </p>
      <p className={styles.resvMeta}>
        {formatDateZh(reservation.pickupDate)} ·{" "}
        {SLOT_LABEL[reservation.slot]}
        {reservation.forWhom === "gift" && reservation.recipientNote
          ? ` · 送给${reservation.recipientNote}`
          : ""}
      </p>
      {reservation.memberNote && (
        <p className={styles.resvMeta}>留言：{reservation.memberNote}</p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   烘焙插画：全部逐行移植自静态稿的 SVG，一笔未改。
   ══════════════════════════════════════════════════════════════ */

function CakeSvg() {
  return (
    <svg
      className={styles.cake}
      width="146"
      height="110"
      viewBox="0 0 160 120"
      aria-hidden="true"
    >
      {/* 落影 */}
      <ellipse cx="80" cy="108" rx="50" ry="5" fill="#6a1c13" opacity=".12" />
      {/* 蛋糕体（蜜桃）——烘焙纸之上露出的一圈 */}
      <path
        d="M35 66h90v26c0 7-5 12-12 12H47c-7 0-12-5-12-12V66z"
        fill="#f3d0b8"
      />
      {/* 褶皱烘焙纸：巴斯克的标志，九道褶 */}
      <path
        d="M26 84q6-7 12 0t12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0v14q0 8-8 8H34q-8 0-8-8z"
        fill="#f2e6d6"
      />
      <g
        stroke="#6a1c13"
        strokeWidth="1"
        opacity=".14"
        strokeLinecap="round"
      >
        <path d="M38 84v18M50 84v18M62 84v18M74 84v18M86 84v18M98 84v18M110 84v18M122 84v18" />
      </g>
      {/* 烤焦的深色顶 */}
      <ellipse cx="80" cy="66" rx="45" ry="10.5" fill="#6a1c13" />
      <ellipse cx="80" cy="64.6" rx="38" ry="7.6" fill="#7d2a1b" opacity=".55" />
      {/* 蜡烛：烛身取会员的个人色 */}
      <rect x="74.5" y="30" width="11" height="34" rx="5.5" fill="var(--accent)" />
      <rect
        x="77"
        y="34"
        width="2.6"
        height="26"
        rx="1.3"
        fill="#fff7ea"
        opacity=".34"
      />
      <path
        d="M80 25.5v5"
        stroke="#6a1c13"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity=".55"
      />
      {/* 火苗：全卡唯一的品牌红 */}
      <g className={styles.flame}>
        <path
          d="M80 5c4.6 5.6 6.9 9.9 6.9 13.1 0 4.1-3.1 7-6.9 7s-6.9-2.9-6.9-7C73.1 14.9 75.4 10.6 80 5z"
          fill="#c51f2c"
          opacity=".92"
        />
        <path
          className={styles.core}
          d="M80 12.4c2 2.6 3 4.6 3 6.1 0 1.9-1.3 3.3-3 3.3s-3-1.4-3-3.3c0-1.5 1-3.5 3-6.1z"
          fill="#f3d0b8"
          opacity=".9"
        />
      </g>
    </svg>
  );
}

function ArtTartCandle() {
  return (
    <svg
      className={styles.art}
      viewBox="0 0 64 52"
      aria-hidden="true"
      stroke="#6a1c13"
      strokeOpacity=".42"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <ellipse
        cx="32"
        cy="46"
        rx="16"
        ry="3"
        fill="#6a1c13"
        opacity=".10"
        stroke="none"
      />
      <path
        d="M14 30h36v9c0 4-3 7-7 7H21c-4 0-7-3-7-7z"
        fill="#f2e6d6"
      />
      <ellipse cx="32" cy="30" rx="18" ry="5" fill="#6a1c13" />
      <rect x="29" y="12" width="6" height="17" rx="3" fill="var(--accent)" />
      <path
        className={styles.fl2}
        d="M32 1c2.6 3.2 3.9 5.6 3.9 7.4 0 2.3-1.7 4-3.9 4s-3.9-1.7-3.9-4C28.1 6.6 29.4 4.2 32 1z"
        fill="#c51f2c"
        opacity=".92"
      />
    </svg>
  );
}

function ArtPuff() {
  return (
    <svg
      className={styles.art}
      viewBox="0 0 64 52"
      aria-hidden="true"
      stroke="#6a1c13"
      strokeOpacity=".42"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <ellipse
        cx="32"
        cy="46"
        rx="21"
        ry="3"
        fill="#6a1c13"
        opacity=".10"
        stroke="none"
      />
      <path
        d="M8 22c0-9 10-15 24-15s24 6 24 15c0 3.5-2.5 5-6 5H14c-3.5 0-6-1.5-6-5z"
        fill="#f3d0b8"
      />
      <path
        d="M9 26h46c1.7 0 3 1.3 3 3s-1.3 3-3 3H9c-1.7 0-3-1.3-3-3s1.3-3 3-3z"
        fill="#fff7ea"
      />
      <path
        d="M8 32c0 8 10 12 24 12s24-4 24-12c0-2-1.4-3-3-3H11c-1.6 0-3 1-3 3z"
        fill="#eabf9c"
      />
      <circle cx="22" cy="17" r="2" fill="#fff7ea" opacity=".6" stroke="none" />
    </svg>
  );
}

function ArtShell() {
  return (
    <svg
      className={styles.art}
      viewBox="0 0 64 52"
      aria-hidden="true"
      stroke="#6a1c13"
      strokeOpacity=".42"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <ellipse
        cx="32"
        cy="45"
        rx="22"
        ry="3"
        fill="#6a1c13"
        opacity=".10"
        stroke="none"
      />
      <path
        d="M9 40c-3-14 6-26 23-26s26 12 23 26c-1 4-5 4-7 1-3-5-9-8-16-8s-13 3-16 8c-2 3-6 3-7-1z"
        fill="#f3d0b8"
      />
      <path
        d="M9 40c1 4 5 4 7 1M55 40c-1 4-5 4-7 1"
        fill="none"
        stroke="#6a1c13"
        strokeOpacity=".42"
      />
      <g
        stroke="#fff7ea"
        strokeWidth="2"
        opacity=".55"
        strokeLinecap="round"
      >
        <path d="M21 34c-1-5 0-9 3-13M32 32V17M43 34c1-5 0-9-3-13" />
      </g>
    </svg>
  );
}

function ArtBasque() {
  return (
    <svg
      className={styles.art}
      viewBox="0 0 64 52"
      aria-hidden="true"
      stroke="#6a1c13"
      strokeOpacity=".42"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <ellipse
        cx="32"
        cy="46"
        rx="20"
        ry="3"
        fill="#6a1c13"
        opacity=".10"
        stroke="none"
      />
      <path
        d="M11 24h42l-3 15c-.6 3.4-3.6 5.9-7 5.9H21c-3.4 0-6.4-2.5-7-5.9z"
        fill="#f2e6d6"
      />
      <g
        stroke="#6a1c13"
        strokeWidth="1"
        opacity=".13"
        strokeLinecap="round"
      >
        <path d="M18 26l-1.5 16M26 26l-1 17M34 26v17M42 26l1 17M50 26l1.5 16" />
      </g>
      <ellipse cx="32" cy="24" rx="23" ry="7" fill="#6a1c13" />
      <ellipse cx="32" cy="22.6" rx="18" ry="5" fill="#8a3520" stroke="none" />
      <circle cx="26" cy="21" r="3.4" fill="#c51f2c" opacity=".85" />
      <circle cx="38" cy="22" r="2.8" fill="#c51f2c" opacity=".7" />
      <circle
        cx="32"
        cy="19.5"
        r="1.6"
        fill="#f3d0b8"
        opacity=".7"
        stroke="none"
      />
    </svg>
  );
}

function ArtBowl() {
  return (
    <svg
      className={styles.art}
      viewBox="0 0 64 52"
      aria-hidden="true"
      stroke="#6a1c13"
      strokeOpacity=".42"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <ellipse
        cx="32"
        cy="46"
        rx="18"
        ry="3"
        fill="#6a1c13"
        opacity=".10"
        stroke="none"
      />
      <path
        d="M13 32c0-9 8.5-15 19-15s19 6 19 15c0 7-8.5 12-19 12s-19-5-19-12z"
        fill="#f3d0b8"
      />
      <path
        d="M15 27c2-7 9-11 17-11s15 4 17 11c-3-3-9-5-17-5s-14 2-17 5z"
        fill="#fff7ea"
        opacity=".75"
        stroke="none"
      />
      <ellipse
        cx="32"
        cy="30"
        rx="12"
        ry="4"
        fill="#6a1c13"
        opacity=".14"
        stroke="none"
      />
      <circle cx="24" cy="24" r="2" fill="#fff7ea" opacity=".65" stroke="none" />
    </svg>
  );
}
