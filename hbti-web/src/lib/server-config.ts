export interface HbtiServerConfig {
  campaignVersion: string;
  couponTemplateName: string;
  linkBaseUrl: string;
  memberWalletUrl: string;
}

export interface HbtiAuthConfig {
  authSecret: string;
  h5BaseUrl: string;
  corporationId: string;
  appId: string;
  cardProgramId: string;
}

export function readHbtiServerConfig(): HbtiServerConfig {
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
    linkBaseUrl: linkBaseUrl.origin,
    memberWalletUrl: memberWalletUrl.toString(),
  };
}

export function readHbtiAuthConfig(): HbtiAuthConfig {
  const authSecret = requireEnvironmentVariable("HBTI_AUTH_SECRET");
  if (new TextEncoder().encode(authSecret).byteLength < 32) {
    throw new Error("HBTI_AUTH_SECRET must contain at least 32 bytes.");
  }

  const h5BaseUrl = new URL(
    process.env.RES_H5_BASE_URL?.trim() ??
      "https://f4klzbmr9n2d.m.sea.restosuite.ai",
  );
  if (
    h5BaseUrl.origin !==
      "https://f4klzbmr9n2d.m.sea.restosuite.ai" ||
    h5BaseUrl.pathname !== "/" ||
    h5BaseUrl.search ||
    h5BaseUrl.hash
  ) {
    throw new Error("RES_H5_BASE_URL must use the verified RES H5 origin.");
  }

  return {
    authSecret,
    h5BaseUrl: h5BaseUrl.origin,
    corporationId: requireEnvironmentVariable(
      "RES_H5_CORPORATION_ID",
    ),
    appId: requireEnvironmentVariable("RES_H5_APP_ID"),
    cardProgramId: requireEnvironmentVariable(
      "RES_H5_CARD_PROGRAM_ID",
    ),
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
