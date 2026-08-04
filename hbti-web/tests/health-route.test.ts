import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  hasAlertDestination: vi.fn(),
  checkCompletionStoreFromEnv: vi.fn(),
  createResApiClientFromEnv: vi.fn(),
  readHbtiServerConfig: vi.fn(),
  resolveEnabledCouponTemplateByName: vi.fn(),
}));

vi.mock("@/lib/alert", () => ({
  hasAlertDestination: routeMocks.hasAlertDestination,
}));

vi.mock("@/lib/store/pg-completion-store", () => ({
  checkCompletionStoreFromEnv: routeMocks.checkCompletionStoreFromEnv,
}));

vi.mock("@/lib/res/client", () => ({
  createResApiClientFromEnv: routeMocks.createResApiClientFromEnv,
}));

vi.mock("@/lib/server-config", () => ({
  readHbtiServerConfig: routeMocks.readHbtiServerConfig,
}));

describe("health route", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    for (const m of Object.values(routeMocks)) m.mockReset();
    routeMocks.hasAlertDestination.mockReturnValue(true);
    routeMocks.readHbtiServerConfig.mockReturnValue({
      couponTemplateName: "Pistachio Green Jewel",
    });
    routeMocks.createResApiClientFromEnv.mockReturnValue({
      resolveEnabledCouponTemplateByName:
        routeMocks.resolveEnabledCouponTemplateByName,
    });
    routeMocks.checkCompletionStoreFromEnv.mockResolvedValue(undefined);
    routeMocks.resolveEnabledCouponTemplateByName.mockResolvedValue({
      id: "tpl-1",
    });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // 例外:静态导入在这里不成立。路由模块在模块作用域里持有一个 60 秒的
  // RES 就绪缓存(resReadiness),静态导入会让所有用例共用同一份缓存 ——
  // 「RES 失败」跑完之后,「RES 正常」会读到上一条的失败 promise。
  // 所以每个用例必须配合 vi.resetModules() 重新加载模块。
  const load = async () => (await import("@/app/api/health/route")).GET;

  it("reports both checks green", async () => {
    const GET = await load();
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "hbti-web",
      checks: { alert: "ok", db: "ok", res: "ok" },
    });
  });

  it("fails readiness when the operational alert destination is missing", async () => {
    routeMocks.hasAlertDestination.mockReturnValue(false);
    const GET = await load();
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      service: "hbti-web",
      checks: { alert: "fail", db: "ok", res: "ok" },
    });
  });

  // 这条是这次改动的全部意义:两次发券中断时线上只有「503 (no message)」,
  // 分不清是数据库还是 RES,定位花了很久。
  it("names RES as the failing half and still runs the db check", async () => {
    routeMocks.resolveEnabledCouponTemplateByName.mockRejectedValue(
      new Error("RES request failed."),
    );
    const GET = await load();
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      service: "hbti-web",
      checks: { alert: "ok", db: "ok", res: "fail" },
    });
    // allSettled 的价值:RES 先炸也不能让 db 检查被跳过,
    // 否则「db 正常」这个结论就是没根据的。
    expect(routeMocks.checkCompletionStoreFromEnv).toHaveBeenCalledTimes(1);
  });

  it("names the database as the failing half and still probes RES", async () => {
    routeMocks.checkCompletionStoreFromEnv.mockRejectedValue(
      new Error("connection refused"),
    );
    const GET = await load();
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      service: "hbti-web",
      checks: { alert: "ok", db: "fail", res: "ok" },
    });
    expect(routeMocks.resolveEnabledCouponTemplateByName).toHaveBeenCalledTimes(
      1,
    );
  });

  it("reports both halves down without either masking the other", async () => {
    routeMocks.checkCompletionStoreFromEnv.mockRejectedValue(
      new Error("connection refused"),
    );
    routeMocks.resolveEnabledCouponTemplateByName.mockRejectedValue(
      new Error("RES request failed."),
    );
    const GET = await load();
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      service: "hbti-web",
      checks: { alert: "ok", db: "fail", res: "fail" },
    });
  });

  it("separates missing configuration from dependency failure", async () => {
    routeMocks.readHbtiServerConfig.mockImplementation(() => {
      throw new Error("missing RES_TENANT");
    });
    const GET = await load();
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      service: "hbti-web",
      checks: { config: "fail" },
    });
    // 配置炸了就不该再去打依赖 —— 那只会掩盖真正的原因。
    expect(routeMocks.checkCompletionStoreFromEnv).not.toHaveBeenCalled();
  });

  it("keeps upstream detail out of the public body but logs it server-side", async () => {
    routeMocks.resolveEnabledCouponTemplateByName.mockRejectedValue(
      new Error("401 unauthorized at https://bo.sea.restosuite.ai secret=abc"),
    );
    const GET = await load();
    const response = await GET();
    const body = JSON.stringify(await response.json());

    // 这个端点无鉴权:异常里可能带上游 URL 或凭证片段,绝不能回显。
    expect(body).not.toContain("restosuite");
    expect(body).not.toContain("secret");
    expect(body).not.toContain("401");
    expect(consoleError).toHaveBeenCalledWith(
      "[health] RES access failed",
      expect.any(Error),
    );
  });
});
