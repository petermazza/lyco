import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getAuthUrl } from "@/lib/calendar/google";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3001"}/api/calendar/callback`;
  const authUrl = getAuthUrl(redirectUri);

  return NextResponse.json({ authUrl });
}
