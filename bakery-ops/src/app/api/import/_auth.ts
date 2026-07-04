import { NextRequest, NextResponse } from "next/server";

// Opt-in guard for the write-path import routes (IMPROVEMENT-PLAN.md P0-2).
// When IMPORT_API_KEY is unset the routes stay open (current behavior, LAN-local
// dashboard is the only caller); once set, callers must send x-import-key.
export function checkImportKey(req: NextRequest): NextResponse | null {
  const requiredKey = process.env.IMPORT_API_KEY;
  if (requiredKey && req.headers.get("x-import-key") !== requiredKey) {
    return NextResponse.json({ success: false, errors: ["unauthorized"] }, { status: 401 });
  }
  return null;
}
