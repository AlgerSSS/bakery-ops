import { ResH5MemberAuthClient } from "@/lib/res/h5-member-auth";
import { readHbtiAuthConfig } from "@/lib/server-config";

/**
 * @param deadlineSignal 可选的整体时限，串起本次请求里所有 RES 调用。调用方一次请求
 *   只建一个 AbortSignal.timeout，客户端把每次调用自己的 12 秒上限和它取先到者，
 *   所以串行调用越往后能用的剩余时间越少——这是总预算，不是每次调用各算各的。
 *   发码要串三次、验证要串三到五次，不给总时限的话最坏耗时会超过函数上限，
 *   也超过浏览器的放弃时间。
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
