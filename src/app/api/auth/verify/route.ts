import { NextRequest, NextResponse } from "next/server";
import { verifyMagicLink, createSession, SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE } from "@/lib/auth";

// A bare GET must not consume the link — email scanners and link previews
// fetch URLs and would burn the token before the user clicks. GET renders a
// one-click confirm page; the POST below performs the actual sign-in.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in to lyco</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; background: #0a0a0a; color: #e5e5e5; }
    main { text-align: center; padding: 2rem; }
    button { background: #e5e5e5; color: #0a0a0a; border: 0; border-radius: 8px; padding: 0.75rem 2rem; font-size: 1rem; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>Sign in to lyco</h1>
    <form method="post" action="/api/auth/verify?token=${encodeURIComponent(token)}">
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`;
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const result = await verifyMagicLink(token);
  if (!result) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const sessionToken = await createSession(result.userId);

  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });

  return res;
}
