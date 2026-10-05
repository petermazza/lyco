import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { exchangeCode } from "@/lib/calendar/google";
import { setSecret } from "@/lib/secrets";
import { calendarRedirectUri } from "@/lib/app-url";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/?error=unauthorized", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/?error=${error}`, req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", req.url));
  }

  try {
    const { refreshToken, accessToken } = await exchangeCode(code, calendarRedirectUri());

    await setSecret(user.userId, "google_calendar_refresh_token", refreshToken);
    await setSecret(user.userId, "google_calendar_access_token", accessToken);

    return NextResponse.redirect(new URL("/?calendar=connected", req.url));
  } catch (err) {
    console.error("Calendar OAuth callback error:", err);
    return NextResponse.redirect(new URL("/?error=oauth_failed", req.url));
  }
}
