import { z } from "zod";

const RES_H5_BASE_URL =
  "https://f4klzbmr9n2d.m.sea.restosuite.ai";

const apiEnvelopeSchema = z
  .object({
    code: z.string(),
  })
  .passthrough();

const sessionEnvelopeSchema = apiEnvelopeSchema.extend({
  data: z
    .object({
      authorizeInfo: z.unknown(),
      token: z.string().min(1),
    })
    .passthrough(),
});

const captchaEnvelopeSchema = apiEnvelopeSchema.extend({
  data: z
    .object({
      enable: z.boolean(),
      captchaType: z
        .union([z.string(), z.number()])
        .nullable()
        .optional(),
      // 腾讯云是 RES 当前给本租户配的验证码供应商。appId 是公开的客户端标识
      // （RES 自己的 H5 就把它明文放在前端），可以安全地下发给浏览器。
      tencentCloud: z
        .object({ captchaAppId: z.union([z.string(), z.number()]) })
        .passthrough()
        .nullable()
        .optional(),
    })
    .passthrough(),
});

const loginEnvelopeSchema = apiEnvelopeSchema.extend({
  data: z
    .object({
      verifyToken: z.string().min(1).nullable().optional(),
    })
    .passthrough(),
});

const rotatedLoginEnvelopeSchema = apiEnvelopeSchema.extend({
  data: z
    .object({
      token: z.string().min(1),
    })
    .passthrough(),
});

const userInfoEnvelopeSchema = apiEnvelopeSchema.extend({
  data: z
    .object({
      customerId: z
        .union([z.string(), z.number()])
        .nullable()
        .optional(),
      isMember: z.boolean(),
    })
    .passthrough(),
});

export interface ResH5MemberAuthConfig {
  baseUrl: string;
  corporationId: string;
  appId: string;
  cardProgramId: string;
}

export interface ResH5GuestSession {
  deviceId: string;
  token: string;
}

export type ResH5CaptchaConfig = z.infer<
  typeof captchaEnvelopeSchema
>["data"];

export interface ResH5PhoneIdentity {
  phone: string;
  isoCode: string;
  countryCode: string;
}

/**
 * 顾客解出的验证码凭证，原样透传给 RES。
 *
 * 字段名是个坑：腾讯 SDK 的成功回调给的是 `{ticket, randstr}`，而 RES 要的是
 * `{token, randstr}` —— `ticket` 必须改名成 `token`，写错不会报错，只会一直
 * 「missing required param: captcha」。RES 自己的 H5 也是这么转的。
 */
export interface ResH5CaptchaSolution {
  token: string;
  randstr: string;
}

export interface ResH5SendVerifyCodeInput {
  session: ResH5GuestSession;
  phone: ResH5PhoneIdentity;
  captcha?: ResH5CaptchaSolution;
}

/** RES 对发码请求的回执，已脱敏，可以直接落日志。 */
export interface ResH5SendVerifyCodeReceipt {
  code: string;
  message?: string;
  bodyKeys: string[];
}

export interface ResH5VerifyLoginInput
  extends ResH5SendVerifyCodeInput {
  code: string;
  resolveConflicts?: boolean;
}

export interface ResH5MemberLoginResult {
  memberId: string;
  resToken: string;
  newlyRegistered: boolean;
}

export type ResH5AuthDiagnosticStage =
  | "guest_session_transport"
  | "guest_session_response"
  | "captcha_transport"
  | "captcha_response"
  | "send_code_transport"
  | "send_code_response"
  | "verify_code_transport"
  | "verify_code_response"
  | "login_transport"
  | "login_response"
  | "login_rejected"
  | "userinfo_transport"
  | "userinfo_response"
  | "userinfo_rejected"
  | "register_transport"
  | "register_response"
  | "register_rejected"
  | "member_resolution"
  | "member_id_missing"
  | "registration_readback_failed";

interface ResH5AuthDiagnosticDetails {
  stage: ResH5AuthDiagnosticStage;
  message?: string;
  providerCode?: string;
  /**
   * RES 自己那句话，已按 `readSafeProviderMessage` 抹掉 4 位以上数字串。
   *
   * 只记 code 不记 msg 会让排障停在半路：2026-08-04 线上回 `CRM-00-1105`，
   * 这个码既不在 RES 的客户端语言包里、也没有公开文档，光有码谁也不知道
   * 是频率限制还是号码本身有问题。
   */
  providerMessage?: string;
  httpStatus?: number;
  timedOut?: boolean;
  topLevelKeys?: string[];
  dataKeys?: string[];
  dataValueTypes?: Record<string, SafeValueType>;
}

