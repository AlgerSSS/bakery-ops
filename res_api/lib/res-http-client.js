import { readVulcanTokenFromStorageState } from "./storage-state-token.js";

export function createResHttpClientFromEnv({ storageState = "storageState.json" } = {}) {
  const baseUrl = new URL(process.env.RES_BASE_URL || "https://bo.sea.restosuite.ai");
  if (baseUrl.origin !== "https://bo.sea.restosuite.ai" || baseUrl.pathname !== "/") {
    throw new Error("RES_BASE_URL must use the verified RES API origin.");
  }
  const required = {
    corporationId: process.env.RES_CORPORATION_ID || process.env.CRM_CORPORATION_ID,
    organizationId: process.env.RES_ORGANIZATION_ID,
    organizationType: process.env.RES_ORGANIZATION_TYPE,
    brandId: process.env.RES_BRAND_ID,
    shopId: process.env.RES_SHOP_ID || process.env.SHOP_ID,
    tenant: process.env.RES_TENANT,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !String(value ?? "").trim())
    .map(([key]) => key);
  if (missing.length) throw new Error(`Missing RES configuration: ${missing.join(", ")}.`);
  const token =
    process.env.RES_VULCAN_TOKEN?.trim() ||
    readVulcanTokenFromStorageState(storageState);
  if (token.length < 32) throw new Error("RES vulcan token is not usable.");

  return {
    async call(pathname, payload) {
      const response = await fetch(new URL(pathname, baseUrl), {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json,text/plain,*/*",
          "Content-Type": "application/json",
          "vulcan-token": token,
          "corporation-id": required.corporationId,
          "organization-id": required.organizationId,
          "organization-type": required.organizationType,
          "brand-id": required.brandId,
          "shop-id": required.shopId,
          "language-code": "en_US",
          "accept-timezone": "Asia/Kuala_Lumpur",
          Cookie: `i18next=en_US; tenant=${required.tenant}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      let body;
      try {
        body = await response.json();
      } catch {
        body = { code: null, msg: "invalid JSON" };
      }
      return { status: response.status, body };
    },
  };
}
