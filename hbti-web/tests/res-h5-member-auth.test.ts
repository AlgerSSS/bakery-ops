import { describe, expect, it, vi } from "vitest";

import {
  ResH5AuthDiagnosticError,
  ResH5MemberAuthClient,
  ResH5LoginConflictError,
  ResH5VerificationCodeError,
  type ResH5MemberAuthConfig,
} from "@/lib/res/h5-member-auth";

const config: ResH5MemberAuthConfig = {
  baseUrl: "https://f4klzbmr9n2d.m.sea.restosuite.ai",
  corporationId: "corp-1",
  appId: "app-1",
  cardProgramId: "card-program-1",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ResH5MemberAuthClient 的整体时限", () => {
  // 发码要串行走三次 RES 调用，每次各自 12 秒。没有共享时限的话最坏 36 秒，
  // 而函数上限 30 秒、浏览器 25 秒——于是顾客看到「网络错误」时短信其实正在路上，
  // 接着他去点重发，而重发正是 RES 会静默丢掉的那一类。
  it("把调用方的时限串进每一次 RES 请求", async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ code: "000", data: { authorizeInfo: null, token: "t" } }));
    const client = new ResH5MemberAuthClient(
      config,
      fetcher,
      controller.signal,
    );

    await client.createGuestSession("device-1");

    const init = fetcher.mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
    // 调用方一喊停，正在飞的这次请求就得跟着停——这正是 AbortSignal.any 的作用。
    controller.abort();
    expect(init?.signal?.aborted).toBe(true);
  });

  it("不传时限时仍然有每次调用自己的超时", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ code: "000", data: { authorizeInfo: null, token: "t" } }));
    const client = new ResH5MemberAuthClient(config, fetcher);

    await client.createGuestSession("device-1");

    const init = fetcher.mock.calls[0][1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });
});

