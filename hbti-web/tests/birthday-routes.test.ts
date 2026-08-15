import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signBirthdayLinkToken } from "@/lib/birthday/link-token";

/**
 * 生日贺卡 API 的路由级测试：真实签名令牌 + 真实资格规则，
 * 只把数据库这一层 mock 掉（按 SQL 文本分发到固定行）。
 */

const SECRET = "route-test-secret-with-at-least-32-bytes";

const sqlState = vi.hoisted(() => ({
  handler: null as null | ((text: string) => Promise<unknown[]>),
}));

vi.mock("@/lib/db/postgres", () => ({
  getDb: () => {
    const sql = (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (!sqlState.handler) return Promise.resolve([]);
      return sqlState.handler(text);
    };
    return sql;
  },
}));

vi.mock("@/lib/server-config", () => ({
  readHbtiServerConfig: () => ({
    linkBaseUrl: "https://birthday.test",
  }),
}));

import { GET } from "@/app/api/birthday/view/route";
import { POST as reservePOST } from "@/app/api/birthday/reserve/route";
import { POST as profilePOST } from "@/app/api/birthday/profile/route";

function linkFor(memberId: string, ttlSeconds = 86400): string {
  return signBirthdayLinkToken(
    { mid: memberId, exp: Math.floor(Date.now() / 1000) + ttlSeconds },
    SECRET,
  );
}

const MEMBER = "2063178969381101576";

const BASICS_ROW = {
  member_id: MEMBER,
  level_name: "VIP1",
  point_balance: 120,
  registered_on: "2025-11-03",
  phone_e164: "+60123456789",
};

function viewRequest(token?: string): Request {
  const url = "https://birthday.test/api/birthday/view" + (token ? "?t=" + token : "");
  return new Request(url);
}

