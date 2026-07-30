/**
 * Narrow, server-side boundary for the RES member wallet.
 *
 * Implementations are responsible for strict response parsing. In particular,
 * the two resolution methods must reject unless they resolve exactly one
 * member and one enabled template respectively.
 */
export interface ResMember {
  id: string;
}

export interface ResCouponTemplate {
  id: string;
  name: string;
}

export interface UsableCoupon {
  id: string;
}

export interface UsableCouponQuery {
  member: ResMember;
  template: ResCouponTemplate;
}

export interface GiveCouponInput extends UsableCouponQuery {
  /**
   * The normalized E.164 phone is kept inside the server-only adapter boundary.
   * It must never be included in adapter errors or returned response objects.
   */
  phoneE164: string;
  quantity: 1;
}

export type GiveCouponResult =
  | { status: "accepted" }
  | { status: "rejected" }
  | { status: "ambiguous" };

export interface ResCouponAdapter {
  resolveMemberByPhone(phoneE164: string): Promise<ResMember>;
  resolveEnabledCouponTemplateByName(
    templateName: string,
  ): Promise<ResCouponTemplate>;
  listUsableMatchingCoupons(
    query: UsableCouponQuery,
  ): Promise<readonly UsableCoupon[]>;
  giveCoupon(input: GiveCouponInput): Promise<GiveCouponResult>;
}
