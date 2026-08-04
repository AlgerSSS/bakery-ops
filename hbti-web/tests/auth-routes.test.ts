import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const store = {
    createChallenge: vi.fn(),
    beginAttempt: vi.fn(),
    releaseAttempt: vi.fn(),
    markConflict: vi.fn(),
    consumeChallenge: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
  };
  const res = {
    createGuestSession: vi.fn(),
    getCaptchaConfig: vi.fn(),
    sendVerifyCode: vi.fn(),
    verifyLoginAndEnsureMember: vi.fn(),
    loginAndEnsureMember: vi.fn(),
  };
  const rateLimiter = {
    consumeOtpRequest: vi.fn(),
  };
  return {
    store,
    res,
    rateLimiter,
    createAuthStoreFromEnv: vi.fn(),
    createResClient: vi.fn(),
    createRateLimiter: vi.fn(),
    readServerConfig: vi.fn(),
    readAuthConfig: vi.fn(),
    readCaptchaConfig: vi.fn(),
    forgetCaptchaConfig: vi.fn(),
  };
});

vi.mock("@/lib/auth/pg-auth-store", () => ({
  createAuthStoreFromEnv: mocks.createAuthStoreFromEnv,
}));

vi.mock("@/lib/auth/res-auth-client", () => ({
  createResH5MemberAuthClientFromEnv: mocks.createResClient,
}));

vi.mock("@/lib/rate-limit/auth-rate-limit", () => ({
  createAuthRateLimiterFromEnv: mocks.createRateLimiter,
  readClientIp: (request: Request) =>
    request.headers.get("x-forwarded-for") ?? "unknown",
}));

vi.mock("@/lib/server-config", () => ({
  readHbtiServerConfig: mocks.readServerConfig,
  readHbtiAuthConfig: mocks.readAuthConfig,
}));

vi.mock("@/lib/auth/captcha-config", () => ({
  readCaptchaConfig: mocks.readCaptchaConfig,
  forgetCaptchaConfig: mocks.forgetCaptchaConfig,
}));

import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as requestOtp } from "@/app/api/auth/otp/request/route";
import { POST as verifyOtp } from "@/app/api/auth/otp/verify/route";
import { GET as getSession } from "@/app/api/auth/session/route";
import {
  ResH5AuthDiagnosticError,
  ResH5LoginConflictError,
  ResH5VerificationCodeError,
} from "@/lib/res/h5-member-auth";

const origin = "https://hbti-test.hotcrush.net";
const challengeToken = "c".repeat(43);
const sessionToken = "s".repeat(43);
const expiresAt = new Date("2026-07-30T12:00:00.000Z");
const identity = {
  countryCode: "86",
  isoCode: "CN",
  phone: "13912345678",
  e164: "+8613912345678",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readServerConfig.mockReturnValue({
    linkBaseUrl: origin,
  });
  mocks.readAuthConfig.mockReturnValue({
    authSecret: "auth-secret-".repeat(4),
    h5BaseUrl: "https://f4klzbmr9n2d.m.sea.restosuite.ai",
    corporationId: "corp",
    appId: "app",
    cardProgramId: "card",
  });
  mocks.createAuthStoreFromEnv.mockResolvedValue(mocks.store);
  mocks.createResClient.mockReturnValue(mocks.res);
  mocks.createRateLimiter.mockResolvedValue(mocks.rateLimiter);
  mocks.rateLimiter.consumeOtpRequest.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    phoneAttemptsToday: 1,
  });
  mocks.res.createGuestSession.mockResolvedValue({
    deviceId: "device-1",
    token: "guest-token",
  });
  mocks.res.getCaptchaConfig.mockResolvedValue({ enable: false });
  mocks.readCaptchaConfig.mockResolvedValue({ enable: false, provider: null });
  mocks.res.sendVerifyCode.mockResolvedValue({
    code: "000",
    bodyKeys: ["code", "data"],
  });
  mocks.store.createChallenge.mockResolvedValue({
    token: challengeToken,
    expiresAt,
  });
  mocks.store.beginAttempt.mockResolvedValue({
    payload: {
      guestToken: "guest-token",
      deviceId: "device-1",
      identity,
    },
    attempts: 1,
    expiresAt,
  });
  mocks.store.releaseAttempt.mockResolvedValue(true);
  mocks.store.markConflict.mockResolvedValue(true);
  mocks.store.consumeChallenge.mockResolvedValue(true);
  mocks.store.createSession.mockResolvedValue({
    token: sessionToken,
    expiresAt,
    draftKey: "d".repeat(43),
  });
  mocks.store.getSession.mockResolvedValue({
    payload: {
      memberId: "member-1",
      resToken: "res-member-token",
      identity,
    },
    expiresAt,
    draftKey: "d".repeat(43),
  });
  mocks.store.deleteSession.mockResolvedValue(true);
  mocks.res.verifyLoginAndEnsureMember.mockResolvedValue({
    memberId: "member-1",
    resToken: "res-member-token",
    newlyRegistered: false,
  });
  mocks.res.loginAndEnsureMember.mockResolvedValue({
    memberId: "member-1",
    resToken: "res-member-token",
    newlyRegistered: false,
  });
});

