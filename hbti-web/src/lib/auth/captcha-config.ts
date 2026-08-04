import { createResH5MemberAuthClientFromEnv } from "@/lib/auth/res-auth-client";

/**
 * RES 对本租户开的图形验证码配置，裁剪成可以安全下发给浏览器的形状。
 *
 * 2026-08-04：RES 在租户级打开了腾讯云验证码，`sendVerifyCode` 从此**服务端强制**
 * 要求 `captcha` 参数（不带就是 `UNI-00-0103 missing required param: captcha`）。
 * 在那之前这里是关的，所以登录一直不需要它——也就是说这个开关随时可能再被拨动，
 * 代码必须两种状态都能跑，而不是假定其中一种。
 */
export interface PublicCaptchaConfig {
  /** RES 是否要求验证码。false 时前端不必加载任何 SDK。 */
  enable: boolean;
  /** 我们能驱动的供应商。RES 换成别家时是 `unsupported`，前端据此显示可执行的提示。 */
  provider: "tencent-cloud" | "unsupported" | null;
  /** 腾讯云的公开客户端标识；RES 自己的 H5 也是明文放在前端的。 */
  appId?: string;
}

const CACHE_TTL_MS = 5 * 60_000;
const PROBE_DEADLINE_MS = 8_000;

let cached: { expiresAt: number; value: PublicCaptchaConfig } | undefined;

/**
 * 读取配置，5 分钟缓存。
 *
 * 加缓存不是为了省那点延迟，是为了让「要不要验证码」这个判断能放在限流**之前**：
 * 没有缓存的话，每个请求都要先跟 RES 建访客会话才能知道答案，等于给未鉴权的路径
 * 挂上一个放大器。缓存之后常见路径零 RES 调用。
 */
export async function readCaptchaConfig(
  now: number = Date.now(),
): Promise<PublicCaptchaConfig> {
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const res = createResH5MemberAuthClientFromEnv(
    AbortSignal.timeout(PROBE_DEADLINE_MS),
  );
  const session = await res.createGuestSession(crypto.randomUUID());
  const config = await res.getCaptchaConfig(session);
  const value = toPublicConfig(config);
  cached = { expiresAt: now + CACHE_TTL_MS, value };
  return value;
}

/** 供测试与「配置刚改过、不想等 5 分钟」时使用。 */
export function forgetCaptchaConfig(): void {
  cached = undefined;
}

export function toPublicConfig(config: {
  enable: boolean;
  captchaType?: string | number | null;
  tencentCloud?: { captchaAppId: string | number } | null;
}): PublicCaptchaConfig {
  if (!config.enable) {
    return { enable: false, provider: null };
  }
  const appId = config.tencentCloud?.captchaAppId;
  if (
    String(config.captchaType ?? "") === "tencent_cloud" &&
    appId !== undefined &&
    String(appId).length > 0
  ) {
    return {
      enable: true,
      provider: "tencent-cloud",
      appId: String(appId),
    };
  }
  // 认不出的供应商必须显式报出来。默认「当成不需要验证码」会让发码在 RES 那里
  // 静默失败，症状是顾客点了没反应——那正是这轮要消灭的一类。
  return { enable: true, provider: "unsupported" };
}
