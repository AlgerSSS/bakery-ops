// Lark 内部通知通道（lark-messenger）单测：token 缓存 / open_id 解析优先级 / 发送失败路径
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { sendLarkText, resolveLarkOpenId } from "../../modules/channel/lark/lark-messenger";

const tokenResponse = { code: 0, msg: "ok", tenant_access_token: "t-123", expire: 7200 };
const resolveResponse = {
  code: 0,
  data: { user_list: [{ mobile: "+60175439502", user_id: "ou_abc" }] },
};
const sendOk = { code: 0, msg: "success", data: {} };

function mockJson(body: unknown) {
  return { json: async () => body } as Response;
}

describe("lark-messenger", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.LARK_APP_ID = "cli_test";
    process.env.LARK_APP_SECRET = "secret_test";
    process.env.LARK_USER_MAP = "{}";
  });

  afterEach(() => {
    delete process.env.LARK_USER_MAP;
  });

  it("LARK_USER_MAP 映射优先，不调 contact API", async () => {
    process.env.LARK_USER_MAP = JSON.stringify({ "61431029692": "ou_mapped" });
    const id = await resolveLarkOpenId("61431029692@c.us");
    expect(id).toBe("ou_mapped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("动态解析成功并缓存：同号第二次不再调 contact API", async () => {
    fetchMock
      .mockResolvedValueOnce(mockJson(tokenResponse))
      .mockResolvedValueOnce(mockJson(resolveResponse));
    const first = await resolveLarkOpenId("60175439502");
    expect(first).toBe("ou_abc");
    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await resolveLarkOpenId("60175439502");
    expect(second).toBe("ou_abc");
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("解析不到 open_id 时 sendLarkText 返回 false（触发上层回落）", async () => {
    fetchMock
      .mockResolvedValueOnce(mockJson(tokenResponse))
      .mockResolvedValueOnce(mockJson({ code: 0, data: { user_list: [{ mobile: "+8616606376419" }] } }));
    expect(await sendLarkText("8616606376419", "hi")).toBe(false);
  });

  it("发送成功返回 true；im 接口收到 open_id 与文本", async () => {
    process.env.LARK_USER_MAP = JSON.stringify({ "60175439502": "ou_abc" });
    fetchMock
      .mockResolvedValueOnce(mockJson(tokenResponse))
      .mockResolvedValueOnce(mockJson(sendOk));
    expect(await sendLarkText("60175439502", "早报内容")).toBe(true);
    const sendCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/im/v1/messages"));
    expect(sendCall).toBeTruthy();
    const body = JSON.parse((sendCall![1] as RequestInit).body as string);
    expect(body.receive_id).toBe("ou_abc");
    expect(JSON.parse(body.content).text).toBe("早报内容");
  });

  it("im 接口返回错误码时返回 false，不抛出", async () => {
    process.env.LARK_USER_MAP = JSON.stringify({ "60175439502": "ou_abc" });
    fetchMock
      .mockResolvedValueOnce(mockJson({ code: 99991672, msg: "no permission" }));
    expect(await sendLarkText("60175439502", "hi")).toBe(false);
  });

  it("凭据缺失时安静返回 false", async () => {
    delete process.env.LARK_APP_ID;
    // 用未缓存的新号码，避免命中 open_id 缓存
    expect(await sendLarkText("60000000001", "hi")).toBe(false);
    process.env.LARK_APP_ID = "cli_test";
  });
});
