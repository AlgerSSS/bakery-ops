import { describe, expect, it } from "vitest";

import {
  deliveryModeGiftType,
  parseBirthdayDeliveryMode,
} from "@/lib/birthday/delivery-mode";

describe("生日页面分阶段入口", () => {
  it("只接受 card / cake / basque，未知值退回生日贺卡", () => {
    expect(parseBirthdayDeliveryMode(undefined)).toBe("card");
    expect(parseBirthdayDeliveryMode("card")).toBe("card");
    expect(parseBirthdayDeliveryMode("cake")).toBe("cake");
    expect(parseBirthdayDeliveryMode("basque")).toBe("basque");
    expect(parseBirthdayDeliveryMode(["cake", "basque"])).toBe("card");
    expect(parseBirthdayDeliveryMode("other")).toBe("card");
  });

  it("T-5 入口锁定积分定制蛋糕，T-2 入口锁定免费巴斯克", () => {
    expect(deliveryModeGiftType("card")).toBeUndefined();
    expect(deliveryModeGiftType("cake")).toBe("points_450");
    expect(deliveryModeGiftType("basque")).toBe("free_basque");
  });
});