function postJson(url: string, body: unknown): Request {
  return new Request("https://birthday.test" + url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://birthday.test",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("BIRTHDAY_LINK_SECRET", SECRET);
  vi.stubEnv("BIRTHDAY_CAMPAIGN_YEAR", "2026");
  vi.stubEnv("BIRTHDAY_PICKUP_LEAD_DAYS", "2");
  vi.stubEnv("BIRTHDAY_PICKUP_WINDOW_DAYS", "30");
  vi.stubEnv("BIRTHDAY_NOTIFY_WEBHOOK", "");
  sqlState.handler = (text) => {
    if (text.includes("INSERT INTO public.mkt_birthday_reservation")) {
      return Promise.resolve([{
        reservation_id: 42, gift_type: "free_basque", for_whom: "self",
        recipient_note: null, pickup_date: "2026-08-20", slot: "noon",
        member_note: null, status: "reserved", created_at: "2026-08-15T04:00:00.000Z",
      }]);
    }
    if (text.includes("UPDATE public.mkt_birthday_reservation")) return Promise.resolve([]);
    if (text.includes("FROM public.mkt_birthday_reservation")) return Promise.resolve([]);
    if (text.includes("mkt_birthday_profile")) return Promise.resolve([]);
    if (text.includes("COUNT(DISTINCT order_id)")) {
      return Promise.resolve([{ total_qty: "12", total_net: "345.6", order_count: 5, distinct_products: 4, active_months: 2 }]);
    }
    if (text.includes("JOIN public.pos_product")) {
      return Promise.resolve([{ name_zh: "趁热心动蛋挞", name_en: "Hot Crush Egg Tart", category_zh: "烘焙", qty: "8", net_sales: "200.1" }]);
    }
    if (text.includes("GROUP BY 1")) {
      return Promise.resolve([{ month: "2026-08", net_sales: "345.6", visits: 5 }]);
    }
    // 注意顺序：pos_member_order_item 包含 pos_member 子串，统计查询必须先于它匹配。
    if (text.includes("FROM public.pos_member")) return Promise.resolve([BASICS_ROW]);
    return Promise.resolve([]);
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  sqlState.handler = null;
});

describe("GET /api/birthday/view", () => {
  it("签名链接直接进入：返回会员信息、年度回顾与权益", async () => {
    const res = await GET(viewRequest(linkFor(MEMBER)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.via).toBe("link");
    expect(body.member.levelName).toBe("VIP1");
    expect(body.member.pointBalance).toBe(120);
    expect(body.maskedPhone).toBe("**** 6789");
    expect(body.options.map((o: { giftType: string }) => o.giftType)).toEqual([
      "free_basque",
      "points_450",
    ]);
    expect(body.options[0].available).toBe(true);
    // 余额 120 < 450：积分选项展示但不可选
    expect(body.options[1].available).toBe(false);
    expect(body.options[1].deniedReason).toBe("INSUFFICIENT_POINTS");
    expect(body.stats.totalQty).toBe(12);
    expect(body.stats.favorite.nameZh).toBe("趁热心动蛋挞");
    expect(body.reservations).toEqual([]);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("无身份 → 401 LOGIN_REQUIRED", async () => {
    const res = await GET(viewRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("LOGIN_REQUIRED");
  });

  it("过期链接 → 410 LINK_EXPIRED", async () => {
    const res = await GET(viewRequest(linkFor(MEMBER, -10)));
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe("LINK_EXPIRED");
  });

  it("篡改链接 → 401 LINK_INVALID", async () => {
    const token = linkFor(MEMBER);
    const res = await GET(viewRequest(token.slice(0, -2) + "zz"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("LINK_INVALID");
  });
});

describe("POST /api/birthday/profile", () => {
  it("保存资料并按 member 幂等", async () => {
    const res = await profilePOST(postJson("/api/birthday/profile", {
      linkToken: linkFor(MEMBER),
      birthdayMonth: 6, birthdayDay: 15, allergies: "坚果", preferences: null,
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).saved).toBe(true);
  });

  it("月日必须成对出现", async () => {
    const res = await profilePOST(postJson("/api/birthday/profile", {
      linkToken: linkFor(MEMBER), birthdayMonth: 6, birthdayDay: null,
      allergies: null, preferences: null,
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_DATE");
  });

  it("无身份 → 401", async () => {
    const res = await profilePOST(postJson("/api/birthday/profile", {
      birthdayMonth: 6, birthdayDay: 15, allergies: null, preferences: null,
    }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/birthday/reserve", () => {
  function validPickupDate(): string {
    const d = new Date(Date.now() + 5 * 86400000);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  }

  it("免费巴斯克预约成功，webhook 未配置时通知保持 pending（服务器 relay 收编）", async () => {
    const res = await reservePOST(postJson("/api/birthday/reserve", {
      linkToken: linkFor(MEMBER), forWhom: "self", giftType: "free_basque",
      pickupDate: validPickupDate(), slot: "noon",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reserved).toBe(true);
    expect(body.reservation.reservationId).toBe(42);
    expect(body.notified).toBe("pending");
  });

  it("积分够 450 时可选积分兑换", async () => {
    const base = sqlState.handler;
    sqlState.handler = (text) => {
      if (text.includes("FROM public.pos_member")) {
        return Promise.resolve([{ ...BASICS_ROW, point_balance: 500 }]);
      }
      if (text.includes("INSERT INTO public.mkt_birthday_reservation")) {
        return Promise.resolve([{
          reservation_id: 43, gift_type: "points_450", for_whom: "self",
          recipient_note: null, pickup_date: "2026-08-20", slot: "night",
          member_note: null, status: "reserved", created_at: "2026-08-15T04:00:00.000Z",
        }]);
      }
      return base!(text);
    };
    const res = await reservePOST(postJson("/api/birthday/reserve", {
      linkToken: linkFor(MEMBER), forWhom: "self", giftType: "points_450",
      pickupDate: validPickupDate(), slot: "night",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reservation.giftType).toBe("points_450");
    expect(body.notified).toBe("pending");
  });

  it("积分不足选积分兑换 → 403", async () => {
    const res = await reservePOST(postJson("/api/birthday/reserve", {
      linkToken: linkFor(MEMBER), forWhom: "self", giftType: "points_450",
      pickupDate: validPickupDate(), slot: "noon",
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("INSUFFICIENT_POINTS");
  });

  it("取货日期超出窗口 → 400", async () => {
    const res = await reservePOST(postJson("/api/birthday/reserve", {
      linkToken: linkFor(MEMBER), forWhom: "self", giftType: "free_basque",
      pickupDate: "2020-01-01", slot: "noon",
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("PICKUP_DATE_OUT_OF_RANGE");
  });

  it("VIP1（默认权益）不能送亲友 → 409", async () => {
    const res = await reservePOST(postJson("/api/birthday/reserve", {
      linkToken: linkFor(MEMBER), forWhom: "gift", giftType: "free_basque",
      recipientNote: "妈妈",
      pickupDate: validPickupDate(), slot: "night",
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("GIFT_NOT_ALLOWED");
  });

  it("已领过免费巴斯克 → 409", async () => {
    const base = sqlState.handler;
    sqlState.handler = (text) => {
      if (text.includes("FROM public.mkt_birthday_reservation")) {
        return Promise.resolve([{
          reservation_id: 1, gift_type: "free_basque", for_whom: "self",
          recipient_note: null, pickup_date: "2026-08-01", slot: "noon",
          member_note: null, status: "reserved", created_at: "2026-08-01T00:00:00.000Z",
        }]);
      }
      return base!(text);
    };
    const res = await reservePOST(postJson("/api/birthday/reserve", {
      linkToken: linkFor(MEMBER), forWhom: "self", giftType: "free_basque",
      pickupDate: validPickupDate(), slot: "noon",
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("FREE_BASQUE_ALREADY_CLAIMED");
  });

  it("缺 Origin 头的跨源提交被拒绝", async () => {
    const req = new Request("https://birthday.test/api/birthday/reserve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ forWhom: "self", giftType: "free_basque", pickupDate: validPickupDate(), slot: "noon" }),
    });
    const res = await reservePOST(req);
    expect(res.status).toBe(403);
  });
});
