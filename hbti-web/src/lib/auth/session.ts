import {
  createAuthStoreFromEnv,
  type AuthSession,
} from "@/lib/auth/pg-auth-store";
import { readHbtiSessionCookie } from "@/lib/auth/session-cookie";

export async function readHbtiAuthSession(
  request: Request,
): Promise<AuthSession | null> {
  const token = readHbtiSessionCookie(request);
  if (!token) {
    return null;
  }
  return (await createAuthStoreFromEnv()).getSession(token);
}
