import { NextRequest, NextResponse } from "next/server";
import { createMagicLink } from "@/lib/auth";
import { sendMagicLinkEmail } from "@/lib/email";

// shortcut: in-memory window — resets on deploy and misses multi-instance
// abuse; upgrade to a shared store (e.g. Redis) if the app scales past one
// instance or needs durable limits.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;
const hits = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.set(key, list);
  if (list.length >= MAX_REQUESTS) return true;
  list.push(now);
  return false;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  // Test accounts bypass the limit so suites can sign in repeatedly.
  if (!email.endsWith("@lyco.test")) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (isRateLimited(`email:${email}`) || isRateLimited(`ip:${ip}`)) {
      return NextResponse.json(
        { error: "Too many sign-in links requested. Please wait a few minutes." },
        { status: 429 }
      );
    }
  }

  const { link } = await createMagicLink(email);

  try {
    await sendMagicLinkEmail(email, link);
  } catch (err) {
    console.error("[request-link] Failed to send email:", err);
    return NextResponse.json({ error: "Could not send sign-in email. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, ...(process.env.NODE_ENV === "development" ? { link } : {}) });
}
