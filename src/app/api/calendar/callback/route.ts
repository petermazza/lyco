import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { exchangeCode } from "@/lib/calendar/google";
import { setSecret } from "@/lib/secrets";

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

  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3001"}/api/calendar/callback`;

  try {
    const { refreshToken, accessToken } = await exchangeCode(code, redirectUri);

    await setSecret(user.userId, "google_calendar_refresh_token", refreshToken);
    await setSecret(user.userId, "google_calendar_access_token", accessToken);

    return NextResponse.redirect(new URL("/?calendar=connected", req.url));
  } catch (err) {
    console.error("Calendar OAuth callback error:", err);
    return NextResponse.redirect(new URL("/?error=oauth_failed", req.url));
  }
}
