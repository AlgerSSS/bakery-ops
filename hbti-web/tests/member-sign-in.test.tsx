// 登录表单里三个会让顾客「收不到验证码」的坑，都在这里钉住。
//
// 背景：实测同一号码当天第二次及以后的验证码，RES 会回 "000" 却不真的送达
// （19 次请求精确关联：当日首次 11/13 到达，重复 0/6）。所以任何**诱导顾客重发**
// 的行为都是在把他们推向一条走不通的路，而不只是浪费一次请求。

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemberSignIn } from "@/components/MemberSignIn";
import { uiCopy } from "@/content/ui";

const copy = uiCopy.en;

function renderSignIn() {
  const headingRef = createRef<HTMLHeadingElement>();
  const onAuthenticated = vi.fn();
  render(
    <MemberSignIn
      copy={copy}
      locale="en"
      headingRef={headingRef}
      onAuthenticated={onAuthenticated}
    />,
  );
  return { onAuthenticated };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/**
 * 组件挂载时会先问一次 `/api/auth/captcha`（RES 是否要求图形验证码）。
 * 这些用例关心的是发码与验证调用，所以把探测就地应答掉、不转发给内层 mock ——
 * 否则它会吃掉 `mockResolvedValueOnce` 队列的第一项，也会污染调用计数。
 */
function stubFetch<T>(inner: T): T {
  const wrapped = (input: unknown, init?: unknown) => {
    if (String(input).includes("/api/auth/captcha")) {
      return Promise.resolve(jsonResponse({ enable: false, provider: null }));
    }
    return (inner as (a: unknown, b?: unknown) => unknown)(input, init);
  };
  vi.stubGlobal("fetch", wrapped);
  return inner;
}

/** 输入一个合法的马来西亚号码并发送。 */
async function sendCodeFor(
  user: ReturnType<typeof userEvent.setup>,
  national: string,
) {
  const input = screen.getByLabelText(copy.phoneLabel);
  await user.clear(input);
  await user.type(input, national);
  await user.click(screen.getByRole("button", { name: copy.sendCode }));
}

describe("MemberSignIn 的重发闸门", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("「换个号码」不再清掉冷却——号码没变就不能立刻再发", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        challengeToken: "challenge-1",
        maskedPhone: "+60 12*****89",
        resendMayNotArrive: false,
      }),
    );
    stubFetch(fetchMock);
    const user = userEvent.setup();
    renderSignIn();

    await sendCodeFor(user, "123456789");
    await screen.findByLabelText(copy.codeLabel);

    await user.click(screen.getByRole("button", { name: copy.changePhone }));

    // 回到发送表单，号码原样还在——发送键必须仍然锁着，显示倒计时。
    const sendButton = await screen.findByRole("button", {
      name: /Send a new code in/i,
    });
    expect(sendButton).toBeDisabled();
    await user.click(sendButton);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("真的换了号码，冷却才解除", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        challengeToken: "challenge-1",
        maskedPhone: "+60 12*****89",
        resendMayNotArrive: false,
      }),
    );
    stubFetch(fetchMock);
    const user = userEvent.setup();
    renderSignIn();

    await sendCodeFor(user, "123456789");
    await screen.findByLabelText(copy.codeLabel);
    await user.click(screen.getByRole("button", { name: copy.changePhone }));

    await sendCodeFor(user, "198765432");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("服务端说这个号今天发过了，就如实告诉顾客", async () => {
    stubFetch(
      vi.fn().mockResolvedValue(
        jsonResponse({
          challengeToken: "challenge-1",
          maskedPhone: "+60 12*****89",
          resendMayNotArrive: true,
        }),
      ),
    );
    const user = userEvent.setup();
    renderSignIn();

    await sendCodeFor(user, "123456789");

    expect(
      await screen.findByText(copy.authResendMayNotArrive),
    ).toBeInTheDocument();
  });

  it("超时说的是「可能已发出」，而不是让顾客再试一次", async () => {
    stubFetch(
      vi
        .fn()
        .mockRejectedValue(
          new DOMException("timed out", "TimeoutError"),
        ),
    );
    const user = userEvent.setup();
    renderSignIn();

    await sendCodeFor(user, "123456789");

    expect(await screen.findByText(copy.authSendTimeout)).toBeInTheDocument();
    expect(screen.getByText(copy.authMaybeSentNote)).toBeInTheDocument();
    // 不能说成「检查网络后再试」——那正好把顾客推去重发，而重发送不到。
    expect(
      screen.queryByText(copy.authNetworkError),
    ).not.toBeInTheDocument();
  });

  it("验证由浏览器超时中止时显示服务超时，而不是误报断网", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          challengeToken: "challenge-1",
          maskedPhone: "+60 12*****89",
          resendMayNotArrive: false,
        }),
      )
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    stubFetch(fetchMock);
    const user = userEvent.setup();
    renderSignIn();

    await sendCodeFor(user, "123456789");
    const codeInput = await screen.findByLabelText(copy.codeLabel);
    await user.type(codeInput, "123456");
    await user.click(screen.getByRole("button", { name: copy.verifyCode }));

    expect(await screen.findByText(copy.authVerifyTimeout)).toBeInTheDocument();
    expect(screen.queryByText(copy.authNetworkError)).not.toBeInTheDocument();
  });

  it("服务端验证故障不再伪装成验证码输入错误", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          challengeToken: "challenge-1",
          maskedPhone: "+60 12*****89",
          resendMayNotArrive: false,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "VERIFICATION_FAILED" }, 503));
    stubFetch(fetchMock);
    const user = userEvent.setup();
    renderSignIn();

    await sendCodeFor(user, "123456789");
    const codeInput = await screen.findByLabelText(copy.codeLabel);
    await user.type(codeInput, "123456");
    await user.click(screen.getByRole("button", { name: copy.verifyCode }));

    expect(await screen.findByText(copy.authNetworkError)).toBeInTheDocument();
    expect(screen.queryByText(copy.invalidCode)).not.toBeInTheDocument();
  });

  // 2026-08-04 真机复现：验证码解出来了、RES 也收下了，却回业务错误 CRM-00-1105
  // 拒绝发码。前端把它落进 default 分支显示「请检查网络」——顾客的网络毫无问题，
  // 那句话只会让人反复重试同一条走不通的路。
  it("RES 拒绝发码时说的是短信没发出去，不是「检查网络」", async () => {
    stubFetch(
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "SERVICE_UNAVAILABLE" }, 503)),
    );
    const user = userEvent.setup();
    renderSignIn();

    await sendCodeFor(user, "123456789");

    expect(await screen.findByText(copy.authSendRejected)).toBeInTheDocument();
    expect(screen.queryByText(copy.authNetworkError)).not.toBeInTheDocument();
  });

  // 同理：CAPTCHA_UNSUPPORTED 是新增的码，漏掉映射就又会掉回「检查网络」。
  it("验证码供应商不支持时说的是验证暂不可用", async () => {
    stubFetch(
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: "CAPTCHA_UNSUPPORTED" }, 503)),
    );
    const user = userEvent.setup();
    renderSignIn();

    await sendCodeFor(user, "123456789");

    expect(await screen.findByText(copy.captchaRequired)).toBeInTheDocument();
    expect(screen.queryByText(copy.authNetworkError)).not.toBeInTheDocument();
  });

  it("真的断网了才说网络问题", async () => {
    stubFetch(
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    const user = userEvent.setup();
    renderSignIn();

    await sendCodeFor(user, "123456789");

    expect(await screen.findByText(copy.authNetworkError)).toBeInTheDocument();
    expect(
      screen.queryByText(copy.authSendTimeout),
    ).not.toBeInTheDocument();
  });
});
