import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getAuthUrl } from "@/lib/calendar/google";
import { calendarRedirectUri } from "@/lib/app-url";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authUrl = getAuthUrl(calendarRedirectUri());

  return NextResponse.json({ authUrl });
}
