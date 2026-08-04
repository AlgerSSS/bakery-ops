/**
 * 腾讯云验证码（浏览器侧）。
 *
 * RES 在 2026-08-04 于租户级打开了图形验证码，`sendVerifyCode` 服务端强制要求
 * `captcha` 参数，所以顾客必须在浏览器里真的解一次。这个模块只做一件事：把 SDK
 * 拉起来、弹出来、把顾客解出的结果翻译成 RES 要的形状。
 *
 * **刻意不实现腾讯的 `trerror_*` 降级令牌。** 那是 SDK 自身加载失败时的占位串，
 * 由我们主动构造就等于绕过验证码。SDK 起不来就如实报错，让顾客看到明确的失败，
 * 而不是发一个注定被 RES 拒掉的请求。
 */

const SDK_SRC = "https://ca.turing.captcha.qcloud.com/TJNCaptcha-global.js";
const CONTAINER_ID = "tencent-captcha-container";

export interface CaptchaSolution {
  token: string;
  randstr: string;
}

/** 顾客主动关掉弹层时返回 null —— 那不是错误，不该弹报错。 */
export type CaptchaOutcome =
  | { status: "solved"; solution: CaptchaSolution }
  | { status: "dismissed" }
  | { status: "unavailable" };

interface TencentCaptchaResult {
  ret?: number;
  ticket?: string;
  randstr?: string;
}

interface TencentCaptchaInstance {
  show: () => void;
}

type TencentCaptchaConstructor = new (
  container: HTMLElement,
  appId: string,
  callback: (result: TencentCaptchaResult) => void,
  options: { type: string; userLanguage: string },
) => TencentCaptchaInstance;

declare global {
  interface Window {
    TencentCaptcha?: TencentCaptchaConstructor;
  }
}

let loading: Promise<void> | undefined;

function loadSdk(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("captcha requires a browser"));
  }
  if (typeof window.TencentCaptcha === "function") {
    return Promise.resolve();
  }
  if (loading) {
    return loading;
  }
  loading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SDK_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("sdk")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // 允许下次重试：加载失败多半是网络抖动，把 promise 留着会永久卡住。
      loading = undefined;
      reject(new Error("sdk"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * 提前把 SDK 拉下来。顾客点「发送」时才加载会先卡几百毫秒，那段空白里
 * 他们通常会再点一次。
 */
export function preloadCaptcha(): void {
  void loadSdk().catch(() => {});
}

function container(): HTMLElement {
  const existing = document.getElementById(CONTAINER_ID);
  if (existing) {
    return existing;
  }
  const created = document.createElement("div");
  created.id = CONTAINER_ID;
  document.body.appendChild(created);
  return created;
}

export async function solveCaptcha(
  appId: string,
  userLanguage: string,
): Promise<CaptchaOutcome> {
  try {
    await loadSdk();
  } catch {
    return { status: "unavailable" };
  }
  const Captcha = window.TencentCaptcha;
  if (typeof Captcha !== "function") {
    return { status: "unavailable" };
  }
  return new Promise<CaptchaOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: CaptchaOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    try {
      const instance = new Captcha(
        container(),
        appId,
        (result) => {
          // RES 要的是 {token, randstr}，而 SDK 给的是 {ticket, randstr}。
          // 这个改名写错不会报错，只会一路走到「missing required param: captcha」。
          if (result?.ticket && result?.randstr) {
            finish({
              status: "solved",
              solution: { token: result.ticket, randstr: result.randstr },
            });
            return;
          }
          finish({ status: "dismissed" });
        },
        { type: "popup", userLanguage },
      );
      instance.show();
    } catch {
      finish({ status: "unavailable" });
    }
  });
}
