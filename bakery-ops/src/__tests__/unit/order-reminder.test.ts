// F8: 订货漏报提醒的"该不该发/幂等" + supply_order 照上次订（IMPROVEMENT-PLAN.md F8）
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const executeMock = vi.fn();
vi.mock("@/modules/shared/db/postgres", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  execute: (...args: unknown[]) => executeMock(...args),
}));

const sendTextToMock = vi.fn();
const isClientConnectedMock = vi.fn();
vi.mock("@/modules/channel/whatsapp/whatsapp.client", () => ({
  isClientConnected: (...args: unknown[]) => isClientConnectedMock(...args),
  sendTextTo: (...args: unknown[]) => sendTextToMock(...args),
}));

const getAllUsersMock = vi.fn();
vi.mock("@/modules/data/repositories/user.repository", () => ({
  userRepository: { getAll: (...args: unknown[]) => getAllUsersMock(...args) },
}));

const getTodayOrderMock = vi.fn();
const getRecentOrdersMock = vi.fn();
const createMock = vi.fn();
const appendItemsMock = vi.fn();
vi.mock("@/modules/data/repositories/supply-order.repository", () => ({
  supplyOrderRepository: {
    getTodayOrder: (...args: unknown[]) => getTodayOrderMock(...args),
    getRecentOrders: (...args: unknown[]) => getRecentOrdersMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    appendItems: (...args: unknown[]) => appendItemsMock(...args),
  },
}));

import { runOrderReminder, buildOrderReminderText } from "../../modules/domain/supplychain/order-reminder.service";
import { SupplyOrderSkillHandler } from "../../modules/skills/supply-order/supply-order.definition";

const SENT_ORDER = {
  id: "order-sent",
  order_date: "2026-06-30",
  store_id: "default",
  status: "sent",
  items: [
    { name: "面粉", quantity: 50, unit: "kg" },
    { name: "糖", quantity: 20, unit: "kg" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OWNER_WHATSAPP = "60000000000@c.us";
  isClientConnectedMock.mockResolvedValue(true);
  sendTextToMock.mockResolvedValue({ ok: true, messageId: "m1" });
  getAllUsersMock.mockResolvedValue([{ role: "store_manager", phone: "60111111111@c.us" }]);
  queryMock.mockResolvedValue([]); // hasPushLog -> false
  getTodayOrderMock.mockResolvedValue(null);
  getRecentOrdersMock.mockResolvedValue([SENT_ORDER]);
  createMock.mockResolvedValue({ id: "order-new" });
  appendItemsMock.mockResolvedValue(true);
});

describe("runOrderReminder 该不该发", () => {
  it("今日无订单 -> 推店长并附上次已发订单清单", async () => {
    await runOrderReminder();
    expect(sendTextToMock).toHaveBeenCalledTimes(1);
    const [recipient, text] = sendTextToMock.mock.calls[0];
    expect(recipient).toBe("60111111111@c.us");
    expect(text).toContain("今天还没报订货");
    expect(text).toContain("面粉: 50kg");
    expect(text).toContain("照上次订");
    // 发送成功 -> 写幂等日志
    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO daily_push_log"),
      ["order_reminder", "60111111111@c.us", expect.any(String)],
    );
  });

  it("今日已有订货记录 -> 不发", async () => {
    getTodayOrderMock.mockResolvedValue({ id: "order-today" });
    await runOrderReminder();
    expect(sendTextToMock).not.toHaveBeenCalled();
  });

  it("当天已推过（幂等日志命中）-> 不重发", async () => {
    queryMock.mockResolvedValue([{ id: 1 }]); // hasPushLog -> true
    await runOrderReminder();
    expect(sendTextToMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("WhatsApp 未连接 -> 安全跳过", async () => {
    isClientConnectedMock.mockResolvedValue(false);
    await runOrderReminder();
    expect(sendTextToMock).not.toHaveBeenCalled();
  });

  it("无 store_manager -> 兜底发老板", async () => {
    getAllUsersMock.mockResolvedValue([]);
    await runOrderReminder();
    expect(sendTextToMock).toHaveBeenCalledWith("60000000000@c.us", expect.any(String));
  });

  it("无已发历史订单 -> 仍提醒，但不附清单", async () => {
    getRecentOrdersMock.mockResolvedValue([{ ...SENT_ORDER, status: "draft" }]);
    await runOrderReminder();
    expect(sendTextToMock).toHaveBeenCalledTimes(1);
    const [, text] = sendTextToMock.mock.calls[0];
    expect(text).toContain("今天还没报订货");
    expect(text).not.toContain("上次订单");
  });

  it("发送失败 -> 不写幂等日志（下次可重试）", async () => {
    sendTextToMock.mockResolvedValue({ ok: false, error: "boom" });
    await runOrderReminder();
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("buildOrderReminderText 模板", () => {
  it("有上次订单时列清单", () => {
    const text = buildOrderReminderText(SENT_ORDER as never);
    expect(text).toContain("上次订单（2026-06-30）");
    expect(text).toContain("糖: 20kg");
  });

  it("无上次订单时只有提醒行", () => {
    const text = buildOrderReminderText(null);
    expect(text).toContain("今天还没报订货");
    expect(text).not.toContain("上次订单");
  });
});

describe("supply_order 照上次订", () => {
  const run = (text: string) =>
    new SupplyOrderSkillHandler().execute({ input: { text }, userId: "user-1" } as never);

  it("无今日订单 -> 复制上次 sent 订单 items 新建 draft", async () => {
    const r = await run("照上次订");
    expect(r.status).toBe("success");
    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0];
    expect(arg.status).toBe("draft");
    expect(arg.items).toEqual([
      { name: "面粉", quantity: 50, unit: "kg", reportedBy: "user-1" },
      { name: "糖", quantity: 20, unit: "kg", reportedBy: "user-1" },
    ]);
    expect(appendItemsMock).not.toHaveBeenCalled();
    expect(r.summary).toContain("面粉: 50kg");
    expect(r.summary).toContain("发给供应商");
  });

  it("已有今日订单 -> 追加 items 而非新建", async () => {
    getTodayOrderMock.mockResolvedValue({ id: "order-today" });
    const r = await run("按上次订");
    expect(r.status).toBe("success");
    expect(createMock).not.toHaveBeenCalled();
    expect(appendItemsMock).toHaveBeenCalledWith(
      "order-today",
      [
        { name: "面粉", quantity: 50, unit: "kg" },
        { name: "糖", quantity: 20, unit: "kg" },
      ],
      "user-1",
    );
  });

  it("跳过非 sent 订单，取最近一张 sent", async () => {
    getRecentOrdersMock.mockResolvedValue([
      { ...SENT_ORDER, id: "order-draft", status: "draft", items: [{ name: "牛奶", quantity: 10, unit: "升" }] },
      SENT_ORDER,
    ]);
    const r = await run("照上次订");
    expect(r.status).toBe("success");
    expect(r.summary).toContain("面粉: 50kg");
    expect(r.summary).not.toContain("牛奶");
  });

  it("无 sent 历史 -> 报错提示", async () => {
    getRecentOrdersMock.mockResolvedValue([{ ...SENT_ORDER, status: "draft" }]);
    const r = await run("照上次订");
    expect(r.status).toBe("error");
    expect(r.summary).toContain("没有找到已发出的历史订单");
    expect(createMock).not.toHaveBeenCalled();
  });
});
