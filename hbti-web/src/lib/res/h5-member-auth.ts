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

export interface ResH5SendVerifyCodeInput {
  session: ResH5GuestSession;
  phone: ResH5PhoneIdentity;
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
  httpStatus?: number;
  topLevelKeys?: string[];
  dataKeys?: string[];
  dataValueTypes?: Record<string, SafeValueType>;
}

export class ResH5AuthDiagnosticError extends Error {
  readonly stage: ResH5AuthDiagnosticStage;
  readonly providerCode?: string;
  readonly httpStatus?: number;
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
    this.httpStatus = details.httpStatus;
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

export class ResH5MemberAuthClient {
  constructor(
    private readonly config: ResH5MemberAuthConfig,
    private readonly fetcher: FetchLike = fetch,
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

  async sendVerifyCode(
    input: ResH5SendVerifyCodeInput,
  ): Promise<void> {
    const phone = parsePhone(input.phone);
    const payload = await this.post(
      "/api/user-auth/sendVerifyCode",
      { contactType: "PHONE", phone },
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
    assertLoginSuccess(login, rawLogin);
    const resToken =
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
    assertSuccess(
      registration,
      registrationPayload,
      "register_rejected",
    );

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
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(12_000),
        },
      );
    } catch {
      throw new ResH5AuthDiagnosticError({
        stage,
        message: "RES H5 request failed.",
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

function assertLoginSuccess(
  response: { code: string },
  payload: ResH5HttpPayload,
): void {
  if (
    response.code !== "000" &&
    response.code !== "CRM-00-0000"
  ) {
    throw createDiagnosticError(
      "login_rejected",
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
