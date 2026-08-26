import { noStoreJson } from "@/lib/auth/http";
import { readStaffSession } from "@/lib/staff/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = readStaffSession(request);
  return session
    ? noStoreJson({ authenticated: true, staffId: session.staffId })
    : noStoreJson({ authenticated: false }, { status: 401 });
}