export class ResH5AuthDiagnosticError extends Error {
  readonly stage: ResH5AuthDiagnosticStage;
  readonly providerCode?: string;
  readonly providerMessage?: string;
  readonly httpStatus?: number;
  readonly timedOut: boolean;
  readonly topLevelKeys: string[];
  readonly dataKeys: string[];
  readonly dataValueTypes: Record<string, SafeValueType>;

  constructor(details: ResH5AuthDiagnosticDetails) {
    super(
      details.message ?? "RES H5 member authentication failed.",
    );
    this.name = "ResH5AuthDiagnosticError";
    this.stage = details.stage;
    this.providerCode = details.providerCode;
    this.providerMessage = details.providerMessage;
    this.httpStatus = details.httpStatus;
    this.timedOut = details.timedOut === true;
    this.topLevelKeys = details.topLevelKeys ?? [];
    this.dataKeys = details.dataKeys ?? [];
    this.dataValueTypes = details.dataValueTypes ?? {};
  }
}

export class ResH5LoginConflictError extends Error {
  readonly code = "CRM-00-2004";

  constructor() {
    super("RES H5 login requires conflict confirmation.");
    this.name = "ResH5LoginConflictError";
  }
}

export class ResH5VerificationCodeError extends Error {
  constructor() {
    super("RES H5 verification code was not accepted.");
    this.name = "ResH5VerificationCodeError";
  }
}

type FetchLike = typeof fetch;

/** 单次 RES 调用的上限。整体上限由调用方通过 deadlineSignal 决定。 */
const PER_CALL_TIMEOUT_MS = 12_000;

