export interface HbtiServerConfig {
  campaignVersion: string;
  couponTemplateName: string;
  linkSecret: string;
  linkBaseUrl: string;
  memberHashSecret: Uint8Array;
  memberWalletUrl: string;
}

export function readHbtiServerConfig(): HbtiServerConfig {
  const linkSecret = requireEnvironmentVariable("HBTI_LINK_SECRET");
  if (new TextEncoder().encode(linkSecret).byteLength < 32) {
    throw new Error("HBTI_LINK_SECRET must contain at least 32 bytes.");
  }
  const memberHashSecret = requireEnvironmentVariable(
    "HBTI_MEMBER_HASH_SECRET",
  );
  if (new TextEncoder().encode(memberHashSecret).byteLength < 32) {
    throw new Error("HBTI_MEMBER_HASH_SECRET must contain at least 32 bytes.");
  }
  if (memberHashSecret === linkSecret) {
    throw new Error(
      "HBTI_MEMBER_HASH_SECRET must be independent from HBTI_LINK_SECRET.",
    );
  }

  const memberWalletUrl = new URL(
    requireEnvironmentVariable("RES_MEMBER_WALLET_URL"),
  );
  if (
    memberWalletUrl.protocol !== "https:" ||
    memberWalletUrl.hostname !== "f4klzbmr9n2d.m.sea.restosuite.ai"
  ) {
    throw new Error("RES_MEMBER_WALLET_URL must use the verified RES H5 host.");
  }

  const linkBaseUrl = new URL(
    requireEnvironmentVariable("HBTI_LINK_BASE_URL"),
  );
  if (linkBaseUrl.protocol !== "https:") {
    throw new Error("HBTI_LINK_BASE_URL must use HTTPS.");
  }

  return {
    campaignVersion: requireEnvironmentVariable("HBTI_CAMPAIGN_VERSION"),
    couponTemplateName: requireEnvironmentVariable(
      "RES_COUPON_TEMPLATE_NAME",
    ),
    linkSecret,
    linkBaseUrl: linkBaseUrl.origin,
    memberHashSecret: new TextEncoder().encode(memberHashSecret),
    memberWalletUrl: memberWalletUrl.toString(),
  };
}

export function isTrustedRequestOrigin(
  request: Request,
  expectedOrigin: string,
): boolean {
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  const origin = request.headers.get("origin");

  if (requestOrigin === expectedOrigin) {
    return origin === null || origin === expectedOrigin;
  }
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  try {
    const requestUrl = new URL(requestOrigin);
    const isLocalRequest =
      (requestUrl.hostname === "localhost" ||
        requestUrl.hostname === "127.0.0.1") &&
      (requestUrl.protocol === "http:" || requestUrl.protocol === "https:");
    return isLocalRequest && (origin === null || origin === requestOrigin);
  } catch {
    return false;
  }
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