describe("POST /api/auth/otp/request", () => {
  it("rejects malformed JSON without calling RES or the database", async () => {
    const response = await requestOtp(malformedMutationRequest("/api/auth/otp/request"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "INVALID_REQUEST",
    });
    expect(mocks.createRateLimiter).not.toHaveBeenCalled();
    expect(mocks.createAuthStoreFromEnv).not.toHaveBeenCalled();
    expect(mocks.createResClient).not.toHaveBeenCalled();
  });

  it("sends one OTP through RES and returns only an opaque challenge", async () => {
    const response = await requestOtp(
      mutationRequest("/api/auth/otp/request", {
        phone: {
          countryCode: "86",
          isoCode: "CN",
          phone: "13912345678",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challengeToken,
      maskedPhone: "+86 139****5678",
      // 当天第一次，界面照常说「已发送」。
      resendMayNotArrive: false,
    });
    expect(mocks.rateLimiter.consumeOtpRequest).toHaveBeenCalledWith({
      phoneE164: "+8613912345678",
      ipAddress: "203.0.113.10",
    });
    expect(mocks.store.createChallenge).toHaveBeenCalledWith({
      guestToken: "guest-token",
      deviceId: "device-1",
      identity,
    });
    expect(mocks.res.sendVerifyCode).toHaveBeenCalledWith({
      session: {
        deviceId: "device-1",
        token: "guest-token",
      },
      phone: {
        countryCode: "86",
        isoCode: "CN",
        phone: "13912345678",
      },
    });
    expect(
      mocks.store.createChallenge.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.res.sendVerifyCode.mock.invocationCallOrder[0]);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  // 2026-08-04：RES 在租户级打开了腾讯云验证码，`sendVerifyCode` 从此服务端强制
  // 要求 captcha（不带就是 UNI-00-0103）。以下三条钉住这条路径的全部分支。
  it("要求验证码时如实回 400 并附带配置，而不是含糊的 503", async () => {
    mocks.readCaptchaConfig.mockResolvedValue({
      enable: true,
      provider: "tencent-cloud",
      appId: "189993702",
    });

    const response = await requestOtp(
      mutationRequest("/api/auth/otp/request", {
        phone: { countryCode: "60", isoCode: "MY", phone: "123456789" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "CAPTCHA_REQUIRED",
      captcha: {
        enable: true,
        provider: "tencent-cloud",
        appId: "189993702",
      },
    });
    expect(mocks.store.createChallenge).not.toHaveBeenCalled();
    expect(mocks.res.sendVerifyCode).not.toHaveBeenCalled();
    // 缺验证码的请求根本到不了 RES，不该消耗顾客当天的发码额度。
    expect(mocks.rateLimiter.consumeOtpRequest).not.toHaveBeenCalled();
  });

  it("带上顾客解出的验证码时原样透传给 RES", async () => {
    mocks.readCaptchaConfig.mockResolvedValue({
      enable: true,
      provider: "tencent-cloud",
      appId: "189993702",
    });

    const response = await requestOtp(
      mutationRequest("/api/auth/otp/request", {
        phone: { countryCode: "60", isoCode: "MY", phone: "123456789" },
        captcha: { token: "tkt-abc", randstr: "@rnd" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.res.sendVerifyCode).toHaveBeenCalledWith(
      expect.objectContaining({
        captcha: { token: "tkt-abc", randstr: "@rnd" },
      }),
    );
  });

  it("RES 换成我们驱动不了的验证码时 fail closed", async () => {
    mocks.readCaptchaConfig.mockResolvedValue({
      enable: true,
      provider: "unsupported",
    });

    const response = await requestOtp(
      mutationRequest("/api/auth/otp/request", {
        phone: { countryCode: "60", isoCode: "MY", phone: "123456789" },
        captcha: { token: "tkt-abc", randstr: "@rnd" },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "CAPTCHA_UNSUPPORTED",
    });
    expect(mocks.res.sendVerifyCode).not.toHaveBeenCalled();
  });

  it("发码失败时作废验证码配置缓存，让下一次请求重新问 RES", async () => {
    mocks.res.sendVerifyCode.mockRejectedValue(new Error("captcha missing"));

    const response = await requestOtp(
      mutationRequest("/api/auth/otp/request", {
        phone: { countryCode: "60", isoCode: "MY", phone: "123456789" },
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(mocks.forgetCaptchaConfig).toHaveBeenCalledTimes(1);
  });

  it("同号码当天第二次发码时如实告知新短信可能收不到", async () => {
    // RES 对同一号码当天的重复发码回 "000" 却不真的送达（19 次请求精确关联：
    // 当日首次 11/13 到达，重复 0/6）。我们拦不住 RES，但不能跟着它一起
    // 笃定地说「已发送」——顾客会一直干等，然后继续点重发。
    mocks.rateLimiter.consumeOtpRequest.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
      phoneAttemptsToday: 2,
    });

    const response = await requestOtp(
      mutationRequest("/api/auth/otp/request", {
        phone: {
          countryCode: "86",
          isoCode: "CN",
          phone: "13912345678",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resendMayNotArrive: true,
    });
    // 仍然照发——RES 的规则是推断出来的，不该由我们替它拒绝顾客。
    expect(mocks.res.sendVerifyCode).toHaveBeenCalledTimes(1);
  });

  it("enforces rate limits before creating an RES guest session", async () => {
    mocks.rateLimiter.consumeOtpRequest.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 47,
    });

    const response = await requestOtp(
      mutationRequest("/api/auth/otp/request", {
        phone: {
          countryCode: "86",
          isoCode: "CN",
          phone: "13912345678",
        },
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("47");
    expect(mocks.res.createGuestSession).not.toHaveBeenCalled();
    expect(mocks.res.sendVerifyCode).not.toHaveBeenCalled();
  });

  it("rejects malformed phones and cross-site requests without side effects", async () => {
    const malformed = await requestOtp(
      mutationRequest("/api/auth/otp/request", {
        phone: {
          countryCode: "60",
          isoCode: "CN",
          phone: "13912345678",
        },
      }),
    );
    expect(malformed.status).toBe(400);

    const crossSite = await requestOtp(
      mutationRequest(
        "/api/auth/otp/request",
        {
          phone: {
            countryCode: "86",
            isoCode: "CN",
            phone: "13912345678",
          },
        },
        {
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        },
      ),
    );
    expect(crossSite.status).toBe(403);
    expect(mocks.rateLimiter.consumeOtpRequest).not.toHaveBeenCalled();
    expect(mocks.res.sendVerifyCode).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/otp/verify", () => {
  it("rejects malformed JSON before acquiring a challenge", async () => {
    const response = await verifyOtp(malformedMutationRequest("/api/auth/otp/verify"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "INVALID_REQUEST",
    });
    expect(mocks.store.beginAttempt).not.toHaveBeenCalled();
    expect(mocks.createResClient).not.toHaveBeenCalled();
  });

  it("consumes the challenge and creates an opaque two-hour session", async () => {
    mocks.res.verifyLoginAndEnsureMember.mockResolvedValueOnce({
      memberId: "member-1",
      resToken: "res-member-token",
      newlyRegistered: true,
    });
    const response = await verifyOtp(
      mutationRequest("/api/auth/otp/verify", {
        challengeToken,
        code: "123456",
        acceptMembership: true,
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      authenticated: true,
      maskedPhone: "+86 139****5678",
      draftKey: "d".repeat(43),
    });
    expect(mocks.res.verifyLoginAndEnsureMember).toHaveBeenCalledWith({
      session: { deviceId: "device-1", token: "guest-token" },
      phone: {
        countryCode: "86",
        isoCode: "CN",
        phone: "13912345678",
      },
      code: "123456",
      resolveConflicts: false,
    });
    expect(mocks.store.createSession).toHaveBeenCalledWith({
      memberId: "member-1",
      resToken: "res-member-token",
      identity,
    });
    expect(
      mocks.store.createSession.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.store.consumeChallenge.mock.invocationCallOrder[0]);
    expect(response.headers.get("set-cookie")).toContain(
      `hbti_session=${sessionToken}`,
    );
    expect(JSON.stringify(body)).not.toContain("member-1");
    expect(JSON.stringify(body)).not.toContain("res-member-token");
    expect(body).not.toHaveProperty("newlyRegistered");
  });

  it("requires explicit membership acceptance before touching a challenge", async () => {
    const response = await verifyOtp(
      mutationRequest("/api/auth/otp/verify", {
        challengeToken,
        code: "123456",
        acceptMembership: false,
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.store.beginAttempt).not.toHaveBeenCalled();
  });

  it("stores an encrypted conflict continuation and asks for confirmation", async () => {
    mocks.res.verifyLoginAndEnsureMember.mockRejectedValue(
      new ResH5LoginConflictError(),
    );

    const response = await verifyOtp(
      mutationRequest("/api/auth/otp/verify", {
        challengeToken,
        code: "123456",
        acceptMembership: true,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "ACCOUNT_CONFLICT_CONFIRMATION_REQUIRED",
    });
    expect(mocks.store.markConflict).toHaveBeenCalledWith(
      challengeToken,
      "123456",
    );
    expect(mocks.store.releaseAttempt).not.toHaveBeenCalled();
    expect(mocks.store.createSession).not.toHaveBeenCalled();
  });

  it("retries only login when a matching verified conflict marker exists", async () => {
    mocks.store.beginAttempt.mockResolvedValue({
      payload: {
        guestToken: "guest-token",
        deviceId: "device-1",
        identity,
        verifiedCode: "123456",
      },
      attempts: 2,
      expiresAt,
    });

    const response = await verifyOtp(
      mutationRequest("/api/auth/otp/verify", {
        challengeToken,
        code: "123456",
        acceptMembership: true,
        confirmConflict: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.res.loginAndEnsureMember).toHaveBeenCalledWith({
      session: { deviceId: "device-1", token: "guest-token" },
      phone: {
        countryCode: "86",
        isoCode: "CN",
        phone: "13912345678",
      },
      code: "123456",
      resolveConflicts: true,
    });
    expect(mocks.res.verifyLoginAndEnsureMember).not.toHaveBeenCalled();
  });

  it("does not let a direct conflict-confirmation flag bypass code verification", async () => {
    const response = await verifyOtp(
      mutationRequest("/api/auth/otp/verify", {
        challengeToken,
        code: "123456",
        acceptMembership: true,
        confirmConflict: true,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "ACCOUNT_CONFLICT_CONFIRMATION_REQUIRED",
    });
    expect(mocks.res.loginAndEnsureMember).not.toHaveBeenCalled();
    expect(mocks.res.verifyLoginAndEnsureMember).not.toHaveBeenCalled();
    expect(mocks.store.releaseAttempt).toHaveBeenCalledWith(challengeToken);
    expect(mocks.store.createSession).not.toHaveBeenCalled();
  });

  it("releases a failed confirmed login while preserving its stored marker", async () => {
    mocks.store.beginAttempt.mockResolvedValue({
      payload: {
        guestToken: "guest-token",
        deviceId: "device-1",
        identity,
        verifiedCode: "123456",
      },
      attempts: 2,
      expiresAt,
    });
    mocks.res.loginAndEnsureMember.mockRejectedValue(
      new Error("sanitized RES rejection"),
    );

    const response = await verifyOtp(
      mutationRequest("/api/auth/otp/verify", {
        challengeToken,
        code: "123456",
        acceptMembership: true,
        confirmConflict: true,
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "VERIFICATION_FAILED",
    });
    expect(mocks.res.loginAndEnsureMember).toHaveBeenCalledWith(
      expect.objectContaining({ resolveConflicts: true }),
    );
    expect(mocks.res.verifyLoginAndEnsureMember).not.toHaveBeenCalled();
    expect(mocks.store.releaseAttempt).toHaveBeenCalledWith(challengeToken);
  });

  it("logs only safe RES stage diagnostics while keeping the HTTP response generic", async () => {
    const diagnostic = new ResH5AuthDiagnosticError({
      stage: "userinfo_response",
      providerCode: "CRM-00-0000",
      httpStatus: 200,
      topLevelKeys: ["code", "data"],
      dataKeys: ["customerId", "isMember", "token"],
      dataValueTypes: {
        customerId: "string",
        isMember: "boolean",
        token: "string",
      },
    });
    mocks.res.verifyLoginAndEnsureMember.mockRejectedValue(diagnostic);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const response = await verifyOtp(
        mutationRequest("/api/auth/otp/verify", {
          challengeToken,
          code: "123456",
          acceptMembership: true,
        }),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "VERIFICATION_FAILED",
      });
      expect(consoleError).toHaveBeenCalledWith(
        "HBTI RES member authentication failed",
        {
          stage: "userinfo_response",
          providerCode: "CRM-00-0000",
          httpStatus: 200,
          topLevelKeys: ["code", "data"],
          dataKeys: ["customerId", "isMember", "token"],
          dataValueTypes: {
            customerId: "string",
            isMember: "boolean",
            token: "string",
          },
        },
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "123456",
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "guest-token",
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "13912345678",
      );
      expect(mocks.store.releaseAttempt).toHaveBeenCalledWith(
        challengeToken,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("only labels an actually aborted RES call as verification timeout", async () => {
    mocks.res.verifyLoginAndEnsureMember.mockRejectedValue(
      new ResH5AuthDiagnosticError({
        stage: "userinfo_transport",
        timedOut: true,
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await verifyOtp(
      mutationRequest("/api/auth/otp/verify", {
        challengeToken,
        code: "123456",
        acceptMembership: true,
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "VERIFICATION_TIMEOUT",
      retryable: true,
    });
    expect(mocks.store.releaseAttempt).toHaveBeenCalledWith(challengeToken);
  });

  it("does not hide an immediate RES HTTP failure behind timeout copy", async () => {
    mocks.res.verifyLoginAndEnsureMember.mockRejectedValue(
      new ResH5AuthDiagnosticError({
        stage: "userinfo_transport",
        httpStatus: 401,
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await verifyOtp(
      mutationRequest("/api/auth/otp/verify", {
        challengeToken,
        code: "123456",
        acceptMembership: true,
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "VERIFICATION_FAILED",
    });
    expect(mocks.store.releaseAttempt).toHaveBeenCalledWith(challengeToken);
  });

  it("returns a useful retryable response for a rejected verification code", async () => {
    mocks.res.verifyLoginAndEnsureMember.mockRejectedValue(
      new ResH5VerificationCodeError(),
    );

    const response = await verifyOtp(
      mutationRequest("/api/auth/otp/verify", {
        challengeToken,
        code: "123456",
        acceptMembership: true,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "INVALID_VERIFICATION_CODE",
    });
    expect(mocks.store.releaseAttempt).toHaveBeenCalledWith(challengeToken);
    expect(mocks.store.createSession).not.toHaveBeenCalled();
  });

  it("does not replay an expired, consumed, or exhausted challenge", async () => {
    mocks.store.beginAttempt.mockResolvedValue(null);

    const response = await verifyOtp(
      mutationRequest("/api/auth/otp/verify", {
        challengeToken,
        code: "123456",
        acceptMembership: true,
      }),
    );

    expect(response.status).toBe(410);
    expect(mocks.res.verifyLoginAndEnsureMember).not.toHaveBeenCalled();
    expect(mocks.store.createSession).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/session", () => {
  it("returns only the authenticated session DTO", async () => {
    const response = await getSession(
      new Request(`${origin}/api/auth/session`, {
        headers: { Cookie: `hbti_session=${sessionToken}` },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      authenticated: true,
      maskedPhone: "+86 139****5678",
      draftKey: "d".repeat(43),
    });
    expect(JSON.stringify(body)).not.toContain("res-member-token");
    expect(JSON.stringify(body)).not.toContain("member-1");
  });

  it("avoids a database read without a session cookie", async () => {
    const response = await getSession(
      new Request(`${origin}/api/auth/session`),
    );

    await expect(response.json()).resolves.toEqual({
      authenticated: false,
    });
    expect(mocks.createAuthStoreFromEnv).not.toHaveBeenCalled();
  });

  it("clears a stale session cookie", async () => {
    mocks.store.getSession.mockResolvedValue(null);

    const response = await getSession(
      new Request(`${origin}/api/auth/session`, {
        headers: { Cookie: `hbti_session=${sessionToken}` },
      }),
    );

    await expect(response.json()).resolves.toEqual({
      authenticated: false,
    });
    expect(response.headers.get("set-cookie")).toContain(
      "hbti_session=;",
    );
  });
});

describe("POST /api/auth/logout", () => {
  it("rejects malformed JSON and still clears the browser cookie", async () => {
    const response = await logout(
      malformedMutationRequest("/api/auth/logout", {
        Cookie: `hbti_session=${sessionToken}`,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "INVALID_REQUEST",
    });
    expect(mocks.store.deleteSession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("hbti_session=;");
  });

  it("deletes the server session and clears the cookie", async () => {
    const response = await logout(
      mutationRequest(
        "/api/auth/logout",
        {},
        { Cookie: `hbti_session=${sessionToken}` },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
    });
    expect(mocks.store.deleteSession).toHaveBeenCalledWith(sessionToken);
    expect(response.headers.get("set-cookie")).toContain(
      "hbti_session=;",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

function malformedMutationRequest(
  pathname: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${origin}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: "{",
  });
}

function mutationRequest(
  pathname: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${origin}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "X-Forwarded-For": "203.0.113.10",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