export class ResH5MemberAuthClient {
  /**
   * @param deadlineSignal 整个请求共享的截止时限，与每次调用各自的 12 秒超时取先到者。
   *
   * 没有它的时候发码要串行走三次 RES 调用、每次各自 12 秒——最坏 36 秒，而 Vercel
   * 函数 30 秒就被砍、浏览器 15 秒就放弃了。于是出现最坏的一种失败：顾客看到
   * 「网络错误」，短信其实正在路上，然后他们去点重发，而重发是 RES 会静默丢掉的。
   * 共享时限把总耗时钉死在一个比浏览器超时更早的数上，服务端总有机会把真实结果说完。
   */
  /**
   * @param clientIp 顾客的真实外网 IP，随请求转发给 RES。
   *
   * 图形验证码是**绑 IP** 的：腾讯的 `DescribeCaptchaResult` 要求业务方传的
   * `UserIp` 是「验证码用户的外网 IP」。RES 自己的 H5 是浏览器直连，它看到的
   * 就是顾客 IP；而我们是浏览器 → 本服务 → RES，RES 看到的是 Vercel 的出口 IP，
   * 于是腾讯判定解题方与核验方不是同一个人，RES 回
   * `CRM-00-1105 captcha rejected! diff`，短信一条也发不出去（2026-08-04 实测）。
   * 把顾客 IP 显式带上是我们这一侧唯一能补的信息。
   */
  constructor(
    private readonly config: ResH5MemberAuthConfig,
    private readonly fetcher: FetchLike = fetch,
    private readonly deadlineSignal?: AbortSignal,
    private readonly clientIp?: string,
  ) {
    if (config.baseUrl !== RES_H5_BASE_URL) {
      throw new Error(
        "RES H5 base URL must use the verified RES H5 origin.",
      );
    }
    for (const [name, value] of Object.entries(config)) {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Invalid RES H5 configuration: ${name}.`);
      }
      if (/[\r\n]/.test(value)) {
        throw new Error(`Invalid RES H5 configuration: ${name}.`);
      }
    }
  }

  async createGuestSession(
    deviceId: string,
  ): Promise<ResH5GuestSession> {
    const payload = await this.post(
      "/api/user-auth/auth",
      {},
      "",
      deviceId,
      "guest_session_transport",
    );
    const response = parseExternal(
      sessionEnvelopeSchema,
      payload,
      "guest_session_response",
    );
    assertSuccess(response, payload, "guest_session_response");

    return {
      deviceId,
      token: response.data.token,
    };
  }

  async getCaptchaConfig(
    session: ResH5GuestSession,
  ): Promise<ResH5CaptchaConfig> {
    const payload = await this.post(
      "/api/user-auth/captcha/config",
      {},
      session.token,
      session.deviceId,
      "captcha_transport",
    );
    const response = parseExternal(
      captchaEnvelopeSchema,
      payload,
      "captcha_response",
    );
    assertSuccess(response, payload, "captcha_response");
    return response.data;
  }

  /**
   * 返回 RES 的回执，供调用方落日志。
   *
   * 之前这里是 Promise<void>：RES 说了什么全被丢掉，只留下「没抛错」这一个比特。
   * 于是当 RES 回 "000"（接单了）但短信从没送达时，我们在日志里只看得到一个
   * 光秃秃的 200，无从判断是它没发还是发了没到。
   */
  async sendVerifyCode(
    input: ResH5SendVerifyCodeInput,
  ): Promise<ResH5SendVerifyCodeReceipt> {
    const phone = parsePhone(input.phone);
    const payload = await this.post(
      "/api/user-auth/sendVerifyCode",
      {
        contactType: "PHONE",
        phone,
        // 只在真的有解时带上这个键。RES 对「有 captcha 键但内容为空」和「没有这个键」
        // 的处理不一样，前者会走进校验分支报一个更含糊的错。
        ...(input.captcha ? { captcha: parseCaptcha(input.captcha) } : {}),
      },
      input.session.token,
      input.session.deviceId,
      "send_code_transport",
    );
    const response = parseExternal(
      apiEnvelopeSchema,
      payload,
      "send_code_response",
    );
    assertSuccess(response, payload, "send_code_response");
    const body = isRecord(payload.body) ? payload.body : undefined;
    return {
      code: response.code,
      message: readSafeProviderMessage(body?.msg ?? body?.message),
      bodyKeys: readSafeKeys(body),
    };
  }

  async verifyLoginAndEnsureMember(
    input: ResH5VerifyLoginInput,
  ): Promise<ResH5MemberLoginResult> {
    const phone = parsePhone(input.phone);
    const code = parseVerificationCode(input.code);

    const verifiedPayload = await this.post(
      "/api/user-auth/verifyCode",
      {
        contactType: "PHONE",
        phone: {
          phone: phone.phone,
          code,
          isoCode: phone.isoCode,
          countryCode: phone.countryCode,
        },
      },
      input.session.token,
      input.session.deviceId,
      "verify_code_transport",
    );
    const verified = parseExternal(
      apiEnvelopeSchema,
      verifiedPayload,
      "verify_code_response",
    );
    if (verified.code !== "000") {
      throw new ResH5VerificationCodeError();
    }

    return this.loginAndEnsureMember({
      ...input,
      phone,
      code,
    });
  }

  async loginAndEnsureMember(
    input: ResH5VerifyLoginInput,
  ): Promise<ResH5MemberLoginResult> {
    const phone = parsePhone(input.phone);
    const code = parseVerificationCode(input.code);
    const rawLogin = await this.post(
      "/api/user-auth/login",
      {
        contactType: "PHONE",
        phone: {
          phone: phone.phone,
          code,
          isoCode: phone.isoCode,
          countryCode: phone.countryCode,
        },
        resolveConflicts: Boolean(input.resolveConflicts),
      },
      input.session.token,
      input.session.deviceId,
      "login_transport",
    );
    const loginEnvelope = parseExternal(
      apiEnvelopeSchema,
      rawLogin,
      "login_response",
    );
    if (loginEnvelope.code === "CRM-00-2004") {
      throw new ResH5LoginConflictError();
    }
    const login = parseExternal(
      loginEnvelopeSchema,
      rawLogin,
      "login_response",
    );
    assertAccountSuccess(login, rawLogin, "login_rejected");
    let resToken =
      login.code === "CRM-00-0000"
        ? parseExternal(
            rotatedLoginEnvelopeSchema,
            rawLogin,
            "login_response",
          ).data.token
        : input.session.token;

    const userInfo = await this.getUserInfo(
      resToken,
      input.session.deviceId,
    );
    const memberId = normalizeMemberId(userInfo.data.customerId);
    if (userInfo.data.isMember) {
      if (!memberId) {
        throw new ResH5AuthDiagnosticError({
          stage: "member_id_missing",
          message:
            "RES H5 did not resolve an active member account.",
        });
      }
      return {
        memberId,
        resToken,
        newlyRegistered: false,
      };
    }

    const registrationPayload = await this.post(
      "/api/user-auth/register",
      {
        subType: "phone",
        phone: phone.phone,
        countryCode: phone.countryCode,
        isoCode: phone.isoCode,
        cardProgramId: this.config.cardProgramId,
        ...(login.data.verifyToken
          ? { verifyToken: login.data.verifyToken }
          : {}),
      },
      resToken,
      input.session.deviceId,
      "register_transport",
    );
    const registration = parseExternal(
      apiEnvelopeSchema,
      registrationPayload,
      "register_response",
    );
    assertAccountSuccess(
      registration,
      registrationPayload,
      "register_rejected",
    );

    // Registering rotates the session token the same way logging in does, and
    // the pre-registration token stops resolving the account once it has. Read
    // the member back with the token RES just handed us, not the stale one.
    if (registration.code === "CRM-00-0000") {
      resToken = parseExternal(
        rotatedLoginEnvelopeSchema,
        registrationPayload,
        "register_response",
      ).data.token;
    }

    const registeredUserInfo = await this.getUserInfo(
      resToken,
      input.session.deviceId,
    );
    const registeredMemberId = normalizeMemberId(
      registeredUserInfo.data.customerId,
    );
    if (
      !registeredUserInfo.data.isMember ||
      !registeredMemberId
    ) {
      throw new ResH5AuthDiagnosticError({
        stage: "registration_readback_failed",
        message: "RES H5 did not resolve an active member account.",
      });
    }

    return {
      memberId: registeredMemberId,
      resToken,
      newlyRegistered: true,
    };
  }

  private async getUserInfo(
    token: string,
    deviceId: string,
  ): Promise<z.infer<typeof userInfoEnvelopeSchema>> {
    const payload = await this.post(
      "/api/crm/customer/userinfo",
      { cardProgramId: this.config.cardProgramId },
      token,
      deviceId,
      "userinfo_transport",
    );
    const response = parseExternal(
      userInfoEnvelopeSchema,
      payload,
      "userinfo_response",
    );
    assertSuccess(response, payload, "userinfo_rejected");
    return response;
  }

  private async post(
    pathname: string,
    body: unknown,
    token: string,
    deviceId: string,
    stage: ResH5AuthDiagnosticStage,
  ): Promise<ResH5HttpPayload> {
    assertHeaderValue(deviceId, "device ID");
    const requestSignal = this.deadlineSignal
      ? AbortSignal.any([
          AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
          this.deadlineSignal,
        ])
      : AbortSignal.timeout(PER_CALL_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetcher(
        `${RES_H5_BASE_URL}${pathname}`,
        {
          method: "POST",
          cache: "no-store",
          redirect: "error",
          headers: {
            "Content-Type": "application/json;charset=UTF-8",
            corporationId: this.config.corporationId,
            appid: this.config.appId,
            appVersion: "100.0.0",
            clientType: "3001",
            token,
            "Language-Code": "en_US",
            "Accept-Timezone": "Asia/Kuala_Lumpur",
            channelId: "",
            "X-Request-ID": crypto.randomUUID(),
            "ctx-deviceid": deviceId,
            "ctx-pagepath": "/login",
            "ctx-params": "/login?type=phone",
            // 见构造函数上的说明：验证码绑 IP，不带这个 RES 会拿我们的出口 IP
            // 去腾讯核验，必然判为不一致。两个头都发——RES 用哪个我们看不到。
            ...(this.clientIp
              ? {
                  "x-forwarded-for": this.clientIp,
                  "x-real-ip": this.clientIp,
                }
              : {}),
          },
          body: JSON.stringify(body),
          signal: requestSignal,
        },
      );
    } catch {
      throw new ResH5AuthDiagnosticError({
        stage,
        message: "RES H5 request failed.",
        timedOut: requestSignal.aborted,
      });
    }
    if (!response.ok) {
      throw new ResH5AuthDiagnosticError({
        stage,
        message: "RES H5 request failed.",
        httpStatus: response.status,
      });
    }
    try {
      return {
        body: await response.json(),
        status: response.status,
      };
    } catch {
      throw new ResH5AuthDiagnosticError({
        stage,
        message: "RES H5 request failed.",
        httpStatus: response.status,
        timedOut: requestSignal.aborted,
      });
    }
  }
}

interface ResH5HttpPayload {
  body: unknown;
  status: number;
}

function parseExternal<T>(
  schema: z.ZodType<T>,
  payload: ResH5HttpPayload,
  stage: ResH5AuthDiagnosticStage,
): T {
  const result = schema.safeParse(payload.body);
  if (!result.success) {
    throw createDiagnosticError(
      stage,
      payload,
      "RES H5 returned an invalid response.",
    );
  }
  return result.data;
}

function assertSuccess(
  response: { code: string },
  payload: ResH5HttpPayload,
  stage: ResH5AuthDiagnosticStage,
): void {
  if (response.code !== "000") {
    throw createDiagnosticError(
      stage,
      payload,
      "RES H5 returned an unsuccessful response.",
    );
  }
}

/**
 * RES answers the account endpoints with either "000" or "CRM-00-0000", and
 * "CRM-00-0000" additionally carries a rotated session token in data.token.
 * Both mean success; only the auth surface uses this second form.
 */
function isAccountSuccessCode(code: string): boolean {
  return code === "000" || code === "CRM-00-0000";
}

function assertAccountSuccess(
  response: { code: string },
  payload: ResH5HttpPayload,
  stage: ResH5AuthDiagnosticStage,
): void {
  if (!isAccountSuccessCode(response.code)) {
    throw createDiagnosticError(
      stage,
      payload,
      "RES H5 returned an unsuccessful response.",
    );
  }
}

function createDiagnosticError(
  stage: ResH5AuthDiagnosticStage,
  payload: ResH5HttpPayload,
  message: string,
): ResH5AuthDiagnosticError {
  const body = isRecord(payload.body) ? payload.body : undefined;
  const data =
    body && isRecord(body.data) ? body.data : undefined;
  return new ResH5AuthDiagnosticError({
    stage,
    message,
    providerCode: readSafeProviderCode(body?.code),
    providerMessage: readSafeProviderMessage(body?.msg ?? body?.message),
    httpStatus: payload.status,
    topLevelKeys: readSafeKeys(body),
    dataKeys: readSafeKeys(data),
    dataValueTypes: readSafeValueTypes(data),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function readSafeProviderCode(value: unknown): string | undefined {
  return typeof value === "string" &&
    (value === "000" || /^CRM-\d{2}-\d{4}$/.test(value))
    ? value
    : undefined;
}

/**
 * RES 的 msg 是自由文本，可能把手机号回显进来。落日志前先掐掉长数字串再截断——
 * 目的是看懂「RES 到底说了什么」，不是把顾客的号码抄进日志。
 */
function readSafeProviderMessage(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const scrubbed = value.replace(/\d{4,}/g, "***").trim();
  return scrubbed.length === 0 ? undefined : scrubbed.slice(0, 200);
}

function readSafeKeys(
  value: Record<string, unknown> | undefined,
): string[] {
  if (!value) {
    return [];
  }
  return Object.keys(value)
    .filter(
      (key) =>
        /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) &&
        !/\d{6,}/.test(key),
    )
    .sort()
    .slice(0, 24);
}

type SafeValueType =
  | "array"
  | "boolean"
  | "null"
  | "number"
  | "object"
  | "string"
  | "undefined";

function readSafeValueTypes(
  value: Record<string, unknown> | undefined,
): Record<string, SafeValueType> {
  if (!value) {
    return {};
  }
  return Object.fromEntries(
    readSafeKeys(value).map((key) => [
      key,
      readSafeValueType(value[key]),
    ]),
  );
}

function readSafeValueType(value: unknown): SafeValueType {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  const kind = typeof value;
  if (
    kind === "boolean" ||
    kind === "number" ||
    kind === "string" ||
    kind === "undefined"
  ) {
    return kind;
  }
  return "object";
}

function assertHeaderValue(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    /[\r\n]/.test(value)
  ) {
    throw new Error(`Invalid RES H5 ${label}.`);
  }
}

function parsePhone(
  value: ResH5PhoneIdentity,
): ResH5PhoneIdentity {
  const result = z
    .object({
      phone: z.string().regex(/^\d{4,15}$/),
      isoCode: z.string().regex(/^[A-Z]{2,3}$/),
      countryCode: z.string().regex(/^\d{1,4}$/),
    })
    .strict()
    .safeParse(value);
  if (!result.success) {
    throw new Error("Invalid RES H5 phone identity.");
  }
  return result.data;
}

/**
 * 验证码凭证同样要在出网前校验形状。腾讯的 ticket 在 SDK 降级时会是
 * `trerror_<code>_<appid>_<ts>` 这种占位串——那不是我们该伪造的东西，但它确实可能
 * 从真实 SDK 回调里来，所以这里只校验「非空且长度合理」，把判定留给 RES。
 */
function parseCaptcha(value: ResH5CaptchaSolution): ResH5CaptchaSolution {
  const result = z
    .object({
      token: z.string().min(1).max(1024),
      randstr: z.string().min(1).max(256),
    })
    .strict()
    .safeParse(value);
  if (!result.success) {
    throw new Error("Invalid RES H5 captcha solution.");
  }
  return result.data;
}

function parseVerificationCode(value: string): string {
  if (!/^\d{6}$/.test(value)) {
    throw new Error(
      "RES H5 verification code must be exactly six digits.",
    );
  }
  return value;
}

function normalizeMemberId(
  value: string | number | null | undefined,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const memberId = String(value).trim();
  return memberId.length > 0 ? memberId : undefined;
}
