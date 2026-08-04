import { NextResponse } from "next/server";

import { readCaptchaConfig } from "@/lib/auth/captcha-config";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * 前端在挂载时问一次：这次登录要不要过图形验证码、用哪家。
 *
 * 单独开一个端点而不是塞进发码响应里，是因为顺序反了就没意义：SDK 要在顾客
 * 点「发送」之前就加载好，否则第一次点击会先卡住几百毫秒去拉脚本。
 *
 * 返回的内容全部是公开值（是否启用、供应商、腾讯云的客户端 appId）——RES 自己的
 * H5 也把它们明文放在前端，这里不存在泄露面。
 */
export async function GET(): Promise<NextResponse> {
  try {
    const config = await readCaptchaConfig();
    return NextResponse.json(config, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    // 探测失败时**不能**回「不需要验证码」——那会让前端不加载 SDK，然后发码在 RES
    // 那边以 missing captcha 失败，顾客看到的是一个点了没反应的按钮。
    // 报 unsupported，前端就会显示「登录暂不可用」这种能行动的提示。
    console.error("[auth/captcha] probe failed", error);
    return NextResponse.json(
      { enable: true, provider: "unsupported" },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
