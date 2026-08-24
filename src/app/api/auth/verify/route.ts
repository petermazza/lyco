import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLink, createSession, SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const result = await verifyMagicLink(token);
  if (!result) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const sessionToken = await createSession(result.userId);

  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });

  return res;
}
