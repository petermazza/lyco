import crypto from "crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getAuthUrl } from "@/lib/calendar/google";
import { calendarRedirectUri } from "@/lib/app-url";

export const OAUTH_STATE_COOKIE = "lyco_oauth_state";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // CSRF protection: the callback verifies this cookie against Google's
  // `state` param so a forged callback can't link someone else's calendar.
  const state = crypto.randomBytes(32).toString("hex");
  const authUrl = getAuthUrl(calendarRedirectUri(), state);

  const res = NextResponse.json({ authUrl });
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
