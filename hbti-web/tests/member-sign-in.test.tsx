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
    vi.stubGlobal("fetch", fetchMock);
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
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderSignIn();

    await sendCodeFor(user, "123456789");
    await screen.findByLabelText(copy.codeLabel);
    await user.click(screen.getByRole("button", { name: copy.changePhone }));

    await sendCodeFor(user, "198765432");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("服务端说这个号今天发过了，就如实告诉顾客", async () => {
    vi.stubGlobal(
      "fetch",
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
    vi.stubGlobal(
      "fetch",
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

  it("真的断网了才说网络问题", async () => {
    vi.stubGlobal(
      "fetch",
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
