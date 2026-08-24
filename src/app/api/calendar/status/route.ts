import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isCalendarConnected } from "@/lib/calendar/google";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connected = await isCalendarConnected(user.userId);
  return NextResponse.json({ connected });
}
