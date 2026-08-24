import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function GET() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json({ user: null });
  }

  const session = await verifySession(sessionToken);
  if (!session) {
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({ user: { email: session.email, id: session.userId } });
}
