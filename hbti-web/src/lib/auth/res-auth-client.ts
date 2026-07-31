import { ResH5MemberAuthClient } from "@/lib/res/h5-member-auth";
import { readHbtiAuthConfig } from "@/lib/server-config";

export function createResH5MemberAuthClientFromEnv(): ResH5MemberAuthClient {
  const config = readHbtiAuthConfig();
  return new ResH5MemberAuthClient({
    baseUrl: config.h5BaseUrl,
    corporationId: config.corporationId,
    appId: config.appId,
    cardProgramId: config.cardProgramId,
  });
}
