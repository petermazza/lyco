import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { query } from "@/lib/db";
import { isValidTimezone } from "@/lib/tz";

// The browser reports its IANA timezone once per app load; we store
// it so server-side "today"/"tomorrow" math happens in the user's zone.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const timezone = body?.timezone;

  if (typeof timezone !== "string" || !isValidTimezone(timezone)) {
    return NextResponse.json({ error: "A valid IANA timezone is required" }, { status: 400 });
  }

  if (timezone !== user.timezone) {
    await query(`UPDATE users SET timezone = $1 WHERE id = $2`, [timezone, user.userId]);
  }

  return NextResponse.json({ ok: true });
}
