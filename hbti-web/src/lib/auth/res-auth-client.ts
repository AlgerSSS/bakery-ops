import { ResH5MemberAuthClient } from "@/lib/res/h5-member-auth";
import { readHbtiAuthConfig } from "@/lib/server-config";

/**
 * @param deadlineSignal 可选的整体时限，串起本次请求里所有 RES 调用。发码要串行走
 *   三次，不给总时限的话最坏耗时会超过函数上限，也超过浏览器的放弃时间。
 */
export function createResH5MemberAuthClientFromEnv(
  deadlineSignal?: AbortSignal,
): ResH5MemberAuthClient {
  const config = readHbtiAuthConfig();
  return new ResH5MemberAuthClient(
    {
      baseUrl: config.h5BaseUrl,
      corporationId: config.corporationId,
      appId: config.appId,
      cardProgramId: config.cardProgramId,
    },
    fetch,
    deadlineSignal,
  );
}
