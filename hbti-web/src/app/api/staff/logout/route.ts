import { getJsonMutationRejection, noStoreJson } from "@/lib/auth/http";
import { readHbtiServerConfig } from "@/lib/server-config";
import { clearStaffSessionCookie } from "@/lib/staff/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rejection = getJsonMutationRejection(
    request,
    readHbtiServerConfig().linkBaseUrl,
  );
  if (rejection) return rejection;
  const response = noStoreJson({ loggedOut: true });
  clearStaffSessionCookie(response);
  return response;
}
