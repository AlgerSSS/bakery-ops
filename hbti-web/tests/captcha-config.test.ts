// RES 在 2026-08-04 于租户级打开了腾讯云验证码，`sendVerifyCode` 从此服务端强制
// 要求 captcha 参数，登录当场全挂。这组用例钉住那次的教训：**认不出的配置一律
// 当成「要验证码但我们驱动不了」**，绝不能退化成「不需要验证码」——后者会让前端
// 不加载 SDK，然后发码在 RES 那边失败，顾客看到的是一个点了没反应的按钮。

import { describe, expect, it } from "vitest";

import { toPublicConfig } from "@/lib/auth/captcha-config";

describe("toPublicConfig", () => {
  it("RES 关掉验证码时不要求任何供应商", () => {
    expect(toPublicConfig({ enable: false })).toEqual({
      enable: false,
      provider: null,
    });
  });

  it("腾讯云且带 appId 时给出可驱动的配置", () => {
    expect(
      toPublicConfig({
        enable: true,
        captchaType: "tencent_cloud",
        tencentCloud: { captchaAppId: "189993702" },
      }),
    ).toEqual({
      enable: true,
      provider: "tencent-cloud",
      appId: "189993702",
    });
  });

  // RES 线上回的就是字符串，但同一字段在别处出现过数字形态，别让类型漂移把
  // appId 变成 "[object Object]" 之类的东西传给 SDK。
  it("数字形态的 appId 归一成字符串", () => {
    expect(
      toPublicConfig({
        enable: true,
        captchaType: "tencent_cloud",
        tencentCloud: { captchaAppId: 189993702 },
      }),
    ).toMatchObject({ provider: "tencent-cloud", appId: "189993702" });
  });

  it.each([
    ["缺 appId", { enable: true, captchaType: "tencent_cloud" }],
    [
      "appId 为空串",
      {
        enable: true,
        captchaType: "tencent_cloud",
        tencentCloud: { captchaAppId: "" },
      },
    ],
    ["换成 geetest", { enable: true, captchaType: "geetest" }],
    ["没说是哪家", { enable: true }],
    ["供应商为 null", { enable: true, captchaType: null }],
  ])("%s 时报 unsupported，而不是当成不需要验证码", (_label, input) => {
    const result = toPublicConfig(input);
    expect(result.enable).toBe(true);
    expect(result.provider).toBe("unsupported");
    // 绝不能漏出一个 appId 让前端拿去初始化一个错的 SDK。
    expect(result.appId).toBeUndefined();
  });
});