describe("ResH5MemberAuthClient", () => {
  it.each([
    "https://attacker.example",
    "https://f4klzbmr9n2d.m.sea.restosuite.ai.attacker.example",
    "http://f4klzbmr9n2d.m.sea.restosuite.ai",
    "https://f4klzbmr9n2d.m.sea.restosuite.ai/",
    "https://f4klzbmr9n2d.m.sea.restosuite.ai/login",
  ])("refuses every base URL except the pinned RES H5 host: %s", (baseUrl) => {
    expect(
      () =>
        new ResH5MemberAuthClient(
          { ...config, baseUrl },
          vi.fn<typeof fetch>(),
        ),
    ).toThrow("verified RES H5 origin");
  });

  it("creates a guest session with the exact official RES H5 request contract", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        code: "000",
        data: {
          authorizeInfo: { anonymous: true },
          token: "guest-token",
          ignoredByClient: true,
        },
        ignoredEnvelopeField: true,
      }),
    );
    const client = new ResH5MemberAuthClient(config, fetcher);

    await expect(
      client.createGuestSession("device-123"),
    ).resolves.toEqual({
      deviceId: "device-123",
      token: "guest-token",
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/user-auth/auth",
    );
    expect(init).toMatchObject({
      method: "POST",
      body: "{}",
      cache: "no-store",
      redirect: "error",
    });
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json;charset=UTF-8",
      corporationId: "corp-1",
      appid: "app-1",
      appVersion: "100.0.0",
      clientType: "3001",
      token: "",
      "Language-Code": "en_US",
      "Accept-Timezone": "Asia/Kuala_Lumpur",
      "ctx-deviceid": "device-123",
      "ctx-pagepath": "/login",
      "ctx-params": "/login?type=phone",
    });
    expect(init?.headers).toMatchObject({
      "X-Request-ID": expect.any(String),
    });
    expect(
      String((init?.headers as Record<string, string>)["X-Request-ID"]),
    ).not.toHaveLength(0);
  });

  it("reads captcha requirements using the guest session without bypassing them", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        code: "000",
        data: {
          enable: true,
          captchaType: "SLIDER",
          provider: "official",
        },
      }),
    );
    const client = new ResH5MemberAuthClient(config, fetcher);
    const session = {
      deviceId: "device-123",
      token: "guest-token",
    };

    await expect(client.getCaptchaConfig(session)).resolves.toEqual({
      enable: true,
      captchaType: "SLIDER",
      provider: "official",
    });

    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/user-auth/captcha/config",
    );
    expect(init).toMatchObject({ body: "{}" });
    expect(init?.headers).toMatchObject({
      token: "guest-token",
      "ctx-deviceid": "device-123",
    });
  });

  it("sends the official phone verification-code payload with the guest token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ code: "000", data: null }));
    const client = new ResH5MemberAuthClient(config, fetcher);
    const session = {
      deviceId: "device-123",
      token: "guest-token",
    };

    // 回执是刻意带回来的：RES 说了什么必须能落进日志，否则「回了 000 却没发短信」
    // 在线上只表现为一个光秃秃的 200，无从诊断。
    await expect(
      client.sendVerifyCode({
        session,
        phone: {
          phone: "13912345678",
          isoCode: "CN",
          countryCode: "86",
        },
      }),
    ).resolves.toMatchObject({ code: "000" });

    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/user-auth/sendVerifyCode",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      contactType: "PHONE",
      phone: {
        phone: "13912345678",
        isoCode: "CN",
        countryCode: "86",
      },
    });
    expect(init?.headers).toMatchObject({ token: "guest-token" });
  });

  it("verifies, logs in, and resolves an existing RES member", async () => {
    const verifiedPayload = {
      contactType: "EMAIL",
      verificationId: "must-not-be-forwarded",
      resolveConflicts: "must-not-be-forwarded",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ code: "000", data: verifiedPayload }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "CRM-00-0000",
          data: {
            authorizeInfo: { customer: true },
            token: "user-token",
            verifyToken: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: {
            customerId: "member-1",
            isMember: true,
            nickname: "ignored",
          },
        }),
      );
    const client = new ResH5MemberAuthClient(config, fetcher);

    await expect(
      client.verifyLoginAndEnsureMember({
        session: {
          deviceId: "device-123",
          token: "guest-token",
        },
        phone: {
          phone: "13912345678",
          isoCode: "CN",
          countryCode: "86",
        },
        code: "123456",
      }),
    ).resolves.toEqual({
      memberId: "member-1",
      resToken: "user-token",
      newlyRegistered: false,
    });

    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/user-auth/verifyCode",
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/user-auth/login",
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/crm/customer/userinfo",
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      contactType: "PHONE",
      phone: {
        phone: "13912345678",
        isoCode: "CN",
        countryCode: "86",
        code: "123456",
      },
    });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      contactType: "PHONE",
      phone: {
        phone: "13912345678",
        isoCode: "CN",
        countryCode: "86",
        code: "123456",
      },
      resolveConflicts: false,
    });
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({
      cardProgramId: "card-program-1",
    });
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      token: "guest-token",
    });
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
      token: "guest-token",
    });
    expect(fetcher.mock.calls[2][1]?.headers).toMatchObject({
      token: "user-token",
    });
  });

  it("keeps the guest token when RES reports ordinary login success without rotating it", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ code: "000", data: { verificationId: "verified" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: {
            verifyToken: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: {
            customerId: "member-1",
            isMember: true,
          },
        }),
      );
    const client = new ResH5MemberAuthClient(config, fetcher);

    await expect(
      client.verifyLoginAndEnsureMember({
        session: {
          deviceId: "device-123",
          token: "guest-token",
        },
        phone: {
          phone: "13912345678",
          isoCode: "CN",
          countryCode: "86",
        },
        code: "123456",
      }),
    ).resolves.toEqual({
      memberId: "member-1",
      resToken: "guest-token",
      newlyRegistered: false,
    });
    expect(fetcher.mock.calls[2][1]?.headers).toMatchObject({
      token: "guest-token",
    });
  });

  // Production regression, 2026-07-31. Every brand-new phone number failed with
  // stage "register_rejected" while the one already-registered test account
  // sailed through, because register was only accepting "000". Real RES answers
  // register the same way it answers login: "CRM-00-0000" plus a rotated token.
  // The mock below is the exact envelope observed in the Vercel logs.
  it("accepts the CRM-00-0000 register envelope and reads the member back with the rotated token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: { verificationId: "verification-1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "CRM-00-0000",
          data: {
            authorizeInfo: { customer: true },
            token: "login-rotated-token",
            verifyToken: "register-proof",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: { customerId: null, isMember: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "CRM-00-0000",
          data: {
            authorizeInfo: { customer: true },
            token: "register-rotated-token",
            verifyToken: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: { customerId: 9002, isMember: true },
        }),
      );
    const client = new ResH5MemberAuthClient(config, fetcher);

    await expect(
      client.verifyLoginAndEnsureMember({
        session: { deviceId: "device-123", token: "guest-token" },
        phone: {
          phone: "1161234567",
          isoCode: "MY",
          countryCode: "60",
        },
        code: "451801",
      }),
    ).resolves.toEqual({
      memberId: "9002",
      resToken: "register-rotated-token",
      newlyRegistered: true,
    });

    // The read-back must use the token register just issued. Sending the
    // pre-registration token here is what made the member look absent and
    // turned a successful registration into a 503.
    expect(fetcher.mock.calls[4][1]?.headers).toMatchObject({
      token: "register-rotated-token",
    });
  });

  it("registers a verified non-member once and then requires member readback", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: { verificationId: "verification-1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "CRM-00-0000",
          data: {
            authorizeInfo: { customer: true },
            token: "user-token",
            verifyToken: "register-proof",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: { customerId: null, isMember: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: "000", data: { accepted: true } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: { customerId: 9001, isMember: true },
        }),
      );
    const client = new ResH5MemberAuthClient(config, fetcher);

    await expect(
      client.verifyLoginAndEnsureMember({
        session: {
          deviceId: "device-123",
          token: "guest-token",
        },
        phone: {
          phone: "13912345678",
          isoCode: "CN",
          countryCode: "86",
        },
        code: "123456",
      }),
    ).resolves.toEqual({
      memberId: "9001",
      resToken: "user-token",
      newlyRegistered: true,
    });

    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/user-auth/verifyCode",
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/user-auth/login",
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/crm/customer/userinfo",
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/user-auth/register",
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/crm/customer/userinfo",
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[3][1]?.body))).toEqual({
      subType: "phone",
      phone: "13912345678",
      countryCode: "86",
      isoCode: "CN",
      verifyToken: "register-proof",
      cardProgramId: "card-program-1",
    });
    expect(fetcher.mock.calls[3][1]?.headers).toMatchObject({
      token: "user-token",
    });
    expect(JSON.parse(String(fetcher.mock.calls[4][1]?.body))).toEqual({
      cardProgramId: "card-program-1",
    });
  });

  it("surfaces login conflicts without automatically resolving or retrying them", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: { verificationId: "verification-1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "CRM-00-2004",
          msg: "confirmation required",
          data: {
            token: "must-not-leak",
            conflicts: ["another-session"],
          },
        }),
      );
    const client = new ResH5MemberAuthClient(config, fetcher);

    const request = client.verifyLoginAndEnsureMember({
      session: {
        deviceId: "device-123",
        token: "guest-token",
      },
      phone: {
        phone: "13912345678",
        isoCode: "CN",
        countryCode: "86",
      },
      code: "123456",
    });

    await expect(request).rejects.toBeInstanceOf(
      ResH5LoginConflictError,
    );
    await expect(request).rejects.toMatchObject({
      code: "CRM-00-2004",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
      contactType: "PHONE",
      phone: {
        phone: "13912345678",
        isoCode: "CN",
        countryCode: "86",
        code: "123456",
      },
      resolveConflicts: false,
    });
  });

  it("retries only login with the original verified payload after conflict confirmation", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: "CRM-00-0000",
          data: {
            authorizeInfo: { customer: true },
            token: "user-token",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: {
            customerId: "member-1",
            isMember: true,
          },
        }),
      );
    const client = new ResH5MemberAuthClient(config, fetcher);

    await expect(
      client.loginAndEnsureMember({
        session: {
          deviceId: "device-123",
          token: "guest-token",
        },
        phone: {
          phone: "13912345678",
          isoCode: "CN",
          countryCode: "86",
        },
        code: "123456",
        resolveConflicts: true,
      }),
    ).resolves.toEqual({
      memberId: "member-1",
      resToken: "user-token",
      newlyRegistered: false,
    });

    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/user-auth/login",
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/api/crm/customer/userinfo",
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      contactType: "PHONE",
      phone: {
        phone: "13912345678",
        isoCode: "CN",
        countryCode: "86",
        code: "123456",
      },
      resolveConflicts: true,
    });
  });

  it.each(["12345", "1234567", "12a456", "１２３４５６"])(
    "rejects a verification code that is not exactly six ASCII digits: %s",
    async (code) => {
      const fetcher = vi.fn<typeof fetch>();
      const client = new ResH5MemberAuthClient(config, fetcher);

      await expect(
        client.verifyLoginAndEnsureMember({
          session: {
            deviceId: "device-123",
            token: "guest-token",
          },
          phone: {
            phone: "13912345678",
            isoCode: "CN",
            countryCode: "86",
          },
          code,
        }),
      ).rejects.toThrow("exactly six digits");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("distinguishes a rejected verification code from transport failure", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        code: "CRM-00-2001",
        msg: "sensitive upstream detail",
        data: {},
      }),
    );
    const client = new ResH5MemberAuthClient(config, fetcher);

    const request = client.verifyLoginAndEnsureMember({
      session: {
        deviceId: "device-123",
        token: "guest-token",
      },
      phone: {
        phone: "13912345678",
        isoCode: "CN",
        countryCode: "86",
      },
      code: "123456",
    });

    await expect(request).rejects.toBeInstanceOf(
      ResH5VerificationCodeError,
    );
    await expect(request).rejects.not.toThrow("sensitive upstream detail");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed external envelopes with a stable safe error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        code: "000",
        data: {
          authorizeInfo: { anonymous: true },
          token: { secret: "must-not-leak" },
        },
      }),
    );
    const client = new ResH5MemberAuthClient(config, fetcher);

    await expect(
      client.createGuestSession("device-123"),
    ).rejects.toThrow("RES H5 returned an invalid response.");
    await expect(
      client.createGuestSession("device-123"),
    ).rejects.not.toThrow("must-not-leak");
  });

  it("reports only safe response-shape diagnostics for a malformed login response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ code: "000", data: { verificationId: "verified" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "CRM-00-0000",
          data: {
            token: { secret: "must-not-leak" },
            memberToken: "must-not-leak-either",
            phone_99999999999: "must-not-leak",
          },
          msg: "sensitive upstream detail",
        }),
      );
    const client = new ResH5MemberAuthClient(config, fetcher);

    const request = client.verifyLoginAndEnsureMember({
      session: {
        deviceId: "device-123",
        token: "guest-token",
      },
      phone: {
        phone: "13912345678",
        isoCode: "CN",
        countryCode: "86",
      },
      code: "123456",
    });

    await expect(request).rejects.toMatchObject({
      stage: "login_response",
      providerCode: "CRM-00-0000",
      httpStatus: 200,
      topLevelKeys: ["code", "data", "msg"],
      dataKeys: ["memberToken", "token"],
      dataValueTypes: {
        memberToken: "string",
        token: "object",
      },
    });
    await expect(request).rejects.toBeInstanceOf(
      ResH5AuthDiagnosticError,
    );
    await expect(request).rejects.not.toThrow("must-not-leak");
    await expect(request).rejects.not.toThrow(
      "sensitive upstream detail",
    );
    await expect(request).rejects.not.toThrow("99999999999");
  });

  it("opens the card program for an authenticated customer without a verify token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ code: "000", data: { verificationId: "verified" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "CRM-00-0000",
          data: {
            authorizeInfo: { customer: true },
            token: "user-token",
            verifyToken: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: {
            customerId: "customer-1",
            isMember: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: "000", data: { accepted: true } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: {
            customerId: "customer-1",
            isMember: true,
          },
        }),
      );
    const client = new ResH5MemberAuthClient(config, fetcher);

    await expect(
      client.verifyLoginAndEnsureMember({
        session: {
          deviceId: "device-123",
          token: "guest-token",
        },
        phone: {
          phone: "13912345678",
          isoCode: "CN",
          countryCode: "86",
        },
        code: "123456",
      }),
    ).resolves.toEqual({
      memberId: "customer-1",
      resToken: "user-token",
      newlyRegistered: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(
      fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname),
    ).toEqual([
      "/api/user-auth/verifyCode",
      "/api/user-auth/login",
      "/api/crm/customer/userinfo",
      "/api/user-auth/register",
      "/api/crm/customer/userinfo",
    ]);
    expect(fetcher.mock.calls.map(([url]) => String(url))).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("/crm/coupon/couponCode/give"),
      ]),
    );
    expect(JSON.parse(String(fetcher.mock.calls[3][1]?.body))).toEqual({
      subType: "phone",
      phone: "13912345678",
      countryCode: "86",
      isoCode: "CN",
      cardProgramId: "card-program-1",
    });
  });

  it("fails closed when registration does not read back an active member ID", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: { verificationId: "verification-1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: {
            authorizeInfo: { customer: true },
            token: "user-token",
            verifyToken: "register-proof",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: { customerId: null, isMember: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: "000", data: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "000",
          data: { customerId: "", isMember: true },
        }),
      );
    const client = new ResH5MemberAuthClient(config, fetcher);

    await expect(
      client.verifyLoginAndEnsureMember({
        session: {
          deviceId: "device-123",
          token: "guest-token",
        },
        phone: {
          phone: "13912345678",
          isoCode: "CN",
          countryCode: "86",
        },
        code: "123456",
      }),
    ).rejects.toThrow("active member account");
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("does not leak bearer tokens when transport errors include them", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error("upstream exposed guest-token-do-not-leak"),
      );
    const client = new ResH5MemberAuthClient(config, fetcher);

    await expect(
      client.getCaptchaConfig({
        deviceId: "device-123",
        token: "guest-token-do-not-leak",
      }),
    ).rejects.toThrow("RES H5 request failed.");
    await expect(
      client.getCaptchaConfig({
        deviceId: "device-123",
        token: "guest-token-do-not-leak",
      }),
    ).rejects.not.toThrow("guest-token-do-not-leak");
  });
});
