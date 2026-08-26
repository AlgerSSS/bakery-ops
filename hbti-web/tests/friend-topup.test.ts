import { describe, expect, it } from "vitest";

import { validateFriendTopupCandidates } from "@/lib/staff/friend-topup";

const rows = [
  {
    txn_id: "tx-1", store: "Pavilion", txn_at: "2026-08-26T08:00:00Z",
    member_id: "m-1", phone_e164: "+60111111111", trade_amount: "100",
  },
  {
    txn_id: "tx-2", store: "Pavilion", txn_at: "2026-08-26T08:20:00Z",
    member_id: "m-2", phone_e164: "+60222222222", trade_amount: "150",
  },
];

describe("friend top-up validation", () => {
  it("accepts one qualifying same-store top-up per distinct member", () => {
    expect(validateFriendTopupCandidates(rows, ["+60111111111", "+60222222222"]))
      .toHaveLength(2);
  });

  it("refuses to guess when one member has multiple recent top-ups", () => {
    expect(() => validateFriendTopupCandidates(
      [...rows, { ...rows[0], txn_id: "tx-3" }],
      ["+60111111111", "+60222222222"],
    )).toThrow("TOPUP_NOT_UNIQUE");
  });

  it("refuses different stores or transactions more than 30 minutes apart", () => {
    expect(() => validateFriendTopupCandidates(
      [rows[0], { ...rows[1], store: "Other" }],
      ["+60111111111", "+60222222222"],
    )).toThrow("STORE_MISMATCH");
    expect(() => validateFriendTopupCandidates(
      [rows[0], { ...rows[1], txn_at: "2026-08-26T08:31:00Z" }],
      ["+60111111111", "+60222222222"],
    )).toThrow("TOPUP_TIME_MISMATCH");
  });
});
